import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, expect, test } from "vitest";
import { localSupabaseEnv } from "../../scripts/local-supabase";
import { groupPlan, type GroupSnapshot } from "../../lib/groups";
import { resourceFixture } from "../support/resources";
import { sql } from "../support/database";
import { client } from "../support/hosts";
import { decide, guestJoins, participantId } from "../support/sessions";

afterEach(() => sql("update public.resource_capability set enabled=false;"));

async function released() {
  const f = await resourceFixture();
  const resource = await f.resource();
  const allocation = f.proposal(resource.version);
  expect((await f.confirm(allocation)).error).toBeNull();
  expect((await f.execute("start")).error).toBeNull();
  expect(
    (await f.confirm({ ...allocation, command: "release", revision: 1 })).error
  ).toBeNull();
  return { ...f, resource, allocation };
}

test("AC5/6: multiple due Next releases are atomic and competing confirmations cannot double release while paused", async () => {
  const f = await resourceFixture();
  const resource = await f.resource();
  const plans = [
    f.proposal(resource.version, { trigger: "activity", activity: "a2" }),
    f.proposal(resource.version, {
      trigger: "activity",
      activity: "a2",
      selectors: [{ kind: "individual", id: f.people[1].id }],
    }),
    f.proposal(resource.version, {
      trigger: "activity",
      activity: "a2",
      selectors: [{ kind: "group", id: randomUUID() }],
    }),
  ];
  for (const plan of plans) expect((await f.confirm(plan)).error).toBeNull();
  expect((await f.execute("start")).error).toBeNull();
  sql(
    `update public.session_execution set activity_due_at=clock_timestamp()-interval '1 minute' where session_id='${f.session}';`
  );
  expect((await f.snapshot(0)).items).toEqual([]);
  expect((await f.executionPreview()).current.id).toBe("a1");
  const invalid = await f.executionPreview();
  expect(invalid.resources.items).toHaveLength(3);
  expect((await f.execute("next", invalid)).error?.message).toBe(
    "resource_prerequisite"
  );
  expect((await f.executionPreview()).current.id).toBe("a1");
  expect(
    sql(
      `select count(*) from public.resource_notices n join public.resource_allocations a on a.id=n.allocation_id where a.session_id='${f.session}';`
    )
  ).toBe("0");
  expect(
    (
      await f.send({
        command: "cancel",
        allocation: plans[2].allocation,
        revision: 1,
      })
    ).error
  ).toBeNull();
  const ready = await f.executionPreview();
  expect(ready.resources.items).toHaveLength(2);
  const advances = await Promise.all([
    f.execute("next", ready, randomUUID()),
    f.execute("next", ready, randomUUID()),
  ]);
  expect(advances.filter((r) => !r.error)).toHaveLength(1);
  expect(advances.find((r) => r.error)?.error?.message).toBe("stale_execution");
  expect((await f.snapshot(0)).items).toHaveLength(1);
  expect((await f.snapshot(1)).items).toHaveLength(1);
  expect(
    sql(
      `select count(*) from public.execution_commands where session_id='${f.session}' and request->>'command'='next';`
    )
  ).toBe("1");
  const manual = f.proposal(resource.version);
  expect((await f.confirm(manual)).error).toBeNull();
  expect((await f.execute("pause")).error).toBeNull();
  const p = await f.preview({ ...manual, command: "release", revision: 1 });
  const command = { ...p.request, token: p.token };
  const releases = await Promise.all([
    f.send(command, randomUUID()),
    f.send(command, randomUUID()),
  ]);
  expect(releases.filter((r) => !r.error)).toHaveLength(1);
  expect(releases.find((r) => r.error)?.error?.message).toBe(
    "resource_conflict"
  );
  expect((await f.executionPreview()).state).toBe("paused");
  expect((await f.snapshot(0)).items).toHaveLength(2);
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${manual.allocation}'`
    )
  ).toBe("1");
}, 60000);

