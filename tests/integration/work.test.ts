import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { beforeEach, describe, expect, test } from "vitest";
import { sql } from "../support/database";
import { command, snapshot } from "../support/execution";
import { client, confirmedHost } from "../support/hosts";
import { decide, guestJoins, participantId } from "../support/sessions";
import type { WorkSnapshot } from "../../lib/work";

import { workFixture as fixture } from "../support/work";

async function hold(statement: string) {
  const child = spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (data) => {
      if (String(data).includes("work-proof-locked")) resolve();
    });
    child.on("error", reject);
  });
  const done = new Promise<number | null>((resolve) =>
    child.on("exit", resolve)
  );
  child.stdin.end(
    `begin; ${statement}; select 'work-proof-locked'; select pg_sleep(2.5); commit;`
  );
  await locked;
  return { done };
}

describe("durable individual work", { timeout: 60_000 }, () => {
  beforeEach(() =>
    sql(
      "insert into public.execution_capacity values(true,1000,clock_timestamp()+interval '1 hour') on conflict(singleton) do update set max_live=1000,valid_until=excluded.valid_until;"
    )
  );

  test("AC1/2: stable scoped ownership, private author/host reads, denied alternate actors and direct table access", async () => {
    const x = await fixture();
    expect((await x.send()).error).toBeNull();
    expect((await x.read()).data.items[0]).toMatchObject({
      participant: x.person,
      revision: 1,
      content: x.request.content,
    });
    expect(
      (await x.read(x.guest.hash, x.host, true)).data.items[0].content
    ).toEqual(x.request.content);
    const peer = await guestJoins(x.key, "Peer");
    expect((await x.read(peer.hash)).error?.code).toBe("42501");
    const peerId = await participantId(x.host, x.session);
    await decide(x.host, peerId, "admit");
    expect(
      (await x.read(peer.hash)).data.items.every(
        (w: { participant: string }) => w.participant === peerId
      )
    ).toBe(true);
    expect(JSON.stringify((await x.read(peer.hash)).data)).not.toContain(
      "Synthetic explanation"
    );
    expect((await x.send(x.request, randomUUID(), peer.hash)).error?.code).toBe(
      "42501"
    );
    for (const patch of [
      { participant: randomUUID() },
      { participant: null },
      { group: randomUUID() },
      { owner: randomUUID() },
      { version: randomUUID() },
      { activity: "a2" },
    ])
      expect((await x.send({ ...x.request, ...patch })).error).not.toBeNull();
    const foreign = await confirmedHost();
    for (const as of [client(), foreign.host]) {
      expect((await x.read(x.guest.hash, as, true)).error?.code).toBe("42501");
      for (const table of [
        "work_items",
        "work_attempts",
        "work_commands",
        "work_partial_acceptances",
      ])
        expect((await as.from(table).select("*")).error).not.toBeNull();
    }
    expect(
      (await x.send(x.request, randomUUID(), "", x.host)).error?.code
    ).toBe("42501");
    await decide(x.host, x.person, "remove");
    expect((await x.read()).error?.code).toBe("42501");
    expect((await x.send()).error?.code).toBe("42501");
  });

  test("AC3: Unicode/code-point limits, normalization, malformed fields and incomplete validation", async () => {
    const x = await fixture();
    for (const content of [
      { f1: 2 },
      { alien: "value" },
      { f1: "\0" },
      { f1: "\ud800" },
      { f2: "😀".repeat(501) },
      { f1: "x".repeat(5001) },
    ])
      expect((await x.send({ ...x.request, content })).error).not.toBeNull();
    expect((await x.read()).data.items[0].revision).toBe(0);
    expect(
      (
        await x.send({
          ...x.request,
          content: { f2: "😀".repeat(500), f1: "first\r\nsecond" },
        })
      ).error
    ).toBeNull();
    expect((await x.read()).data.items[0].content.f1).toBe("first\nsecond");
    expect(
      (await x.send({ ...x.request, revision: 1, content: { f1: " \n\t" } }))
        .error
    ).toBeNull();
    expect((await x.send(x.submit(2))).error?.message).toBe("incomplete_work");
    expect(
      (
        await x.send({
          ...x.request,
          revision: 2,
          content: { f1: "\uFEFF", f2: "\u00A0" },
        })
      ).error
    ).toBeNull();
    expect((await x.send(x.submit(3))).error?.message).toBe("incomplete_work");
    expect(
      (await x.send({ ...x.submit(3), command: "submit_incomplete" })).error
        ?.message
    ).toBe("incomplete_work");
    expect(
      (await x.send({ ...x.request, reason: "x".repeat(262145) })).error
        ?.message
    ).not.toBeNull();
  });

  test("AC4/5: competing initial drafts, normalized duplicate receipts and old receipts after newer saves", async () => {
    const x = await fixture();
    const pair = await Promise.all([
      x.send(),
      x.send({ ...x.request, content: { f1: "Other" } }),
    ]);
    expect(pair.filter((r) => !r.error)).toHaveLength(1);
    expect(pair.find((r) => r.error)?.error?.message).toBe("work_conflict");
    const operation = randomUUID(),
      request = { ...x.request, revision: 1, content: { f1: "two\r\nlines" } };
    const duplicates = await Promise.all([
      x.send(request, operation),
      x.send(request, operation),
    ]);
    expect(duplicates[0].error).toBeNull();
    expect(duplicates[1].data).toEqual(duplicates[0].data);
    expect(
      (await x.send({ ...request, content: { f1: "two\nlines" } }, operation))
        .data
    ).toEqual(duplicates[0].data);
    expect(
      (await x.send({ ...request, content: { f1: "different" } }, operation))
        .error?.message
    ).toBe("operation_reused");
    await x.send({ ...x.request, revision: 2 });
    expect((await x.send(request, operation)).data.revision).toBe(2);
    expect((await x.read()).data.items[0].revision).toBe(3);
    await decide(x.host, x.person, "remove");
    expect((await x.send(request, operation)).error?.code).toBe("42501");
  });

  test("AC5/6: failure before receipt rolls back work; explicit immutable submissions and linear concurrent corrections", async () => {
    const x = await fixture(),
      operation = randomUUID();
    sql(
      `create function public.synthetic_work_failure() returns trigger language plpgsql as $$ begin if new.session_id='${x.session}' then raise exception 'synthetic_work_failure'; end if; return new; end $$; create trigger synthetic_work_failure before insert on public.work_commands for each row execute function public.synthetic_work_failure();`
    );
    try {
      expect((await x.send(x.request, operation)).error?.message).toBe(
        "synthetic_work_failure"
      );
      expect((await x.read()).data.items[0].revision).toBe(0);
    } finally {
      sql(
        "drop trigger synthetic_work_failure on public.work_commands; drop function public.synthetic_work_failure();"
      );
    }
    expect((await x.send(x.request, operation)).error).toBeNull();
    const submitId = randomUUID();
    const attempts = await Promise.all([
      x.send(x.submit(), submitId),
      x.send(x.submit(), submitId),
    ]);
    expect(attempts[0].error).toBeNull();
    expect(attempts[1].data).toEqual(attempts[0].data);
    const original = (await x.read()).data.items[0].attempts[0];
    expect(() =>
      sql(
        `update public.work_attempts set reason='changed' where id='${original.id}'`
      )
    ).toThrow(/submitted_version_frozen/);
    expect((await x.send(x.submit(0, 1, "Reason"))).error?.message).toBe(
      "work_conflict"
    );
    await x.send({
      ...x.request,
      revision: 1,
      content: { f1: "Corrected", f2: "Yes" },
    });
    expect((await x.send(x.submit(2, 1, "\uFEFF"))).error?.message).toBe(
      "invalid_work"
    );
    const corrections = await Promise.all([
      x.send(x.submit(2, 1, "Reconsidered")),
      x.send(x.submit(2, 1, "Competing")),
    ]);
    expect(corrections.filter((r) => !r.error)).toHaveLength(1);
    const stored = (await x.read()).data.items[0].attempts;
    expect(stored).toHaveLength(2);
    expect(stored[0]).toEqual(original);
    expect(stored[1].preceding_id).toBe(original.id);
    expect(stored[1].submitted_by).toBe(x.person);
    expect(() =>
      sql(
        `insert into public.work_attempts(session_id,participant_id,activity_id,submitted_by,ordinal,preceding_id,preceding_ordinal,draft_revision,content,missing,reason) select session_id,participant_id,activity_id,submitted_by,3,id,null,draft_revision,content,missing,'Invalid lineage' from public.work_attempts where id='${stored[1].id}'`
      )
    ).toThrow(/work_attempt_predecessor_required/);
  });

  test("AC7/8: exact partial acceptance, closed-write denial, scoped reopen and close revisions", async () => {
    const x = await fixture();
    await x.send({ ...x.request, content: { f1: "Partial" } });
    const incomplete = { ...x.submit(), command: "submit_incomplete" as const };
    expect((await x.send(incomplete)).error).toBeNull();
    const accept = {
      ...x.submit(1, 1, "Useful partial evidence"),
      command: "accept_partial" as const,
    };
    expect((await x.send(accept)).error?.code).toBe("42501");
    expect((await x.send(accept, randomUUID(), "", x.host)).error).toBeNull();
    expect((await x.read()).data.items[0].attempts[0].acceptance.reason).toBe(
      accept.reason
    );
    await command(x.host, x.session, 2, "next");
    expect((await x.send({ ...x.request, revision: 1 })).error?.message).toBe(
      "work_closed"
    );
    const reopen = {
      ...x.submit(1, 1, "Revise the earlier answer"),
      command: "reopen" as const,
    };
    expect((await x.send(reopen)).error?.code).toBe("42501");
    const before = await snapshot(x.host, x.session);
    expect((await x.send(reopen, randomUUID(), "", x.host)).error).toBeNull();
    expect((await x.send({ ...x.request, revision: 1 })).error?.message).toBe(
      "work_conflict"
    );
    expect(
      (await x.send({ ...x.request, revision: 1, window_revision: 1 })).error
    ).toBeNull();
    expect(
      (await x.send({ ...x.submit(2, 1, "Completed it"), window_revision: 1 }))
        .error
    ).toBeNull();
    const items = (await x.read()).data.items;
    expect(items[0].attempts[1].acceptance).toBeNull();
    expect(
      (
        await x.send(
          { ...accept, window_revision: 1 },
          randomUUID(),
          "",
          x.host
        )
      ).error?.message
    ).toBe("work_conflict");
    expect((await snapshot(x.host, x.session)).current).toEqual(before.current);
    expect((await snapshot(x.host, x.session)).deadline).toBe(before.deadline);
    expect(
      (
        await x.send(
          { ...reopen, command: "close", window_revision: 1 },
          randomUUID(),
          "",
          x.host
        )
      ).error
    ).toBeNull();
    expect(
      (await x.send({ ...x.request, revision: 2, window_revision: 2 })).error
        ?.message
    ).toBe("work_closed");
    await command(x.host, x.session, 3, "end");
    expect(
      (
        await x.send(
          { ...reopen, window_revision: 2 },
          randomUUID(),
          "",
          x.host
        )
      ).error?.message
    ).toBe("work_closed");
  });

  test("AC9/12: pause permits work; manual end preserves it read-only; delayed deadline and absolute retention enforced", async () => {
    const x = await fixture();
    await command(x.host, x.session, 2, "pause");
    const operation = randomUUID();
    expect((await x.send(x.request, operation)).error).toBeNull();
    await command(x.host, x.session, 3, "end");
    expect((await x.send({ ...x.request, revision: 1 })).error?.message).toBe(
      "work_closed"
    );
    expect((await x.send(x.request, operation)).data.revision).toBe(1);
    expect((await x.read()).data.items[0]).toMatchObject({
      writable: false,
      content: x.request.content,
    });
    sql(
      `update public.sessions set ended_at=clock_timestamp()-interval '90 days'+interval '1 minute' where id='${x.session}';`
    );
    expect((await x.read()).error).toBeNull();
    sql(
      `update public.sessions set ended_at=clock_timestamp()-interval '90 days' where id='${x.session}';`
    );
    expect((await x.read()).error?.code).toBe("42501");
    expect((await x.send(x.request, operation)).error?.code).toBe("42501");
    expect((await x.read("", x.host, true)).error?.code).toBe("42501");
  });

  test("AC9: a real session lock held across the deadline rejects a previously issued save", async () => {
    const x = await fixture();
    sql(`alter table public.session_execution disable trigger execution_identity_frozen;
      update public.session_execution set started_at=now()-interval '4 hours'+interval '2 seconds',deadline=now()+interval '2 seconds' where session_id='${x.session}';
      alter table public.session_execution enable trigger execution_identity_frozen;`);
    const locker = spawn(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "db",
        "psql",
        "-U",
        "postgres",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const locked = new Promise<void>((resolve, reject) => {
      locker.stdout.on("data", (data) => {
        if (String(data).includes("locked")) resolve();
      });
      locker.on("error", reject);
    });
    const done = new Promise<number | null>((resolve) =>
      locker.on("exit", resolve)
    );
    locker.stdin.end(
      `begin; select id from public.sessions where id='${x.session}' for update; select 'locked'; select pg_sleep(2.5); commit;`
    );
    await locked;
    expect((await x.send()).error?.message).toBe("work_closed");
    expect(await done).toBe(0);
    expect((await x.read()).data.items[0].revision).toBe(0);
  });

  test("AC10: verified recovery preserves owner and committed history, old-device commands/reads/replays denied", async () => {
    const x = await fixture(),
      operation = randomUUID();
    await x.send(x.request, operation);
    await x.send(x.submit());
    const original = (await x.read()).data as WorkSnapshot;
    const signed = await confirmedHost();
    const returning = await guestJoins(x.key, "Verified return", {
      returning: true,
      as: signed.host,
    });
    const request = await participantId(x.host, x.session);
    expect(
      (
        await x.host.rpc("restore_participant", {
          p_request: request,
          p_target: x.person,
        })
      ).error
    ).toBeNull();
    const restored = (await x.read(returning.hash)).data;
    expect(restored.items[0].participant).toBe(x.person);
    expect(restored.items[0].attempts).toEqual(original.items[0].attempts);
    expect((await x.read()).error?.code).toBe("42501");
    expect((await x.send(x.request, operation)).error?.code).toBe("42501");
    expect(
      (await x.send(x.request, operation, returning.hash)).data.revision
    ).toBe(1);
  });
  test("AC9/12: work-row and authorization lock waits cannot extend deadline or retention", async () => {
    const x = await fixture();
    await x.send();
    sql(`alter table public.session_execution disable trigger execution_identity_frozen;
      update public.session_execution set started_at=now()-interval '4 hours'+interval '2 seconds',deadline=now()+interval '2 seconds' where session_id='${x.session}';
      alter table public.session_execution enable trigger execution_identity_frozen;`);
    const writer = await hold(
      `select revision from public.work_items where session_id='${x.session}' for update`
    );
    expect((await x.send({ ...x.request, revision: 1 })).error?.message).toBe(
      "work_closed"
    );
    expect(await writer.done).toBe(0);
    expect((await x.read()).data.items[0].revision).toBe(1);
    sql(
      `update public.sessions set state='ended',ended_at=now()-interval '90 days'+interval '2 seconds' where id='${x.session}';`
    );
    const reader = await hold(
      `select id from public.workspaces where id='${x.workspace}' for update; select id from public.session_participants where id='${x.person}' for update`
    );
    const results = await Promise.all([x.read(), x.read("", x.host, true)]);
    expect(results.map((r) => r.error?.code)).toEqual(["42501", "42501"]);
    expect(await reader.done).toBe(0);
  });

  test("AC10: restore races pending old-device save/read and preserves whichever authorized commit won", async () => {
    const x = await fixture();
    await x.send();
    const returning = await guestJoins(x.key, "Returning", { returning: true });
    const request = await participantId(x.host, x.session);
    const locker = await hold(
      `select id from public.sessions where id='${x.session}' for update`
    );
    const restore = x.host.rpc("restore_participant", {
      p_request: request,
      p_target: x.person,
    });
    const [restored, saved, read] = await Promise.all([
      restore,
      x.send({
        ...x.request,
        revision: 1,
        content: { f1: "Racing authorized save", f2: "Yes" },
      }),
      x.read(),
    ]);
    expect(restored.error).toBeNull();
    expect(await locker.done).toBe(0);
    if (saved.error) expect(saved.error.code).toBe("42501");
    if (read.error) expect(read.error.code).toBe("42501");
    const current = (await x.read(returning.hash)).data.items[0];
    expect(current.revision).toBe(saved.error ? 1 : 2);
    expect((await x.read()).error?.code).toBe("42501");
    expect((await x.send()).error?.code).toBe("42501");
  });

  test("AC1/2/13: repeated agendas and legacy clients do not copy work; revoked host session cannot read", async () => {
    const x = await fixture();
    await x.send();
    await x.send(x.submit());
    const second = (
      await x.host.rpc("prepare_execution", {
        p_version: x.version.id,
        p_operation: randomUUID(),
      })
    ).data as string;
    const key = (
      await x.host.from("sessions").select("join_key").eq("id", second).single()
    ).data!.join_key;
    const guest = await guestJoins(key, "Same synthetic name");
    const person = await participantId(x.host, second);
    await decide(x.host, person, "admit");
    await command(x.host, second, 1, "start");
    const work = await client().rpc("read_work", {
      p_session: second,
      p_credential_hash: guest.hash,
    });
    expect(work.data.items[0]).toMatchObject({
      revision: 0,
      latest: 0,
      attempts: [],
    });
    expect(
      (await x.host.rpc("end_session", { p_session: x.session })).error?.message
    ).toBe("use_execution_controls");
    expect((await command(x.host, x.session, 2, "end")).error).toBeNull();
    expect((await x.send({ ...x.request, revision: 1 })).error?.message).toBe(
      "work_closed"
    );
    expect((await x.read()).data.items[0].attempts).toHaveLength(1);
    const token = (await x.host.auth.getSession()).data.session!.access_token;
    await x.host.auth.signOut();
    expect((await x.read("", client(token), true)).error?.code).toBe("42501");
  });
  test("AC8/9: closing corrections or ending races a submission without losing a winning commit", async () => {
    const x = await fixture();
    await x.send();
    await command(x.host, x.session, 2, "next");
    const reopen = {
      ...x.submit(1, 0, "Allow correction"),
      command: "reopen",
      window_revision: 0,
    };
    expect((await x.send(reopen, randomUUID(), "", x.host)).error).toBeNull();
    const [closed, submitted] = await Promise.all([
      x.send(
        { ...reopen, command: "close", window_revision: 1 },
        randomUUID(),
        "",
        x.host
      ),
      x.send({ ...x.submit(), window_revision: 1 }),
    ]);
    expect(closed.error).toBeNull();
    if (submitted.error) expect(submitted.error.message).toBe("work_conflict");
    const item = (await x.read()).data.items[0];
    expect(item.writable).toBe(false);
    expect(item.attempts).toHaveLength(submitted.error ? 0 : 1);
    const y = await fixture();
    await y.send();
    const [ended, attempt] = await Promise.all([
      command(y.host, y.session, 2, "end"),
      y.send(y.submit()),
    ]);
    expect(ended.error).toBeNull();
    if (attempt.error) expect(attempt.error.message).toBe("work_closed");
    expect((await y.read()).data.items[0].attempts).toHaveLength(
      attempt.error ? 0 : 1
    );
  });
  test("AC2: host absolute Auth expiry during a lock wait denies reads and partial acceptance", async () => {
    const x = await fixture();
    await x.send({ ...x.request, content: { f1: "Incomplete" } });
    await x.send({ ...x.submit(), command: "submit_incomplete" });
    const access = (await x.host.auth.getSession()).data.session!.access_token;
    const sessionId = JSON.parse(
      Buffer.from(access.split(".")[1], "base64url").toString()
    ).session_id;
    sql(
      `update auth.sessions set not_after=now()+interval '2 seconds' where id='${sessionId}';`
    );
    const locker = await hold(
      `select id from public.sessions where id='${x.session}' for update`
    );
    const results = await Promise.all([
      x.read("", x.host, true),
      x.send(
        { ...x.submit(1, 1, "Reviewed"), command: "accept_partial" },
        randomUUID(),
        "",
        x.host
      ),
    ]);
    expect(results.map((r) => r.error?.code)).toEqual(["42501", "42501"]);
    expect(await locker.done).toBe(0);
    expect((await x.read()).data.items[0].attempts[0].acceptance).toBeNull();
  });
});
