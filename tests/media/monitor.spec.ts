import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  test,
  expect,
  type Page,
  type BrowserContext,
  type Browser,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  RoomServiceClient,
  TokenVerifier,
  TrackSource,
} from "livekit-server-sdk";
import { initialMonitorState } from "../../lib/monitor-probe";
import type { MonitorView } from "../../lib/monitor-probe";

declare global {
  interface Window {
    monitorMedia: { peers: RTCPeerConnection[]; captures: MediaStreamTrack[] };
  }
}
function instrumentMedia() {
  window.monitorMedia = { peers: [], captures: [] };
  const Peer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Peer {
    constructor(configuration?: RTCConfiguration) {
      super(configuration);
      window.monitorMedia.peers.push(this);
    }
  };
  const acquire = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices
  );
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await acquire(constraints);
    window.monitorMedia.captures.push(...stream.getTracks());
    return stream;
  };
}
async function audioPackets(
  page: Page,
  direction: "inbound-rtp" | "outbound-rtp"
) {
  return page.evaluate(async (direction) => {
    let packets = 0;
    for (const peer of window.monitorMedia.peers) {
      if (peer.connectionState === "closed") continue;
      (await peer.getStats()).forEach((stat) => {
        if (stat.type === direction && stat.kind === "audio")
          packets +=
            direction === "inbound-rtp"
              ? stat.packetsReceived
              : stat.packetsSent;
      });
    }
    return packets;
  }, direction);
}
async function flowing(page: Page, direction: "inbound-rtp" | "outbound-rtp") {
  const before = await audioPackets(page, direction);
  await expect
    .poll(() => audioPackets(page, direction))
    .toBeGreaterThan(before + 5);
}
async function locallyClosed(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        open: window.monitorMedia.peers.filter(
          (p) => p.connectionState !== "closed"
        ).length,
        live: window.monitorMedia.captures.filter(
          (t) => t.readyState !== "ended"
        ).length,
        playback: document.querySelectorAll('[aria-label="Remote media"] audio')
          .length,
      }))
    )
    .toEqual({ open: 0, live: 0, playback: 0 });
}
async function demoPause(page: Page) {
  // Presentation dwell only, after assertions; never used to synchronize a test.
  if (process.env.PROBE_RECORD === "1") await page.waitForTimeout(1200);
}
async function holdReply(
  page: Page,
  action: string,
  matches: (value: MonitorView) => boolean = () => true,
  status = 200
) {
  let release!: () => void;
  let captured!: (value: MonitorView) => void;
  let held = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const value = new Promise<MonitorView>((resolve) => {
    captured = resolve;
  });
  await page.route("**/api/probe/monitor", async (route) => {
    if (held || route.request().postDataJSON()?.action !== action)
      return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    if (matches(data)) {
      held = true;
      captured(data);
      await gate;
    }
    await route.fulfill({ response, status });
  });
  return { value, release };
}

type Invitation = {
  credential: string;
  identity: string;
  name: string;
  session: string;
  room: string;
  providerRoom: string;
  role: string;
};
const invitations: Invitation[] = JSON.parse(
  await readFile(".artifacts/media-probe/monitor-invitations.json", "utf8")
);
const provider = new RoomServiceClient(
  "ws://127.0.0.1:7880",
  "probe-local",
  "synthetic-local-fixture-not-a-cloud-key"
);
const invite = (identity: string) =>
  invitations.find((a) => a.identity === identity)!;
