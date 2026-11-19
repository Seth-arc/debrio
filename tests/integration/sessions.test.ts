import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import { credentialHash, newGuestCredential } from "../../lib/guest";
import { client, confirmedHost, ownerWithMfa } from "../support/hosts";

type Session = { id: string; join_key: string; state: string; locked: boolean };

// An owner with MFA, their workspace and one open session.
async function hostWithSession() {
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
async function guestJoins(key: string, name = "Synthetic Guest") {
  const credential = newGuestCredential();
  const hash = credentialHash(credential);
  const joined = await client().rpc("request_admission", {
    p_key: key,
    p_display_name: name,
    p_credential_hash: hash,
  });
  return { hash, joined };
}

const status = async (sessionId: string, hash: string) =>
  (
    await client().rpc("guest_status", {
      p_session: sessionId,
      p_credential_hash: hash,
    })
  ).data as { participant_state: string; session_state: string }[];

const participantId = async (host: SupabaseClient, sessionId: string) =>
  (
    await host
      .from("session_participants")
      .select("id")
      .eq("session_id", sessionId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .single()
  ).data!.id as string;

const decide = (host: SupabaseClient, id: string, decision: string) =>
  host.rpc("decide_participant", {
    p_participant: id,
    p_decision: decision,
  });

describe("guest admission", { timeout: 60_000 }, () => {
  test("a guest waits, is admitted, removed, and can ask again as a new request", async () => {
    const { host, session } = await hostWithSession();
    const first = await guestJoins(session.join_key);
    expect(first.joined.data).toBe(session.id);
    expect((await status(session.id, first.hash))[0]).toMatchObject({
      participant_state: "waiting",
      session_state: "open",
    });

    const id = await participantId(host, session.id);
    expect((await decide(host, id, "admit")).data.state).toBe("admitted");
    // Repeating a decision is a no-op; an impossible transition is refused.
    expect((await decide(host, id, "admit")).data.state).toBe("admitted");
    expect((await decide(host, id, "deny")).error?.message).toBe(
      "invalid_transition"
    );
    expect((await status(session.id, first.hash))[0].participant_state).toBe(
      "admitted"
    );

    expect((await decide(host, id, "remove")).data.state).toBe("removed");
    expect((await status(session.id, first.hash))[0].participant_state).toBe(
      "removed"
    );

    const again = await guestJoins(session.join_key);
    expect(again.joined.error).toBeNull();
    expect((await status(session.id, again.hash))[0].participant_state).toBe(
      "waiting"
    );
    // The old identity stays revoked.
    expect((await status(session.id, first.hash))[0].participant_state).toBe(
      "removed"
    );
  });

  test("lock, a replaced link and ending the session stop new requests", async () => {
    const { host, session } = await hostWithSession();
    const waiting = await guestJoins(session.join_key);

    await host.rpc("set_session_locked", {
      p_session: session.id,
      p_locked: true,
    });
    expect((await guestJoins(session.join_key)).joined.error?.message).toBe(
      "session_locked"
    );
    // Someone already waiting can still be decided while locked.
    const id = await participantId(host, session.id);
    expect((await decide(host, id, "admit")).error).toBeNull();
    await host.rpc("set_session_locked", {
      p_session: session.id,
      p_locked: false,
    });

    const replaced = (
      await host.rpc("replace_join_key", { p_session: session.id })
    ).data as Session;
    expect(replaced.join_key).not.toBe(session.join_key);
    expect((await guestJoins(session.join_key)).joined.error?.message).toBe(
      "unknown_link"
    );
    expect((await guestJoins(replaced.join_key)).joined.error).toBeNull();

    await host.rpc("end_session", { p_session: session.id });
    expect((await guestJoins(replaced.join_key)).joined.error?.message).toBe(
      "session_ended"
    );
    expect((await status(session.id, waiting.hash))[0].session_state).toBe(
      "ended"
    );
    expect((await decide(host, id, "remove")).error?.message).toBe(
      "session_ended"
    );
  });

  test("other hosts, hosts without MFA and anonymous callers cannot read or decide", async () => {
    const { host, session } = await hostWithSession();
    await guestJoins(session.join_key);
    const id = await participantId(host, session.id);

    const other = await hostWithSession();
    expect(
      (await other.host.from("sessions").select().eq("id", session.id)).data
    ).toEqual([]);
    expect(
      (
        await other.host
          .from("session_participants")
          .select()
          .eq("session_id", session.id)
      ).data
    ).toEqual([]);
    expect((await decide(other.host, id, "admit")).error?.code).toBe("42501");
    for (const call of [
      other.host.rpc("end_session", { p_session: session.id }),
      other.host.rpc("replace_join_key", { p_session: session.id }),
      other.host.rpc("set_session_locked", {
        p_session: session.id,
        p_locked: true,
      }),
    ])
      expect((await call).error?.code).toBe("42501");

    const withoutMfa = await confirmedHost();
    expect(
      (await withoutMfa.host.rpc("create_session", { p_title: "No MFA" })).error
        ?.code
    ).toBe("42501");
    expect((await decide(withoutMfa.host, id, "admit")).error?.code).toBe(
      "42501"
    );

    const anonymous = client();
    expect((await decide(anonymous, id, "admit")).error?.code).toBe("42501");
    expect(
      (await anonymous.from("session_participants").select()).error?.code
    ).toBe("42501");
    expect(
      (await anonymous.rpc("create_session", { p_title: "Anon" })).error?.code
    ).toBe("42501");
  });

  test("a guest credential only works for its own session and reveals nobody else", async () => {
    const a = await hostWithSession();
    const b = await hostWithSession();
    const guestA = await guestJoins(a.session.join_key, "Guest A");
    await guestJoins(a.session.join_key, "Guest A");

    expect(await status(b.session.id, guestA.hash)).toEqual([]);
    expect(await status(a.session.id, "0".repeat(64))).toEqual([]);
    const own = await status(a.session.id, guestA.hash);
    expect(own).toHaveLength(1);
    expect(Object.keys(own[0]).sort()).toEqual([
      "display_name",
      "participant_state",
      "session_state",
      "session_title",
    ]);
    // A guest cannot read tables directly.
    expect((await client().from("sessions").select()).error?.code).toBe(
      "42501"
    );
    expect(
      (await client().rpc("session_for_join", { p_key: "f".repeat(32) })).data
    ).toEqual([]);
  });

  test("names, titles, decisions and the waiting limit are bounded", async () => {
    const { host, session } = await hostWithSession();
    for (const name of ["", "   ", " Leading", "x".repeat(61)])
      expect(
        (await guestJoins(session.join_key, name)).joined.error?.code
      ).toBe("23514");
    expect(
      (await host.rpc("create_session", { p_title: "x".repeat(121) })).error
        ?.code
    ).toBe("23514");
    await guestJoins(session.join_key);
    const id = await participantId(host, session.id);
    expect((await decide(host, id, "promote")).error?.code).toBe("22023");

    for (let i = 1; i < 100; i++)
      await guestJoins(session.join_key, `Guest ${i}`);
    expect((await guestJoins(session.join_key)).joined.error?.message).toBe(
      "lobby_full"
    );
  });
});
