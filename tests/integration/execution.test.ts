import { sql } from "../support/database";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  agenda,
  command,
  executionHost,
  readyVersion,
  snapshot,
} from "../support/execution";
import { client, confirmedHost } from "../support/hosts";
import { decide, guestJoins, participantId, status } from "../support/sessions";

describe("non-media session execution", { timeout: 60_000 }, () => {
  beforeEach(() =>
    sql(
      "insert into public.execution_capacity values(true,100,clock_timestamp()+interval '1 hour') on conflict(singleton) do update set max_live=100,valid_until=excluded.valid_until;"
    )
  );
  afterEach(() =>
    sql(
      "select public.close_execution(session_id,'manual') from public.session_execution where state<>'completed';"
    )
  );

  test("AC1/2: immutable ready selection, preparation retry, new draft isolation and unsupported agenda refusal", async () => {
    const x = await executionHost();
    const operation = randomUUID();
    const params = { p_version: x.version.id, p_operation: operation };
    const pair = await Promise.all([
      x.host.rpc("prepare_execution", params),
      x.host.rpc("prepare_execution", params),
    ]);
    expect(pair[0].error).toBeNull();
    expect(pair[1].data).toBe(pair[0].data);
    expect(await snapshot(x.host, x.sessionId)).toMatchObject({
      state: "ready",
      started_at: null,
      deadline: null,
      current: null,
    });
    const draft = await x.host.rpc("new_workshop_draft", {
      p_workshop: x.version.workshop,
    });
    expect(draft.error).toBeNull();
    expect(
      (
        await x.host.rpc("prepare_execution", {
          p_version: draft.data.id,
          p_operation: randomUUID(),
        })
      ).error?.message
    ).toBe("version_not_ready");
    expect(
      (
        await x.host.rpc("prepare_execution", {
          p_version: draft.data.id,
          p_operation: operation,
        })
      ).error?.message
    ).toBe("operation_reused");
    expect((await command(x.host, x.sessionId, 1, "start")).error).toBeNull();
    expect((await snapshot(x.host, x.sessionId)).version_number).toBe(1);
    expect(
      (
        await x.host.rpc("mark_workshop_ready", {
          p_version: draft.data.id,
          p_expected_revision: draft.data.revision,
        })
      ).error
    ).toBeNull();
    expect(
      (
        await x.host.rpc("duplicate_workshop", {
          p_workshop: x.version.workshop,
          p_operation: randomUUID(),
        })
      ).error
    ).toBeNull();
    expect((await snapshot(x.host, x.sessionId)).version_number).toBe(1);
    expect(
      sql(
        `select version_id from public.session_execution where session_id='${x.sessionId}';`
      )
    ).toBe(x.version.id);
    expect(
      (
        await x.host.rpc("prepare_execution", {
          p_version: randomUUID(),
          p_operation: randomUUID(),
        })
      ).error
    ).not.toBeNull();
    expect(() =>
      sql(
        `update public.session_execution set version_id='${draft.data.id}' where session_id='${x.sessionId}';`
      )
    ).toThrow(/execution_identity_frozen/);
    for (const group of [true, false]) {
      const content = agenda();
      if (group) content.activities[1].scope = "group";
      else content.activities[1].input = { activity: "a1", field: "f1" };
      const unsupported = await readyVersion(x.host, content);
      const result = await x.host.rpc("prepare_execution", {
        p_version: unsupported.id,
        p_operation: randomUUID(),
      });
      expect(result.error?.message).toBe("unsupported_agenda");
      expect(result.error?.details).toContain("Activity 2");
    }
    expect(
      (await command(x.host, x.session.id, 1, "start")).error?.message
    ).toBe("execution_unavailable");
  });

  test("AC3: racing starts enforce three per workspace, retries consume one slot, paused sessions count", async () => {
    const x = await executionHost();
    const sessions = [x.sessionId];
    for (let i = 0; i < 3; i++)
      sessions.push(
        (
          await x.host.rpc("prepare_execution", {
            p_version: x.version.id,
            p_operation: randomUUID(),
          })
        ).data
      );
    const results = await Promise.all(
      sessions.map((id) => command(x.host, id, 1, "start"))
    );
    expect(results.filter((result) => !result.error)).toHaveLength(3);
    expect(
      results.filter((result) => result.error?.message === "start_blocked")
    ).toHaveLength(1);
    const live = sessions.filter((_, i) => !results.at(i)!.error);
    const blocked = sessions.find((_, i) => results.at(i)!.error)!;
    expect((await command(x.host, live[0], 2, "pause")).error).toBeNull();
    expect((await command(x.host, blocked, 1, "start")).error?.message).toBe(
      "start_blocked"
    );
    await command(x.host, live[1], 2, "end");
    const operation = randomUUID();
    const attempts = await Promise.all([
      command(x.host, blocked, 1, "start", operation),
      command(x.host, blocked, 1, "start", operation),
    ]);
    expect(attempts[0].error).toBeNull();
    expect(attempts[1].data).toEqual(attempts[0].data);
    expect(
      sql(
        `select count(*) from public.session_execution e join public.sessions s on s.id=e.session_id where s.workspace_id='${x.workspace}' and e.state in ('live','paused');`
      )
    ).toBe("3");
    await command(x.host, live[0], 3, "end");
    const contenders: string[] = [];
    for (let i = 0; i < 2; i++)
      contenders.push(
        (
          await x.host.rpc("prepare_execution", {
            p_version: x.version.id,
            p_operation: randomUUID(),
          })
        ).data
      );
    const fromTwo = await Promise.all(
      contenders.map((id) => command(x.host, id, 1, "start"))
    );
    expect(fromTwo.filter((result) => !result.error)).toHaveLength(1);
    expect(
      fromTwo.filter((result) => result.error?.message === "start_blocked")
    ).toHaveLength(1);
  });

  test("AC3: shared global budget, stale budget and eligibility fail closed", async () => {
    const x = await executionHost();
    const y = await executionHost();
    sql("update public.execution_capacity set max_live=1;");
    const results = await Promise.all([
      command(x.host, x.sessionId, 1, "start"),
      command(y.host, y.sessionId, 1, "start"),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(
      results.filter((r) => r.error?.message === "start_blocked")
    ).toHaveLength(1);
    sql(
      "update public.execution_capacity set max_live=100,valid_until=clock_timestamp()-interval '1 second';"
    );
    const z = await executionHost();
    expect(
      (await command(z.host, z.sessionId, 1, "start")).error?.details
    ).toContain("capacity is unavailable");
    sql("delete from public.execution_capacity;");
    expect(
      (await command(z.host, z.sessionId, 1, "start")).error?.message
    ).toBe("start_blocked");
    sql(
      "insert into public.execution_capacity values(true,100,clock_timestamp()+interval '1 hour'); delete from public.execution_eligibility;"
    );
    expect(
      (await command(z.host, z.sessionId, 1, "start")).error?.details
    ).toContain("eligibility is unavailable");
    expect((await snapshot(z.host, z.sessionId)).started_at).toBeNull();
    sql(
      `insert into public.execution_eligibility values('${z.workspace}',clock_timestamp()-interval '1 second');`
    );
    expect(
      (await command(z.host, z.sessionId, 1, "start")).error?.details
    ).toContain("eligibility is unavailable");
  });

  test("AC4/5/6: pause, resume, previews, optimistic concurrency and durable operation receipts", async () => {
    const x = await executionHost();
    const op = randomUUID();
    expect(
      (await command(x.host, x.sessionId, 1, "start", op)).error
    ).toBeNull();
    const start = await snapshot(x.host, x.sessionId);
    expect(
      new Date(start.deadline).getTime() - new Date(start.started_at).getTime()
    ).toBe(4 * 60 * 60 * 1000);
    expect(
      (await x.host.rpc("end_session", { p_session: x.sessionId })).error
        ?.message
    ).toBe("use_execution_controls");
    const reads = await Promise.all([
      snapshot(x.host, x.sessionId),
      snapshot(x.host, x.sessionId),
    ]);
    expect(reads.map((r) => r.revision)).toEqual([2, 2]);
    const race = await Promise.all([
      command(x.host, x.sessionId, 2, "pause"),
      command(x.host, x.sessionId, 2, "next"),
    ]);
    expect(race.filter((r) => !r.error)).toHaveLength(1);
    expect(
      race.filter((r) => r.error?.message === "stale_execution")
    ).toHaveLength(1);
    let current = await snapshot(x.host, x.sessionId);
    if (current.state !== "paused") {
      await command(x.host, x.sessionId, current.revision, "pause");
      current = await snapshot(x.host, x.sessionId);
    }
    expect(
      (await command(x.host, x.sessionId, current.revision, "next")).error
        ?.message
    ).toBe("invalid_transition");
    const paused = (await snapshot(x.host, x.sessionId)).remaining_seconds;
    await new Promise((r) => setTimeout(r, 100));
    expect((await snapshot(x.host, x.sessionId)).remaining_seconds).toBe(
      paused
    );
    await command(x.host, x.sessionId, current.revision, "resume");
    expect((await snapshot(x.host, x.sessionId)).deadline).toBe(start.deadline);
    expect(
      (await command(x.host, x.sessionId, 1, "start", op)).data
    ).toMatchObject({ revision: 2, state: "live" });
    expect((await snapshot(x.host, x.sessionId)).revision).toBeGreaterThan(2);
    expect(
      (await command(x.host, x.sessionId, 1, "pause", op)).error?.message
    ).toBe("operation_reused");
    expect((await command(x.host, x.sessionId, 1, "skip")).error?.message).toBe(
      "invalid_command"
    );
    expect(() =>
      sql(
        `update public.session_execution set deadline=deadline+interval '1 hour' where session_id='${x.sessionId}';`
      )
    ).toThrow(/execution_identity_frozen/);
    sql(
      `update public.session_execution set activity_due_at=clock_timestamp()-interval '1 minute' where session_id='${x.sessionId}';`
    );
    const overdue = await snapshot(x.host, x.sessionId);
    expect(overdue.state).toBe("live");
    expect(overdue.remaining_seconds).toBeLessThan(0);
    expect(overdue.current.id).toBe(current.current.id);
  });

  test("AC7/8/9: deadline denial before sweep, old credential revocation and original retention clock", async () => {
    const x = await executionHost();
    const guest = await guestJoins(x.key);
    const person = await participantId(x.host, x.sessionId);
    await decide(x.host, person, "admit");
    await command(x.host, x.sessionId, 1, "start");
    const get = () =>
      client().rpc("guest_execution", {
        p_session: x.sessionId,
        p_credential_hash: guest.hash,
      });
    const view = await get();
    expect(view.data.current.id).toBe("a1");
    expect(view.data.next).toBeNull();
    expect(JSON.stringify(view.data)).not.toContain("Private task 2");
    // Privileged clock fixture changes both absolute values without a runtime override.
    sql(
      `alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=statement_timestamp()-interval '4 hours 1 second',deadline=statement_timestamp()-interval '1 second' where session_id='${x.sessionId}'; alter table public.session_execution enable trigger execution_identity_frozen;`
    );
    const expired = await snapshot(x.host, x.sessionId);
    expect(expired.state).toBe("completed");
    expect(expired.current).toBeNull();
    expect((await get()).data.current).toBeNull();
    expect((await guestJoins(x.key)).joined.error?.message).toBe(
      "session_ended"
    );
    expect((await decide(x.host, person, "remove")).error?.message).toBe(
      "session_ended"
    );
    const original = expired.ended_at;
    expect(sql("select public.expire_executions();")).toBe("1");
    expect(sql("select public.expire_executions();")).toBe("0");
    expect((await snapshot(x.host, x.sessionId)).ended_at).toBe(original);
    expect((await command(x.host, x.sessionId, 2, "resume")).data).toEqual({
      ended: true,
    });
    expect((await snapshot(x.host, x.sessionId)).ended_at).toBe(original);
    const returning = await guestJoins(x.key, "Returning synthetic", {
      returning: true,
    });
    const request = await participantId(x.host, x.sessionId);
    const [restored, racingRead] = await Promise.all([
      x.host.rpc("restore_participant", {
        p_request: request,
        p_target: person,
      }),
      get(),
    ]);
    expect(restored.error).toBeNull();
    // A read begun before rotation may finish; later reads must reject the old credential.
    expect(racingRead.error).toBeNull();
    expect(racingRead.data === null || racingRead.data.current === null).toBe(
      true
    );
    expect((await status(x.sessionId, guest.hash))[0].participant_state).toBe(
      "moved"
    );
    expect((await get()).data).toBeNull();
    expect(
      (
        await client().rpc("guest_execution", {
          p_session: x.sessionId,
          p_credential_hash: returning.hash,
        })
      ).data.state
    ).toBe("completed");
  });

  test("AC7: due boundary and a manual end waiting across the deadline keep the original end", async () => {
    const x = await executionHost();
    await command(x.host, x.sessionId, 1, "start");
    for (const [offset, expected] of [
      ["1 minute", "live"],
      ["0 seconds", "completed"],
      ["-1 second", "completed"],
    ]) {
      sql(
        `alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=statement_timestamp()+interval '${offset}'-interval '4 hours',deadline=statement_timestamp()+interval '${offset}' where session_id='${x.sessionId}'; alter table public.session_execution enable trigger execution_identity_frozen;`
      );
      expect((await snapshot(x.host, x.sessionId)).state).toBe(expected);
    }
    expect(sql("select public.expire_executions();")).toBe("1");
    const raced = await executionHost();
    await command(raced.host, raced.sessionId, 1, "start");
    sql(
      `alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=statement_timestamp()-interval '4 hours'+interval '3 seconds',deadline=statement_timestamp()+interval '3 seconds' where session_id='${raced.sessionId}'; alter table public.session_execution enable trigger execution_identity_frozen;`
    );
    const holder = spawn("docker", [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-q",
    ]);
    const acquired = new Promise<void>((resolve, reject) => {
      holder.stdout.on("data", (data: Buffer) => {
        if (data.toString().includes("SESSION_LOCKED")) resolve();
      });
      holder.once("error", reject);
      holder.once("exit", () =>
        reject(new Error("Session lock ended before acquisition"))
      );
    });
    const released = new Promise<number | null>((resolve) =>
      holder.once("exit", resolve)
    );
    holder.stdin.end(
      `begin; select id from public.sessions where id='${raced.sessionId}' for update; select 'SESSION_LOCKED'; select pg_sleep(4); commit;`
    );
    await acquired;
    expect((await snapshot(raced.host, raced.sessionId)).state).toBe("live");
    const ended = await command(raced.host, raced.sessionId, 2, "end");
    expect(await released).toBe(0);
    expect(ended.error).toBeNull();
    expect(ended.data).toEqual({ ended: true });
    const final = await snapshot(raced.host, raced.sessionId);
    expect(final.state).toBe("completed");
    expect(final.ended_at).toBe(final.deadline);
    expect(final.completed_count).toBe(0);
    expect(
      sql(
        `select end_reason from public.session_execution where session_id='${raced.sessionId}';`
      )
    ).toBe("deadline");
    expect(sql("select public.expire_executions();")).toBe("0");
    expect((await snapshot(raced.host, raced.sessionId)).ended_at).toBe(
      final.ended_at
    );
  });

  test("AC8/10/12: real permissions, legacy compatibility, no public capacity or sweep access", async () => {
    const x = await executionHost();
    const other = await executionHost();
    const low = await confirmedHost();
    for (const outsider of [client(), other.host, low.host]) {
      expect(
        (await outsider.rpc("host_execution", { p_session: x.sessionId })).error
      ).not.toBeNull();
      expect(
        (await command(outsider, x.sessionId, 1, "start")).error
      ).not.toBeNull();
      expect(
        (
          await outsider.rpc("prepare_execution", {
            p_version: x.version.id,
            p_operation: randomUUID(),
          })
        ).error
      ).not.toBeNull();
      expect((await outsider.rpc("expire_executions")).error).not.toBeNull();
      expect(
        (await outsider.from("execution_capacity").select()).error
      ).not.toBeNull();
    }
    const guest = await guestJoins(x.key);
    expect(
      (
        await client().rpc("guest_execution", {
          p_session: x.sessionId,
          p_credential_hash: guest.hash,
        })
      ).data
    ).toBeNull();
    const guestId = await participantId(x.host, x.sessionId);
    await decide(x.host, guestId, "deny");
    expect(
      (
        await client().rpc("guest_execution", {
          p_session: x.sessionId,
          p_credential_hash: guest.hash,
        })
      ).data
    ).toBeNull();
    const removed = await guestJoins(x.key, "Removed synthetic");
    const removedId = await participantId(x.host, x.sessionId);
    await decide(x.host, removedId, "admit");
    await decide(x.host, removedId, "remove");
    expect(
      (
        await client().rpc("guest_execution", {
          p_session: x.sessionId,
          p_credential_hash: removed.hash,
        })
      ).data
    ).toBeNull();
    expect(
      (
        await client().rpc("guest_execution", {
          p_session: other.sessionId,
          p_credential_hash: guest.hash,
        })
      ).data
    ).toBeNull();
    const legacy = x.session.id;
    expect(await snapshot(x.host, legacy)).toBeNull();
    expect(
      (await x.host.rpc("end_session", { p_session: legacy })).error
    ).toBeNull();
    const ended = (
      await x.host.from("sessions").select("ended_at").eq("id", legacy).single()
    ).data;
    await x.host.rpc("end_session", { p_session: legacy });
    expect(
      (
        await x.host
          .from("sessions")
          .select("ended_at")
          .eq("id", legacy)
          .single()
      ).data
    ).toEqual(ended);
    const op = randomUUID();
    await command(x.host, x.sessionId, 1, "start", op);
    const token = (await x.host.auth.getSession()).data.session!.access_token;
    await x.host.auth.signOut();
    expect(
      (await command(client(token), x.sessionId, 1, "start", op)).error?.code
    ).toBe("42501");
  });

  test("AC3/6: failure before receipt rolls back admission and a later retry commits once", async () => {
    const x = await executionHost();
    const op = randomUUID();
    sql(
      "create function public.synthetic_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic_receipt_failure'; end; $$; create trigger synthetic_receipt_failure before insert on public.execution_commands for each row execute function public.synthetic_receipt_failure();"
    );
    try {
      expect(
        (await command(x.host, x.sessionId, 1, "start", op)).error?.message
      ).toBe("synthetic_receipt_failure");
      expect(await snapshot(x.host, x.sessionId)).toMatchObject({
        state: "ready",
        started_at: null,
        revision: 1,
      });
      expect(
        sql(
          `select count(*) from public.execution_commands where operation_id='${op}';`
        )
      ).toBe("0");
    } finally {
      sql(
        "drop trigger synthetic_receipt_failure on public.execution_commands; drop function public.synthetic_receipt_failure();"
      );
    }
    const retry = await command(x.host, x.sessionId, 1, "start", op);
    expect(retry.error).toBeNull();
    expect((await command(x.host, x.sessionId, 1, "start", op)).data).toEqual(
      retry.data
    );
    expect(
      sql(
        `select count(*) from public.execution_commands where operation_id='${op}';`
      )
    ).toBe("1");
  });

  test("AC3/7: end/start races and deadline receipts never reopen or release twice", async () => {
    const x = await executionHost();
    const ids = [x.sessionId];
    for (let i = 0; i < 3; i++)
      ids.push(
        (
          await x.host.rpc("prepare_execution", {
            p_version: x.version.id,
            p_operation: randomUUID(),
          })
        ).data
      );
    await Promise.all(
      ids.slice(0, 3).map((id) => command(x.host, id, 1, "start"))
    );
    await Promise.all([
      command(x.host, ids[0], 2, "end"),
      command(x.host, ids[3], 1, "start"),
    ]);
    expect(
      Number(
        sql(
          `select count(*) from public.session_execution e join public.sessions s on s.id=e.session_id where s.workspace_id='${x.workspace}' and e.state in ('live','paused');`
        )
      )
    ).toBeLessThanOrEqual(3);
    const original = (await snapshot(x.host, ids[0])).ended_at;
    const op = randomUUID();
    expect((await command(x.host, ids[0], 2, "next", op)).data).toEqual({
      ended: true,
    });
    expect((await command(x.host, ids[0], 2, "pause", op)).error?.message).toBe(
      "operation_reused"
    );
    expect((await snapshot(x.host, ids[0])).ended_at).toBe(original);
    expect(
      (
        await x.host.rpc("set_session_locked", {
          p_session: ids[0],
          p_locked: false,
        })
      ).error?.message
    ).toBe("session_ended");
    expect(
      (await x.host.rpc("replace_join_key", { p_session: ids[0] })).error
        ?.message
    ).toBe("session_ended");
  });
});
