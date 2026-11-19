import { expect, test } from "vitest";
import { hasFreshCode } from "../../lib/supabase";

test("sensitive changes need an authenticator code from the last 10 minutes", () => {
  const now = 1_800_000_000;
  expect(hasFreshCode(null, now)).toBe(false);
  expect(hasFreshCode(now, now)).toBe(true);
  expect(hasFreshCode(now - 599, now)).toBe(true);
  expect(hasFreshCode(now - 600, now)).toBe(false);
  expect(hasFreshCode(now - 3600, now)).toBe(false);
});
