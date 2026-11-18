import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  AccessToken,
  RoomServiceClient,
  TokenVerifier,
} from "livekit-server-sdk";
import type { Room } from "livekit-client";

declare global {
  interface Window {
    LivekitClient: typeof import("livekit-client");
    probeRoom: Room;
    probeReceivedTracks: string[];
  }
}
type Invitation = {
  credential: string;
  identity: string;
  session: string;
  room: string;
  providerRoom: string;
};
const invitations: Invitation[] = JSON.parse(
  await readFile(".artifacts/media-probe/invitations.json", "utf8")
);
const url = "ws://127.0.0.1:7880";
const key = "probe-local";
const secret = "synthetic-local-fixture-not-a-cloud-key";
const provider = new RoomServiceClient(url, key, secret);

async function grant(page: Page, invitation: Invitation) {
  const response = await page.request.post("/api/probe/grant", {
    headers: { origin: "http://127.0.0.1:3101" },
    data: invitation,
  });
  expect(response.status()).toBe(200);
  return (await response.json()).token as string;
}
async function harness(page: Page) {
  await page.goto("/");
  await page.addScriptTag({
    path: "node_modules/livekit-client/dist/livekit-client.umd.js",
  });
}
async function connect(page: Page, token: string, publish = true) {
  return page.evaluate(
    async ({ token, url, publish }) => {
      const sdk = window.LivekitClient;
      const room = new sdk.Room({
        reconnectPolicy: { nextRetryDelayInMs: () => null },
      });
      window.probeRoom = room;
      window.probeReceivedTracks = [];
      await room.connect(url, token, { maxRetries: 0 });
      const manager = room.engine.pcManager;
      if (!manager) throw new Error("Missing WebRTC transport");
      const onTrack = manager.onTrack;
      manager.onTrack = (event) => {
        window.probeReceivedTracks.push(event.track.id);
        onTrack?.(event);
      };
      if (publish) await room.localParticipant.setMicrophoneEnabled(true);
      return room.name;
    },
    { token, url, publish }
  );
}

