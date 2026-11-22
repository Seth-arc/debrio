"use client";

import { useEffect, useRef, useState } from "react";
import type { Activity } from "../../lib/agenda";
import { scheduleVariance, type Execution } from "../../lib/execution";
import { readExecution, runExecution } from "./execution-actions";

function Task({ activity }: { activity: Activity }) {
  return (
    <>
      <h3>{activity.title}</h3>
      <p className="instructions">{activity.instructions}</p>
      <p>
        {activity.scope === "group"
          ? "Work in your assigned group"
          : "Each person alone"}{" "}
        · {activity.minutes} planned minutes
      </p>
      <p>
        Expected answers:{" "}
        {activity.outputs.map((field) => field.label).join("; ")}
      </p>
    </>
  );
}

type Command = {
  operation: string;
  revision: number;
  command: string;
  activity?: Activity;
  context: string;
  coordination?: Execution["coordination"];
  groupBlockers: string[];
  unfinished: NonNullable<Execution["unfinished"]>;
};

export function ExecutionPanel({
  initial,
  host = false,
}: {
  initial: Execution;
  host?: boolean;
}) {
  const [state, setState] = useState(initial);
  const [problem, setProblem] = useState("");
  const [stale, setStale] = useState(false);
  const [preview, setPreview] = useState<Command | null>(null);
  const [retry, setRetry] = useState<Command | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!busy.current) {
        try {
          const result = await readExecution(initial.session_id, host);
          if (alive) {
            setStale(!result.execution);
            if (result.execution) setState(result.execution);
          }
        } catch {
          if (alive) setStale(true);
        }
      }
      if (alive) timer = setTimeout(poll, 750);
    };
    timer = setTimeout(poll, 750);
    const offline = () => setStale(true);
    window.addEventListener("offline", offline);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("offline", offline);
    };
  }, [initial.session_id, host]);

  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);

  const execute = async (request: Command) => {
    busy.current = true;
    setPending(true);
    setProblem("");
    try {
      const result = await runExecution(
        state.session_id,
        request.operation,
        request.revision,
        request.command,
        request.context
      );
      setProblem(result.error ?? "");
      setRetry(result.uncertain ? request : null);
      if (!result.error && !result.uncertain) setPreview(null);
      const fresh = await readExecution(state.session_id, host);
      setStale(!fresh.execution);
      if (fresh.execution) setState(fresh.execution);
    } catch {
      setRetry(request);
      setStale(true);
      setProblem(
        "The result is unknown. Retry this same request to check it safely."
      );
    } finally {
      busy.current = false;
      setPending(false);
      if (previewHeading.current) previewHeading.current.focus();
      else title.current?.focus();
    }
  };
  const request = (command: string): Command => ({
    command,
    revision: state.revision,
    operation: crypto.randomUUID(),
    activity: state.next ?? undefined,
    context: state.context ?? "",
    coordination: state.coordination,
    groupBlockers: state.group_blockers ?? [],
    unfinished: state.unfinished ?? [],
  });
  const closed = state.state === "completed";
  const disabled = stale || pending || !!retry;
  const previewStale =
    preview?.revision !== state.revision || preview?.context !== state.context;

  return (
    <section aria-labelledby="execution-heading" data-pending={pending}>
      <h2 id="execution-heading" ref={title} tabIndex={-1}>
        Session activities
      </h2>
      <p>Work is saved and submitted separately below.</p>
      {!host && <p>Host availability is unknown.</p>}
      <p role="status">
        {stale
          ? "Connection problem. Session state is unavailable; controls are paused."
          : `Session ${state.state}. Version ${state.version_number}.`}
      </p>
      {problem && (
        <p role="alert" className="form-error">
          {problem}
        </p>
      )}
      {!stale && (
        <>
          {state.deadline && (
            <p>
              Session ends at {new Date(state.deadline).toLocaleTimeString()}.
              This limit includes pauses.
            </p>
          )}
          {!closed &&
            state.session_seconds !== null &&
            state.session_seconds <= 600 && (
              <p role="alert">
                This session ends in{" "}
                {Math.max(0, Math.ceil(state.session_seconds / 60))} minutes.
                Unfinished activities will stay unfinished.
              </p>
            )}
          {state.state === "ready" && (
            <p>
              Waiting for the host to start. Planned total:{" "}
              {state.planned_minutes} minutes. Maximum session length: four
              hours.
            </p>
          )}
          {state.current && (
            <div>
              <Task activity={state.current} />
              <p>
                {state.state === "paused"
                  ? "Activity paused"
                  : "Activity running"}{" "}
                · {Math.max(0, Math.ceil((state.remaining_seconds ?? 0) / 60))}{" "}
                minutes remaining
              </p>
              {(state.remaining_seconds ?? 1) <= 0 && (
                <p role="status">
                  Planned time is up. Only the host can move to the next
                  activity.
                </p>
              )}
            </div>
          )}
          {host && !closed && state.elapsed_seconds !== null && (
            <p>
              Session elapsed: {Math.floor(state.elapsed_seconds / 60)} minutes.
              Schedule variance: {Math.abs(scheduleVariance(state))} minutes{" "}
              {scheduleVariance(state) < 0 ? "ahead" : "behind"} the plan.
            </p>
          )}
          {closed && (
            <p>
              This session has ended. {state.completed_count} of{" "}
              {state.activity_count} activities were advanced past; remaining
              activities are unfinished. Ending does not submit any additional
              work.
            </p>
          )}
        </>
      )}
      {retry && (
        <button disabled={pending || stale} onClick={() => void execute(retry)}>
          Retry the same request
        </button>
      )}
      {host && !closed && (
        <>
          {state.next?.scope === "group" && (
            <p role="status">
              Group readiness:{" "}
              {state.group_blockers?.length
                ? state.group_blockers.join(" ")
                : "ready."}
            </p>
          )}
          {state.blockers.length > 0 && (
            <ul>
              {state.blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {!preview && (
            <div className="actions">
              {state.state === "ready" && (
                <button
                  disabled={disabled}
                  onClick={() => setPreview(request("start"))}
                >
                  Preview start
                </button>
              )}
              {state.state === "live" && (
                <>
                  <button
                    disabled={disabled}
                    onClick={() => void execute(request("pause"))}
                  >
                    Pause activity
                  </button>
                  {state.next && (
                    <button
                      disabled={disabled}
                      onClick={() => setPreview(request("next"))}
                    >
                      Preview next activity
                    </button>
                  )}
                </>
              )}
              {state.state === "paused" && (
                <button
                  disabled={disabled}
                  onClick={() => void execute(request("resume"))}
                >
                  Resume activity
                </button>
              )}
              <button
                disabled={disabled}
                onClick={() => setPreview(request("end"))}
              >
                End session…
              </button>
            </div>
          )}
          {preview && (
            <div role="group" aria-label="Confirm activity change">
              <h3 ref={previewHeading} tabIndex={-1}>
                {preview.command === "end"
                  ? "End this session?"
                  : "Preview activity change"}
              </h3>
              {preview.command !== "end" && preview.activity && (
                <>
                  <Task activity={preview.activity} />
                  <p>
                    Advancing closes ordinary editing of the previous activity.
                    Saved drafts remain available to their authorized audience.
                    No answers are submitted automatically.
                  </p>
                  {preview.activity.scope === "group" && (
                    <>
                      <h4>Group readiness</h4>
                      <ul>
                        {preview.groupBlockers.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                      {preview.coordination?.recorders.map((g) => (
                        <div key={g.group}>
                          <h4>Group {g.ordinal}</h4>
                          <p>
                            Recorder:{" "}
                            {g.recorder
                              ? `${preview.coordination?.roster.find((p) => p.participant === g.recorder)?.name ?? "Participant"} · ${g.recorder.slice(0, 8)}`
                              : "Not selected"}
                          </p>
                          <ul>
                            {preview.coordination?.roster
                              .filter((p) => p.group === g.group)
                              .map((p) => (
                                <li key={p.participant}>
                                  {p.name} · {p.participant.slice(0, 8)}
                                </li>
                              ))}
                          </ul>
                        </div>
                      ))}
                      <p>
                        Unassigned:{" "}
                        {preview.coordination?.roster
                          .filter((p) => !p.group)
                          .map(
                            (p) => `${p.name} · ${p.participant.slice(0, 8)}`
                          )
                          .join(", ") || "None"}
                      </p>
                    </>
                  )}
                  {preview.unfinished.length > 0 && (
                    <p role="status">
                      Groups without a submitted source answer:{" "}
                      {preview.unfinished.map((g) => g.ordinal).join(", ")}.
                      Advancing leaves this work unfinished.
                    </p>
                  )}
                </>
              )}
              {preview.command === "end" && (
                <p>Ending is final. Unfinished activities stay unfinished.</p>
              )}
              {previewStale && (
                <p role="alert">
                  This preview is out of date. Cancel and preview the current
                  activity.
                </p>
              )}
              <button
                disabled={
                  disabled ||
                  previewStale ||
                  (preview.command !== "end" &&
                    preview.groupBlockers.length > 0) ||
                  (preview.command === "start" && state.blockers.length > 0)
                }
                onClick={() => void execute(preview)}
              >
                {preview.command === "end"
                  ? "Confirm end session"
                  : preview.command === "start"
                    ? "Confirm start"
                    : "Confirm next activity"}
              </button>
              <button
                disabled={pending}
                onClick={() => {
                  setPreview(null);
                  title.current?.focus();
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
