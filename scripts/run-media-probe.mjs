import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, writeFile, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { RoomServiceClient } from "livekit-server-sdk";

const directory = ".artifacts/media-probe";
const monitoring = process.argv.includes("--monitor");
const existing = spawnSync(
  "docker",
  ["compose", "-f", "compose.media-probe.yaml", "ps", "--all", "--quiet"],
  { encoding: "utf8" }
);
if (existing.error || existing.status !== 0)
  throw new Error("Docker is unavailable");
if (existing.stdout.trim())
  throw new Error(
    "A media probe container already exists. Stop its owning run before starting another."
  );
await mkdir(directory, { recursive: true });
const lock = await open(`${directory}/run.lock`, "wx");
const started = Date.now();
const expiresAt = started + 10 * 60_000;
const runId = `p101-${randomBytes(8).toString("hex")}`;
const invitations = [
  "main",
  "breakout-1",
  "breakout-2",
  "breakout-3",
  "breakout-4",
].flatMap((room) =>
  [1, 2].map((number) => ({
    session: "a",
    room,
    identity: `${room}-${number}`,
    providerRoom: `${runId}-a-${room}`,
    credential: randomBytes(32).toString("hex"),
  }))
);
invitations.push({
  session: "b",
  room: "main",
  identity: "other-session",
  providerRoom: `${runId}-b-main`,
  credential: randomBytes(32).toString("hex"),
});
const rooms = [...new Set(invitations.map((entry) => entry.providerRoom))];
const env = {
  ...process.env,
  NODE_TLS_REJECT_UNAUTHORIZED: "1",
  NODE_ENV: "production",
  MEDIA_PROBE_ENABLED: "1",
  MEDIA_MONITOR_PROBE: monitoring ? "1" : "0",
  MEDIA_PROBE_ORIGIN: "http://127.0.0.1:3101",
  LIVEKIT_URL: "ws://127.0.0.1:7880",
  LIVEKIT_API_KEY: "probe-local",
  LIVEKIT_API_SECRET: "synthetic-local-fixture-not-a-cloud-key",
};
const client = new RoomServiceClient(
  env.LIVEKIT_URL,
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
  { requestTimeout: 3, failover: false }
);
let child;
let timer;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  child?.kill();
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
function compose(...args) {
  const result = spawnSync(
    "docker",
    ["compose", "-f", "compose.media-probe.yaml", ...args],
    { stdio: "inherit" }
  );
  if (result.error || result.status !== 0)
    throw new Error("Local probe Docker operation failed");
}
try {
  await writeFile(
    `${directory}/invitations.json`,
    JSON.stringify(invitations, null, 2),
    { mode: 0o600 }
  );
  await writeFile(
    `${directory}/assignments.json`,
    JSON.stringify({
      expiresAt,
      assignments: invitations.map(({ credential, ...entry }) => ({
        ...entry,
        hash: createHash("sha256").update(credential).digest("hex"),
      })),
    }),
    { mode: 0o600 }
  );
  if (monitoring) {
    // Deterministic synthetic camera; no physical device or downloaded media.
    await writeFile(
      `${directory}/camera.y4m`,
      Buffer.concat([
        Buffer.from("YUV4MPEG2 W320 H240 F10:1 Ip A1:1 C420\n"),
        ...Array.from({ length: 10 }, (_, frame) =>
          Buffer.concat([
            Buffer.from("FRAME\n"),
            Buffer.alloc(320 * 240, 40 + frame * 15),
            Buffer.alloc((320 * 240) / 2, 128),
          ])
        ),
      ])
    );
    const actors = invitations.map((entry) => ({
      ...entry,
      role: "participant",
      name: `Test ${entry.identity}`,
    }));
    for (const role of ["facilitator", "operator"])
      actors.push({
        session: "a",
        room: "main",
        identity: role,
        providerRoom: `${runId}-a-main`,
        credential: randomBytes(32).toString("hex"),
        role,
        name: role === "facilitator" ? "Facilitator Ada" : "Test operator",
      });
    await writeFile(
      `${directory}/monitor-invitations.json`,
      JSON.stringify(actors),
      { mode: 0o600 }
    );
    await writeFile(
      `${directory}/monitor-fixture.json`,
      JSON.stringify({
        expiresAt,
        assignments: actors.map(({ credential, ...entry }) => ({
          ...entry,
          hash: createHash("sha256").update(credential).digest("hex"),
        })),
      }),
      { mode: 0o600 }
    );
    await writeFile(
      `${directory}/monitor-state.json`,
      JSON.stringify({
        next: 0,
        assignedRoom: "main",
        revoked: false,
        controlFailure: false,
        route: null,
        work: [],
        events: [],
      }),
      { mode: 0o600 }
    );
  }
  compose("up", "-d", "media");
  let available = false;
  for (let attempt = 0; attempt < 30 && !interrupted; attempt++) {
    try {
      await client.listRooms([]);
      available = true;
      break;
    } catch {
      await delay(500);
    }
  }
  if (!available || interrupted)
    throw new Error("Local media provider did not become available");
  for (const name of rooms) {
    if (interrupted) throw new Error("Probe interrupted before launch");
    await client.createRoom({
      name,
      maxParticipants: monitoring ? 3 : 2,
      emptyTimeout: 600,
      departureTimeout: 600,
    });
  }
  if (interrupted) throw new Error("Probe interrupted before launch");
  const testing = process.argv.includes("--test");
  console.log(
    `Synthetic local run ${runId}; expires ${new Date(expiresAt).toISOString()}. Cloud usage: zero.`
  );
  console.log(
    `Private invitations: ${directory}/${monitoring ? "monitor-invitations" : "invitations"}.json (do not publish).`
  );
  if (!testing)
    console.log(
      `Open http://127.0.0.1:3101/probe/${monitoring ? "monitor" : "media"}; Ctrl+C ends this run and removes its rooms.`
    );
  child = spawn(
    process.execPath,
    testing
      ? [
          "node_modules/@playwright/test/cli.js",
          "test",
          "--config=playwright.media.config.ts",
          ...(monitoring ? ["monitor.spec.ts"] : ["rooms.spec.ts"]),
          ...(process.env.PROBE_RECORD === "1"
            ? ["--grep", monitoring ? "monitor demo" : "denied devices recover"]
            : []),
        ]
      : [
          "node_modules/next/dist/bin/next",
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          "3101",
        ],
    { env, stdio: "inherit" }
  );
  timer = setTimeout(interrupt, Math.max(0, expiresAt - Date.now()));
  const [code] = await once(child, "exit");
  if ((!interrupted && code !== 0) || (testing && interrupted))
    process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  clearTimeout(timer);
  child?.kill();
  const removed = [];
  let cleanupError = false;
  for (const name of rooms) {
    try {
      await client.deleteRoom(name);
      removed.push(name);
    } catch {
      cleanupError = true;
    }
  }
  let remaining;
  try {
    remaining = (await client.listRooms(rooms)).map((room) => room.name);
  } catch {
    cleanupError = true;
  }
  try {
    compose("down");
  } catch {
    cleanupError = true;
  }
  await writeFile(
    `${directory}/receipt.json`,
    JSON.stringify(
      {
        runId,
        started,
        ended: Date.now(),
        expiresAt,
        rooms,
        removed,
        remaining,
        cleanupError,
        cloudUsage: 0,
        server: "1.13.11",
        mode: monitoring
          ? "P1-02 local monitoring fixture; hosted revocation/replay and physical-device proof excluded"
          : "P1-01 local fixture; Cloud/device proof excluded",
      },
      null,
      2
    )
  );
  await rm(`${directory}/assignments.json`, { force: true });
  await rm(`${directory}/invitations.json`, { force: true });
  if (monitoring) {
    await rm(`${directory}/camera.y4m`, { force: true });
    await rm(`${directory}/monitor-invitations.json`, { force: true });
    await rm(`${directory}/monitor-fixture.json`, { force: true });
  }
  await lock.close();
  await rm(`${directory}/run.lock`);
  if (cleanupError || remaining?.length) {
    console.error(
      "Cleanup could not be fully verified; inspect local receipt and Docker state."
    );
    process.exitCode = 1;
  } else
    console.log(
      "All task rooms deleted; local SFU stopped. Receipt: .artifacts/media-probe/receipt.json"
    );
}
