import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  LOCAL_ANON_KEY,
  LOCAL_SUPABASE_URL,
} from "../../scripts/local-supabase";
import { resourceFixture } from "../support/resources";
import { sql } from "../support/database";

afterEach(() => sql("update public.resource_capability set enabled=false;"));

async function hold(statement: string, seconds = 2.5) {
  const child = spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += String(chunk);
  });
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("resource-locked")) resolve();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code) reject(Error(errors || `Lock failed: ${code}`));
    });
  });
  const done = new Promise<number | null>((resolve) =>
    child.on("exit", resolve)
  );
  child.stdin.end(
    `begin; ${statement}; select 'resource-locked'; select pg_sleep(${seconds}); commit;`
  );
  await locked;
  return { done };
}

async function released() {
  const x = await resourceFixture();
  const resource = await x.resource();
  const allocation = x.proposal(resource.version);
  expect((await x.confirm(allocation)).error).toBeNull();
  expect((await x.execute("start")).error).toBeNull();
  expect(
    (await x.confirm({ ...allocation, command: "release", revision: 1 })).error
  ).toBeNull();
  return { ...x, resource, allocation };
}

test("AC13: actual database/API crash preserves exact resources, notices, receipts and revoked access without replay", async () => {
  const fixture = await resourceFixture();
  const resource = await fixture.resource();
  const allocation = fixture.proposal(resource.version);
  expect((await fixture.confirm(allocation)).error).toBeNull();
  expect((await fixture.execute("start")).error).toBeNull();
  const x = { ...fixture, resource, allocation };
  const proposal = { ...allocation, command: "release" as const, revision: 1 };
  const preview = await x.preview(proposal);
  const command = { ...proposal, token: preview.token };
  const operation = randomUUID();
  const committed = Promise.withResolvers<void>();
  const heldReply = Promise.withResolvers<void>();
  const token = (await x.host.auth.getSession()).data.session!.access_token;
  const interrupted = createClient(LOCAL_SUPABASE_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: async (input, init) => {
        try {
          const response = await fetch(input, init);
          if (!response.ok) throw Error("Synthetic release did not commit");
          await response.arrayBuffer();
          committed.resolve();
          await heldReply.promise;
          throw Error("Synthetic lost acknowledgement after database commit");
        } catch (error) {
          committed.reject(error);
          throw error;
        }
      },
    },
  });
  // Hold the committed response at the client transport boundary across the actual crash.
  const unknown = interrupted
    .rpc("resource_command", {
      p_session: x.session,
      p_operation: operation,
      p_request: command,
      p_host: true,
    })
    .then((result) => result);
  await committed.promise;
  const other = x.proposal(x.resource.version, {
    selectors: [{ kind: "individual", id: x.people[1].id }],
  });
  expect((await x.confirm(other)).error).toBeNull();
  expect(
    (await x.confirm({ ...other, command: "release", revision: 1 })).error
  ).toBeNull();
  expect(
    (
      await x.send({
        command: "revoke",
        allocation: other.allocation,
        participant: x.people[1].id,
        reason: "Synthetic durable withdrawal",
      })
    ).error
  ).toBeNull();
  const before = await x.snapshot(0, x.allocation.allocation);
  expect(before.items[0].notice).toMatchObject({
    received: false,
    dismissed: false,
  });
  const ledger = () =>
    sql(`select jsonb_build_object(
    'resources',(select jsonb_agg(to_jsonb(r) order by r.id) from public.resources r where workspace_id='${x.workspace}'),
    'versions',(select jsonb_agg(to_jsonb(v) order by v.id) from public.resource_versions v where workspace_id='${x.workspace}'),
    'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.resource_allocations a where session_id='${x.session}'),
    'recipients',(select jsonb_agg(to_jsonb(r) order by r.allocation_id,r.participant_id) from public.resource_recipients r where session_id='${x.session}'),
    'grants',(select jsonb_agg(to_jsonb(g) order by g.id) from public.resource_grants g join public.resource_allocations a on a.id=g.allocation_id where a.session_id='${x.session}'),
    'notices',(select jsonb_agg(to_jsonb(n) order by n.id) from public.resource_notices n join public.resource_allocations a on a.id=n.allocation_id where a.session_id='${x.session}'),
    'receipts',(select jsonb_agg(to_jsonb(c) order by c.operation_id) from public.resource_commands c where workspace_id='${x.workspace}'))::text;`);
  const beforeLedger = ledger();
  const started = sql("select pg_postmaster_start_time();");
  for (const args of [
    ["compose", "kill", "-s", "SIGKILL", "db", "rest"],
    ["compose", "up", "-d", "--wait", "db", "rest"],
  ]) {
    const result = spawnSync("docker", args, {
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status, result.stderr).toBe(0);
    if (args[1] === "kill") expect((await x.read(0)).error).not.toBeNull();
  }
  heldReply.resolve();
  expect((await unknown).error).not.toBeNull();
  await expect
    .poll(async () => (await x.read(0)).error, { timeout: 20000 })
    .toBeNull();
  const after = await x.snapshot(0, x.allocation.allocation);
  expect(after.items).toEqual(before.items);
  expect(after.detail).toEqual(before.detail);
  expect((await x.snapshot(1)).items).toEqual([]);
  expect((await x.read(1, other.allocation)).error?.code).toBe("42501");
  expect(ledger()).toBe(beforeLedger);
  expect((await x.send(command, operation)).error).toBeNull();
  expect(ledger()).toBe(beforeLedger);
  expect(sql("select pg_postmaster_start_time();")).not.toBe(started);
  mkdirSync(".artifacts/P3-01a", { recursive: true });
  writeFileSync(
    ".artifacts/P3-01a/restart-proof.json",
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        databaseAndApiKilled: true,
        replayedCommandsForRecovery: 0,
        receiptReplayChecksAfterRecovery: 1,
        lostAcknowledgementAcrossCrash: true,
        readWhileDatabaseAndApiDownDenied: true,
        explicitRetryAddedNoLedgerRows: true,
        beforeHash: createHash("sha256").update(beforeLedger).digest("hex"),
        afterHash: createHash("sha256").update(ledger()).digest("hex"),
        unacknowledgedNoticeRecovered: true,
        revokedRecipientDenied: true,
      },
      null,
      2
    )
  );
}, 90_000);