async function api(page: Page, actor: Invitation, action: string, extra = {}) {
  return page.request.post("/api/probe/monitor", {
    headers: { origin: "http://127.0.0.1:3101" },
    data: { ...actor, action, ...extra },
  });
}
async function enter(page: Page, actor: Invitation) {
  await page.goto("/probe/monitor");
  // Chromium's synthetic camera can end when capture starts in a background tab.
  await page.bringToFront();
  await expect
    .poll(() => page.evaluate(() => document.visibilityState))
    .toBe("visible");
  await page.getByLabel("Invitation", { exact: true }).fill(actor.credential);
  await page
    .getByRole("combobox", { name: "Session", exact: true })
    .selectOption(actor.session);
  await page
    .getByRole("combobox", { name: "Assigned room", exact: true })
    .selectOption(actor.room);
  await page.getByRole("button", { name: "Open fixture" }).click();
  await expect(
    page.getByText(`${actor.name} · ${actor.role}`, { exact: false })
  ).toBeVisible();
}
async function participant(page: Page, identity: string, camera = false) {
  await enter(page, invite(identity));
  if (camera) await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Join assigned room" }).click();
  await expect
    .poll(async () =>
      JSON.stringify({
        media: await page.getByTestId("media-state").textContent(),
        status: await page.getByTestId("connection-status").textContent(),
      })
    )
    .toContain("Media connected");
  if (camera)
    await expect
      .poll(() =>
        page.evaluate(async () => {
          let bytes = 0;
          for (const peer of window.monitorMedia.peers)
            (await peer.getStats()).forEach((stat) => {
              if (stat.type === "outbound-rtp" && stat.kind === "video")
                bytes += stat.bytesSent;
            });
          return bytes;
        })
      )
      .toBeGreaterThan(0);
}
const contexts: BrowserContext[] = [];
const recordings: { page: Page; name: string }[] = [];
async function peerPage(browser: Browser, record = false) {
  const context = await browser.newContext({
    permissions: ["microphone", "camera"],
    viewport: { width: 1280, height: 1100 },
    ...(record && process.env.PROBE_RECORD === "1"
      ? {
          recordVideo: {
            dir: ".artifacts/P1-02/raw-video",
            size: { width: 1280, height: 1100 },
          },
        }
      : {}),
  });
  contexts.push(context);
  await context.addInitScript(instrumentMedia);
  return context.newPage();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(instrumentMedia);
  await writeFile(
    ".artifacts/media-probe/monitor-state.json",
    JSON.stringify(initialMonitorState())
  );
});
test.afterEach(async ({ page }) => {
  for (const context of contexts.splice(0)) await context.close();
  await page.close();
  for (const recording of recordings.splice(0))
    await recording.page
      .video()
      ?.saveAs(`.artifacts/P1-02/${recording.name}.webm`);
  for (const room of new Set(invitations.map((a) => a.providerRoom))) {
    for (const p of await provider.listParticipants(room))
      await provider.removeParticipant(room, p.identity);
  }
});

