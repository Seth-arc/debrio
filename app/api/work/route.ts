import { cookies } from "next/headers";
import { credentialHash, guestCookieName } from "../../../lib/guest";
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
  let origin: URL;
  try {
    origin = new URL(request.headers.get("origin") ?? "");
  } catch {
    return reply({ error: "not_allowed" }, 403);
  }
  // Next's internal request URL may use localhost behind the incoming Host.
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.host !== request.headers.get("host") ||
    request.headers.get("content-type") !== "application/json"
  )
    return reply({ error: "not_allowed" }, 403);
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "invalid_work" }, 400);
  let input;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "",
      size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        return reply({ error: "invalid_work" }, 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    input = JSON.parse(text);
  } catch {
    return reply({ error: "invalid_work" }, 400);
  } finally {
    reader.releaseLock();
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !isUuid(input.session) ||
    typeof input.host !== "boolean" ||
    Object.keys(input).some(
      (key) => !["session", "host", "operation", "request"].includes(key)
    )
  )
    return reply({ error: "invalid_work" }, 400);
  const command = input.request;
  if (
    command !== undefined &&
    (!isUuid(input.operation) ||
      !command ||
      typeof command !== "object" ||
      Array.isArray(command) ||
      typeof command.reason !== "string" ||
      !validWorkText(command.reason, 500) ||
      (command.content !== undefined &&
        (typeof command.content !== "object" ||
          command.content === null ||
          Array.isArray(command.content) ||
          Object.values(command.content).some(
            (value) => typeof value !== "string" || !validWorkText(value, 5000)
          ))))
  )
    return reply({ error: "invalid_work" }, 400);
  try {
    let supabase,
      hash: string | null = null;
    if (input.host) {
      const host = await currentHost();
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
        ? await supabase.rpc("read_work", {
            p_session: input.session,
            p_host: input.host,
            p_credential_hash: hash,
          })
        : await supabase.rpc("work_command", {
            p_session: input.session,
            p_operation: input.operation,
            p_request: command,
            p_credential_hash: hash,
          });
    if (error) {
      const known = [
        "not_allowed",
        "work_closed",
        "work_conflict",
        "operation_reused",
        "invalid_work",
        "incomplete_work",
      ].includes(error.message);
      const invalid = error.code?.startsWith("22");
      return reply(
        {
          error: known
            ? error.message
            : invalid
              ? "invalid_work"
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
