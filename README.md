# Debrio

Next.js application with host sign-in (email + password plus an authenticator app) and a personal workspace, backed by Supabase, plus an opt-in synthetic LiveKit media probe. Hosts can reset a forgotten password (email link plus authenticator) and change their password or email after a fresh authenticator code; email changes need confirmation from both addresses. Workshops, guests, the operator's authenticator reset and media authorization are not implemented yet.

## Run locally

Use Node **24.22.1**, npm **11.19.1**, Git and Docker Desktop (Linux containers) / Docker Engine with Compose v2. Use a trusted local development machine. No cloud account or secret is needed. On Windows PowerShell, use `npm.cmd` and `npx.cmd` if script execution policy blocks their `.ps1` shims.

```sh
npm ci --include=dev
npm run db:start
node scripts/local-supabase.ts > .env.development.local
npm run dev
```

`db:start` runs the disposable local Supabase stack (database, Auth, REST API and a mail catcher) and applies `supabase/migrations`. The last-but-one line writes the local Auth URL and public key for `npm run dev`; it contains no hosted value. Open http://127.0.0.1:3000 and create an account; confirmation emails appear in the local mail catcher at http://127.0.0.1:39324. Use any authenticator app (TOTP) for the second step. Without `SUPABASE_URL`/`SUPABASE_ANON_KEY`, the sign-in pages say sign-in isn't available. Stop with Ctrl+C. Leave `NODE_ENV` unset so Next.js selects development/production for each command (PowerShell: `Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue`). `.env.example` lists optional non-secret configuration; copying it to `.env.local` is optional. `GET /api/health` returns `{"status":"ok"}` with `Cache-Control: no-store`. This is application liveness, not database/provider readiness. Other HTTP write methods return 405.

## Verify

```sh
npm run check
npm run test:guards
npm test
npm run db:start
npm run db:reset
npm run test:db
npm run test:integration
npm run build
npx playwright install chromium
npm run test:browser
npm run db:stop
npm run security:dependencies
```

`check` runs formatting, ESLint (including security rules), strict TypeScript and focused unit tests. `test:guards` temporarily breaks the health response, requires the unit test to fail, and restores the exact source in `finally`; run it in an idle checkout, not during editing. The following `npm test` verifies recovery. Browser tests start and stop the production server on loopback port 3100 themselves; they check keyboard navigation, accessibility, layout, console/network errors, health, rejected writes, the full sign-up → authenticator → workspace → sign-out → sign-in journey, password reset that ends other devices' sessions, and two-address email change. Sign-in browser tests and `test:integration` need `npm run db:start` first. `test:integration` exercises real Auth tokens against the database policies: no MFA, other owners, forged owners/tokens and signed-out sessions are denied. CI installs Chromium's Linux system dependencies too.

`db:start` runs the disposable local stack from `compose.yaml`: Supabase PostgreSQL, Auth (GoTrue), PostgREST, a loopback-only gateway at `127.0.0.1:39321` and Mailpit at `127.0.0.1:39324`, using the Supabase CLI v3.2.0 image versions pinned by digest. Every port binds to `127.0.0.1`; ports sit below Windows' dynamic range, which can reserve the usual 543xx ports. The passwords and JWT secret in `compose.yaml` and `scripts/local-supabase.ts` belong only to this disposable stack, never to a hosted project. `db:start` then runs `scripts/db-migrate.mjs`, which applies each `supabase/migrations/<timestamp>_<title>.sql` once (each needs a `-- Title:` first line) and records it in `supabase_migrations.schema_migrations`. `db:reset` **erases all local data** and rebuilds. `db:stop` stops this project's containers and removes its disposable data. Don't run two checkouts' stacks simultaneously: both use Compose project `debrio-foundation` and the same ports. Hosted project versions/configuration must be verified before hosted migrations.

To reset generated application state, stop the app and run `npm run clean`, then `npm ci --include=dev` and `npm run build`. To exercise production manually:

