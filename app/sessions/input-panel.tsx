"use client";

import { useEffect, useRef, useState } from "react";
import {
  INPUT_SCOPE_CHANGED,
  inputError,
  inputReadDeadline,
  type InputCommand,
  type InputField,
  type InputPreview,
  type InputReply,
  type InputSnapshot,
} from "../../lib/inputs";
import { validWorkText } from "../../lib/work";

export function InputSource({ source }: { source: InputField }) {
  return (
    <div>
      <h4>
        {source.source_title} · submitted version {source.ordinal}
      </h4>
      <p>
        {source.field.label} · {source.field.kind} text · Read-only
      </p>
      <p className="instructions" data-input-value>
        {source.value}
      </p>
      <p>
        Owner: {source.owner}. Submission: {source.attempt}. Submitted by:{" "}
        {source.submitter}.
      </p>
      <p>Declared field authors: {source.authors.join(", ") || "None"}.</p>
      {source.acceptance && (
        <p>
          Accepted partial submission
          {source.acceptance.reason ? `: ${source.acceptance.reason}` : "."}
        </p>
      )}
    </div>
  );
}

export function InputPreviewDetails({ preview }: { preview: InputPreview }) {
  return (
    <div>
      <p>
        Confirming grants only these exact fields to these recipients. Later
        source corrections will not change them.
      </p>
      {preview.problems.length > 0 && (
        <ul>
          {preview.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {preview.candidates.map((c) => (
        <div key={c.owner}>
          <h4>
            {c.label} · {c.owner}
          </h4>
          {c.source ? (
            <InputSource source={c.source} />
          ) : (
            <p>Required submitted source is unavailable.</p>
          )}
          <ul>
            {c.recipients.map((r) => (
              <li key={r.participant}>
                {r.name} · {r.participant}{" "}
                {r.interval && `· membership ${r.interval}`} ·{" "}
                {r.granted ? "Already granted" : "New field access"}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

async function requestInput(
  session: string,
  host: boolean,
  operation?: string,
  request?: InputCommand
): Promise<InputReply> {
  const response = await fetch("/api/inputs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, host, operation, request }),
    cache: "no-store",
  });
  return response.json();
}

export function InputPanel({
  session,
  host = false,
  endpoint,
}: {
  session: string;
  host?: boolean;
  endpoint?: string;
}) {
  const [snapshot, setSnapshot] = useState<InputSnapshot | null>();
  const [problem, setProblem] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<InputCommand | null>(null);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState<{
    operation: string;
    request: InputCommand;
  } | null>(null);
  const generation = useRef(0);
  const invalidate = useRef(() => {});
  const busy = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const previewTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let alive = true;
    const fence = generation;
    let inFlight: number | null = null;
    let expiry: ReturnType<typeof setTimeout>;
    const clear = () => {
      generation.current++;
      inFlight = null;
      clearTimeout(expiry);
      setSnapshot(null);
    };
    invalidate.current = clear;
    const poll = async () => {
      if (inFlight !== null || document.hidden || !navigator.onLine) return;
      const ticket = ++generation.current;
      inFlight = ticket;
      const timeout = setTimeout(() => {
        if (alive && ticket === generation.current) clear();
      }, 5000);
      const started = performance.now();
      try {
        const result = await requestInput(session, host);
        if (
          !alive ||
          ticket !== generation.current ||
          document.hidden ||
          !navigator.onLine
        )
          return;
        const deadline = inputReadDeadline(
          started,
          result.snapshot?.ttl_ms ?? 0
        );
        if (
          !result.snapshot ||
          (endpoint && result.snapshot.endpoint !== endpoint) ||
          performance.now() >= deadline
        ) {
          clear();
          return;
        }
        setSnapshot(result.snapshot);
        clearTimeout(expiry);
        expiry = setTimeout(clear, Math.max(0, deadline - performance.now()));
      } catch {
        if (alive && ticket === generation.current) clear();
      } finally {
        clearTimeout(timeout);
        if (inFlight === ticket) inFlight = null;
      }
    };
    const changed = () => {
      clear();
      if (!document.hidden && navigator.onLine) void poll();
    };
    const scopeChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === session) changed();
    };
    window.addEventListener(INPUT_SCOPE_CHANGED, scopeChanged);
    void poll();
    const timer = setInterval(() => void poll(), 750);
    document.addEventListener("visibilitychange", changed);
    window.addEventListener("offline", changed);
    window.addEventListener("online", changed);
    return () => {
      alive = false;
      fence.current++;
      clearTimeout(expiry);
      clearInterval(timer);
      window.removeEventListener(INPUT_SCOPE_CHANGED, scopeChanged);
      document.removeEventListener("visibilitychange", changed);
      window.removeEventListener("offline", changed);
      window.removeEventListener("online", changed);
    };
  }, [session, host, endpoint]);

  useEffect(() => {
    if (preview) previewTitle.current?.focus();
  }, [preview]);

  const execute = async () => {
    if (busy.current || (!retry && !preview)) return;
    const operation = retry?.operation ?? crypto.randomUUID();
    const request = retry?.request ?? { ...preview!, reason };
    busy.current = true;
    setPending(true);
    setProblem("");
    try {
      const result = await requestInput(session, host, operation, request);
      invalidate.current();
      if (result.uncertain || (!result.error && !result.receipt?.committed)) {
        setRetry({ operation, request });
        setProblem(
          "Result unknown. Retry this exact request to check it safely."
        );
      } else {
        setRetry(null);
        setProblem(
          result.error ? inputError(result.error) : "Input access updated."
        );
        if (!result.error) {
          setPreview(null);
          setReason("");
        }
      }
    } catch {
      invalidate.current();
      setRetry({ operation, request });
      setProblem(
        "Result unknown. Retry this exact request to check it safely."
      );
    } finally {
      busy.current = false;
      setPending(false);
      if (previewTitle.current) previewTitle.current.focus();
      else title.current?.focus();
    }
  };
  const stale =
    preview?.command === "resolve" &&
    preview.token !== snapshot?.preview?.token;
  const missing =
    snapshot?.current?.input &&
    !snapshot.items.some((i) => i.activity === snapshot.current?.id);
  if (
    snapshot === undefined ||
    (snapshot &&
      !snapshot.current?.input &&
      snapshot.items.length === 0 &&
      !preview &&
      !retry &&
      !pending &&
      !reason)
  )
    return null;
  return (
    <section
      aria-labelledby="input-heading"
      data-pending={pending}
      data-work-protected={
        reason || preview || pending || retry ? "true" : undefined
      }
    >
      <h2 id="input-heading" ref={title} tabIndex={-1}>
        Fixed prior-output inputs
      </h2>
      <p role="status">
        {!snapshot
          ? "Verifying input access. Fetched input is hidden."
          : missing
            ? "Input access needs host confirmation."
            : "Only explicitly granted submitted fields appear here."}
      </p>
      {problem && <p role="status">{problem}</p>}
      {snapshot?.items.map((item) => (
        <div
          key={`${session}:${snapshot.actor}:${snapshot.endpoint}:${item.source.owner}:${item.activity}:${item.binding}:${item.interval}:${item.grant}`}
        >
          <h3>Input for activity {item.activity}</h3>
          <InputSource source={item.source} />
          {host && !preview && !retry && (
            <div className="actions">
              <button
                onClick={() =>
                  setPreview({
                    command: "revoke",
                    binding: item.binding,
                    grant: null,
                    reason: "",
                  })
                }
              >
                Revoke this input delivery
              </button>
              {item.grants
                ?.filter((g) => g.valid)
                .map((g) => (
                  <button
                    key={g.id}
                    onClick={() =>
                      setPreview({
                        command: "revoke",
                        binding: item.binding,
                        grant: g.id,
                        reason: "",
                      })
                    }
                  >
                    Revoke input for {g.participant}
                  </button>
                ))}
            </div>
          )}
        </div>
      ))}
      {host && snapshot?.preview && !preview && !retry && (
        <button
          onClick={() =>
            setPreview({
              command: "resolve",
              token: snapshot.preview!.token,
              reason: "",
            })
          }
        >
          Resolve input access
        </button>
      )}
      {preview && (
        <div role="group" aria-label="Confirm input access">
          <h3 ref={previewTitle} tabIndex={-1}>
            {preview.command === "resolve"
              ? "Preview input access"
              : "Revoke input access?"}
          </h3>
          {preview.command === "resolve" && !stale && snapshot?.preview && (
            <InputPreviewDetails preview={snapshot.preview} />
          )}
          {preview.command === "revoke" && (
            <p>
              Stop future input reads and dependent writes for{" "}
              {preview.grant
                ? `grant ${preview.grant}`
                : "all recipients of this binding"}
              . Acknowledged work and independently authorized submission
              history remain.
            </p>
          )}
          {stale && (
            <p role="alert">
              This preview is out of date or access is unavailable. Cancel and
              preview again.
            </p>
          )}
          <label>
            Reason for input access change
            <textarea
              value={reason}
              readOnly={pending || !!retry}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={
              !snapshot ||
              pending ||
              !!retry ||
              stale ||
              !reason.trim() ||
              !validWorkText(reason, 500) ||
              (preview.command === "resolve" &&
                !!snapshot.preview?.problems.length)
            }
            onClick={() => void execute()}
          >
            Confirm input access change
          </button>
          <button
            disabled={pending || !!retry}
            onClick={() => {
              setPreview(null);
              setReason("");
              title.current?.focus();
            }}
          >
            Cancel input access change
          </button>
        </div>
      )}
      {retry && (
        <button disabled={pending || !snapshot} onClick={() => void execute()}>
          Retry input request
        </button>
      )}
    </section>
  );
}
