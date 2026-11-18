"use client";

import { useEffect, useRef, useState } from "react";
import {
  createLocalTracks,
  Room,
  RoomEvent,
  TrackEvent,
  type LocalTrack,
} from "livekit-client";
import type { Mode, MonitorView } from "../../../lib/monitor-probe";
import styles from "../media/probe.module.css";

type Reply = MonitorView & {
  grant?: { token: string; url: string; room: string };
};
class RequestError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function MonitoringProbe() {
  const [view, setView] = useState<MonitorView | null>(null);
  const [message, setMessage] = useState(
    "Enter a private synthetic invitation."
  );
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [target, setTarget] = useState("breakout-1");
  const [camera, setCamera] = useState(false);
  const [dwell, setDwell] = useState(5);
  const [scanning, setScanning] = useState(false);
  const [draft, setDraft] = useState("");
  const [workRevision, setWorkRevision] = useState(0);
  const [workStatus, setWorkStatus] = useState("No saved text loaded.");
  const [workBusy, setWorkBusy] = useState(false);
  const editGeneration = useRef(0);
  const [mediaCounts, setMediaCounts] = useState({ received: 0, sent: 0 });
  const auth = useRef<Record<string, string> | null>(null);
  const latest = useRef<MonitorView | null>(null);
  const active = useRef<Room | null>(null);
  const activeRevision = useRef<number | undefined>(undefined);
  const tracks = useRef<LocalTrack[]>([]);
  const output = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const running = useRef(false);
  const scan = useRef(false);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const notice = useRef<HTMLParagraphElement>(null);
  const scanRoom = useRef<string | null>(null);

