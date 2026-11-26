"use client";

import { useEffect, useRef, useState } from "react";
import type { ResourceDraft } from "../../lib/resources";
import { ResourceVersionDetails } from "./details";

type FileIntent = {
  intent: string;
  resource: string;
  revision: number;
  state: string;
  error?: string | null;
  filename?: string;
  size?: number;
  version?: string | null;
  upload_lock_until?: string | null;
};
type FileReply = {
  intent?: FileIntent | null;
  receipt?: { committed: boolean; version?: string; purge_pending?: boolean };
  error?: string;
  uncertain?: boolean;
};
type BeginRequest = {
  workspace: string;
  command: "begin";
  operation: string;
  resource: string;
  revision: number;
  title: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
};

async function fileRequest(input: object): Promise<FileReply> {
  const response = await fetch("/api/resources/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  return response.json();
}

export function FileResourceEditor({
  workspace,
  initial,
  enabled,
  verified,
  onSaved,
}: {
  workspace: string;
  initial: ResourceDraft;
  enabled: boolean;
  verified: boolean;
  onSaved: (resource: ResourceDraft) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [file, setFile] = useState<File | null>(null);
  const [saved, setSaved] = useState(initial);
  const [intent, setIntent] = useState<FileIntent | null>(null);
  const [status, setStatus] = useState("Unsaved");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryRequest, setRetryRequest] = useState<BeginRequest | null>(null);
  const [unknown, setUnknown] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const locked = busy || !enabled || !verified;
  const dirty = !!file || title !== saved.title || unknown;

  useEffect(() => {
    heading.current?.focus();
    if (!verified) return;
    if (!initial.revision) return;
    let alive = true;
    void fileRequest({ workspace, command: "status", resource: initial.id })
      .then((reply) => {
        if (alive && reply.intent) {
          setIntent(reply.intent);
          setStatus(
            reply.intent.state === "validated"
              ? "Ready to mark"
              : reply.intent.state
          );
        }
      })
      .catch(() => {
        if (alive) setStatus("Unavailable");
      });
    return () => {
      alive = false;
    };
  }, [workspace, initial.id, initial.revision, verified]);

  const refresh = async () => {
    const response = await fetch("/api/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace, host: true, resource: saved.id }),
      cache: "no-store",
    });
    const data = await response.json();
    if (data.library?.resource) {
      const resource = data.library.resource as ResourceDraft;
      setSaved(resource);
      onSaved(resource);
    }
  };

  const validate = async (current: FileIntent) => {
    setBusy(true);
    setStatus("Validating / Scan pending");
    try {
      const result = await fileRequest({
        workspace,
        command: "validate",
        intent: current.intent,
      });
      if (result.intent?.state === "validated") {
        setStatus("Ready to mark");
        setIntent(result.intent);
        setFile(null);
        setUnknown(false);
        setError("");
      } else {
        setStatus(
          result.error === "invalid_file" || result.error === "malware_detected"
            ? "Rejected"
            : "Unavailable"
        );
        setError(
          result.error === "malware_detected"
            ? "The scanner rejected this file. Delete it and choose another."
            : result.error === "invalid_file"
              ? "The stored file failed validation. Delete it and choose another."
              : "The file could not be verified. Retry validation when service returns."
        );
        setUnknown(!!result.uncertain);
      }
    } catch {
      setStatus("Result unknown");
      setUnknown(true);
      setError("Validation result unknown. Check this exact upload result.");
    } finally {
      setBusy(false);
    }
  };

  const finalize = async (current: FileIntent) => {
    setBusy(true);
    setStatus("Marking ready");
    try {
      const result = await fileRequest({
        workspace,
        command: "finalize",
        intent: current.intent,
      });
      if (result.receipt?.committed) {
        setStatus("Ready");
        setIntent({
          ...current,
          state: "ready",
          version: result.receipt.version,
        });
        setFile(null);
        setRetryRequest(null);
        setUnknown(false);
        setError("");
        await refresh();
      } else {
        setStatus("Unavailable");
        setError(
          "The file could not be marked ready. Check this exact result after reconnecting."
        );
        setUnknown(!!result.uncertain);
      }
    } catch {
      setStatus("Result unknown");
      setUnknown(true);
      setError("Readiness result unknown. Check this exact upload result.");
    } finally {
      setBusy(false);
    }
  };

  const uploadExact = async (current: FileIntent, selected: File) => {
    const response = await fetch(
      `/api/resources/file?workspace=${encodeURIComponent(workspace)}&intent=${encodeURIComponent(current.intent)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: selected,
        cache: "no-store",
      }
    );
    const result = (await response.json()) as FileReply;
    if (!result.receipt?.committed) {
      setStatus(
        result.error === "invalid_file" ? "Rejected" : "Result unknown"
      );
      setUnknown(result.error !== "invalid_file");
      setError(
        result.error === "invalid_file"
          ? "The selected bytes do not match this upload intent. Select the original file."
          : "Upload result unknown. Check this exact intent after reconnecting."
      );
      return;
    }
    await validate(current);
  };

  const begin = async () => {
    if (busy || !file) return;
    setBusy(true);
    setError("");
    setStatus("Uploading");
    let begunIntent: FileIntent | null = null;
    let attempted: BeginRequest | null = null;
    try {
      if (intent?.state === "pending" || intent?.state === "uploading") {
        if (
          intent.state === "uploading" &&
          intent.upload_lock_until &&
          Date.parse(intent.upload_lock_until) > Date.now()
        ) {
          setStatus("Uploading");
          setError(
            "The previous upload is still finishing. Retry this exact file after its short lease expires."
          );
          return;
        }
        await uploadExact(intent, file);
        return;
      }
      if (intent?.state === "validated") {
        setStatus("Ready to mark");
        return;
      }
      const mime = file.name.endsWith(".pdf")
        ? "application/pdf"
        : "text/plain";
      if (
        !title.trim() ||
        title.length > 120 ||
        !/\.(pdf|txt)$/u.test(file.name) ||
        file.size < 1 ||
        file.size > 10485760
      ) {
        setStatus("Unsaved");
        setError("Choose a PDF or TXT file of 1 byte to 10 MiB and a title.");
        return;
      }
      const sha256 = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const request: BeginRequest = retryRequest ?? {
        workspace,
        command: "begin",
        operation: crypto.randomUUID(),
        resource: saved.id,
        revision: saved.revision,
        title,
        filename: file.name,
        mime,
        size: file.size,
        sha256,
      };
      attempted = request;
      const result = await fileRequest(request);
      if (result.intent?.state === "ready") {
        setIntent(result.intent);
        setStatus("Ready");
        setRetryRequest(null);
        setUnknown(false);
        await refresh();
        return;
      }
      if (!result.intent || result.intent.state !== "pending") {
        setRetryRequest(result.uncertain ? request : null);
        setUnknown(!!result.uncertain);
        setStatus(
          result.error === "resource_conflict" ? "Conflict" : "Unavailable"
        );
        setError(
          result.error ??
            "Upload preparation unavailable. Retry the exact request."
        );
        return;
      }
      begunIntent = result.intent;
      setIntent(result.intent);
      setRetryRequest(null);
      setUnknown(false);
      setSaved((previous) => {
        const next = { ...previous, title, revision: result.intent!.revision };
        onSaved(next);
        return next;
      });
      await uploadExact(result.intent, file);
    } catch {
      if (begunIntent) setIntent(begunIntent);
      else if (attempted) setRetryRequest(attempted);
      setUnknown(true);
      setStatus("Result unknown");
      setError(
        begunIntent
          ? "Upload result unknown. Check the exact upload result."
          : "Upload preparation result unknown. Your selected file remains here; retry the exact request."
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (version?: string) => {
    if ((!intent && !version) || busy) return;
    setBusy(true);
    try {
      const result = await fileRequest({
        workspace,
        command: "delete",
        ...(version ? { version } : { intent: intent!.intent }),
      });
      if (result.receipt?.committed) {
        if (!version && intent) setIntent({ ...intent, state: "deleted" });
        setStatus(
          result.receipt.purge_pending ? "Deleted · cleanup pending" : "Deleted"
        );
        setFile(null);
        await refresh();
      } else setError("Deletion could not be confirmed. Try again.");
    } catch {
      setError("Deletion result unknown. Refresh and retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-work-protected={dirty || busy ? "true" : undefined}>
      <h2 tabIndex={-1} ref={heading}>
        {saved.revision ? "File resource" : "New file resource"}
      </h2>
      <p role="status">{verified ? status : "Unavailable"}</p>
      {error && verified && <p role="alert">{error}</p>}
      <p>
        PDF or UTF-8 TXT, 1 byte to 10 MiB. Files are scanned before release.
      </p>
      <label htmlFor="file-resource-title">Resource title</label>
      <input
        id="file-resource-title"
        value={verified ? title : ""}
        disabled={
          locked || unknown || (!!intent && intent.state === "promoting")
        }
        onChange={(event) => setTitle(event.target.value)}
      />
      <label htmlFor="file-resource-input">Choose file</label>
      <input
        id="file-resource-input"
        type="file"
        accept=".pdf,.txt,application/pdf,text/plain"
        disabled={
          locked || unknown || (!!intent && intent.state === "promoting")
        }
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      {file && verified && (
        <p>
          {file.name} · {file.size} bytes
        </p>
      )}
      {intent && verified && (
        <p>
          Upload {intent.filename} · {intent.state}
          {intent.error ? ` · ${intent.error}` : ""}
        </p>
      )}
      <div className="actions">
        <button
          disabled={
            locked ||
            !file ||
            (!!intent && ["promoting", "validated"].includes(intent.state))
          }
          onClick={() => void begin()}
        >
          {retryRequest ? "Retry exact upload" : "Upload and validate"}
        </button>
        {intent && ["pending", "unavailable"].includes(intent.state) && (
          <button disabled={locked} onClick={() => void validate(intent)}>
            Check exact upload result
          </button>
        )}
        {intent?.state === "validated" && (
          <button disabled={locked} onClick={() => void finalize(intent)}>
            Mark ready
          </button>
        )}
        {intent && ["promoting", "ready"].includes(intent.state) && (
          <button disabled={locked} onClick={() => void finalize(intent)}>
            Check exact upload result
          </button>
        )}
        {intent && intent.state !== "deleted" && (
          <button disabled={locked} onClick={() => void remove()}>
            Delete this file version
          </button>
        )}
      </div>
      <h3>Immutable ready versions</h3>
      {verified &&
        saved.versions.map((version) => (
          <div key={version.id}>
            <ResourceVersionDetails version={version} />
            {version.file && version.file.status !== "deleted" && (
              <button disabled={locked} onClick={() => void remove(version.id)}>
                Delete version {version.ordinal}
              </button>
            )}
          </div>
        ))}
    </section>
  );
}
