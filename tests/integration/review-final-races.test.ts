import { expect, test } from "vitest";
import { reviewFixture } from "../support/reviews";
import { holdTransaction, sql } from "../support/database";
import { command } from "../support/execution";
import { decide } from "../support/sessions";

test("author removal and end serialize with release in both orders", async () => {
  for (const boundary of ["author", "end"])
    for (const first of ["close", "release"]) {
      const x = await reviewFixture(),
        id = await x.approved();
      const request = {
        command: "release",
        proposal: id,
        token: (await x.preview(id)).token,
      };
      const unlock = await holdTransaction(
        `select 1 from public.sessions where id='${x.session}' for update`
      );
      const start = (action: string) =>
        (action === "release"
          ? x.send(request)
          : boundary === "author"
            ? decide(x.host, x.person, "remove")
            : command(x.host, x.session, 3, "end")
        ).then((r) => r);
      const a = start(first);
      let b;
      try {
        await unlock.waitForQueries(
          "query like '%review_command%' or query like '%read_resources%' or query like '%execution_command%' or query like '%decide_participant%'",
          1
        );
        b = start(first === "release" ? "close" : "release");
        await unlock.waitForQueries(
          "query like '%review_command%' or query like '%read_resources%' or query like '%execution_command%' or query like '%decide_participant%'",
          2
        );
      } finally {
        await unlock();
      }
      const results = await Promise.all([a, b!]);
      expect(results[first === "close" ? 0 : 1].error).toBeNull();
      if (first === "release") expect(results[0].error).toBeNull();
      else expect(results[1].error).not.toBeNull();
      expect((await x.resources()).data.items).toEqual([]);
      expect((await x.resources()).data.notices).toEqual([]);
      expect(
        sql(
          `select count(*) from public.resource_allocations where id='${id}';`
        )
      ).toBe(first === "release" ? "1" : "0");
    }
}, 120000);

test("withdrawal versus a protected read has one lawful order and every subsequent path denies", async () => {
  for (const first of ["read", "withdraw"]) {
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
    const unlock = await holdTransaction(
      `select 1 from public.sessions where id='${x.session}' for update`
    );
    const start = (action: string) =>
      (action === "read"
        ? x.resources()
        : x.send({ command: "withdraw", proposal: id }, 0)
      ).then((r) => r);
    const a = start(first);
    let b;
    try {
      await unlock.waitForQueries(
        "query like '%review_command%' or query like '%read_resources%' or query like '%execution_command%' or query like '%decide_participant%'",
        1
      );
      b = start(first === "read" ? "withdraw" : "read");
      await unlock.waitForQueries(
        "query like '%review_command%' or query like '%read_resources%' or query like '%execution_command%' or query like '%decide_participant%'",
        2
      );
    } finally {
      await unlock();
    }
    const results = await Promise.all([a, b!]);
    expect(results.every((r) => !r.error)).toBe(true);
    expect(results[first === "read" ? 0 : 1].data.items).toHaveLength(
      first === "read" ? 1 : 0
    );
    expect((await x.resources(1, id)).error?.message).toBe("not_allowed");
    expect((await x.resources()).data.notices).toEqual([]);
  }
}, 60000);

test("source erasure locked ahead of confirmation prevents any grant or cached projection", async () => {
  const x = await reviewFixture(),
    id = await x.approved();
  const request = {
    command: "release",
    proposal: id,
    token: (await x.preview(id)).token,
  };
  const unlock = await holdTransaction(
    `select 1 from public.sessions where id='${x.session}' for update; delete from public.work_commands where session_id='${x.session}'; delete from public.work_attempts where id='${x.attempt}'`
  );
  const release = x.send(request).then((r) => r);
  try {
    await unlock.waitForQueries(
      "query like '%review_command%' or query like '%read_resources%' or query like '%execution_command%' or query like '%decide_participant%'",
      1
    );
  } finally {
    await unlock();
  }
  expect((await release).error).not.toBeNull();
  expect((await x.resources()).data.items).toEqual([]);
  expect(
    sql(`select count(*) from public.resource_allocations where id='${id}';`)
  ).toBe("0");
  expect((await x.preview(id)).source).toBeNull();
}, 30000);