test("P1-02 monitor demo: notices, scoped tracks, switching, save and failed cleanup recovery", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const one = await peerPage(browser, true);
  if (process.env.PROBE_RECORD === "1")
    recordings.push(
      { page, name: "facilitator" },
      { page: one, name: "participant" }
    );
  const two = await peerPage(browser);
  const main = await peerPage(browser);
  const operator = await peerPage(browser);
  await participant(one, "breakout-1-1", true);
  await participant(two, "breakout-2-1");
  await participant(main, "main-1");
  await enter(operator, invite("operator"));
  await enter(page, invite("facilitator"));
  await page
    .getByLabel("Test output")
    .fill("Synthetic work survives media transfer and refresh.");
  await page.getByRole("button", { name: "Save test work" }).click();
  await expect(
    page.getByText("Saved revision 1", { exact: true })
  ).toBeVisible();
  const started = Date.now();
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening: breakout-1"
  );
  const switchMs = Date.now() - started;
  await expect(one.getByTestId("notice")).toContainText(
    "Facilitator Ada listening"
  );
  await expect(two.getByTestId("notice")).toHaveText(
    "No active facilitator route."
  );
  await expect
    .poll(async () =>
      JSON.stringify({
        media: await page.getByTestId("media-state").textContent(),
        route: (await (await api(page, invite("facilitator"), "read")).json())
          .route,
        peers: (
          await provider.listParticipants(invite("breakout-1-1").providerRoom)
        ).map((p) => ({
          identity: p.identity,
          tracks: p.tracks.map((t) => ({ sid: t.sid, source: t.source })),
          permission: p.permission,
        })),
      })
    )
    .toContain("Received tracks: 1 · Published tracks: 0");
  let state = await (await api(page, invite("facilitator"), "read")).json();
  const routeOne = state.route;
  await flowing(page, "inbound-rtp");
  expect(await audioPackets(page, "outbound-rtp")).toBe(0);
  await demoPause(page);
  const observed = await provider.getParticipant(
    routeOne.providerRoom,
    routeOne.identity
  );
  expect(observed.permission).toMatchObject({
    canPublish: false,
    canSubscribe: true,
  });
  expect(observed.tracks).toHaveLength(0);
  const events = state.events.map((e: { kind: string }) => e.kind);
  expect(events.indexOf("notice-acknowledged")).toBeLessThan(
    events.indexOf("route-granted")
  );
  const liveGrant = await (
    await api(page, invite("facilitator"), "grant", { route: routeOne.id })
  ).json();
  const decoded = await new TokenVerifier(
    "probe-local",
    "synthetic-local-fixture-not-a-cloud-key"
  ).verify(liveGrant.grant.token);
  expect(decoded.video).toMatchObject({
    canPublish: false,
    canSubscribe: true,
    room: routeOne.providerRoom,
  });
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Speaking: breakout-1"
  );
  await expect(one.getByTestId("notice")).toContainText(
    "Facilitator Ada speaking"
  );
  await expect(page.getByTestId("media-state")).toContainText(
    "Published tracks: 1"
  );
  await flowing(page, "outbound-rtp");
  await flowing(one, "inbound-rtp");
  await demoPause(page);
  state = await (await api(page, invite("facilitator"), "read")).json();
  expect(
    (
      await provider.getParticipant(
        state.route.providerRoom,
        state.route.identity
      )
    ).tracks.map((track) => track.source)
  ).toEqual([TrackSource.MICROPHONE]);
  expect(
    (await provider.listParticipants(routeOne.providerRoom)).some(
      (p) => p.identity === routeOne.identity
    )
  ).toBe(false);
  await page
    .getByRole("combobox", { name: "Target room", exact: true })
    .selectOption("breakout-2");
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening: breakout-2"
  );
  await expect(one.getByTestId("notice")).toHaveText(
    "No active facilitator route."
  );
  await expect(page.getByTestId("assignment")).toHaveText("main");
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByTestId("assignment")).toHaveText("breakout-2");
  await page.getByRole("button", { name: "Return to main" }).click();
  await expect(page.getByTestId("assignment")).toHaveText("main");
  const stopStarted = Date.now();
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await expect(page.getByTestId("media-state")).toContainText("Media stopped");
  const stopUiObservedMs = Date.now() - stopStarted;
  await locallyClosed(page);
  await expect(page.getByTestId("connection-status")).toHaveText(
    "Stopped. Rejoin explicitly to transmit again."
  );
  await demoPause(page);
  await page
    .getByRole("combobox", { name: "Target room", exact: true })
    .selectOption("breakout-1");
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening: breakout-1"
  );
  await operator
    .getByRole("button", { name: "Simulate control failure" })
    .click();
  await expect(page.getByTestId("media-state")).toContainText("Media stopped");
  await expect(one.getByTestId("notice")).toContainText("cleanup unconfirmed");
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "cleanup unconfirmed"
  );
  const failed = await api(page, invite("facilitator"), "request", {
    target: "breakout-2",
    mode: "listen",
    revision: (await (await api(page, invite("facilitator"), "read")).json())
      .revision,
  });
  expect(failed.status()).toBe(503);
  await expect(one.getByTestId("notice")).toContainText("cleanup unconfirmed");
  await demoPause(page);
  const recoveryStarted = Date.now();
  await operator
    .getByRole("button", { name: "Restore provider control" })
    .click();
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await expect(one.getByTestId("notice")).toHaveText(
    "No active facilitator route."
  );
  const recoveryMs = Date.now() - recoveryStarted;
  await demoPause(page);
  await page.reload();
  await enter(page, invite("facilitator"));
  await expect(page.getByLabel("Test output")).toHaveValue(
    "Synthetic work survives media transfer and refresh."
  );
  await page.getByLabel("Scan dwell (seconds)").fill("1");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(page.getByText("Scan running", { exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await (await api(page, invite("facilitator"), "read")).json()
        ).events.filter(
          (e: { kind: string }) => e.kind === "notice-established"
        ).length
    )
    .toBeGreaterThan(6);
  await page.getByRole("button", { name: "Pause scan" }).click();
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await expect(page.getByTestId("connection-status")).toHaveText(
    "Stopped. Rejoin explicitly to transmit again."
  );
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening"
  );
  await operator.getByRole("button", { name: "Revoke facilitator" }).click();
  await expect(page.getByTestId("connection-status")).toContainText("revoked");
  expect(
    (
      await api(page, invite("facilitator"), "grant", { route: routeOne.id })
    ).status()
  ).toBe(403);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
    "BODY"
  );
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
  await mkdir(".artifacts/P1-02", { recursive: true });
  await writeFile(
    ".artifacts/P1-02/browser-events.json",
    JSON.stringify(
      (await (await api(page, invite("facilitator"), "read")).json()).events,
      null,
      2
    )
  );
  await writeFile(
    ".artifacts/P1-02/browser-metrics.json",
    JSON.stringify(
      {
        switchMs,
        stopUiObservedMs,
        recoveryMs,
        note: "Single synthetic observation; not p95, physical audio or provider revocation proof",
        browser: browser.version(),
      },
      null,
      2
    )
  );
});

