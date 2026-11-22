import { expect, test } from "vitest";
import { inputReadDeadline } from "../../lib/inputs";

test("a delayed input reply cannot extend the request-start lease or an earlier authority expiry", () => {
  const start = 1000;
  expect(inputReadDeadline(start, 90000)).toBe(6000);
  expect(inputReadDeadline(start, 250)).toBe(1250);
  expect(inputReadDeadline(start, -1)).toBe(start);
  expect(inputReadDeadline(start, Number.NaN)).toBe(start);
});
