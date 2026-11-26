// Opt-in scheduler for the disposable local stack. Hosted activation needs a
// separately verified worker, bucket policy, backup and operational owner.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const task = fileURLToPath(
  new URL("./reconcile-files-local.mjs", import.meta.url)
);
let running = false;
let stopped = false;
async function tick() {
  if (running || stopped) return;
  running = true;
  const child = spawn(process.execPath, [task], { stdio: "inherit" });
  await new Promise((resolve) => child.once("exit", resolve));
  running = false;
}
const timer = setInterval(() => void tick(), 30_000);
process.on("SIGINT", () => {
  stopped = true;
  clearInterval(timer);
});
process.on("SIGTERM", () => {
  stopped = true;
  clearInterval(timer);
});
await tick();
