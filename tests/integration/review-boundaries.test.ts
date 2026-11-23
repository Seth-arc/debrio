import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { reviewFixture } from "../support/reviews";
import { holdTransaction, sql } from "../support/database";
import { command } from "../support/execution";
import { decide, guestJoins, participantId } from "../support/sessions";
import { client } from "../support/hosts";

test("an expired server preview token cannot confirm a release", async () => {
  const x = await reviewFixture(),
    id = await x.approved();
  const old = (await x.preview(id)).token;
  await new Promise((resolve) => setTimeout(resolve, 15100));
  expect(
    (await x.send({ command: "release", proposal: id, token: old })).error
      ?.message
  ).toBe("stale_review");
  expect((await x.resources()).data.items).toEqual([]);
  expect(
    (
      await x.send({
        command: "release",
        proposal: id,
        token: (await x.preview(id)).token,
      })
    ).error
  ).toBeNull();
}, 30000);

async function queued(count: number) {
  await expect
    .poll(
      () =>
        Number(
          sql(
            "select count(*) from pg_stat_activity where wait_event_type='Lock' and (query like '%review_command%' or query like '%read_resources%' or query like '%decide_participant%');"
          )
        ),
      { timeout: 10000 }
    )
    .toBeGreaterThanOrEqual(count);
}

test("withdrawal and release resolve both lock orders without restoring a grant", async () => {
  for (const first of ["withdraw", "release"]) {
    const x = await reviewFixture(),
      id = await x.approved();
    const release = {
      command: "release",
      proposal: id,
      token: (await x.preview(id)).token,
    };
    const unlock = await holdTransaction(
      `select 1 from public.sessions where id='${x.session}' for update`
    );
    const start = (cmd: string) =>
      x
        .send(
          cmd === "release" ? release : { command: "withdraw", proposal: id },
          cmd === "withdraw" ? 0 : undefined
        )
        .then((r) => r);
    const a = start(first);
    await queued(1);
    const b = start(first === "withdraw" ? "release" : "withdraw");
    try {
      await queued(2);
    } finally {
      await unlock();
    }
    const results = await Promise.all([a, b]);
    expect(results[first === "withdraw" ? 0 : 1].error).toBeNull();
    if (first === "withdraw")
      expect(results[1].error?.message).toBe("review_closed");
    else expect(results[0].error).toBeNull();
    expect((await x.resources()).data.items).toEqual([]);
    expect((await x.resources()).data.notices).toEqual([]);
  }
}, 60000);

test("removal racing release denies the removed recipient in either serialization order", async () => {
  for (const first of ["remove", "release"]) {
    const x = await reviewFixture(),
      id = await x.approved(),
      token = (await x.preview(id)).token;
    const unlock = await holdTransaction(
      `select 1 from public.sessions where id='${x.session}' for update`
    );
    const start = (cmd: string) =>
      (cmd === "remove"
        ? decide(x.host, x.people[1].id, "remove")
        : x.send({ command: "release", proposal: id, token })
      ).then((r) => r);
    const a = start(first);
    await queued(1);
    const b = start(first === "remove" ? "release" : "remove");
    try {
      await queued(2);
    } finally {
      await unlock();
    }
    const results = await Promise.all([a, b]);
    expect(results[first === "remove" ? 0 : 1].error).toBeNull();
    expect((await x.resources()).error?.message).toBe("not_allowed");
    expect(
      sql(
        `select count(*) from public.resource_notices where allocation_id='${id}';`
      )
    ).toBe(first === "remove" ? "0" : "1");
  }
}, 60000);

test("correction preserves the consumed version and source deletion has no content fallback", async () => {
  const x = await reviewFixture(),
    id = await x.approved();
  expect(
    (
      await x.send({
        command: "release",
        proposal: id,
        token: (await x.preview(id)).token,
      })
    ).error
  ).toBeNull();
  const before = (await x.resources(1, id)).data.detail.review;
  const base = x.submit(1, 1, "Explicit correction");
  expect(
    (
      await x.workSend(
        { ...base, command: "reopen" },
        randomUUID(),
        x.guest.hash,
        x.host
      )
    ).error
  ).toBeNull();
  expect(
    (
      await x.workSend({
        ...x.request,
        revision: 1,
        latest: 1,
        window_revision: 1,
        content: { f1: "Changed synthetic answer", f2: "Yes" },
      })
    ).error
  ).toBeNull();
  expect(
    (await x.workSend({ ...x.submit(2, 1, "Correction"), window_revision: 1 }))
      .error
  ).toBeNull();
  expect((await x.resources(1, id)).data.detail.review).toEqual(before);
  const older = x.create();
  expect((await x.send(older)).error).toBeNull();
  expect((await x.preview(older.proposal)).newer_version).toBe(true);
  // Erasure is a privileged fixture, not a new product deletion endpoint.
  sql(
    `delete from public.work_commands where session_id='${x.session}'; delete from public.work_attempts where session_id='${x.session}' and ordinal=2; delete from public.work_attempts where id='${x.attempt}';`
  );
  expect((await x.resources()).data.items).toEqual([]);
  expect((await x.resources(1, id)).error?.message).toBe("not_allowed");
  expect(
    (await x.read()).data.items.every(
      (p: { source: unknown }) => p.source === null
    )
  ).toBe(true);
}, 60000);