test("P1-02 AC1/AC2/AC3: late tracks, device loss, interrupted transfer and network recovery", async ({
  page,
  browser,
}) => {
  const one = await peerPage(browser);
  const late = await peerPage(browser);
  await participant(one, "breakout-1-1");
  await enter(page, invite("facilitator"));
  await page
    .getByLabel("Test output")
    .fill("Acknowledged before device and network faults.");
  await page.getByRole("button", { name: "Save test work" }).click();
  await expect(
    page.getByText("Saved revision 1", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening:"
  );
  await flowing(page, "inbound-rtp");
  await participant(late, "breakout-1-2", true);
  await expect(late.getByTestId("notice")).toContainText(
    "Facilitator Ada listening"
  );
  await expect(page.getByTestId("media-state")).toContainText(
    "Received tracks: 2"
  );
  expect(await page.locator('[aria-label="Remote media"] video').count()).toBe(
    0
  );
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Speaking:"
  );
  await flowing(page, "outbound-rtp");
  await page.evaluate(() => {
    const track = window.monitorMedia.captures.find(
      (t) => t.kind === "audio" && t.readyState === "live"
    );
    if (!track) throw new Error("Missing synthetic microphone");
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await expect(page.getByTestId("connection-status")).toContainText(
    "Device lost"
  );
  await locallyClosed(page);
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening:"
  );
  await page.context().setOffline(true);
  await expect(page.getByTestId("media-state")).toContainText("Media stopped", {
    timeout: 12_000,
  });
  await locallyClosed(page);
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await expect(one.getByTestId("notice")).toHaveText(
    "No active facilitator route."
  );
  await page.reload();
  await enter(page, invite("facilitator"));
  await expect(page.getByLabel("Test output")).toHaveValue(
    "Acknowledged before device and network faults."
  );
  await expect(page.getByTestId("media-state")).toContainText("Media stopped");
  // Withhold the participant acknowledgement, then cancel the pending route.
  await one.route("**/api/probe/monitor", (route) =>
    route.request().postDataJSON()?.action === "ack"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: '{"error":"held synthetic notice"}',
        })
      : route.continue()
  );
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(one.getByTestId("notice")).toContainText("notice before access");
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await expect(
    page.getByRole("button", { name: "Listen", exact: true })
  ).toBeEnabled();
  await expect
    .poll(
      async () =>
        (await (await api(page, invite("facilitator"), "read")).json()).route
    )
    .toBeNull();
  await locallyClosed(page);
  await one.unroute("**/api/probe/monitor");
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening:"
  );
  await flowing(page, "inbound-rtp");
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await locallyClosed(page);
});

test("P1-02 AC2: an old tab's disconnect cleanup cannot close a newer route", async ({
  page,
  browser,
}) => {
  const participantPage = await peerPage(browser);
  const newer = await peerPage(browser);
  await participant(participantPage, "breakout-1-1");
  await enter(page, invite("facilitator"));
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening:"
  );
  await flowing(page, "inbound-rtp");
  const previous = await (
    await api(page, invite("facilitator"), "read")
  ).json();
  await enter(newer, invite("facilitator"));
  await newer.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(newer.getByTestId("connection-status")).toContainText(
    "Speaking:"
  );
  await expect(page.getByTestId("media-state")).toContainText("Media stopped");
  await expect(page.getByTestId("connection-status")).toContainText(
    "Route changed"
  );
  await flowing(newer, "outbound-rtp");
  expect(
    (
      await api(page, invite("facilitator"), "request", {
        revision: previous.revision,
        target: "main",
        mode: "join",
      })
    ).status()
  ).toBe(409);
  await expect(newer.getByTestId("media-state")).toContainText(
    "Media connected"
  );
  await newer.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await locallyClosed(newer);
});

test("P1-02 AC2: delayed connection confirmation cannot undo Stop", async ({
  page,
  browser,
}) => {
  const one = await peerPage(browser);
  await participant(one, "breakout-1-1");
  await enter(page, invite("facilitator"));
  const held = await holdReply(page, "connected");
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await held.value;
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await expect
    .poll(
      async () =>
        (await (await api(page, invite("facilitator"), "read")).json()).route
    )
    .toBeNull();
  held.release();
  await expect(
    page.getByRole("button", { name: "Listen", exact: true })
  ).toBeEnabled();
  await expect(page.getByTestId("connection-status")).not.toContainText(
    "Listening:"
  );
  await locallyClosed(page);
});