```sh
npm run build
npm run start
```

Open the same local URL and stop with Ctrl+C. Local hooks format staged files, typecheck and test. CI is authoritative: **Application checks** and **Security checks** must pass. Secret scanning checks the tracked snapshot with Gitleaks 8.30.1. Use `npm run sbom` to print a CycloneDX dependency/license inventory; save evidence in ignored `.artifacts/`. No fonts, images or media assets are bundled; the page uses system fonts.

## Vercel settings

- Framework preset: **Next.js**; root directory: **.**
- Node.js: **24.x**; install: `npm ci --include=dev`; build: `npm run build`.
- Output directory: leave the framework default override **off**. Do not set `out`.
- Environment variables: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (server-only; never `NEXT_PUBLIC_*`) enable sign-in. Without them the app runs and sign-in pages say sign-in is unavailable. Optional: `NEXT_TELEMETRY_DISABLED=1`. Hosted Auth settings (email confirmation, 12-character minimum password, TOTP MFA, redirect allow-list, SMTP and rate limits) must match before use; none are configured by this repository.
- Keep the media probe disabled on Vercel; its routes return 404 there. `NEXT_PUBLIC_*` values are browser-visible and must never contain administrative secrets.

These are configuration instructions, not a deployment receipt. Hosted providers, capacity, billing and media remain unverified.

Dependency review uses an expiring exception only for withdrawn advisory [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), still present in the npm feed on 18 November 2026. The maintainer must remove/review it by 18 December 2026. ESLint 9.39.5 is pinned because the current Next.js React/accessibility lint plugins do not yet accept ESLint 10; upgrade when their peer ranges support it. No vulnerable runtime package is exempted.

## P1-01 synthetic media probe

This is a local feasibility fixture, not production-ready conferencing. It uses official `livekit-client` 2.24.1 and `livekit-server-sdk` 2.20.0 (Apache-2.0), and a digest-pinned LiveKit server 1.13.11 (Apache-2.0). The accepted hosted candidate remains LiveKit Cloud; Cloud allowance, hosted behavior and two-physical-device audio proof are pending. No new infrastructure spending is authorized.

After installing dependencies and Chromium as above:

```sh
npm run build
npm run test:media
# Or run the interactive synthetic probe:
npm run probe:local
```

Only run one media probe at a time, including across checkouts. The runner starts a disposable SFU on loopback ports 7880/7881 and the app on port 3101, creates five rooms with two synthetic assignments each plus an isolated negative-test session, and ends after ten minutes or Ctrl+C. No Cloud endpoint or credentials are used. Open `http://127.0.0.1:3101/probe/media`; copy an invitation from ignored `.artifacts/media-probe/invitations.json` into its password field and select its exact session/room. Check devices, explicitly join, and leave to stop capture. Camera is optional. Permission denial has a retry path after changing browser device settings.

The server checks invitation hashes and fixed assignments before issuing scoped microphone/camera tokens. Administrative credentials stay on the server. Invitations expire with the run. `test:media` uses independent Chromium contexts and synthetic browser media against the real local SFU, including cross-room/session and initial-expiry negatives. Those tests do not prove headset intelligibility, real-device echo, Bluetooth, relay networks, Cloud limits or active authorization revocation.

