/* eslint-disable security/detect-non-literal-fs-filename -- paths are private mkdtemp fixtures, never user input */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { RoomServiceClient } from "livekit-server-sdk";
import {
  MonitorProbe,
  initialMonitorState,
  writeMonitorState,
  type MonitorFixture,
} from "../../lib/monitor-probe";

const actors = [
  { identity: "facilitator", role: "facilitator", room: "main", session: "a" },
  { identity: "p1", role: "participant", room: "breakout-1", session: "a" },
  { identity: "p2", role: "participant", room: "breakout-2", session: "a" },
  { identity: "other", role: "participant", room: "main", session: "b" },
  { identity: "operator", role: "operator", room: "main", session: "a" },
] as const;
const fixture: MonitorFixture = {
  expiresAt: Date.now() + 60_000,
  assignments: actors.map((a, i) => ({
    ...a,
    name: a.identity,
    providerRoom: `${a.session}-${a.room}`,
    hash: createHash("sha256").update(String(i).repeat(64)).digest("hex"),
  })),
};
const request = (index: number, action: string, extra = {}) => ({
  credential: String(index).repeat(64),
  session: actors.at(index)!.session,
  room: actors.at(index)!.room,
  action,
  revision: 0,
  ...extra,
});
function setup() {
  const state = initialMonitorState();
  let connected = "";
  const provider = {
    listParticipants: vi.fn(async (room: string) => [
      ...fixture.assignments
        .filter((a) => a.role === "participant" && a.providerRoom === room)
        .map((a) => ({ identity: a.identity, tracks: [] })),
      ...(connected ? [{ identity: connected, tracks: [] }] : []),
    ]),
    removeParticipant: vi.fn(async () => {
      connected = "";
    }),
    updateSubscriptions: vi.fn(async () => {}),
  };
  const persist = vi.fn(async () => {});
  const sign = vi.fn(async () => ({ token: "fixture" }));
  const controller = new MonitorProbe(
    fixture,
    state,
    provider as unknown as RoomServiceClient,
    persist,
    sign
  );
  return {
    state,
    provider,
    persist,
    sign,
    controller,
    connect: () => {
      connected = state.route!.identity;
    },
  };
}

