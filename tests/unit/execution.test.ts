import { expect, test } from "vitest";
import { scheduleVariance, type Execution } from "../../lib/execution";

test("schedule variance counts pause/overrun and retains time gained by early advance", () => {
  const state = {
    elapsed_seconds: 300,
    planned_before_minutes: 0,
    current: { minutes: 10 },
    remaining_seconds: 300,
  } as Execution;
  expect(scheduleVariance(state)).toBe(0);
  expect(scheduleVariance({ ...state, elapsed_seconds: 420 })).toBe(2);
  expect(
    scheduleVariance({
      ...state,
      elapsed_seconds: 720,
      remaining_seconds: -120,
    })
  ).toBe(2);
  expect(
    scheduleVariance({
      ...state,
      elapsed_seconds: 300,
      planned_before_minutes: 10,
      remaining_seconds: 600,
    })
  ).toBe(-5);
});
