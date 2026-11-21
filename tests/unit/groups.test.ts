import { expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import {
  reconcileGroups,
  randomGroups,
  type GroupPlan,
} from "../../lib/groups";
import { POST } from "../../app/api/groups/route";

test("random assignment covers every admitted identity once, balances uneven rosters and leaves its input unchanged", () => {
  for (const n of [1, 3, 20, 40])
    for (let k = 1; k <= Math.min(n, 8); k++) {
      const plan = {
        groups: Array.from({ length: k }, () => ({
          key: randomUUID(),
          create: true,
        })),
        members: Array.from({ length: n }, () => ({
          participant: randomUUID(),
          group: null,
        })),
        reason: "",
      } as GroupPlan;
      const original = JSON.stringify(plan);
      for (let repeat = 0; repeat < 10; repeat++) {
        const result = randomGroups(plan);
        expect(new Set(result.members.map((m) => m.participant))).toEqual(
          new Set(plan.members.map((m) => m.participant))
        );
        const counts = plan.groups.map(
          (g) => result.members.filter((m) => m.group === g.key).length
        );
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(
          1
        );
        expect(
          result.members.every((m) =>
            plan.groups.some((g) => g.key === m.group)
          )
        ).toBe(true);
      }
      expect(JSON.stringify(plan)).toBe(original);
    }
  for (const [n, k] of [
    [0, 0],
    [0, 1],
    [2, 3],
    [40, 9],
  ])
    expect(() =>
      randomGroups({
        groups: Array.from({ length: k }, () => ({
          key: randomUUID(),
          create: true,
        })),
        members: Array.from({ length: n }, () => ({
          participant: randomUUID(),
          group: null,
        })),
      } as GroupPlan)
    ).toThrow();
});

test("group HTTP boundary refuses foreign origin, oversized/malformed input and participant commands before credentials", async () => {
  const call = (body: unknown, origin = "http://localhost") =>
    POST(
      new Request("http://localhost/api/groups", {
        method: "POST",
        headers: {
          host: "localhost",
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      })
    );
  expect((await call({}, "http://foreign.test")).status).toBe(403);
  expect(
    (await call({ session: randomUUID(), host: true, extra: 1 })).status
  ).toBe(400);
  expect(
    (
      await call({
        session: randomUUID(),
        host: true,
        request: { reason: "x".repeat(262145) },
      })
    ).status
  ).toBe(413);
  expect(
    (
      await call({
        session: randomUUID(),
        host: true,
        operation: randomUUID(),
        request: { reason: "\ud800" },
      })
    ).status
  ).toBe(400);
  expect(
    (
      await call({
        session: randomUUID(),
        host: false,
        operation: randomUUID(),
        request: { reason: "valid" },
      })
    ).status
  ).toBe(403);
});

test("malformed JSON UUID values are refused without coercion or unhandled errors", async () => {
  for (const patch of [
    { session: { toString: null } },
    { operation: { toString: null } },
    { session: [] },
    { operation: 42 },
  ]) {
    const response = await POST(
      new Request("http://localhost/api/groups", {
        method: "POST",
        headers: {
          host: "localhost",
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          session: randomUUID(),
          host: true,
          operation: randomUUID(),
          request: { reason: "Valid" },
          ...patch,
        }),
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_group_plan",
    });
  }
});

test("reconciliation preserves proposed groups even when a concurrent creation reaches the active limit", () => {
  const snapshot = {
    session: randomUUID(),
    version: randomUUID(),
    revision: 1,
    execution_revision: 1,
    activity_index: -1,
    state: "ready" as const,
    roster: "a".repeat(64),
    groups: Array.from({ length: 8 }, (_, i) => ({
      id: randomUUID(),
      ordinal: i + 1,
    })),
    members: [
      { participant: randomUUID(), name: "Existing", group: null },
      { participant: randomUUID(), name: "Late", group: null },
    ],
  };
  const proposed = randomUUID();
  const plan = {
    ...snapshot,
    groups: [{ key: proposed, create: true }],
    retire: [],
    members: [
      { participant: snapshot.members[0].participant, group: proposed },
      { participant: randomUUID(), group: proposed },
    ],
    reason: "Keep my choices",
  } as GroupPlan;
  const result = reconcileGroups(snapshot, plan);
  expect(result.groups).toHaveLength(9);
  expect(result.groups.at(-1)?.key).toBe(proposed);
  expect(result.members).toEqual([
    { participant: snapshot.members[0].participant, group: proposed },
    { participant: snapshot.members[1].participant, group: null },
  ]);
  expect(result.reason).toBe(plan.reason);
});
