import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AccessToken, TrackSource } from "livekit-server-sdk";

export type Assignment = {
  hash: string;
  identity: string;
  session: string;
  room: string;
  providerRoom: string;
};
export type ProbeFixture = { expiresAt: number; assignments: Assignment[] };

export function probeEnabled() {
  return process.env.MEDIA_PROBE_ENABLED === "1" && !process.env.VERCEL;
}

export function authorizeProbe(
  input: unknown,
  fixture: ProbeFixture,
  now = Date.now()
) {
  if (!input || typeof input !== "object" || now >= fixture.expiresAt) return;
  const { credential, session, room } = input as Record<string, unknown>;
  if (typeof credential !== "string" || !/^[a-f0-9]{64}$/.test(credential))
    return;
  const hash = createHash("sha256").update(credential).digest();
  return fixture.assignments.find(
    (entry) =>
      timingSafeEqual(hash, Buffer.from(entry.hash, "hex")) &&
      entry.session === session &&
      entry.room === room
  );
}

export async function issueProbeGrant(input: unknown) {
  if (!probeEnabled()) return;
  const fixture: ProbeFixture = JSON.parse(
    await readFile(".artifacts/media-probe/assignments.json", "utf8")
  );
  const assignment = authorizeProbe(input, fixture);
  if (!assignment) return;
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) throw new Error("Probe is not configured");
  const parsed = new URL(url);
  if (
    parsed.protocol !== "wss:" &&
    !(parsed.protocol === "ws:" && parsed.hostname === "127.0.0.1")
  ) {
    throw new Error("Secure provider transport required");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error("Invalid provider URL");
  const ttl = Math.min(30, Math.floor((fixture.expiresAt - Date.now()) / 1000));
  if (ttl < 1) return;
  const token = new AccessToken(apiKey, apiSecret, {
    identity: assignment.identity,
    ttl,
  });
  token.addGrant({
    room: assignment.providerRoom,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA],
    canPublishData: false,
    canUpdateOwnMetadata: false,
    roomAdmin: false,
    roomCreate: false,
    roomList: false,
    roomRecord: false,
    ingressAdmin: false,
    hidden: false,
    recorder: false,
    agent: false,
  });
  return {
    token: await token.toJwt(),
    url,
    identity: assignment.identity,
    room: assignment.room,
  };
}
