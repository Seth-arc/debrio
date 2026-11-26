import { defineConfig } from "vitest/config";

// Requires the disposable database, private Storage and ClamAV overlay.
export default defineConfig({
  test: {
    include: ["tests/file/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
  },
});
