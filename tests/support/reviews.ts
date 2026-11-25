import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { workFixture } from "./work";
import { client } from "./hosts";
import { agenda, command } from "./execution";
import { decide, guestJoins, participantId } from "./sessions";
import { sql } from "./database";
import type { ReviewSnapshot } from "../../lib/reviews";

export async function reviewFixture(
  partial = false,
  content = agenda(),
  answers?: Record<string, string>
) {
  sql(
    "update public.resource_capability set enabled=true; update public.review_capability set enabled=true; insert into public.execution_capacity values(true,1000,clock_timestamp()+interval '1 hour') on conflict(singleton) do update set max_live=1000,valid_until=excluded.valid_until;"
  );
  content.activities.push({
    ...content.activities[1],
    id: "a3",
    title: "After review",
  });
  const x = await workFixture(content);
  expect(
    (
      await x.send(
        answers
          ? { ...x.request, content: answers }
          : partial
            ? { ...x.request, content: { f1: "Synthetic explanation", f2: "" } }
            : x.request
      )
    ).error
  ).toBeNull();
  const submitted = await x.send(
    partial
      ? {
          ...x.submit(),
          command: "submit_incomplete",
          reason: "Synthetic missing field",
        }
      : x.submit()
  );
  expect(submitted.error).toBeNull();
  const attempt = submitted.data.attempt as string;
  const people = [{ id: x.person, hash: x.guest.hash }];
  for (const name of ["Synthetic Reviewer", "Synthetic Excluded"]) {
    const guest = await guestJoins(x.key, name);
    const id = await participantId(x.host, x.session);
    expect((await decide(x.host, id, "admit")).error).toBeNull();
    people.push({ id, hash: guest.hash });
  }
  expect((await command(x.host, x.session, 2, "next")).error).toBeNull();
  const send = (request: object, person?: number, operation = randomUUID()) =>
    (person === undefined ? x.host : client()).rpc("review_command", {
      p_session: x.session,
      p_operation: operation,
      p_request: request,
      p_host: person === undefined,
      p_credential_hash: person === undefined ? null : people.at(person)!.hash,
    });
  const read = (person?: number, proposal?: string, offset = 0) =>
    (person === undefined ? x.host : client()).rpc("read_reviews", {
      p_session: x.session,
      p_host: person === undefined,
      p_credential_hash: person === undefined ? null : people.at(person)!.hash,
      p_proposal: proposal ?? null,
      p_offset: offset,
    });
  const create = (patch: object = {}) => ({
    command: "create",
    proposal: randomUUID(),
    attempt,
    fields: ["f1"],
    recipients: [people[1].id],
    activity: "a2",
    ...patch,
  });
  async function approved() {
    const r = create();
    expect((await send(r)).error).toBeNull();
    expect(
      (await send({ command: "request", proposal: r.proposal })).error
    ).toBeNull();
    expect(
      (await send({ command: "approve", proposal: r.proposal }, 0)).error
    ).toBeNull();
    return r.proposal;
  }
  async function preview(id: string) {
    const r = await read(undefined, id);
    expect(r.error).toBeNull();
    return (r.data as ReviewSnapshot).preview!;
  }
  const resources = (person = 1, allocation?: string) =>
    client().rpc("read_resources", {
      p_session: x.session,
      p_host: false,
      p_credential_hash: people.at(person)!.hash,
      p_allocation: allocation ?? null,
    });
  return {
    ...x,
    workSend: x.send,
    workRead: x.read,
    people,
    attempt,
    send,
    read,
    create,
    approved,
    preview,
    resources,
  };
}
