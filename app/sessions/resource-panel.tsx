"use client";

import Link from "next/link";
import { ReviewProjectionDetails } from "./review-projection";
import { useEffect, useRef, useState } from "react";
import { INPUT_SCOPE_CHANGED, inputReadDeadline } from "../../lib/inputs";
import {
  resourceError,
  type ResourceCommand,
  type ResourceItem,
  type ResourceLibrary,
  type ResourcePreview,
  type ResourceProposal,
  type ResourceSelector,
  type ResourceSnapshot,
} from "../../lib/resources";
import { validWorkText } from "../../lib/work";
import { requestResource } from "../resources/client";
import {
  EXTERNAL_LIMIT,
  LinkCheckDetails,
  ResourceBases,
  ResourcePreviewDetails,
} from "../resources/details";

export function ResourcePanel({
  session,
  host = false,
  endpoint,
}: {
  session: string;
  host?: boolean;
  endpoint?: string;
}) {
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>();
  const [selected, setSelected] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [proposal, setProposal] = useState<ResourceProposal | null>(null);
  const [preview, setPreview] = useState<ResourcePreview | null>(null);
  const [confirmation, setConfirmation] = useState<ResourceCommand | null>(
    null
  );
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState<{
    operation: string;
    request: ResourceCommand;
  } | null>(null);
  const [problem, setProblem] = useState("");
  const generation = useRef(0);
  const busy = useRef(false);
  const invalidate = useRef(() => {});
  const heading = useRef<HTMLHeadingElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const rendered = useRef(new Map<string, string>());
  const latest = useRef<ResourceSnapshot | null>(null);
  const snapshotUntil = useRef(0);
  const previewGeneration = useRef(0);
  const previewUntil = useRef(0);

  useEffect(() => {
    let alive = true;
    const fence = generation;
    let inFlight: number | null = null;
    let expiry: ReturnType<typeof setTimeout>;
    const clear = () => {
      fence.current++;
      inFlight = null;
      clearTimeout(expiry);
      latest.current = null;
      snapshotUntil.current = 0;
      previewGeneration.current++;
      setPreview(null);
      setSnapshot(null);
    };
    invalidate.current = clear;
    const poll = async () => {
      if (inFlight !== null || document.hidden || !navigator.onLine) return;
      const ticket = ++generation.current;
      inFlight = ticket;
      const started = performance.now();
      const timeout = setTimeout(() => {
        if (alive && ticket === generation.current) clear();
      }, 5000);
      try {
        const reply = await requestResource({
          session,
          host,
          offset,
          ...(selected ? { allocation: selected } : {}),
        });
        if (
          !alive ||
          ticket !== generation.current ||
          document.hidden ||
          !navigator.onLine
        )
          return;
        const deadline = inputReadDeadline(
          started,
          reply.snapshot?.ttl_ms ?? 0
        );
        if (
          !reply.snapshot ||
          (endpoint && reply.snapshot.endpoint !== endpoint) ||
          performance.now() >= deadline
        ) {
          clear();
          if (selected && reply.error === "not_allowed") {
            setSelected(null);
            setProblem(
              "Resource access changed. Available resources will be checked again."
            );
          }
          return;
        }
        if (
          latest.current &&
          (latest.current.actor !== reply.snapshot.actor ||
            latest.current.endpoint !== reply.snapshot.endpoint)
        ) {
          clear();
          return;
        }
        latest.current = reply.snapshot;
        snapshotUntil.current = deadline;
        setSnapshot(reply.snapshot);
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
    const scope = (event: Event) => {
      if ((event as CustomEvent<string>).detail === session) changed();
    };
    clear();
    void poll();
    const timer = setInterval(() => void poll(), 750);
    document.addEventListener("visibilitychange", changed);
    window.addEventListener("offline", changed);
    window.addEventListener("online", changed);
    window.addEventListener(INPUT_SCOPE_CHANGED, scope);
    return () => {
      alive = false;
      fence.current++;
      clearTimeout(expiry);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", changed);
      window.removeEventListener("offline", changed);
      window.removeEventListener("online", changed);
      window.removeEventListener(INPUT_SCOPE_CHANGED, scope);
    };
  }, [session, host, endpoint, selected, offset]);

  useEffect(() => {
    if (!preview) return;
    let alive = true,
      inFlight = false;
    let expiry: ReturnType<typeof setTimeout>;
    const token = preview.token;
    const drop = () => {
      invalidate.current();
      previewGeneration.current++;
      setPreview(null);
      setProblem(
        "This resource preview changed or expired. Your proposal is retained; preview it again."
      );
    };
    expiry = setTimeout(
      drop,
      Math.max(0, previewUntil.current - performance.now())
    );
    const poll = async () => {
      if (inFlight || document.hidden || !navigator.onLine) return;
      inFlight = true;
      const started = performance.now();
      try {
        const reply = await requestResource({
          session,
          host: true,
          request: {
            command: "preview",
            metadataOnly: true,
            proposal: preview.request,
          },
        });
        if (!alive) return;
        const deadline = Math.min(
          inputReadDeadline(started, reply.previewAuthority?.ttl_ms ?? 0),
          snapshotUntil.current
        );
        if (
          reply.previewAuthority?.token !== token ||
          performance.now() >= deadline ||
          document.hidden ||
          !navigator.onLine
        ) {
          drop();
          return;
        }
        previewUntil.current = deadline;
        clearTimeout(expiry);
        expiry = setTimeout(drop, Math.max(0, deadline - performance.now()));
      } catch {
        if (alive) drop();
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 750);
    return () => {
      alive = false;
      clearTimeout(expiry);
      clearInterval(timer);
    };
  }, [preview, session]);

  // An effect runs after these exact notices rendered, never from presence or a fetch alone.
  useEffect(() => {
    if (host || !snapshot || document.hidden || !navigator.onLine) return;
    for (const item of snapshot.notices) {
      if (!item.notice || item.notice.dismissed || item.notice.received)
        continue;
      const key = `${snapshot.endpoint}:${item.allocation}:${item.notice.generation}`;
      if (rendered.current.has(key)) continue;
      const operation = crypto.randomUUID();
      rendered.current.set(key, operation);
      void requestResource({
        session,
        host: false,
        operation,
        request: {
          command: "ack",
          allocation: item.allocation,
          generation: item.notice.generation,
        },
      })
        .then((reply) => {
          if (reply.error || !reply.receipt?.committed)
            rendered.current.delete(key);
          if (
            reply.error === "not_allowed" &&
            latest.current?.endpoint === snapshot.endpoint
          )
            invalidate.current();
        })
        .catch(() => rendered.current.delete(key));
    }
  }, [host, snapshot, session]);

  useEffect(() => {
    if (preview || confirmation) previewHeading.current?.focus();
  }, [preview, confirmation]);
  const mutate = async (
    request: ResourceCommand,
    operation = crypto.randomUUID()
  ) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setProblem("");
    try {
      const reply = await requestResource({
        session,
        host,
        operation,
        request,
      });
      invalidate.current();
      if (reply.uncertain || (!reply.error && !reply.receipt?.committed)) {
        setRetry({ operation, request });
        setProblem(
          "Result unknown. Retry this exact resource request to check it safely."
        );
      } else {
        setRetry(null);
        setProblem(
          reply.error ? resourceError(reply.error) : "Resource access updated."
        );
        if (!reply.error) {
          setPreview(null);
          setProposal(null);
          setConfirmation(null);
          setReason("");
        }
      }
    } catch {
      invalidate.current();
      setRetry({ operation, request });
      setProblem(
        "Result unknown. Retry this exact resource request to check it safely."
      );
    } finally {
      busy.current = false;
      setPending(false);
      if (previewHeading.current) previewHeading.current.focus();
      else heading.current?.focus();
    }
  };
  const makePreview = async (next: ResourceProposal) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setProblem("");
    setProposal(next);
    const ticket = ++previewGeneration.current;
    // eslint-disable-next-line react-hooks/purity -- Explicit preview event; lease starts before its asynchronous request.
    const started = performance.now();
    try {
      const reply = await requestResource({
        session,
        host: true,
        request: { command: "preview", proposal: next },
      });
      if (ticket !== previewGeneration.current) {
        if (!document.hidden && navigator.onLine)
          setProblem(
            "Resource access changed or expired. Your selections remain here; preview again."
          );
        return;
      }
      if (document.hidden || !navigator.onLine) return;
      const deadline = Math.min(
        inputReadDeadline(started, reply.preview?.ttl_ms ?? 0),
        snapshotUntil.current
      );
      if (reply.preview) {
        // eslint-disable-next-line react-hooks/purity -- Event continuation rejects expired reads before displaying their content.
        if (performance.now() >= deadline) {
          setProblem(
            "Preview expired. Your selections remain here; preview again."
          );
          return;
        }
        previewUntil.current = deadline;
        setPreview(reply.preview);
      } else setProblem(resourceError(reply.error ?? "unavailable"));
    } catch {
      if (ticket === previewGeneration.current)
        setProblem("Preview unavailable. Your selections remain here.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const plan = (
    item?: ResourceItem,
    command: ResourceProposal["command"] = "schedule"
  ): ResourceProposal => ({
    command,
    allocation: item?.allocation ?? crypto.randomUUID(),
    revision: item?.revision ?? 0,
    version: item?.version ?? "",
    trigger: (item?.trigger as ResourceProposal["trigger"]) ?? "manual",
    activity: item?.activity ?? null,
    selectors: item?.selectors ?? [],
    restore: [],
    reason: "",
  });
  const locked = pending || !!retry || !snapshot;
  const mayExpand =
    snapshot?.enabled &&
    ["ready", "live", "paused"].includes(snapshot.state ?? "");
  const begin = (
    item?: ResourceItem,
    command: ResourceProposal["command"] = "schedule"
  ) => {
    setProposal(plan(item, command));
    setPreview(null);
    setConfirmation(null);
    setProblem("");
  };
  const previewUnavailable =
    !snapshot ||
    (preview &&
      (!snapshot.enabled ||
        preview.revision !==
          (snapshot.items.find((item) => item.allocation === preview.allocation)
            ?.revision ?? 0)));
  return (
    <section
      aria-labelledby="resources-heading"
      className="resource-panel"
      data-pending={pending}
      data-work-protected={
        host && (proposal || confirmation || pending || retry || reason)
          ? "true"
          : undefined
      }
    >
      <h2 id="resources-heading" ref={heading} tabIndex={-1}>
        {host ? "Session resources" : "Resources"}
      </h2>
      {!snapshot ? (
        <p role="status">
          Verifying resource access. Fetched resources and notices are hidden.
        </p>
      ) : (
        <p role="status">
          {host
            ? "Recipients are fixed at release. Include late arrivals with an explicit audience update."
            : "Only currently released materials assigned to you appear here."}
        </p>
      )}
      {problem && <p role="status">{problem}</p>}
      {host && (
        <p>
          <Link href="/resources">Open resource library</Link>
        </p>
      )}
      {host && (
        <p>
          Delivery receipts confirm that an active device rendered a notice.
          They do not mean the resource was opened, read or understood.
        </p>
      )}
      {host && snapshot && !snapshot.enabled && (
        <p role="status">
          New resource changes are temporarily unavailable. Current reads and
          revocation remain available.
        </p>
      )}
      {!host &&
        snapshot?.notices.map(
          (item) =>
            !item.notice.dismissed && (
              <div
                key={`${item.allocation}:${item.notice.generation}`}
                role="status"
                data-resource-notice
              >
                <p>
                  New resource available: {item.title} · version {item.ordinal}
                </p>
                <button
                  onClick={() => {
                    invalidate.current();
                    setSelected(item.allocation);
                  }}
                >
                  Open new resource
                </button>
                <button
                  disabled={pending}
                  onClick={() =>
                    void mutate({
                      command: "dismiss",
                      allocation: item.allocation,
                      generation: item.notice!.generation,
                    })
                  }
                >
                  Dismiss resource notice
                </button>
              </div>
            )
        )}
      {snapshot?.items.map((item) => (
        <div key={item.allocation}>
          <h3>
            {item.title} · version {item.ordinal}
          </h3>
          <p>
            {item.kind} ·{" "}
            {item.revoked_at
              ? "Access withdrawn"
              : item.released_at
                ? `Released ${new Date(item.released_at).toLocaleString()}`
                : `Scheduled: ${item.trigger}`}
          </p>
          {!host && item.bases && (
            <p>
              Assigned to you: <ResourceBases bases={item.bases} participant />
            </p>
          )}
          <button
            className="secondary"
            disabled={pending}
            onClick={() => {
              invalidate.current();
              setSelected(item.allocation);
            }}
          >
            View resource
          </button>
          {host &&
            item.kind !== "review" &&
            !proposal &&
            !confirmation &&
            !retry &&
            !item.revoked_at && (
              <div className="actions">
                {!item.released_at && (
                  <>
                    <button
                      disabled={locked || !mayExpand}
                      onClick={() => begin(item)}
                    >
                      Edit resource schedule
                    </button>
                    <button
                      disabled={
                        locked ||
                        !mayExpand ||
                        item.trigger !== "manual" ||
                        snapshot.state === "ready"
                      }
                      onClick={() => void makePreview(plan(item, "release"))}
                    >
                      Preview resource release
                    </button>
                    <button
                      disabled={locked}
                      onClick={() =>
                        setConfirmation({
                          command: "cancel",
                          allocation: item.allocation,
                          revision: item.revision,
                        })
                      }
                    >
                      Cancel resource schedule
                    </button>
                  </>
                )}
                {item.released_at && (
                  <>
                    <button
                      disabled={
                        locked || !mayExpand || snapshot.state === "ready"
                      }
                      onClick={() => begin(item, "audience")}
                    >
                      Update resource audience
                    </button>
                    <button
                      disabled={locked}
                      onClick={() =>
                        setConfirmation({
                          command: "revoke",
                          allocation: item.allocation,
                          participant: null,
                          reason: "",
                        })
                      }
                    >
                      Revoke resource for everyone
                    </button>
                  </>
                )}
              </div>
            )}
          {host && item.recipients && (
            <ul>
              {item.recipients.map((recipient) => (
                <li key={recipient.participant}>
                  {recipient.name} · {recipient.participant} ·{" "}
                  {recipient.delivery}
                  {item.kind !== "review" &&
                    item.released_at &&
                    !item.revoked_at && (
                      <div className="actions">
                        <button
                          disabled={locked || !!proposal || !!confirmation}
                          onClick={() =>
                            setConfirmation({
                              command: "revoke",
                              allocation: item.allocation,
                              participant: recipient.participant,
                              reason: "",
                            })
                          }
                        >
                          Revoke resource for {recipient.name} ·{" "}
                          {recipient.participant}
                        </button>
                        <button
                          disabled={
                            locked ||
                            !!proposal ||
                            !!confirmation ||
                            recipient.delivery !==
                              "Available; receipt unconfirmed"
                          }
                          onClick={() =>
                            void mutate({
                              command: "retry",
                              allocation: item.allocation,
                              participants: [recipient.participant],
                            })
                          }
                        >
                          Retry delivery to {recipient.name} ·{" "}
                          {recipient.participant}
                        </button>
                      </div>
                    )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {snapshot?.items.length === 0 && (
        <p>
          {host
            ? "No resource allocations on this page."
            : "No resources available on this page."}
        </p>
      )}
      {snapshot?.detail && (
        <div role="group" aria-label="Opened resource">
          <h3>
            {snapshot.detail.title} · version {snapshot.detail.ordinal}
          </h3>
          {snapshot.detail.kind === "review" ? (
            <>
              <h4>Submitted work for review</h4>
              {snapshot.detail.review && (
                <ReviewProjectionDetails source={snapshot.detail.review} />
              )}
            </>
          ) : snapshot.detail.kind === "text" ? (
            <p className="instructions" data-resource-content>
              {snapshot.detail.content}
            </p>
          ) : snapshot.detail.kind === "file" ? (
            <>
              <p>
                {snapshot.detail.file?.filename ?? "File unavailable"} ·{" "}
                {snapshot.detail.file?.mime} · {snapshot.detail.file?.size}{" "}
                bytes
              </p>
              {snapshot.detail.file?.status === "ready" ? (
                <a
                  href={`/api/resources/file/download?session=${encodeURIComponent(session)}&allocation=${encodeURIComponent(snapshot.detail.allocation)}&host=${host}`}
                >
                  Download protected file
                </a>
              ) : (
                <p role="status">This file is unavailable for download.</p>
              )}
              <p>
                Access is checked for each download. A copy already saved to a
                device cannot be recalled.
              </p>
            </>
          ) : (
            <>
              {host ? (
                <LinkCheckDetails
                  content={snapshot.detail.content}
                  check={snapshot.detail.check}
                />
              ) : (
                <>
                  <p>
                    External host: {new URL(snapshot.detail.content).hostname}
                  </p>
                  <p>{EXTERNAL_LIMIT}</p>
                </>
              )}
              <a
                href={`/api/resources/open?session=${encodeURIComponent(session)}&allocation=${encodeURIComponent(snapshot.detail.allocation)}&host=${host}`}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                Open external resource
              </a>
            </>
          )}
          <p>
            Read-only. This resource does not change your answer permissions.
          </p>
          <button
            onClick={() => {
              invalidate.current();
              setSelected(null);
            }}
          >
            Close resource
          </button>
        </div>
      )}
      {snapshot && (
        <div className="actions">
          {offset > 0 && (
            <button
              onClick={() => {
                invalidate.current();
                setOffset(Math.max(0, offset - 20));
                setSelected(null);
              }}
            >
              Previous resource page
            </button>
          )}
          {snapshot.next_offset !== null && (
            <button
              onClick={() => {
                invalidate.current();
                setOffset(snapshot.next_offset!);
                setSelected(null);
              }}
            >
              More session resources
            </button>
          )}
          {host && !proposal && !confirmation && !retry && (
            <button disabled={locked || !mayExpand} onClick={() => begin()}>
              Allocate resource
            </button>
          )}
        </div>
      )}
      {host && proposal && !preview && snapshot && (
        <AllocationForm
          key={`${proposal.allocation}:${proposal.command}`}
          snapshot={snapshot}
          initial={proposal}
          pending={locked}
          onChange={setProposal}
          onPreview={(next) => void makePreview(next)}
          onCancel={() => {
            setProposal(null);
            heading.current?.focus();
          }}
        />
      )}
      {preview && (
        <div role="group" aria-label="Confirm resource allocation">
          <h3 ref={previewHeading} tabIndex={-1}>
            {preview.request.command === "schedule"
              ? "Preview resource schedule"
              : preview.request.command === "audience"
                ? "Preview resource audience"
                : "Preview resource release"}
          </h3>
          {!previewUnavailable && <ResourcePreviewDetails preview={preview} />}
          {!previewUnavailable && preview.activity && (
            <p>
              Activity:{" "}
              {
                snapshot?.activities?.find(
                  (activity) => activity.id === preview.activity
                )?.title
              }{" "}
              · {preview.activity}
            </p>
          )}
          {previewUnavailable && (
            <p role="alert">
              Resource access or this preview changed. Preview again before
              confirming.
            </p>
          )}
          <button
            disabled={
              locked || !!previewUnavailable || preview.problems.length > 0
            }
            onClick={() =>
              void mutate({ ...preview.request, token: preview.token })
            }
          >
            Confirm resource{" "}
            {preview.request.command === "schedule"
              ? "schedule"
              : preview.request.command === "audience"
                ? "audience"
                : "release"}
          </button>
          <button
            disabled={locked || !snapshot?.enabled}
            onClick={() => void makePreview(preview.request)}
          >
            Refresh resource preview
          </button>
          <button
            disabled={pending || !!retry}
            onClick={() => {
              setPreview(null);
              if (preview.request.command === "release") setProposal(null);
              heading.current?.focus();
            }}
          >
            Cancel resource preview
          </button>
        </div>
      )}
      {confirmation && (
        <div role="group" aria-label="Confirm resource withdrawal">
          <h3 ref={previewHeading} tabIndex={-1}>
            {confirmation.command === "cancel"
              ? "Cancel this resource schedule?"
              : "Revoke resource access?"}
          </h3>
          <p>
            Future reads, links and notices stop for{" "}
            {confirmation.command === "revoke" && confirmation.participant
              ? `participant ${confirmation.participant}`
              : "all recipients of this allocation"}
            . Copies already taken cannot be recalled.
          </p>
          {confirmation.command === "revoke" && (
            <>
              <label htmlFor="resource-revocation-reason">
                Reason for resource revocation
              </label>
              <textarea
                id="resource-revocation-reason"
                value={reason}
                disabled={pending || !!retry}
                onChange={(event) => setReason(event.target.value)}
              />
            </>
          )}
          <button
            disabled={
              locked ||
              (confirmation.command === "revoke" &&
                (!reason.trim() || !validWorkText(reason, 500)))
            }
            onClick={() =>
              void mutate(
                confirmation.command === "revoke"
                  ? { ...confirmation, reason }
                  : confirmation
              )
            }
          >
            Confirm resource withdrawal
          </button>
          <button
            disabled={pending || !!retry}
            onClick={() => {
              setConfirmation(null);
              setReason("");
              heading.current?.focus();
            }}
          >
            Keep resource access
          </button>
        </div>
      )}
      {retry && (
        <button
          disabled={pending}
          onClick={() => void mutate(retry.request, retry.operation)}
        >
          Retry exact resource request
        </button>
      )}
    </section>
  );
}

function AllocationForm({
  snapshot,
  initial,
  pending,
  onChange,
  onPreview,
  onCancel,
}: {
  snapshot: ResourceSnapshot;
  initial: ResourceProposal;
  pending: boolean;
  onChange: (next: ResourceProposal) => void;
  onPreview: (next: ResourceProposal) => void;
  onCancel: () => void;
}) {
  const [plan, setPlan] = useState(initial);
  const [library, setLibrary] = useState<ResourceLibrary | null>(null);
  const [detail, setDetail] = useState<ResourceLibrary["resource"]>(null);
  const [resource, setResource] = useState("");
  const [offset, setOffset] = useState(0);
  const [versionOffset, setVersionOffset] = useState(0);
  const [problem, setProblem] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (!snapshot.workspace || plan.command !== "schedule") return;
    let alive = true;
    let epoch = 0,
      pending: number | null = null;
    let expiry: ReturnType<typeof setTimeout>;
    let loaded: ResourceLibrary["resource"] = null;
    const clear = () => {
      epoch++;
      pending = null;
      loaded = null;
      clearTimeout(expiry);
      setLibrary(null);
      setDetail(null);
    };
    const poll = async () => {
      if (pending !== null || document.hidden || !navigator.onLine) return;
      const ticket = ++epoch;
      pending = ticket;
      const started = performance.now();
      const timeout = setTimeout(() => {
        if (alive && ticket === epoch) clear();
      }, 5000);
      try {
        const [listReply, versionReply] = await Promise.all([
          requestResource({
            workspace: snapshot.workspace,
            host: true,
            offset,
            metadataOnly: true,
            ...(resource && offset === versionOffset ? { resource } : {}),
          }),
          resource && offset !== versionOffset
            ? requestResource({
                workspace: snapshot.workspace,
                host: true,
                resource,
                offset: versionOffset,
                metadataOnly: true,
              })
            : Promise.resolve(null),
        ]);
        let reply = versionReply
          ? listReply.library && versionReply.library
            ? {
                ...listReply,
                library: {
                  ...listReply.library,
                  authority: versionReply.library.authority,
                  ttl_ms: Math.min(
                    listReply.library.ttl_ms,
                    versionReply.library.ttl_ms
                  ),
                },
              }
            : !listReply.library
              ? listReply
              : versionReply
          : listReply;
        if (reply.error === "not_allowed" && resource)
          reply = await requestResource({
            workspace: snapshot.workspace,
            host: true,
            offset,
            metadataOnly: true,
          });
        if (!alive || ticket !== epoch || document.hidden || !navigator.onLine)
          return;
        let deadline = inputReadDeadline(started, reply.library?.ttl_ms ?? 0);
        if (!reply.library || performance.now() >= deadline) {
          clear();
          return;
        }
        setLibrary(reply.library);
        setProblem("");
        clearTimeout(expiry);
        expiry = setTimeout(clear, Math.max(0, deadline - performance.now()));
        const authority = reply.library.authority;
        if (!authority) {
          loaded = null;
          setDetail(null);
        } else if (
          resource &&
          (!loaded ||
            authority.versions.some(
              (id) => !loaded!.versions.some((version) => version.id === id)
            ))
        ) {
          const full = await requestResource({
            workspace: snapshot.workspace,
            host: true,
            resource,
            offset: versionOffset,
          });
          deadline = Math.min(
            deadline,
            inputReadDeadline(started, full.library?.ttl_ms ?? 0)
          );
          if (
            !alive ||
            ticket !== epoch ||
            document.hidden ||
            !navigator.onLine
          )
            return;
          if (!full.library?.resource || performance.now() >= deadline) {
            clear();
            return;
          }
          loaded = full.library.resource;
          setDetail(loaded);
        }
      } catch {
        if (alive && ticket === epoch) clear();
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
      epoch++;
      clearTimeout(expiry);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", changed);
      window.removeEventListener("offline", changed);
      window.removeEventListener("online", changed);
    };
  }, [snapshot.workspace, resource, offset, versionOffset, plan.command]);
  const versions = (detail?.versions ?? []).filter(
    (version) =>
      library?.authority?.versions.includes(version.id) &&
      (version.kind !== "file" || version.file?.status === "ready")
  );
  const currentAllocation = snapshot.items.find(
    (item) => item.allocation === plan.allocation
  );
  const conflict =
    !!currentAllocation && currentAllocation.revision !== plan.revision;
  const change = (patch: Partial<ResourceProposal>) => {
    const next = { ...plan, ...patch };
    setPlan(next);
    onChange(next);
  };
  const has = (kind: ResourceSelector["kind"], id: string | null) =>
    plan.selectors.some(
      (selector) => selector.kind === kind && selector.id === id
    );
  const toggle = (kind: ResourceSelector["kind"], id: string | null) =>
    change({
      selectors: has(kind, id)
        ? plan.selectors.filter(
            (selector) => selector.kind !== kind || selector.id !== id
          )
        : [...plan.selectors, { kind, id }],
    });
  return (
    <div role="group" aria-label="Resource allocation editor">
      <h3 ref={heading} tabIndex={-1}>
        {plan.command === "audience"
          ? "Update resource audience"
          : plan.command === "release"
            ? "Release scheduled resource"
            : "Choose resource and release"}
      </h3>
      {problem && <p role="alert">{problem}</p>}
      {conflict && (
        <div role="status">
          <p>
            This allocation changed. Your selections and reason are retained.
            Review them against the current allocation before previewing again.
          </p>
          <button
            disabled={pending || !!currentAllocation?.revoked_at}
            onClick={() => change({ revision: currentAllocation!.revision })}
          >
            Use current allocation revision with my selections
          </button>
        </div>
      )}
      <fieldset disabled={pending || (plan.command === "schedule" && !library)}>
        <legend>Resource allocation</legend>
        {plan.command === "schedule" && (
          <>
            <label htmlFor="allocation-library-resource">
              Library resource
            </label>
            <select
              id="allocation-library-resource"
              value={resource}
              onChange={(event) => {
                setResource(event.target.value);
                setVersionOffset(0);
              }}
            >
              <option value="">Choose a resource</option>
              {library?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · {item.id}
                </option>
              ))}
            </select>
            {offset > 0 && (
              <button onClick={() => setOffset(Math.max(0, offset - 20))}>
                Previous library page
              </button>
            )}
            {library?.next_offset !== null &&
              library?.next_offset !== undefined && (
                <button onClick={() => setOffset(library.next_offset!)}>
                  More library resources
                </button>
              )}
            <label htmlFor="allocation-resource-version">
              Ready resource version
            </label>
            <select
              id="allocation-resource-version"
              value={plan.version}
              onChange={(event) => change({ version: event.target.value })}
            >
              <option value="">Choose ready version</option>
              {plan.version &&
                !versions.some((version) => version.id === plan.version) && (
                  <option value={plan.version}>
                    Existing exact version · {plan.version}
                  </option>
                )}
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.title} · version {version.ordinal}
                </option>
              ))}
            </select>
            {resource && versionOffset > 0 && (
              <button
                onClick={() =>
                  setVersionOffset(Math.max(0, versionOffset - 20))
                }
              >
                Newer resource versions
              </button>
            )}
            {library?.authority?.next_version_offset !== null &&
              library?.authority?.next_version_offset !== undefined && (
                <button
                  onClick={() =>
                    setVersionOffset(library.authority!.next_version_offset!)
                  }
                >
                  Older resource versions
                </button>
              )}
            <label htmlFor="allocation-release-trigger">Release resource</label>
            <select
              id="allocation-release-trigger"
              value={plan.trigger}
              onChange={(event) =>
                change({
                  trigger: event.target.value as ResourceProposal["trigger"],
                  activity: null,
                })
              }
            >
              <option value="manual">Manually</option>
              <option value="start">At session start</option>
              <option value="activity">At activity start</option>
            </select>
            {plan.trigger === "activity" && (
              <>
                <label htmlFor="allocation-release-activity">
                  Release activity
                </label>
                <select
                  id="allocation-release-activity"
                  value={plan.activity ?? ""}
                  onChange={(event) =>
                    change({ activity: event.target.value || null })
                  }
                >
                  <option value="">Choose activity</option>
                  {snapshot.activities?.map((activity) => (
                    <option key={activity.id} value={activity.id}>
                      {activity.title} · {activity.id}
                    </option>
                  ))}
                </select>
              </>
            )}
          </>
        )}
        <p>
          Group/shared selections mean current recipients at release. Later
          entry does not grant an older resource.
        </p>
        <label>
          <input
            type="checkbox"
            checked={has("shared", null)}
            onChange={() => toggle("shared", null)}
          />
          Shared — current admitted participants
        </label>
        <fieldset>
          <legend>Named individuals</legend>
          {snapshot.participants?.map((person) => (
            <label key={person.id}>
              <input
                type="checkbox"
                checked={has("individual", person.id)}
                onChange={() => toggle("individual", person.id)}
              />
              {person.name} · {person.id}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Stable session groups</legend>
          {snapshot.groups?.map((group) => (
            <label key={group.id}>
              <input
                type="checkbox"
                checked={has("group", group.id)}
                onChange={() => toggle("group", group.id)}
              />
              Group {group.ordinal} · {group.id}
            </label>
          ))}
        </fieldset>
        {plan.command === "audience" && (
          <>
            <fieldset>
              <legend>Explicitly restore previously revoked recipients</legend>
              <p>
                Select only the named identities whose previous revocation you
                intend to lift.
              </p>
              {snapshot.participants?.map((person) => (
                <label key={person.id}>
                  <input
                    type="checkbox"
                    checked={plan.restore.includes(person.id)}
                    onChange={(event) =>
                      change({
                        restore: event.target.checked
                          ? [...plan.restore, person.id]
                          : plan.restore.filter((id) => id !== person.id),
                      })
                    }
                  />
                  {person.name} · {person.id}
                </label>
              ))}
            </fieldset>
            <label htmlFor="resource-audience-reason">
              Reason for resource audience change
            </label>
            <textarea
              id="resource-audience-reason"
              value={plan.reason}
              onChange={(event) => change({ reason: event.target.value })}
            />
          </>
        )}
      </fieldset>
      <button
        disabled={
          pending ||
          conflict ||
          !plan.version ||
          !plan.selectors.length ||
          (plan.trigger === "activity" && !plan.activity) ||
          (plan.command === "audience" &&
            (!plan.reason.trim() || !validWorkText(plan.reason, 500)))
        }
        onClick={() => onPreview(plan)}
      >
        Preview resource{" "}
        {plan.command === "audience"
          ? "audience"
          : plan.command === "release"
            ? "release"
            : "schedule"}
      </button>
      <button disabled={pending} onClick={onCancel}>
        Cancel allocation edit
      </button>
    </div>
  );
}
