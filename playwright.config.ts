import { defineConfig, devices } from "@playwright/test";
import { localSupabaseEnv } from "./scripts/local-supabase";

export default defineConfig({
  testDir: "./tests/browser",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    // DEMO_RECORD=1 keeps a slowed, synthetic-data video for task evidence.
    ...(process.env.DEMO_RECORD
      ? { video: "on" as const, launchOptions: { slowMo: 300 } }
      : {}),
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-layout",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm run start -- --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
    // Sign-in specs need the disposable local stack: npm run db:start
    env: localSupabaseEnv,
  },
});
