import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { reviewFixture } from "../support/reviews";
import { holdTransaction, sql } from "../support/database";
import { command } from "../support/execution";

async function waiting() {
  await expect
    .poll(
      () =>
        Number(
          sql(
            "select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%review_command%';"
          )
        ),
      { timeout: 10000 }
    )
    .toBeGreaterThan(0);
}
test("a failed receipt rolls back every grant, allocation and notice; retry commits exactly once", async () => {
  const x = await reviewFixture(),
    id = await x.approved(),
    operation = randomUUID();
  const request = {
    command: "release",
    proposal: id,
    token: (await x.preview(id)).token,
  };
  sql(
    `create function public.synthetic_review_receipt_failure() returns trigger language plpgsql as $$ begin if new.operation_id='${operation}' then raise exception 'synthetic_receipt_failure'; end if; return new; end $$; create trigger synthetic_review_receipt_failure before insert on public.review_commands for each row execute function public.synthetic_review_receipt_failure();`
  );
  try {
    expect((await x.send(request, undefined, operation)).error?.message).toBe(
      "synthetic_receipt_failure"
    );
    for (const table of [
      "resource_allocations",
      "resource_recipients",
      "resource_grants",
      "resource_notices",
    ])
      expect(
        sql(
          `select count(*) from public.${table} where ${table === "resource_allocations" ? "id" : "allocation_id"}='${id}';`
        )
      ).toBe("0");
    expect((await x.read()).data.items[0].state).toBe("approved");
  } finally {
    sql(
      "drop trigger synthetic_review_receipt_failure on public.review_commands; drop function public.synthetic_review_receipt_failure();"
    );
  }
  const outcomes = await Promise.all([
    x.send(request, undefined, operation),
    x.send(request, undefined, operation),
  ]);
  expect(outcomes.every((r) => !r.error)).toBe(true);
  expect(outcomes[0].data).toEqual(outcomes[1].data);
  expect((await x.resources()).data.notices).toHaveLength(1);
}, 30000);

test("disable waits for in-flight expansion, then blocks new grants without suppressing withdrawal", async () => {
  const x = await reviewFixture(),
    id = await x.approved();
  const request = {
    command: "release",
    proposal: id,
    token: (await x.preview(id)).token,
  };
  const unlock = await holdTransaction(
    "update public.review_capability set enabled=false"
  );
  const pending = x.send(request).then((r) => r);
  try {
    await waiting();
  } finally {
    await unlock();
  }
  expect((await pending).error?.message).toBe("review_unavailable");
  expect((await x.resources()).data.items).toEqual([]);
  expect(
    (await x.send({ command: "withdraw", proposal: id }, 0)).error
  ).toBeNull();
  sql("update public.review_capability set enabled=true;");
  expect((await x.send(request)).error?.message).toBe("review_closed");
}, 30000);

test("authority and four-hour deadlines are rechecked after blocking locks without cleanup", async () => {
  for (const boundary of ["host", "deadline"]) {
    const x = await reviewFixture(),
      id = await x.approved();
    const request = {
      command: "release",
      proposal: id,
      token: (await x.preview(id)).token,
    };
    const token = (await x.host.auth.getSession()).data.session!.access_token;
    const endpoint = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString()
    ).session_id;
    const unlock = await holdTransaction(
      boundary === "host"
        ? `select 1 from public.sessions where id='${x.session}' for update; update auth.sessions set not_after=clock_timestamp()+interval '2 seconds' where id='${endpoint}'`
        : `select 1 from public.sessions where id='${x.session}' for update; alter table public.session_execution disable trigger execution_identity_frozen; update public.session_execution set started_at=statement_timestamp()-interval '4 hours'+interval '2 seconds',deadline=statement_timestamp()+interval '2 seconds' where session_id='${x.session}'; alter table public.session_execution enable trigger execution_identity_frozen`
    );
    const pending = x.send(request).then((r) => r);
    try {
      await waiting();
      // Let real wall-clock authority expire while the write is blocked.
      await new Promise((resolve) => setTimeout(resolve, 2200));
    } finally {
      await unlock();
    }
    expect((await pending).error).not.toBeNull();
    expect((await x.resources()).data.items).toEqual([]);
    expect(
      sql(`select count(*) from public.resource_allocations where id='${id}';`)
    ).toBe("0");
  }
}, 60000);

test("pause and resume retain the fixed grant but legacy Next closes it permanently", async () => {
  const x = await reviewFixture(),
    id = await x.approved();
  const release = {
    command: "release",
    proposal: id,
    token: (await x.preview(id)).token,
  };
  expect((await x.send(release)).error).toBeNull();
  expect((await command(x.host, x.session, 3, "pause")).error).toBeNull();
  expect((await x.resources()).data.items).toHaveLength(1);
  expect((await command(x.host, x.session, 4, "resume")).error).toBeNull();
  expect((await x.resources()).data.items).toHaveLength(1);
  expect((await command(x.host, x.session, 5, "next")).error).toBeNull();
  expect((await x.resources()).data.items).toEqual([]);
  expect((await x.send(release)).error?.message).toBe("review_closed");
  expect((await x.workRead()).data.items[0].attempts).toHaveLength(1);
}, 30000);