test("P1-02 AC2: an obsolete failed poll cannot stop a recovered route", async ({
  page,
  browser,
}) => {
  const one = await peerPage(browser);
  await participant(one, "breakout-1-1");
  await enter(page, invite("facilitator"));
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening:"
  );
  const held = await holdReply(
    page,
    "read",
    (value) => value.route?.phase === "failed"
  );
  await api(page, invite("operator"), "fault", { enabled: true });
  await held.value;
  await api(page, invite("operator"), "fault", { enabled: false });
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Route changed"
  );
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await expect(one.getByTestId("notice")).toHaveText(
    "No active facilitator route."
  );
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening:"
  );
  const received = page.waitForResponse(
    (response) => response.request().postDataJSON()?.action === "read"
  );
  held.release();
  await received;
  await flowing(page, "inbound-rtp");
  await expect(page.getByTestId("media-state")).toContainText(
    "Media connected"
  );
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await locallyClosed(page);
});

test("P1-02 AC2: a rejected obsolete poll cannot stop a newer route", async ({
  page,
  browser,
}) => {
  const one = await peerPage(browser);
  await participant(one, "breakout-1-1");
  await enter(page, invite("facilitator"));
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening:"
  );
  const held = await holdReply(page, "read", () => true, 503);
  await held.value;
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await expect(page.getByTestId("connection-status")).toHaveText(
    "Stopped. Rejoin explicitly to transmit again."
  );
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Speaking:"
  );
  const received = page.waitForResponse(
    (response) => response.status() === 503
  );
  held.release();
  await received;
  await flowing(page, "outbound-rtp");
  await expect(page.getByTestId("connection-status")).toContainText(
    "Speaking:"
  );
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await locallyClosed(page);
});

test("P1-02 AC2: an old Stop reply cannot report a newer speaking route as stopped", async ({
  page,
  browser,
}) => {
  const one = await peerPage(browser);
  await participant(one, "breakout-1-1");
  await enter(page, invite("facilitator"));
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening:"
  );
  const held = await holdReply(page, "stop");
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await held.value;
  await expect(one.getByTestId("notice")).toHaveText(
    "No active facilitator route."
  );
  await expect(page.getByTestId("notice")).toHaveText(
    "No active facilitator route."
  );
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Speaking:"
  );
  const received = page.waitForResponse(
    (response) => response.request().postDataJSON()?.action === "stop"
  );
  held.release();
  await received;
  await flowing(page, "outbound-rtp");
  await expect(page.getByTestId("connection-status")).toContainText(
    "Speaking:"
  );
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
  await locallyClosed(page);
});

test("P1-02 AC2: a superseded tab never connects its delayed grant", async ({
  page,
  browser,
}) => {
  const one = await peerPage(browser);
  const newer = await peerPage(browser);
  await participant(one, "breakout-1-1");
  await enter(page, invite("facilitator"));
  const held = await holdReply(page, "grant");
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  const old = await held.value;
  await enter(newer, invite("facilitator"));
  await newer.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(newer.getByTestId("connection-status")).toContainText(
    "Speaking:"
  );
  await expect(page.getByTestId("notice")).toContainText("active");
  const received = page.waitForResponse(
    (response) => response.request().postDataJSON()?.action === "grant"
  );
  held.release();
  await received;
  await expect(
    page.getByRole("button", { name: "Speak", exact: true })
  ).toBeEnabled();
  await locallyClosed(page);
  expect(await page.evaluate(() => window.monitorMedia.peers.length)).toBe(0);
  expect(
    (await provider.listParticipants(invite("breakout-1-1").providerRoom)).some(
      (p) => p.identity === old.route?.identity
    )
  ).toBe(false);
  await flowing(newer, "outbound-rtp");
  await newer.getByRole("button", { name: "Stop / Retry Stop" }).click();
});

test("P1-02 AC3: Scan pauses after a failed transfer until an explicit restart", async ({
  page,
  browser,
}) => {
  const one = await peerPage(browser);
  await participant(one, "breakout-1-1");
  await enter(page, invite("facilitator"));
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Listening:"
  );
  await page.route("**/api/probe/monitor", async (route) => {
    if (route.request().postDataJSON()?.action !== "request")
      return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Provider cleanup unconfirmed." }),
    });
  });
  await page.getByLabel("Scan dwell (seconds)").fill("1");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await expect(page.getByText("Scan paused", { exact: true })).toBeVisible();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Provider cleanup unconfirmed."
  );
  await locallyClosed(page);
  await page.unroute("**/api/probe/monitor");
  await expect(page.getByRole("button", { name: "Pause scan" })).toBeDisabled();
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
});

