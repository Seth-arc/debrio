import type { SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { client, confirmedHost } from "../support/hosts";
import { SYNTHETIC_PASSWORD } from "../support/local-auth";
import {
  decide,
  guestJoins,
  hostWithSession,
  participantId,
  type Session,
  status,
} from "../support/sessions";

type Person = {
  id: string;
  display_name: string;
  state: string;
  is_return: boolean;
  account_email: string | null;
};

const people = async (host: SupabaseClient, sessionId: string) =>
  (await host.rpc("session_people", { p_session: sessionId })).data as Person[];

const restore = (host: SupabaseClient, request: string, target: string) =>
  host.rpc("restore_participant", { p_request: request, p_target: target });

async function admittedGuest(
  host: SupabaseClient,
  session: Session,
  name: string
) {
  const guest = await guestJoins(session.join_key, name);
  const id = await participantId(host, session.id);
  expect((await decide(host, id, "admit")).error).toBeNull();
  return { ...guest, id };
}

// Simulates time passing after the session ended, in the disposable database only.
function endedDaysAgo(sessionId: string, days: number) {
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  const result = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: `update public.sessions set ended_at = now() - interval '${days} days' where id = '${sessionId}';`,
      encoding: "utf8",
    }
  );
  expect(result.status).toBe(0);
}

async function returning(host: SupabaseClient, session: Session, name: string) {
  const guest = await guestJoins(session.join_key, name, { returning: true });
  expect(guest.joined.error).toBeNull();
  return { ...guest, id: await participantId(host, session.id) };
}

