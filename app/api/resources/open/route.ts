import { cookies } from "next/headers";
import { credentialHash, guestCookieName } from "../../../../lib/guest";
import { isUuid } from "../../../../lib/ids";
import { normalizeResourceUrl } from "../../../../lib/resource-link";
import { currentHost, guestSupabase } from "../../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
};
const denied = () =>
  Response.json({ error: "not_allowed" }, { status: 403, headers });

export async function GET(request: Request) {
  const started = performance.now();
  const query = new URL(request.url).searchParams;
  const session = query.get("session"),
    allocation = query.get("allocation"),
    host = query.get("host");
  if (
    !isUuid(session) ||
    !isUuid(allocation) ||
    !["true", "false"].includes(host ?? "") ||
    [...query.keys()].some(
      (k) => !["session", "allocation", "host"].includes(k)
    ) ||
    [...query.keys()].some((k) => query.getAll(k).length !== 1)
  )
    return denied();
  // A prefetch never discloses a destination or counts as an intentional link-out.
  if (
    request.headers.get("purpose") === "prefetch" ||
    request.headers.get("sec-purpose")?.includes("prefetch")
  )
    return denied();
  try {
    let db,
      hash: string | null = null;
    if (host === "true") {
      const current = await currentHost();
      if (current.state !== "aal2") return denied();
      db = current.supabase;
    } else {
      const credential = (await cookies()).get(guestCookieName(session))?.value;
      db = guestSupabase();
      if (!credential || !db) return denied();
      hash = credentialHash(credential);
    }
    const { data, error } = await db.rpc("read_resources", {
      p_session: session,
      p_host: host === "true",
      p_credential_hash: hash,
      p_allocation: allocation,
      p_offset: 0,
    });
    if (
      error ||
      !Number.isFinite(data?.ttl_ms) ||
      performance.now() - started >= Math.min(5000, data.ttl_ms) ||
      data?.detail?.allocation !== allocation ||
      data.detail.kind !== "link" ||
      !data.detail.released_at ||
      data.detail.revoked_at ||
      typeof data.detail.content !== "string"
    )
      return denied();
    return new Response(null, {
      status: 303,
      headers: {
        ...headers,
        Location: normalizeResourceUrl(data.detail.content),
      },
    });
  } catch {
    return denied();
  }
}
