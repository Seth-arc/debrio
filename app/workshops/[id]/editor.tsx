"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  agendaWarnings,
  newActivity,
  nextId,
  removeActivity,
  removeField,
  removeObjective,
  totalMinutes,
  type Activity,
  type Agenda,
  type AnswerField,
} from "../../../lib/agenda";
import { markWorkshopReady, saveWorkshopDraft } from "../actions";

type Reply = { text: string; problems?: string[] };

const LEAVE_WARNING =
  "You have unsaved changes on this page. Leave without saving them?";

const move = <T,>(list: T[], from: number, to: number) => {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
};

// Planned minutes may be blank while typing; they settle to 1–240 on leaving the field.
const settleMinutes = (value: number) =>
  Math.max(1, Math.min(240, Math.round(value) || 1));

// Edits one draft version. The database validates on save and on Ready to run.
export function AgendaEditor({
  versionId,
  revision,
  initial,
  problems,
}: {
  versionId: string;
  revision: number;
  initial: Agenda;
  problems: string[];
}) {
  const router = useRouter();
  const [agenda, setAgenda] = useState(initial);
  const [saved, setSaved] = useState({
    revision,
    content: JSON.stringify(initial),
  });
  const [reply, setReply] = useState<Reply | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(agenda) !== saved.content;

  // With unsaved edits, ask before the tab closes or reloads, and before any
  // in-page way out marked data-leave (the back link, Duplicate).
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const leave = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-leave]") && !window.confirm(LEAVE_WARNING)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", leave, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", leave, true);
    };
  }, [dirty]);

  const setActivity = (index: number, change: Partial<Activity>) =>
    setAgenda((current) => ({
      ...current,
      activities: current.activities.map((activity, i) =>
        i === index ? { ...activity, ...change } : activity
      ),
    }));

  const setField = (
    index: number,
    fieldId: string,
    change: Partial<AnswerField>
  ) =>
    setAgenda((current) => ({
      ...current,
      activities: current.activities.map((activity, i) =>
        i === index
          ? {
              ...activity,
              outputs: activity.outputs.map((field) =>
                field.id === fieldId ? { ...field, ...change } : field
              ),
            }
          : activity
      ),
    }));

  async function save() {
    const result = await saveWorkshopDraft(versionId, saved.revision, agenda);
    if ("error" in result) {
      setReply({ text: result.error });
      return null;
    }
    setSaved({ revision: result.revision, content: JSON.stringify(agenda) });
    return result.revision;
  }

  const onSave = () =>
    startTransition(async () => {
      if (await save()) {
        setReply(null);
        router.refresh();
      }
    });

  const onReady = () =>
    startTransition(async () => {
      const current = dirty ? await save() : saved.revision;
      if (!current) return;
      const result = await markWorkshopReady(versionId, current);
      if ("error" in result)
        setReply({ text: result.error, problems: result.problems });
      router.refresh();
    });

  const warnings = agendaWarnings(agenda);

  return (
    <div className="editor">
      <section aria-labelledby="objectives-heading">
        <h2 id="objectives-heading">Objectives</h2>
        <p className="hint">
          What participants should be able to do afterwards. Link activities to
          them below.
        </p>
        <ol>
          {agenda.objectives.map((objective, index) => (
            <li key={objective.id} className="row">
              <label htmlFor={`objective-${objective.id}`}>
                Objective {index + 1}
              </label>
              <input
                id={`objective-${objective.id}`}
                value={objective.text}
                maxLength={300}
                onChange={(event) =>
                  setAgenda((current) => ({
                    ...current,
                    objectives: current.objectives.map((o) =>
                      o.id === objective.id
                        ? { ...o, text: event.target.value }
                        : o
                    ),
                  }))
                }
              />
              <button
                type="button"
                className="secondary"
                aria-label={`Remove objective ${index + 1}`}
                onClick={() =>
                  setAgenda((current) => removeObjective(current, objective.id))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="secondary"
          disabled={agenda.objectives.length >= 20}
          onClick={() =>
            setAgenda((current) => ({
              ...current,
              objectives: [
                ...current.objectives,
                { id: nextId("o", current.objectives), text: "" },
              ],
            }))
          }
        >
          Add objective
        </button>
      </section>

      <section aria-labelledby="activities-heading">
        <h2 id="activities-heading">Activities</h2>
        <p className="hint">
          What participants do, in order. Planned total: {totalMinutes(agenda)}{" "}
          of 240 minutes.
        </p>
        {agenda.activities.map((activity, index) => {
          const key = (field: string) => `${activity.id}-${field}`;
          const earlier = agenda.activities.slice(0, index);
          return (
            <fieldset key={activity.id} className="activity">
              <legend>
                Activity {index + 1}
                {activity.title ? `: ${activity.title}` : ""}
              </legend>
              <div className="field">
                <label htmlFor={key("title")}>Title</label>
                <input
                  id={key("title")}
                  value={activity.title}
                  maxLength={120}
                  onChange={(e) =>
                    setActivity(index, { title: e.target.value })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={key("instructions")}>Instructions</label>
                <textarea
                  id={key("instructions")}
                  value={activity.instructions}
                  maxLength={4000}
                  rows={4}
                  onChange={(e) =>
                    setActivity(index, { instructions: e.target.value })
                  }
                />
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor={key("scope")}>Who works on it</label>
                  <select
                    id={key("scope")}
                    value={activity.scope}
                    onChange={(e) =>
                      setActivity(index, {
                        scope: e.target.value as Activity["scope"],
                      })
                    }
                  >
                    <option value="individual">Each person alone</option>
                    <option value="group">Groups together</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={key("minutes")}>Planned minutes</label>
                  <input
                    id={key("minutes")}
                    type="number"
                    min={1}
                    max={240}
                    value={activity.minutes || ""}
                    onChange={(e) =>
                      setActivity(index, { minutes: Number(e.target.value) })
                    }
                    onBlur={() =>
                      setActivity(index, {
                        minutes: settleMinutes(activity.minutes),
                      })
                    }
                  />
                </div>
              </div>

              <fieldset>
                <legend>What participants produce</legend>
                {activity.outputs.map((field, fieldIndex) => (
                  <div className="row" key={field.id}>
                    <div className="field">
                      <label htmlFor={key(`${field.id}-label`)}>
                        Answer {fieldIndex + 1} label
                      </label>
                      <input
                        id={key(`${field.id}-label`)}
                        value={field.label}
                        maxLength={120}
                        onChange={(e) =>
                          setField(index, field.id, { label: e.target.value })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={key(`${field.id}-kind`)}>
                        Answer {fieldIndex + 1} length
                      </label>
                      <select
                        id={key(`${field.id}-kind`)}
                        value={field.kind}
                        onChange={(e) =>
                          setField(index, field.id, {
                            kind: e.target.value as AnswerField["kind"],
                          })
                        }
                      >
                        <option value="short">Short answer</option>
                        <option value="long">Longer response</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Remove answer ${fieldIndex + 1} from activity ${index + 1}`}
                      onClick={() =>
                        setAgenda((current) =>
                          removeField(current, activity.id, field.id)
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={activity.outputs.length >= 10}
                  onClick={() =>
                    setActivity(index, {
                      outputs: [
                        ...activity.outputs,
                        {
                          id: nextId("f", activity.outputs),
                          label: "",
                          kind: "long",
                        },
                      ],
                    })
                  }
                >
                  Add answer field
                </button>
              </fieldset>

              <div className="field">
                <label htmlFor={key("input")}>
                  Builds on an earlier answer
                </label>
                <select
                  id={key("input")}
                  value={
                    activity.input
                      ? `${activity.input.activity}:${activity.input.field}`
                      : ""
                  }
                  onChange={(e) => {
                    const [source, field] = e.target.value.split(":");
                    setActivity(index, {
                      input:
                        source && field ? { activity: source, field } : null,
                    });
                  }}
                >
                  <option value="">Nothing</option>
                  {earlier.flatMap((source, sourceIndex) =>
                    source.outputs.map((field) => (
                      <option
                        key={`${source.id}:${field.id}`}
                        value={`${source.id}:${field.id}`}
                      >
                        Activity {sourceIndex + 1}:{" "}
                        {field.label || "(unlabelled)"}
                      </option>
                    ))
                  )}
                  {/* After a reorder, keep the link visible so Ready to run can explain it. */}
                  {activity.input &&
                    !earlier.some(
                      (s) =>
                        s.id === activity.input?.activity &&
                        s.outputs.some((f) => f.id === activity.input?.field)
                    ) && (
                      <option
                        value={`${activity.input.activity}:${activity.input.field}`}
                      >
                        An activity that is no longer earlier
                      </option>
                    )}
                </select>
              </div>

              {agenda.objectives.length > 0 && (
                <fieldset>
                  <legend>Objectives this activity serves</legend>
                  {agenda.objectives.map((objective, objectiveIndex) => (
                    <div className="field check" key={objective.id}>
                      <input
                        type="checkbox"
                        id={key(`objective-${objective.id}`)}
                        checked={activity.objectives.includes(objective.id)}
                        onChange={(e) =>
                          setActivity(index, {
                            objectives: e.target.checked
                              ? [...activity.objectives, objective.id]
                              : activity.objectives.filter(
                                  (id) => id !== objective.id
                                ),
                          })
                        }
                      />
                      <label htmlFor={key(`objective-${objective.id}`)}>
                        {objective.text || `Objective ${objectiveIndex + 1}`}
                      </label>
                    </div>
                  ))}
                </fieldset>
              )}

              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={index === 0}
                  aria-label={`Move up: activity ${index + 1}`}
                  onClick={() =>
                    setAgenda((current) => ({
                      ...current,
                      activities: move(current.activities, index, index - 1),
                    }))
                  }
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={index === agenda.activities.length - 1}
                  aria-label={`Move down: activity ${index + 1}`}
                  onClick={() =>
                    setAgenda((current) => ({
                      ...current,
                      activities: move(current.activities, index, index + 1),
                    }))
                  }
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Remove activity ${index + 1}`}
                  onClick={() =>
                    setAgenda((current) => removeActivity(current, activity.id))
                  }
                >
                  Remove activity
                </button>
              </div>
            </fieldset>
          );
        })}
        <button
          type="button"
          className="secondary"
          disabled={agenda.activities.length >= 40}
          onClick={() =>
            setAgenda((current) => ({
              ...current,
              activities: [
                ...current.activities,
                newActivity(current.activities),
              ],
            }))
          }
        >
          Add activity
        </button>
      </section>

      <section aria-labelledby="check-heading">
        <h2 id="check-heading">Before running</h2>
        {problems.length > 0 ? (
          <>
            <p>As last saved, this must be fixed before it can run:</p>
            <ul>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>As last saved, nothing blocks running this agenda.</p>
        )}
        {warnings.length > 0 && (
          <>
            <p>Worth reviewing:</p>
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="actions sticky">
        <p role="status">
          {pending
            ? "Saving…"
            : dirty
              ? "You have unsaved changes."
              : "All changes saved."}
        </p>
        {reply && (
          <div role="alert" className="form-error">
            <p>{reply.text}</p>
            {reply.problems && (
              <ul>
                {reply.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button type="button" disabled={pending || !dirty} onClick={onSave}>
          Save draft
        </button>
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={onReady}
        >
          Mark ready to run
        </button>
      </div>
    </div>
  );
}
