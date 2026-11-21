import { expect, test } from "vitest";
import { validWorkText, workText } from "../../lib/work";

test("work text preserves spacing, counts Unicode code points and rejects malformed Unicode without truncation", () => {
  expect(workText("  a\r\nb  ")).toBe("  a\nb  ");
  expect(validWorkText("😀".repeat(500), 500)).toBe(true);
  expect(validWorkText("😀".repeat(501), 500)).toBe(false);
  expect(validWorkText("\ud800", 500)).toBe(false);
  expect(validWorkText("a\0b", 500)).toBe(false);
  expect(validWorkText("x".repeat(5001), 5000)).toBe(false);
});
