import { defineConfig } from "vitest/config";

// Requires the local stack: npm run db:start
export default defineConfig({
  test: { include: ["tests/integration/**/*.test.ts"], environment: "node" },
});
