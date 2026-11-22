"use client";

import { invalidateInputReads } from "../../lib/inputs";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AnswerField } from "../../lib/agenda";
import { validWorkText, workText } from "../../lib/work";
import {
  groupWorkError,
  type Contribution,
  type GroupDraft,
  type GroupWorkCommand,
  type GroupWorkItem,
  type GroupWorkReply,
  type GroupWorkSnapshot,
  type RecorderCommand,
} from "../../lib/group-work";

type Mutation = GroupWorkCommand | RecorderCommand;
type Mutate = (request: Mutation, acknowledged?: () => void) => Promise<void>;
const keyOf = (item: GroupWorkItem) => `${item.group}:${item.activity.id}`;
const identity = (id: string, snapshot: GroupWorkSnapshot) =>
  `${snapshot.members.find((p) => p.participant === id)?.name ?? "Participant"} · ${id.slice(0, 8)}`;

async function call(
  session: string,
  host: boolean,
  operation?: string,
  request?: Mutation
): Promise<GroupWorkReply> {
  const response = await fetch("/api/group-work", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, host, operation, request }),
    cache: "no-store",
  });
  const result: GroupWorkReply = await response.json();
  if (
    result.error === "not_allowed" ||
    result.error === "input_access_required"
  )
    invalidateInputReads(session);
  return result;
}

function ContributionEditor({
  field,
  saved,
  available,
  writable,
  blocked,
  request,
  mutate,
}: {
  field: AnswerField;
  saved?: Contribution;
  available: boolean;
  writable: boolean;
  blocked: boolean;
  request: (
    command: GroupWorkCommand["command"],
    extras?: Partial<GroupWorkCommand>
  ) => GroupWorkCommand;
  mutate: Mutate;
}) {
  const [base, setBase] = useState({
    revision: saved?.revision ?? 0,
    value: saved?.content ?? "",
  });
  const [text, setText] = useState(base.value);
  const inputId = useId();
  const [conflict, setConflict] = useState(false);
  const dirty = workText(text) !== base.value;
  if (!blocked && (saved?.revision ?? 0) > base.revision) {
    if (dirty && !conflict) setConflict(true);
    if (!dirty) {
      setBase({ revision: saved!.revision, value: saved!.content });
      setText(saved!.content);
    }
  }
  const valid = validWorkText(text, field.kind === "short" ? 500 : 5000);
  if (!available && !dirty) return null;
  return (
    <fieldset data-work-protected={dirty || conflict ? "true" : undefined}>
      <legend>Your contribution: {field.label}</legend>
      <p role="status">
        {conflict
          ? "Conflict"
          : dirty
            ? "Unsaved changes"
            : saved
              ? `Saved revision ${saved.revision}`
              : "No saved contribution"}
        {!writable && " · Closed for writing"}
      </p>
      <label htmlFor={inputId}>Contribution text</label>
      <textarea
        id={inputId}
        value={text}
        readOnly={!writable}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={!valid}
      />
      {!valid && (
        <p role="alert">
          Use at most {field.kind === "short" ? 500 : 5000} characters, without
          invalid Unicode.
        </p>
      )}
      <button
        disabled={blocked || !writable || conflict || !dirty || !valid}
        onClick={() => {
          const value = workText(text),
            revision = base.revision;
          void mutate(
            request("contribute", { field: field.id, value, revision }),
            () => setBase({ revision: revision + 1, value })
          );
        }}
      >
        Save contribution
      </button>
      {conflict && available && (
        <>
          <p>
            Current saved contribution:{" "}
            <span className="instructions">{saved?.content || "Empty"}</span>
          </p>
          <button
            disabled={blocked || !writable}
            onClick={() => {
              setBase({
                revision: saved?.revision ?? 0,
                value: saved?.content ?? "",
              });
              setConflict(false);
            }}
          >
            Keep my text against current revision
          </button>
          <button
            disabled={blocked}
            onClick={() => {
              setText(saved?.content ?? "");
              setBase({
                revision: saved?.revision ?? 0,
                value: saved?.content ?? "",
              });
              setConflict(false);
            }}
          >
            Discard my unsaved contribution
          </button>
        </>
      )}
    </fieldset>
  );
}

