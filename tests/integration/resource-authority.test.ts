import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { groupPlan, type GroupSnapshot } from "../../lib/groups";
import { resourceFixture } from "../support/resources";
import { decide, guestJoins, participantId } from "../support/sessions";
import { holdTransaction, sql } from "../support/database";

afterEach(() => sql("update public.resource_capability set enabled=false;"));

async function waitForQueuedResources(count: number) {
  await expect
    .poll(
      () =>
        Number(
          sql(
            "select count(*) from pg_stat_activity where wait_event_type='Lock' and (query like '%resource_command%' or query like '%read_resources%');"
          )
        ),
      { timeout: 10000 }
    )
    .toBeGreaterThanOrEqual(count);
}

async function released() {
  const f = await resourceFixture();
  const resource = await f.resource();
  const allocation = f.proposal(resource.version);
  expect((await f.confirm(allocation)).error).toBeNull();
  expect((await f.execute("start")).error).toBeNull();
  const release = { ...allocation, command: "release" as const, revision: 1 };
  const command = { ...release, token: (await f.preview(release)).token };
  const operation = randomUUID();
  expect((await f.send(command, operation)).error).toBeNull();
  return { ...f, allocation, command, operation };
}

test("AC17: read-only execution and resource previews coexist with another authorized session read", async () => {
  const f = await resourceFixture();
  const resource = await f.resource();
  const proposal = f.proposal(resource.version);
  const unlock = await holdTransaction(
    `select id from public.sessions where id='${f.session}' for share`
  );
  let complete = false;
  const reads = Promise.all([
    f.host.rpc("host_execution_v4", { p_session: f.session }),
    f.host.rpc("resource_preview", {
      p_session: f.session,
      p_request: proposal,
    }),
    f.read(0),
  ]).then((results) => {
    complete = true;
    return results;
  });
  try {
    await expect.poll(() => complete, { timeout: 5000 }).toBe(true);
  } finally {
    await unlock();
    await reads;
  }
  for (const result of await reads) expect(result.error).toBeNull();
}, 60000);

test("AC10/12: credential restoration preserves identity notices but retires old reads and device receipts", async () => {
  const f = await released();
  const allocation = f.allocation.allocation;
  const ack = { command: "ack", allocation, generation: 1 };
  const ackOperation = randomUUID();
  expect((await f.send(ack, ackOperation, 0)).error).toBeNull();
  expect(
    (await f.send({ ...ack, command: "dismiss" }, randomUUID(), 0)).error
  ).toBeNull();
  const before = (await f.snapshot(0)).items[0].notice!;
  expect(before).toMatchObject({ received: true, dismissed: true });
  const back = await guestJoins(f.key, "Synthetic returning recipient", {
    returning: true,
  });
  expect(back.joined.error).toBeNull();
  const request = await participantId(f.host, f.session);
  expect(
    (
      await f.host.rpc("restore_participant", {
        p_request: request,
        p_target: f.people[0].id,
      })
    ).error
  ).toBeNull();
  expect((await f.read(0, allocation)).error?.code).toBe("42501");
  expect((await f.send(ack, ackOperation, 0)).error?.code).toBe("42501");
  expect((await f.send(ack, randomUUID(), 0)).error?.code).toBe("42501");
  f.people[0].hash = back.hash;
  const recovered = await f.snapshot(0, allocation);
  expect(recovered.detail?.content).toBe("Synthetic private brief");
  expect(recovered.items[0].notice).toMatchObject({
    id: before.id,
    generation: 1,
    dismissed: true,
    received: false,
  });
  expect((await f.snapshot()).items[0].recipients?.[0].delivery).toBe(
    "Available; receipt unconfirmed"
  );
  expect((await f.send(ack, randomUUID(), 0)).error).toBeNull();
  expect((await f.snapshot()).items[0].recipients?.[0].delivery).toBe(
    "Received by active device"
  );
  expect((await decide(f.host, f.people[0].id, "remove")).error).toBeNull();
  expect((await f.read(0, allocation)).error?.code).toBe("42501");
  expect((await f.send(ack, randomUUID(), 0)).error?.code).toBe("42501");
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${allocation}';`
    )
  ).toBe("1");
}, 60000);

