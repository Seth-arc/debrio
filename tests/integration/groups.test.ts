import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { beforeEach, describe, expect, test } from "vitest";
import { groupPlan, type GroupSnapshot } from "../../lib/groups";
import { executionHost, command } from "../support/execution";
import { guestJoins, participantId, decide } from "../support/sessions";
import { client, confirmedHost } from "../support/hosts";
import { sql } from "../support/database";
import { workFixture } from "../support/work";

async function fixture() {
  const x = await executionHost();
  const people: (Awaited<ReturnType<typeof guestJoins>> & { id: string })[] =
    [];
  for (const name of ["Synthetic Same", "Synthetic Same", "Synthetic Third"]) {
    const g = await guestJoins(x.key, name);
    const id = await participantId(x.host, x.sessionId);
    expect((await decide(x.host, id, "admit")).error).toBeNull();
    people.push({ ...g, id });
  }
  const read = () =>
    x.host.rpc("read_groups", { p_session: x.sessionId, p_host: true });
  const snap = async () => {
    const r = await read();
    expect(r.error).toBeNull();
    return r.data as GroupSnapshot;
  };
  const send = (request: unknown, operation = randomUUID(), as = x.host) =>
    as.rpc("group_command", {
      p_session: x.sessionId,
      p_operation: operation,
      p_request: request,
    });
  const guest = (hash = people[0].hash) =>
    client().rpc("read_groups", {
      p_session: x.sessionId,
      p_credential_hash: hash,
    });
  const base = await snap(),
    plan = groupPlan(base),
    key = randomUUID();
  plan.groups = [{ key, create: true }];
  plan.members = plan.members.map((m) => ({ ...m, group: key }));
  return { ...x, people, read, snap, send, guest, plan };
}
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
    child.stdout.on("data", (d) => {
      if (String(d).includes("group-proof-locked")) resolve();
    });
    child.on("error", reject);
  });
  const done = new Promise((resolve) => child.on("exit", resolve));
  child.stdin.end(
    `begin; ${statement}; select 'group-proof-locked'; select pg_sleep(2.5); commit;`
  );
  await locked;
  return { done };
}
describe("non-media group assignment", { timeout: 60000 }, () => {
  beforeEach(() =>
    sql(
      "insert into public.execution_capacity values(true,1000,clock_timestamp()+interval '1 hour') on conflict(singleton) do update set max_live=1000,valid_until=excluded.valid_until;"
    )
  );
  test("AC1/2/9: stable group IDs, exact whole plan, duplicate/no-op receipts and immutable history", async () => {
    const x = await fixture();
    expect((await x.guest()).data).toMatchObject({ group: null, members: [] });
    const op = randomUUID();
    const [a, b] = await Promise.all([
      x.send(x.plan, op),
      x.send({ ...x.plan, members: [...x.plan.members].reverse() }, op),
    ]);
    expect(a.error).toBeNull();
    expect(b.data).toEqual(a.data);
    const s = await x.snap();
    expect(s.revision).toBe(1);
    expect(s.groups).toHaveLength(1);
    expect(s.groups![0].id).not.toBe(x.plan.groups[0].key);
    expect(s.members.every((m) => m.group === s.groups![0].id)).toBe(true);
    expect(s.history).toHaveLength(1);
    expect(
      (await x.send({ ...x.plan, reason: "different" }, op)).error?.message
    ).toBe("operation_reused");
    expect((await x.send(groupPlan(s))).data.changed).toBe(false);
    expect((await x.snap()).history).toHaveLength(1);
    const empty = groupPlan(s);
    empty.members = empty.members.map((m) => ({ ...m, group: null }));
    empty.groups = [];
    empty.retire = [s.groups![0].id];
    expect((await x.send(empty)).error).toBeNull();
    const next = groupPlan(await x.snap());
    next.groups = [{ key: randomUUID(), create: true }];
    expect((await x.send(next)).error).toBeNull();
    expect((await x.snap()).groups![0].ordinal).toBe(2);
    const retired = groupPlan(await x.snap());
    retired.groups.push({ key: s.groups![0].id, create: false });
    expect((await x.send(retired)).error?.message).toBe("invalid_group_plan");
    expect((await x.send(x.plan, op)).data).toEqual(a.data);
    expect((await x.snap()).revision).toBe(3);
    expect(
      sql(
        `select count(*) from public.session_groups where session_id='${x.sessionId}' and retired;`
      ).trim()
    ).toBe("1");
  });
  test("AC1/5: bounds, complete roster, malformed/foreign/retired scopes and direct table denial", async () => {
    const x = await fixture(),
      foreign = await fixture();
    const variants = [
      { ...x.plan, members: x.plan.members.slice(1) },
      { ...x.plan, members: [...x.plan.members, x.plan.members[0]] },
      { ...x.plan, groups: [...x.plan.groups, x.plan.groups[0]] },
      {
        ...x.plan,
        groups: Array.from({ length: 9 }, () => ({
          key: randomUUID(),
          create: true,
        })),
      },
      {
        ...x.plan,
        members: x.plan.members.map((m) => ({ ...m, group: randomUUID() })),
      },
      { ...x.plan, retire: [randomUUID()] },
      { ...x.plan, version: foreign.plan.version },
      { ...x.plan, actor: randomUUID() },
      { ...x.plan, reason: "x".repeat(501) },
    ];
    for (const p of variants) expect((await x.send(p)).error).not.toBeNull();
    expect((await x.snap()).revision).toBe(0);
    const eight = {
      ...x.plan,
      groups: Array.from({ length: 8 }, () => ({
        key: randomUUID(),
        create: true,
      })),
      members: x.plan.members.map((m) => ({ ...m, group: null })),
    };
    expect((await x.send(eight)).error).toBeNull();
    expect((await x.snap()).groups).toHaveLength(8);
    const other = await confirmedHost();
    for (const as of [client(), other.host]) {
      expect((await x.send(x.plan, randomUUID(), as)).error).not.toBeNull();
      expect(
        (await as.rpc("read_groups", { p_session: x.sessionId, p_host: true }))
          .error
      ).not.toBeNull();
      for (const table of [
        "session_groups",
        "session_group_state",
        "session_group_members",
        "session_group_changes",
        "session_group_commands",
      ])
        expect((await as.from(table).select("*")).error).not.toBeNull();
    }
  });
  test("AC4/7: late admission invalidates preview; removal is atomic and duplicate removal a no-op", async () => {
    const x = await fixture();
    const late = await guestJoins(x.key, "Late");
    const lateId = await participantId(x.host, x.sessionId);
    expect((await x.guest(late.hash)).error).not.toBeNull();
    await decide(x.host, lateId, "admit");
    expect((await x.send(x.plan)).error?.message).toBe("group_conflict");
    const p = groupPlan(await x.snap());
    p.groups = x.plan.groups;
    p.members = p.members.map((m) => ({
      ...m,
      group: m.participant === lateId ? null : p.groups[0].key,
    }));
    expect((await x.send(p)).error).toBeNull();
    expect((await x.guest(late.hash)).data).toMatchObject({
      group: null,
      members: [],
    });
    const stale = groupPlan(await x.snap());
    await decide(x.host, x.people[0].id, "remove");
    expect((await x.send(stale)).error?.message).toBe("group_conflict");
    const after = await x.snap();
    expect(after.revision).toBe(2);
    expect(after.history![0].source).toBe("removal");
    expect((await x.guest()).error).not.toBeNull();
    await decide(x.host, x.people[0].id, "remove");
    expect((await x.snap()).revision).toBe(2);
  });
  test("AC4/9: competing host plans commit once; pre-commit fault rolls back mappings and receipts", async () => {
    const x = await fixture();
    const results = await Promise.all([
      x.send(x.plan),
      x.send({ ...x.plan, reason: "Another tab" }),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error?.message).toBe("group_conflict");
    const current = await x.snap(),
      p = groupPlan(current);
    p.members = p.members.map((m) => ({ ...m, group: null }));
    sql(
      "create function public.fail_group_proof() returns trigger language plpgsql as $$ begin raise exception 'synthetic receipt failure'; end $$; create trigger fail_group_proof before insert on public.session_group_commands for each row execute function public.fail_group_proof();"
    );
    try {
      expect((await x.send(p)).error).not.toBeNull();
      expect(await x.snap()).toEqual(current);
    } finally {
      sql(
        "drop trigger fail_group_proof on public.session_group_commands; drop function public.fail_group_proof();"
      );
    }
  });
  test("AC6/8: current groupmates only; reassignment does not expose or alter individual work", async () => {
    const x = await workFixture();
    await x.send();
    const before = await x.read();
    const read = () =>
      x.host.rpc("read_groups", { p_session: x.session, p_host: true });
    const s = (await read()).data as GroupSnapshot;
    const p = groupPlan(s),
      key = randomUUID();
    p.groups = [{ key, create: true }];
    p.members = p.members.map((m) => ({ ...m, group: key }));
    p.reason = "Coordinate current activity";
    const op = randomUUID();
    expect(
      (
        await x.host.rpc("group_command", {
          p_session: x.session,
          p_operation: op,
          p_request: p,
        })
      ).error
    ).toBeNull();
    expect((await x.read()).data).toEqual(before.data);
    const projection = await client().rpc("read_groups", {
      p_session: x.session,
      p_credential_hash: x.guest.hash,
    });
    expect(projection.error).toBeNull();
    expect(projection.data.members).toHaveLength(1);
    for (const forbidden of [
      "Synthetic explanation",
      "attempt",
      "content",
      "history",
      "roster",
      "credential",
      "email",
    ])
      expect(JSON.stringify(projection.data)).not.toContain(forbidden);
    const other = await guestJoins(x.key, "Other group");
    const id = await participantId(x.host, x.session);
    await decide(x.host, id, "admit");
    const plan = groupPlan((await read()).data);
    const newKey = randomUUID();
    plan.groups.push({ key: newKey, create: true });
    plan.members = plan.members.map((m) =>
      m.participant === id ? { ...m, group: newKey } : m
    );
    plan.reason = "Separate context";
    const [assignment, save] = await Promise.all([
      x.host.rpc("group_command", {
        p_session: x.session,
        p_operation: randomUUID(),
        p_request: plan,
      }),
      x.send({ ...x.request, revision: 1 }),
    ]);
    expect(assignment.error).toBeNull();
    expect(save.error).toBeNull();
    expect(
      (
        await client().rpc("read_groups", {
          p_session: x.session,
          p_credential_hash: other.hash,
        })
      ).data.members
    ).toHaveLength(1);
    expect(
      JSON.stringify(
        (
          await client().rpc("read_groups", {
            p_session: x.session,
            p_credential_hash: other.hash,
          })
        ).data
      )
    ).not.toContain(x.person);
  });
  test("AC7/10: verified recovery preserves membership and rejects retired credentials; same name is new", async () => {
    const x = await fixture();
    await x.send(x.plan);
    const before = (await x.guest()).data;
    const returning = await guestJoins(x.key, "Return", { returning: true });
    const request = await participantId(x.host, x.sessionId);
    expect(
      (
        await x.host.rpc("restore_participant", {
          p_request: request,
          p_target: x.people[0].id,
        })
      ).error
    ).toBeNull();
    expect((await x.guest()).error).not.toBeNull();
    expect((await x.guest(returning.hash)).data).toEqual(before);
    const fresh = await guestJoins(x.key, "Synthetic Same");
    await decide(x.host, await participantId(x.host, x.sessionId), "admit");
    expect((await x.guest(fresh.hash)).data.group).toBeNull();
    expect(
      (await x.snap()).members.some((m) => m.participant === request)
    ).toBe(false);
  });
  test("AC4/8/12: start/advance invalidate preview, pause permits explicit changes, end permits only receipt replay", async () => {
    const x = await fixture();
    await command(x.host, x.sessionId, 1, "start");
    expect((await x.send(x.plan)).error?.message).toBe("group_conflict");
    const p = groupPlan(await x.snap());
    p.groups = x.plan.groups;
    p.members = p.members.map((m) => ({ ...m, group: p.groups[0].key }));
    expect((await x.send(p)).error?.message).toBe("invalid_group_plan");
    p.reason = "Live allocation";
    const op = randomUUID();
    const first = await x.send(p, op);
    expect(first.error).toBeNull();
    await command(x.host, x.sessionId, 2, "pause");
    const paused = groupPlan(await x.snap());
    paused.members = paused.members.map((m) =>
      m.participant === x.people[0].id ? { ...m, group: null } : m
    );
    paused.reason = "Pause coordination";
    expect((await x.send(paused)).error).toBeNull();
    await command(x.host, x.sessionId, 3, "resume");
    const before = groupPlan(await x.snap());
    expect((await command(x.host, x.sessionId, 4, "next")).error).toBeNull();
    const carried = groupPlan(await x.snap());
    expect(carried.members).toEqual(before.members);
    expect(carried.groups).toEqual(before.groups);
    expect((await x.send(before)).error?.message).toBe("group_conflict");
    await command(x.host, x.sessionId, 5, "end");
    expect((await x.send(groupPlan(await x.snap()))).error?.message).toBe(
      "group_closed"
    );
    expect((await x.send(p, op)).data).toEqual(first.data);
    expect((await x.guest()).data.state).toBe("completed");
  });
  test("AC5/8/12: locks crossing host expiry, original deadline or retention cannot extend access", async () => {
    const x = await fixture();
    const replayOperation = randomUUID();
    expect((await x.send(x.plan, replayOperation)).error).toBeNull();
    const authId = (
      await x.host.auth.getSession()
    ).data.session!.access_token.split(".")[1];
    const sessionId = JSON.parse(
      Buffer.from(authId, "base64url").toString()
    ).session_id;
    sql(
      `update auth.sessions set not_after=clock_timestamp()+interval '1 second' where id='${sessionId}';`
    );
    const h = await hold(
      `select 1 from public.sessions where id='${x.sessionId}' for update`
    );
    expect((await x.send(x.plan, replayOperation)).error?.message).toBe(
      "not_allowed"
    );
    await h.done;
    const y = await fixture();
    await command(y.host, y.sessionId, 1, "start");
    sql(
      `alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=now()-interval '4 hours'+interval '2 seconds',deadline=now()+interval '2 seconds' where session_id='${y.sessionId}'; alter table public.session_execution enable trigger execution_identity_frozen;`
    );
    const lock = await hold(
      `select 1 from public.sessions where id='${y.sessionId}' for update`
    );
    const p = { ...y.plan, ...{ execution_revision: 2 }, reason: "Deadline" };
    expect((await y.send(p)).error?.message).toBe("group_closed");
    await lock.done;
    sql(
      `update public.sessions set state='ended',ended_at=clock_timestamp()-interval '90 days'+interval '1 second' where id='${y.sessionId}';`
    );
    const retained = await hold(
      `select 1 from public.sessions where id='${y.sessionId}' for update`
    );
    expect((await y.guest()).error?.message).toBe("not_allowed");
    await retained.done;
    expect((await y.read()).error?.message).toBe("not_allowed");
  });
  test("AC5/7: legacy removal and recovery recheck host authority after blocking locks", async () => {
    for (const action of ["remove", "restore"]) {
      const x = await fixture();
      await x.send(x.plan);
      let returning: string | undefined;
      if (action === "restore") {
        await guestJoins(x.key, "Synthetic Return", { returning: true });
        returning = await participantId(x.host, x.sessionId);
      }
      const token = (await x.host.auth.getSession()).data.session!.access_token;
      const authSession = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString()
      ).session_id;
      sql(
        `update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id='${authSession}';`
      );
      const lock = await hold(
        `select 1 from public.sessions where id='${x.sessionId}' for update`
      );
      const r =
        action === "remove"
          ? await decide(x.host, x.people[0].id, "remove")
          : await x.host.rpc("restore_participant", {
              p_request: returning,
              p_target: x.people[0].id,
            });
      expect(r.error?.message).toBe("not_allowed");
      await lock.done;
      expect((await x.guest()).error).toBeNull();
      expect((await x.guest()).data.group).not.toBeNull();
      expect(
        sql(
          `select revision from public.session_group_state where session_id='${x.sessionId}';`
        )
      ).toBe("1");
    }
  });
  test("AC7/8: removal racing reassignment cannot retain a removed identity", async () => {
    const x = await fixture();
    await x.send(x.plan);
    const p = groupPlan(await x.snap());
    p.members = p.members.map((m) => ({ ...m, group: null }));
    const [change, removal] = await Promise.all([
      x.send(p),
      decide(x.host, x.people[0].id, "remove"),
    ]);
    expect(removal.error).toBeNull();
    if (change.error) expect(change.error.message).toBe("group_conflict");
    expect(
      (await x.snap()).members.some((m) => m.participant === x.people[0].id)
    ).toBe(false);
    expect(
      sql(
        `select count(*) from public.session_group_members where session_id='${x.sessionId}' and participant_id='${x.people[0].id}';`
      )
    ).toBe("0");
  });
  test("AC12/13: duplicated workshops/new sessions copy no assignment or personal history", async () => {
    const x = await fixture();
    await x.send(x.plan);
    const original = await x.snap();
    const copy = await x.host.rpc("duplicate_workshop", {
      p_workshop: x.version.workshop,
      p_operation: randomUUID(),
    });
    expect(copy.error).toBeNull();
    const draft = await x.host
      .from("workshop_versions")
      .select("id,revision")
      .eq("workshop_id", copy.data.id)
      .single();
    expect(draft.error).toBeNull();
    expect(
      (
        await x.host.rpc("mark_workshop_ready", {
          p_version: draft.data!.id,
          p_expected_revision: draft.data!.revision,
        })
      ).error
    ).toBeNull();
    for (const version of [draft.data!.id, x.version.id]) {
      const prepared = await x.host.rpc("prepare_execution", {
        p_version: version,
        p_operation: randomUUID(),
      });
      expect(prepared.error).toBeNull();
      const state = await x.host.rpc("read_groups", {
        p_session: prepared.data,
        p_host: true,
      });
      expect(state.error).toBeNull();
      expect(state.data).toMatchObject({
        revision: 0,
        members: [],
        groups: [],
        history: [],
      });
      const foreign = groupPlan(state.data);
      foreign.groups = [{ key: original.groups![0].id, create: false }];
      expect(
        (
          await x.host.rpc("group_command", {
            p_session: prepared.data,
            p_operation: randomUUID(),
            p_request: foreign,
          })
        ).error?.message
      ).toBe("invalid_group_plan");
    }
    expect(await x.snap()).toEqual(original);
  });
  test("AC10: database/API process restart preserves acknowledged mapping, history and receipt", async () => {
    const x = await fixture(),
      op = randomUUID();
    const result = await x.send(x.plan, op);
    expect(result.error).toBeNull();
    const before = await x.snap();
    const stop = spawn("docker", [
      "compose",
      "kill",
      "-s",
      "SIGKILL",
      "rest",
      "db",
    ]);
    await new Promise((r) => stop.on("exit", r));
    const start = spawn("docker", [
      "compose",
      "up",
      "-d",
      "--wait",
      "db",
      "rest",
    ]);
    expect(await new Promise((r) => start.on("exit", r))).toBe(0);
    await expect
      .poll(
        async () => {
          try {
            return (await x.read()).error === null;
          } catch {
            return false;
          }
        },
        { timeout: 30000 }
      )
      .toBe(true);
    expect(await x.snap()).toEqual(before);
    expect((await x.send(x.plan, op)).data).toEqual(result.data);
  });
});
