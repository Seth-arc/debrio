// The agenda document stored in workshop_versions.content. The database's JSON
// Schema and workshop_problems() are authoritative; these helpers only build
// and describe it for the editor.

export type AnswerField = { id: string; label: string; kind: "short" | "long" };

export type Stage = {
  id: string;
  title: string;
  instructions: string;
  scope: "individual" | "group";
  minutes: number;
  outputs: AnswerField[];
  // An earlier stage's answer field this stage builds on.
  input: { step: string; field: string } | null;
  objectives: string[];
};

export type Objective = { id: string; text: string };

export type Agenda = { objectives: Objective[]; steps: Stage[] };

// Next free identifier such as "s3": stable across reorders, never reused within a list.
export function nextId(prefix: "o" | "s" | "f", taken: { id: string }[]) {
  const used = taken
    .map(({ id }) => Number(id.slice(1)))
    .filter(Number.isInteger);
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

export function newStage(taken: Stage[]): Stage {
  return {
    id: nextId("s", taken),
    title: "",
    instructions: "",
    scope: "individual",
    minutes: 10,
    outputs: [{ id: "f1", label: "", kind: "long" }],
    input: null,
    objectives: [],
  };
}

// Review prompts, not blockers: stages that serve no stated objective (B06).
export function agendaWarnings(agenda: Agenda) {
  if (agenda.steps.length === 0) return [];
  if (agenda.objectives.length === 0)
    return ["No objectives yet. Add the outcomes this workshop is for."];
  return agenda.steps.flatMap((stage, index) =>
    stage.objectives.length === 0
      ? [`Stage ${index + 1} isn't linked to an objective.`]
      : []
  );
}

export const totalMinutes = (agenda: Agenda) =>
  agenda.steps.reduce((sum, stage) => sum + stage.minutes, 0);
