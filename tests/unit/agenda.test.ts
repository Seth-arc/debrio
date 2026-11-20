import { expect, test } from "vitest";
import {
  agendaWarnings,
  newActivity,
  nextId,
  removeActivity,
  removeField,
  removeObjective,
  type Agenda,
} from "../../lib/agenda";

const twoActivities = (): Agenda => {
  const first = newActivity([]);
  return {
    objectives: [{ id: "o1", text: "Give feedback" }],
    activities: [
      {
        ...first,
        objectives: ["o1"],
        outputs: [
          { id: "f1", label: "Opening", kind: "long" },
          { id: "f2", label: "Rationale", kind: "long" },
        ],
      },
      {
        ...newActivity([first]),
        input: { activity: first.id, field: "f2" },
      },
    ],
  };
};

test("identifiers follow the highest in use", () => {
  expect(nextId("a", [])).toBe("a1");
  expect(nextId("a", [{ id: "a3" }, { id: "a1" }])).toBe("a4");
  expect(newActivity([newActivity([])]).id).toBe("a2");
});

test("removing an activity or field clears links to it, so a reused id never re-links", () => {
  const agenda = twoActivities();
  const withoutField = removeField(agenda, "a1", "f2");
  expect(withoutField.activities[1].input).toBeNull();
  // The next field reuses "f2", but nothing points at it.
  expect(nextId("f", withoutField.activities[0].outputs)).toBe("f2");

  const unrelated = removeField(agenda, "a1", "f1");
  expect(unrelated.activities[1].input).toEqual({
    activity: "a1",
    field: "f2",
  });

  const withoutActivity = removeActivity(agenda, "a1");
  expect(withoutActivity.activities).toHaveLength(1);
  expect(withoutActivity.activities[0].input).toBeNull();

  expect(removeObjective(agenda, "o1").activities[0].objectives).toEqual([]);
});

test("activities without an objective are flagged for review, never auto-mapped", () => {
  const agenda = twoActivities();
  expect(agendaWarnings({ objectives: [], activities: [] })).toEqual([]);
  expect(agendaWarnings(agenda)).toEqual([
    "Activity 2 isn't linked to an objective.",
  ]);
  expect(agendaWarnings(removeObjective(agenda, "o1"))).toEqual([
    "No objectives yet. Add the outcomes this workshop is for.",
    "Activity 1 isn't linked to an objective.",
    "Activity 2 isn't linked to an objective.",
  ]);
  expect(agenda.activities[1].objectives).toEqual([]);
});
