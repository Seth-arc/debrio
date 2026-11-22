import { cookies } from "next/headers";
import { credentialHash, guestCookieName } from "../../../lib/guest";
import {
  readSessionRequest,
  sessionReply as reply,
} from "../../../lib/session-request";
import { isUuid } from "../../../lib/ids";
import { currentHost, guestSupabase } from "../../../lib/supabase";
import { validWorkText } from "../../../lib/work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await readSessionRequest(request, "invalid_input");
  if (parsed.response) return parsed.response;
  const { input } = parsed;
  const command = input.request;
  if (
    command !== undefined &&
    (!input.host ||
      !isUuid(input.operation ?? "") ||
      typeof command.reason !== "string" ||
      !validWorkText(command.reason, 500))
  )
    return reply({ error: "invalid_input" }, 400);
  try {
    let supabase,
      hash: string | null = null;
    if (input.host) {
      const host = await currentHost();
      if (host.state === "unavailable" || host.state === "unconfigured")
        return reply(
          { error: "unavailable", uncertain: command !== undefined },
          503
        );
      if (host.state !== "aal2") return reply({ error: "not_allowed" }, 403);
      supabase = host.supabase;
    } else {
      const credential = (await cookies()).get(
        guestCookieName(input.session)
      )?.value;
      supabase = guestSupabase();
      if (!credential || !supabase) return reply({ error: "not_allowed" }, 403);
      hash = credentialHash(credential);
    }
    const { data, error } =
      command === undefined
        ? await supabase.rpc("read_inputs", {
            p_session: input.session,
            p_host: input.host,
            p_credential_hash: hash,
          })
        : await supabase.rpc("input_command", {
            p_session: input.session,
            p_operation: input.operation,
            p_request: command,
          });
    if (error) {
      const known = [
        "not_allowed",
        "invalid_input",
        "input_access_required",
        "input_prerequisite",
        "input_closed",
        "input_unavailable",
        "stale_input",
        "operation_reused",
      ].includes(error.message);
      const invalid = error.code?.startsWith("22");
      return reply(
        {
          error: known
            ? error.message
            : invalid
              ? "invalid_input"
              : "unavailable",
          uncertain: command !== undefined && !known && !invalid,
        },
        known ? 200 : invalid ? 400 : 503
      );
    }
    return reply(
      command === undefined ? { snapshot: data } : { receipt: data }
    );
  } catch {
    return reply(
      { error: "unavailable", uncertain: command !== undefined },
      503
    );
  }
}