test("AC10: held-lock revocation denies queued detail and device acknowledgement", async () => {
  const x = await released();
  const generation = (await x.snapshot(0)).items[0].generation;
  const lock =
    await hold(`select id from public.sessions where id='${x.session}' for update;
    update public.resource_recipients set revoked_at=clock_timestamp() where allocation_id='${x.allocation.allocation}' and participant_id='${x.people[0].id}'`);
  const [read, ack] = await Promise.all([
    x.read(0, x.allocation.allocation),
    x.send(
      { command: "ack", allocation: x.allocation.allocation, generation },
      randomUUID(),
      0
    ),
  ]);
  expect(await lock.done).toBe(0);
  expect(read.error?.code).toBe("42501");
  expect(ack.error?.code).toBe("42501");
  expect((await x.snapshot(0)).items).toEqual([]);
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${x.allocation.allocation}' and acked_at is not null;`
    )
  ).toBe("0");
}, 60_000);

test("AC6: queued release rechecks the current host Auth deadline after waiting", async () => {
  const x = await resourceFixture();
  const resource = await x.resource();
  const allocation = x.proposal(resource.version);
  expect((await x.confirm(allocation)).error).toBeNull();
  expect((await x.execute("start")).error).toBeNull();
  const proposal = { ...allocation, command: "release" as const, revision: 1 };
  const preview = await x.preview(proposal);
  const token = (await x.host.auth.getSession()).data.session!.access_token;
  const authSession = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString()
  ).session_id;
  sql(
    `update auth.sessions set not_after=clock_timestamp()+interval '1 second' where id='${authSession}';`
  );
  const lock = await hold(
    `select id from public.sessions where id='${x.session}' for update`
  );
  expect(
    (await x.send({ ...proposal, token: preview.token })).error?.code
  ).toBe("42501");
  expect(await lock.done).toBe(0);
  expect(
    sql(
      `select count(*) from public.resource_recipients where session_id='${x.session}';`
    )
  ).toBe("0");
}, 60_000);

