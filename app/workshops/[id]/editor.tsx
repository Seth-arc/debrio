"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  agendaWarnings,
  newStage,
  nextId,
  totalMinutes,
  type Agenda,
  type Stage,
} from "../../../lib/agenda";
import { markWorkshopReady, saveWorkshopDraft } from "../actions";

type Reply = { text: string; problems?: string[] };

const move = <T,>(list: T[], from: number, to: number) => {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
};

// Edits one draft version. The database validates on save and on Ready to run.
export function AgendaEditor({
  versionId,
  updatedAt,
  initial,
  problems,
}: {
  versionId: string;
  updatedAt: string;
  initial: Agenda;
  problems: string[];
}) {
  const router = useRouter();
  const [agenda, setAgenda] = useState(initial);
  const [saved, setSaved] = useState({
    updatedAt,
    content: JSON.stringify(initial),
  });
  const [reply, setReply] = useState<Reply | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(agenda) !== saved.content;

  // Leaving with unsaved edits asks first; saved work is never at risk.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setStage = (index: number, change: Partial<Stage>) =>
    setAgenda((current) => ({
      ...current,
      steps: current.steps.map((stage, i) =>
        i === index ? { ...stage, ...change } : stage
      ),
    }));

  async function save() {
    const result = await saveWorkshopDraft(versionId, saved.updatedAt, agenda);
    if ("error" in result) {
      setReply({ text: result.error });
      return null;
    }
    setSaved({ updatedAt: result.updatedAt, content: JSON.stringify(agenda) });
    return result.updatedAt;
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
      const current = dirty ? await save() : saved.updatedAt;
      if (!current) return;
      const result = await markWorkshopReady(versionId, current);
      if ("error" in result) {
        setReply({ text: result.error, problems: result.problems });
        router.refresh();
        return;
      }
      router.refresh();
    });

  const warnings = agendaWarnings(agenda);

  return (
    <div className="editor">
      <section aria-labelledby="objectives-heading">
        <h2 id="objectives-heading">Objectives</h2>
        <p className="hint">
          What participants should be able to do afterwards. Link stages to them
          below.
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
                  setAgenda((current) => ({
                    objectives: current.objectives.filter(
                      (o) => o.id !== objective.id
                    ),
                    steps: current.steps.map((stage) => ({
                      ...stage,
                      objectives: stage.objectives.filter(
                        (id) => id !== objective.id
                      ),
                    })),
                  }))
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

      <section aria-labelledby="stages-heading">
        <h2 id="stages-heading">Stages</h2>
        <p className="hint">
          Stages run in order. Planned total: {totalMinutes(agenda)} of 240
          minutes.
        </p>
        {agenda.steps.map((stage, index) => {
          const key = (field: string) => `${stage.id}-${field}`;
          const earlier = agenda.steps.slice(0, index);
          return (
            <fieldset key={stage.id} className="stage">
              <legend>
                Stage {index + 1}
                {stage.title ? `: ${stage.title}` : ""}
              </legend>
              <div className="field">
                <label htmlFor={key("title")}>Title</label>
                <input
                  id={key("title")}
                  value={stage.title}
                  maxLength={120}
                  onChange={(e) => setStage(index, { title: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={key("instructions")}>Instructions</label>
                <textarea
                  id={key("instructions")}
                  value={stage.instructions}
                  maxLength={4000}
                  rows={4}
                  onChange={(e) =>
                    setStage(index, { instructions: e.target.value })
                  }
                />
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor={key("scope")}>Who works on it</label>
                  <select
                    id={key("scope")}
                    value={stage.scope}
                    onChange={(e) =>
                      setStage(index, {
                        scope: e.target.value as Stage["scope"],
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
                    value={stage.minutes}
                    onChange={(e) =>
                      setStage(index, {
                        minutes: Math.max(
                          1,
                          Math.min(240, Math.round(Number(e.target.value)) || 1)
                        ),
                      })
                    }
                  />
                </div>
              </div>

              <fieldset>
                <legend>What participants produce</legend>
                {stage.outputs.map((field, fieldIndex) => (
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
                          setStage(index, {
                            outputs: stage.outputs.map((f) =>
                              f.id === field.id
                                ? { ...f, label: e.target.value }
                                : f
                            ),
                          })
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
                          setStage(index, {
                            outputs: stage.outputs.map((f) =>
                              f.id === field.id
                                ? {
                                    ...f,
                                    kind: e.target.value as "short" | "long",
                                  }
                                : f
                            ),
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
                      aria-label={`Remove answer ${fieldIndex + 1} from stage ${index + 1}`}
                      onClick={() =>
                        setStage(index, {
                          outputs: stage.outputs.filter(
                            (f) => f.id !== field.id
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={stage.outputs.length >= 10}
                  onClick={() =>
                    setStage(index, {
                      outputs: [
                        ...stage.outputs,
                        {
                          id: nextId("f", stage.outputs),
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
                    stage.input
                      ? `${stage.input.step}:${stage.input.field}`
                      : ""
                  }
                  onChange={(e) => {
                    const [step, field] = e.target.value.split(":");
                    setStage(index, {
                      input: step && field ? { step, field } : null,
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
                        Stage {sourceIndex + 1}: {field.label || "(unlabelled)"}
                      </option>
                    ))
                  )}
                  {/* Keep a now-invalid link visible so Ready to run can explain it. */}
                  {stage.input &&
                    !earlier.some(
                      (s) =>
                        s.id === stage.input?.step &&
                        s.outputs.some((f) => f.id === stage.input?.field)
                    ) && (
                      <option
                        value={`${stage.input.step}:${stage.input.field}`}
                      >
                        A stage that is no longer earlier
                      </option>
                    )}
                </select>
              </div>

              {agenda.objectives.length > 0 && (
                <fieldset>
                  <legend>Objectives this stage serves</legend>
                  {agenda.objectives.map((objective, objectiveIndex) => (
                    <div className="field check" key={objective.id}>
                      <input
                        type="checkbox"
                        id={key(`objective-${objective.id}`)}
                        checked={stage.objectives.includes(objective.id)}
                        onChange={(e) =>
                          setStage(index, {
                            objectives: e.target.checked
                              ? [...stage.objectives, objective.id]
                              : stage.objectives.filter(
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
                  aria-label={`Move up: stage ${index + 1}`}
                  onClick={() =>
                    setAgenda((current) => ({
                      ...current,
                      steps: move(current.steps, index, index - 1),
                    }))
                  }
                >
                  Move up
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={index === agenda.steps.length - 1}
                  aria-label={`Move down: stage ${index + 1}`}
                  onClick={() =>
                    setAgenda((current) => ({
                      ...current,
                      steps: move(current.steps, index, index + 1),
                    }))
                  }
                >
                  Move down
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Remove stage ${index + 1}`}
                  onClick={() =>
                    setAgenda((current) => ({
                      ...current,
                      steps: current.steps.filter((s) => s.id !== stage.id),
                    }))
                  }
                >
                  Remove stage
                </button>
              </div>
            </fieldset>
          );
        })}
        <button
          type="button"
          className="secondary"
          disabled={agenda.steps.length >= 40}
          onClick={() =>
            setAgenda((current) => ({
              ...current,
              steps: [...current.steps, newStage(current.steps)],
            }))
          }
        >
          Add stage
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
