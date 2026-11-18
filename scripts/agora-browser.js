/* global AgoraRTC */
(() => {
  const peers = [];
  const interventions = [];
  let resist = false;
  let blockSignalling = false;
  // shortcut: selected SDK teardown paths only; use independent protocol/provider proof before adoption.
  const NativePeer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeer {
    constructor(...args) {
      super(...args);
      peers.push(this);
    }
  };
  function guard(prototype, method, asynchronous = false) {
    // Method names come only from the fixed instrumentation calls below.
    // eslint-disable-next-line security/detect-object-injection
    const original = prototype[method];
    // eslint-disable-next-line security/detect-object-injection
    prototype[method] = function (...args) {
      if (resist) {
        interventions.push({ at: Date.now(), method });
        return asynchronous ? Promise.resolve() : undefined;
      }
      return original.apply(this, args);
    };
  }
  guard(NativePeer.prototype, "close");
  guard(NativePeer.prototype, "removeTrack");
  guard(NativePeer.prototype, "setLocalDescription", true);
  guard(NativePeer.prototype, "setRemoteDescription", true);
  guard(RTCRtpSender.prototype, "replaceTrack", true);
  guard(RTCRtpTransceiver.prototype, "stop");
  guard(MediaStreamTrack.prototype, "stop");
  const enabled = Object.getOwnPropertyDescriptor(
    MediaStreamTrack.prototype,
    "enabled"
  );
  Object.defineProperty(MediaStreamTrack.prototype, "enabled", {
    ...enabled,
    set(value) {
      if (resist)
        interventions.push({ at: Date.now(), method: "track.enabled" });
      else enabled.set.call(this, value);
    },
  });
  for (const method of ["send", "close"]) {
    // Fixed WebSocket methods; block client leave messages without stopping RTP.
    // eslint-disable-next-line security/detect-object-injection
    const original = WebSocket.prototype[method];
    // eslint-disable-next-line security/detect-object-injection
    WebSocket.prototype[method] = function (...args) {
      if (blockSignalling)
        interventions.push({ at: Date.now(), method: "WebSocket." + method });
      else return original.apply(this, args);
    };
  }
  const direction = Object.getOwnPropertyDescriptor(
    RTCRtpTransceiver.prototype,
    "direction"
  );
  Object.defineProperty(RTCRtpTransceiver.prototype, "direction", {
    ...direction,
    set(value) {
      if (resist) interventions.push({ at: Date.now(), method: "direction" });
      else direction.set.call(this, value);
    },
  });
  AgoraRTC.setLogLevel(4);
  AgoraRTC.disableLogUpload();
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  const events = [];
  let track;
  let audio;
  client.on("connection-state-change", (state) => {
    events.push({ at: Date.now(), state });
    document.querySelector("#state").textContent = state;
  });
  client.on("token-privilege-will-expire", () =>
    events.push({ at: Date.now(), warning: true })
  );
  client.on("token-privilege-did-expire", () =>
    events.push({ at: Date.now(), expired: true })
  );
  client.on("user-published", async (user, type) => {
    if (type === "audio") {
      try {
        await client.subscribe(user, type);
      } catch {
        events.push({ at: Date.now(), subscribeFailed: true });
      }
    }
  });
  async function publish() {
    audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const destination = audio.createMediaStreamDestination();
    oscillator.frequency.value = 440;
    oscillator.connect(destination);
    oscillator.start();
    await audio.resume();
    track = AgoraRTC.createCustomAudioTrack({
      mediaStreamTrack: destination.stream.getAudioTracks()[0],
    });
    await client.publish(track);
  }
  window.probe = {
    async join(grant) {
      await client.join(grant.appId, grant.channel, grant.token, grant.uid);
      if (grant.publish) await publish();
    },
    renew: (token) => client.renewToken(token),
    publish,
    resist(blockOutbound = false) {
      resist = true;
      blockSignalling = blockOutbound;
      document.querySelector("#mode").textContent =
        "Expiry challenge: client teardown resisted";
    },
    async sample() {
      const reports = await Promise.all(
        peers.map((pc) => pc.getStats().catch(() => new Map()))
      );
      const audioRows = reports
        .flatMap((r) => [...r.values()])
        .filter((r) => r.kind === "audio");
      const inbound = audioRows
        .filter((r) => r.type === "inbound-rtp")
        .reduce((n, r) => n + (r.bytesReceived ?? 0), 0);
      const outbound = audioRows
        .filter((r) => r.type === "outbound-rtp")
        .reduce((n, r) => n + (r.bytesSent ?? 0), 0);
      document.querySelector("#bytes").textContent =
        "Received audio bytes: " + inbound;
      return {
        inbound,
        outbound,
        inboundRows: audioRows.filter((r) => r.type === "inbound-rtp").length,
        state: client.connectionState,
        peers: peers.map((p) => p.connectionState),
        interventions: interventions.length,
      };
    },
    evidence: () => ({ events, interventions }),
    async leave() {
      resist = false;
      blockSignalling = false;
      track?.close();
      await audio?.close();
      await client.leave();
    },
  };
})();