**Blocking limitation:** [LiveKit token expiry](https://docs.livekit.io/frontends/reference/tokens-grants/) applies to initial joins; it does not terminate active media or subsequent reconnects. The suite explicitly demonstrates the active-expiry limitation. The owner subsequently retired the blanket 15-second media cutoff in revised D3. Explicit removal, stale-token fencing and truthful cleanup still need provider proof. Passing this suite is not a completed P1-01/media gate or permission to deploy the probe.

The D3 investigation also simulates an unavailable management API while two browser clients retain their media connection. Raw receiver audio bytes continue beyond 15 seconds; a subsequent successful `RemoveParticipant` stops that local sample. Measurements are written to ignored `.artifacts/media-probe/d3-investigation.json`. This demonstrates why a polling worker that depends on the same API is insufficient. LiveKit's [public response about management failures](https://community.livekit.io/t/technical-clarification-livekit-cloud-build-media-cutoff-and-token-revocation/2471) describes no supported independent active-session cutoff. This historical test is retained as an observation, not a requirement to reintroduce the retired deadline. It does not select a replacement provider.

The following historical experiment investigated the former D3 timing rule. [Agora AccessToken2](https://docs.agora.io/en/realtime-media/rtc/build/authenticate-users/deploy-token-server) was investigated because it documents active channel-privilege expiry and [in-call renewal](https://api-ref.agora.io/en/video-sdk/web/4.x/interfaces/iagorartcclient.html#renewtoken). The opt-in experiment below does not select a replacement provider. A measured sample is not a worst-case guarantee or complete D3 proof. Neither a new provider nor custom media-server hosting is selected.

Normal cleanup deletes only this run's room names, verifies their absence, stops the local SFU, removes invitations and writes `.artifacts/media-probe/receipt.json`. If the runner is forcibly killed, stop its app process and run `docker compose -f compose.media-probe.yaml down`; confirm no task container remains before removing the stale `.artifacts/media-probe/run.lock` and invitation/assignment files. This fixture has no volumes or retained media. CI also stops the SFU in an unconditional cleanup step. Synthetic videos and private evidence remain local and ignored.

## Agora expiry qualification (local operator only)

This separate CLI uses pinned `agora-rtc-sdk-ng` 4.24.10 (MIT) and `agora-token` 2.0.7 (ISC), both development dependencies. It uses the official token package's pinned AccessToken2 implementation to omit video/data privileges entirely. It serves no production route and is refused on CI/Vercel. The App Certificate remains in Node; only a short-lived, exact-channel/identity token reaches each browser. The synthetic issuer is not production admission or revocation logic.

Use an isolated certificate-authenticated Agora Free project with remaining allowance, Co-host token authentication enabled, and Cloud Recording, Real-Time Speech-to-Text and Media Push disabled. Verify the account's no-spend boundary before **each** run. Put `AGORA_APP_ID` and `AGORA_APP_CERTIFICATE` in an ignored `.env.local` file; never use `NEXT_PUBLIC_` for the certificate. After `npm ci --include=dev` and installing Chromium, from this checkout in PowerShell:

```powershell
$env:AGORA_PROBE_CONFIRMED='1'
try {
  npm.cmd run probe:agora -- 'C:\path\to\ignored\.env.local' --check
  # Only after the check succeeds and the provider allowance/settings are confirmed:
  npm.cmd run probe:agora -- 'C:\path\to\ignored\.env.local'
} finally {
  Remove-Item Env:AGORA_PROBE_CONFIRMED
}
```

`--check` validates configuration without provider calls. A hosted run tests incorrect room/identity and expired joins, then two independent Chromium clients exchange generated oscillator audio. No physical microphone/camera is opened and nothing plays through speakers. After audio warmup, both clients receive identical teardown guards for the entire comparison. The pinned SDK's client leave/reset, gateway leave/reset, signal close, WebSocket close and selected local transport/track operations are resisted. Missing private SDK hooks fail setup. **WebSocket sends, heartbeats and renewal traffic remain allowed.**

The matched control renews ten-second privileges every five seconds for 25 seconds. It requires both audio directions to grow across every sampled one-second window, active signalling and no SDK disconnect. Without changing the guards, renewal is then withheld from one client while the other continues. Both raw RTP receivers are sampled through twenty seconds from last authorization. Continued outbound RTP and retained inbound statistics are required; missing statistics or a failed control are inconclusive. No removal request is made. Receipts distinguish the control/expiry sample results from the overall `verdict`: a measured deadline violation is `Fail`; passing samples without authoritative server/timing evidence remain `Unverified`. Growth confined to the sampling interval crossing fifteen seconds, missing samples or counter resets is `Unverified`; failure requires growth between observations begun wholly after the deadline.

This corrects the earlier experiment's confound: blocking all WebSocket sends also blocks signalling and cannot support a matched renewing control. Selected private hooks still do not constitute an independent hostile protocol implementation. [Agora's token guide](https://docs.agora.io/en/realtime-media/rtc/build/authenticate-users/deploy-token-server#buildtokenwithuidandprivilege) describes removal after join-privilege expiry, while the [Web SDK reference](https://api-ref.agora.io/en/video-sdk/web/4.x/interfaces/iagorartcclient.html#renewtoken) describes SDK disconnection without renewal. The reviewed pages do not specify a maximum enforcement delay, clock/grace allowance or guarantee against a non-cooperative client. Provider confirmation remains required before treating this as a supported 15-second bound.

The run has at most two concurrent clients and a ten-minute browser-process watchdog; normal execution takes roughly a minute. Ctrl+C stops the owned browser. Normal cleanup leaves channels, closes contexts, kills the owned browser process and stops the loopback server. It writes a secret-free receipt and silent synthetic browser video under ignored `.artifacts/P1-01/agora-<run>/`. Read the receipt's cleanup fields and reconcile actual usage/remaining participants in the Agora dashboard. The receipt's participant-minute upper bound is an estimate, not a billing receipt or proof that the provider has removed all resources. If forcibly killed, stop only the run's browser before removing `.artifacts/P1-01/agora-run.lock`. Never run probes concurrently across checkouts.

Hosted experiments are manual and never run in CI; CI tests the issuer and runner gates offline. A passing sample does not prove worst-case timing/clock skew, all hostile clients, failover, explicit revocation and replay fencing, receive-only publish denial, five-room Agora isolation, other media paths or two-device audible continuity. Explicit revocation/replay fencing, room isolation and real-device proof remain qualification gates; P1-01 is incomplete. The former autonomous-cutoff timing requirement is retired. No production deployment or provider migration is implied.

## P1-02 local monitoring prototype

The owner authorized this synthetic prototype while the media prerequisite remains incomplete. Reuse the installation above, then run:

```sh
npm run build
npm run test:monitor
# Interactive local fixture, stopped with Ctrl+C:
npm run probe:monitor
```

Open `http://127.0.0.1:3101/probe/monitor`. The runner writes private invitations to `.artifacts/media-probe/monitor-invitations.json`. Use separate browser contexts for the facilitator, operator and synthetic participants. Match the invitation's session and assigned room. Join participants first, then exercise Listen, Speak, Join, Return to main, Scan and Stop. Speak continues until Stop/switch; it is an explicit toggle, not push-to-talk. Enable audio if the browser blocks playback. Manual capture requires explicitly permitted test devices/audio; the automated tests use Chromium's fake audio and a generated, looping grayscale Y4M camera fixture only. No downloaded media is used.

The issuer requires rendered named notice acknowledgements before issuing a facilitator room token. Publishers start with default-deny subscription permissions and allow the current monitor only acknowledged microphone tracks for Listen/Speak, plus camera for Join. LiveKit enforces these publisher allowlists against modified subscribers. Late publishers remain protected until their own notice acknowledgement; new tracks need an allowlist update. A compromised publisher can share its own media, and this cannot force a compromised screen to display a notice. The original P1-01 grant endpoint is disabled during monitoring runs.

Stop closes local capture/playback and asks the server to remove the active route. A new route waits for confirmed absence of the old participant. Route-changing commands carry a monotonic expected revision; delayed commands and old-tab cleanup cannot replace or close a newer route. The operator can inject a control failure or revoke facilitator authority. Control loss automatically attempts cleanup and shows an uncertain notice. Failed cleanup stays visible and blocks transfers until Retry Stop succeeds. Ordinary participants may continue during a control outage; the facilitator stops monitoring. Device/network loss requires explicit rejoin and does not automatically restart the microphone.

Synthetic saved text uses expected revisions and a flushed, atomically replaced local JSON file, independently of media state. Refresh/reconnect reloads acknowledged work. Save-in-progress is visible; newer edits remain unsaved when an earlier acknowledgement arrives. This is a single-process, disposable fixture, not production persistence. Starting another run resets it; preserve needed synthetic evidence first. There are no schema/data migrations. The runner limits execution to ten minutes, deletes owned rooms and invitation files, stops the local SFU and records cleanup in `.artifacts/media-probe/receipt.json`. It retains only synthetic work/events in `monitor-state.json`. Do not run two media probes simultaneously.

The route and API are disabled by default and on Vercel. CI runs the local synthetic suite without provider secrets. **Cached self-hosted tokens can rejoin after removal**, and a test preserves that limitation. Hosted and physical-device results must be recorded separately; this probe is not production acceptance. Videos stay local. To remove this prototype, revert its scoped commits; no production data migration is involved.

### Bounded LiveKit Cloud and Android qualification

Use a test-only LiveKit Cloud project with sufficient unused allowance and no running/automatically dispatched agents. The runner does not request recording, egress or transcription. It accepts only an exact `wss://<project>.livekit.cloud` URL and refuses CI/Vercel. Put the three `LIVEKIT_*` credentials in an ignored file. No account plan or production configuration is changed.

```powershell
node scripts/run-media-probe.mjs --monitor --cloud 'C:\path\to\.env.local' --check
$env:LIVEKIT_PROBE_CONFIRMED='1'
node scripts/run-media-probe.mjs --monitor --cloud 'C:\path\to\.env.local' --test
Remove-Item Env:LIVEKIT_PROBE_CONFIRMED
```

The ten-minute bound is six owned rooms with at most three clients each (180 participant-minutes maximum); actual automated use is much smaller. Reconcile billing separately. Initial tokens last 30 seconds. Cloud removal uses an explicit cutoff 30 seconds ahead, within LiveKit's documented 60-second clock tolerance, and always runs for absent identities too. The tests attempt original/refreshed-token re-entry within their validity, verify refreshed expiry fits the ten-minute revocation window, and use a raw client that ignores the application's Stop controls. Observed timings are samples, not worst-case guarantees.

Every issued room/identity is flushed to `.artifacts/media-probe/issued.jsonl` before its token is returned. Normal cleanup stops owned clients, revokes every ledger identity, deletes only owned rooms and writes a receipt. If interrupted forcibly or cleanup fails, preserve that ledger and receipt, stop only the owned processes, and reconcile/revoke those identities before another run. Room absence alone does not prove token revocation. Never delete the ledger to bypass the startup guard.

For a supervised Android check on another network, obtain the official Cloudflare `cloudflared` executable, verify its release SHA-256 and retain provenance locally. Run the interactive fixture with `--phone 'C:\path\to\cloudflared.exe'` instead of `--test`. The temporary Quick Tunnel reaches a restricted loopback proxy; only the monitoring page, static assets and bounded same-origin monitor requests pass. Read the temporary HTTPS URL from `.artifacts/media-probe/phone.json` and use it on both devices. Private invitations remain in `monitor-invitations.json`; they never belong in URLs or public evidence. Ctrl+C or the ten-minute deadline closes the tunnel and cleans up media resources. No physical audio is recorded.

Join the phone as a breakout participant and the computer as facilitator. With headphones, check Listen (phone heard, computer not transmitted), Speak (both directions), Stop (audio stops), switching rooms, microphone denial/recovery and reconnect with saved synthetic text. Record device/browser versions and what each person actually heard. Automated browsers cannot supply these physical observations.
