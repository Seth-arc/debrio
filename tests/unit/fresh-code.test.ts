import { expect, test } from "vitest";
import { hasFreshCode, latestCodeTime } from "../../lib/supabase";

test("sensitive changes need an authenticator code from the last 10 minutes", () => {
  const now = 1_800_000_000;
  expect(hasFreshCode(null, now)).toBe(false);
  expect(hasFreshCode(now, now)).toBe(true);
  expect(hasFreshCode(now - 599, now)).toBe(true);
  expect(hasFreshCode(now - 600, now)).toBe(false);
  expect(hasFreshCode(now - 3600, now)).toBe(false);
});

test("the code time is the latest authenticator entry, ignoring passwords and old formats", () => {
  expect(latestCodeTime([])).toBeNull();
  expect(latestCodeTime(["totp", "password"])).toBeNull();
  expect(
    latestCodeTime([{ method: "password", timestamp: 300 }, "totp"])
  ).toBeNull();
  expect(
    latestCodeTime([
      { method: "totp", timestamp: 100 },
      { method: "password", timestamp: 300 },
      { method: "totp", timestamp: 200 },
    ])
  ).toBe(200);
});
