"use client";

import { useEffect, useRef, useState } from "react";
import { INPUT_SCOPE_CHANGED, inputReadDeadline } from "../../lib/inputs";
import {
  reviewError,
  type ReviewReply,
  type ReviewRequest,
  type ReviewSnapshot,
} from "../../lib/reviews";
import { ReviewProjectionDetails } from "./review-projection";

export function ReviewPanel({
  session,
  host = false,
  endpoint,
}: {
  session: string;
  host?: boolean;
  endpoint?: string;
}) {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [offset, setOffset] = useState(0);
  const [sourceOffset, setSourceOffset] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [policy, setPolicy] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [readProblem, setReadProblem] = useState("");
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState<{
    operation: string;
    request: ReviewRequest;
  } | null>(null);
  const generation = useRef(0);
  const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);
  const invalidate = useRef(() => {});
  const heading = useRef<HTMLHeadingElement>(null);
  const previewFocus = useRef(false);
  const previewToken = useRef<string | null>(null);
  const refresh = useRef(() => {});
  const until = useRef(0);
  const latest = useRef<ReviewSnapshot | null>(null);
  async function request(
    r: ReviewRequest,
    operation?: string
  ): Promise<ReviewReply> {
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          session,
          host,
          request: r,
          ...(operation ? { operation } : {}),
        }),
      });
      return await response.json();
    } catch {
      return { error: "unavailable", uncertain: r.command !== "read" };
    }
  }
  useEffect(() => {
    let active = true;
    let inFlight: number | null = null;
    const clear = () => {
      generation.current++;
      inFlight = null;
      clearTimeout(expiry.current);
      latest.current = null;
      until.current = 0;
      setSnapshot(null);
    };
    invalidate.current = clear;
    const read = async () => {
      if (!active || document.hidden || !navigator.onLine || inFlight !== null)
        return;
      const stamp = generation.current;
      inFlight = stamp;
      const started = performance.now();
      // Initial reads also need a deadline: no earlier snapshot timer exists.
      const watchdog = setTimeout(() => {
        if (active && stamp === generation.current) clear();
      }, 5000);
      const r = await request({
        command: "read",
        offset,
        source_offset: sourceOffset,
        ...(previewId ? { proposal: previewId } : {}),
      });
      clearTimeout(watchdog);
      if (inFlight === stamp) inFlight = null;
      if (
        !active ||
        stamp !== generation.current ||
        document.hidden ||
        !navigator.onLine
      )
        return;
      const deadline = inputReadDeadline(started, r.snapshot?.ttl_ms ?? 0);
      if (
        !r.snapshot ||
        (endpoint && r.snapshot.endpoint !== endpoint) ||
        deadline <= performance.now()
      ) {
        clear();
        if (r.error) setReadProblem(reviewError(r.error));
        return;
      }
      if (latest.current && latest.current.endpoint !== r.snapshot.endpoint) {
        clear();
        return;
      }
      if (r.snapshot.preview) {
        if (
          previewToken.current &&
          previewToken.current !== r.snapshot.preview.token
        ) {
          clear();
          setPreviewId(null);
          setMessage(
            "This preview changed. Your proposal is saved; preview it again before release."
          );
          return;
        }
        previewToken.current = r.snapshot.preview.token;
      }
      latest.current = r.snapshot;
      setReadProblem("");
      until.current = deadline;
      setSnapshot(r.snapshot);
      clearTimeout(expiry.current);
      expiry.current = setTimeout(
        clear,
        Math.max(0, deadline - performance.now())
      );
      if (previewFocus.current && r.snapshot.preview) {
        previewFocus.current = false;
        heading.current?.focus();
      }
    };
    refresh.current = () => {
      void read();
    };
    const changed = () => {
      clear();
      void read();
    };
    void read();
    const timer = setInterval(() => void read(), 1000);
    window.addEventListener("offline", clear);
    window.addEventListener("online", changed);
    window.addEventListener(INPUT_SCOPE_CHANGED, changed);
    document.addEventListener("visibilitychange", changed);
    return () => {
      active = false;
      clear();
      clearInterval(timer);
      window.removeEventListener("offline", clear);
      window.removeEventListener("online", changed);
      window.removeEventListener(INPUT_SCOPE_CHANGED, changed);
      document.removeEventListener("visibilitychange", changed);
    };
    // Every scope change creates a fresh read generation; local edits stay separate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, host, endpoint, offset, sourceOffset, previewId]);

  async function mutate(r: ReviewRequest, operation = crypto.randomUUID()) {
    if (busy.current) return;
    if (!retry && (!latest.current || performance.now() >= until.current)) {
      setMessage("Access or preview expired. Wait for a fresh view.");
      return;
    }
    busy.current = true;
    setPending(true);
    invalidate.current();
    const response = await request(r, operation);
    if (response.uncertain) {
      setRetry({ operation, request: r });
      setMessage(
        "Result unknown. Retry this exact action to discover whether it committed."
      );
    } else {
      setRetry(null);
      setMessage(
        response.error
          ? reviewError(response.error)
          : "Action saved. Current permissions are being checked."
      );
      if (!response.error && r.command === "create") {
        setAttempt("");
        setFields([]);
        setRecipients([]);
      }
      if (!response.error && r.command === "enable_policy") setPolicy("");
      if (!response.error && r.command === "release") setPreviewId(null);
    }
    busy.current = false;
    setPending(false);
    if (document.activeElement === document.body) heading.current?.focus();
    refresh.current();
    window.dispatchEvent(
      new CustomEvent(INPUT_SCOPE_CHANGED, { detail: session })
    );
  }
  const locked = pending || !!retry || !snapshot;
  const source = snapshot?.sources?.find((s) => s.id === attempt);
  const live = snapshot?.state === "live" || snapshot?.state === "paused";
  const unavailableRecipients = recipients.filter(
    (id) => !snapshot?.participants?.some((p) => p.id === id)
  );
  const toggle = (items: string[], id: string) =>
    items.includes(id) ? items.filter((v) => v !== id) : [...items, id];
  return (
    <section
      aria-labelledby="review-heading"
      data-work-protected={
        pending ||
        !!retry ||
        !!attempt ||
        recipients.length > 0 ||
        !!policy ||
        !!reason
          ? "true"
          : undefined
      }
    >
      <h2 id="review-heading" ref={heading} tabIndex={-1}>
        Submitted work review
      </h2>
      <p role="status">
        {retry
          ? "Result unknown. Retry this exact action to discover whether it committed."
          : readProblem ||
            message ||
            (snapshot
              ? "Only explicitly authorized fields are shared with named reviewers."
              : "Checking review access…")}
      </p>
      {retry && (
        <button
          disabled={pending}
          onClick={() => void mutate(retry.request, retry.operation)}
        >
          Retry exact review action
        </button>
      )}
      {snapshot && (
        <>
          {!snapshot.enabled && (
            <p>
              New reviewer sharing is disabled. Existing permissions and
              withdrawal controls remain in force.
            </p>
          )}
          {snapshot.policies.map((p) => (
            <div key={`${p.activity}:${p.group}`}>
              <h3>
                Group sharing rule · {p.activity} · {p.group.slice(0, 8)}
              </h3>
              <p>{p.text}</p>
              <p role="status">
                {p.ready
                  ? "All current members have acknowledged."
                  : `Wait before group contributions. Pending: ${p.pending.map((x) => `${x.name} · ${x.id.slice(0, 8)}`).join(", ")}`}
              </p>
              {!host && !p.acknowledged && (
                <button
                  disabled={locked || !live}
                  onClick={() =>
                    void mutate({
                      command: "ack_policy",
                      activity: p.activity,
                      group: p.group,
                      policy: p.policy,
                    })
                  }
                >
                  I have seen this group sharing rule
                </button>
              )}
            </div>
          ))}
          {host && (
            <fieldset disabled={locked || !snapshot.enabled}>
              <legend>Enable prospective group sharing</legend>
              <p>
                Only untouched future group activities are eligible. Every
                member must acknowledge before group saves or submission,
                including after a late join.
              </p>
              <label htmlFor="review-policy-activity">
                Future group activity
              </label>
              <select
                id="review-policy-activity"
                value={policy}
                onChange={(e) => setPolicy(e.target.value)}
              >
                <option value="">Choose activity</option>
                {snapshot.activities
                  ?.filter((a) => a.scope === "group")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} · {a.id}
                    </option>
                  ))}
              </select>
              <button
                disabled={!policy}
                onClick={() =>
                  void mutate({ command: "enable_policy", activity: policy })
                }
              >
                Enable group review rule
              </button>
            </fieldset>
          )}
          {host && (
            <fieldset disabled={locked || !snapshot.enabled || !live}>
              <legend>Select fixed submitted work</legend>
              <label htmlFor="review-source">Exact submitted version</label>
              <select
                id="review-source"
                value={attempt}
                onChange={(e) => {
                  setAttempt(e.target.value);
                  setFields([]);
                }}
              >
                <option value="">Choose submission</option>
                {snapshot.sources?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} · {s.owner_label} · {s.owner.slice(0, 8)} ·
                    version {s.ordinal}
                  </option>
                ))}
              </select>
              <fieldset>
                <legend>Selected fields</legend>
                {source?.fields.map((f) => (
                  <label key={f.id}>
                    <input
                      type="checkbox"
                      checked={fields.includes(f.id)}
                      onChange={() => setFields(toggle(fields, f.id))}
                    />
                    {f.label}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Named reviewers</legend>
                {snapshot.participants?.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={recipients.includes(p.id)}
                      onChange={() => setRecipients(toggle(recipients, p.id))}
                    />
                    {p.name} · {p.id.slice(0, 8)}
                  </label>
                ))}
              </fieldset>
              <p>
                Owners and contributors cannot review their own source. Saving a
                proposal grants no reviewer access.
              </p>
              <button
                disabled={
                  !attempt ||
                  !fields.length ||
                  !recipients.length ||
                  unavailableRecipients.length > 0
                }
                onClick={() =>
                  void mutate({
                    command: "create",
                    proposal: crypto.randomUUID(),
                    attempt,
                    fields,
                    recipients,
                    activity: snapshot.current,
                  })
                }
              >
                Save review proposal
              </button>
              {unavailableRecipients.map((id) => (
                <div key={id}>
                  <p role="alert">
                    Selected reviewer {id.slice(0, 8)} is no longer admitted.
                    Remove this selection before saving.
                  </p>
                  <button
                    onClick={() => {
                      setRecipients(recipients.filter((value) => value !== id));
                      heading.current?.focus();
                    }}
                  >
                    Remove unavailable reviewer {id.slice(0, 8)}
                  </button>
                </div>
              ))}
              {sourceOffset > 0 && (
                <button
                  disabled={!!attempt}
                  onClick={() => {
                    invalidate.current();
                    setSourceOffset(Math.max(0, sourceOffset - 20));
                  }}
                >
                  Previous submitted versions
                </button>
              )}
              {snapshot.source_next_offset != null && (
                <button
                  disabled={!!attempt}
                  onClick={() => {
                    invalidate.current();
                    setSourceOffset(snapshot.source_next_offset!);
                  }}
                >
                  More submitted versions
                </button>
              )}
            </fieldset>
          )}
          {host && (
            <>
              <label htmlFor="review-reason">
                Reason for closing or revoking review access
              </label>
              <textarea
                id="review-reason"
                value={reason}
                disabled={pending || !!retry}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
              />
            </>
          )}
          {snapshot.items.map((p) => (
            <div
              key={p.id}
              role="group"
              aria-label={`Review proposal ${p.id.slice(0, 8)}`}
            >
              <h3>
                Review proposal · {p.id.slice(0, 8)} · {p.state}
              </h3>
              {p.source ? (
                <ReviewProjectionDetails source={p.source} />
              ) : (
                <p>Selected source unavailable.</p>
              )}
              <p>
                Review activity: {p.activity}. Named audience:{" "}
                {p.recipients
                  .map(
                    (r) =>
                      `${r.name} · ${r.id.slice(0, 8)}${r.revoked ? " (revoked)" : ""}`
                  )
                  .join(", ")}
              </p>
              <div className="actions">
                {host && p.state === "draft" && (
                  <button
                    disabled={locked || !snapshot.enabled || !live}
                    onClick={() =>
                      void mutate({ command: "request", proposal: p.id })
                    }
                  >
                    Request author approval
                  </button>
                )}
                {!host && p.state === "pending" && (
                  <>
                    <button
                      disabled={locked || !snapshot.enabled || !live}
                      onClick={() =>
                        void mutate({ command: "approve", proposal: p.id })
                      }
                    >
                      Approve this exact review audience
                    </button>
                    <button
                      disabled={locked}
                      onClick={() =>
                        void mutate({ command: "decline", proposal: p.id })
                      }
                    >
                      Decline review sharing
                    </button>
                  </>
                )}
                {!host &&
                  ["pending", "approved", "released"].includes(p.state) && (
                    <button
                      disabled={locked}
                      onClick={() =>
                        void mutate({ command: "withdraw", proposal: p.id })
                      }
                    >
                      Withdraw review permission
                    </button>
                  )}
                {host && p.state === "approved" && (
                  <button
                    disabled={locked || !snapshot.enabled || !live}
                    onClick={() => {
                      invalidate.current();
                      previewToken.current = null;
                      previewFocus.current = true;
                      setPreviewId(p.id);
                    }}
                  >
                    Preview named reviewer release
                  </button>
                )}
                {host && ["draft", "pending", "approved"].includes(p.state) && (
                  <button
                    disabled={locked}
                    onClick={() =>
                      void mutate({ command: "cancel", proposal: p.id })
                    }
                  >
                    Cancel review proposal
                  </button>
                )}
                {host && p.state === "released" && (
                  <>
                    <button
                      disabled={locked || !reason.trim()}
                      onClick={() =>
                        void mutate({
                          command: "close",
                          proposal: p.id,
                          reason,
                        })
                      }
                    >
                      Close review
                    </button>
                    {p.recipients
                      .filter((r) => !r.revoked)
                      .map((r) => (
                        <button
                          key={r.id}
                          disabled={locked || !reason.trim()}
                          onClick={() =>
                            void mutate({
                              command: "revoke",
                              proposal: p.id,
                              participant: r.id,
                              reason,
                            })
                          }
                        >
                          Revoke review for {r.name} · {r.id.slice(0, 8)}
                        </button>
                      ))}
                  </>
                )}
              </div>
            </div>
          ))}
          {snapshot.preview && previewId && (
            <div role="group" aria-label="Reviewer release preview">
              <h3>Confirm exact reviewer release</h3>
              <p>Permission basis: {snapshot.preview.permission_basis}</p>
              <p>
                Target activity: {snapshot.preview.target_activity}. Current
                activity: {snapshot.preview.current_activity}.
              </p>
              {snapshot.preview.source && (
                <ReviewProjectionDetails source={snapshot.preview.source} />
              )}
              <p>
                Named recipients:{" "}
                {snapshot.preview.recipients
                  .map((p) => `${p.name} · ${p.id.slice(0, 8)}`)
                  .join(", ")}
              </p>
              {snapshot.preview.newer_version && (
                <p>
                  A newer submitted version exists. This release keeps the
                  selected older version.
                </p>
              )}
              {snapshot.preview.problems.map((p) => (
                <p role="alert" key={p}>
                  {p}
                </p>
              ))}
              <button
                disabled={
                  locked ||
                  !snapshot.enabled ||
                  snapshot.preview.problems.length > 0
                }
                onClick={() =>
                  void mutate({
                    command: "release",
                    proposal: previewId,
                    token: snapshot.preview!.token,
                  })
                }
              >
                Confirm reviewer release
              </button>
              <button
                disabled={pending || !!retry}
                onClick={() => {
                  invalidate.current();
                  setPreviewId(null);
                }}
              >
                Cancel release preview
              </button>
            </div>
          )}
          <div className="actions">
            {offset > 0 && (
              <button
                disabled={locked}
                onClick={() => {
                  invalidate.current();
                  setOffset(Math.max(0, offset - 20));
                }}
              >
                Previous review proposals
              </button>
            )}
            {snapshot.next_offset !== null && (
              <button
                disabled={locked}
                onClick={() => {
                  invalidate.current();
                  setOffset(snapshot.next_offset!);
                }}
              >
                More review proposals
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