test("AC7/10: a committed group move wins queued read, ack, release and audience previews", async () => {
  const f = await resourceFixture();
  const groups = async () => {
    const result = await f.host.rpc("read_groups", {
      p_session: f.session,
      p_host: true,
    });
    expect(result.error).toBeNull();
    return result.data as GroupSnapshot;
  };
  const change = (plan: ReturnType<typeof groupPlan>) =>
    f.host.rpc("group_command", {
      p_session: f.session,
      p_operation: randomUUID(),
      p_request: { ...plan, reason: "Synthetic membership race" },
    });
  const initial = groupPlan(await groups());
  const group = randomUUID();
  initial.groups = [{ key: group, create: true }];
  initial.members = initial.members.map((m) => ({ ...m, group }));
  expect((await change(initial)).error).toBeNull();
  const id = (await groups()).groups![0].id;
  const resource = await f.resource();
  const scheduled = f.proposal(resource.version, {
    trigger: "start",
    selectors: [
      { kind: "group", id },
      { kind: "individual", id: f.people[0].id },
    ],
  });
  const manual = f.proposal(resource.version, {
    selectors: [{ kind: "group", id }],
  });
  expect((await f.confirm(scheduled)).error).toBeNull();
  expect((await f.confirm(manual)).error).toBeNull();
  expect((await f.execute("start")).error).toBeNull();
  const audience = { ...scheduled, command: "audience" as const, revision: 2 };
  const release = { ...manual, command: "release" as const, revision: 1 };
  const oldAudience = { ...audience, token: (await f.preview(audience)).token };
  const oldRelease = { ...release, token: (await f.preview(release)).token };
  const move = groupPlan(await groups());
  move.members = move.members.map((m) => ({
    ...m,
    group: m.participant === f.people[1].id ? null : m.group,
  }));
  sql(
    `create function public.test_resource_group_commit() returns trigger language plpgsql as $$ begin if new.session_id='${f.session}'::uuid then perform pg_advisory_xact_lock(30101); end if; return new; end $$; create trigger test_resource_group_commit before insert on public.session_group_commands for each row execute function public.test_resource_group_commit();`
  );
  const unlock = await holdTransaction("select pg_advisory_xact_lock(30101)");
  try {
    const moving = Promise.resolve(change(move));
    await expect
      .poll(
        () =>
          Number(
            sql(
              "select count(*) from pg_stat_activity where query like '%group_command%' and wait_event_type='Lock';"
            )
          ),
        { timeout: 10000 }
      )
      .toBeGreaterThan(0);
    const pending = Promise.all([
      f.read(1, scheduled.allocation),
      f.send(
        { command: "ack", allocation: scheduled.allocation, generation: 1 },
        randomUUID(),
        1
      ),
      f.send(oldRelease),
      f.send(oldAudience),
    ]);
    await waitForQueuedResources(4);
    await unlock();
    const [read, ack, released, updated] = await pending;
    expect((await moving).error).toBeNull();
    expect(read.error?.code).toBe("42501");
    expect(ack.error?.code).toBe("42501");
    expect(released.error?.message).toBe("stale_resource");
    expect(updated.error?.message).toBe("stale_resource");
  } finally {
    await unlock();
    sql(
      "drop trigger test_resource_group_commit on public.session_group_commands; drop function public.test_resource_group_commit();"
    );
  }
  expect((await f.snapshot(1)).items).toEqual([]);
  expect((await f.snapshot(0)).items).toHaveLength(1);
  expect((await f.confirm(release)).error).toBeNull();
  expect((await f.snapshot(0)).items).toHaveLength(2);
  expect((await f.snapshot(1)).items).toEqual([]);
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${manual.allocation}';`
    )
  ).toBe("1");
}, 60000);

test("AC14: retention expiry denies queued notices, ack, dismiss and committed replay", async () => {
  const f = await released();
  const allocation = f.allocation.allocation;
  const ack = { command: "ack", allocation, generation: 1 };
  const ackOperation = randomUUID();
  expect((await f.send(ack, ackOperation, 0)).error).toBeNull();
  expect((await f.execute("end")).error).toBeNull();
  const unlock = await holdTransaction(
    `select id from public.sessions where id='${f.session}' for update; update public.sessions set ended_at=clock_timestamp()-interval '90 days' where id='${f.session}'`
  );
  const pending = Promise.all([
    f.read(0),
    f.read(0, allocation),
    f.send(ack, randomUUID(), 0),
    f.send(ack, ackOperation, 0),
    f.send({ ...ack, command: "dismiss" }, randomUUID(), 0),
    f.send(f.command, f.operation),
  ]);
  try {
    await waitForQueuedResources(6);
  } finally {
    await unlock();
  }
  const denied = await pending;
  for (const result of denied) expect(result.error?.code).toBe("42501");
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${allocation}' and dismissed_at is not null;`
    )
  ).toBe("0");
}, 60000);
