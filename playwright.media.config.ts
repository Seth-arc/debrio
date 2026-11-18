import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

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
    viewport: { width: 1280, height: 1100 },
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        ...(process.env.MEDIA_MONITOR_PROBE === "1"
          ? [
              `--use-file-for-fake-video-capture=${resolve(".artifacts/media-probe/camera.y4m")}`,
            ]
          : []),
      ],
    },
    permissions: ["microphone", "camera"],
    trace: "off",
    screenshot: "off",
    video:
      process.env.PROBE_RECORD === "1"
        ? { mode: "on", size: { width: 1280, height: 1100 } }
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
