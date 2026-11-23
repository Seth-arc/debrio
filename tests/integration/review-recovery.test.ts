import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import {
  LOCAL_ANON_KEY,
  LOCAL_SUPABASE_URL,
} from "../../scripts/local-supabase";
import { reviewFixture } from "../support/reviews";
import { sql } from "../support/database";

test("committed reviewer release survives actual database/API crash before acknowledgement without mutation replay", async () => {
  const x = await reviewFixture(),
    id = await x.approved();
  const operation = randomUUID(),
    request = {
      command: "release",
      proposal: id,
      token: (await x.preview(id)).token,
    };
  const committed = Promise.withResolvers<void>(),
    held = Promise.withResolvers<void>();
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
          await held.promise;
          throw Error("Synthetic lost reply");
        } catch (error) {
          committed.reject(error);
          throw error;
        }
      },
    },
  });
  const unknown = interrupted
    .rpc("review_command", {
      p_session: x.session,
      p_operation: operation,
      p_request: request,
      p_host: true,
    })
    .then((r) => r);
  await committed.promise;
  const withdrawn = await x.approved();
  expect(
    (
      await x.send({
        command: "release",
        proposal: withdrawn,
        token: (await x.preview(withdrawn)).token,
      })
    ).error
  ).toBeNull();
  expect(
    (await x.send({ command: "withdraw", proposal: withdrawn }, 0)).error
  ).toBeNull();
  const before = (await x.resources(1, id)).data;
  const ledger = () =>
    sql(`select jsonb_build_object(
 'proposals',(select jsonb_agg(to_jsonb(p) order by p.id) from public.review_proposals p where session_id='${x.session}'),
 'recipients',(select jsonb_agg(to_jsonb(p) order by p.proposal_id,p.participant_id) from public.review_recipients p where session_id='${x.session}'),
 'decisions',(select jsonb_agg(to_jsonb(d) order by d.id) from public.review_decisions d join public.review_proposals p on p.id=d.proposal_id where p.session_id='${x.session}'),
 'receipts',(select jsonb_agg(to_jsonb(c) order by c.operation_id) from public.review_commands c where session_id='${x.session}'),
 'allocations',(select jsonb_agg(to_jsonb(a) order by a.id) from public.resource_allocations a where session_id='${x.session}'),
 'notices',(select jsonb_agg(to_jsonb(n) order by n.id) from public.resource_notices n join public.resource_allocations a on a.id=n.allocation_id where a.session_id='${x.session}'))::text;`);
  const saved = ledger(),
    started = sql("select pg_postmaster_start_time();");
  try {
    for (const args of [
      ["compose", "kill", "-s", "SIGKILL", "db", "rest"],
      ["compose", "up", "-d", "--wait", "db", "rest"],
    ]) {
      const r = spawnSync("docker", args, { encoding: "utf8", timeout: 60000 });
      expect(r.status, r.stderr).toBe(0);
      if (args[1] === "kill")
        expect((await x.resources()).error).not.toBeNull();
    }
  } finally {
    held.resolve();
  }
  expect((await unknown).error).not.toBeNull();
  await expect
    .poll(async () => (await x.resources()).error, { timeout: 20000 })
    .toBeNull();
  const after = (await x.resources(1, id)).data;
  expect(after.items).toEqual(before.items);
  expect(after.detail).toEqual(before.detail);
  expect(after.notices).toEqual(before.notices);
  expect((await x.resources(1, withdrawn)).error?.message).toBe("not_allowed");
  expect(ledger()).toBe(saved);
  expect(sql("select pg_postmaster_start_time();")).not.toBe(started);
  expect((await x.send(request, undefined, operation)).error).toBeNull();
  expect(ledger()).toBe(saved);
  mkdirSync(".artifacts/P3-01b", { recursive: true });
  writeFileSync(
    ".artifacts/P3-01b/restart-proof.json",
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        databaseAndApiKilled: true,
        lostAcknowledgementAcrossCrash: true,
        replayedCommandsForRecovery: 0,
        receiptReplayChecksAfterRecovery: 1,
        withdrawnAccessDenied: true,
        beforeHash: createHash("sha256").update(saved).digest("hex"),
        afterHash: createHash("sha256").update(ledger()).digest("hex"),
      },
      null,
      2
    )
  );
}, 90000);
