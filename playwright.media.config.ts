import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/media",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3101",
    browserName: "chromium",
    channel: "chromium",
    launchOptions: { args: ["--use-fake-device-for-media-stream"] },
    permissions: ["microphone", "camera"],
    trace: "off",
    screenshot: "off",
    video:
      process.env.PROBE_RECORD === "1"
        ? { mode: "on", size: { width: 1280, height: 960 } }
        : "off",
  },
  webServer: {
    command:
      "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
