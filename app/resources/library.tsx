"use client";

import { useEffect, useRef, useState } from "react";
import {
  resourceError,
  type ResourceDraft,
  type ResourceKind,
  type ResourceLibrary,
  type ResourceLibraryCommand,
} from "../../lib/resources";
import { validWorkText } from "../../lib/work";
import { inputReadDeadline } from "../../lib/inputs";
import { useNavigationGuard } from "../use-navigation-guard";
import { requestResource } from "./client";
import { LinkCheckDetails, ResourceVersionDetails } from "./details";

type EditorRequest =
  | ResourceLibraryCommand
  | { command: "check"; resource: string; revision?: number; version?: string };
const leave = () =>
  !document.querySelector('[data-work-protected="true"]') ||
  window.confirm(
    "Leave this editor? Unsaved edits or an unresolved request may be lost."
  );

export function ResourceLibraryPanel({ workspace }: { workspace: string }) {
  useNavigationGuard();
  const [library, setLibrary] = useState<ResourceLibrary | null>(null);
  const [selected, setSelected] = useState<ResourceDraft | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const activeEditor = useRef(0);
  const [unavailableSource, setUnavailableSource] = useState<string | null>(
    null
  );
  const [problem, setProblem] = useState("");
  const [offset, setOffset] = useState(0);
  const [versionOffset, setVersionOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const reads = useRef(0);
  useEffect(() => {
    let alive = true;
    let pending: number | null = null;
    let expiry: ReturnType<typeof setTimeout>;
    const fence = reads;
    const chooseFence = generation;
    const clear = () => {
      fence.current++;
      chooseFence.current++;
      pending = null;
      clearTimeout(expiry);
      setLibrary(null);
    };
    const poll = async () => {
      if (pending !== null || document.hidden || !navigator.onLine) return;
      const ticket = ++fence.current;
      pending = ticket;
      const started = performance.now();
      const timeout = setTimeout(() => {
        if (alive && ticket === fence.current) clear();
      }, 5000);
      try {
        const resource =
          selected?.revision && unavailableSource !== selected.id
            ? selected.id
            : undefined;
        const [reply, versionReply] = await Promise.all([
          requestResource({
            workspace,
            host: true,
            offset,
            metadataOnly: true,
            ...(resource && offset === versionOffset ? { resource } : {}),
          }),
          resource && offset !== versionOffset
            ? requestResource({
                workspace,
                host: true,
                resource,
                offset: versionOffset,
                metadataOnly: true,
              })
            : Promise.resolve(null),
        ]);
        const projection = versionReply
          ? reply.library && versionReply.library
            ? {
                ...reply.library,
                authority: versionReply.library.authority,
                ttl_ms: Math.min(
                  reply.library.ttl_ms,
                  versionReply.library.ttl_ms
                ),
              }
            : undefined
          : reply.library;
        const deadline = inputReadDeadline(started, projection?.ttl_ms ?? 0);
        if (
          !alive ||
          ticket !== fence.current ||
          document.hidden ||
          !navigator.onLine
        )
          return;
        if (!projection || performance.now() >= deadline) {
          clear();
          if (
            (reply.error === "not_allowed" ||
              versionReply?.error === "not_allowed") &&
            selected?.revision &&
            unavailableSource !== selected.id
          )
            setUnavailableSource(selected.id);
          return;
        }
        setLibrary(projection);
        if (
          unavailableSource &&
          projection.items.some((item) => item.id === unavailableSource)
        )
          setUnavailableSource(null);
        clearTimeout(expiry);
        expiry = setTimeout(clear, Math.max(0, deadline - performance.now()));
      } catch {
        if (alive && ticket === fence.current) clear();
      } finally {
        clearTimeout(timeout);
        if (pending === ticket) pending = null;
      }
    };
    const changed = () => {
      clear();
      if (!document.hidden && navigator.onLine) void poll();
    };
    clear();
    void poll();
    const timer = setInterval(() => void poll(), 750);
    document.addEventListener("visibilitychange", changed);
    window.addEventListener("offline", changed);
    window.addEventListener("online", changed);
    return () => {
      alive = false;
      fence.current++;
      chooseFence.current++;
      clearTimeout(expiry);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", changed);
      window.removeEventListener("offline", changed);
      window.removeEventListener("online", changed);
    };
  }, [
    workspace,
    offset,
    versionOffset,
    selected?.id,
    selected?.revision,
    unavailableSource,
  ]);
  const handleChoose = async (resource: string) => {
    if (!leave()) return;
    const ticket = ++generation.current;
    // eslint-disable-next-line react-hooks/purity -- User event handler: bound this read to its request-start lease.
    const started = performance.now();
    setLoading(true);
    try {
      const result = await requestResource({
        workspace,
        host: true,
        resource,
        offset: 0,
      });
      const deadline = inputReadDeadline(started, result.library?.ttl_ms ?? 0);
      if (
        ticket !== generation.current ||
        // eslint-disable-next-line react-hooks/purity -- This continuation belongs to the user event, never render.
        performance.now() >= deadline ||
        document.hidden ||
        !navigator.onLine
      )
        return;
      if (result.library?.resource) {
        setLibrary((previous) =>
          previous
            ? { ...previous, authority: result.library!.authority }
            : null
        );
        setVersionOffset(0);
        setSelected(result.library.resource);
        setUnavailableSource(null);
        setEditorKey(++activeEditor.current);
        setProblem("");
      } else setProblem(resourceError(result.error ?? "unavailable"));
    } catch {
      setProblem("Resource unavailable. Your existing editor is unchanged.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      {problem && <p role="alert">{problem}</p>}
      {unavailableSource && (
        <p role="status">
          The selected resource is unavailable. Your own unsaved text is
          retained; choose another resource to continue.
        </p>
      )}
      {!library && (
        <p role="status">
          Verifying library access. Saved resource details are hidden; your own
          unsaved text is retained.
        </p>
      )}
      {library && !library.enabled && (
        <p role="status">
          Resource authoring is temporarily unavailable. Saved versions remain
          available.
        </p>
      )}
      <section aria-labelledby="resource-list-heading">
        <h2 id="resource-list-heading">Saved resources</h2>
        {library?.items.length === 0 && <p>No saved resources yet.</p>}
        <ul>
          {library?.items.map((resource) => (
            <li key={resource.id}>
              <button
                className="secondary"
                disabled={loading}
                onClick={() => void handleChoose(resource.id)}
              >
                {resource.title}
              </button>{" "}
              · {resource.kind}
            </li>
          ))}
        </ul>
        <div className="actions">
          {offset > 0 && (
            <button
              disabled={loading}
              onClick={() => setOffset(Math.max(0, offset - 20))}
            >
              Previous resources
            </button>
          )}
          {library?.next_offset !== null &&
            library?.next_offset !== undefined && (
              <button
                disabled={loading}
                onClick={() => setOffset(library.next_offset!)}
              >
                More resources
              </button>
            )}
          <button
            disabled={!library?.enabled || loading}
            onClick={() => {
              if (!leave()) return;
              generation.current++;
              setLibrary(null);
              setEditorKey(++activeEditor.current);
              setUnavailableSource(null);
              setVersionOffset(0);
              setSelected({
                id: crypto.randomUUID(),
                revision: 0,
                title: "",
                kind: "text",
                content: "",
                versions: [],
                check: null,
              });
            }}
          >
            New resource
          </button>
        </div>
      </section>
      {selected && (
        <ResourceEditor
          key={`${selected.id}:${editorKey}`}
          workspace={workspace}
          initial={selected}
          enabled={library?.enabled ?? false}
          verified={
            !!library &&
            (!selected.revision || library.authority?.resource === selected.id)
          }
          liveResource={selected}
          authorityGeneration={generation}
          authorizedVersions={library?.authority?.versions ?? []}
          versionOffset={versionOffset}
          onVersionPage={(nextOffset) => {
            const started = performance.now();
            const ticket = ++generation.current;
            void requestResource({
              workspace,
              host: true,
              resource: selected.id,
              offset: nextOffset,
            })
              .then((reply) => {
                const deadline = inputReadDeadline(
                  started,
                  reply.library?.ttl_ms ?? 0
                );
                if (
                  ticket !== generation.current ||
                  performance.now() >= deadline ||
                  !reply.library?.resource ||
                  document.hidden ||
                  !navigator.onLine
                )
                  return;
                const latest = reply.library.resource;
                setSelected((previous) =>
                  previous
                    ? {
                        ...previous,
                        versions: latest.versions,
                        next_version_offset: latest.next_version_offset,
                      }
                    : previous
                );
                setVersionOffset(nextOffset);
              })
              .catch(() =>
                setProblem("Ready versions unavailable. Try the page again.")
              );
          }}
          onSaved={(resource) => {
            if (activeEditor.current !== editorKey) return;
            setSelected(resource);
            setLibrary((previous) =>
              previous
                ? {
                    ...previous,
                    items: previous.items.some(
                      (item) => item.id === resource.id
                    )
                      ? previous.items.map((item) =>
                          item.id === resource.id ? resource : item
                        )
                      : [resource, ...previous.items],
                  }
                : previous
            );
          }}
        />
      )}
    </>
  );
}

function ResourceEditor({
  workspace,
  initial,
  enabled,
  verified,
  liveResource,
  authorityGeneration,
  authorizedVersions,
  versionOffset,
  onVersionPage,
  onSaved,
}: {
  workspace: string;
  initial: ResourceDraft;
  enabled: boolean;
  verified: boolean;
  liveResource: ResourceDraft | null;
  authorityGeneration: { readonly current: number };
  authorizedVersions: string[];
  versionOffset: number;
  onVersionPage: (offset: number) => void;
  onSaved: (resource: ResourceDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [current, setCurrent] = useState<ResourceDraft | null>(null);
  const [currentAuthority, setCurrentAuthority] = useState(-1);
  const [problem, setProblem] = useState("");
  const [status, setStatus] = useState(initial.revision ? "Saved" : "Unsaved");
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState<{
    operation: string;
    request: EditorRequest;
  } | null>(null);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const busy = useRef(false);
  const detailReads = useRef(0);
  const title = useRef<HTMLHeadingElement>(null);
  const dirty =
    draft.title !== saved.title ||
    draft.kind !== saved.kind ||
    draft.content !== saved.content ||
    !saved.revision;
  const locked = pending || !!retry || !enabled || !verified;
  useEffect(() => {
    const fence = detailReads;
    title.current?.focus();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      fence.current++;
    };
  }, []);
  const acceptDetail = (read: {
    resource: ResourceDraft;
    authority: number;
    ticket: number;
    deadline: number;
  }) => {
    if (
      read.ticket !== detailReads.current ||
      read.authority !== authorityGeneration.current ||
      performance.now() >= read.deadline ||
      document.hidden ||
      !navigator.onLine
    )
      throw Error("unavailable");
    return read.resource;
  };
  const refresh = async () => {
    if (!verified || document.hidden || !navigator.onLine)
      throw Error("unavailable");
    const ticket = ++detailReads.current;
    const authority = authorityGeneration.current;
    const started = performance.now();
    const result = await requestResource({
      workspace,
      host: true,
      resource: saved.id,
      offset: versionOffset,
    });
    const deadline = inputReadDeadline(started, result.library?.ttl_ms ?? 0);
    if (!result.library?.resource) throw Error("unavailable");
    const read = {
      resource: result.library.resource,
      authority,
      ticket,
      deadline,
    };
    acceptDetail(read);
    return read;
  };
  const execute = async (
    request: EditorRequest,
    operation = crypto.randomUUID()
  ) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setStatus(request.command === "save" ? "Saving" : "Processing");
    setProblem("");
    try {
      const result = await requestResource({
        workspace,
        host: true,
        operation,
        request,
      });
      if (result.uncertain || (!result.error && !result.receipt?.committed)) {
        setRetry({ operation, request });
        setStatus("Result unknown");
        setProblem(
          "Retry this exact request to check the result safely. Your text is still here."
        );
      } else if (result.error) {
        setRetry(null);
        setStatus(
          result.error === "resource_conflict" ? "Conflict" : "Unavailable"
        );
        setProblem(resourceError(result.error));
        if (request.command === "check") {
          const latest = acceptDetail(await refresh());
          setSaved(latest);
          setDraft(latest);
          setReviewed(null);
          onSaved(latest);
        }
      } else {
        setRetry(null);
        const latest = acceptDetail(await refresh());
        setSaved(latest);
        setDraft(latest);
        setCurrent(null);
        setReviewed(null);
        onSaved(latest);
        setStatus(request.command === "ready" ? "Version ready" : "Saved");
      }
    } catch {
      setRetry({ operation, request });
      setStatus("Result unknown");
      setProblem(
        "The result is unknown. Retry this exact request; your text has been retained."
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const change = (patch: Partial<ResourceDraft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    setReviewed(null);
  };
  const valid =
    !!draft.title.trim() &&
    !!draft.content.trim() &&
    validWorkText(draft.title, 120) &&
    validWorkText(draft.content, draft.kind === "text" ? 20000 : 2048);
  const checkFresh =
    saved.check?.reviewed &&
    !!saved.check.expires_at &&
    now > 0 &&
    Date.parse(saved.check.expires_at) > now;
  return (
    <section
      aria-labelledby="resource-editor-heading"
      data-pending={pending}
      data-work-protected={
        dirty || pending || retry || current || status === "Conflict"
          ? "true"
          : undefined
      }
    >
      <h2 id="resource-editor-heading" ref={title} tabIndex={-1}>
        Resource draft
      </h2>
      <p role="status">
        {pending || retry || status === "Conflict" || status === "Unavailable"
          ? status
          : dirty
            ? "Unsaved"
            : status}
        {saved.revision ? ` · saved revision ${saved.revision}` : ""}
      </p>
      {problem && <p role="alert">{problem}</p>}
      {(verified || dirty) && (
        <>
          {(draft.title || draft.content) && !valid && (
            <p role="alert">
              Enter a nonblank title of up to 120 characters and{" "}
              {draft.kind === "text"
                ? "plain text of up to 20,000 characters"
                : "an HTTPS URL of up to 2,048 characters"}
              . Invalid Unicode and null characters cannot be saved.
            </p>
          )}
          <fieldset disabled={locked}>
            <legend>Title and content</legend>
            <label htmlFor="resource-title">Resource title</label>
            <input
              id="resource-title"
              value={draft.title}
              onChange={(event) => change({ title: event.target.value })}
            />
            <p className="hint">Up to 120 characters.</p>
            <label htmlFor="resource-kind">Resource kind</label>
            <select
              id="resource-kind"
              value={draft.kind}
              onChange={(event) =>
                change({ kind: event.target.value as ResourceKind })
              }
            >
              <option value="text">Plain text</option>
              <option value="link">HTTPS link</option>
            </select>
            <label htmlFor="resource-content">
              {draft.kind === "text" ? "Resource text" : "Resource HTTPS URL"}
            </label>
            <textarea
              id="resource-content"
              rows={draft.kind === "text" ? 8 : 3}
              value={draft.content}
              onChange={(event) => change({ content: event.target.value })}
            />
            <p className="hint">
              {draft.kind === "text"
                ? "Up to 20,000 characters. Text is shown literally."
                : "Public HTTPS links only, up to 2,048 characters. No sign-in credentials, uploads or embeds."}
            </p>
          </fieldset>
        </>
      )}
      <div className="actions">
        <button
          disabled={locked || !valid || !dirty || status === "Conflict"}
          onClick={() =>
            void execute({
              command: "save",
              resource: draft.id,
              revision: saved.revision,
              title: draft.title,
              kind: draft.kind,
              content: draft.content,
            })
          }
        >
          {saved.revision ? "Save resource draft" : "Create resource"}
        </button>
        <button
          disabled={
            locked ||
            dirty ||
            status === "Conflict" ||
            !saved.revision ||
            (saved.kind === "link" && !checkFresh)
          }
          onClick={() =>
            void execute({
              command: "ready",
              resource: saved.id,
              revision: saved.revision,
            })
          }
        >
          Make version ready
        </button>
        {retry && (
          <button
            disabled={pending}
            onClick={() => void execute(retry.request, retry.operation)}
          >
            Retry exact resource request
          </button>
        )}
      </div>
      {status === "Conflict" && (
        <button
          disabled={pending}
          onClick={() => {
            void refresh()
              .then((read) => {
                const latest = acceptDetail(read);
                setCurrentAuthority(read.authority);
                setCurrent(latest);
              })
              .catch(() =>
                setProblem(
                  "Current saved resource unavailable. Your text remains here."
                )
              );
          }}
        >
          Review current saved resource
        </button>
      )}
      {current &&
        verified &&
        currentAuthority === authorityGeneration.current && (
          <div role="group" aria-label="Reconcile resource conflict">
            <h3>Current saved revision {current.revision}</h3>
            <p>{current.title}</p>
            <p className="instructions">{current.content}</p>
            <p>
              Compare the saved text above with your editor. Keeping your text
              allows an explicit save against this revision.
            </p>
            <button
              onClick={() => {
                setSaved(current);
                setDraft((previous) => ({
                  ...previous,
                  revision: current.revision,
                }));
                setCurrent(null);
                setStatus("Unsaved");
                setProblem("");
              }}
            >
              Keep my text against this revision
            </button>
            <button
              onClick={() => {
                setSaved(current);
                setDraft(current);
                setCurrent(null);
                setStatus("Saved");
                setProblem("");
              }}
            >
              Use current saved text
            </button>
          </div>
        )}
      {verified && saved.kind === "link" && saved.revision > 0 && (
        <div>
          <h3>Validate the saved draft link</h3>
          <LinkCheckDetails content={saved.content} check={saved.check} />
          <button
            disabled={locked || dirty || status === "Conflict"}
            onClick={() =>
              void execute({
                command: "check",
                resource: saved.id,
                revision: saved.revision,
              })
            }
          >
            Check draft link
          </button>
          {saved.check && !saved.check.reviewed && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={reviewed === saved.check.id}
                  disabled={locked || dirty}
                  onChange={(event) =>
                    setReviewed(event.target.checked ? saved.check!.id : null)
                  }
                />
                I reviewed the original and checked final destination. This
                material is suitable for these recipients without external
                sign-in.
              </label>
              <button
                disabled={locked || dirty || reviewed !== saved.check.id}
                onClick={() =>
                  void execute({
                    command: "approve_check",
                    check: saved.check!.id,
                    reviewed: true,
                  })
                }
              >
                Confirm host review
              </button>
            </>
          )}
          <p>
            If this link cannot be checked or reviewed, use a plain-text
            alternative.
          </p>
        </div>
      )}
      <h3>Immutable ready versions</h3>
      {verified && saved.versions.length === 0 && (
        <p>No ready version yet. Ready does not release it to participants.</p>
      )}
      {verified &&
        (liveResource?.versions ?? [])
          .filter((version) => authorizedVersions.includes(version.id))
          .map((version) => (
            <div key={version.id}>
              <ResourceVersionDetails version={version} />
              {version.kind === "link" && (
                <>
                  <button
                    disabled={locked || dirty}
                    onClick={() =>
                      void execute({
                        command: "check",
                        resource: saved.id,
                        revision: saved.revision,
                        version: version.id,
                      })
                    }
                  >
                    Check version {version.ordinal} link
                  </button>
                  {version.check && !version.check.reviewed && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={reviewed === version.check.id}
                          disabled={locked || dirty}
                          onChange={(event) =>
                            setReviewed(
                              event.target.checked ? version.check!.id : null
                            )
                          }
                        />
                        I reviewed this version&apos;s original and final
                        destination as suitable without external sign-in.
                      </label>
                      <button
                        disabled={
                          locked || dirty || reviewed !== version.check.id
                        }
                        onClick={() =>
                          void execute({
                            command: "approve_check",
                            check: version.check!.id,
                            reviewed: true,
                          })
                        }
                      >
                        Confirm version {version.ordinal} host review
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
      {verified && (
        <div className="actions">
          {versionOffset > 0 && (
            <button
              disabled={pending || !!retry}
              onClick={() => onVersionPage(Math.max(0, versionOffset - 20))}
            >
              Newer ready versions
            </button>
          )}
          {liveResource?.next_version_offset !== null &&
            liveResource?.next_version_offset !== undefined && (
              <button
                disabled={pending || !!retry}
                onClick={() => onVersionPage(liveResource.next_version_offset!)}
              >
                Older ready versions
              </button>
            )}
        </div>
      )}
    </section>
  );
}
