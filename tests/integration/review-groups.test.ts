import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { groupWorkFixture } from "../support/group-work";
import { holdTransaction, sql } from "../support/database";
import { groupPlan } from "../../lib/groups";
import { client } from "../support/hosts";
import type { GroupWorkCommand } from "../../lib/group-work";

async function fixture() {
  sql(
    "update public.review_capability set enabled=true;update public.resource_capability set enabled=true;"
  );
  const x = await groupWorkFixture(false);
  const send = (request: object, person?: number) =>
    (person === undefined ? x.host : client()).rpc("review_command", {
      p_session: x.sessionId,
      p_operation: randomUUID(),
      p_request: request,
      p_host: person === undefined,
      p_credential_hash:
        person === undefined ? null : x.people.at(person)!.hash,
    });
  const read = (person?: number) =>
    (person === undefined ? x.host : client()).rpc("read_reviews", {
      p_session: x.sessionId,
      p_host: person === undefined,
      p_credential_hash:
        person === undefined ? null : x.people.at(person)!.hash,
    });
  return { ...x, review: send, reviews: read };
}
test("prospective disclosure gates all current members and captures verbal-member evidence before review", async () => {
  const x = await fixture();
  expect((await x.move(2, x.groups[1])).error).toBeNull();
  expect((await x.recorder(2, x.groups[1])).error).toBeNull();
  expect(
    (await x.review({ command: "enable_policy", activity: "a1" })).error
  ).toBeNull();
  expect((await x.execute("start")).error).toBeNull();
  expect((await x.read(0)).items).toEqual([]);
  const host = await x.draft();
  const pending: GroupWorkCommand = {
    command: "answer",
    group: x.groups[0],
    activity: "a1",
    version: x.version.id,
    context: host.snapshot.context,
    token: host.item.token,
    window_revision: 0,
    revision: 0,
    content: { f1: "Synthetic group answer", f2: "Yes" },
    sources: {},
    reason: "",
  };
  expect((await x.send(pending)).error?.message).toBe(
    "review_disclosure_required"
  );
  expect(
    (
      await x.review(
        {
          command: "ack_policy",
          activity: "a1",
          group: x.groups[0],
          policy: 1,
        },
        0
      )
    ).error
  ).toBeNull();
  const acknowledged = (await x.read(0)).items[0];
  expect(acknowledged.draft_access).toBe(true);
  if (!acknowledged.draft_access)
    throw Error("Expected acknowledged member draft");
  expect(acknowledged.writable).toBe(false);
  expect(
    (
      await x.review(
        {
          command: "ack_policy",
          activity: "a1",
          group: x.groups[0],
          policy: 1,
        },
        1
      )
    ).error
  ).toBeNull();
  await x.save("Synthetic shared field");
  const submitted = await x.send(await x.request("submit"));
  expect(submitted.error).toBeNull();
  const attempt = submitted.data.attempt;
  expect(
    sql(
      `select jsonb_array_length(review_disclosure->'people') from public.work_attempts where id='${attempt}';`
    )
  ).toBe("2");
  expect((await x.execute("next")).error).toBeNull();
  const proposal = randomUUID();
  expect(
    (
      await x.review({
        command: "create",
        proposal,
        attempt,
        fields: ["f1"],
        recipients: [x.people[2].id],
        activity: "a2",
      })
    ).error
  ).toBeNull();
  const preview = await x.host.rpc("read_reviews", {
    p_session: x.sessionId,
    p_host: true,
    p_proposal: proposal,
  });
  expect(preview.error).toBeNull();
  expect(preview.data.preview.problems).toEqual([]);
  expect(
    (
      await x.review({
        command: "release",
        proposal,
        token: preview.data.preview.token,
      })
    ).error
  ).toBeNull();
  const resource = await client().rpc("read_resources", {
    p_session: x.sessionId,
    p_credential_hash: x.people[2].hash,
    p_host: false,
    p_allocation: proposal,
  });
  expect(resource.error).toBeNull();
  expect(resource.data.detail.review.fields[0].value).toBe(
    "Synthetic shared field"
  );
  expect(JSON.stringify(resource.data)).not.toContain("Synthetic Verbal");
  expect((await x.move(2, x.groups[0])).error).toBeNull();
  expect(
    (
      await client().rpc("read_resources", {
        p_session: x.sessionId,
        p_credential_hash: x.people[2].hash,
        p_host: false,
        p_allocation: proposal,
      })
    ).error
  ).toBeNull();
}, 60000);

