/* eslint-disable security/detect-non-literal-fs-filename -- Only the fixed repository health fixture URL is read or restored. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const path = new URL("../app/api/health/route.ts", import.meta.url);
const original = readFileSync(path, "utf8");
assert.ok(
  original.includes('status: "ok"'),
  "Health fixture must match the source"
);
try {
  writeFileSync(path, original.replace('status: "ok"', 'status: "broken"'));
  const result = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run"],
    {
      stdio: "inherit",
      timeout: 60_000,
    }
  );
  assert.ifError(result.error);
  assert.equal(
    result.status,
    1,
    "A broken health response must fail the tests"
  );
  console.log("Intentional failure rejected; restoring source.");
} finally {
  writeFileSync(path, original);
}
