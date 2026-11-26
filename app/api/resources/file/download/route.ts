import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { credentialHash, guestCookieName } from "../../../../../lib/guest";
import { storageObjectMissing } from "../../../../../lib/file-availability";
import { isUuid } from "../../../../../lib/ids";
import {
  FILE_BUCKET_READY,
  fileSha256,
} from "../../../../../lib/resource-file";
import { currentHost, guestSupabase } from "../../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safeHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const activeDownloads = new Map<string, number>();
const denied = () =>
  Response.json(
    { error: "not_allowed" },
    { status: 403, headers: safeHeaders }
  );
const unavailable = () =>
  Response.json(
    { error: "resource_unavailable" },
    { status: 503, headers: safeHeaders }
  );

async function allowed(
  db: SupabaseClient,
  session: string,
  allocation: string,
  host: boolean,
  hash: string | null
) {
  const { data, error } = await db.rpc("read_resources", {
    p_session: session,
    p_host: host,
    p_credential_hash: hash,
    p_allocation: allocation,
    p_offset: 0,
  });
  if (
    error ||
    !data?.detail ||
    data.detail.allocation !== allocation ||
    data.detail.kind !== "file" ||
    data.detail.file?.status !== "ready" ||
    !data.detail.released_at ||
    data.detail.revoked_at ||
    !isUuid(data.detail.version) ||
    !Number.isFinite(data.ttl_ms) ||
    data.ttl_ms <= 0
  )
    return null;
  return data.detail as {
    version: string;
    file: { filename: string; mime: string; size: number };
  };
}

export async function GET(request: Request) {
  const started = performance.now();
  const query = new URL(request.url).searchParams;
  const session = query.get("session");
  const allocation = query.get("allocation");
  const isHost = query.get("host");
  if (
    !isUuid(session) ||
    !isUuid(allocation) ||
    !["true", "false"].includes(isHost ?? "") ||
    [...query.keys()].some(
      (key) =>
        !["session", "allocation", "host"].includes(key) ||
        query.getAll(key).length !== 1
    ) ||
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("sec-purpose")?.includes("prefetch")
  )
    return denied();
  try {
    let db: SupabaseClient | null = null;
    let hash: string | null = null;
    if (isHost === "true") {
      const current = await currentHost();
      if (current.state !== "aal2") return denied();
      db = current.supabase;
    } else {
      const credential = (await cookies()).get(guestCookieName(session))?.value;
      db = guestSupabase();
      if (!credential || !db) return denied();
      hash = credentialHash(credential);
    }
    const detail = await allowed(
      db,
      session,
      allocation,
      isHost === "true",
      hash
    );
    if (!detail) return denied();
    const leaseKey = `${session}:${isHost}:${hash ?? "host"}`;
    const inFlight = activeDownloads.get(leaseKey) ?? 0;
    if (inFlight >= 3)
      return Response.json(
        { error: "resource_unavailable" },
        { status: 429, headers: safeHeaders }
      );
    activeDownloads.set(leaseKey, inFlight + 1);
    let released = false;
    const leaseTimeout = setTimeout(() => release(), 15000);
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(leaseTimeout);
      const remaining = (activeDownloads.get(leaseKey) ?? 1) - 1;
      if (remaining) activeDownloads.set(leaseKey, remaining);
      else activeDownloads.delete(leaseKey);
    };
    let handedOff = false;
    try {
      const url = process.env.SUPABASE_URL;
      const storageUrl = process.env.SUPABASE_STORAGE_URL ?? url;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !storageUrl || !key) return unavailable();
      const service = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const found = await service
        .from("resource_file_versions")
        .select("intent_id,storage_key,byte_size,sha256,state")
        .eq("version_id", detail.version)
        .eq("state", "ready")
        .single();
      if (
        found.error ||
        !found.data ||
        found.data.byte_size !== detail.file.size
      )
        return unavailable();
      if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/u.test(found.data.storage_key))
        return unavailable();
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Math.max(1, 14500 - (performance.now() - started))
      );
      let fetched: Response;
      let bytes: Uint8Array;
      try {
        fetched = await fetch(
          `${storageUrl}/storage/v1/object/authenticated/${FILE_BUCKET_READY}/${found.data.storage_key}`,
          {
            headers: { authorization: `Bearer ${key}`, apikey: key },
            cache: "no-store",
            signal: controller.signal,
          }
        );
        if (fetched.ok) bytes = new Uint8Array(await fetched.arrayBuffer());
        else bytes = new Uint8Array();
      } catch {
        return unavailable();
      } finally {
        clearTimeout(timeout);
      }
      if (!fetched.ok) {
        if (await storageObjectMissing(fetched))
          await service.rpc("set_file_resource_state", {
            p_intent: found.data.intent_id,
            p_state: "unavailable",
            p_error: "missing_object",
          });
        return unavailable();
      }
      if (
        bytes.length !== detail.file.size ||
        fileSha256(bytes) !== found.data.sha256
      ) {
        await service.rpc("set_file_resource_state", {
          p_intent: found.data.intent_id,
          p_state: "unavailable",
          p_error: "integrity_failure",
        });
        return unavailable();
      }
      if (
        performance.now() - started >= 15000 ||
        !(await allowed(db, session, allocation, isHost === "true", hash))
      )
        return denied();
      let start = 0;
      let end = bytes.length - 1;
      let status = 200;
      const range = request.headers.get("range");
      if (range) {
        const parsed = /^bytes=(\d+)-(\d*)$/u.exec(range);
        if (!parsed)
          return new Response(null, { status: 416, headers: safeHeaders });
        start = Number(parsed[1]);
        end = parsed[2] ? Number(parsed[2]) : Math.min(start + 1048575, end);
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end < start ||
          end >= bytes.length ||
          end - start + 1 > 1048576
        )
          return new Response(null, { status: 416, headers: safeHeaders });
        status = 206;
      }
      const mime = detail.file.mime;
      const filename = detail.file.filename;
      if (
        !["application/pdf", "text/plain"].includes(mime) ||
        filename.length > 120 ||
        /[/\\\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(filename)
      )
        return unavailable();
      let offset = start;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (
            performance.now() - started >= 15000 ||
            !(await allowed(db!, session, allocation, isHost === "true", hash))
          ) {
            release();
            controller.close();
            return;
          }
          const next = Math.min(offset + 1048576, end + 1);
          controller.enqueue(bytes.subarray(offset, next));
          offset = next;
          if (offset > end) {
            release();
            controller.close();
          }
        },
        cancel() {
          release();
        },
      });
      handedOff = true;
      return new Response(body, {
        status,
        headers: {
          ...safeHeaders,
          "Accept-Ranges": "bytes",
          "Content-Disposition": `attachment; filename="download${mime === "application/pdf" ? ".pdf" : ".txt"}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Content-Length": String(end - start + 1),
          "Content-Type": mime,
          ...(status === 206
            ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` }
            : {}),
        },
      });
    } finally {
      if (!handedOff) release();
    }
  } catch {
    return unavailable();
  }
}