test("P1-01-AC1/AC2: five rooms and another session isolate real SFU tracks", async ({
  browser,
}) => {
  const clients = [];
  try {
    for (const invitation of invitations) {
      const context = await browser.newContext({
        permissions: ["microphone", "camera"],
      });
      const page = await context.newPage();
      clients.push({ context, page, invitation });
      await harness(page);
      const token = await grant(page, invitation);
      const claims = await new TokenVerifier(key, secret).verify(token);
      expect(claims.sub).toBe(invitation.identity);
      expect(claims.video).toMatchObject({
        room: invitation.providerRoom,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishSources: ["microphone", "camera"],
        canPublishData: false,
        roomAdmin: false,
        roomRecord: false,
      });
      expect(await connect(page, token)).toBe(invitation.providerRoom);
    }
    for (const { page, invitation } of clients) {
      const expected = invitations
        .filter(
          (entry) =>
            entry.providerRoom === invitation.providerRoom &&
            entry.identity !== invitation.identity
        )
        .map((entry) => entry.identity);
      await expect
        .poll(() =>
          page.evaluate(() => [...window.probeRoom.remoteParticipants.keys()])
        )
        .toEqual(expected);
      if (expected.length) {
        await expect
          .poll(() =>
            page.evaluate(async () => {
              const peer = [...window.probeRoom.remoteParticipants.values()][0];
              const track = [...peer.audioTrackPublications.values()][0]?.track;
              const stats = await track?.getRTCStatsReport();
              return stats
                ? [...stats.values()].some(
                    (row) => row.type === "inbound-rtp" && row.bytesReceived > 0
                  )
                : false;
            })
          )
          .toBe(true);
      }
    }
    const main = clients[0];
    const received = () =>
      main.page.evaluate(async () => {
        const manager = window.probeRoom.engine.pcManager;
        const reports = await Promise.all([
          manager?.subscriber?.getStats(),
          manager?.publisher.getStats(),
        ]);
        return {
          rawTracks: window.probeReceivedTracks,
          inbound: reports
            .flatMap((report) => (report ? [...report.values()] : []))
            .filter((row) => row.type === "inbound-rtp")
            .map((row) => ({
              id: row.id,
              ssrc: row.ssrc,
              track: row.trackIdentifier,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        };
      });
    const authorizedMedia = await received();
    expect(authorizedMedia.rawTracks).toHaveLength(1);
    expect(authorizedMedia.inbound).toHaveLength(1);
    for (const foreign of [clients[2], clients[10]]) {
      const trackSid = await foreign.page.evaluate(
        () =>
          [
            ...window.probeRoom.localParticipant.audioTrackPublications.values(),
          ][0].trackSid
      );
      // Deliberately bypass the normal UI/SDK room list to attack the SFU boundary.
      await main.page.evaluate(async (trackSid) => {
        await window.probeRoom.engine.client.sendUpdateSubscription({
          trackSids: [trackSid],
          subscribe: true,
          participantTracks: [],
        } as unknown as Parameters<
          Room["engine"]["client"]["sendUpdateSubscription"]
        >[0]);
      }, trackSid);
      await main.page.waitForTimeout(2000);
      expect(await received()).toEqual(authorizedMedia);
      await expect
        .poll(() =>
          main.page.evaluate(() => [
            ...window.probeRoom.remoteParticipants.keys(),
          ])
        )
        .toEqual(["main-2"]);
    }
    const state = await provider.listRooms(
      invitations.map((entry) => entry.providerRoom)
    );
    expect(state).toHaveLength(6);
    expect(state.every((room) => !room.activeRecording)).toBe(true);
  } finally {
    for (const { context } of clients) await context.close();
  }
});

test("P1-01-AC2: mismatched invitations and tampered/expired initial grants are rejected", async ({
  page,
}) => {
  const invitation = invitations[0];
  for (const override of [{ session: "b" }, { room: "breakout-1" }]) {
    const response = await page.request.post("/api/probe/grant", {
      headers: { origin: "http://127.0.0.1:3101" },
      data: { ...invitation, ...override },
    });
    expect(response.status()).toBe(403);
  }
  const original = await grant(page, invitation);
  const parts = original.split(".");
  for (const room of [
    invitations[2].providerRoom,
    invitations[10].providerRoom,
  ]) {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    payload.video.room = room;
    const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[2]}`;
    await harness(page);
    await expect(connect(page, tampered, false)).rejects.toThrow();
    await page.evaluate(() => window.probeRoom.disconnect());
  }
  const expired = new AccessToken(key, secret, {
    identity: "expired",
    ttl: -120,
  });
  expired.addGrant({
    roomJoin: true,
    room: invitation.providerRoom,
    canPublish: true,
    canSubscribe: true,
  });
  await harness(page);
  await expect(connect(page, await expired.toJwt(), false)).rejects.toThrow();
  expect(
    (await provider.listParticipants(invitation.providerRoom)).some(
      (participant) => participant.identity === "expired"
    )
  ).toBe(false);
});

test("P1-01-AC2 limitation: active media survives initial-token expiry (D3 remains blocked)", async ({
  page,
}) => {
  const token = new AccessToken(key, secret, {
    identity: "expiry-observation",
    ttl: 2,
  });
  token.addGrant({
    roomJoin: true,
    room: invitations[0].providerRoom,
    canPublish: true,
    canSubscribe: true,
  });
  await harness(page);
  await connect(page, await token.toJwt());
  await page.waitForTimeout(18_000);
  expect(await page.evaluate(() => window.probeRoom.state)).toBe("connected");
  expect(
    (await provider.listParticipants(invitations[0].providerRoom)).find(
      (participant) => participant.identity === "expiry-observation"
    )?.tracks.length
  ).toBe(1);
  const afterExpiry = await page.evaluate(async () => {
    const track = [
      ...window.probeRoom.localParticipant.audioTrackPublications.values(),
    ][0].track;
    const bytes = async () => {
      const report = await track?.getRTCStatsReport();
      return report
        ? [...report.values()]
            .filter((row) => row.type === "outbound-rtp")
            .reduce((sum, row) => sum + row.bytesSent, 0)
        : 0;
    };
    const before = await bytes();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { before, after: await bytes() };
  });
  expect(afterExpiry.before).toBeGreaterThan(0);
  expect(afterExpiry.after).toBeGreaterThan(afterExpiry.before);
  await page.evaluate(() => window.probeRoom.disconnect());
});

test("P1-01-AC1: denied devices recover, camera is optional, explicit leave stops capture", async ({
  browser,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/probe/media");
  await page.context().clearPermissions();
  await page.context().grantPermissions([]);
  await page.getByRole("button", { name: "Check devices" }).click();
  await expect(page.getByRole("status")).toContainText("Device access denied");
  if (process.env.PROBE_RECORD === "1") await page.waitForTimeout(2000);
  await expect(
    page.getByRole("button", { name: "Join assigned room" })
  ).toBeDisabled();
  await page.context().grantPermissions(["microphone", "camera"]);
  await page
    .getByLabel("Invitation", { exact: true })
    .fill(invitations[0].credential);
  await page.getByRole("button", { name: "Check devices" }).click();
  await expect(page.getByRole("status")).toContainText("Devices ready");
  await page.getByRole("button", { name: "Join assigned room" }).click();
  await expect(page.getByRole("status")).toContainText("Connected to main");
  const context = await browser.newContext({
    permissions: ["microphone", "camera"],
  });
  try {
    const second = await context.newPage();
    await second.goto("/probe/media");
    await second
      .getByLabel("Invitation", { exact: true })
      .fill(invitations[1].credential);
    await second.getByLabel("Include camera").check();
    await second.getByRole("button", { name: "Check devices" }).click();
    await expect(second.getByRole("status")).toContainText("Devices ready");
    await second.getByRole("button", { name: "Join assigned room" }).click();
    await expect(second.getByRole("status")).toContainText("Connected to main");
    await expect(
      page.getByText("Other participants in this room: main-2", { exact: true })
    ).toBeVisible();
    if (process.env.PROBE_RECORD === "1") await page.waitForTimeout(2500);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Leave / stop devices" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Left media");
    if (process.env.PROBE_RECORD === "1") await page.waitForTimeout(1500);
    await expect
      .poll(async () =>
        (await provider.listParticipants(invitations[0].providerRoom)).map(
          (participant) => participant.identity
        )
      )
      .toEqual(["main-2"]);
    await second.getByRole("button", { name: "Leave / stop devices" }).click();
    expect(
      await second
        .locator("video")
        .evaluateAll((elements) =>
          elements.every((element) => !(element as HTMLVideoElement).srcObject)
        )
    ).toBe(true);
    await page.getByRole("button", { name: "Check devices" }).click();
    await expect(page.getByRole("status")).toContainText("Devices ready");
    await page.getByRole("button", { name: "Join assigned room" }).click();
    await expect(page.getByRole("status")).toContainText("Connected to main");
    await provider.removeParticipant(
      invitations[0].providerRoom,
      invitations[0].identity
    );
    await expect(page.getByRole("status")).toContainText("Disconnected");
    await expect(
      page.getByRole("button", { name: "Join assigned room" })
    ).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
