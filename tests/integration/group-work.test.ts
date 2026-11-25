import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";
import { groupWorkFixture } from "../support/group-work";
import { holdTransaction, sql } from "../support/database";
import { client, ownerWithMfa } from "../support/hosts";
import { SYNTHETIC_PASSWORD } from "../support/local-auth";
import { command } from "../support/execution";
import { spawn } from "node:child_process";
import { decide, guestJoins, participantId } from "../support/sessions";
import { groupPlan } from "../../lib/groups";

async function hold(statement: string, seconds = 2.5) {
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
    child.stdout.on("data", (d) => {
      if (String(d).includes("group-work-locked")) resolve();
    });
    child.on("error", reject);
  });
  const done = new Promise<number | null>((resolve) =>
    child.on("exit", resolve)
  );
  child.stdin.end(
    `begin; ${statement}; select 'group-work-locked'; select pg_sleep(${seconds}); commit;`
  );
  await locked;
  return { done };
}

describe("durable group Evidence", { timeout: 60000 }, () => {
  afterAll(() => sql("update public.group_work_capability set enabled=false;"));
  test("AC2/14: compatible entry requires readiness; legacy protocol and rollback cannot enter", async () => {
    const x = await groupWorkFixture(false);
    expect((await x.read(0)).current).toBeNull();
    expect(
      (await command(x.host, x.sessionId, 1, "start")).error?.message
    ).toBe("unsupported_agenda");
    const stale = (await x.read()).context;
    expect((await x.recorder(null)).error).toBeNull();
    expect((await x.execute("start", stale)).error?.message).toBe(
      "stale_execution"
    );
    expect((await x.execute("start")).error?.message).toBe(
      "unsupported_agenda"
    );
    expect((await x.recorder(0)).error).toBeNull();
    expect((await x.move(2, null)).error).toBeNull();
    expect((await x.execute("start")).error?.message).toBe(
      "unsupported_agenda"
    );
    expect((await x.move(2, x.groups[0])).error).toBeNull();
    sql("update public.group_work_capability set enabled=false;");
    expect((await x.execute("start")).error?.message).toBe(
      "unsupported_agenda"
    );
    sql("update public.group_work_capability set enabled=true;");
    expect((await x.execute("start")).error).toBeNull();
    const legacy = await client().rpc("read_work", {
      p_session: x.sessionId,
      p_credential_hash: x.people[0].hash,
    });
    expect(legacy.error).toBeNull();
    expect(legacy.data.items).toEqual([]);
  });
  test("AC3/6/11: independent contribution slots, answer authority, stale preview and exact retry", async () => {
    const x = await groupWorkFixture();
    const a = await x.request("contribute", {
      field: "f1",
      revision: 0,
      value: "First\r\ncontribution",
    });
    const b = await x.request(
      "contribute",
      { field: "f1", revision: 0, value: "Second" },
      1
    );
    const outcomes = await Promise.all([x.send(a), x.send(b, 1)]);
    for (const r of outcomes) expect(r.error).toBeNull();
    expect((await x.send(a)).error?.message).toBe("group_work_conflict");
    expect(
      (
        await x.send(
          await x.request(
            "answer",
            { revision: 0, content: { f1: "Forged", f2: "x" }, sources: {} },
            1
          ),
          1
        )
      ).error?.message
    ).toBe("not_allowed");
    await x.save();
    const preview = await x.request("submit");
    expect(
      (
        await x.send(
          await x.request(
            "contribute",
            { field: "f2", revision: 0, value: "Later" },
            1
          ),
          1
        )
      ).error
    ).toBeNull();
    expect((await x.send(preview)).error?.message).toBe("group_work_conflict");
    const fresh = await x.request("submit"),
      op = randomUUID();
    const [one, two] = await Promise.all([
      x.send(fresh, 0, op),
      x.send(fresh, 0, op),
    ]);
    expect(one.error).toBeNull();
    expect(two.data).toEqual(one.data);
    expect(
      (await x.send({ ...fresh, reason: "Changed" }, 0, op)).error?.message
    ).toBe("operation_reused");
    const item = (await x.draft()).item;
    expect(item.attempts).toHaveLength(1);
    expect(
      item.attempts[0].snapshot.roster.map((p) => p.participant).sort()
    ).toEqual(x.people.map((p) => p.id).sort());
    expect(item.attempts[0].snapshot.contributions).toHaveLength(3);
    expect(
      item.attempts[0].snapshot.contributions.find(
        (c) => c.author_id === x.people[0].id
      )?.content
    ).toBe("First\ncontribution");
  });
  test("AC7/8: retained and reset lineage controls only future snapshot audience", async () => {
    const x = await groupWorkFixture();
    expect(
      (
        await x.send(
          await x.request(
            "contribute",
            { field: "f1", revision: 0, value: "Source" },
            1
          ),
          1
        )
      ).error
    ).toBeNull();
    const source = (await x.draft()).item.contributions[0];
    expect(
      (
        await x.send(
          await x.request("answer", {
            revision: 0,
            content: { f1: "Source", f2: "Short" },
            sources: { f1: [source.id] },
          })
        )
      ).error
    ).toBeNull();
    expect(
      (
        await x.send(
          await x.request(
            "contribute",
            { field: "f1", revision: 1, value: "" },
            1
          ),
          1
        )
      ).error
    ).toBeNull();
    expect((await x.move(1, x.groups[1])).error).toBeNull();
    expect((await x.read(1)).items).toHaveLength(1); // Only their newly assigned current group draft.
    expect((await x.send(await x.request("submit"))).error).toBeNull();
    const first = (await x.read(1)).items.find((i) => i.group === x.groups[0])!;
    expect(first.draft_access).toBe(false);
    expect(first.attempts[0].snapshot.sources[0].content).toBe("Source");
    await x.save("Source edited");
    expect(
      (await x.send(await x.request("submit", { reason: "Edit" }))).error
    ).toBeNull();
    expect(
      (await x.read(1)).items.find((i) => i.group === x.groups[0])!.attempts
    ).toHaveLength(2);
    const { item } = await x.draft();
    expect(
      (
        await x.send(
          await x.request("replace_field", {
            revision: item.revision,
            field: "f1",
            value: "Replacement",
            sources: {},
            reason: "New synthesis without earlier source",
          })
        )
      ).error
    ).toBeNull();
    expect(
      (await x.send(await x.request("submit", { reason: "Replace" }))).error
    ).toBeNull();
    expect(
      (await x.read(1)).items.find((i) => i.group === x.groups[0])!.attempts
    ).toHaveLength(2);
    expect((await x.draft()).item.attempts).toHaveLength(3);
  });
  test("AC4/8/10: replacement clears on move; closed drafts require explicit interval-scoped correction grants", async () => {
    const x = await groupWorkFixture();
    await x.save();
    expect((await x.recorder(1)).error).toBeNull();
    expect((await x.send(await x.request("submit"))).error?.message).toBe(
      "not_allowed"
    );
    expect((await x.execute("next")).error).toBeNull();
    expect((await x.move(2, x.groups[1])).error).toBeNull();
    expect((await x.move(2, x.groups[0])).error).toBeNull();
    expect((await x.read(2)).items).toEqual([]);
    expect(
      (
        await x.send(
          await x.request("reopen", {
            audience: [x.people[1].id],
            baseline: null,
            reason: "Finish draft",
          }),
          null
        )
      ).error
    ).toBeNull();
    expect((await x.draft(0)).item.writable).toBe(false);
    expect((await x.draft(1)).item.writable).toBe(true);
    expect((await x.read(2)).items).toEqual([]);
    expect(
      (await x.send(await x.request("submit", {}, 1), 1)).error
    ).toBeNull();
    const attempt = (await x.draft()).item.attempts[0];
    expect(attempt.ordinal).toBe(1);
    expect(attempt.preceding_id).toBeNull();
    expect((await x.read(2)).items[0].draft_access).toBe(false);
    expect((await x.move(1, x.groups[1])).error).toBeNull();
    expect(
      (await x.read()).coordination!.recorders.find(
        (r) => r.group === x.groups[0]
      )!.recorder
    ).toBeNull();
    expect((await x.move(1, x.groups[0])).error).toBeNull();
    expect((await x.read(1)).items[0].draft_access).toBe(false);
  });
  test("AC1/3: XOR owner, frozen identity, scoped fields, recorder submitter and Unicode limits", async () => {
    const x = await groupWorkFixture();
    for (const values of [
      "null,null",
      `'${x.people[0].id}','${x.groups[0]}'`,
    ]) {
      expect(() =>
        sql(
          `insert into public.work_items(session_id,participant_id,group_id,activity_id,version_id) values('${x.sessionId}',${values},'a2','${x.version.id}');`
        )
      ).toThrow();
    }
    expect(() =>
      sql(
        `update public.work_items set group_id='${x.groups[1]}' where session_id='${x.sessionId}';`
      )
    ).toThrow(/work_owner_frozen/);
    expect(() =>
      sql(
        `insert into public.work_items(session_id,group_id,activity_id,version_id) values('${x.sessionId}','${x.groups[1]}','a2','${x.version.id}');`
      )
    ).toThrow(/invalid_group_work/);
    for (const extra of [
      { field: "unknown", value: "x" },
      { field: "f2", value: "x".repeat(501) },
      { field: "f1", value: "x".repeat(5001) },
    ]) {
      expect(
        (await x.send(await x.request("contribute", { revision: 0, ...extra })))
          .error?.message
      ).toBe("invalid_group_work");
    }
    const valid = await x.request("contribute", {
      revision: 0,
      field: "f2",
      value: "😀".repeat(500),
    });
    expect((await x.send(valid)).error).toBeNull();
    expect(
      (await x.send({ ...valid, author: x.people[1].id } as typeof valid)).error
        ?.message
    ).toBe("invalid_group_work");
    expect(
      (
        await x.send(
          await x.request("answer", {
            revision: 0,
            content: { f1: "Host forged" },
            sources: {},
          }),
          null
        )
      ).error?.message
    ).toBe("not_allowed");
    await x.save();
    expect(() =>
      sql(
        `insert into public.work_attempts(session_id,group_id,activity_id,submitted_by,ordinal,draft_revision,content,missing,reason,snapshot,audience) values('${x.sessionId}','${x.groups[0]}','a1','${x.people[1].id}',1,1,'{}','{}','','{}','{}');`
      )
    ).toThrow(/not_allowed/);
    expect((await x.send(await x.request("submit"))).error).toBeNull();
    const first = (await x.draft()).item.attempts[0];
    expect((await x.move(2, x.groups[1])).error).toBeNull();
    expect((await x.recorder(2, x.groups[1])).error).toBeNull();
    expect(() =>
      sql(
        `insert into public.work_attempts(session_id,group_id,activity_id,submitted_by,ordinal,preceding_id,preceding_ordinal,draft_revision,content,missing,reason,snapshot,audience) values('${x.sessionId}','${x.groups[1]}','a1','${x.people[2].id}',2,'${first.id}',1,1,'{}','{}','Foreign predecessor','{}','{}');`
      )
    ).toThrow(/foreign key constraint/);
    expect(
      (await client().from("group_contribution_versions").select()).error
    ).not.toBeNull();
  });
  test("AC2/4/8: empty active groups recover exact drafts, recorder roles clear and legacy removal revokes", async () => {
    const x = await groupWorkFixture();
    await x.save("Retain through empty group");
    const before = (await x.draft()).item;
    for (let i = 0; i < 3; i++)
      expect((await x.move(i, null)).error).toBeNull();
    expect((await x.read(0)).items).toEqual([]);
    expect(
      (await x.read()).coordination!.recorders.find(
        (r) => r.group === x.groups[0]
      )!.recorder
    ).toBeNull();
    expect((await x.move(0, x.groups[0])).error).toBeNull();
    expect((await x.draft(0)).item.content).toEqual(before.content);
    expect((await x.draft(0)).item.revision).toBe(before.revision);
    expect((await x.recorder(0)).error).toBeNull();
    expect((await decide(x.host, x.people[0].id, "remove")).error).toBeNull();
    expect(
      (
        await client().rpc("read_group_work", {
          p_session: x.sessionId,
          p_credential_hash: x.people[0].hash,
        })
      ).error?.code
    ).toBe("42501");
    expect(
      (await x.read()).coordination!.recorders.find(
        (r) => r.group === x.groups[0]
      )!.recorder
    ).toBeNull();
  });
  test("AC7/8: no unauthorized predecessor status or cross-group coordination in snapshots", async () => {
    const x = await groupWorkFixture();
    expect((await x.move(2, x.groups[1])).error).toBeNull();
    const virgin = (await x.draft(2, x.groups[1])).item.predecessor;
    expect((await x.recorder(2, x.groups[1])).error).toBeNull();
    await x.save();
    expect((await x.send(await x.request("submit"))).error).toBeNull();
    const attempt = (await x.draft()).item.attempts[0];
    expect(JSON.stringify(attempt.snapshot.context)).not.toContain(
      x.people[2].id
    );
    expect(JSON.stringify(attempt.snapshot.context)).not.toContain(x.groups[1]);
    expect((await x.move(2, x.groups[0])).error).toBeNull();
    const joined = (await x.draft(2)).item;
    expect(joined.attempts).toEqual([]);
    expect(joined.predecessor).toEqual(virgin);
    expect(joined).not.toHaveProperty("latest");
    expect(
      (
        await x.send(
          await x.request("answer", {
            revision: joined.revision,
            content: { f1: "Forged", f2: "Yes" },
            sources: { f1: [randomUUID()] },
          })
        )
      ).error?.message
    ).toBe("invalid_group_work");
  });
  test("AC6/10/11: incomplete validation, immutable exact partial acceptance and linear corrections", async () => {
    const x = await groupWorkFixture();
    expect((await x.send(await x.request("submit"))).error?.message).toBe(
      "incomplete_work"
    );
    expect(
      (
        await x.send(
          await x.request("answer", {
            revision: 0,
            content: { f1: "Partial" },
            sources: {},
          })
        )
      ).error
    ).toBeNull();
    expect((await x.send(await x.request("submit"))).error?.message).toBe(
      "incomplete_work"
    );
    expect(
      (await x.send(await x.request("submit_incomplete"))).error?.message
    ).toBe("invalid_group_work");
    expect(
      (
        await x.send(
          await x.request("submit_incomplete", {
            reason: "Evidence available so far",
          })
        )
      ).error
    ).toBeNull();
    expect(
      (
        await x.send(
          await x.request("accept_partial", { reason: "Useful partial work" }),
          null
        )
      ).error
    ).toBeNull();
    const original = (await x.draft()).item.attempts[0];
    await x.save("Complete correction");
    const correction = await x.request("submit", { reason: "Finished" });
    const results = await Promise.all([x.send(correction), x.send(correction)]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    const attempts = (await x.draft()).item.attempts;
    expect(attempts[0]).toEqual(original);
    expect(attempts[1].acceptance).toBeNull();
    expect(attempts[1].preceding_id).toBe(original.id);
    expect(() =>
      sql(
        `update public.work_attempts set content='{}' where id='${original.id}';`
      )
    ).toThrow(/submitted_version_frozen/);
    expect(() =>
      sql(
        `update public.group_answer_versions set content='{}' where session_id='${x.sessionId}';`
      )
    ).toThrow(/submitted_version_frozen/);
  });
  test("AC9: recorder replacement and membership changes racing submission have one valid serialization", async () => {
    for (const change of ["recorder", "move", "remove"] as const) {
      const x = await groupWorkFixture();
      await x.save();
      const preview = await x.request("submit");
      const lock = await hold(
        `select id from public.sessions where id='${x.sessionId}' for update`
      );
      const results = await Promise.all([
        x.send(preview),
        change === "recorder"
          ? x.recorder(1)
          : change === "move"
            ? x.move(2, x.groups[1])
            : decide(x.host, x.people[2].id, "remove"),
      ]);
      expect(await lock.done).toBe(0);
      expect(results[1].error).toBeNull();
      if (results[0].error)
        expect(["group_work_conflict", "not_allowed"]).toContain(
          results[0].error.message
        );
      const attempts = (await x.draft()).item.attempts;
      expect(attempts).toHaveLength(results[0].error ? 0 : 1);
      if (attempts[0]) {
        expect(attempts[0].submitted_by).toBe(x.people[0].id);
        expect(attempts[0].snapshot.roster.map((p) => p.participant)).toContain(
          x.people[2].id
        );
      }
      expect((await x.draft()).item.content.f1).toBe("Consolidated");
    }
  });
  test("AC9/11/12: recovery races contribution save and retires old-device receipts without changing recorder", async () => {
    const x = await groupWorkFixture();
    await x.save();
    const original = (await x.draft()).item;
    const returning = await guestJoins(x.key, "Verified return", {
      returning: true,
    });
    const target = await participantId(x.host, x.sessionId);
    const request = await x.request("contribute", {
      field: "f1",
      revision: 0,
      value: "Before rotation",
    });
    const op = randomUUID();
    const lock = await hold(
      `select id from public.sessions where id='${x.sessionId}' for update`
    );
    const [save, restore] = await Promise.all([
      x.send(request, 0, op),
      x.host.rpc("restore_participant", {
        p_request: target,
        p_target: x.people[0].id,
      }),
    ]);
    expect(await lock.done).toBe(0);
    expect(restore.error).toBeNull();
    if (save.error) expect(save.error.code).toBe("42501");
    expect((await x.send(request, 0, op)).error?.code).toBe("42501");
    x.people[0].hash = returning.hash;
    expect((await x.draft(0)).item.recorder).toBe(x.people[0].id);
    expect((await x.draft(0)).item.content).toEqual(original.content);
    expect((await x.draft(0)).item.contributions).toHaveLength(
      save.error ? 0 : 1
    );
  });
  test("AC11: receipt failure rolls back answer, provenance, token and submission", async () => {
    const x = await groupWorkFixture();
    await x.save();
    const before = (await x.draft()).item;
    sql(
      `create function public.fail_group_work_receipt() returns trigger language plpgsql as $$ begin if new.session_id='${x.sessionId}' then raise exception 'synthetic_receipt_failure'; end if; return new; end $$; create trigger fail_group_work_receipt before insert on public.work_commands for each row execute function public.fail_group_work_receipt();`
    );
    try {
      expect((await x.send(await x.request("submit"))).error?.message).toBe(
        "synthetic_receipt_failure"
      );
      expect((await x.draft()).item).toEqual(before);
      expect(
        (
          await x.send(
            await x.request("answer", {
              revision: before.revision,
              content: { f1: "Must roll back", f2: "x" },
              sources: {},
            })
          )
        ).error?.message
      ).toBe("synthetic_receipt_failure");
      expect((await x.draft()).item).toEqual(before);
    } finally {
      sql(
        "drop trigger fail_group_work_receipt on public.work_commands; drop function public.fail_group_work_receipt();"
      );
    }
  });
  test("AC10/13: end closes special correction grants, retains independent history, and never submits", async () => {
    const x = await groupWorkFixture();
    await x.save();
    expect((await x.send(await x.request("submit"))).error).toBeNull();
    expect((await x.move(2, x.groups[1])).error).toBeNull();
    expect((await x.execute("next")).error).toBeNull();
    expect((await x.move(2, x.groups[0])).error).toBeNull();
    expect((await x.read(2)).items[0].draft_access).toBe(false);
    expect(
      (
        await x.send(
          await x.request("reopen", {
            reason: "Correct",
            audience: [x.people[0].id, x.people[2].id],
            baseline: (await x.draft()).item.attempts[0].id,
          }),
          null
        )
      ).error
    ).toBeNull();
    expect((await x.draft(2)).item.writable).toBe(true);
    expect((await x.execute("end")).error).toBeNull();
    expect((await x.read(2)).items[0].draft_access).toBe(false);
    expect((await x.draft(0)).item.writable).toBe(false);
    expect((await x.draft()).item.attempts).toHaveLength(1);
    expect((await x.recorder(1)).error?.message).toBe("group_work_closed");
    sql(
      `update public.sessions set ended_at=clock_timestamp()-interval '90 days' where id='${x.sessionId}';`
    );
    expect(
      (
        await client().rpc("read_group_work", {
          p_session: x.sessionId,
          p_credential_hash: x.people[0].hash,
        })
      ).error?.code
    ).toBe("42501");
  });
  test("AC9/13/14: work locks cannot extend deadline; rollback retains state and individual execution", async () => {
    const x = await groupWorkFixture();
    await x.save();
    const before = (await x.draft()).item;
    sql("update public.group_work_capability set enabled=false;");
    expect((await x.send(await x.request("submit"))).error?.message).toBe(
      "group_work_closed"
    );
    expect((await x.draft()).item.content).toEqual(before.content);
    expect((await command(x.host, x.sessionId, 2, "pause")).error).toBeNull();
    expect((await command(x.host, x.sessionId, 3, "resume")).error).toBeNull();
    sql("update public.group_work_capability set enabled=true;");
    expect((await x.draft()).item.content).toEqual(before.content);
    const preview = await x.request("submit");
    sql(
      `alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=now()-interval '4 hours'+interval '2 seconds',deadline=now()+interval '2 seconds' where session_id='${x.sessionId}'; alter table public.session_execution enable trigger execution_identity_frozen;`
    );
    const lock = await hold(
      `select revision from public.work_items where session_id='${x.sessionId}' for update`
    );
    expect((await x.send(preview)).error?.message).toBe("group_work_closed");
    expect(await lock.done).toBe(0);
    expect((await x.draft()).item.attempts).toHaveLength(0);
  });
  test("AC9/14: rollback drains a pending receipt and still permits advancing to an individual activity", async () => {
    const x = await groupWorkFixture();
    await x.save();
    const request = await x.request("submit");
    const unlock = await holdTransaction(
      "lock table public.work_commands in share mode"
    );
    const pending = x.send(request).then((r) => r);
    let disabling: Promise<() => Promise<void>> | undefined;
    try {
      await unlock.waitForQueries("query like '%group_work_command%'", 1);
      disabling = holdTransaction(
        "update public.group_work_capability set enabled=false"
      );
      await unlock.waitForQueries(
        "query like '%update public.group_work_capability%'",
        1
      );
    } finally {
      await unlock();
      if (disabling) await (await disabling)();
    }
    if (!disabling) throw Error("Expected queued capability disable");
    const disabledAt = sql("select clock_timestamp();");
    const result = await pending;
    expect(result.error).toBeNull();
    expect(Date.parse(result.data.confirmed_at)).toBeLessThanOrEqual(
      Date.parse(disabledAt)
    );
    expect(
      (await x.send(await x.request("submit", { reason: "Blocked" }))).error
        ?.message
    ).toBe("group_work_closed");
    expect((await x.execute("next")).error).toBeNull();
    expect((await x.read()).current?.scope).toBe("individual");
    sql("update public.group_work_capability set enabled=true;");
  });
  test("AC9/13: host expiry during a lock wait denies recorder changes and reads", async () => {
    const x = await groupWorkFixture();
    const context = (await x.read()).context;
    const token = (await x.host.auth.getSession()).data.session!.access_token;
    const authSession = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    ).session_id;
    sql(
      `update auth.sessions set not_after=now()+interval '2 seconds' where id='${authSession}';`
    );
    const lock = await hold(
      `select id from public.sessions where id='${x.sessionId}' for update`
    );
    const results = await Promise.all([
      x.recorder(1, x.groups[0], context),
      x.host.rpc("read_group_work", { p_session: x.sessionId, p_host: true }),
    ]);
    expect(await lock.done).toBe(0);
    expect(results.map((r) => r.error?.code)).toEqual(["42501", "42501"]);
    expect((await x.draft(0)).item.recorder).toBe(x.people[0].id);
  });
  test("AC10/13: late correction-only audience loses both draft and baseline at end or unswept expiry", async () => {
    for (const end of ["manual", "deadline"] as const) {
      const x = await groupWorkFixture();
      expect((await x.move(2, x.groups[1])).error).toBeNull();
      await x.save();
      expect((await x.send(await x.request("submit"))).error).toBeNull();
      const baseline = (await x.draft()).item.attempts[0].id;
      expect((await x.execute("next")).error).toBeNull();
      expect((await x.move(2, x.groups[0])).error).toBeNull();
      expect((await x.read(2)).items).toEqual([]);
      expect(
        (
          await x.send(
            await x.request("reopen", {
              reason: "Named older work access",
              audience: [x.people[0].id, x.people[2].id],
              baseline,
            }),
            null
          )
        ).error
      ).toBeNull();
      expect((await x.draft(2)).item.attempts[0].id).toBe(baseline);
      if (end === "manual") expect((await x.execute("end")).error).toBeNull();
      else {
        sql(
          `alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=now()-interval '4 hours'+interval '2 seconds',deadline=now()+interval '2 seconds' where session_id='${x.sessionId}'; alter table public.session_execution enable trigger execution_identity_frozen;`
        );
        const lock = await hold(
          "lock table public.work_attempts in access exclusive mode"
        );
        const crossed = await client().rpc("read_group_work", {
          p_session: x.sessionId,
          p_credential_hash: x.people[2].hash,
        });
        expect(await lock.done).toBe(0);
        expect(crossed.data === null || crossed.data.items.length === 0).toBe(
          true
        );
        if (crossed.error)
          expect([
            "group_work_closed",
            "canceling statement due to statement timeout",
          ]).toContain(crossed.error.message);
        const expired = await x.execute("pause");
        expect(expired.error).toBeNull();
        expect(expired.data.ended).toBe(true);
      }
      expect((await x.read(2)).items).toEqual([]);
      expect((await x.draft(0)).item.attempts[0].id).toBe(baseline);
    }
  });
  test("AC2/8/14: mixed individual-group-individual execution preserves private work and deadline", async () => {
    const x = await groupWorkFixture(true, true);
    const before = await x.host.rpc("host_execution_v2", {
      p_session: x.sessionId,
    });
    expect(before.data.current.id).toBe("a0");
    const individual = {
      command: "save",
      participant: x.people[0].id,
      activity: "a0",
      version: x.version.id,
      revision: 0,
      latest: 0,
      window_revision: 0,
      reason: "",
      content: { f1: "Private warmup" },
    };
    expect(
      (
        await client().rpc("work_command", {
          p_session: x.sessionId,
          p_operation: randomUUID(),
          p_request: individual,
          p_credential_hash: x.people[0].hash,
        })
      ).error
    ).toBeNull();
    expect((await x.execute("next")).error).toBeNull();
    await x.save();
    expect((await x.read(1)).current?.id).toBe("a1");
    expect(JSON.stringify(await x.read(1))).not.toContain("Private warmup");
    expect((await x.execute("next")).error).toBeNull();
    const after = await x.host.rpc("host_execution_v2", {
      p_session: x.sessionId,
    });
    expect(after.data.current.id).toBe("a2");
    expect(after.data.deadline).toBe(before.data.deadline);
    expect(after.data.unfinished).toEqual([]);
    const legacy = await client().rpc("read_work", {
      p_session: x.sessionId,
      p_credential_hash: x.people[0].hash,
    });
    expect(
      legacy.data.items.map((i: { activity: { id: string } }) => i.activity.id)
    ).toEqual(["a0", "a2"]);
    expect(legacy.data.items[0].content).toEqual(individual.content);
    expect((await x.draft()).item.writable).toBe(false);
  });
  test("AC4/11: recorder no-op/retry history, foreign authority and current scope on receipt replay", async () => {
    const x = await groupWorkFixture(false);
    const snapshot = await x.read();
    const request = {
        group: x.groups[0],
        recorder: x.people[0].id,
        context: snapshot.context,
        reason: "",
      },
      op = randomUUID();
    const send = () =>
      x.host.rpc("recorder_command", {
        p_session: x.sessionId,
        p_operation: op,
        p_request: request,
      });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.error).toBeNull();
    expect(b.data).toEqual(a.data);
    expect(a.data.changed).toBe(false);
    expect((await x.read()).recorder_history).toEqual(
      snapshot.recorder_history
    );
    expect(
      (
        await client().rpc("recorder_command", {
          p_session: x.sessionId,
          p_operation: randomUUID(),
          p_request: request,
        })
      ).error?.code
    ).toBe("42501");
    expect((await x.execute("start")).error).toBeNull();
    const contribution = await x.request("contribute", {
        revision: 0,
        field: "f1",
        value: "Saved own slot",
      }),
      savedOp = randomUUID();
    const saved = await x.send(contribution, 0, savedOp);
    expect(saved.error).toBeNull();
    expect((await x.recorder(1)).error).toBeNull();
    expect((await x.send(contribution, 0, savedOp)).data).toEqual(saved.data);
    expect((await x.move(0, x.groups[1])).error).toBeNull();
    expect((await x.send(contribution, 0, savedOp)).error?.code).toBe("42501");
    const plan = groupPlan(await x.groupsRead());
    plan.groups = plan.groups.filter((g) => g.key !== x.groups[1]);
    plan.retire = [x.groups[1]];
    plan.members = plan.members.map((m) =>
      m.group === x.groups[1] ? { ...m, group: null } : m
    );
    plan.reason = "Retire group";
    expect(
      (
        await x.host.rpc("group_command", {
          p_session: x.sessionId,
          p_operation: randomUUID(),
          p_request: plan,
        })
      ).error
    ).toBeNull();
    expect((await x.move(0, x.groups[1])).error?.message).toBe(
      "invalid_group_plan"
    );
  });
  test("AC4/8: foreign and AAL1 hosts cannot inspect or appoint recorders", async () => {
    const x = await groupWorkFixture(false);
    const before = await x.read();
    const foreign = await ownerWithMfa();
    const aal1 = client();
    expect(
      (
        await aal1.auth.signInWithPassword({
          email: x.email,
          password: SYNTHETIC_PASSWORD,
        })
      ).error
    ).toBeNull();
    for (const caller of [foreign.host, aal1]) {
      expect(
        (
          await caller.rpc("read_group_work", {
            p_session: x.sessionId,
            p_host: true,
          })
        ).error?.code
      ).toBe("42501");
      expect(
        (
          await caller.rpc("recorder_command", {
            p_session: x.sessionId,
            p_operation: randomUUID(),
            p_request: {
              group: x.groups[0],
              recorder: x.people[1].id,
              context: before.context,
              reason: "Forbidden replacement",
            },
          })
        ).error?.code
      ).toBe("42501");
    }
    expect((await x.read()).recorder_history).toEqual(before.recorder_history);
  });
  test("AC11/13: retained reads and receipt replay recheck the original retention boundary after locks", async () => {
    const x = await groupWorkFixture();
    await x.save();
    const submission = await x.request("submit"),
      operation = randomUUID();
    expect((await x.send(submission, 0, operation)).error).toBeNull();
    expect((await x.execute("end")).error).toBeNull();
    sql(
      `update public.sessions set ended_at=clock_timestamp()-interval '90 days'+interval '1 hour' where id='${x.sessionId}';`
    );
    expect((await x.read(0)).items[0].attempts).toHaveLength(1);
    expect((await x.send(submission, 0, operation)).error).toBeNull();
    sql(
      `update public.sessions set ended_at=clock_timestamp()-interval '90 days'+interval '1 second' where id='${x.sessionId}';`
    );
    const lock = await hold(
      `select id from public.sessions where id='${x.sessionId}' for update`
    );
    const results = await Promise.all([
      client().rpc("read_group_work", {
        p_session: x.sessionId,
        p_credential_hash: x.people[0].hash,
      }),
      x.send(submission, 0, operation),
    ]);
    expect(await lock.done).toBe(0);
    for (const result of results) expect(result.error?.code).toBe("42501");
  });
  test("AC7: replacing one field cannot strip a former recorder from another retained field", async () => {
    const x = await groupWorkFixture();
    await x.save("First recorder's explanation");
    expect((await x.recorder(1)).error).toBeNull();
    expect((await x.move(0, x.groups[1])).error).toBeNull();
    await x.save("Partly revised explanation", 1);
    expect(
      (await x.send(await x.request("submit", {}, 1), 1)).error
    ).toBeNull();
    for (const field of ["f1", "f2"]) {
      const { item } = await x.draft(1);
      expect(
        (
          await x.send(
            await x.request(
              "replace_field",
              {
                revision: item.revision,
                field,
                value: "New recorder's replacement",
                sources: {},
                reason: "Independent replacement",
              },
              1
            ),
            1
          )
        ).error
      ).toBeNull();
      expect(
        (
          await x.send(
            await x.request("submit", { reason: "Replaced field" }, 1),
            1
          )
        ).error
      ).toBeNull();
    }
    const retained = (await x.read(0)).items.find(
      (i) => i.group === x.groups[0]
    )!;
    expect(retained.draft_access).toBe(false);
    expect(retained.attempts).toHaveLength(2);
    expect((await x.draft()).item.attempts).toHaveLength(3);
    expect(retained.attempts[0].snapshot.lineage.f1.authors).toContain(
      x.people[0].id
    );
    expect(retained.attempts[1].snapshot.lineage.f1.authors).not.toContain(
      x.people[0].id
    );
    expect(retained.attempts[1].snapshot.lineage.f2.authors).toContain(
      x.people[0].id
    );
  });
  test("AC9/10: consolidated save versus recorder replacement and reopen versus submission do not fork", async () => {
    const x = await groupWorkFixture();
    await x.save();
    const answer = await x.request("answer", {
      revision: 1,
      content: { f1: "Racing acknowledged answer", f2: "Yes" },
      sources: {},
    });
    const lock = await hold(
      `select id from public.sessions where id='${x.sessionId}' for update`
    );
    const [saved, replaced] = await Promise.all([
      x.send(answer),
      x.recorder(1),
    ]);
    expect(await lock.done).toBe(0);
    expect(replaced.error).toBeNull();
    if (saved.error)
      expect(["not_allowed", "group_work_conflict"]).toContain(
        saved.error.message
      );
    expect((await x.draft()).item.content.f1).toBe(
      saved.error ? "Consolidated" : "Racing acknowledged answer"
    );
    expect(
      (await x.send(await x.request("submit", {}, 1), 1)).error
    ).toBeNull();
    expect((await x.execute("next")).error).toBeNull();
    const baseline = (await x.draft()).item.attempts[0].id;
    expect(
      (
        await x.send(
          await x.request("reopen", {
            reason: "Reopen",
            audience: [x.people[1].id],
            baseline,
          }),
          null
        )
      ).error
    ).toBeNull();
    const correction = await x.request("submit", { reason: "Correction" }, 1),
      reopen = await x.request("reopen", {
        reason: "Change audience",
        audience: [x.people[1].id, x.people[2].id],
        baseline,
      });
    const results = await Promise.all([
      x.send(correction, 1),
      x.send(reopen, null),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.message).toBe(
      "group_work_conflict"
    );
    const attempts = (await x.draft()).item.attempts;
    expect(attempts).toHaveLength(results[0].error ? 1 : 2);
    if (attempts[1]) expect(attempts[1].preceding_id).toBe(baseline);
  });
});
