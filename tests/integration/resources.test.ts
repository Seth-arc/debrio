import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { resourceFixture } from "../support/resources";
import { client } from "../support/hosts";
import { sql } from "../support/database";
import { groupPlan, type GroupSnapshot } from "../../lib/groups";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseEnv } from "../../scripts/local-supabase";
import { decide, guestJoins, participantId } from "../support/sessions";

test("resource drafts conflict and retry exactly; ready versions preserve old content", async () => {
  const f = await resourceFixture();
  const id = randomUUID();
  const operation = randomUUID();
  const save = {
    command: "save",
    resource: id,
    revision: 0,
    title: "Literal <script> title",
    kind: "text",
    content: "Synthetic <b>literal</b> brief",
  };
  const [a, b] = await Promise.all([
    f.library(save, operation),
    f.library(save, operation),
  ]);
  expect(a.error).toBeNull();
  expect(b.data).toEqual(a.data);
  expect(
    (await f.library({ ...save, content: "changed" }, operation)).error?.message
  ).toBe("operation_reused");
  expect((await f.library(save)).error?.message).toBe("resource_conflict");
  const ready = await f.library({
    command: "ready",
    resource: id,
    revision: 1,
  });
  expect(ready.error).toBeNull();
  expect(
    (await f.library({ ...save, revision: 1, content: "Correction" })).error
  ).toBeNull();
  expect(
    (await f.library({ command: "ready", resource: id, revision: 2 })).error
  ).toBeNull();
  const detail = (await f.readLibrary(id)).resource!;
  expect(detail.versions.map((v) => v.content)).toEqual([
    "Correction",
    save.content,
  ]);
  expect(
    (await client().rpc("read_resource_library", { p_workspace: f.workspace }))
      .error
  ).not.toBeNull();
  for (const invalid of [
    { ...save, resource: randomUUID(), title: null },
    { ...save, resource: randomUUID(), content: undefined },
    { ...save, resource: randomUUID(), content: "x".repeat(20001) },
    { ...save, resource: randomUUID(), kind: "attempt", attempt: randomUUID() },
  ])
    expect((await f.library(invalid)).error).not.toBeNull();
}, 30000);

test("manual release is scoped, immutable, retry-safe and notices acknowledge only current generations", async () => {
  const f = await resourceFixture();
  const r = await f.resource();
  const scheduled = f.proposal(r.version);
  expect((await f.confirm(scheduled)).error).toBeNull();
  expect((await f.snapshot(0)).items).toEqual([]);
  expect((await f.read(0, scheduled.allocation)).error?.message).toBe(
    "not_allowed"
  );
  expect((await f.execute("start")).error).toBeNull();
  const release = { ...scheduled, command: "release" as const, revision: 1 };
  const p = await f.preview(release);
  const operation = randomUUID();
  const first = await f.send({ ...release, token: p.token }, operation);
  expect(first.error).toBeNull();
  expect(
    (await f.send({ ...release, token: p.token }, operation)).data
  ).toEqual(first.data);
  const allowed = await f.snapshot(0, scheduled.allocation);
  expect(allowed.detail?.content).toBe("Synthetic private brief");
  expect(allowed.items[0].notice?.generation).toBe(1);
  expect((await f.snapshot(1)).items).toEqual([]);
  expect((await f.read(1, scheduled.allocation)).error?.message).toBe(
    "not_allowed"
  );
  expect(
    (
      await f.send(
        { command: "ack", allocation: scheduled.allocation, generation: 1 },
        randomUUID(),
        1
      )
    ).error?.message
  ).toBe("not_allowed");
  expect(
    (
      await f.send(
        { command: "ack", allocation: scheduled.allocation, generation: 1 },
        randomUUID(),
        0
      )
    ).error
  ).toBeNull();
  expect(
    (
      await f.send(
        { command: "dismiss", allocation: scheduled.allocation, generation: 1 },
        randomUUID(),
        0
      )
    ).error
  ).toBeNull();
  expect((await f.snapshot()).items[0].recipients?.[0].delivery).toBe(
    "Received by active device"
  );
  expect(
    (
      await f.send({
        command: "revoke",
        allocation: scheduled.allocation,
        participant: f.people[0].id,
        reason: "Synthetic withdrawal",
      })
    ).error
  ).toBeNull();
  expect((await f.snapshot(0)).items).toEqual([]);
  expect(
    (await f.send({ ...release, token: p.token }, operation)).error
  ).toBeNull();
  expect((await f.snapshot(0)).items).toEqual([]);
  const current = (await f.snapshot()).items[0];
  const excluded = await f.preview({
    ...scheduled,
    command: "audience",
    revision: current.revision,
    selectors: [
      ...scheduled.selectors,
      { kind: "individual", id: f.people[1].id },
    ],
  });
  expect(excluded.excluded).toEqual([
    {
      participant: f.people[0].id,
      name: "Synthetic resource recipient",
      reason: "Explicitly revoked; requires named restoration",
    },
  ]);
  expect(excluded.recipients.map((p) => p.participant)).toEqual([
    f.people[1].id,
  ]);
  const audience = {
    ...scheduled,
    command: "audience" as const,
    revision: current.revision,
    restore: [f.people[0].id],
  };
  expect((await f.confirm(audience)).error).toBeNull();
  const restored = await f.snapshot(0);
  expect(restored.items[0].notice).toMatchObject({
    generation: 2,
    dismissed: false,
    received: false,
  });
  expect(
    (
      await f.send(
        { command: "ack", allocation: scheduled.allocation, generation: 1 },
        randomUUID(),
        0
      )
    ).error?.message
  ).toBe("not_allowed");
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${scheduled.allocation}'`
    )
  ).toBe("2");
}, 30000);

