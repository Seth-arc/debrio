import { spawn, spawnSync } from "node:child_process";

// Keep a fixture transaction open until the test observes the competing waiters.
export async function holdTransaction(statement: string) {
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
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] }
  );
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("fixture-locked")) resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code) reject(Error("Synthetic transaction lock failed"));
    });
  });
  const done = new Promise<number | null>((resolve) =>
    child.once("exit", resolve)
  );
  child.stdin.write(`begin; ${statement}; select 'fixture-locked';\n`);
  await ready;
  let released = false;
  return async () => {
    if (!released) {
      released = true;
      child.stdin.end("commit;\n");
    }
    if ((await done) !== 0) throw Error("Synthetic transaction release failed");
  };
}

// Privileged fixture operations target only compose.yaml's disposable database.
export function sql(statement: string) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "--single-transaction",
      "-q",
    ],
    { input: statement, encoding: "utf8" }
  );
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || "psql failed");
  return result.stdout.trim();
}
