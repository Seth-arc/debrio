import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { agenda, command, executionHost, readyVersion } from "./execution";
import { client } from "./hosts";
import { decide, guestJoins, participantId } from "./sessions";
import type { WorkCommand } from "../../lib/work";

export async function workFixture() {
  const x = await executionHost();
  const content = agenda();
  content.activities[0].outputs.push({
    id: "f2",
    label: "Short answer",
    kind: "short",
  });
  const version = await readyVersion(x.host, content);
  const prepared = await x.host.rpc("prepare_execution", {
    p_version: version.id,
    p_operation: randomUUID(),
  });
  expect(prepared.error).toBeNull();
  const session = prepared.data as string;
  const key = (
    await x.host.from("sessions").select("join_key").eq("id", session).single()
  ).data!.join_key;
  const guest = await guestJoins(key);
  const person = await participantId(x.host, session);
  expect((await decide(x.host, person, "admit")).error).toBeNull();
  expect((await command(x.host, session, 1, "start")).error).toBeNull();
  const request: WorkCommand = {
    command: "save",
    participant: person,
    version: version.id,
    activity: "a1",
    revision: 0,
    latest: 0,
    window_revision: 0,
    reason: "",
    content: { f1: "Synthetic explanation", f2: "Yes" },
  };
  const send = (
    body: unknown = request,
    operation = randomUUID(),
    hash = guest.hash,
    as = client()
  ) =>
    as.rpc("work_command", {
      p_session: session,
      p_operation: operation,
      p_request: body,
      p_credential_hash: hash,
    });
  const read = (hash = guest.hash, as = client(), host = false) =>
    as.rpc("read_work", {
      p_session: session,
      p_credential_hash: hash,
      p_host: host,
    });
  const submit = (revision = 1, latest = 0, reason = ""): WorkCommand => {
    const { content: _content, ...body } = request;
    void _content;
    return { ...body, command: "submit", revision, latest, reason };
  };
  return {
    ...x,
    version,
    session,
    key,
    guest,
    person,
    request,
    send,
    read,
    submit,
  };
}