test("AC12: targeted retry, duplicate acknowledgement and dismissal preserve one notice; old dismissal cannot suppress regrant", async () => {
  const f = await released();
  const id = f.allocation.allocation;
  const original = (await f.snapshot(0)).items[0].notice!;
  const notice = () =>
    sql(
      `select row_to_json(n)::text from public.resource_notices n where allocation_id='${id}' order by generation desc limit 1;`
    );
  const before = notice();
  const retry = {
    command: "retry",
    allocation: id,
    participants: [f.people[0].id],
  };
  const retryOperation = randomUUID();
  expect((await f.send(retry, retryOperation)).error).toBeNull();
  expect((await f.send(retry, retryOperation)).error).toBeNull();
  expect((await f.send(retry)).error).toBeNull();
  expect(notice()).toBe(before);
  const ack = { command: "ack", allocation: id, generation: 1 };
  const ackOperation = randomUUID();
  const acknowledgements = await Promise.all([
    f.send(ack, ackOperation, 0),
    f.send(ack, ackOperation, 0),
  ]);
  expect(acknowledgements.every((r) => r.error === null)).toBe(true);
  expect(acknowledgements[0].data).toEqual(acknowledgements[1].data);
  const acknowledged = notice();
  expect((await f.send(ack, randomUUID(), 0)).error).toBeNull();
  expect(notice()).toBe(acknowledged);
  expect((await f.send(retry)).error?.message).toBe("stale_resource");
  const dismiss = { command: "dismiss", allocation: id, generation: 1 };
  const dismissOperation = randomUUID();
  expect((await f.send(dismiss, dismissOperation, 0)).error).toBeNull();
  const dismissed = notice();
  expect((await f.send(dismiss, dismissOperation, 0)).error).toBeNull();
  expect((await f.send(dismiss, randomUUID(), 0)).error).toBeNull();
  expect(notice()).toBe(dismissed);
  expect(
    (
      await f.send({
        command: "revoke",
        allocation: id,
        participant: f.people[0].id,
        reason: "Synthetic notice withdrawal",
      })
    ).error
  ).toBeNull();
  const current = (await f.snapshot()).items[0];
  expect(
    (
      await f.confirm({
        ...f.allocation,
        command: "audience",
        revision: current.revision,
        restore: [f.people[0].id],
      })
    ).error
  ).toBeNull();
  expect((await f.send(dismiss, dismissOperation, 0)).error?.message).toBe(
    "not_allowed"
  );
  expect((await f.send(dismiss, randomUUID(), 0)).error?.message).toBe(
    "not_allowed"
  );
  const restored = (await f.snapshot(0)).items[0].notice!;
  expect(restored).toMatchObject({
    generation: 2,
    dismissed: false,
    received: false,
  });
  expect(restored.id).not.toBe(original.id);
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${id}'`
    )
  ).toBe("2");
}, 60000);