  function update(value: MonitorView) {
    if (latest.current && value.revision < latest.current.revision) return;
    latest.current = value;
    setView(value);
  }
  async function call(command: Record<string, unknown>): Promise<Reply> {
    const response = await fetch("/api/probe/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...auth.current, ...command }),
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new RequestError(
        response.status,
        result.error ?? "Probe request failed."
      );
    return result;
  }
  function localStop() {
    const room = active.current;
    active.current = null;
    activeRevision.current = undefined;
    room?.removeAllListeners();
    tracks.current.forEach((track) => track.stop());
    tracks.current = [];
    output.current?.replaceChildren();
    setConnected(false);
    setMediaCounts({ received: 0, sent: 0 });
    if (room) void room.disconnect().catch(() => {});
  }
  function cancelPending() {
    generation.current++;
  }
  function stopScan() {
    scan.current = false;
    setScanning(false);
    clearTimeout(scanTimer.current);
  }
  async function stop(
    reason = "Stopped. Rejoin explicitly to transmit again.",
    revision = activeRevision.current ?? latest.current?.revision
  ) {
    generation.current++;
    stopScan();
    localStop();
    setMessage(reason);
    if (latest.current?.role === "facilitator") {
      setMessage(`${reason} Confirming route cleanup…`);
      try {
        update(await call({ action: "stop", revision }));
        setMessage(reason);
      } catch (error) {
        try {
          update(await call({ action: "read" }));
        } catch {
          /* Keep the last known state. */
        }
        setMessage(
          `Local media stopped. ${error instanceof Error ? error.message : "Cleanup unconfirmed."}`
        );
      }
    }
  }

  useEffect(() => {
    if (!view?.identity) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await call({ action: "read" });
        if (disposed) return;
        update(value);
        if (
          value.role === "participant" &&
          value.route &&
          !value.route.acknowledged.includes(value.identity)
        ) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          if (
            !disposed &&
            notice.current?.dataset.route === String(value.route.id)
          )
            await call({ action: "ack", route: value.route.id });
        }
        if (
          (value.revoked && value.role === "facilitator") ||
          (value.role === "facilitator" &&
            value.controlFailure &&
            (active.current || running.current || scan.current)) ||
          (value.role === "facilitator" &&
            active.current &&
            (!value.route || value.route.phase === "failed"))
        ) {
          generation.current++;
          stopScan();
          localStop();
          setMessage(
            value.revoked
              ? "Facilitator permission revoked. Local media stopped."
              : "Media stopped; cleanup/recovery requires an explicit action."
          );
        }
        if (active.current)
          setMediaCounts({
            received: [...active.current.remoteParticipants.values()]
              .flatMap((p) => [...p.trackPublications.values()])
              // isSubscribed reflects the client's request flag, not server-managed delivery.
              .filter((p) => p.track).length,
            sent: active.current.localParticipant.trackPublications.size,
          });
        if (Date.now() >= value.expiresAt) await stop("Synthetic run expired.");
      } catch {
        if (!disposed) {
          const cleanupRevision = activeRevision.current;
          generation.current++;
          stopScan();
          localStop();
          setMessage(
            "Task connection unavailable. Local media stopped; saved work retained. Restore connection, then Retry Stop before rejoining."
          );
          if (cleanupRevision !== undefined) {
            try {
              update(await call({ action: "stop", revision: cleanupRevision }));
            } catch {
              /* Cleanup remains unconfirmed until reconnect/retry. */
            }
          }
        }
      } finally {
        if (!disposed) timer = setTimeout(poll, 400);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      cancelPending();
      scan.current = false;
      clearTimeout(scanTimer.current);
      localStop();
    };
    // The authenticated identity is stable; mutable connection state lives in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.identity]);

  async function connect(
    grant: NonNullable<Reply["grant"]>,
    mode: Mode | "participant",
    attempt: number,
    revision?: number
  ) {
    const room = new Room({
      reconnectPolicy: { nextRetryDelayInMs: () => null },
    });
    active.current = room;
    activeRevision.current = revision;
    room.on(RoomEvent.TrackSubscribed, (track) => {
      output.current?.append(track.attach());
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) =>
      track.detach().forEach((element) => element.remove())
    );
    room.on(RoomEvent.Disconnected, () => {
      if (attempt === generation.current)
        void stop(
          "Media disconnected. Retry Stop and explicitly rejoin.",
          revision
        );
    });
    room.on(RoomEvent.Reconnecting, () => {
      if (attempt === generation.current)
        void stop("Connection interrupted. Rejoin explicitly.", revision);
    });
    await room.connect(grant.url, grant.token, {
      autoSubscribe: mode === "participant",
      maxRetries: 0,
    });
    if (attempt !== generation.current) {
      await room.disconnect();
      return;
    }
    if (mode !== "listen") {
      const acquired = await createLocalTracks({
        audio: true,
        video: camera && mode !== "speak",
      });
      if (attempt !== generation.current) {
        acquired.forEach((track) => track.stop());
        await room.disconnect();
        return;
      }
      tracks.current = acquired;
      for (const track of acquired) {
        if (attempt !== generation.current) {
          track.stop();
          await room.disconnect();
          return;
        }
        track.once(TrackEvent.Ended, () => {
          if (attempt === generation.current)
            void stop(
              `Device lost (${track.kind}). Check browser permissions/devices and explicitly rejoin.`,
              revision
            );
        });
        await room.localParticipant.publishTrack(track);
      }
    }
    if (attempt !== generation.current) {
      await room.disconnect();
      return;
    }
    setConnected(true);
  }

  async function transition(mode: Mode, room: string, fromScan = false) {
    if (running.current) return;
    if (!fromScan) stopScan();
    running.current = true;
    setBusy(true);
    const attempt = ++generation.current;
    const expectedRevision = latest.current?.revision;
    let ownedRevision: number | undefined;
    localStop();
    try {
      setMessage(`Opening ${mode} in ${room}; waiting for named notice…`);
      const prepared = await call({
        action: "request",
        target: room,
        mode,
        revision: expectedRevision,
      });
      ownedRevision = prepared.revision;
      update(prepared);
      let granted: Reply | undefined;
      for (
        let tries = 0;
        tries < 30 && attempt === generation.current;
        tries++
      ) {
        try {
          granted = await call({ action: "grant", route: prepared.route?.id });
          break;
        } catch (error) {
          if (!(error instanceof RequestError) || error.status !== 409)
            throw error;
          await pause(100);
        }
      }
      if (attempt !== generation.current) return;
      if (!granted?.grant)
        throw new Error(
          "Room unavailable: participant notice not acknowledged."
        );
      await connect(granted.grant, mode, attempt, prepared.revision);
      if (attempt !== generation.current) return;
      update(await call({ action: "connected", route: prepared.route?.id }));
      setMessage(
        `${mode === "listen" ? "Listening" : mode === "speak" ? "Speaking" : "Joined"}: ${room}.`
      );
    } catch (error) {
      localStop();
      setMessage(error instanceof Error ? error.message : "Transfer failed.");
      try {
        if (ownedRevision !== undefined)
          update(await call({ action: "stop", revision: ownedRevision }));
      } catch {
        /* Keep server's failed closure and notice for Retry Stop. */
      }
    } finally {
      if (attempt !== generation.current) {
        localStop();
        try {
          if (ownedRevision !== undefined)
            update(await call({ action: "stop", revision: ownedRevision }));
        } catch {}
      }
      running.current = false;
      setBusy(false);
    }
  }

  async function nextScan() {
    if (!scan.current) return;
    const rooms = latest.current?.rooms ?? [];
    const current = scanRoom.current ?? latest.current?.route?.room ?? target;
    const next = rooms[(rooms.indexOf(current) + 1) % rooms.length];
    if (!next) return;
    scanRoom.current = next;
    setTarget(next);
    await transition("listen", next, true);
    if (scan.current)
      scanTimer.current = setTimeout(() => void nextScan(), dwell * 1000);
  }

  async function participantJoin() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const attempt = ++generation.current;
    localStop();
    try {
      const result = await call({ action: "grant" });
      if (result.grant) await connect(result.grant, "participant", attempt);
      if (attempt === generation.current)
        setMessage(`Joined: ${result.assignedRoom}.`);
    } catch (error) {
      localStop();
      setMessage(
        error instanceof Error ? error.message : "Device/join failed."
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <main className={styles.probe}>
      <p className="wordmark">Debrio · local synthetic monitoring</p>
      <h1>Visible room controls</h1>
      <p>
        Local prototype only. No hosted usage or recording service. Old-token
        replay on this local SFU is not prevented; provider and two-device
        acceptance remain incomplete.
      </p>
      {!view ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            auth.current = Object.fromEntries(
              new FormData(event.currentTarget)
            ) as Record<string, string>;
            try {
              const value = await call({ action: "read" });
              update(value);
              setDraft(value.work.text);
              setWorkRevision(value.work.revision);
              setWorkStatus(`Loaded revision ${value.work.revision}`);
              setMessage(`Authenticated: ${value.name}`);
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : "Invitation denied."
              );
            }
          }}
        >
          <label>
            Invitation
            <input
              name="credential"
              type="password"
              required
              minLength={64}
              maxLength={64}
              autoComplete="off"
            />
          </label>
          <label>
            Session
            <select name="session">
              <option value="a">Synthetic A</option>
              <option value="b">Synthetic B</option>
            </select>
          </label>
          <label>
            Assigned room
            <select name="room">
              {[
                "main",
                "breakout-1",
                "breakout-2",
                "breakout-3",
                "breakout-4",
              ].map((room) => (
                <option key={room}>{room}</option>
              ))}
            </select>
          </label>
          <button>Open fixture</button>
        </form>
      ) : (
        <>
          <p>
            {view.name} · {view.role} · Assigned room:{" "}
            <strong data-testid="assignment">{view.assignedRoom}</strong>
          </p>
          <p
            ref={notice}
            data-testid="notice"
            data-route={view.route?.id}
            role="status"
          >
            {view.route
              ? `Facilitator Ada ${view.route.mode === "speak" ? "speaking" : view.route.mode === "join" ? "joining" : "listening"} in ${view.route.room} — ${view.route.phase === "notice" ? "notice before access" : view.route.phase === "active" ? "active" : "cleanup unconfirmed"}`
              : "No active facilitator route."}
          </p>
          {view.role !== "operator" && (
            <label>
              <input
                type="checkbox"
                checked={camera}
                disabled={busy || connected}
                onChange={(event) => setCamera(event.target.checked)}
              />{" "}
              Include camera when joining (never Speak/Listen)
            </label>
          )}
          {view.role === "participant" && (
            <button
              disabled={busy || connected}
              onClick={() => void participantJoin()}
            >
              Join assigned room
            </button>
          )}
          {view.role === "facilitator" && (
            <>
              <label>
                Target room
                <select
                  value={target}
                  disabled={busy}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  {view.rooms.map((room) => (
                    <option key={room}>{room}</option>
                  ))}
                </select>
              </label>
              {(["listen", "speak", "join"] as Mode[]).map((mode) => (
                <button
                  key={mode}
                  disabled={busy || view.revoked}
                  onClick={() => void transition(mode, target)}
                >
                  {mode === "listen"
                    ? "Listen"
                    : mode === "speak"
                      ? "Speak"
                      : "Join"}
                </button>
              ))}
              <button
                disabled={busy || view.revoked}
                onClick={() => void transition("join", "main")}
              >
                Return to main
              </button>
              <label>
                Scan dwell (seconds)
                <input
                  type="number"
                  min={1}
                  max={30}
                  disabled={scanning}
                  value={dwell}
                  onChange={(event) =>
                    setDwell(
                      Math.max(1, Math.min(30, Number(event.target.value) || 1))
                    )
                  }
                />
              </label>
              <button
                disabled={busy || view.revoked || scanning}
                onClick={() => {
                  scan.current = true;
                  setScanning(true);
                  void nextScan();
                }}
              >
                Scan
              </button>
              <button disabled={!scanning} onClick={stopScan}>
                Pause scan
              </button>
              <button
                disabled={busy || view.revoked}
                onClick={() => {
                  clearTimeout(scanTimer.current);
                  scan.current = true;
                  setScanning(true);
                  void nextScan();
                }}
              >
                Next room
              </button>
              <span role="status">
                {scanning ? "Scan running" : "Scan paused"}
              </span>
            </>
          )}
          {view.role === "operator" && (
            <>
              <button
                onClick={() =>
                  void call({ action: "fault", enabled: !view.controlFailure })
                    .then(update)
                    .catch((error) => setMessage(error.message))
                }
              >
                {view.controlFailure
                  ? "Restore provider control"
                  : "Simulate control failure"}
              </button>
              <button
                onClick={() =>
                  void call({ action: "revoke" })
                    .then(update)
                    .catch((error) => setMessage(error.message))
                }
              >
                Revoke facilitator
              </button>
            </>
          )}
          {view.role !== "operator" && (
            <button onClick={() => void stop()}>Stop / Retry Stop</button>
          )}
          <button
            onClick={() =>
              void active.current
                ?.startAudio()
                .catch(() =>
                  setMessage(
                    "Audio blocked. Check browser playback permissions."
                  )
                )
            }
          >
            Enable audio
          </button>
          <p data-testid="media-state">
            {connected ? "Media connected" : "Media stopped"} · Received tracks:{" "}
            {mediaCounts.received} · Published tracks: {mediaCounts.sent}
          </p>
          <section aria-label="Synthetic saved work">
            <h2>Test work</h2>
            <label>
              Test output
              <textarea
                value={draft}
                maxLength={2000}
                onChange={(event) => {
                  editGeneration.current++;
                  setDraft(event.target.value);
                  setWorkStatus("Unsaved changes");
                }}
              />
            </label>
            <button
              disabled={workBusy}
              onClick={async () => {
                const submitted = editGeneration.current;
                setWorkBusy(true);
                setWorkStatus("Saving test work…");
                try {
                  const value = await call({
                    action: "save",
                    text: draft,
                    revision: workRevision,
                  });
                  setWorkRevision(value.work.revision);
                  setWorkStatus(
                    submitted === editGeneration.current
                      ? `Saved revision ${value.work.revision}`
                      : "Unsaved changes (earlier edit saved)"
                  );
                } catch (error) {
                  setWorkStatus(
                    `Unsaved: ${error instanceof Error ? error.message : "Save failed"}`
                  );
                } finally {
                  setWorkBusy(false);
                }
              }}
            >
              Save test work
            </button>
            <button
              disabled={workBusy}
              onClick={async () => {
                const requested = editGeneration.current;
                setWorkBusy(true);
                try {
                  const value = await call({ action: "read" });
                  if (requested !== editGeneration.current) {
                    setWorkStatus(
                      "Reload cancelled; newer local edit retained."
                    );
                    return;
                  }
                  setDraft(value.work.text);
                  setWorkRevision(value.work.revision);
                  setWorkStatus(`Loaded revision ${value.work.revision}`);
                } catch {
                  setWorkStatus("Could not reload; local edit retained.");
                } finally {
                  setWorkBusy(false);
                }
              }}
            >
              Reload saved text
            </button>
            <p role="status">{workStatus}</p>
          </section>
        </>
      )}
      <p role="status" aria-live="polite" data-testid="connection-status">
        {message}
      </p>
      <div ref={output} role="group" aria-label="Remote media" />
    </main>
  );
}
