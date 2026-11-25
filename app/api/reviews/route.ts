import { cookies } from "next/headers";
import { credentialHash, guestCookieName } from "../../../lib/guest";
import { isUuid } from "../../../lib/ids";
import { validReviewRequest } from "../../../lib/reviews";
import { readSessionRequest, sessionReply } from "../../../lib/session-request";
import { currentHost, guestSupabase } from "../../../lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const parsed = await readSessionRequest(request, "invalid_review");
  if (parsed.response) return parsed.response;
  const x = parsed.input;
  const r = x.request ?? { command: "read" };
  if (
    !validReviewRequest(r) ||
    (r.command !== "read" && (!x.operation || !isUuid(x.operation)))
  )
    return sessionReply({ error: "invalid_review" }, 400);
  const mutation = r.command !== "read";
  try {
    let db,
      hash: string | null = null;
    if (x.host) {
      const host = await currentHost();
      if (host.state === "unavailable" || host.state === "unconfigured")
        return sessionReply({ error: "unavailable", uncertain: mutation }, 503);
      if (host.state !== "aal2")
        return sessionReply({ error: "not_allowed" }, 403);
      db = host.supabase;
    } else {
      const value = (await cookies()).get(guestCookieName(x.session))?.value;
      db = guestSupabase();
      if (!value || !db) return sessionReply({ error: "not_allowed" }, 403);
      hash = credentialHash(value);
    }
    const result = mutation
      ? await db.rpc("review_command", {
          p_session: x.session,
          p_operation: x.operation,
          p_request: r,
          p_host: x.host,
          p_credential_hash: hash,
        })
      : await db.rpc("read_reviews", {
          p_session: x.session,
          p_host: x.host,
          p_credential_hash: hash,
          p_offset: r.offset ?? 0,
          p_proposal: r.proposal ?? null,
          p_source_offset: r.source_offset ?? 0,
        });
    if (result.error) {
      const known = [
        "not_allowed",
        "invalid_review",
        "stale_review",
        "review_prerequisite",
        "review_unavailable",
        "review_closed",
        "review_disclosure_required",
        "operation_reused",
      ].includes(result.error.message);
      const invalid = result.error.code?.startsWith("22");
      return sessionReply(
        {
          error: known
            ? result.error.message
            : invalid
              ? "invalid_review"
              : "unavailable",
          uncertain: mutation && !known && !invalid,
        },
        known ? 200 : invalid ? 400 : 503
      );
    }
    return sessionReply(
      mutation ? { receipt: result.data } : { snapshot: result.data }
    );
  } catch {
    return sessionReply({ error: "unavailable", uncertain: mutation }, 503);
  }
}