test("scheduled resources join Start and Next atomically and obsolete clients cannot bypass them", async () => {
  const f = await resourceFixture();
  const r = await f.resource();
  const a = f.proposal(r.version, { trigger: "start" });
  const b = f.proposal(r.version, { trigger: "activity", activity: "a1" });
  const c = f.proposal(r.version, { trigger: "activity", activity: "a2" });
  for (const p of [a, b, c]) expect((await f.confirm(p)).error).toBeNull();
  const initial = await f.executionPreview();
  expect(initial.resources.items).toHaveLength(2);
  const oldClientsDenied = async (
    command: string,
    state: { revision: number; context: string }
  ) => {
    for (const rpc of [
      "execution_command",
      "execution_command_v2",
      "execution_command_v3",
    ]) {
      const old = await f.host.rpc(rpc, {
        p_session: f.session,
        p_operation: randomUUID(),
        p_revision: state.revision,
        p_command: command,
        ...(rpc === "execution_command" ? {} : { p_context: state.context }),
      });
      expect(old.error?.message).toBe("resource_prerequisite");
    }
  };
  await oldClientsDenied("start", initial);
  expect((await f.execute("start", initial)).error).toBeNull();
  expect((await f.snapshot(0)).items).toHaveLength(2);
  expect((await f.execute("pause")).error).toBeNull();
  expect((await f.execute("resume")).error).toBeNull();
  expect((await f.snapshot(0)).items).toHaveLength(2);
  const next = await f.executionPreview();
  await oldClientsDenied("next", next);
  const op = randomUUID();
  expect((await f.execute("next", next, op)).error).toBeNull();
  expect((await f.execute("next", next, op)).error).toBeNull();
  expect((await f.snapshot(0)).items).toHaveLength(3);
}, 30000);

