import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { agenda, executionHost, readyVersion } from "./execution";
import { client } from "./hosts";
import { decide, guestJoins, participantId } from "./sessions";
import { sql } from "./database";
import type { WorkCommand } from "../../lib/work";

export async function inputFixture() {
  sql(
    "update public.input_capability set enabled=true; insert into public.execution_capacity values(true,1000,clock_timestamp()+interval '1 hour') on conflict(singleton) do update set max_live=1000,valid_until=excluded.valid_until;"
  );
  const x = await executionHost();
  const content = agenda();
  content.activities[0].outputs.push({
    id: "f2",
    label: "Private other field",
    kind: "short",
  });
  content.activities[1].input = { activity: "a1", field: "f1" };
  const version = await readyVersion(x.host, content);
  const prepared = await x.host.rpc("prepare_execution_v3", {
    p_version: version.id,
    p_operation: randomUUID(),
  });
  expect(prepared.error).toBeNull();
  const session = prepared.data as string;
  const key = (
    await x.host.from("sessions").select("join_key").eq("id", session).single()
  ).data!.join_key;
  const people: { id: string; hash: string }[] = [];
  const join = async () => {
    const g = await guestJoins(key, "Synthetic input participant");
    const id = await participantId(x.host, session);
    expect((await decide(x.host, id, "admit")).error).toBeNull();
    people.push({ id, hash: g.hash });
    return people.length - 1;
  };
  await join();
  const preview = async () => {
    const r = await x.host.rpc("host_execution_v3", { p_session: session });
    expect(r.error).toBeNull();
    return r.data;
  };
  const execute = async (
    command: string,
    state?: Awaited<ReturnType<typeof preview>>,
    operation = randomUUID()
  ) => {
    const s = state ?? (await preview());
    return x.host.rpc("execution_command_v3", {
      p_session: session,
      p_operation: operation,
      p_command: command,
      p_revision: s.revision,
      p_context: s.context,
    });
  };
  expect((await execute("start")).error).toBeNull();
  const request = (
    patch: Partial<WorkCommand> = {},
    person = 0
  ): WorkCommand => ({
    command: "save",
    participant: people.at(person)!.id,
    version: version.id,
    activity: "a1",
    revision: 0,
    latest: 0,
    window_revision: 0,
    reason: "",
    content: { f1: "Selected synthetic field", f2: "Unrelated private answer" },
    ...patch,
  });
  const send = (body: WorkCommand, person = 0, op = randomUUID()) =>
    client().rpc("work_command", {
      p_session: session,
      p_operation: op,
      p_request: body,
      p_credential_hash: people.at(person)!.hash,
    });
  const submit = async (person = 0) => {
    expect((await send(request({}, person), person)).error).toBeNull();
    const { content: _, ...r } = request(
      { command: "submit", revision: 1 },
      person
    );
    void _;
    const result = await send(r, person);
    expect(result.error).toBeNull();
    return result.data.attempt as string;
  };
  const read = (person = 0) =>
    client().rpc("read_inputs", {
      p_session: session,
      p_credential_hash: people.at(person)!.hash,
    });
  const manage = (request: object, operation = randomUUID()) =>
    x.host.rpc("input_command", {
      p_session: session,
      p_operation: operation,
      p_request: request,
    });
  return {
    ...x,
    version,
    session,
    people,
    join,
    preview,
    execute,
    request,
    send,
    submit,
    read,
    manage,
  };
}
