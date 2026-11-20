import { spawnSync } from "node:child_process";

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