test("AC3: a trusted link check finishing after a saved draft edit cannot validate or freeze the newer URL", async () => {
  const f = await resourceFixture();
  const r = await f.resource("https://example.com/old", "link");
  const service = createClient(
    localSupabaseEnv.SUPABASE_URL,
    localSupabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const begin = (revision: number) =>
    f.host.rpc("begin_resource_check", {
      p_workspace: f.workspace,
      p_resource: r.id,
      p_revision: revision,
    });
  const old = await begin(1);
  expect(old.error).toBeNull();
  expect(old.data.url).toBe("https://example.com/old");
  expect(
    (
      await f.library({
        command: "save",
        resource: r.id,
        revision: 1,
        title: "New URL",
        kind: "link",
        content: "https://example.com/new",
      })
    ).error
  ).toBeNull();
  const finish = (check: string, url: string) =>
    service.rpc("finish_resource_check", {
      p_check: check,
      p_outcome: "reachable",
      p_digest: "a".repeat(64),
      p_final_url: url,
      p_actor: f.userId,
    });
  expect(
    (await finish(old.data.check, "https://example.com/old")).error?.message
  ).toBe("resource_conflict");
  expect(
    (
      await f.library({
        command: "approve_check",
        check: old.data.check,
        reviewed: true,
      })
    ).error?.message
  ).toBe("resource_check_required");
  expect(
    (await f.library({ command: "ready", resource: r.id, revision: 2 })).error
      ?.message
  ).toBe("resource_check_required");
  expect((await f.readLibrary(r.id)).resource?.versions).toEqual([]);
  const fresh = await begin(2);
  expect(fresh.error).toBeNull();
  expect(fresh.data.url).toBe("https://example.com/new");
  expect((await finish(fresh.data.check, fresh.data.url)).error).toBeNull();
  expect(
    (
      await f.library({
        command: "approve_check",
        check: fresh.data.check,
        reviewed: true,
      })
    ).error
  ).toBeNull();
  expect(
    (await f.library({ command: "ready", resource: r.id, revision: 2 })).error
  ).toBeNull();
  expect((await f.readLibrary(r.id)).resource?.versions[0].content).toBe(
    "https://example.com/new"
  );
}, 30000);

test("AC4: multiple-group shared/direct union is named once and unavailable selected identities block release", async () => {
  const f = await resourceFixture();
  await f.join("Synthetic third recipient");
  const foreign = await resourceFixture();
  const resource = await f.resource();
  const groups = async () => {
    const r = await f.host.rpc("read_groups", {
      p_session: f.session,
      p_host: true,
    });
    expect(r.error).toBeNull();
    return r.data as GroupSnapshot;
  };
  const plan = groupPlan(await groups());
  const one = randomUUID(),
    two = randomUUID();
  plan.groups = [
    { key: one, create: true },
    { key: two, create: true },
  ];
  plan.members = plan.members.map((m) => ({
    ...m,
    group: m.participant === f.people[1].id ? two : one,
  }));
  expect(
    (
      await f.host.rpc("group_command", {
        p_session: f.session,
        p_operation: randomUUID(),
        p_request: plan,
      })
    ).error
  ).toBeNull();
  const assigned = await groups();
  const first = assigned.members.find(
    (m) => m.participant === f.people[0].id
  )!.group!;
  const second = assigned.members.find(
    (m) => m.participant === f.people[1].id
  )!.group!;
  const union = f.proposal(resource.version, {
    trigger: "start",
    selectors: [
      { kind: "group", id: first },
      { kind: "group", id: second },
      { kind: "individual", id: f.people[0].id },
      { kind: "shared", id: null },
    ],
  });
  const p = await f.preview(union);
  expect(p.problems).toEqual([]);
  expect(p.recipients.map((r) => r.participant).sort()).toEqual(
    f.people.map((r) => r.id).sort()
  );
  expect(
    p.recipients.filter((r) => r.name === "Synthetic resource recipient")
  ).toHaveLength(2);
  expect(
    p.recipients.find((r) => r.participant === f.people[0].id)?.bases
  ).toHaveLength(3);
  expect((await f.confirm(union)).error).toBeNull();
  expect((await f.execute("start")).error).toBeNull();
  for (const person of [0, 1, 2])
    expect((await f.snapshot(person)).items).toHaveLength(1);
  const waiting = await guestJoins(f.key, "Synthetic waiting recipient");
  expect(waiting.joined.error).toBeNull();
  const waitingId = await participantId(f.host, f.session);
  expect((await decide(f.host, f.people[2].id, "remove")).error).toBeNull();
  for (const id of [waitingId, f.people[2].id, foreign.people[0].id]) {
    const unavailable = f.proposal(resource.version, {
      selectors: [{ kind: "individual", id }],
    });
    expect((await f.preview(unavailable)).problems).toContain(
      `Selected individual is not admitted: ${id}`
    );
    expect((await f.confirm(unavailable)).error).toBeNull();
    expect(
      (await f.confirm({ ...unavailable, command: "release", revision: 1 }))
        .error?.message
    ).toBe("resource_prerequisite");
    expect(
      sql(
        `select count(*) from public.resource_recipients where allocation_id='${unavailable.allocation}'`
      )
    ).toBe("0");
  }
  const retire = groupPlan(await groups());
  retire.members = retire.members.map((m) => ({
    ...m,
    group: m.group === second ? null : m.group,
  }));
  retire.groups = retire.groups.filter((g) => g.key !== second);
  retire.retire = [second];
  retire.reason = "Synthetic retired group boundary";
  expect(
    (
      await f.host.rpc("group_command", {
        p_session: f.session,
        p_operation: randomUUID(),
        p_request: retire,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await f.preview(
        f.proposal(resource.version, {
          selectors: [{ kind: "group", id: second }],
        })
      )
    ).problems
  ).toContain(`Selected group is empty, retired or unavailable: ${second}`);
  expect(
    (
      await f.host.rpc("resource_preview", {
        p_session: f.session,
        p_request: f.proposal(resource.version, {
          trigger: "activity",
          activity: "missing-activity",
        }),
      })
    ).error?.message
  ).toBe("invalid_resource");
}, 60000);

test("AC2: workshop duplication copies no resource release, recipient, notice or private work", async () => {
  const f = await released();
  expect(
    (
      await client().rpc("work_command", {
        p_session: f.session,
        p_operation: randomUUID(),
        p_credential_hash: f.people[0].hash,
        p_request: {
          command: "save",
          participant: f.people[0].id,
          version: f.version.id,
          activity: "a1",
          revision: 0,
          latest: 0,
          window_revision: 0,
          reason: "",
          content: { f1: "Private original answer" },
        },
      })
    ).error
  ).toBeNull();
  const data = () =>
    sql(
      [
        "resources",
        "resource_versions",
        "resource_allocations",
        "resource_recipients",
        "resource_notices",
        "session_participants",
        "work_items",
        "work_attempts",
      ]
        .map(
          (table) =>
            `select '${table}',md5(coalesce(string_agg(row_to_json(t)::text,E'\\n' order by row_to_json(t)::text),'')) from public.${table} t;`
        )
        .join("\n")
    );
  const before = data();
  const copied = await f.host.rpc("duplicate_workshop", {
    p_workshop: f.version.workshop,
    p_operation: randomUUID(),
  });
  expect(copied.error).toBeNull();
  expect(data()).toBe(before);
  const draft = await f.host
    .from("workshop_versions")
    .select("id,revision,state")
    .eq("workshop_id", copied.data.id)
    .single();
  expect(draft.error).toBeNull();
  expect(draft.data!.state).toBe("draft");
  expect(
    (
      await f.host.rpc("resource_preview", {
        p_session: f.session,
        p_request: f.proposal(f.resource.id),
      })
    ).error?.message
  ).toBe("not_allowed");
  expect(
    (
      await f.host.rpc("mark_workshop_ready", {
        p_version: draft.data!.id,
        p_expected_revision: draft.data!.revision,
      })
    ).error
  ).toBeNull();
  const prepared = await f.host.rpc("prepare_execution_v3", {
    p_version: draft.data!.id,
    p_operation: randomUUID(),
  });
  expect(prepared.error).toBeNull();
  const session = prepared.data as string;
  for (const table of [
    "resource_allocations",
    "resource_recipients",
    "session_participants",
    "work_items",
    "work_attempts",
  ])
    expect(
      sql(`select count(*) from public.${table} where session_id='${session}';`)
    ).toBe("0");
  expect((await f.snapshot(0, f.allocation.allocation)).detail?.content).toBe(
    "Synthetic private brief"
  );
}, 60000);

test("AC5/14: an unswept four-hour deadline blocks release and audience expansion without renewing old grants", async () => {
  const f = await released();
  const manual = f.proposal(f.resource.version);
  expect((await f.confirm(manual)).error).toBeNull();
  const release = await f.preview({
    ...manual,
    command: "release",
    revision: 1,
  });
  const audience = await f.preview({
    ...f.allocation,
    command: "audience",
    revision: 2,
    selectors: [{ kind: "shared", id: null }],
  });
  sql(
    `alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=statement_timestamp()-interval '4 hours 1 second',deadline=statement_timestamp()-interval '1 second' where session_id='${f.session}'; alter table public.session_execution enable trigger execution_identity_frozen;`
  );
  expect(
    sql(
      `select state||':'||(ended_at is null)::text from public.sessions where id='${f.session}'`
    )
  ).toBe("open:true");
  const deadline = sql(
    `select deadline::text from public.session_execution where session_id='${f.session}'`
  );
  expect(
    (await f.send({ ...release.request, token: release.token })).error?.message
  ).toBe("resource_closed");
  expect(
    (await f.send({ ...audience.request, token: audience.token })).error
      ?.message
  ).toBe("resource_closed");
  expect((await f.confirm(f.proposal(f.resource.version))).error?.message).toBe(
    "resource_closed"
  );
  expect((await f.snapshot(0, f.allocation.allocation)).detail?.content).toBe(
    "Synthetic private brief"
  );
  expect((await f.snapshot(1)).items).toEqual([]);
  expect((await f.read(0, manual.allocation)).error?.message).toBe(
    "not_allowed"
  );
  expect(
    sql(
      `select deadline::text from public.session_execution where session_id='${f.session}'`
    )
  ).toBe(deadline);
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${manual.allocation}'`
    )
  ).toBe("0");
}, 30000);
