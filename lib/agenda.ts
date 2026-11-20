// The agenda document stored in workshop_versions.content. The database's JSON
// Schema and workshop_problems() are authoritative; these helpers only build
// and describe it for the editor.

export type AnswerField = { id: string; label: string; kind: "short" | "long" };

// What participants do: the glossary's Activity.
export type Activity = {
  id: string;
  title: string;
  instructions: string;
  scope: "individual" | "group";
  minutes: number;
  outputs: AnswerField[];
  // An earlier activity's answer field this activity builds on.
  input: { activity: string; field: string } | null;
  objectives: string[];
};

export type Objective = { id: string; text: string };

export type Agenda = { objectives: Objective[]; activities: Activity[] };

// Next identifier after the highest in use, such as "a3". Removals clear every
// reference to the removed item (below), so a reused identifier is never linked.
export function nextId(prefix: "o" | "a" | "f", taken: { id: string }[]) {
  const used = taken
    .map(({ id }) => Number(id.slice(1)))
    .filter(Number.isInteger);
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

export function newActivity(taken: Activity[]): Activity {
  return {
    id: nextId("a", taken),
    title: "",
    instructions: "",
    scope: "individual",
    minutes: 10,
    outputs: [{ id: "f1", label: "", kind: "long" }],
    input: null,
    objectives: [],
  };
}

// Drops inputs that pointed at a removed activity or field.
const unlink = (
  activities: Activity[],
  gone: (input: NonNullable<Activity["input"]>) => boolean
) =>
  activities.map((activity) =>
    activity.input && gone(activity.input)
      ? { ...activity, input: null }
      : activity
  );

export function removeActivity(agenda: Agenda, id: string): Agenda {
  return {
    ...agenda,
    activities: unlink(
      agenda.activities.filter((activity) => activity.id !== id),
      (input) => input.activity === id
    ),
  };
}

export function removeField(
  agenda: Agenda,
  activityId: string,
  fieldId: string
): Agenda {
  const activities = agenda.activities.map((activity) =>
    activity.id === activityId
      ? {
          ...activity,
          outputs: activity.outputs.filter((field) => field.id !== fieldId),
        }
      : activity
  );
  return {
    ...agenda,
    activities: unlink(
      activities,
      (input) => input.activity === activityId && input.field === fieldId
    ),
  };
}

export function removeObjective(agenda: Agenda, id: string): Agenda {
  return {
    objectives: agenda.objectives.filter((objective) => objective.id !== id),
    activities: agenda.activities.map((activity) => ({
      ...activity,
      objectives: activity.objectives.filter((ref) => ref !== id),
    })),
  };
}

// Review prompts, not blockers: activities that serve no stated objective (B06).
export function agendaWarnings(agenda: Agenda) {
  const unmapped = agenda.activities.flatMap((activity, index) =>
    activity.objectives.length === 0
      ? [`Activity ${index + 1} isn't linked to an objective.`]
      : []
  );
  return agenda.activities.length > 0 && agenda.objectives.length === 0
    ? ["No objectives yet. Add the outcomes this workshop is for.", ...unmapped]
    : unmapped;
}

export const totalMinutes = (agenda: Agenda) =>
  agenda.activities.reduce((sum, activity) => sum + activity.minutes, 0);
