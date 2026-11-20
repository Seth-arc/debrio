import { expect, test } from "vitest";
import {
  agendaWarnings,
  newStage,
  nextId,
  type Agenda,
} from "../../lib/agenda";

test("new identifiers never collide, even after stages are removed or reordered", () => {
  expect(nextId("s", [])).toBe("s1");
  expect(nextId("s", [{ id: "s3" }, { id: "s1" }])).toBe("s4");
  expect(newStage([newStage([])]).id).toBe("s2");
});

test("stages without an objective are flagged for review, never auto-mapped", () => {
  const stage = newStage([]);
  const empty: Agenda = { objectives: [], steps: [] };
  expect(agendaWarnings(empty)).toEqual([]);
  expect(agendaWarnings({ objectives: [], steps: [stage] })).toEqual([
    "No objectives yet. Add the outcomes this workshop is for.",
  ]);
  const agenda: Agenda = {
    objectives: [{ id: "o1", text: "Give feedback" }],
    steps: [
      { ...stage, objectives: ["o1"] },
      { ...stage, id: "s2" },
    ],
  };
  expect(agendaWarnings(agenda)).toEqual([
    "Stage 2 isn't linked to an objective.",
  ]);
  expect(agenda.steps[1].objectives).toEqual([]);
});