function GroupEditor({
  item,
  snapshot,
  available,
  host,
  blocked,
  mutate,
}: {
  item: GroupDraft;
  snapshot: GroupWorkSnapshot;
  available: boolean;
  host: boolean;
  blocked: boolean;
  mutate: Mutate;
}) {
  const [base, setBase] = useState({
    revision: item.revision,
    content: item.content,
  });
  const editorId = useId();
  const [text, setText] = useState(item.content);
  const [sources, setSources] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState("");
  const [audience, setAudience] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState<{
    request: GroupWorkCommand;
    draft: GroupDraft;
    roster: GroupWorkSnapshot["members"];
  } | null>(null);
  const [notice, setNotice] = useState("");
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const fields = item.activity.outputs;
  const readableSources = [
    ...new Map(
      [...item.sources, ...item.contributions]
        .filter((c) => c.content.trim())
        .map((c) => [c.id, c])
    ).values(),
  ];
  const dirtyText = fields.some(
    (f) => workText(text[f.id] ?? "") !== (base.content[f.id] ?? "")
  );
  const dirty = dirtyText || Object.values(sources).some((s) => s.length > 0);
  const recorder = snapshot.actor === item.recorder;
  const writable = available && item.writable && !host;
  if (!blocked && item.revision > base.revision) {
    if (dirty && !conflict) setConflict(true);
    if (!dirty) {
      setBase({ revision: item.revision, content: item.content });
      setText(item.content);
    }
  }
  useEffect(() => {
    if (preview) heading.current?.focus();
  }, [preview]);
  const request = (
    command: GroupWorkCommand["command"],
    extras: Partial<GroupWorkCommand> = {}
  ): GroupWorkCommand => ({
    command,
    group: item.group,
    activity: item.activity.id,
    version: snapshot.version,
    context: snapshot.context,
    token: item.token,
    window_revision: item.window_revision,
    reason: workText(reason),
    ...extras,
  });
  const hasUnsavedWork = () =>
    dirty ||
    conflict ||
    !!section.current?.querySelector('[data-work-protected="true"]');
  const showPreview = (
    command: GroupWorkCommand["command"],
    extras: Partial<GroupWorkCommand> = {}
  ) => {
    if (command.startsWith("submit") && hasUnsavedWork()) {
      setNotice(
        "Save or reconcile your local contribution and answer changes before submitting."
      );
      return;
    }
    setNotice("");
    setPreview({
      request: request(command, extras),
      draft: structuredClone(item),
      roster: snapshot.members.filter((p) => p.group === item.group),
    });
  };
  const stale =
    !!preview &&
    (preview.request.token !== item.token ||
      preview.request.context !== snapshot.context ||
      !available);
  const invalid = fields.some(
    (f) => !validWorkText(text[f.id] ?? "", f.kind === "short" ? 500 : 5000)
  );
  const latest = item.attempts.at(-1);
  const previewCommand = preview?.request.command;
  const replacementSources = preview?.request.value?.trim()
    ? (preview.request.sources?.[preview.request.field!] ?? [])
    : [];
  const replacementAuthors = preview?.request.value?.trim()
    ? [
        snapshot.actor!,
        ...readableSources
          .filter((c) => replacementSources.includes(c.id))
          .map((c) => c.author_id),
      ]
    : [];

  return (
    <section
      ref={section}
      aria-label={`Group work ${item.activity.title} ${item.group.slice(0, 8)}`}
      data-work-protected={
        dirty || reason || preview || conflict ? "true" : undefined
      }
    >
      <h3>
        {item.activity.title} · Group {item.group_ordinal}
      </h3>
      {notice && <p role="alert">{notice}</p>}
      <p role="status">
        {!available
          ? "Unavailable: current access cannot be confirmed. Local unsaved text remains scoped to this group and activity."
          : !item.writable
            ? "Closed for writing"
            : "Open for work"}
      </p>
      {available && (
        <>
          <p>
            Recorder:{" "}
            {item.recorder
              ? identity(item.recorder, snapshot)
              : "Vacant — members may contribute; the host must choose a recorder before consolidation or submission."}
          </p>
          <h4>Saved contributions</h4>
          {item.contributions.length === 0 && <p>No saved contributions.</p>}
          {item.contributions.map((c) => (
            <div key={c.id}>
              <p>
                {identity(c.author_id, snapshot)} ·{" "}
                {fields.find((f) => f.id === c.field_id)?.label} · revision{" "}
                {c.revision}
              </p>
              <p className="instructions">
                {c.content || "Cleared contribution"}
              </p>
              {!host && recorder && c.content.trim() && (
                <button
                  disabled={blocked || !writable || conflict}
                  onClick={() => {
                    setText((previous) => ({
                      ...previous,
                      [c.field_id]: c.content,
                    }));
                    setSources((previous) => ({
                      ...previous,
                      [c.field_id]: [
                        ...new Set([...(previous[c.field_id] ?? []), c.id]),
                      ],
                    }));
                  }}
                >
                  Use contribution in{" "}
                  {fields.find((f) => f.id === c.field_id)?.label}
                </button>
              )}
            </div>
          ))}
        </>
      )}
      {!host &&
        fields.map((f) => (
          <ContributionEditor
            key={f.id}
            field={f}
            saved={
              available
                ? item.contributions.find(
                    (c) => c.author_id === snapshot.actor && c.field_id === f.id
                  )
                : undefined
            }
            writable={writable}
            available={available}
            blocked={blocked}
            request={request}
            mutate={mutate}
          />
        ))}
      {(available || dirtyText) && (
        <>
          <h4>Consolidated group answer</h4>
          <p role="status">
            {conflict
              ? "Conflict — compare before saving"
              : dirty
                ? "Unsaved changes"
                : item.saved_at
                  ? `Saved revision ${item.revision} at ${new Date(item.saved_at).toLocaleString()}`
                  : "Not saved"}
          </p>
          {fields
            .filter(
              (f) =>
                available || (text[f.id] ?? "") !== (base.content[f.id] ?? "")
            )
            .map((f) => (
              <div key={f.id}>
                {host || (!recorder && !dirtyText) ? (
                  <>
                    <h5>{f.label}</h5>
                    <p className="instructions">
                      {available
                        ? item.content[f.id] || "No answer"
                        : text[f.id]}
                    </p>
                  </>
                ) : (
                  <>
                    <label htmlFor={`${editorId}-${f.id}`}>
                      {f.label} — group answer
                    </label>
                    <textarea
                      id={`${editorId}-${f.id}`}
                      value={text[f.id] ?? ""}
                      readOnly={!writable || !recorder}
                      onChange={(e) =>
                        setText((previous) => ({
                          ...previous,
                          [f.id]: e.target.value,
                        }))
                      }
                    />
                  </>
                )}
                {available && (
                  <p>
                    Declared authors:{" "}
                    {(item.lineage[f.id]?.authors ?? [])
                      .map((id) => identity(id, snapshot))
                      .join(", ") || "None"}
                  </p>
                )}
                {available && !host && recorder && (
                  <>
                    <fieldset>
                      <legend>Saved sources used for {f.label}</legend>
                      {readableSources.map((c) => (
                        <label key={c.id}>
                          <input
                            type="checkbox"
                            checked={(sources[f.id] ?? []).includes(c.id)}
                            disabled={blocked || !writable}
                            onChange={(e) =>
                              setSources((previous) => ({
                                ...previous,
                                [f.id]: e.target.checked
                                  ? [...(previous[f.id] ?? []), c.id]
                                  : (previous[f.id] ?? []).filter(
                                      (id) => id !== c.id
                                    ),
                              }))
                            }
                          />
                          {identity(c.author_id, snapshot)} ·{" "}
                          {
                            fields.find((field) => field.id === c.field_id)
                              ?.label
                          }{" "}
                          · revision {c.revision}
                        </label>
                      ))}
                    </fieldset>
                    <button
                      disabled={
                        blocked ||
                        !writable ||
                        conflict ||
                        !reason.trim() ||
                        !validWorkText(reason, 500) ||
                        invalid
                      }
                      onClick={() =>
                        showPreview("replace_field", {
                          field: f.id,
                          value: workText(text[f.id] ?? ""),
                          sources: { [f.id]: sources[f.id] ?? [] },
                          revision: base.revision,
                        })
                      }
                    >
                      Replace {f.label} and reset sources…
                    </button>
                  </>
                )}
              </div>
            ))}
          {available && !host && recorder && (
            <>
              {invalid && (
                <p role="alert">
                  Check answer character limits: 500 for short fields, 5,000 for
                  long fields.
                </p>
              )}
              <button
                disabled={blocked || !writable || conflict || !dirty || invalid}
                onClick={() => {
                  const content = Object.fromEntries(
                      fields.map((f) => [f.id, workText(text[f.id] ?? "")])
                    ),
                    revision = base.revision;
                  void mutate(
                    request("answer", { revision, content, sources }),
                    () => {
                      setBase({ revision: revision + 1, content });
                      setSources({});
                    }
                  );
                }}
              >
                Save group answer
              </button>
              {conflict && (
                <>
                  <h5>Current saved answer</h5>
                  <dl>
                    {fields.map((f) => (
                      <div key={f.id}>
                        <dt>{f.label}</dt>
                        <dd className="instructions">
                          {item.content[f.id] || "Empty"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <button
                    disabled={blocked || !writable}
                    onClick={() => {
                      setBase({
                        revision: item.revision,
                        content: item.content,
                      });
                      setConflict(false);
                    }}
                  >
                    Keep my answer against current revision
                  </button>
                  <button
                    disabled={blocked}
                    onClick={() => {
                      setBase({
                        revision: item.revision,
                        content: item.content,
                      });
                      setText(item.content);
                      setSources({});
                      setConflict(false);
                    }}
                  >
                    Discard my unsaved answer
                  </button>
                </>
              )}
              <button
                disabled={blocked || !writable || dirty || conflict}
                onClick={() => showPreview("submit")}
              >
                Preview group submission
              </button>
              <button
                disabled={
                  blocked || !writable || dirty || conflict || !reason.trim()
                }
                onClick={() => showPreview("submit_incomplete")}
              >
                Preview incomplete group submission
              </button>
              {dirty && (
                <p>
                  Save your changes before previewing submission. Other devices’
                  unsaved text is not included.
                </p>
              )}
            </>
          )}
        </>
      )}
      {available && (host || recorder) && (
        <label>
          Reason for replacement, correction or incomplete submission
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={blocked}
            aria-invalid={!validWorkText(reason, 500)}
          />
        </label>
      )}
      {available &&
        host &&
        snapshot.state !== "completed" &&
        snapshot.enabled && (
          <>
            {latest && latest.missing.length > 0 && !latest.acceptance && (
              <button
                disabled={blocked || !reason.trim()}
                onClick={() => showPreview("accept_partial")}
              >
                Preview accepting latest partial answer
              </button>
            )}
            {snapshot.current?.id !== item.activity.id && (
              <>
                <fieldset>
                  <legend>Named correction audience</legend>
                  {snapshot.members
                    .filter((p) => p.group === item.group)
                    .map((p) => (
                      <label key={p.participant}>
                        <input
                          type="checkbox"
                          checked={audience.includes(p.participant)}
                          disabled={blocked}
                          onChange={(e) =>
                            setAudience((previous) =>
                              e.target.checked
                                ? [...previous, p.participant]
                                : previous.filter((id) => id !== p.participant)
                            )
                          }
                        />
                        {identity(p.participant, snapshot)}
                      </label>
                    ))}
                </fieldset>
                <button
                  disabled={
                    blocked ||
                    !reason.trim() ||
                    !item.recorder ||
                    !audience.includes(item.recorder)
                  }
                  onClick={() =>
                    showPreview("reopen", {
                      audience,
                      baseline:
                        item.predecessor && "id" in item.predecessor
                          ? item.predecessor.id
                          : null,
                    })
                  }
                >
                  Preview reopening corrections
                </button>
                {item.reopened && (
                  <button
                    disabled={blocked || !reason.trim()}
                    onClick={() => showPreview("close")}
                  >
                    Preview closing corrections
                  </button>
                )}
              </>
            )}
          </>
        )}
      {preview && available && (
        <div role="group" aria-label="Confirm group work change">
          <h4 ref={heading} tabIndex={-1}>
            Preview {previewCommand?.replaceAll("_", " ")}
          </h4>
          <dl>
            {fields.map((f) => (
              <div key={f.id}>
                <dt>{f.label}</dt>
                <dd className="instructions">
                  {preview.draft.content[f.id] || "Missing answer"}
                </dd>
              </div>
            ))}
          </dl>
          {previewCommand === "replace_field" ? (
            <>
              <p>
                Replacement text:{" "}
                <span className="instructions">
                  {preview.request.value || "Empty"}
                </span>
              </p>
              <p>
                Removed inherited authors:{" "}
                {(preview.draft.lineage[preview.request.field!]?.authors ?? [])
                  .filter((id) => !replacementAuthors.includes(id))
                  .map((id) => identity(id, snapshot))
                  .join(", ") || "None"}
              </p>
              <p>
                Removed source versions:{" "}
                {(preview.draft.lineage[preview.request.field!]?.sources ?? [])
                  .filter((id) => !replacementSources.includes(id))
                  .join(", ") || "None"}
              </p>
              <p>
                New declared source versions:{" "}
                {replacementSources.join(", ") || "None"}.
              </p>
              <p>
                This starts a new declared lineage for this field. Old saved
                versions and submitted snapshots remain unchanged. Other fields,
                saved contributions or membership may still grant access to
                future snapshots.
              </p>
            </>
          ) : (
            <>
              <p>
                Predecessor:{" "}
                {preview.draft.predecessor && "id" in preview.draft.predecessor
                  ? `Attempt ${preview.draft.predecessor.ordinal} · ${preview.draft.predecessor.id}`
                  : host
                    ? "Not yet submitted"
                    : "Earlier submission details are restricted when not authorized"}
              </p>
              <h5>Saved nonempty contributions included</h5>
              {preview.draft.contributions
                .filter((c) => c.content.trim())
                .map((c) => (
                  <p key={c.id}>
                    {identity(c.author_id, snapshot)} · revision {c.revision}:{" "}
                    <span className="instructions">{c.content}</span>
                  </p>
                ))}
              <p>
                Current submission roster, including verbal and disconnected
                members:{" "}
                {preview.roster
                  .map((p) => identity(p.participant, snapshot))
                  .join(", ") || "None"}
              </p>
              {previewCommand === "reopen" && (
                <p>
                  Correction audience:{" "}
                  {preview.request.audience
                    ?.map((id) => identity(id, snapshot))
                    .join(", ")}
                  . Baseline: {preview.request.baseline ?? "Not yet submitted"}.
                </p>
              )}
            </>
          )}
          <p>Reason: {preview.request.reason || "None"}</p>
          {stale && (
            <p role="alert">
              This preview is stale. Cancel and review the current saved work.
            </p>
          )}
          <button
            disabled={
              blocked ||
              stale ||
              (!!previewCommand?.startsWith("submit") && (dirty || conflict))
            }
            onClick={() => {
              const planned = preview.request;
              if (planned.command.startsWith("submit") && hasUnsavedWork()) {
                setNotice(
                  "Save or reconcile your local contribution and answer changes before submitting."
                );
                return;
              }
              void mutate(planned, () => {
                if (planned.command === "replace_field") {
                  setBase((previous) => ({
                    revision: preview.draft.revision + 1,
                    content: {
                      ...previous.content,
                      [planned.field!]: planned.value!,
                    },
                  }));
                  setSources((previous) => ({
                    ...previous,
                    [planned.field!]: [],
                  }));
                }
                setPreview(null);
                setReason("");
              });
            }}
          >
            Confirm group work change
          </button>
          <button disabled={blocked} onClick={() => setPreview(null)}>
            Cancel group work preview
          </button>
        </div>
      )}
    </section>
  );
}

function RecorderControl({
  group,
  snapshot,
  blocked,
  mutate,
}: {
  group: NonNullable<GroupWorkSnapshot["coordination"]>["recorders"][number];
  snapshot: GroupWorkSnapshot;
  blocked: boolean;
  mutate: Mutate;
}) {
  const [selected, setSelected] = useState(group.recorder ?? "");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{
    request: RecorderCommand;
    previous: string;
    next: string;
    members: string[];
  } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (preview) heading.current?.focus();
  }, [preview]);
  const invalid =
    !validWorkText(reason, 500) ||
    (snapshot.state !== "ready" && !reason.trim());
  return (
    <fieldset
      data-work-protected={
        preview || reason || selected !== (group.recorder ?? "")
          ? "true"
          : undefined
      }
    >
      <legend>Recorder for Group {group.ordinal}</legend>
      <p>
        Current:{" "}
        {group.recorder ? identity(group.recorder, snapshot) : "Vacant"}
      </p>
      <label>
        Choose recorder
        <select
          value={selected}
          disabled={
            blocked || !snapshot.enabled || snapshot.state === "completed"
          }
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">No recorder</option>
          {snapshot.members
            .filter((p) => p.group === group.group)
            .map((p) => (
              <option key={p.participant} value={p.participant}>
                {identity(p.participant, snapshot)}
              </option>
            ))}
        </select>
      </label>
      <label>
        Recorder change reason
        <textarea
          value={reason}
          disabled={blocked}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        disabled={
          blocked ||
          invalid ||
          !snapshot.enabled ||
          snapshot.state === "completed"
        }
        onClick={() =>
          setPreview({
            previous: group.recorder
              ? identity(group.recorder, snapshot)
              : "Vacant",
            next: selected ? identity(selected, snapshot) : "Vacant",
            members: snapshot.members
              .filter((p) => p.group === group.group)
              .map((p) => identity(p.participant, snapshot)),
            request: {
              command: "recorder",
              group: group.group,
              recorder: selected || null,
              reason,
              context: snapshot.context,
            },
          })
        }
      >
        Preview recorder change
      </button>
      {preview && (
        <div role="group" aria-label="Confirm recorder change">
          <h4 ref={heading} tabIndex={-1}>
            Replace recorder for Group {group.ordinal}
          </h4>
          <p>
            {preview.previous} → {preview.next}
          </p>
          <p>Members: {preview.members.join(", ") || "None"}</p>
          <p>Reason: {preview.request.reason || "Prepared-session setup"}</p>
          {preview.request.context !== snapshot.context && (
            <p role="alert">
              This recorder preview is stale. Cancel and preview again.
            </p>
          )}
          <button
            disabled={blocked || preview.request.context !== snapshot.context}
            onClick={() =>
              void mutate(preview.request, () => {
                setPreview(null);
                setReason("");
              })
            }
          >
            Confirm recorder change
          </button>
          <button disabled={blocked} onClick={() => setPreview(null)}>
            Cancel recorder preview
          </button>
        </div>
      )}
    </fieldset>
  );
}

export function GroupWorkPanel({
  session,
  host = false,
  enabled = true,
}: {
  session: string;
  host?: boolean;
  enabled?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<GroupWorkSnapshot | null>(null);
  const [seen, setSeen] = useState<GroupWorkItem[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const generation = useRef(0),
    busy = useRef(false),
    denied = useRef(false);
  const operation = useRef<{
    id: string;
    request: Mutation;
    acknowledged?: () => void;
  } | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled || denied.current || busy.current) return;
    const n = ++generation.current;
    try {
      const result = await call(session, host);
      if (n !== generation.current) return;
      if (result.error) {
        setError(result.error);
        if (result.error === "not_allowed") denied.current = true;
      } else if (result.snapshot) {
        const next = result.snapshot;
        setSnapshot(next);
        setError("");
        setSeen((previous) => {
          const all = new Map(previous.map((item) => [keyOf(item), item]));
          for (const item of next.items) {
            if (item.draft_access || !all.get(keyOf(item))?.draft_access)
              all.set(keyOf(item), item);
          }
          return [...all.values()];
        });
      }
    } catch {
      if (n === generation.current) setError("unavailable");
    }
  }, [session, host, enabled]);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (active) timer = setTimeout(poll, 1000);
    };
    const invalidate = () => {
      generation.current++;
    };
    void poll();
    return () => {
      active = false;
      invalidate();
      clearTimeout(timer);
    };
  }, [refresh]);
  const execute = async () => {
    if (busy.current || !operation.current) return;
    const current = operation.current;
    busy.current = true;
    generation.current++;
    setPending(true);
    setMessage("Saving change…");
    try {
      const result = await call(session, host, current.id, current.request);
      if (result.uncertain || (!result.error && !result.receipt)) {
        setUnknown(true);
        setMessage(
          "Result unknown. Retry the same request; keep this page open."
        );
      } else {
        setUnknown(false);
        operation.current = null;
        if (result.error) setMessage(groupWorkError(result.error));
        else {
          current.acknowledged?.();
          setMessage("Change saved and acknowledged.");
        }
      }
    } catch {
      setUnknown(true);
      setMessage(
        "Result unknown. Retry the same request; keep this page open."
      );
    } finally {
      busy.current = false;
      setPending(false);
      generation.current++;
      await refresh();
    }
  };
  const mutate: Mutate = async (request, acknowledged) => {
    if (busy.current || operation.current) return;
    operation.current = { id: crypto.randomUUID(), request, acknowledged };
    await execute();
  };
  const blocked = pending || unknown || !!error || !enabled;
  if (!snapshot)
    return enabled && error && error !== "not_allowed" ? (
      <p role="alert">Group work service unavailable. Retrying…</p>
    ) : null;
  return (
    <section
      aria-labelledby="group-work-heading"
      data-work-protected={pending || unknown ? "true" : undefined}
      data-pending={pending ? "true" : undefined}
    >
      <h2 id="group-work-heading">Group work</h2>
      <p>
        Saved contributions and the group answer are shared with authorized
        group members and the host. They may become a group submission and may
        later be shared within the workshop under its policy. External
        publication requires separate approvals. Individual answers remain
        private.
      </p>
      <p role="status">
        {!enabled
          ? "Access changed. Protected work is hidden; preserve any local unsaved text."
          : !snapshot
            ? "Loading group work…"
            : message ||
              (snapshot.enabled
                ? "Group work available"
                : "Group changes temporarily unavailable; acknowledged work is preserved.")}
      </p>
      {error && <p role="alert">{groupWorkError(error)}</p>}
      {unknown && (
        <button disabled={pending} onClick={() => void execute()}>
          Retry exact group request
        </button>
      )}
      {snapshot && (
        <>
          {enabled &&
            !error &&
            host &&
            snapshot.coordination?.recorders.map((group) => (
              <RecorderControl
                key={group.group}
                group={group}
                snapshot={snapshot}
                blocked={blocked}
                mutate={mutate}
              />
            ))}
          {enabled && !error && host && !!snapshot.recorder_history?.length && (
            <details>
              <summary>Recorder history</summary>
              <ul>
                {snapshot.recorder_history.map((change) => (
                  <li key={change.id}>
                    {new Date(change.created_at).toLocaleString()}:{" "}
                    {change.old_recorder
                      ? identity(change.old_recorder, snapshot)
                      : "Vacant"}{" "}
                    →{" "}
                    {change.new_recorder
                      ? identity(change.new_recorder, snapshot)
                      : "Vacant"}
                    . {change.reason || "Prepared-session setup"}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {enabled &&
            !error &&
            !host &&
            snapshot.current?.scope === "group" &&
            !snapshot.group && (
              <p role="status">Waiting for group assignment.</p>
            )}
          {seen.map((item) => {
            const fresh = snapshot.items.find((i) => keyOf(i) === keyOf(item));
            const available = enabled && !error && !!fresh?.draft_access;
            return (
              <div key={keyOf(item)}>
                {item.draft_access && (
                  <GroupEditor
                    item={item}
                    snapshot={snapshot}
                    available={available}
                    host={host}
                    blocked={blocked}
                    mutate={mutate}
                  />
                )}
                {enabled && !error && fresh && fresh.attempts.length > 0 && (
                  <section
                    aria-label={`Submitted group snapshots ${item.group.slice(0, 8)} ${item.activity.id}`}
                  >
                    <h3>Submitted snapshots · {item.activity.title}</h3>
                    {fresh.attempts.map((attempt) => (
                      <details key={attempt.id}>
                        <summary>
                          Attempt {attempt.ordinal} ·{" "}
                          {attempt.missing.length
                            ? attempt.acceptance
                              ? "Accepted partial"
                              : "Incomplete — awaiting host acceptance"
                            : "Submitted complete"}
                        </summary>
                        <p>
                          Submitted by{" "}
                          {identity(attempt.submitted_by, snapshot)} at{" "}
                          {new Date(attempt.submitted_at).toLocaleString()}.
                        </p>
                        <dl>
                          {attempt.snapshot.schema.map((f) => (
                            <div key={f.id}>
                              <dt>{f.label}</dt>
                              <dd className="instructions">
                                {attempt.content[f.id] || "Missing answer"}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        <p>
                          Submission roster:{" "}
                          {attempt.snapshot.roster
                            .map(
                              (p) => `${p.name} · ${p.participant.slice(0, 8)}`
                            )
                            .join(", ")}
                        </p>
                        <p>
                          Saved-content authors:{" "}
                          {[
                            ...new Set([
                              ...attempt.snapshot.contributions.map(
                                (c) => c.author_id
                              ),
                              ...Object.values(
                                attempt.snapshot.lineage
                              ).flatMap((l) => l.authors),
                            ]),
                          ]
                            .map((id) => identity(id, snapshot))
                            .join(", ") || "None"}
                        </p>
                        <p>Reason: {attempt.reason || "None"}</p>
                        {attempt.restricted_predecessor && (
                          <p>Earlier attempt details are restricted.</p>
                        )}
                        {attempt.acceptance && (
                          <p>
                            Partial acceptance reason:{" "}
                            {attempt.acceptance.reason}
                          </p>
                        )}
                      </details>
                    ))}
                  </section>
                )}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
