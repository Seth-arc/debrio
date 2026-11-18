import { rmSync } from "node:fs";

// Only generated paths relative to this script's repository may be removed.
for (const path of [
  "../.next",
  "../tsconfig.tsbuildinfo",
  "../next-env.d.ts",
]) {
  rmSync(new URL(path, import.meta.url), { recursive: true, force: true });
}
