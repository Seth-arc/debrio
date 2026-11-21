"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  groupContextChanged,
  groupError,
  groupPlan,
  randomGroups,
  reconcileGroups,
  type GroupPlan,
  type GroupReply,
  type GroupSnapshot,
} from "../../lib/groups";
import { validWorkText } from "../../lib/work";

async function requestGroups(
  session: string,
  host: boolean,
  operation?: string,
  request?: GroupPlan
): Promise<GroupReply> {
  const response = await fetch("/api/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, host, operation, request }),
    cache: "no-store",
  });
  return response.json();
}
const notice =
  "Current groupmates can see one another’s display names. Individual answers remain private to their author and the authorized host. Future group work needs a separate sharing policy; this is not publication approval.";

export function GroupPanel({
  session,
  host = false,
  enabled = true,
}: {
  session: string;
  host?: boolean;
  enabled?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<GroupSnapshot | null>(null);
  const [base, setBase] = useState<GroupSnapshot | null>(null);
  const [plan, setPlan] = useState<GroupPlan | null>(null);
  const [preview, setPreview] = useState(false);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState<{
    operation: string;
    request: GroupPlan;
  } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const busy = useRef(false),
    generation = useRef(0),
    denied = useRef(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const refresh = useCallback(async () => {
    if (!enabled || busy.current || denied.current) return;
    if (!navigator.onLine) {
      generation.current++;
      setError("unavailable");
      return;
    }
    const read = ++generation.current;
    try {
      const result = await requestGroups(session, host);
      if (read !== generation.current) return;
      if (result.error) {
        setError(result.error);
        if (result.error === "not_allowed") denied.current = true;
      } else {
        setSnapshot(result.snapshot ?? null);
        setError("");
      }
    } catch {
      if (read === generation.current) setError("unavailable");
    }
  }, [session, host, enabled]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active) return;
      await refresh();
      if (active) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      active = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate in-flight reads on cleanup; this is a generation counter, not a DOM ref.
      generation.current++;
      clearTimeout(timer);
    };
  }, [refresh]);
  const conflict = !!(base && snapshot && groupContextChanged(base, snapshot));
  const locked =
    pending ||
    !!retry ||
    !!error ||
    conflict ||
    snapshot?.state === "completed";
  const change = (next: GroupPlan) => {
    setPlan(next);
    setPreview(false);
    setMessage("");
  };
  function begin() {
    if (snapshot) {
      setBase(snapshot);
      setPlan(groupPlan(snapshot));
      setPreview(false);
      setMessage("");
    }
  }
  function reconcile() {
    if (!snapshot || !plan) return;
    const fresh = reconcileGroups(snapshot, plan);
    setBase(snapshot);
    change(fresh);
    setMessage(
      "Current roster loaded. Your surviving member choices are retained; inspect every assignment and preview again. Retire groups again explicitly if needed."
    );
  }
  async function confirm(existing = retry) {
    if (busy.current || (!existing && (!plan || !preview || locked))) return;
    const op = existing ?? { operation: crypto.randomUUID(), request: plan! };
    busy.current = true;
    generation.current++;
    setPending(true);
    setMessage("");
    try {
      const result = await requestGroups(
        session,
        true,
        op.operation,
        op.request
      );
      if (result.uncertain) {
        setRetry(op);
        setMessage(
          "Result unknown. Keep this page open and retry the same assignment request."
        );
      } else if (result.error) {
        setRetry(null);
        setPreview(false);
        setMessage(groupError(result.error));
        if (result.error === "not_allowed") {
          denied.current = true;
          setError(result.error);
        }
      } else if (result.receipt) {
        setRetry(null);
        setPlan(null);
        setBase(null);
        setPreview(false);
        setMessage(
          `${result.receipt.changed ? "Confirmed" : "No change"} · revision ${result.receipt.revision} · ${new Date(result.receipt.confirmed_at).toLocaleString()}`
        );
      } else {
        setRetry(op);
        setMessage("Result unknown. Retry the same assignment request.");
      }
    } catch {
      setRetry(op);
      setMessage(
        "Result unknown. Keep this page open and retry the same assignment request."
      );
    } finally {
      busy.current = false;
      generation.current++;
      setPending(false);
      await refresh();
    }
  }
  if (!enabled) return null;
  if (error === "not_allowed")
    return (
      <section
        aria-label="Group access"
        data-work-protected={host && (!!plan || !!retry) ? "true" : "false"}
      >
        <p role="alert">{groupError(error)}</p>
      </section>
    );
  if (!snapshot)
    return error ? (
      <p role="alert">
        Group service unavailable. Retrying; no empty assignment has been
        loaded.
      </p>
    ) : null;
  const label = (key: string | null) => {
    if (!key) return "Unassigned";
    const old =
      base?.groups?.find((g) => g.id === key) ??
      snapshot.groups?.find((g) => g.id === key);
    if (old) return `Group ${old.ordinal}`;
    const added =
      plan?.groups
        .filter((g) => g.create)
        .map((g) => g.key)
        .sort() ?? [];
    return `Group ${(base?.next_ordinal ?? 1) + added.indexOf(key)} (new)`;
  };
  const name = (id: string) => {
    const m = (base ?? snapshot).members.find((p) => p.participant === id);
    return `${m?.name ?? "Participant"} · ${id.slice(0, 8)}`;
  };
  return (
    <section
      aria-labelledby="group-heading"
      data-work-protected={
        host && (!!plan || pending || !!retry) ? "true" : "false"
      }
    >
      <h2 id="group-heading">{host ? "Session groups" : "Your group"}</h2>
      <p>{notice}</p>
      {error && <p role="alert">{groupError(error)} Retrying connection…</p>}
      {message && <p role="status">{message}</p>}
      {snapshot.state === "completed" && (
        <p>Session ended · groups are read-only.</p>
      )}
      {!host ? (
        <div role="status">
          <p>
            {snapshot.group ? `Group ${snapshot.group.ordinal}` : "Unassigned"}
          </p>
          <ul>
            {snapshot.members.map((m) => (
              <li key={m.participant}>
                {m.name} · {m.participant.slice(0, 8)}
              </li>
            ))}
          </ul>
          <p>Your individual activity and work permissions are unchanged.</p>
        </div>
      ) : (
        <>
          <p>
            Current assignment revision {snapshot.revision}.{" "}
            {snapshot.members.length} admitted people. Grouping does not move
            media or share answers.
          </p>
          <ul>
            {(snapshot.groups ?? []).map((g) => (
              <li key={g.id}>
                Group {g.ordinal}:{" "}
                {snapshot.members.filter((m) => m.group === g.id).length} people
                {snapshot.members.every((m) => m.group !== g.id)
                  ? " · Empty"
                  : ""}
              </li>
            ))}
          </ul>
          <p>{snapshot.members.filter((m) => !m.group).length} Unassigned</p>
          {!plan && (
            <button
              disabled={!!error || snapshot.state === "completed"}
              onClick={begin}
            >
              Edit group assignment
            </button>
          )}
          {plan && (
            <>
              {conflict && (
                <div role="alert">
                  <p>{groupError("group_conflict")}</p>
                  <p>
                    Latest roster:{" "}
                    {snapshot.members
                      .map((m) => `${m.name} (${m.participant.slice(0, 8)})`)
                      .join(", ") || "Nobody admitted"}
                    .
                  </p>
                  <button
                    disabled={pending || !!retry || !!error}
                    onClick={reconcile}
                  >
                    Reconcile with current roster
                  </button>
                </div>
              )}
              {plan.groups.length > 8 && (
                <p role="alert">
                  Current groups and your proposed groups exceed eight. Your
                  proposal is retained; move members and retire empty groups
                  before previewing.
                </p>
              )}
              <fieldset disabled={locked}>
                <legend>Proposed allocation</legend>
                <button
                  onClick={() =>
                    change({
                      ...plan,
                      groups: [
                        ...plan.groups,
                        { key: crypto.randomUUID(), create: true },
                      ],
                    })
                  }
                  disabled={plan.groups.length >= 8}
                >
                  Add group
                </button>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Replace this proposal with a new random suggestion? Manual edits will be replaced."
                      )
                    ) {
                      try {
                        change(randomGroups(plan));
                      } catch (e) {
                        setMessage((e as Error).message);
                      }
                    }
                  }}
                >
                  Suggest random groups
                </button>
                <ul>
                  {plan.groups.map((g) => (
                    <li key={g.key}>
                      {label(g.key)}:{" "}
                      {plan.members.filter((m) => m.group === g.key).length}{" "}
                      people
                      {plan.members.every((m) => m.group !== g.key)
                        ? " · Empty"
                        : ""}{" "}
                      <button
                        disabled={plan.members.some((m) => m.group === g.key)}
                        onClick={() =>
                          change({
                            ...plan,
                            groups: plan.groups.filter((p) => p.key !== g.key),
                            retire: g.create
                              ? plan.retire
                              : [...plan.retire, g.key],
                          })
                        }
                      >
                        Retire {label(g.key)}
                      </button>
                    </li>
                  ))}
                </ul>
                {plan.members.map((m) => (
                  <div key={m.participant}>
                    <label htmlFor={`assign-${m.participant}`}>
                      {name(m.participant)}
                    </label>
                    <select
                      id={`assign-${m.participant}`}
                      value={m.group ?? ""}
                      onChange={(e) =>
                        change({
                          ...plan,
                          members: plan.members.map((p) =>
                            p.participant === m.participant
                              ? { ...p, group: e.target.value || null }
                              : p
                          ),
                        })
                      }
                    >
                      <option value="">Unassigned</option>
                      {plan.groups.map((g) => (
                        <option key={g.key} value={g.key}>
                          {label(g.key)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <label htmlFor="group-reason">
                  Reason for changing membership
                  {snapshot.state !== "ready"
                    ? " (required for live or paused membership changes)"
                    : " (optional during preparation)"}
                </label>
                <textarea
                  id="group-reason"
                  value={plan.reason}
                  onChange={(e) => change({ ...plan, reason: e.target.value })}
                />
                <p>
                  Reason limit: 500 characters. Unassigned people continue their
                  individual activity.
                </p>
                <button
                  disabled={
                    plan.groups.length > 8 || !validWorkText(plan.reason, 500)
                  }
                  onClick={() => {
                    setPreview(true);
                    setTimeout(() => previewHeading.current?.focus(), 0);
                  }}
                >
                  Preview changes
                </button>
              </fieldset>
              {preview && (
                <div>
                  <h3 ref={previewHeading} tabIndex={-1}>
                    Preview group changes
                  </h3>
                  <p>
                    Activity{" "}
                    {plan.activity_index < 0
                      ? "not started"
                      : plan.activity_index + 1}
                    . Only assignment changes; individual work stays private and
                    media is not moved.
                  </p>
                  <ul>
                    {plan.members.map((m) => (
                      <li key={m.participant}>
                        {name(m.participant)}:{" "}
                        {label(
                          base!.members.find(
                            (p) => p.participant === m.participant
                          )?.group ?? null
                        )}{" "}
                        → {label(m.group)}
                      </li>
                    ))}
                  </ul>
                  <p>
                    {plan.members.filter((m) => !m.group).length} Unassigned ·{" "}
                    {
                      plan.groups.filter((g) =>
                        plan.members.every((m) => m.group !== g.key)
                      ).length
                    }{" "}
                    empty groups.
                  </p>
                  {plan.retire.length > 0 && (
                    <p>Retiring: {plan.retire.map(label).join(", ")}</p>
                  )}
                  <button disabled={locked} onClick={() => void confirm()}>
                    Confirm assignment
                  </button>
                </div>
              )}
              <button
                className="secondary"
                disabled={pending || !!retry}
                onClick={() => {
                  setPlan(null);
                  setBase(null);
                  setPreview(false);
                  setMessage("Proposal cancelled. Assignment unchanged.");
                }}
              >
                Cancel proposal
              </button>
            </>
          )}
          {pending && <p role="status">Confirming assignment…</p>}
          {retry && (
            <button
              disabled={pending || !!error}
              onClick={() => void confirm(retry)}
            >
              Retry same assignment
            </button>
          )}
          <details>
            <summary>Assignment history</summary>
            {(snapshot.history ?? []).map((h) => (
              <div key={h.revision}>
                <h3>
                  Revision {h.revision} · {h.source}
                </h3>
                <p>
                  {h.reason || "Prepared-session setup"} ·{" "}
                  {new Date(h.created_at).toLocaleString()}
                </p>
                <ul>
                  {h.after_state.members.map((m) => (
                    <li key={m.participant}>
                      {m.participant.slice(0, 8)}:{" "}
                      {h.before_state.members.find(
                        (p) => p.participant === m.participant
                      )?.group ?? "Unassigned"}{" "}
                      → {m.group}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
