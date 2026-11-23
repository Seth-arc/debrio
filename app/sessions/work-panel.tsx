"use client";

import { useNavigationGuard } from "../use-navigation-guard";
import { invalidateInputReads } from "../../lib/inputs";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  validWorkText,
  workError,
  workStatus,
  workText,
  type WorkCommand,
  type WorkItem,
  type WorkReply,
  type WorkSnapshot,
} from "../../lib/work";

async function requestWork(
  session: string,
  host: boolean,
  operation?: string,
  request?: WorkCommand
): Promise<WorkReply> {
  const response = await fetch("/api/work", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, host, operation, request }),
    cache: "no-store",
  });
  const result: WorkReply = await response.json();
  if (
    result.error === "not_allowed" ||
    result.error === "input_access_required"
  )
    invalidateInputReads(session);
  return result;
}

function Answers({
  item,
  content,
}: {
  item: WorkItem;
  content: Record<string, string>;
}) {
  return (
    <dl>
      {item.activity.outputs.map((field) => (
        <div key={field.id}>
          <dt>{field.label}</dt>
          <dd className="instructions">{content[field.id] || "No answer"}</dd>
        </div>
      ))}
    </dl>
  );
}

function WorkEditor({
  item,
  version,
  ended,
  current,
  host,
  unavailable,
  mutate,
  refresh,
}: {
  item: WorkItem;
  version: string;
  ended: boolean;
  current: number;
  host: boolean;
  unavailable: boolean;
  mutate: (operation: string, request: WorkCommand) => Promise<WorkReply>;
  refresh: () => Promise<void>;
}) {
  const [base, setBase] = useState({
    revision: item.revision,
    content: item.content,
  });
  const [text, setText] = useState(item.content);
  const [reason, setReason] = useState("");
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [retry, setRetry] = useState<{
    operation: string;
    request: WorkCommand;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [correction, setCorrection] = useState(
    item.latest === 0 ||
      item.revision > (item.attempts.at(-1)?.draft_revision ?? 0)
  );
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const same = (a: Record<string, string>, b: Record<string, string>) =>
    item.activity.outputs.every(
      (f) => workText(a[f.id] ?? "") === workText(b[f.id] ?? "")
    );
  const dirty = !same(text, base.content);
  // Reconcile server props during render so a fresh response cannot paint stale editable state.
  if (!pending && !retry && item.revision > base.revision) {
    if (!dirty) {
      setBase({ revision: item.revision, content: item.content });
      setText(item.content);
      if (item.revision > (item.attempts.at(-1)?.draft_revision ?? 0))
        setCorrection(true);
    } else if (!conflict) setConflict(true);
  }
  const protectedText = dirty || conflict || pending || !!retry || !!reason;
  const invalid = item.activity.outputs.some(
    (f) => !validWorkText(text[f.id] ?? "", f.kind === "short" ? 500 : 5000)
  );
  const missing = item.activity.outputs.filter(
    (f) => !(text[f.id] ?? "").trim()
  );
  const blocked =
    unavailable || !item.writable || pending || !!retry || conflict;
  const latest = item.attempts.at(-1);

  async function execute(command: WorkCommand["command"], existing = retry) {
    if (busy.current) return;
    const operation = existing?.operation ?? crypto.randomUUID();
    const request: WorkCommand = existing?.request ?? {
      command,
      participant: item.participant,
      activity: item.activity.id,
      version,
      revision: base.revision,
      latest: item.latest,
      window_revision: item.window_revision,
      reason,
      ...(command === "save"
        ? {
            content: Object.fromEntries(
              item.activity.outputs.map((f) => [
                f.id,
                workText(text[f.id] ?? ""),
              ])
            ),
          }
        : {}),
    };
    busy.current = true;
    setActiveCommand(request.command);
    setPending(true);
    setMessage("");
    try {
      const result = await mutate(operation, request);
      if (result.uncertain) {
        setRetry({ operation, request });
        setMessage(
          "Result unknown. Keep this page open and retry the same request."
        );
      } else if (result.error) {
        setRetry(null);
        setMessage(workError(result.error));
        if (result.error === "work_conflict" && !host) setConflict(true);
      } else if (result.receipt) {
        setRetry(null);
        if (request.command === "save") {
          setBase({
            revision: result.receipt.revision,
            content: request.content!,
          });
          setMessage(
            "Draft save acknowledged. Text typed during saving may still be unsaved."
          );
        } else {
          setReason("");
          setMessage("Change acknowledged.");
          if (request.command.startsWith("submit")) setCorrection(false);
        }
      } else {
        setRetry({ operation, request });
        setMessage("Result unknown. Retry the same request.");
      }
    } catch {
      setRetry({ operation, request });
      setMessage(
        "Result unknown. Keep this page open and retry the same request."
      );
    } finally {
      busy.current = false;
      setPending(false);
      await refresh();
    }
  }

  return (
    <section
      aria-labelledby={`work-${item.participant}-${item.activity.id}`}
      data-work-protected={protectedText ? "true" : undefined}
      data-pending={pending ? "true" : undefined}
    >
      <h3
        id={`work-${item.participant}-${item.activity.id}`}
        ref={heading}
        tabIndex={-1}
      >
        {host ? `${item.name} · ` : ""}
        {item.activity.title} —{" "}
        {item.index === current ? "current activity" : "earlier work"}
      </h3>
      <p role="status">
        {workStatus(item)}.{" "}
        {item.writable
          ? item.reopened
            ? "Corrections reopened."
            : "Open for work."
          : "Read only."}
      </p>
      {item.saved_at && (
        <p>
          Last saved draft: revision {item.revision} at{" "}
          <time dateTime={item.saved_at}>
            {new Date(item.saved_at).toLocaleString()}
          </time>
        </p>
      )}
      {host ? (
        <>
          <h4>Latest saved draft (revision {item.revision})</h4>
          <Answers item={item} content={item.content} />
        </>
      ) : (
        <>
          <p>
            All answers are required for a complete submission. Save and submit
            are separate actions.
          </p>
          {item.activity.outputs.map((f) => (
            <div key={f.id}>
              <label
                htmlFor={`answer-${item.participant}-${item.activity.id}-${f.id}`}
              >
                {f.label}
              </label>
              <textarea
                id={`answer-${item.participant}-${item.activity.id}-${f.id}`}
                rows={f.kind === "short" ? 2 : 5}
                value={text[f.id] ?? ""}
                readOnly={
                  unavailable ||
                  !item.writable ||
                  (!correction && item.latest > 0) ||
                  ((pending || !!retry) && activeCommand !== "save")
                }
                onChange={(event) =>
                  setText((old) => ({ ...old, [f.id]: event.target.value }))
                }
                aria-describedby={`limit-${item.participant}-${item.activity.id}-${f.id}`}
              />
              <p
                className="hint"
                id={`limit-${item.participant}-${item.activity.id}-${f.id}`}
              >
                {f.kind === "short" ? "500" : "5,000"} characters maximum.
              </p>
            </div>
          ))}
          <p role="status">
            {pending
              ? "Saving or submitting…"
              : retry
                ? "Result unknown — retry required"
                : conflict
                  ? "Conflict — your text is preserved"
                  : dirty
                    ? "Unsaved changes"
                    : base.revision
                      ? `Saved revision ${base.revision}`
                      : "No saved draft"}
          </p>
          {invalid && (
            <p role="alert">
              An answer exceeds its limit or contains unsupported text. Nothing
              will be truncated.
            </p>
          )}
          <p className="hint">
            Only acknowledged saves survive reconnect or restart. Unsaved text
            stays only in this open page.
          </p>
          {conflict && (
            <div role="region" aria-label="Resolve draft conflict">
              <h4>Latest saved draft (revision {item.revision})</h4>
              <Answers item={item} content={item.content} />
              <p>
                Your text is still in the answer fields above. Compare it before
                choosing.
              </p>
              <button
                type="button"
                disabled={unavailable || pending || !!retry}
                onClick={() => {
                  setBase({ revision: item.revision, content: item.content });
                  setConflict(false);
                  heading.current?.focus();
                }}
              >
                Keep my text and reconcile
              </button>
              <button
                type="button"
                className="secondary"
                disabled={unavailable || pending || !!retry}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Discard your local text and use the latest saved draft?"
                    )
                  )
                    return;
                  setBase({ revision: item.revision, content: item.content });
                  setText(item.content);
                  setConflict(false);
                  heading.current?.focus();
                }}
              >
                Use latest saved draft
              </button>
            </div>
          )}
          {!correction && latest && (
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm(
                    "Replace your unsaved text with this submitted version?"
                  )
                )
                  return;
                setText(latest.content);
                setCorrection(true);
                heading.current?.focus();
              }}
            >
              Edit a correction
            </button>
          )}
          <div className="actions">
            <button
              type="button"
              disabled={blocked || invalid || (!correction && item.latest > 0)}
              onClick={() => execute("save", null)}
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={
                blocked ||
                invalid ||
                dirty ||
                !base.revision ||
                missing.length > 0 ||
                (!correction && item.latest > 0) ||
                (item.latest > 0 && !reason.trim())
              }
              onClick={() => execute("submit", null)}
            >
              Submit answers
            </button>
            {missing.length > 0 &&
              missing.length < item.activity.outputs.length && (
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    blocked ||
                    dirty ||
                    invalid ||
                    !base.revision ||
                    (!correction && item.latest > 0) ||
                    (item.latest > 0 && !reason.trim())
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        `Submit incomplete work for review? Missing: ${missing.map((f) => f.label).join(", ")}.`
                      )
                    )
                      void execute("submit_incomplete", null);
                  }}
                >
                  Submit incomplete work for review
                </button>
              )}
          </div>
        </>
      )}
      {(host || item.latest > 0) && (
        <div>
          <label htmlFor={`reason-${item.participant}-${item.activity.id}`}>
            {host ? "Reason for host action" : "Correction reason"}
          </label>
          <textarea
            id={`reason-${item.participant}-${item.activity.id}`}
            value={reason}
            readOnly={pending || !!retry || unavailable || ended}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
          <p className="hint">
            Required for corrections and host actions; 500 characters maximum.
          </p>
        </div>
      )}
      {host && (
        <div className="actions">
          {latest?.missing.length ? (
            <button
              type="button"
              disabled={
                blocked ||
                !!latest.acceptance ||
                !reason.trim() ||
                !validWorkText(reason, 500)
              }
              onClick={() => execute("accept_partial", null)}
            >
              Accept partial
            </button>
          ) : null}
          {item.index < current && (
            <button
              type="button"
              disabled={
                ended ||
                unavailable ||
                pending ||
                !!retry ||
                !reason.trim() ||
                !validWorkText(reason, 500)
              }
              onClick={() => execute(item.reopened ? "close" : "reopen", null)}
            >
              {item.reopened ? "Close corrections" : "Reopen corrections"}
            </button>
          )}
        </div>
      )}
      {message && <p role="alert">{message}</p>}
      {retry && (
        <button
          type="button"
          disabled={pending || unavailable}
          onClick={() => execute(retry.request.command)}
        >
          Retry same request
        </button>
      )}
      {item.attempts.length > 0 && (
        <details>
          <summary>Submitted versions ({item.attempts.length})</summary>
          {item.attempts.map((attempt) => (
            <article key={attempt.id}>
              <h4>Submitted version {attempt.ordinal}</h4>
              <p>
                {new Date(attempt.submitted_at).toLocaleString()} ·{" "}
                {attempt.missing.length
                  ? attempt.acceptance
                    ? "Accepted partial"
                    : "Incomplete — awaiting host acceptance"
                  : "Complete"}
              </p>
              <Answers item={item} content={attempt.content} />
              {attempt.reason && <p>Correction reason: {attempt.reason}</p>}
              {attempt.acceptance && (
                <p>Host acceptance reason: {attempt.acceptance.reason}</p>
              )}
            </article>
          ))}
        </details>
      )}
    </section>
  );
}

