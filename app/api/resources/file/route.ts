import { createClient } from "@supabase/supabase-js";
import { isUuid } from "../../../../lib/ids";
import { verifyFileAvailability } from "../../../../lib/file-availability";
import {
  FILE_BUCKET_READY,
  FILE_BUCKET_STAGING,
  FileValidationError,
  fileSha256,
  scanFileBytes,
  validateFileBytes,
  validateFileName,
} from "../../../../lib/resource-file";
import {
  readBoundedRequest,
  sessionReply as reply,
} from "../../../../lib/session-request";
import { currentHost } from "../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Intent = {
  id: string;
  workspace_id: string;
  resource_id: string;
  revision: number;
  state: string;
  filename: string;
  mime: string;
  byte_size: number;
  sha256: string;
  staging_key: string;
  ready_key: string;
  expires_at: string;
};

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function storageClient() {
  const url = process.env.SUPABASE_STORAGE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const safe = (error: string, status = 400, uncertain = false) =>
  reply({ error, uncertain }, status);

export async function POST(request: Request) {
  const parsed = await readBoundedRequest(request, "invalid_file");
  if (parsed.response) return parsed.response;
  const x = parsed.input;
  if (!isUuid(x.workspace) || typeof x.command !== "string")
    return safe("invalid_file");
  const host = await currentHost();
  if (host.state !== "aal2") return safe("not_allowed", 403);
  const service = serviceClient();
  const storage = storageClient();
  if (!service || !storage) return safe("resource_unavailable", 503);
  try {
    if (x.command === "begin") {
      if (
        Object.keys(x).some(
          (k) =>
            ![
              "workspace",
              "command",
              "operation",
              "resource",
              "revision",
              "title",
              "filename",
              "mime",
              "size",
              "sha256",
            ].includes(k)
        ) ||
        !isUuid(x.operation) ||
        !isUuid(x.resource) ||
        !Number.isSafeInteger(x.revision) ||
        (x.revision as number) < 0 ||
        typeof x.title !== "string" ||
        x.title.trim().length < 1 ||
        x.title.length > 120 ||
        typeof x.filename !== "string" ||
        typeof x.mime !== "string" ||
        !Number.isSafeInteger(x.size) ||
        (x.size as number) < 1 ||
        (x.size as number) > 10485760 ||
        typeof x.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(x.sha256)
      )
        return safe("invalid_file");
      validateFileName(x.filename, x.mime);
      const { data, error } = await host.supabase.rpc("begin_file_resource", {
        p_workspace: x.workspace,
        p_operation: x.operation,
        p_resource: x.resource,
        p_revision: x.revision,
        p_title: x.title,
        p_filename: x.filename,
        p_mime: x.mime,
        p_size: x.size,
        p_sha256: x.sha256,
      });
      if (error) {
        const code = [
          "resource_conflict",
          "resource_prerequisite",
          "operation_reused",
          "invalid_resource",
        ].find((value) => error.message === value);
        return safe(code ?? "resource_unavailable", code ? 409 : 503);
      }
      return reply({ intent: data });
    }
    if (x.command === "status") {
      if (
        Object.keys(x).some(
          (k) => !["workspace", "command", "intent", "resource"].includes(k)
        ) ||
        (x.intent === undefined) === (x.resource === undefined) ||
        (x.intent !== undefined && !isUuid(x.intent)) ||
        (x.resource !== undefined && !isUuid(x.resource))
      )
        return safe("invalid_file");
      const { data, error } = x.intent
        ? await host.supabase.rpc("read_file_resource", {
            p_workspace: x.workspace,
            p_intent: x.intent,
          })
        : await host.supabase.rpc("read_file_resource_for_resource", {
            p_workspace: x.workspace,
            p_resource: x.resource,
          });
      if (error) return safe("not_allowed", 403);
      if (
        data?.state === "ready" &&
        data.version &&
        !(await verifyFileAvailability(data.version))
      )
        return safe("resource_unavailable", 503);
      return reply({ intent: data });
    }
    if (x.command === "finalize") {
      if (
        Object.keys(x).some(
          (k) => !["workspace", "command", "intent"].includes(k)
        ) ||
        !isUuid(x.intent)
      )
        return safe("invalid_file");
      const authorized = await host.supabase.rpc("read_file_resource", {
        p_workspace: x.workspace,
        p_intent: x.intent,
      });
      if (authorized.error || !authorized.data) return safe("not_allowed", 403);
      if (authorized.data.state === "ready") {
        if (!(await verifyFileAvailability(authorized.data.version)))
          return safe("resource_unavailable", 503);
        return reply({
          receipt: { committed: true, version: authorized.data.version },
        });
      }
      const query = await service
        .from("resource_file_intents")
        .select("*")
        .eq("id", x.intent)
        .eq("workspace_id", x.workspace)
        .single();
      const intent = query.data as Intent | null;
      if (
        query.error ||
        !intent ||
        !["pending", "unavailable", "promoting"].includes(intent.state)
      )
        return safe("resource_unavailable", 503);
      const staged = await storage.storage
        .from(FILE_BUCKET_STAGING)
        .download(intent.staging_key);
      const promoted =
        staged.error && intent.state === "promoting"
          ? await storage.storage
              .from(FILE_BUCKET_READY)
              .download(intent.ready_key)
          : null;
      if ((!staged.data || staged.error) && (!promoted?.data || promoted.error))
        return safe("resource_unavailable", 503, true);
      const bytes = new Uint8Array(
        await (staged.data ?? promoted!.data!).arrayBuffer()
      );
      let promotionReserved = intent.state === "promoting";
      try {
        const validated = await validateFileBytes(
          bytes,
          intent.filename,
          intent.mime
        );
        if (
          validated.sha256 !== intent.sha256 ||
          validated.size !== intent.byte_size
        )
          throw new FileValidationError("invalid_file");
        const scan = await scanFileBytes(bytes);
        const reservation = await service.rpc("reserve_file_promotion", {
          p_intent: intent.id,
        });
        if (reservation.error) return safe("resource_prerequisite", 409);
        promotionReserved = true;
        const ready = await storage.storage
          .from(FILE_BUCKET_READY)
          .upload(intent.ready_key, bytes, {
            contentType: intent.mime,
            cacheControl: "0",
            upsert: false,
          });
        if (ready.error) {
          const existing = await storage.storage
            .from(FILE_BUCKET_READY)
            .download(intent.ready_key);
          if (
            existing.error ||
            !existing.data ||
            (
              await validateFileBytes(
                new Uint8Array(await existing.data.arrayBuffer()),
                intent.filename,
                intent.mime
              )
            ).sha256 !== intent.sha256
          )
            return safe("resource_unavailable", 503, true);
        }
        const removed = await storage.storage
          .from(FILE_BUCKET_STAGING)
          .remove([intent.staging_key]);
        if (removed.error) return safe("resource_unavailable", 503, true);
        const finished = await service.rpc("finish_file_resource", {
          p_intent: intent.id,
          p_sha256: validated.sha256,
          p_scanner: scan.scanner,
          p_signatures_at: scan.signaturesAt,
        });
        if (finished.error) return safe("resource_unavailable", 503, true);
        return reply({ receipt: finished.data });
      } catch (error) {
        const code =
          error instanceof FileValidationError
            ? error.code
            : "scan_unavailable";
        if (!promotionReserved) {
          await service.rpc("set_file_resource_state", {
            p_intent: intent.id,
            p_state: code === "scan_unavailable" ? "unavailable" : "rejected",
            p_error: code,
          });
        }
        return safe(code, code === "scan_unavailable" ? 503 : 400);
      }
    }
    if (x.command === "delete") {
      if (
        Object.keys(x).some(
          (k) => !["workspace", "command", "intent", "version"].includes(k)
        ) ||
        (x.intent === undefined) === (x.version === undefined) ||
        (x.intent !== undefined && !isUuid(x.intent)) ||
        (x.version !== undefined && !isUuid(x.version))
      )
        return safe("invalid_file");
      const deleted = x.intent
        ? await host.supabase.rpc("delete_file_resource", {
            p_workspace: x.workspace,
            p_intent: x.intent,
          })
        : await host.supabase.rpc("delete_file_resource_version", {
            p_workspace: x.workspace,
            p_version: x.version,
          });
      if (deleted.error) return safe("not_allowed", 403);
      const deletedIntent = deleted.data?.intent as string;
      const query = await service
        .from("resource_file_intents")
        .select("staging_key,ready_key")
        .eq("id", deletedIntent)
        .eq("workspace_id", x.workspace)
        .single();
      if (query.error || !query.data)
        return reply({ receipt: { committed: true, purge_pending: true } });
      const staged = await storage.storage
        .from(FILE_BUCKET_STAGING)
        .remove([query.data.staging_key]);
      const ready = await storage.storage
        .from(FILE_BUCKET_READY)
        .remove([query.data.ready_key]);
      if (staged.error || ready.error) {
        await service.rpc("record_file_cleanup_failure", {
          p_intent: deletedIntent,
          p_error: "storage_unavailable",
        });
        return reply({ receipt: { committed: true, purge_pending: true } });
      }
      const purged = await service.rpc("purge_file_resource", {
        p_intent: deletedIntent,
      });
      if (purged.error)
        await service.rpc("record_file_cleanup_failure", {
          p_intent: deletedIntent,
          p_error: "purge_unavailable",
        });
      return reply({
        receipt: { committed: true, purge_pending: !!purged.error },
      });
    }
    return safe("invalid_file");
  } catch (error) {
    if (error instanceof FileValidationError) return safe(error.code);
    return safe("resource_unavailable", 503, true);
  }
}

export async function PUT(request: Request) {
  let origin: URL;
  try {
    origin = new URL(request.headers.get("origin") ?? "");
  } catch {
    return safe("not_allowed", 403);
  }
  if (
    origin.host !== request.headers.get("host") ||
    !["http:", "https:"].includes(origin.protocol) ||
    request.headers.get("content-type") !== "application/octet-stream"
  )
    return safe("not_allowed", 403);
  const query = new URL(request.url).searchParams;
  const workspace = query.get("workspace");
  const intentId = query.get("intent");
  if (
    !isUuid(workspace) ||
    !isUuid(intentId) ||
    [...query.keys()].some(
      (key) =>
        !["workspace", "intent"].includes(key) || query.getAll(key).length !== 1
    )
  )
    return safe("invalid_file");
  const host = await currentHost();
  if (host.state !== "aal2") return safe("not_allowed", 403);
  const authorized = await host.supabase.rpc("read_file_resource", {
    p_workspace: workspace,
    p_intent: intentId,
  });
  if (
    authorized.error ||
    !(
      authorized.data?.state === "pending" ||
      (authorized.data?.state === "uploading" &&
        new Date(authorized.data.upload_lock_until).valueOf() <= Date.now())
    ) ||
    new Date(authorized.data.expires_at).valueOf() <= Date.now()
  )
    return safe("not_allowed", 403);
  const service = serviceClient();
  const storage = storageClient();
  if (!service || !storage) return safe("resource_unavailable", 503);
  const found = await service
    .from("resource_file_intents")
    .select("*")
    .eq("id", intentId)
    .eq("workspace_id", workspace)
    .single();
  const intent = found.data as Intent | null;
  if (
    found.error ||
    !intent ||
    !["pending", "uploading"].includes(intent.state)
  )
    return safe("not_allowed", 403);
  if (Number(request.headers.get("content-length") ?? 0) > intent.byte_size)
    return safe("invalid_file", 413);
  const reader = request.body?.getReader();
  if (!reader) return safe("invalid_file");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const bodyDeadline = Date.now() + 30000;
  let bodyComplete = false;
  try {
    while (true) {
      const remaining = bodyDeadline - Date.now();
      if (remaining <= 0) throw Error("upload_body_timeout");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("upload_body_timeout")),
            remaining
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) break;
      const value = chunk.value;
      size += value.byteLength;
      if (size > intent.byte_size || size > 10485760) {
        await reader.cancel();
        return safe("invalid_file", 413);
      }
      chunks.push(value);
    }
    bodyComplete = true;
  } catch {
    return safe("resource_unavailable", 503, true);
  } finally {
    if (!bodyComplete) void reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      // A timed-out read may still be settling after cancellation.
    }
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== intent.byte_size || fileSha256(bytes) !== intent.sha256)
    return safe("invalid_file");
  const fresh = await host.supabase.rpc("read_file_resource", {
    p_workspace: workspace,
    p_intent: intentId,
  });
  if (
    fresh.error ||
    !(
      fresh.data?.state === "pending" ||
      (fresh.data?.state === "uploading" &&
        new Date(fresh.data.upload_lock_until).valueOf() <= Date.now())
    ) ||
    new Date(fresh.data.expires_at).valueOf() <= Date.now()
  )
    return safe("not_allowed", 403);
  const reserved = await service.rpc("reserve_file_upload", {
    p_intent: intentId,
  });
  if (reserved.error || !reserved.data) return safe("not_allowed", 403);
  const storageUrl =
    process.env.SUPABASE_STORAGE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!storageUrl || !key) {
    await service.rpc("finish_file_upload", { p_intent: intentId });
    return safe("resource_unavailable", 503, true);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let outcome: "ok" | "conflict" | "unavailable" = "unavailable";
  try {
    const path = `${storageUrl}/storage/v1/object/${FILE_BUCKET_STAGING}/${intent.staging_key}`;
    const uploaded = await fetch(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        apikey: key,
        "content-type": intent.mime,
        "cache-control": "no-store",
      },
      body: bytes,
      signal: controller.signal,
    });
    if (uploaded.ok) outcome = "ok";
    // Storage reports an existing object as HTTP 400 in the local stack and
    // HTTP 409 in other gateways. Accept only the exact already-staged bytes.
    else if (uploaded.status === 409 || uploaded.status === 400) {
      const existing = await fetch(
        `${storageUrl}/storage/v1/object/authenticated/${FILE_BUCKET_STAGING}/${intent.staging_key}`,
        {
          headers: { authorization: `Bearer ${key}`, apikey: key },
          cache: "no-store",
          signal: controller.signal,
        }
      );
      if (existing.ok) {
        const actual = new Uint8Array(await existing.arrayBuffer());
        outcome =
          actual.length === intent.byte_size &&
          fileSha256(actual) === intent.sha256
            ? "ok"
            : "conflict";
      }
    }
  } catch {
    // The completion RPC below releases or preserves the durable lease.
  } finally {
    clearTimeout(timeout);
  }
  const completed = await service.rpc("finish_file_upload", {
    p_intent: intentId,
  });
  if (completed.error) return safe("resource_unavailable", 503, true);
  if (!completed.data) {
    const removed = await storage.storage
      .from(FILE_BUCKET_STAGING)
      .remove([intent.staging_key]);
    if (removed.error)
      await service.rpc("record_file_cleanup_failure", {
        p_intent: intentId,
        p_error: "storage_unavailable",
      });
    return safe("not_allowed", 403);
  }
  if (outcome === "conflict") return safe("resource_conflict", 409);
  if (outcome !== "ok") return safe("resource_unavailable", 503, true);
  return reply({ receipt: { committed: true, intent: intentId } });
}