test("capability disable permits withdrawal and drains a pending release without reviving closed rights", async () => {
  const x = await reviewFixture(),
    id = await x.approved();
  expect(
    (
      await x.send({
        command: "release",
        proposal: id,
        token: (await x.preview(id)).token,
      })
    ).error
  ).toBeNull();
  sql("update public.review_capability set enabled=false;");
  expect((await x.resources()).data.items).toHaveLength(1);
  expect((await x.send(x.create())).error?.message).toBe("review_unavailable");
  expect(
    (await x.send({ command: "withdraw", proposal: id }, 0)).error
  ).toBeNull();
  sql("update public.review_capability set enabled=true;");
  expect((await x.resources()).data.items).toEqual([]);
}, 30000);

test("named recipient revocation and close deny direct reads and acknowledgements without affecting own history", async () => {
  const x = await reviewFixture(),
    r = x.create({ recipients: [x.people[1].id, x.people[2].id] });
  expect((await x.send(r)).error).toBeNull();
  expect(
    (await x.send({ command: "request", proposal: r.proposal })).error
  ).toBeNull();
  expect(
    (await x.send({ command: "approve", proposal: r.proposal }, 0)).error
  ).toBeNull();
  expect(
    (
      await x.send({
        command: "release",
        proposal: r.proposal,
        token: (await x.preview(r.proposal)).token,
      })
    ).error
  ).toBeNull();
  expect(
    (
      await x.send({
        command: "revoke",
        proposal: r.proposal,
        participant: x.people[1].id,
        reason: "Synthetic access revoked",
      })
    ).error
  ).toBeNull();
  expect((await x.resources(1, r.proposal)).error?.message).toBe("not_allowed");
  expect((await x.resources(1)).data.notices).toEqual([]);
  expect((await x.resources(2)).data.items).toHaveLength(1);
  expect(
    (
      await client().rpc("resource_command", {
        p_session: x.session,
        p_operation: randomUUID(),
        p_host: false,
        p_credential_hash: x.people[1].hash,
        p_request: { command: "ack", allocation: r.proposal, generation: 1 },
      })
    ).error?.message
  ).toBe("not_allowed");
  expect(
    (
      await x.send({
        command: "close",
        proposal: r.proposal,
        reason: "Review finished",
      })
    ).error
  ).toBeNull();
  expect((await x.resources(2)).data.items).toEqual([]);
  expect((await x.workRead()).data.items[0].attempts[0].id).toBe(x.attempt);
}, 30000);

test("foreign session sources, proposal IDs and credentials cannot cross the Evidence boundary", async () => {
  const x = await reviewFixture(),
    other = await reviewFixture(),
    id = await x.approved();
  expect(
    (await other.send(other.create({ attempt: x.attempt }))).error?.message
  ).toBe("invalid_review");
  expect(
    (await other.send({ command: "request", proposal: id })).error?.message
  ).toBe("not_allowed");
  expect((await other.read(undefined, id)).error?.message).toBe("not_allowed");
  expect(
    (
      await client().rpc("read_reviews", {
        p_session: x.session,
        p_host: false,
        p_credential_hash: other.people[1].hash,
      })
    ).error?.message
  ).toBe("not_allowed");
  expect(
    (
      await x.send({
        command: "release",
        proposal: id,
        token: (await x.preview(id)).token,
      })
    ).error
  ).toBeNull();
  expect((await other.resources(1, id)).error?.message).toBe("not_allowed");
}, 30000);

test("review views use the earlier host authorization and source retention leases", async () => {
  const x = await reviewFixture(),
    id = await x.approved();
  const token = (await x.host.auth.getSession()).data.session!.access_token;
  const authSession = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString()
  ).session_id;
  sql(
    `update auth.sessions set not_after=clock_timestamp()+interval '3 seconds' where id='${authSession}';`
  );
  const host = await x.read();
  expect(host.error).toBeNull();
  expect(host.data.ttl_ms).toBeGreaterThan(0);
  expect(host.data.ttl_ms).toBeLessThan(3000);
  sql(`update auth.sessions set not_after=null where id='${authSession}';`);
  expect((await command(x.host, x.session, 3, "end")).error).toBeNull();
  // Model the absolute retained-session boundary without changing work ownership.
  sql(
    `update public.sessions set ended_at=clock_timestamp()-interval '90 days'+interval '3 seconds' where id='${x.session}';`
  );
  const author = await x.read(0);
  expect(author.error).toBeNull();
  expect(author.data.ttl_ms).toBeGreaterThan(0);
  expect(author.data.ttl_ms).toBeLessThan(3000);
  expect(author.data.items[0].id).toBe(id);
}, 30000);

test("credential recovery keeps the named grant while old-device reads and acknowledgements fail", async () => {
  const x = await reviewFixture(),
    id = await x.approved();
  expect(
    (
      await x.send({
        command: "release",
        proposal: id,
        token: (await x.preview(id)).token,
      })
    ).error
  ).toBeNull();
  const old = x.people[1].hash;
  const recovered = await guestJoins(x.key, "Synthetic recovered reviewer", {
    returning: true,
  });
  expect(
    (
      await x.host.rpc("restore_participant", {
        p_request: await participantId(x.host, x.session),
        p_target: x.people[1].id,
      })
    ).error
  ).toBeNull();
  expect((await x.resources()).error?.message).toBe("not_allowed");
  x.people[1].hash = recovered.hash;
  expect((await x.resources(1, id)).data.detail.review.attempt).toBe(x.attempt);
  expect(
    (
      await client().rpc("resource_command", {
        p_session: x.session,
        p_operation: randomUUID(),
        p_host: false,
        p_credential_hash: old,
        p_request: { command: "ack", allocation: id, generation: 1 },
      })
    ).error?.message
  ).toBe("not_allowed");
}, 30000);