test("stale roster and one invalid due audience refuse the entire transition", async () => {
  const f = await resourceFixture();
  const r = await f.resource();
  const first = f.proposal(r.version, { trigger: "start" });
  const second = f.proposal(r.version, {
    trigger: "start",
    selectors: [{ kind: "group", id: randomUUID() }],
  });
  expect((await f.confirm(first)).error).toBeNull();
  expect((await f.confirm(second)).error).toBeNull();
  const invalid = await f.executionPreview();
  expect(invalid.resources.problems.length).toBeGreaterThan(0);
  expect((await f.execute("start", invalid)).error?.message).toBe(
    "resource_prerequisite"
  );
  expect((await f.executionPreview()).state).toBe("ready");
  expect((await f.snapshot(0)).items).toEqual([]);
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id in ('${first.allocation}','${second.allocation}')`
    )
  ).toBe("0");
  expect(
    (
      await f.send({
        command: "cancel",
        allocation: second.allocation,
        revision: 1,
      })
    ).error
  ).toBeNull();
  const stale = await f.executionPreview();
  await f.join("Late synthetic participant");
  expect((await f.execute("start", stale)).error?.message).toBe(
    "stale_execution"
  );
  expect((await f.execute("start")).error).toBeNull();
  expect((await f.snapshot(2)).items).toEqual([]);
}, 30000);

test("gate disable drains writes while reads, revoke and safe execution remain available", async () => {
  const f = await resourceFixture();
  const r = await f.resource();
  const a = f.proposal(r.version, { trigger: "start" });
  expect((await f.confirm(a)).error).toBeNull();
  const stale = await f.executionPreview();
  sql("update public.resource_capability set enabled=false");
  expect((await f.execute("start", stale)).error?.message).toBe(
    "stale_execution"
  );
  expect((await f.execute("start")).error?.message).toBe(
    "resource_unavailable"
  );
  expect(
    (
      await f.library({
        command: "save",
        resource: randomUUID(),
        revision: 0,
        title: "Gate",
        kind: "text",
        content: "Denied",
      })
    ).error?.message
  ).toBe("resource_unavailable");
  sql("update public.resource_capability set enabled=true");
  expect((await f.execute("start")).error).toBeNull();
  sql("update public.resource_capability set enabled=false");
  expect((await f.snapshot(0)).items).toHaveLength(1);
  expect(
    (
      await f.send({
        command: "revoke",
        allocation: a.allocation,
        participant: null,
        reason: "Withdraw while disabled",
      })
    ).error
  ).toBeNull();
  expect((await f.snapshot(0)).items).toEqual([]);
  expect((await f.execute("pause")).error).toBeNull();
  expect((await f.execute("end")).error).toBeNull();
  sql("update public.resource_capability set enabled=true");
  expect((await f.snapshot(0)).items).toEqual([]);
}, 30000);

test("resource links require trusted checks and exact reviewed drafts; direct validation forgery is denied", async () => {
  const f = await resourceFixture();
  const r = await f.resource("https://example.com/synthetic", "link");
  expect(
    (await f.library({ command: "ready", resource: r.id, revision: 1 })).error
      ?.message
  ).toBe("resource_check_required");
  const begun = await f.host.rpc("begin_resource_check", {
    p_workspace: f.workspace,
    p_resource: r.id,
    p_revision: 1,
  });
  expect(begun.error).toBeNull();
  expect(
    (
      await f.host.rpc("finish_resource_check", {
        p_check: begun.data.check,
        p_outcome: "reachable",
        p_digest: "a".repeat(64),
        p_final_url: "https://example.com/synthetic",
        p_actor: f.userId,
      })
    ).error
  ).not.toBeNull();
  sql(
    `update public.resource_checks set outcome='reachable',chain_digest=repeat('a',64),final_url='https://example.com/synthetic',checked_at=clock_timestamp(),expires_at=clock_timestamp()+interval '5 minutes' where id='${begun.data.check}'`
  );
  expect(
    (await f.library({ command: "ready", resource: r.id, revision: 1 })).error
      ?.message
  ).toBe("resource_check_required");
  expect(
    (
      await f.library({
        command: "approve_check",
        check: begun.data.check,
        reviewed: true,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await f.library({
        command: "save",
        resource: r.id,
        revision: 1,
        title: "Changed",
        kind: "link",
        content: "https://example.com/changed",
      })
    ).error
  ).toBeNull();
  expect(
    (await f.library({ command: "ready", resource: r.id, revision: 2 })).error
      ?.message
  ).toBe("resource_check_required");
  for (let i = 0; i < 9; i++)
    expect(
      (
        await f.host.rpc("begin_resource_check", {
          p_workspace: f.workspace,
          p_resource: r.id,
          p_revision: 2,
        })
      ).error
    ).toBeNull();
  expect(
    (
      await f.host.rpc("begin_resource_check", {
        p_workspace: f.workspace,
        p_resource: r.id,
        p_revision: 2,
      })
    ).error?.message
  ).toBe("resource_check_limited");
}, 30000);

test("group intervals, independent direct grants and explicit late inclusion preserve notice generations", async () => {
  const f = await resourceFixture();
  const groups = async () => {
    const r = await f.host.rpc("read_groups", {
      p_session: f.session,
      p_host: true,
    });
    expect(r.error).toBeNull();
    return r.data as GroupSnapshot;
  };
  const change = async (plan: ReturnType<typeof groupPlan>) => {
    const r = await f.host.rpc("group_command", {
      p_session: f.session,
      p_operation: randomUUID(),
      p_request: { ...plan, reason: "Synthetic membership change" },
    });
    expect(r.error).toBeNull();
  };
  const initial = groupPlan(await groups());
  const key = randomUUID();
  initial.groups = [{ key, create: true }];
  initial.members = initial.members.map((m) => ({ ...m, group: key }));
  await change(initial);
  const gid = (await groups()).groups![0].id;
  const resource = await f.resource();
  const scheduled = f.proposal(resource.version, {
    trigger: "start",
    selectors: [
      { kind: "group", id: gid },
      { kind: "individual", id: f.people[0].id },
    ],
  });
  expect((await f.preview(scheduled)).recipients).toHaveLength(2);
  expect((await f.confirm(scheduled)).error).toBeNull();
  expect((await f.execute("start")).error).toBeNull();
  const notice0 = (await f.snapshot(0)).items[0].notice!.id;
  expect((await f.snapshot(1)).items).toHaveLength(1);
  expect(
    (
      await f.send(
        { command: "dismiss", allocation: scheduled.allocation, generation: 1 },
        randomUUID(),
        0
      )
    ).error
  ).toBeNull();
  const leave = groupPlan(await groups());
  leave.members = leave.members.map((m) => ({
    ...m,
    group: m.participant === f.people[1].id ? null : m.group,
  }));
  await change(leave);
  expect((await f.snapshot(1)).items).toEqual([]);
  expect((await f.snapshot(0)).items[0].notice!.id).toBe(notice0);
  const rejoin = groupPlan(await groups());
  rejoin.members = rejoin.members.map((m) => ({ ...m, group: gid }));
  await change(rejoin);
  expect((await f.snapshot(1)).items).toEqual([]);
  const a = (await f.snapshot()).items[0];
  expect(
    (
      await f.confirm({
        ...scheduled,
        command: "audience",
        revision: a.revision,
      })
    ).error
  ).toBeNull();
  expect((await f.snapshot(1)).items[0].notice?.generation).toBe(2);
  expect((await f.snapshot(0)).items[0].notice).toMatchObject({
    id: notice0,
    generation: 1,
    dismissed: true,
  });
  const late = await f.join("Late admitted recipient");
  expect((await f.snapshot(late)).items).toEqual([]);
  const latest = (await f.snapshot()).items[0];
  expect(
    (
      await f.confirm({
        ...scheduled,
        command: "audience",
        revision: latest.revision,
        selectors: [
          ...scheduled.selectors,
          { kind: "individual", id: f.people.at(late)!.id },
        ],
      })
    ).error
  ).toBeNull();
  expect((await f.snapshot(late)).items).toHaveLength(1);
  const removeAll = groupPlan(await groups());
  removeAll.members = removeAll.members.map((m) => ({ ...m, group: null }));
  removeAll.groups = [];
  removeAll.retire = [gid];
  await change(removeAll);
  expect((await f.snapshot(1)).items).toEqual([]);
  expect((await f.snapshot(0)).items).toHaveLength(1);
  expect((await f.snapshot(late)).items).toHaveLength(1);
}, 60000);

test("failure before execution receipt rolls back releases, notices and execution together", async () => {
  const f = await resourceFixture();
  const r = await f.resource();
  const p = f.proposal(r.version, { trigger: "start" });
  expect((await f.confirm(p)).error).toBeNull();
  sql(
    `create function public.test_resource_receipt_failure() returns trigger language plpgsql as $$ begin if new.session_id='${f.session}'::uuid then raise exception 'synthetic_receipt_failure'; end if; return new; end $$; create trigger test_resource_receipt_failure before insert on public.execution_commands for each row execute function public.test_resource_receipt_failure();`
  );
  try {
    expect((await f.execute("start")).error?.message).toBe(
      "synthetic_receipt_failure"
    );
    expect((await f.executionPreview()).state).toBe("ready");
    expect((await f.snapshot(0)).items).toEqual([]);
    expect(
      sql(
        `select count(*) from public.resource_recipients where allocation_id='${p.allocation}'`
      )
    ).toBe("0");
    expect(
      sql(
        `select count(*) from public.resource_notices where allocation_id='${p.allocation}'`
      )
    ).toBe("0");
  } finally {
    sql(
      "drop trigger test_resource_receipt_failure on public.execution_commands; drop function public.test_resource_receipt_failure();"
    );
  }
  expect((await f.execute("start")).error).toBeNull();
  expect((await f.snapshot(0)).items).toHaveLength(1);
}, 30000);

test("public authoring and scheduling enforce Unicode, selector, allocation and pagination ceilings", async () => {
  const f = await resourceFixture();
  const id = randomUUID();
  const max = {
    command: "save",
    resource: id,
    revision: 0,
    title: "😀".repeat(120),
    kind: "text",
    content: "😀".repeat(20000),
  };
  expect((await f.library(max)).error).toBeNull();
  expect(
    (
      await f.library({
        ...max,
        resource: randomUUID(),
        title: "😀".repeat(121),
      })
    ).error?.message
  ).toBe("invalid_resource");
  const ready = await f.library({
    command: "ready",
    resource: id,
    revision: 1,
  });
  expect(ready.error).toBeNull();
  const r = ready.data.version as string;
  const hundred = f.proposal(r, {
    selectors: Array.from({ length: 100 }, () => ({
      kind: "individual" as const,
      id: f.people[0].id,
    })),
  });
  expect((await f.preview(hundred)).recipients).toHaveLength(1);
  expect(
    (
      await f.host.rpc("resource_preview", {
        p_session: f.session,
        p_request: {
          ...hundred,
          selectors: [...hundred.selectors, hundred.selectors[0]],
        },
      })
    ).error?.message
  ).toBe("invalid_resource");
  // A populated-boundary fixture avoids issuing 100 equivalent setup commands; the boundary is exercised through the public command.
  sql(
    `insert into public.resource_allocations(id,session_id,workspace_id,agenda_version,resource_version,trigger,selectors,created_by) select gen_random_uuid(),'${f.session}','${f.workspace}','${f.version.id}','${r}','manual','[{"kind":"individual","id":"${f.people[0].id}"}]'::jsonb,'${f.userId}' from generate_series(1,100);`
  );
  expect((await f.confirm(f.proposal(r))).error?.message).toBe(
    "invalid_resource"
  );
  const page = await f.snapshot();
  expect(page.items).toHaveLength(20);
  expect(page.next_offset).toBe(20);
  const last = await f.host.rpc("read_resources", {
    p_session: f.session,
    p_host: true,
    p_offset: 80,
  });
  expect(last.error).toBeNull();
  expect(last.data.items).toHaveLength(20);
  expect(last.data.next_offset).toBeNull();
  const guest = await f.snapshot(0);
  expect(guest.items).toEqual([]);
  expect(guest.next_offset).toBeNull();
  const metadata = await f.host.rpc("read_resource_library", {
    p_workspace: f.workspace,
    p_resource: id,
    p_metadata_only: true,
  });
  expect(metadata.error).toBeNull();
  expect(metadata.data.resource).toBeNull();
  expect(metadata.data.authority.versions).toEqual([r]);
  expect(JSON.stringify(metadata.data)).not.toContain("😀".repeat(121));
}, 30000);

test("twenty distinct link versions fit; a twenty-first is refused without blocking reuse", async () => {
  const f = await resourceFixture();
  const ids = Array.from({ length: 21 }, () => ({
    resource: randomUUID(),
    version: randomUUID(),
  }));
  sql(
    ids
      .map(
        (r, i) =>
          `insert into public.resources(id,workspace_id,created_by,revision,title,kind,content) values('${r.resource}','${f.workspace}','${f.userId}',1,'Synthetic link ${i}','link','https://example.com/${i}'); insert into public.resource_versions(id,workspace_id,resource_id,ordinal,draft_revision,title,kind,content,created_by) values('${r.version}','${f.workspace}','${r.resource}',1,1,'Synthetic link ${i}','link','https://example.com/${i}','${f.userId}'); ${i < 20 ? `insert into public.resource_allocations(id,session_id,workspace_id,agenda_version,resource_version,trigger,selectors,created_by) values(gen_random_uuid(),'${f.session}','${f.workspace}','${f.version.id}','${r.version}','manual','[{"kind":"individual","id":"${f.people[0].id}"}]'::jsonb,'${f.userId}');` : ""}`
      )
      .join("\n")
  );
  expect((await f.confirm(f.proposal(ids[20].version))).error?.message).toBe(
    "invalid_resource"
  );
  expect((await f.confirm(f.proposal(ids[0].version))).error).toBeNull();
  const link = "https://example.com/" + "x".repeat(2048 - 20);
  expect(link).toHaveLength(2048);
  expect(
    (
      await f.library({
        command: "save",
        resource: randomUUID(),
        revision: 0,
        title: "URL bound",
        kind: "link",
        content: link,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await f.library({
        command: "save",
        resource: randomUUID(),
        revision: 0,
        title: "URL bound",
        kind: "link",
        content: link + "x",
      })
    ).error?.message
  ).toBe("invalid_resource");
}, 30000);

test("trusted link receipts expire at final freeze, manual release and execution commit; new checks require review", async () => {
  const f = await resourceFixture();
  const r = await f.resource("https://example.com/synthetic", "link");
  const service = createClient(
    localSupabaseEnv.SUPABASE_URL,
    localSupabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  async function checked(version: string | null = null) {
    const begun = await f.host.rpc("begin_resource_check", {
      p_workspace: f.workspace,
      p_resource: r.id,
      p_revision: 1,
      p_version: version,
    });
    expect(begun.error).toBeNull();
    const finished = await service.rpc("finish_resource_check", {
      p_check: begun.data.check,
      p_outcome: "reachable",
      p_digest: "a".repeat(64),
      p_final_url: "https://example.com/synthetic",
      p_actor: f.userId,
    });
    expect(finished.error).toBeNull();
    expect(finished.data.reviewed).toBe(false);
    expect(
      (
        await f.library({
          command: "approve_check",
          check: begun.data.check,
          reviewed: true,
        })
      ).error
    ).toBeNull();
    return begun.data.check as string;
  }
  const first = await checked();
  const installDelay = (
    table: "resource_commands" | "execution_commands",
    check: string
  ) =>
    sql(
      `create function public.test_resource_expiry_delay() returns trigger language plpgsql as $$ begin update public.resource_checks set expires_at=clock_timestamp()+interval '250 milliseconds' where id='${check}'; perform pg_sleep(0.5); return new; end $$; create trigger test_resource_expiry_delay before insert on public.${table} for each row execute function public.test_resource_expiry_delay();`
    );
  const removeDelay = (table: "resource_commands" | "execution_commands") =>
    sql(
      `drop trigger test_resource_expiry_delay on public.${table}; drop function public.test_resource_expiry_delay();`
    );
  installDelay("resource_commands", first);
  try {
    expect(
      (await f.library({ command: "ready", resource: r.id, revision: 1 })).error
        ?.message
    ).toBe("resource_check_required");
    expect((await f.readLibrary(r.id)).resource?.versions).toEqual([]);
  } finally {
    removeDelay("resource_commands");
  }
  const second = await checked();
  const ready = await f.library({
    command: "ready",
    resource: r.id,
    revision: 1,
  });
  expect(ready.error).toBeNull();
  const version = ready.data.version as string;
  const scheduled = f.proposal(version, { trigger: "start" });
  expect((await f.confirm(scheduled)).error).toBeNull();
  installDelay("execution_commands", second);
  try {
    expect((await f.execute("start")).error?.message).toBe(
      "resource_check_required"
    );
    expect((await f.executionPreview()).state).toBe("ready");
    expect((await f.snapshot(0)).items).toEqual([]);
  } finally {
    removeDelay("execution_commands");
  }
  const third = await checked(version);
  expect((await f.execute("start")).error).toBeNull();
  const manual = f.proposal(version);
  expect((await f.confirm(manual)).error).toBeNull();
  installDelay("resource_commands", third);
  try {
    expect(
      (await f.confirm({ ...manual, command: "release", revision: 1 })).error
        ?.message
    ).toBe("resource_check_required");
    expect((await f.read(0, manual.allocation)).error?.message).toBe(
      "not_allowed"
    );
    expect(
      sql(
        `select count(*) from public.resource_notices where allocation_id='${manual.allocation}'`
      )
    ).toBe("0");
  } finally {
    removeDelay("resource_commands");
  }
  await checked(version);
  const pending = await f.host.rpc("begin_resource_check", {
    p_workspace: f.workspace,
    p_resource: r.id,
    p_revision: 1,
    p_version: version,
  });
  expect(pending.error).toBeNull();
  expect(
    (await f.preview({ ...manual, command: "release", revision: 1 })).problems
  ).toContain("Validate and review the exact link version before release.");
  expect(
    (
      await service.rpc("finish_resource_check", {
        p_check: pending.data.check,
        p_outcome: "reachable",
        p_digest: "b".repeat(64),
        p_final_url: "https://example.com/changed-destination",
        p_actor: f.userId,
      })
    ).error
  ).toBeNull();
  expect(
    (await f.preview({ ...manual, command: "release", revision: 1 })).problems
  ).toContain("Validate and review the exact link version before release.");
}, 60000);

test("one immutable version serves two same-workspace sessions without cross-workspace or credential access", async () => {
  const f = await resourceFixture();
  const original = await f.resource("Original fixed content");
  const second = await f.host.rpc("prepare_execution_v3", {
    p_version: f.version.id,
    p_operation: randomUUID(),
  });
  expect(second.error).toBeNull();
  const session = second.data as string;
  const row = await f.host
    .from("sessions")
    .select("join_key")
    .eq("id", session)
    .single();
  expect(row.error).toBeNull();
  const guest = await guestJoins(
    row.data!.join_key,
    "Synthetic second-session recipient"
  );
  expect(guest.joined.error).toBeNull();
  const person = await participantId(f.host, session);
  expect((await decide(f.host, person, "admit")).error).toBeNull();
  const firstAllocation = f.proposal(original.version, { trigger: "start" });
  expect((await f.confirm(firstAllocation)).error).toBeNull();
  const secondAllocation = f.proposal(original.version, {
    trigger: "start",
    selectors: [{ kind: "individual", id: person }],
  });
  const preview = await f.host.rpc("resource_preview", {
    p_session: session,
    p_request: secondAllocation,
  });
  expect(preview.error).toBeNull();
  expect(
    (
      await f.host.rpc("resource_command", {
        p_session: session,
        p_operation: randomUUID(),
        p_request: { ...secondAllocation, token: preview.data.token },
        p_host: true,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await f.library({
        command: "save",
        resource: original.id,
        revision: 1,
        title: "Corrected resource",
        kind: "text",
        content: "New content for a later allocation",
      })
    ).error
  ).toBeNull();
  expect(
    (await f.library({ command: "ready", resource: original.id, revision: 2 }))
      .error
  ).toBeNull();
  expect((await f.execute("start")).error).toBeNull();
  const execution = await f.host.rpc("host_execution_v4", {
    p_session: session,
  });
  expect(execution.error).toBeNull();
  expect(
    (
      await f.host.rpc("execution_command_v4", {
        p_session: session,
        p_operation: randomUUID(),
        p_revision: execution.data.revision,
        p_context: execution.data.context,
        p_command: "start",
      })
    ).error
  ).toBeNull();
  const own = await f.snapshot(0, firstAllocation.allocation);
  expect(own.detail).toMatchObject({
    version: original.version,
    title: "Synthetic resource",
    content: "Original fixed content",
  });
  const otherSession = await client().rpc("read_resources", {
    p_session: session,
    p_credential_hash: guest.hash,
    p_allocation: secondAllocation.allocation,
  });
  expect(otherSession.error).toBeNull();
  expect(otherSession.data.detail).toMatchObject({
    version: original.version,
    title: "Synthetic resource",
    content: "Original fixed content",
  });
  expect(
    (
      await client().rpc("read_resources", {
        p_session: session,
        p_credential_hash: f.people[0].hash,
        p_allocation: secondAllocation.allocation,
      })
    ).error?.message
  ).toBe("not_allowed");
  expect(
    (
      await client().rpc("read_resources", {
        p_session: f.session,
        p_credential_hash: guest.hash,
        p_allocation: firstAllocation.allocation,
      })
    ).error?.message
  ).toBe("not_allowed");
  expect(
    sql(
      `select count(*) from public.resource_versions where resource_id='${original.id}'`
    )
  ).toBe("2");
  expect(
    sql(
      `select count(distinct resource_version) from public.resource_allocations where id in ('${firstAllocation.allocation}','${secondAllocation.allocation}')`
    )
  ).toBe("1");
  const foreign = await resourceFixture();
  const foreignResource = await foreign.resource();
  for (const workspace of [f.workspace, foreign.workspace])
    expect(
      (
        await foreign.host.rpc("read_resource_library", {
          p_workspace: workspace,
          p_resource: original.id,
        })
      ).error?.message
    ).toBe("not_allowed");
  expect(
    (
      await foreign.library({
        command: "save",
        resource: original.id,
        revision: 2,
        title: "Foreign overwrite",
        kind: "text",
        content: "Denied",
      })
    ).error?.message
  ).toBe("not_allowed");
  expect(
    (
      await foreign.host.rpc("resource_preview", {
        p_session: f.session,
        p_request: f.proposal(original.version),
      })
    ).error?.message
  ).toBe("not_allowed");
  expect(
    (
      await foreign.host.rpc("read_resources", {
        p_session: f.session,
        p_host: true,
        p_allocation: firstAllocation.allocation,
      })
    ).error?.message
  ).toBe("not_allowed");
  expect(
    (
      await f.host.rpc("resource_preview", {
        p_session: f.session,
        p_request: f.proposal(foreignResource.version),
      })
    ).error?.message
  ).toBe("not_allowed");
  for (const as of [f.host, client()])
    for (const table of [
      "resources",
      "resource_versions",
      "resource_allocations",
      "resource_recipients",
      "resource_notices",
      "resource_checks",
      "resource_grants",
      "resource_commands",
    ]) {
      expect((await as.from(table).select("*").limit(1)).error?.code).toBe(
        "42501"
      );
    }
}, 60000);
