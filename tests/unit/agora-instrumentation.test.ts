import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const source = await readFile("scripts/agora-browser.js", "utf8");
function fixture() {
  const gateway = {
    leave: vi.fn(),
    reset: vi.fn(),
    signal: { close: vi.fn() },
  };
  const client = {
    _gateway: gateway,
    _reset: vi.fn(),
    leave: vi.fn(),
    renewToken: vi.fn(),
    on: vi.fn(),
  };
  class Peer {}
  Object.assign(Peer.prototype, {
    close: vi.fn(),
    removeTrack: vi.fn(),
    setLocalDescription: vi.fn(),
    setRemoteDescription: vi.fn(),
  });
  class Sender {}
  Object.assign(Sender.prototype, { replaceTrack: vi.fn() });
  class Transceiver {}
  Object.assign(Transceiver.prototype, { stop: vi.fn() });
  Object.defineProperty(Transceiver.prototype, "direction", {
    configurable: true,
    set: vi.fn(),
  });
  class Track {}
  Object.assign(Track.prototype, { stop: vi.fn() });
  Object.defineProperty(Track.prototype, "enabled", {
    configurable: true,
    set: vi.fn(),
  });
  class Socket {}
  const socketSend = vi.fn();
  const socketClose = vi.fn();
  Object.assign(Socket.prototype, { send: socketSend, close: socketClose });
  const originals = [
    client.leave,
    client._reset,
    gateway.leave,
    gateway.reset,
    gateway.signal.close,
    socketClose,
  ];
  const globals = {
    window: {} as object,
    RTCPeerConnection: Peer,
    RTCRtpSender: Sender,
    RTCRtpTransceiver: Transceiver,
    MediaStreamTrack: Track,
    WebSocket: Socket,
    document: { querySelector: () => ({ textContent: "" }) },
    AgoraRTC: {
      setLogLevel: vi.fn(),
      disableLogUpload: vi.fn(),
      createClient: () => client,
    },
    probe: undefined as unknown as {
      resist(): void;
      renew(token: string): Promise<void>;
      leave(): Promise<void>;
    },
  };
  globals.window = globals;
  return { globals, client, gateway, originals, socketSend, Socket };
}

it("P1-01-AC2 matched guards block teardown but permit signalling and renewal, then restore cleanup", async () => {
  const f = fixture();
  runInNewContext(source, f.globals);
  f.globals.probe.resist();
  await f.client.leave();
  f.client._reset();
  await f.gateway.leave();
  f.gateway.reset();
  f.gateway.signal.close();
  const socket = new f.Socket() as unknown as {
    send(value: string): void;
    close(): void;
  };
  socket.close();
  expect(f.originals.every((fn) => fn.mock.calls.length === 0)).toBe(true);
  socket.send("synthetic heartbeat");
  await f.globals.probe.renew("synthetic renewed credential");
  expect(f.socketSend).toHaveBeenCalledWith("synthetic heartbeat");
  expect(f.client.renewToken).toHaveBeenCalledWith(
    "synthetic renewed credential"
  );
  await f.globals.probe.leave();
  expect(f.originals[0]).toHaveBeenCalledOnce();
});

it("P1-01-AC2 refuses to claim instrumentation when the pinned SDK hook disappears", () => {
  const f = fixture();
  Reflect.deleteProperty(f.gateway, "leave");
  expect(() => runInNewContext(source, f.globals)).toThrow(
    "Pinned Agora teardown hook unavailable"
  );
});