describe("guest recovery", { timeout: 60_000 }, () => {
  test("a restore moves the identity to the new device and retires the old one", async () => {
    const { host, session } = await hostWithSession();
    const ada = await admittedGuest(host, session, "Ada");
    const back = await returning(host, session, "Ada (new laptop)");
    expect((await status(session.id, back.hash))[0].participant_state).toBe(
      "waiting"
    );
    const listed = await people(host, session.id);
    expect(listed.find(({ id }) => id === back.id)).toMatchObject({
      is_return: true,
      state: "waiting",
    });

    const restored = await restore(host, back.id, ada.id);
    expect(restored.error).toBeNull();
    expect(restored.data).toMatchObject({ id: ada.id, state: "admitted" });
    // The new device now holds the original identity, with its original name.
    expect((await status(session.id, back.hash))[0]).toMatchObject({
      participant_state: "admitted",
      display_name: "Ada",
    });
    expect((await status(session.id, ada.hash))[0].participant_state).toBe(
      "moved"
    );
    const after = await people(host, session.id);
    expect(after.find(({ id }) => id === back.id)?.state).toBe("restored");
    expect(after.filter(({ state }) => state === "admitted")).toHaveLength(1);
    // A used request cannot be restored again.
    expect((await restore(host, back.id, ada.id)).error?.message).toBe(
      "not_a_return_request"
    );
  });

  test("returning people may ask while the lobby is closed and after the session ends; new people may not", async () => {
    const { host, session } = await hostWithSession();
    const ada = await admittedGuest(host, session, "Ada");
    await host.rpc("set_session_locked", {
      p_session: session.id,
      p_locked: true,
    });
    expect(
      (await guestJoins(session.join_key, "New")).joined.error?.message
    ).toBe("session_locked");
    const whileClosed = await returning(host, session, "Ada");
    expect((await restore(host, whileClosed.id, ada.id)).error).toBeNull();

    await host.rpc("end_session", { p_session: session.id });
    expect(
      (await guestJoins(session.join_key, "New")).joined.error?.message
    ).toBe("session_ended");
    const afterEnd = await returning(host, session, "Ada again");
    // After the end, a returning request can be restored or denied, never admitted as new.
    expect((await decide(host, afterEnd.id, "admit")).error?.message).toBe(
      "session_ended"
    );
    expect((await restore(host, afterEnd.id, ada.id)).error).toBeNull();
    expect((await status(session.id, afterEnd.hash))[0]).toMatchObject({
      participant_state: "admitted",
      session_state: "ended",
    });
    const declined = await returning(host, session, "Someone else");
    expect((await decide(host, declined.id, "deny")).data?.state).toBe(
      "denied"
    );
  });

  test("restores are refused into the wrong identity or for the wrong caller", async () => {
    const { host, session, email } = await hostWithSession();
    const removed = await admittedGuest(host, session, "Removed");
    await decide(host, removed.id, "remove");
    const back = await returning(host, session, "Removed");
    const intoRemoved = await restore(host, back.id, removed.id);
    expect(intoRemoved.error?.message).toBe("cannot_restore_into");
    expect(intoRemoved.error?.details).toBe("removed");

    const ordinary = await guestJoins(session.join_key, "Not returning");
    const ordinaryId = await participantId(host, session.id);
    const kept = await admittedGuest(host, session, "Kept");
    expect((await restore(host, ordinaryId, kept.id)).error?.message).toBe(
      "not_a_return_request"
    );
    expect(ordinary.joined.error).toBeNull();

    const other = await hostWithSession();
    const elsewhere = await admittedGuest(
      other.host,
      other.session,
      "Elsewhere"
    );
    expect((await restore(host, back.id, elsewhere.id)).error?.code).toBe(
      "42501"
    );
    expect((await restore(other.host, back.id, kept.id)).error?.code).toBe(
      "42501"
    );
    expect(
      (await other.host.rpc("session_people", { p_session: session.id })).error
        ?.code
    ).toBe("42501");

    const passwordOnly = client();
    await passwordOnly.auth.signInWithPassword({
      email,
      password: SYNTHETIC_PASSWORD,
    });
    expect((await restore(passwordOnly, back.id, kept.id)).error?.code).toBe(
      "42501"
    );
    expect((await restore(client(), back.id, kept.id)).error?.code).toBe(
      "42501"
    );
  });

  test("two restores into one identity at once leave exactly one live device", async () => {
    const { host, session } = await hostWithSession();
    const ada = await admittedGuest(host, session, "Ada");
    const first = await returning(host, session, "Ada phone");
    const second = await returning(host, session, "Ada tablet");
    const results = await Promise.all([
      restore(host, first.id, ada.id),
      restore(host, second.id, ada.id),
    ]);
    for (const { error } of results) expect(error).toBeNull();
    const states = await Promise.all(
      [ada, first, second].map(
        async ({ hash }) =>
          (await status(session.id, hash))[0].participant_state
      )
    );
    expect(states.filter((state) => state === "admitted")).toHaveLength(1);
    expect(states.filter((state) => state === "moved")).toHaveLength(2);
  });

  test("joining signed in links the account as evidence but grants nothing", async () => {
    const { host, session } = await hostWithSession();
    const participant = await confirmedHost();
    const signedIn = await guestJoins(session.join_key, "Signed-in Sam", {
      as: participant.host,
    });
    expect(signedIn.joined.error).toBeNull();
    await guestJoins(session.join_key, "Guest Gil");

    const listed = await people(host, session.id);
    expect(
      listed.find(({ display_name }) => display_name === "Signed-in Sam")
    ).toMatchObject({ state: "waiting", account_email: participant.email });
    expect(
      listed.find(({ display_name }) => display_name === "Guest Gil")
        ?.account_email
    ).toBeNull();
    // The linked account gains no access to the session or its people.
    expect(
      (
        await participant.host
          .from("sessions")
          .select("id")
          .eq("id", session.id)
      ).data
    ).toEqual([]);
    expect(
      (await participant.host.rpc("session_people", { p_session: session.id }))
        .error?.code
    ).toBe("42501");
  });

  test("an old device polling during a restore only ever sees its place or that it moved", async () => {
    const { host, session } = await hostWithSession();
    const ada = await admittedGuest(host, session, "Ada");
    const back = await returning(host, session, "Ada again");
    const polls = Array.from({ length: 20 }, () =>
      status(session.id, ada.hash)
    );
    const [restored, ...seen] = await Promise.all([
      restore(host, back.id, ada.id),
      ...polls,
    ]);
    expect(restored.error).toBeNull();
    for (const rows of seen) {
      expect(rows).toHaveLength(1);
      expect(["admitted", "moved"]).toContain(rows[0].participant_state);
    }
    expect((await status(session.id, ada.hash))[0].participant_state).toBe(
      "moved"
    );
  });

  test("requests need a fresh credential, and hosts never see account IDs", async () => {
    const { host, session } = await hostWithSession();
    const missing = await client().rpc("request_admission", {
      p_key: session.join_key,
      p_display_name: "No credential",
      p_credential_hash: null,
    });
    expect(missing.error?.message).toBe("invalid_credential");

    const ada = await admittedGuest(host, session, "Ada");
    const back = await returning(host, session, "Ada again");
    await restore(host, back.id, ada.id);
    // The old device cannot reuse its retired credential to ask again.
    const reused = await client().rpc("request_admission", {
      p_key: session.join_key,
      p_display_name: "Old device",
      p_credential_hash: ada.hash,
      p_returning: true,
    });
    expect(reused.error?.message).toBe("invalid_credential");

    const accountRead = await host
      .from("session_participants")
      .select("account_id")
      .eq("session_id", session.id);
    expect(accountRead.error?.code).toBe("42501");
  });

  test("ending a session turns away new people still waiting", async () => {
    const { host, session } = await hostWithSession();
    const waiting = await guestJoins(session.join_key, "Still waiting");
    await host.rpc("end_session", { p_session: session.id });
    expect((await status(session.id, waiting.hash))[0]).toMatchObject({
      participant_state: "denied",
      session_state: "ended",
    });
    expect(
      (await people(host, session.id)).filter(
        ({ state }) => state === "waiting"
      )
    ).toEqual([]);
  });

  test("after the 90-day review window nothing answers and nothing can be restored", async () => {
    const { host, session } = await hostWithSession();
    const ada = await admittedGuest(host, session, "Ada");
    const back = await returning(host, session, "Ada again");
    await restore(host, back.id, ada.id);
    const pending = await returning(host, session, "Ada later");
    await host.rpc("end_session", { p_session: session.id });

    endedDaysAgo(session.id, 89);
    expect(await status(session.id, back.hash)).toHaveLength(1);
    endedDaysAgo(session.id, 91);
    expect(await status(session.id, back.hash)).toEqual([]);
    expect(await status(session.id, ada.hash)).toEqual([]);
    expect(
      (await guestJoins(session.join_key, "Too late", { returning: true }))
        .joined.error?.message
    ).toBe("session_ended");
    expect((await restore(host, pending.id, ada.id)).error?.message).toBe(
      "session_ended"
    );
    expect((await decide(host, pending.id, "deny")).error?.message).toBe(
      "session_ended"
    );
  });
});
