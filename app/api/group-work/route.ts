import { cookies } from "next/headers";
import { credentialHash, guestCookieName } from "../../../lib/guest";
import { readSessionRequest } from "../../../lib/session-request";
import { isUuid } from "../../../lib/ids";
import { currentHost, guestSupabase } from "../../../lib/supabase";
import { validWorkText } from "../../../lib/work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const reply = (body: object, status = 200) =>
  Response.json(body, { status, headers });

// A bounded same-origin JSON boundary: guest credentials never enter JS or URLs.
export async function POST(request: Request) {
  const parsed = await readSessionRequest(request, "invalid_group_work");
  if (parsed.response) return parsed.response;
  const { input } = parsed;
  const command = input.request;
  if (
    command !== undefined &&
    (!isUuid(input.operation ?? "") ||
      !command ||
      typeof command !== "object" ||
      Array.isArray(command) ||
      typeof command.reason !== "string" ||
      !validWorkText(command.reason, 500) ||
      (command.value !== undefined &&
        (typeof command.value !== "string" ||
          !validWorkText(command.value, 5000))) ||
      (command.content !== undefined &&
        (typeof command.content !== "object" ||
          command.content === null ||
          Array.isArray(command.content) ||
          Object.values(command.content).some(
            (value) => typeof value !== "string" || !validWorkText(value, 5000)
          ))))
  )
    return reply({ error: "invalid_group_work" }, 400);
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
        ? await supabase.rpc("read_group_work", {
            p_session: input.session,
            p_host: input.host,
            p_credential_hash: hash,
          })
        : command.command === "recorder"
          ? await supabase.rpc("recorder_command", {
              p_session: input.session,
              p_operation: input.operation,
              p_request: Object.fromEntries(
                Object.entries(command).filter(([key]) => key !== "command")
              ),
            })
          : await supabase.rpc("group_work_command", {
              p_session: input.session,
              p_operation: input.operation,
              p_request: command,
              p_credential_hash: hash,
            });
    if (error) {
      const known = [
        "not_allowed",
        "group_work_closed",
        "group_work_conflict",
        "operation_reused",
        "invalid_group_work",
        "incomplete_work",
        "field_reset_required",
      ].includes(error.message);
      const invalid = error.code?.startsWith("22");
      return reply(
        {
          error: known
            ? error.message
            : invalid
              ? "invalid_group_work"
              : "unavailable",
          uncertain: !known && !invalid,
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
