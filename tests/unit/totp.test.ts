import { expect, test } from "vitest";
import { totp } from "../support/totp";

test("test-only TOTP helper matches the RFC 6238 SHA-1 vector", () => {
  // Secret "12345678901234567890"; RFC value 94287082 at t=59 s, last six digits.
  expect(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
});
