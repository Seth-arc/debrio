"use server";

import { redirect } from "next/navigation";
import { isSessionId } from "../../lib/guest";
import { currentHost, SIGN_IN_UNAVAILABLE } from "../../lib/supabase";
import type { FormState } from "../form";

const text = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

// The database checks ownership and MFA for every command; this only routes.
async function ownerHost() {
  const host = await currentHost();
  if (host.state === "signed-out") redirect("/sign-in");
  if (host.state === "aal1") redirect("/mfa");
  return host.state === "aal2" ? host : null;
}

export async function createSession(
  _: FormState,
  data: FormData
): Promise<FormState> {
  const title = text(data, "title").trim();
  if ([...title].length < 1 || [...title].length > 120)
    return { error: "Enter a session title of 1 to 120 characters." };
  const host = await ownerHost();
  if (!host) return { error: SIGN_IN_UNAVAILABLE };
  const { data: session, error } = await host.supabase.rpc("create_session", {
    p_title: title,
  });
  if (error)
    return {
      error:
        "The session service is unavailable, so the session wasn't created. Try again.",
    };
  redirect(`/sessions/${session.id}`);
}

// One action for every button on the host's session page. Each command maps
// to one owner-checked database function; anything else is ignored.
type Call = { fn: string; args: Record<string, unknown> };
const COMMANDS: Record<string, (session: string, participant: string) => Call> =
  {
    lock: (session) => ({
      fn: "set_session_locked",
      args: { p_session: session, p_locked: true },
    }),
    unlock: (session) => ({
      fn: "set_session_locked",
      args: { p_session: session, p_locked: false },
    }),
    replace: (session) => ({
      fn: "replace_join_key",
      args: { p_session: session },
    }),
    end: (session) => ({ fn: "end_session", args: { p_session: session } }),
    admit: (_, participant) => decision(participant, "admit"),
    deny: (_, participant) => decision(participant, "deny"),
    remove: (_, participant) => decision(participant, "remove"),
  };
function decision(participant: string, choice: string): Call {
  return {
    fn: "decide_participant",
    args: { p_participant: participant, p_decision: choice },
  };
}
const NOTICES = {
  session_ended: "ended",
  invalid_transition: "changed",
};

export async function updateSession(data: FormData) {
  const sessionId = text(data, "session");
  if (!isSessionId(sessionId)) redirect("/workspace");
  const host = await ownerHost();
  if (!host) redirect(`/sessions/${sessionId}?notice=unavailable`);
  const command = text(data, "command");
  const build = Object.entries(COMMANDS).find(
    ([name]) => name === command
  )?.[1];
  if (!build) redirect(`/sessions/${sessionId}`);
  const call = build(sessionId, text(data, "participant"));
  const { error } = await host.supabase.rpc(call.fn, call.args);
  if (error)
    redirect(
      `/sessions/${sessionId}?notice=${
        Object.entries(NOTICES).find(([code]) => code === error.message)?.[1] ??
        "unavailable"
      }`
    );
  redirect(`/sessions/${sessionId}`);
}
