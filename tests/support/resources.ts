import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { executionHost } from "./execution";
import { client } from "./hosts";
import { decide, guestJoins, participantId } from "./sessions";
import { sql } from "./database";
import type {
  ResourceProposal,
  ResourceSnapshot,
  ResourcePreview,
  ResourceLibrary,
} from "../../lib/resources";

export async function resourceFixture() {
  sql(
    "update public.resource_capability set enabled=true; insert into public.execution_capacity values(true,1000,clock_timestamp()+interval '1 hour') on conflict(singleton) do update set max_live=1000,valid_until=excluded.valid_until;"
  );
  const x = await executionHost();
  const session = x.sessionId;
  const people: { id: string; hash: string }[] = [];
  async function join(name = "Synthetic resource recipient") {
    const g = await guestJoins(x.key, name);
    expect(g.joined.error).toBeNull();
    const id = await participantId(x.host, session);
    expect((await decide(x.host, id, "admit")).error).toBeNull();
    people.push({ id, hash: g.hash });
    return people.length - 1;
  }
  await join();
  await join();
  const library = (request: object, operation = randomUUID()) =>
    x.host.rpc("resource_library_command", {
      p_workspace: x.workspace,
      p_operation: operation,
      p_request: request,
    });
  async function resource(
    content = "Synthetic private brief",
    kind: "text" | "link" = "text"
  ) {
    const id = randomUUID();
    const saved = await library({
      command: "save",
      resource: id,
      revision: 0,
      title: "Synthetic resource",
      kind,
      content,
    });
    expect(saved.error).toBeNull();
    if (kind === "link") return { id, version: "", revision: 1 };
    const ready = await library({
      command: "ready",
      resource: id,
      revision: 1,
    });
    expect(ready.error).toBeNull();
    return { id, version: ready.data.version as string, revision: 1 };
  }
  async function readLibrary(id: string | null = null) {
    const r = await x.host.rpc("read_resource_library", {
      p_workspace: x.workspace,
      p_resource: id,
    });
    expect(r.error).toBeNull();
    return r.data as ResourceLibrary;
  }
  const proposal = (
    version: string,
    patch: Partial<ResourceProposal> = {}
  ): ResourceProposal => ({
    command: "schedule",
    allocation: randomUUID(),
    revision: 0,
    version,
    trigger: "manual",
    activity: null,
    selectors: [{ kind: "individual", id: people[0].id }],
    restore: [],
    reason: "Synthetic host confirmation",
    ...patch,
  });
  const send = (request: object, operation = randomUUID(), person?: number) =>
    (person === undefined ? x.host : client()).rpc("resource_command", {
      p_session: session,
      p_operation: operation,
      p_request: request,
      p_host: person === undefined,
      p_credential_hash: person === undefined ? null : people.at(person)!.hash,
    });
  async function preview(request: ResourceProposal) {
    const r = await x.host.rpc("resource_preview", {
      p_session: session,
      p_request: request,
    });
    expect(r.error).toBeNull();
    return r.data as ResourcePreview;
  }
  async function confirm(request: ResourceProposal, operation = randomUUID()) {
    const p = await preview(request);
    return send({ ...request, token: p.token }, operation);
  }
  const read = (person?: number, allocation: string | null = null) =>
    (person === undefined ? x.host : client()).rpc("read_resources", {
      p_session: session,
      p_host: person === undefined,
      p_credential_hash: person === undefined ? null : people.at(person)!.hash,
      p_allocation: allocation,
    });
  async function snapshot(person?: number, allocation: string | null = null) {
    const r = await read(person, allocation);
    expect(r.error).toBeNull();
    return r.data as ResourceSnapshot;
  }
  async function executionPreview() {
    const r = await x.host.rpc("host_execution_v4", { p_session: session });
    expect(r.error).toBeNull();
    return r.data;
  }
  async function execute(
    command: string,
    state?: Awaited<ReturnType<typeof executionPreview>>,
    operation = randomUUID()
  ) {
    const s = state ?? (await executionPreview());
    return x.host.rpc("execution_command_v4", {
      p_session: session,
      p_operation: operation,
      p_command: command,
      p_revision: s.revision,
      p_context: s.context,
    });
  }
  return {
    ...x,
    session,
    people,
    join,
    library,
    resource,
    readLibrary,
    proposal,
    send,
    preview,
    confirm,
    read,
    snapshot,
    executionPreview,
    execute,
  };
}
