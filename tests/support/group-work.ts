import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { agenda, readyVersion } from "./execution";
import { hostWithSession, guestJoins, participantId, decide } from "./sessions";
import { client } from "./hosts";
import { sql } from "./database";
import { groupPlan, type GroupSnapshot } from "../../lib/groups";
import type {
  GroupDraft,
  GroupWorkCommand,
  GroupWorkSnapshot,
} from "../../lib/group-work";

export async function groupWorkFixture(
  start = true,
  mixed = false,
  linked = false
) {
  sql(
    "update public.group_work_capability set enabled=true; insert into public.execution_capacity values(true,1000,clock_timestamp()+interval '1 hour') on conflict(singleton) do update set max_live=1000,valid_until=excluded.valid_until;"
  );
  if (linked) sql("update public.input_capability set enabled=true;");
  const owner = await hostWithSession();
  const content = agenda();
  content.activities[0].scope = "group";
  content.activities[0].outputs.push({
    id: "f2",
    label: "Short answer",
    kind: "short",
  });
  if (linked) {
    content.activities[1].scope = "group";
    content.activities[1].input = { activity: "a1", field: "f1" };
  }
  if (mixed)
    content.activities.unshift({
      ...agenda().activities[0],
      id: "a0",
      title: "Private warmup",
    });
  const version = await readyVersion(owner.host, content);
  const prepared = await owner.host.rpc(
    linked ? "prepare_execution_v3" : "prepare_execution_v2",
    {
      p_version: version.id,
      p_operation: randomUUID(),
    }
  );
  expect(prepared.error).toBeNull();
  const sessionId = prepared.data as string;
  const { data: session } = await owner.host
    .from("sessions")
    .select("join_key,workspace_id")
    .eq("id", sessionId)
    .single();
  sql(
    `insert into public.execution_eligibility values ('${session!.workspace_id}',clock_timestamp()+interval '1 hour') on conflict(workspace_id) do update set valid_until=excluded.valid_until;`
  );
  const people = [] as { id: string; hash: string }[];
  for (const name of ["Synthetic Same", "Synthetic Same", "Synthetic Verbal"]) {
    const g = await guestJoins(session!.join_key, name);
    const id = await participantId(owner.host, sessionId);
    expect((await decide(owner.host, id, "admit")).error).toBeNull();
    people.push({ id, hash: g.hash });
  }
  const read = async (person?: number) => {
    const result = await (person === undefined ? owner.host : client()).rpc(
      "read_group_work",
      {
        p_session: sessionId,
        p_host: person === undefined,
        p_credential_hash:
          person === undefined ? null : people.at(person)!.hash,
      }
    );
    expect(result.error).toBeNull();
    return result.data as GroupWorkSnapshot;
  };
  const groupsRead = async () => {
    const r = await owner.host.rpc("read_groups", {
      p_session: sessionId,
      p_host: true,
    });
    expect(r.error).toBeNull();
    return r.data as GroupSnapshot;
  };
  const plan = groupPlan(await groupsRead());
  const keys = [randomUUID(), randomUUID(), randomUUID()];
  plan.groups = keys.map((key) => ({ key, create: true }));
  plan.members = plan.members.map((m) => ({ ...m, group: keys[0] }));
  const assigned = await owner.host.rpc("group_command", {
    p_session: sessionId,
    p_operation: randomUUID(),
    p_request: plan,
  });
  expect(assigned.error).toBeNull();
  const groups = keys.map(
    (k) =>
      Object.entries(assigned.data.groups).find(
        ([key]) => key === k
      )![1] as string
  );
  const recorder = async (
    person: number | null,
    group = groups[0],
    context?: string,
    operation = randomUUID()
  ) =>
    owner.host.rpc("recorder_command", {
      p_session: sessionId,
      p_operation: operation,
      p_request: {
        group,
        recorder: person === null ? null : people.at(person)!.id,
        context: context ?? (await read()).context,
        reason: "Synthetic replacement",
      },
    });
  expect((await recorder(0)).error).toBeNull();
  const execute = async (command: string, context?: string) => {
    const snap = await read();
    const linkedState = linked
      ? await owner.host.rpc("host_execution_v3", { p_session: sessionId })
      : null;
    if (linkedState) expect(linkedState.error).toBeNull();
    return owner.host.rpc(
      linked ? "execution_command_v3" : "execution_command_v2",
      {
        p_session: sessionId,
        p_operation: randomUUID(),
        p_revision: snap.coordination!.execution,
        p_command: command,
        p_context: context ?? linkedState?.data?.context ?? snap.context,
      }
    );
  };
  if (start) expect((await execute("start")).error).toBeNull();
  const draft = async (person?: number, group = groups[0], activity = "a1") => {
    const s = await read(person);
    const item = s.items.find(
      (x) => x.group === group && x.activity.id === activity
    );
    expect(item?.draft_access).toBe(true);
    return { snapshot: s, item: item as GroupDraft };
  };
  const request = async (
    command: GroupWorkCommand["command"],
    extras: Partial<GroupWorkCommand> = {},
    person = 0,
    group = groups[0]
  ) => {
    const { snapshot: s, item } = await draft(
      ["reopen", "close", "accept_partial"].includes(command)
        ? undefined
        : person,
      group,
      extras.activity ?? "a1"
    );
    return {
      command,
      group,
      activity: item.activity.id,
      version: s.version,
      context: s.context,
      token: item.token,
      window_revision: item.window_revision,
      reason: "",
      ...extras,
    } satisfies GroupWorkCommand;
  };
  const send = (
    request: GroupWorkCommand,
    person: number | null = 0,
    operation = randomUUID()
  ) =>
    (person === null ? owner.host : client()).rpc("group_work_command", {
      p_session: sessionId,
      p_operation: operation,
      p_request: request,
      p_credential_hash: person === null ? null : people.at(person)!.hash,
    });
  const save = async (text = "Consolidated", person = 0) => {
    const { item } = await draft(person);
    const r = await send(
      await request(
        "answer",
        {
          revision: item.revision,
          content: { f1: text, f2: "Short" },
          sources: {},
        },
        person
      ),
      person
    );
    expect(r.error).toBeNull();
    return r;
  };
  const move = async (person: number, group: string | null) => {
    const p = groupPlan(await groupsRead());
    p.reason = "Synthetic reassignment";
    p.members = p.members.map((m) =>
      m.participant === people.at(person)!.id ? { ...m, group } : m
    );
    return owner.host.rpc("group_command", {
      p_session: sessionId,
      p_operation: randomUUID(),
      p_request: p,
    });
  };
  return {
    ...owner,
    sessionId,
    key: session!.join_key as string,
    version,
    people,
    groups,
    read,
    draft,
    request,
    send,
    save,
    move,
    recorder,
    execute,
    groupsRead,
  };
}