test("disclosed group submission serializes with late membership and recorder replacement in both orders", async () => {
  for (const change of ["join", "recorder"])
    for (const first of ["change", "submit"]) {
      const x = await fixture();
      expect((await x.move(2, x.groups[1])).error).toBeNull();
      expect((await x.recorder(2, x.groups[1])).error).toBeNull();
      expect(
        (await x.review({ command: "enable_policy", activity: "a1" })).error
      ).toBeNull();
      expect((await x.execute("start")).error).toBeNull();
      for (const person of [0, 1])
        expect(
          (
            await x.review(
              {
                command: "ack_policy",
                activity: "a1",
                group: x.groups[0],
                policy: 1,
              },
              person
            )
          ).error
        ).toBeNull();
      await x.save();
      const submit = await x.request("submit");
      const plan = groupPlan(await x.groupsRead());
      plan.reason = "Synthetic late join";
      plan.members = plan.members.map((m) =>
        m.participant === x.people[2].id ? { ...m, group: x.groups[0] } : m
      );
      const context = (await x.read()).context;
      const start = (kind: string) =>
        (kind === "submit"
          ? x.send(submit)
          : change === "join"
            ? x.host.rpc("group_command", {
                p_session: x.sessionId,
                p_operation: randomUUID(),
                p_request: plan,
              })
            : x.recorder(1, x.groups[0], context)
        ).then((r) => r);
      const unlock = await holdTransaction(
        `select 1 from public.sessions where id='${x.sessionId}' for update`
      );
      const queued = (n: number) =>
        unlock.waitForQueries(
          "query like '%group_command%' or query like '%group_work_command%' or query like '%recorder_command%'",
          n
        );
      const a = start(first);
      await queued(1);
      const b = start(first === "submit" ? "change" : "submit");
      try {
        await queued(2);
      } finally {
        await unlock();
      }
      const result = await Promise.all([a, b]);
      expect(result[first === "change" ? 0 : 1].error).toBeNull();
      const submission = result[first === "submit" ? 0 : 1];
      if (first === "submit") expect(submission.error).toBeNull();
      else expect(submission.error).not.toBeNull();
      const saved = (await x.draft()).item;
      expect(saved.content.f1).toBe("Consolidated");
      expect(saved.attempts).toHaveLength(first === "submit" ? 1 : 0);
      if (saved.attempts[0]) {
        expect(saved.attempts[0].submitted_by).toBe(x.people[0].id);
        expect(
          saved.attempts[0].snapshot.roster.map((p) => p.participant)
        ).not.toContain(x.people[2].id);
        expect(
          sql(
            `select jsonb_array_length(review_disclosure->'people') from public.work_attempts where id='${saved.attempts[0].id}';`
          )
        ).toBe("2");
      }
    }
}, 120000);

test("a committed submission receipt survives a late member disclosure wait without allowing new writes", async () => {
  const x = await fixture();
  expect((await x.move(2, x.groups[1])).error).toBeNull();
  expect((await x.recorder(2, x.groups[1])).error).toBeNull();
  expect(
    (await x.review({ command: "enable_policy", activity: "a1" })).error
  ).toBeNull();
  expect((await x.execute("start")).error).toBeNull();
  for (const person of [0, 1])
    expect(
      (
        await x.review(
          {
            command: "ack_policy",
            activity: "a1",
            group: x.groups[0],
            policy: 1,
          },
          person
        )
      ).error
    ).toBeNull();
  await x.save();
  const request = await x.request("submit"),
    operation = randomUUID();
  const committed = await x.send(request, 0, operation);
  expect(committed.error).toBeNull();
  expect((await x.move(2, x.groups[0])).error).toBeNull();
  const retry = await x.send(request, 0, operation);
  expect(retry.error).toBeNull();
  expect(retry.data).toEqual(committed.data);
  expect((await x.send(await x.request("submit"))).error?.message).toBe(
    "review_disclosure_required"
  );
  expect((await x.draft()).item.attempts).toHaveLength(1);
}, 30000);

test("late members atomically pause group writes until disclosure; legacy work cannot be made shareable retroactively", async () => {
  const x = await fixture();
  expect((await x.move(2, x.groups[1])).error).toBeNull();
  expect((await x.recorder(2, x.groups[1])).error).toBeNull();
  expect(
    (await x.review({ command: "enable_policy", activity: "a1" })).error
  ).toBeNull();
  expect((await x.execute("start")).error).toBeNull();
  for (const person of [0, 1])
    expect(
      (
        await x.review(
          {
            command: "ack_policy",
            activity: "a1",
            group: x.groups[0],
            policy: 1,
          },
          person
        )
      ).error
    ).toBeNull();
  await x.save();
  expect((await x.move(1, x.groups[1])).error).toBeNull();
  expect((await x.move(1, x.groups[0])).error).toBeNull();
  expect((await x.read(1)).items).toEqual([]);
  expect((await x.send(await x.request("submit"))).error?.message).toBe(
    "review_disclosure_required"
  );
  expect(
    (
      await x.review(
        {
          command: "ack_policy",
          activity: "a1",
          group: x.groups[0],
          policy: 1,
        },
        1
      )
    ).error
  ).toBeNull();
  expect((await x.move(2, x.groups[0])).error).toBeNull();
  const next = await x.request("submit");
  expect((await x.send(next)).error?.message).toBe(
    "review_disclosure_required"
  );
  expect(
    (await x.reviews()).data.policies.find(
      (p: { group: string }) => p.group === x.groups[0]
    ).pending
  ).toHaveLength(1);
  expect(
    (
      await x.review(
        {
          command: "ack_policy",
          activity: "a1",
          group: x.groups[0],
          policy: 1,
        },
        2
      )
    ).error
  ).toBeNull();
  expect((await x.send(await x.request("submit"))).error).toBeNull();
  const legacy = await groupWorkFixture();
  await legacy.save();
  expect((await legacy.send(await legacy.request("submit"))).error).toBeNull();
  const enabled = await legacy.host.rpc("review_command", {
    p_session: legacy.sessionId,
    p_operation: randomUUID(),
    p_request: { command: "enable_policy", activity: "a1" },
    p_host: true,
  });
  expect(enabled.error?.message).toBe("invalid_review");
  const old = (await legacy.read()).items[0].attempts[0].id;
  expect((await legacy.execute("next")).error).toBeNull();
  expect(
    (
      await legacy.host.rpc("review_command", {
        p_session: legacy.sessionId,
        p_operation: randomUUID(),
        p_request: {
          command: "create",
          proposal: randomUUID(),
          attempt: old,
          fields: ["f1"],
          recipients: [legacy.people[2].id],
          activity: "a2",
        },
        p_host: true,
      })
    ).error?.message
  ).toBe("invalid_review");
}, 60000);
