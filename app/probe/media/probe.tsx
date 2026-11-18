"use client";

import { useEffect, useRef, useState } from "react";
import {
  createLocalTracks,
  LocalTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import styles from "./probe.module.css";

export default function MediaProbe() {
  const [state, setState] = useState("Not connected");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [camera, setCamera] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [peers, setPeers] = useState<string[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const room = useRef<Room | null>(null);
  const tracks = useRef<LocalTrack[]>([]);
  const generation = useRef(0);

  async function stop(
    message = "Left media. Rejoin explicitly to transmit again."
  ) {
    generation.current++;
    const active = room.current;
    room.current = null;
    tracks.current.forEach((track) => track.stop());
    tracks.current = [];
    if (preview.current) preview.current.srcObject = null;
    media.current?.replaceChildren();
    setReady(false);
    setConnected(false);
    setPeers([]);
    setBusy(false);
    setPlaybackBlocked(false);
    setState(message);
    if (active) {
      active.removeAllListeners();
      await active.disconnect();
    }
  }

  useEffect(
    () => () => {
      generation.current++;
      tracks.current.forEach((track) => track.stop());
      void room.current?.disconnect();
    },
    []
  );

  async function preflight() {
    await stop("Checking devices…");
    const attempt = generation.current;
    setBusy(true);
    try {
      const acquired = await createLocalTracks({ audio: true, video: camera });
      if (attempt !== generation.current) {
        acquired.forEach((track) => track.stop());
        return;
      }
      tracks.current = acquired;
      acquired.forEach((track) => {
        track.mediaStreamTrack.addEventListener(
          "ended",
          () =>
            void stop(
              "Device unavailable. Reconnect it and check devices again."
            ),
          { once: true }
        );
        if (track.kind === Track.Kind.Video && preview.current)
          track.attach(preview.current);
      });
      setReady(true);
      setState("Devices ready. Nothing is transmitted until you join.");
    } catch (error) {
      if (attempt !== generation.current) return;
      setState(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Device access denied. Allow microphone/camera in browser settings, then check devices again."
          : "Device unavailable. Check your microphone/camera connection, then check devices again."
      );
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }

  async function join() {
    if (!ready || !form.current || room.current) return;
    setBusy(true);
    setState("Connecting…");
    const attempt = generation.current;
    const values = new FormData(form.current);
    try {
      const response = await fetch("/api/probe/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(values)),
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          "Join denied or unavailable. Check the invitation, assignment and run expiry with the operator."
        );
      const grant = await response.json();
      if (attempt !== generation.current) return;
      const active = new Room({
        reconnectPolicy: { nextRetryDelayInMs: () => null },
      });
      room.current = active;
      const updatePeers = () => setPeers([...active.remoteParticipants.keys()]);
      active
        .on(RoomEvent.ParticipantConnected, updatePeers)
        .on(RoomEvent.ParticipantDisconnected, updatePeers);
      active.on(RoomEvent.TrackSubscribed, (track) => {
        const element = track.attach();
        if (track.kind === Track.Kind.Video) {
          element.setAttribute("aria-label", "Synthetic participant camera");
        }
        media.current?.append(element);
      });
      active.on(RoomEvent.TrackUnsubscribed, (track) =>
        track.detach().forEach((element) => element.remove())
      );
      active.on(RoomEvent.AudioPlaybackStatusChanged, () =>
        setPlaybackBlocked(!active.canPlaybackAudio)
      );
      active.on(
        RoomEvent.Reconnecting,
        () =>
          void stop(
            "Connection interrupted. Check devices and explicitly rejoin."
          )
      );
      active.on(
        RoomEvent.Disconnected,
        () => void stop("Disconnected. Check devices and explicitly rejoin.")
      );
      await active.connect(grant.url, grant.token, { maxRetries: 0 });
      if (attempt !== generation.current) {
        await active.disconnect();
        return;
      }
      for (const track of tracks.current)
        await active.localParticipant.publishTrack(track);
      if (attempt !== generation.current) {
        await active.disconnect();
        return;
      }
      updatePeers();
      setConnected(true);
      setState(`Connected to ${grant.room} as ${grant.identity}`);
    } catch (error) {
      if (attempt === generation.current)
        await stop(
          error instanceof Error && error.message.startsWith("Join denied")
            ? error.message
            : "Connection failed. Check devices and explicitly retry joining."
        );
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  }

  return (
    <main className={styles.probe}>
      <p className="wordmark">Debrio · synthetic media probe</p>
      <h1>Isolated room check</h1>
      <p>
        Test identities only. This is a feasibility fixture, not a workshop.
        LiveKit transports microphone and optional camera media. No recording or
        captions are started by this probe.
      </p>
      <p>
        <strong>Known limit:</strong> token expiry prevents new joins; it does
        not terminate active media. Production authorization and Cloud/device
        feasibility remain unproven.
      </p>
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault();
          void join();
        }}
      >
        <fieldset disabled={busy || connected}>
          <legend>Private synthetic assignment</legend>
          <label>
            Invitation{" "}
            <input
              name="credential"
              type="password"
              autoComplete="off"
              required
              minLength={64}
              maxLength={64}
            />
          </label>
          <label>
            Session{" "}
            <select name="session">
              <option value="a">Synthetic A</option>
              <option value="b">Synthetic B (negative fixture)</option>
            </select>
          </label>
          <label>
            Room{" "}
            <select name="room">
              {[
                "main",
                "breakout-1",
                "breakout-2",
                "breakout-3",
                "breakout-4",
              ].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={camera}
              onChange={(event) => {
                setCamera(event.target.checked);
                void stop();
              }}
            />{" "}
            Include camera
          </label>
          <button type="button" onClick={() => void preflight()}>
            Check devices
          </button>
          <button type="submit" disabled={!ready}>
            Join assigned room
          </button>
        </fieldset>
      </form>
      <button type="button" onClick={() => void stop()}>
        Leave / stop devices
      </button>
      {playbackBlocked && (
        <button
          onClick={() =>
            void room.current
              ?.startAudio()
              .catch(() =>
                setState(
                  "Playback blocked. Check browser audio settings and try Enable audio again."
                )
              )
          }
        >
          Enable audio
        </button>
      )}
      <p role="status" aria-live="polite">
        {state}
      </p>
      <p>
        Other participants in this room:{" "}
        {peers.length ? peers.join(", ") : "none"}
      </p>
      <video
        ref={preview}
        muted
        autoPlay
        playsInline
        aria-label="Local camera preview"
        hidden={!camera || !ready}
      />
      <div ref={media} role="group" aria-label="Remote media" />
    </main>
  );
}
