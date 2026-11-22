import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { groupWorkFixture } from "../support/group-work";
import { sql } from "../support/database";
import { client } from "../support/hosts";

test(
  "AC12: acknowledged group state survives actual database and API process kills without replay",
  { timeout: 90000 },
  async () => {
    const x = await groupWorkFixture();
    expect(
      (
        await x.send(
          await x.request(
            "contribute",
            {
              revision: 0,
              field: "f1",
              value: "Synthetic durable contribution",
            },
            1
          ),
          1
        )
      ).error
    ).toBeNull();
    await x.save("Synthetic durable group answer");
    expect((await x.send(await x.request("submit"))).error).toBeNull();
    expect((await x.recorder(1)).error).toBeNull();
    const before = await x.read(1);
    const beforeStart = sql("select pg_postmaster_start_time();");
    const commandCount = sql(
      `select count(*) from public.work_commands where session_id='${x.sessionId}';`
    );
    const hash = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const killed = spawnSync(
      "docker",
      ["compose", "kill", "-s", "SIGKILL", "db", "rest"],
      { encoding: "utf8" }
    );
    expect(killed.status, killed.stderr).toBe(0);
    const restarted = spawnSync(
      "docker",
      ["compose", "up", "-d", "--wait", "db", "rest"],
      { encoding: "utf8" }
    );
    expect(restarted.status, restarted.stderr).toBe(0);
    await expect
      .poll(
        async () =>
          (
            await client().rpc("read_group_work", {
              p_session: x.sessionId,
              p_credential_hash: x.people[1].hash,
            })
          ).error,
        { timeout: 20000 }
      )
      .toBeNull();
    const after = await x.read(1);
    expect(after).toEqual(before);
    expect(sql("select pg_postmaster_start_time();")).not.toBe(beforeStart);
    expect(
      sql(
        `select count(*) from public.work_commands where session_id='${x.sessionId}';`
      )
    ).toBe(commandCount);
    mkdirSync(".artifacts/P2-03b", { recursive: true });
    writeFileSync(
      ".artifacts/P2-03b/restart-proof.json",
      JSON.stringify(
        {
          databaseAndApiKilled: true,
          beforeHash: hash(before),
          afterHash: hash(after),
          replayedCommands: 0,
          recordedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    sql("update public.group_work_capability set enabled=false;");
  }
);