describe("P1-02 scoped route controller", () => {
  it("AC1 denies grants before the correct room notice and does not expose another session", async () => {
    const { controller, state, sign } = setup();
    await controller.handle(
      request(0, "request", { target: "breakout-1", mode: "listen" })
    );
    await expect(
      controller.handle(request(0, "grant", { route: state.route!.id }))
    ).rejects.toMatchObject({ status: 409 });
    expect(sign).not.toHaveBeenCalled();
    await expect(
      controller.handle(request(2, "ack", { route: state.route!.id }))
    ).rejects.toMatchObject({ status: 409 });
    expect((await controller.handle(request(3, "read"))).route).toBeNull();
    await controller.handle(request(1, "ack", { route: state.route!.id }));
    await controller.handle(request(0, "grant", { route: state.route!.id }));
    expect(state.events.map((e) => e.kind)).toEqual([
      "notice-established",
      "notice-acknowledged",
      "route-granted",
    ]);
    await expect(
      controller.handle(
        request(1, "request", { target: "breakout-2", mode: "speak" })
      )
    ).rejects.toMatchObject({ status: 403 });
  });
  it("AC2 blocks the destination while old cleanup fails, then retries closure before a new notice", async () => {
    const { controller, state, provider, connect } = setup();
    await controller.handle(
      request(0, "request", { target: "breakout-1", mode: "listen" })
    );
    const old = state.route!.id;
    connect();
    await controller.handle(request(4, "fault", { enabled: true }));
    await expect(
      controller.handle(
        request(0, "request", {
          target: "breakout-2",
          mode: "speak",
          revision: state.next,
        })
      )
    ).rejects.toMatchObject({ status: 503 });
    expect(state.route).toMatchObject({
      id: old,
      room: "breakout-1",
      phase: "failed",
    });
    await controller.handle(request(4, "fault", { enabled: false }));
    await controller.handle(
      request(0, "request", {
        target: "breakout-2",
        mode: "speak",
        revision: state.next,
      })
    );
    expect(provider.removeParticipant).toHaveBeenCalledWith(
      "a-breakout-1",
      `monitor-${old}`
    );
    expect(state.events.map((e) => e.kind).slice(-2)).toEqual([
      "closed",
      "notice-established",
    ]);
    await expect(
      controller.handle(request(0, "grant", { route: old }))
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      controller.handle(request(0, "connected", { route: old }))
    ).rejects.toMatchObject({ status: 409 });
  });
  it("AC2 persists revocation even if remote removal fails; restoration never restores authority", async () => {
    const { controller, state, connect } = setup();
    await controller.handle(
      request(0, "request", { target: "breakout-1", mode: "join" })
    );
    connect();
    await controller.handle(request(4, "fault", { enabled: true }));
    await expect(controller.handle(request(4, "revoke"))).rejects.toMatchObject(
      { status: 503 }
    );
    expect(state.revoked).toBe(true);
    await expect(
      controller.handle(request(0, "grant", { route: state.route!.id }))
    ).rejects.toMatchObject({ status: 403 });
    await controller.handle(request(4, "fault", { enabled: false }));
    await controller.handle(request(0, "stop", { revision: state.next }));
    expect(state.route).toBeNull();
    await expect(
      controller.handle(
        request(0, "request", { target: "breakout-1", mode: "join" })
      )
    ).rejects.toMatchObject({ status: 403 });
  });
  it("AC2 rejects reordered transfers and old compensating stops, including after closure", async () => {
    const { controller, state } = setup();
    await controller.handle(
      request(0, "request", { target: "breakout-1", mode: "listen" })
    );
    const oldRevision = state.next;
    await controller.handle(
      request(0, "request", {
        target: "breakout-2",
        mode: "listen",
        revision: oldRevision,
      })
    );
    const current = state.route;
    await expect(
      controller.handle(request(0, "stop", { revision: oldRevision }))
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      controller.handle(
        request(0, "request", {
          target: "breakout-1",
          mode: "speak",
          revision: oldRevision,
        })
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(state.route).toBe(current);
    await controller.handle(request(0, "stop", { revision: state.next }));
    await expect(
      controller.handle(
        request(0, "request", { target: "breakout-1", mode: "speak" })
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(state.route).toBeNull();
  });
  it("AC2 automatically marks control loss uncertain before any manual Stop", async () => {
    const { controller, state, connect } = setup();
    await controller.handle(
      request(0, "request", { target: "breakout-1", mode: "listen" })
    );
    connect();
    await controller.handle(request(4, "fault", { enabled: true }));
    expect(state.route?.phase).toBe("failed");
    expect(state.events.at(-1)?.kind).toBe("cleanup-failed");
    expect((await controller.handle(request(1, "read"))).route?.phase).toBe(
      "failed"
    );
  });
  it("AC3 reloads acknowledged work from disk, rejects stale writes and isolates authors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "debrio-monitor-"));
    const path = join(directory, "state.json");
    try {
      const { state, provider, sign } = setup();
      const controller = new MonitorProbe(
        fixture,
        state,
        provider as unknown as RoomServiceClient,
        (s) => writeMonitorState(path, s),
        sign
      );
      await controller.handle(
        request(1, "save", {
          revision: 0,
          text: "Synthetic acknowledged answer",
        })
      );
      const restored = new MonitorProbe(
        fixture,
        JSON.parse(await readFile(path, "utf8")),
        provider as unknown as RoomServiceClient,
        (s) => writeMonitorState(path, s),
        sign
      );
      expect((await restored.handle(request(1, "read"))).work).toMatchObject({
        revision: 1,
        text: "Synthetic acknowledged answer",
      });
      expect((await restored.handle(request(2, "read"))).work.text).toBe("");
      await expect(
        restored.handle(
          request(1, "save", { revision: 0, text: "Stale overwrite" })
        )
      ).rejects.toMatchObject({ status: 409 });
      expect(JSON.parse(await readFile(path, "utf8")).work[0].text).toBe(
        "Synthetic acknowledged answer"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
