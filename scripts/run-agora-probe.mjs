import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, open, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { issueAgoraGrant } from "./agora-grant.mjs";

if (
  process.env.AGORA_PROBE_CONFIRMED !== "1" ||
  process.env.CI ||
  process.env.VERCEL
)
  throw new Error(
    "Hosted probe requires local operator confirmation of isolated project, remaining allowance, no paid overages and recording/transcription/Media Push disabled."
  );
const envPath = process.argv[2];
if (!envPath) throw new Error("Pass the ignored Agora environment-file path.");
// Operator-supplied local file; only the two named credentials are consumed.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const config = parseEnv(await readFile(envPath, "utf8"));
const appId = config.AGORA_APP_ID;
const certificate = config.AGORA_APP_CERTIFICATE;
const started = Date.now();
const runExpiresAt = started + 10 * 60_000;
const runId = "p101-" + randomBytes(8).toString("hex");
const channel = runId + "-a";
const directory = ".artifacts/P1-01/agora-" + runId;
const grantFor = (uid, publish = true) =>
  issueAgoraGrant({
    appId,
    certificate,
    channel,
    uid,
    publish,
    authorizedAt: Date.now(),
    runExpiresAt,
  });
grantFor(101);
if (process.argv.includes("--check")) {
  console.log("Configuration valid; no hosted calls made.");
  process.exit(0);
}
const asset = await readFile(
  "node_modules/agora-rtc-sdk-ng/AgoraRTC_N-production.js"
);
const helper = await readFile("scripts/agora-browser.js");
await mkdir(".artifacts/P1-01", { recursive: true });
const lockPath = ".artifacts/P1-01/agora-run.lock";
// Directory is a fixed evidence prefix plus a generated hexadecimal run ID.
// eslint-disable-next-line security/detect-non-literal-fs-filename
await mkdir(directory);
const lock = await open(lockPath, "wx");
const report = {
  runId,
  started,
  sdk: "4.24.10",
  tokenSdk: "2.0.7",
  authorization:
    "Owner authorized continuation on isolated Free project with Co-host enabled and optional media services off; actual usage reconciliation remains pending.",
  maxClients: 2,
  maxWallSeconds: 600,
  media: "synthetic oscillator audio only; no physical microphone or camera",
  samples: [],
  checks: {},
  cleanup: {},
  status: "running",
  verdict: "Unverified",
  limitations: [
    "Instrumented SDK is not an independently implemented hostile client.",
    "Pinned SDK leave/reset/close and selected media teardown are blocked identically in both phases; WebSocket sends and renewal traffic remain allowed.",
    "No Cloud worst-case timing guarantee, real devices, captions or revocation API proof.",
  ],
};
let browserServer;
let browser;
let watchdog;
let phase = "setup";
let interrupted = false;
const stop = () => {
  interrupted = true;
  void browserServer?.kill().catch(() => {});
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const html =
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>Debrio synthetic Agora probe</title><h1>Debrio: synthetic Agora qualification</h1><p>No microphone, camera or live participant recording.</p><p id="mode">Renewable ten-second permission</p><p id="state" role="status">Preparing</p><p id="bytes"></p><script src="/sdk.js"></script><script src="/probe.js"></script></html>';
const server = createServer((request, response) => {
  if (
    request.method !== "GET" ||
    request.headers.host !==
      server.address()?.address + ":" + server.address()?.port
  ) {
    response.writeHead(403).end();
    return;
  }
  const routes = new Map([
    ["/", ["text/html", html]],
    ["/sdk.js", ["text/javascript", asset]],
    ["/probe.js", ["text/javascript", helper]],
  ]);
  const route = routes.get(request.url);
  if (!route) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": route[0],
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "frame-ancestors 'none'",
  });
  response.end(route[1]);
});
const contexts = [];
const pages = [];
const grants = [];
const refresh = async (index) => {
  const grant = grantFor(index + 101);
  await pages
    .at(index)
    .evaluate((token) => window.probe.renew(token), grant.token);
  grants.splice(index, 1, grant);
};
const sample = async () => {
  const states = await Promise.all(
    pages.slice(0, 2).map((p) => p.evaluate(() => window.probe.sample()))
  );
  const observation = { at: Date.now(), phase, states };
  report.samples.push(observation);
  return observation;
};
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  assert(!interrupted, "Probe interrupted before browser launch");
  const browserEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|COMSPEC)$/i.test(
        key
      )
    )
  );
  browserServer = await chromium.launchServer({
    channel: "chromium",
    headless: true,
    env: browserEnv,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  assert(
    !interrupted && Date.now() < runExpiresAt,
    "Probe interrupted or expired during browser launch"
  );
  watchdog = setTimeout(stop, Math.max(1, runExpiresAt - Date.now()));
  browser = await chromium.connect(browserServer.wsEndpoint());
  report.browser = browser.version();
  const url = "http://127.0.0.1:" + server.address().port;
  phase = "negative-joins";
  report.negativeJoins = [];
  for (const scenario of ["wrong-room", "wrong-identity", "expired"]) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.probe));
    const grant = grantFor(103, false);
    if (scenario === "wrong-room") grant.channel = runId + "-b";
    if (scenario === "wrong-identity") grant.uid = 102;
    if (scenario === "expired")
      await delay(Math.max(0, grant.expiresAt - Date.now() + 1500));
    const result = await page.evaluate(async (value) => {
      try {
        await window.probe.join(value);
        return { rejected: false };
      } catch (error) {
        return {
          rejected: true,
          code: /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : "OTHER",
          tokenReason:
            /invalid token|token expired|dynamic key expired|dynamic key or token timeout|TOKEN_EXPIRED|INVALID_TOKEN/i.test(
              error.message
            ),
        };
      }
    }, grant);
    report.negativeJoins.push({ scenario, ...result });
    await context.close();
    assert(
      result.rejected && result.tokenReason,
      "Need an explicit provider token rejection"
    );
  }
  for (let index = 0; index < 2; index++) {
    const context = await browser.newContext(
      index === 0
        ? {
            recordVideo: { dir: directory, size: { width: 1000, height: 600 } },
          }
        : {}
    );
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.probe));
  }
  phase = "join";
  console.log("Agora probe: joining two synthetic clients.");
  await Promise.all(
    pages.map(async (page, index) => {
      grants.splice(index, 1, grantFor(index + 101));
      await page.evaluate(
        (grant) => window.probe.join(grant),
        grants.at(index)
      );
    })
  );
  report.joinedAt = Date.now();
  phase = "warmup";
  const readyBy = Date.now() + 4000;
  while (!(await sample()).states.every((s) => s.inbound > 0)) {
    assert(
      Date.now() < readyBy,
      "Need bidirectional audio before instrumentation"
    );
    await delay(250);
  }
  await Promise.all([refresh(0), refresh(1)]);
  await Promise.all(pages.map((p) => p.evaluate(() => window.probe.resist())));
  phase = "control";
  report.controlStartedAt = Date.now();
  console.log(
    "Agora probe: matched control, teardown resisted and renewal/signalling allowed."
  );
  const renewUntil = Date.now() + 25_000;
  let nextRenew = Date.now() + 4000;
  while (Date.now() < renewUntil) {
    if (Date.now() >= nextRenew) {
      await Promise.all([refresh(0), refresh(1)]);
      nextRenew = Date.now() + 5000;
    }
    await sample();
    await delay(250);
  }
  const control = report.samples.filter((s) => s.phase === "control");
  for (const current of control) {
    const previous = control.findLast((s) => s.at <= current.at - 1000);
    if (previous)
      assert(
        current.states.every(
          (s, i) =>
            s.inboundRows > 0 &&
            s.inbound > previous.states.at(i).inbound &&
            s.outbound > previous.states.at(i).outbound
        ),
        "Control audio must keep flowing in both directions across each sampled one-second window"
      );
  }
  assert(
    control.every((s) =>
      s.states.every((state) => state.state === "CONNECTED" && state.guarded)
    ),
    "Renewal must not disconnect clients"
  );
  assert(
    control.at(-1).at - control[0].at >= 24_000,
    "Need sustained matched control"
  );
  assert(
    control
      .at(-1)
      .states.every(
        (s, i) => s.signallingSends > control[0].states.at(i).signallingSends
      ),
    "Signalling must remain active under instrumentation"
  );
  report.checks.matchedControl = "Pass";
  await refresh(0);
  await refresh(1);
  const lastAuthority = grants[0].authorizedAt;
  report.lastAuthorizedAt = lastAuthority;
  report.lastExpiry = grants[0].expiresAt;
  phase = "expiry";
  console.log(
    "Agora probe: withholding client 101 renewal with the same guards and signalling policy."
  );
  nextRenew = Date.now() + 5000;
  while (Date.now() < lastAuthority + 20_000) {
    if (Date.now() >= nextRenew) {
      await refresh(1);
      nextRenew = Date.now() + 5000;
    }
    await sample();
    await delay(250);
  }
  const deadline = lastAuthority + 15_000;
  const beforeDeadline = report.samples.findLast((s) => s.at <= deadline);
  const beyond = report.samples.filter((s) => s.at >= deadline);
  assert(beyond.length >= 2, "Need observations past the D3 deadline");
  assert(
    beyond.every((s) =>
      s.states.every(
        (state) => state.inboundRows > 0 && state.inbound > 0 && state.guarded
      )
    ),
    "Missing receive statistics are inconclusive, not a cutoff"
  );
  assert(
    beyond[0].states.every(
      (s, i) => beyond.at(-1).states.at(i).outbound > s.outbound
    ),
    "Both synthetic sources must keep sending after expiry"
  );
  report.checks.publishCutoff = beyond.every(
    (s) => s.states[1].inbound === beforeDeadline.states[1].inbound
  );
  report.checks.receiveCutoff = beyond.every(
    (s) => s.states[0].inbound === beforeDeadline.states[0].inbound
  );
  report.checks.expirySample =
    report.checks.publishCutoff && report.checks.receiveCutoff
      ? "Pass"
      : "Fail";
  if (report.checks.expirySample === "Fail") report.verdict = "Fail";
  assert(
    report.checks.publishCutoff && report.checks.receiveCutoff,
    "Media continued past the fifteen-second authorization bound"
  );
  // A passing sample supports further qualification; it cannot certify all hostile clients.
  report.status =
    "matched-control-and-cutoff-observed; authoritative server/timing guarantee Unverified";
} catch {
  report.status = "failed-or-inconclusive";
  report.failedPhase = phase;
  report.interrupted = interrupted;
  process.exitCode = 1;
  console.error(
    "Agora probe did not pass phase: " +
      phase +
      ". See private receipt; no SDK errors/tokens printed."
  );
} finally {
  report.clientEvidence = await Promise.all(
    pages.map((p) =>
      p.evaluate(() => window.probe.evidence()).catch(() => null)
    )
  );
  phase = "cleanup";
  for (const page of pages) {
    await Promise.race([
      page.evaluate(() => window.probe.leave()).catch(() => {}),
      delay(2000),
    ]);
  }
  await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  try {
    const video = pages[0]?.video();
    if (video) {
      await video.saveAs(directory + "/demo.webm");
      report.demo = "demo.webm";
    }
  } catch {
    report.demo = "unavailable";
  }
  await browser?.close().catch(() => {});
  await browserServer?.kill().catch(() => {});
  clearTimeout(watchdog);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  report.ended = Date.now();
  report.cleanup = {
    browserProcessExited: browserServer
      ? browserServer.process().exitCode !== null ||
        browserServer.process().signalCode !== null
      : true,
    localServerClosed: !server.listening,
    providerUsageReconciliation:
      "pending dashboard; no REST management credentials used",
  };
  if (!report.cleanup.browserProcessExited || !report.cleanup.localServerClosed)
    process.exitCode = 1;
  report.upperBoundAudioParticipantMinutes =
    Math.ceil((report.ended - started) / 60_000) * report.maxClients;
  // Output path uses only the generated run ID under the private evidence directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(directory + "/receipt.json", JSON.stringify(report, null, 2));
  await lock.close();
  await rm(lockPath);
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  console.log("Private receipt: " + directory + "/receipt.json");
}