test("P1-02 AC1: an already-issued participant grant cannot play intervention before notice acknowledgement", async ({
  page,
  browser,
}) => {
  const one = await peerPage(browser);
  const late = await peerPage(browser);
  await participant(one, "breakout-1-1");
  await enter(late, invite("breakout-1-2"));
  let release!: () => void;
  let captured!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetched = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await late.route("**/api/probe/monitor", async (route) => {
    const action = route.request().postDataJSON()?.action;
    if (action === "ack")
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: '{"error":"held notice"}',
      });
    if (action !== "grant") return route.continue();
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
  });
  await late.getByRole("button", { name: "Join assigned room" }).click();
  await fetched;
  await enter(page, invite("facilitator"));
  await page.getByRole("button", { name: "Speak", exact: true }).click();
  await expect(page.getByTestId("connection-status")).toContainText(
    "Speaking:"
  );
  release();
  await expect(late.getByTestId("media-state")).toContainText(
    "Media connected"
  );
  await expect(late.getByTestId("notice")).toContainText(
    "Facilitator Ada speaking"
  );
  await flowing(late, "inbound-rtp");
  await expect(late.getByTestId("media-state")).toContainText(
    "Received tracks: 1"
  );
  const pending = await (await api(page, invite("facilitator"), "read")).json();
  expect(pending.route.acknowledged).not.toContain("breakout-1-2");
  await late.unroute("**/api/probe/monitor");
  await expect(late.getByTestId("media-state")).toContainText(
    "Received tracks: 2"
  );
  await expect(page.getByTestId("media-state")).toContainText(
    "Received tracks: 2"
  );
  await page.getByRole("button", { name: "Stop / Retry Stop" }).click();
});

test("P1-02 AC3: a delayed acknowledgement never marks newer edits saved", async ({
  page,
}) => {
  await enter(page, invite("facilitator"));
  let release!: () => void;
  let fetched!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  await page.route("**/api/probe/monitor", async (route) => {
    if (route.request().postDataJSON()?.action !== "save")
      return route.continue();
    const response = await route.fetch();
    fetched();
    await held;
    await route.fulfill({ response });
  });
  await page.getByLabel("Test output").fill("First synthetic draft");
  await page.getByRole("button", { name: "Save test work" }).click();
  await saved;
  await expect(
    page.getByRole("button", { name: "Save test work" })
  ).toBeDisabled();
  await expect(
    page.getByText("Saving test work…", { exact: true })
  ).toBeVisible();
  await page.getByLabel("Test output").fill("Newer unsaved synthetic draft");
  release();
  await expect(
    page.getByText("Unsaved changes (earlier edit saved)", { exact: true })
  ).toBeVisible();
  expect(
    (await (await api(page, invite("facilitator"), "read")).json()).work.text
  ).toBe("First synthetic draft");
  await page.unroute("**/api/probe/monitor");
  await page.getByRole("button", { name: "Save test work" }).click();
  await expect(
    page.getByText("Saved revision 2", { exact: true })
  ).toBeVisible();
  await page.reload();
  await enter(page, invite("facilitator"));
  await expect(page.getByLabel("Test output")).toHaveValue(
    "Newer unsaved synthetic draft"
  );
});

test("P1-02 AC2 local limitation: a cached publishing token can rejoin after removal", async ({
  page,
}) => {
  const actor = invite("breakout-1-1");
  const response = await api(page, actor, "grant");
  expect(response.status()).toBe(200);
  const { grant } = await response.json();
  await page.goto("/");
  await page.addScriptTag({
    path: "node_modules/livekit-client/dist/livekit-client.umd.js",
  });
  await page.evaluate(async (grant) => {
    window.probeRoom = new window.LivekitClient.Room();
    await window.probeRoom.connect(grant.url, grant.token);
  }, grant);
  await provider.removeParticipant(actor.providerRoom, actor.identity);
  await expect
    .poll(() => page.evaluate(() => window.probeRoom.state))
    .toBe("disconnected");
  await page.evaluate(async (grant) => {
    window.probeRoom = new window.LivekitClient.Room();
    await window.probeRoom.connect(grant.url, grant.token);
  }, grant);
  expect(
    (await provider.getParticipant(actor.providerRoom, actor.identity))
      .permission?.canPublish
  ).toBe(true);
  await page.evaluate(() => window.probeRoom.disconnect());
});
