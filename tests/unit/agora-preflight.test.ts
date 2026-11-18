import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("P1-01-AC3 hosted runner is opt-in and refuses CI; check mode makes no hosted call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "debrio-agora-config-"));
  const path = join(directory, ".env.local");
  try {
    // Fixed filename inside this test's freshly created temporary directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(
      path,
      `AGORA_APP_ID=${"a".repeat(32)}\nAGORA_APP_CERTIFICATE=${"b".repeat(32)}\n`
    );
    const run = (confirmation: string, ci: string) =>
      spawnSync(
        process.execPath,
        ["scripts/run-agora-probe.mjs", path, "--check"],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            AGORA_PROBE_CONFIRMED: confirmation,
            CI: ci,
            VERCEL: "",
          },
        }
      );
    expect(run("", "").status).toBe(1);
    expect(run("1", "1").status).toBe(1);
    const valid = run("1", "");
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain("no hosted calls made");
    expect(valid.stdout + valid.stderr).not.toContain("b".repeat(32));
  } finally {
    await rm(path, { force: true });
    // Remove only this test's now-empty temporary directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await rmdir(directory);
  }
});
