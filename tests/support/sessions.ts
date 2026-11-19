import type { SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { credentialHash, newGuestCredential } from "../../lib/guest";
import { client, ownerWithMfa } from "./hosts";

// Session and guest helpers for integration tests against the local stack.
export type Session = {
  id: string;
  join_key: string;
  state: string;
  locked: boolean;
};

// An owner with MFA, their workspace and one open session.
export async function hostWithSession() {
  const owner = await ownerWithMfa();
  expect(
    (await owner.host.from("workspaces").insert({ name: "Synthetic Practice" }))
      .error
  ).toBeNull();
  const { data, error } = await owner.host.rpc("create_session", {
    p_title: "Synthetic Workshop",
  });
  expect(error).toBeNull();
  return { ...owner, session: data as Session };
}

// A guest browser: anonymous calls plus its own credential.
export async function guestJoins(
  key: string,
  name = "Synthetic Guest",
  options: { returning?: boolean; as?: SupabaseClient } = {}
) {
  const credential = newGuestCredential();
  const hash = credentialHash(credential);
  // A signed-in visitor joins with their own session; anyone else as anon.
  const joined = await (options.as ?? client()).rpc("request_admission", {
    p_key: key,
    p_display_name: name,
    p_credential_hash: hash,
    p_returning: options.returning ?? false,
  });
  return { hash, joined };
}

export const status = async (sessionId: string, hash: string) =>
  (
    await client().rpc("guest_status", {
      p_session: sessionId,
      p_credential_hash: hash,
    })
  ).data as { participant_state: string; session_state: string }[];

export const participantId = async (host: SupabaseClient, sessionId: string) =>
  (
    await host
      .from("session_participants")
      .select("id")
      .eq("session_id", sessionId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .single()
  ).data!.id as string;

export const decide = (host: SupabaseClient, id: string, decision: string) =>
  host.rpc("decide_participant", {
    p_participant: id,
    p_decision: decision,
  });