export function WorkPanel({
  session,
  host = false,
  enabled = true,
}: {
  session: string;
  host?: boolean;
  enabled?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<WorkSnapshot | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const pending = useRef(0);
  const denied = useRef(false);
  const loaded = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current || denied.current || (!enabled && !loaded.current))
      return;
    const readGeneration = ++generation.current;
    try {
      const result = await requestWork(session, host);
      if (readGeneration !== generation.current) return;
      if (result.error) {
        setError(result.error);
        if (result.error === "not_allowed" && loaded.current)
          denied.current = true;
      } else {
        loaded.current = !!result.snapshot;
        setSnapshot(result.snapshot ?? null);
        setError("");
      }
    } catch {
      if (readGeneration === generation.current) setError("unavailable");
    }
  }, [session, host, enabled]);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active) return;
      await refresh();
      if (active) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refresh]);
  useNavigationGuard();
  const mutate = async (operation: string, request: WorkCommand) => {
    generation.current++;
    pending.current++;
    try {
      return await requestWork(session, host, operation, request);
    } finally {
      pending.current--;
      generation.current++;
    }
  };
  if (!snapshot)
    return error && error !== "not_allowed" ? (
      <p role="alert">
        Work service unavailable. Retrying; no empty draft has been loaded.
      </p>
    ) : null;
  return (
    <section aria-labelledby="individual-work-heading">
      <h2 id="individual-work-heading">
        {host ? "Individual work" : "Your individual work"}
      </h2>
      <p>
        Answers are private to their author and the authorized host. Saving or
        submitting does not share them with peers or clients.
      </p>
      {error && (
        <p role="alert">
          {workError(error)}{" "}
          {error === "not_allowed"
            ? "Preserve any local text before leaving."
            : "Retrying connection…"}
        </p>
      )}
      {snapshot.items.length === 0 && (
        <p>Work opens when the first activity starts.</p>
      )}
      {snapshot.items.map((item) => (
        <WorkEditor
          key={`${item.participant}:${item.activity.id}`}
          item={item}
          version={snapshot.version}
          ended={snapshot.ended}
          current={snapshot.current_index}
          host={host}
          unavailable={!!error}
          mutate={mutate}
          refresh={refresh}
        />
      ))}
    </section>
  );
}