test("AC15: disabling drains a blocked resource mutation and preserves permitted reads", async () => {
  const x = await resourceFixture();
  const resource = await x.resource();
  const allocation = x.proposal(resource.version);
  expect((await x.confirm(allocation)).error).toBeNull();
  expect((await x.execute("start")).error).toBeNull();
  const proposal = { ...allocation, command: "release" as const, revision: 1 };
  const preview = await x.preview(proposal);
  const lock = await hold(
    `select id from public.resources where id='${resource.id}' for update`,
    4
  );
  const release = Promise.resolve(
    x.send({ ...proposal, token: preview.token })
  );
  await expect
    .poll(
      () =>
        Number(
          sql(
            "select count(*) from pg_stat_activity where query like '%resource_command%' and wait_event_type='Lock';"
          )
        ),
      { timeout: 2500, interval: 50 }
    )
    .toBeGreaterThan(0);
  // This transaction waits for the mutation's shared capability lock before disabling.
  const disable = hold(
    "update public.resource_capability set enabled=false",
    0
  );
  const result = await release;
  expect(result.error).toBeNull();
  expect(await lock.done).toBe(0);
  expect(await (await disable).done).toBe(0);
  expect((await x.snapshot(0, allocation.allocation)).detail?.content).toBe(
    "Synthetic private brief"
  );
  const another = x.proposal(resource.version);
  expect((await x.confirm(another)).error?.message).toBe(
    "resource_unavailable"
  );
  expect(
    (
      await x.send({
        command: "revoke",
        allocation: allocation.allocation,
        participant: null,
        reason: "Synthetic withdrawal while gate disabled",
      })
    ).error
  ).toBeNull();
  expect((await x.snapshot(0)).items).toEqual([]);
}, 60_000);

test("AC14: source erasure never falls back and effective end forbids expansion without resetting retention", async () => {
  const x = await released();
  const original = await x.readLibrary(x.resource.id);
  expect((await x.execute("end")).error).toBeNull();
  const additions = {
    ...x.allocation,
    command: "audience" as const,
    revision: 2,
    selectors: [{ kind: "shared" as const, id: null }],
  };
  expect((await x.confirm(additions)).error?.message).toBe("resource_closed");
  expect((await x.readLibrary(x.resource.id)).resource?.versions).toEqual(
    original.resource?.versions
  );
  expect((await x.snapshot(0, x.allocation.allocation)).detail?.content).toBe(
    "Synthetic private brief"
  );
  sql(`delete from public.resource_versions where id='${x.resource.version}';`);
  expect((await x.snapshot(0)).items).toEqual([]);
  expect((await x.read(0, x.allocation.allocation)).error?.code).toBe("42501");
  expect(
    sql(
      `select count(*) from public.resource_notices where allocation_id='${x.allocation.allocation}';`
    )
  ).toBe("1");
  expect(
    sql(
      `select receipt::text from public.resource_commands where session_id='${x.session}' order by created_at desc limit 1;`
    )
  ).not.toContain("Synthetic private brief");

  const y = await released();
  expect((await y.execute("end")).error).toBeNull();
  sql(
    `update public.sessions set ended_at=clock_timestamp()-interval '90 days'+interval '1 second' where id='${y.session}';`
  );
  const lock = await hold(
    `select id from public.sessions where id='${y.session}' for update`
  );
  const expired = await y.read(0, y.allocation.allocation);
  expect(await lock.done).toBe(0);
  expect(expired.error?.code).toBe("42501");
  expect((await y.readLibrary(y.resource.id)).resource?.versions).toHaveLength(
    1
  );
}, 60_000);
