import { defineConfig } from "vitest/config";

// Requires the local stack: npm run db:start
export default defineConfig({
  // Capacity/expiry fixtures exercise one disposable stack and must not close
  // another file's active session while that file tests a write race.
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
  },
});
