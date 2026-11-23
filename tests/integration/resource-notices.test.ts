import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { sql } from "../support/database";
import { resourceFixture } from "../support/resources";

afterEach(() => sql("update public.resource_capability set enabled=false;"));

test("AC7/12: off-page release notices remain scoped, acknowledgeable and generation-safe", async () => {
  const f = await resourceFixture();
  const resource = await f.resource("Body must not appear in notice polling");
  // Seed the populated page boundary; public Start performs all twenty releases.
  const prefix = `00000000${randomUUID().slice(8, 24)}`;
  const ids = Array.from(
    { length: 20 },
    (_, i) => `${prefix}${String(i + 1).padStart(12, "0")}`
  );
  sql(
    ids
      .map(
        (id) =>
          `insert into public.resource_allocations(id,session_id,workspace_id,agenda_version,resource_version,trigger,selectors,created_by) values('${id}','${f.session}','${f.workspace}','${f.version.id}','${resource.version}','start','[{"kind":"individual","id":"${f.people[0].id}"}]','${f.userId}');`
      )
      .join("\n")
  );
  expect((await f.execute("start")).error).toBeNull();
  const hidden = await f.resource("Unrelated hidden resource body");
  expect(
    (
      await f.library({
        command: "save",
        resource: hidden.id,
        revision: 1,
        title: "Unrelated hidden resource title",
        kind: "text",
        content: "Unrelated hidden resource body",
      })
    ).error
  ).toBeNull();
  const hiddenReady = await f.library({
    command: "ready",
    resource: hidden.id,
    revision: 2,
  });
  expect(hiddenReady.error).toBeNull();
  const other = f.proposal(hiddenReady.data.version, {
    selectors: [{ kind: "individual", id: f.people[1].id }],
  });
  expect((await f.confirm(other)).error).toBeNull();
  expect(
    (await f.confirm({ ...other, command: "release", revision: 1 })).error
  ).toBeNull();
  const unreleased = f.proposal(hiddenReady.data.version);
  expect((await f.confirm(unreleased)).error).toBeNull();
  const late = f.proposal(resource.version, {
    allocation: `ffffffff-ffff-4fff-8fff-${randomUUID().slice(-12)}`,
  });
  expect((await f.confirm(late)).error).toBeNull();
  expect(
    (await f.confirm({ ...late, command: "release", revision: 1 })).error
  ).toBeNull();

  const page = await f.snapshot(0);
  expect(page.items.map((r) => r.allocation)).toEqual(ids);
  expect(page.next_offset).toBe(20);
  expect(page.notices).toHaveLength(21);
  expect(
    page.notices.every(
      (n) => Object.keys(n).sort().join() === "allocation,notice,ordinal,title"
    )
  ).toBe(true);
  const notice = page.notices.find((n) => n.allocation === late.allocation)!;
  expect(notice).toMatchObject({
    ordinal: 1,
    notice: { generation: 1, received: false, dismissed: false },
  });
  expect(JSON.stringify(page)).not.toContain("Unrelated hidden");
  expect(JSON.stringify(page)).not.toContain("Body must not appear");
  expect((await f.snapshot()).notices).toEqual([]);
  expect((await f.snapshot(1)).notices.map((n) => n.allocation)).toEqual([
    other.allocation,
  ]);
  const second = await f.host.rpc("read_resources", {
    p_session: f.session,
    p_host: false,
    p_credential_hash: f.people[0].hash,
    p_offset: 20,
  });
  expect(second.error).toBeNull();
  expect(second.data.notices).toEqual(page.notices);
  expect(
    second.data.items.map((r: { allocation: string }) => r.allocation)
  ).toEqual([late.allocation]);

  const ack = { command: "ack", allocation: late.allocation, generation: 1 };
  const operation = randomUUID();
  expect((await f.send(ack, operation, 0)).error).toBeNull();
  expect((await f.send(ack, operation, 0)).error).toBeNull();
  expect(
    (await f.snapshot(0)).notices.find((n) => n.allocation === late.allocation)
      ?.notice
  ).toMatchObject({ id: notice.notice.id, received: true });
  expect(
    (
      await f.send(
        { command: "dismiss", allocation: late.allocation, generation: 1 },
        randomUUID(),
        0
      )
    ).error
  ).toBeNull();
  expect((await f.snapshot(0)).notices).toHaveLength(20);
  expect(
    (await f.snapshot(0)).notices.some((n) => n.allocation === late.allocation)
  ).toBe(false);
  expect(
    (
      await f.send({
        command: "revoke",
        allocation: late.allocation,
        participant: f.people[0].id,
        reason: "Synthetic notice generation boundary",
      })
    ).error
  ).toBeNull();
  expect(
    (
      await f.confirm({
        ...late,
        command: "audience",
        revision: 3,
        restore: [f.people[0].id],
      })
    ).error
  ).toBeNull();
  const restored = (await f.snapshot(0)).notices.find(
    (n) => n.allocation === late.allocation
  )!;
  expect(restored.notice).toMatchObject({
    generation: 2,
    received: false,
    dismissed: false,
  });
  expect(restored.notice.id).not.toBe(notice.notice.id);
  expect((await f.send(ack, operation, 0)).error?.message).toBe("not_allowed");
  expect(
    (
      await f.send({
        command: "revoke",
        allocation: late.allocation,
        participant: null,
        reason: "Synthetic complete withdrawal",
      })
    ).error
  ).toBeNull();
  expect(
    (await f.snapshot(0)).notices.some((n) => n.allocation === late.allocation)
  ).toBe(false);
}, 60000);
