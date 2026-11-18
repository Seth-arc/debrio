# Debrio

Minimal Next.js application foundation with an opt-in synthetic LiveKit media probe. Production accounts, workshops and media authorization are not implemented.

## Run locally

Use Node **24.22.1**, npm **11.19.1**, Git and Docker Desktop (Linux containers) / Docker Engine with Compose v2. Use a trusted local development machine. No cloud account or secret is needed. On Windows PowerShell, use `npm.cmd` and `npx.cmd` if script execution policy blocks their `.ps1` shims.

```sh
npm ci --include=dev
npm run dev
```

Open http://127.0.0.1:3000. Stop with Ctrl+C. Leave `NODE_ENV` unset so Next.js selects development/production for each command (PowerShell: `Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue`). `.env.example` lists optional non-secret configuration; copying it to `.env.local` is optional. `GET /api/health` returns `{"status":"ok"}` with `Cache-Control: no-store`. This is application liveness, not database/provider readiness. Other HTTP write methods return 405.

## Verify

```sh
npm run check
npm run test:guards
npm test
npm run db:start
npm run db:reset
npm run test:db
npm run build
npx playwright install chromium
npm run test:browser
npm run db:stop
npm run security:dependencies
```

`check` runs formatting, ESLint (including security rules), strict TypeScript and focused unit tests. `test:guards` temporarily breaks the health response, requires the unit test to fail, and restores the exact source in `finally`; run it in an idle checkout, not during editing. The following `npm test` verifies recovery. Browser tests start and stop the production server on loopback port 3100 themselves; they check keyboard navigation, accessibility, layout, console/network errors, health and rejected writes. CI installs Chromium's Linux system dependencies too.

`db:start` runs only a disposable Supabase PostgreSQL instance bound to `127.0.0.1`. The published password in `compose.yaml` belongs only to this disposable local database, never to a hosted project. `db:reset` **erases this local database** and rebuilds the pinned image's Supabase platform schema. There are no application migrations yet; add and exercise their apply procedure when the first product schema is introduced. pgTAP checks the real Supabase test harness, not future application permissions. `db:stop` stops this project's containers and removes its disposable data. Don't run two checkouts' database commands simultaneously: both use Compose project `debrio-foundation` and port 54322. Hosted project versions/configuration must be verified before hosted migrations.

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
- Required environment variables for this foundation: **none**. Optional: `NEXT_TELEMETRY_DISABLED=1`.
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

**Blocking limitation:** [LiveKit token expiry](https://docs.livekit.io/frontends/reference/tokens-grants/) applies to initial joins; it does not terminate active media or subsequent reconnects. The suite explicitly demonstrates the active-expiry limitation. The accepted 15-second server-enforced authorization bound remains unproven. Passing this suite is not a completed P1-01/media gate or permission to deploy the probe.

The D3 investigation also simulates an unavailable management API while two browser clients retain their media connection. Raw receiver audio bytes continue beyond 15 seconds; a subsequent successful `RemoveParticipant` stops that local sample. Measurements are written to ignored `.artifacts/media-probe/d3-investigation.json`. This demonstrates why a polling worker that depends on the same API is insufficient. LiveKit's [public response about management failures](https://community.livekit.io/t/technical-clarification-livekit-cloud-build-media-cutoff-and-token-revocation/2471) describes no supported independent active-session cutoff. Retaining the strict deadline requires a validated media enforcement design; this probe does not change the accepted requirement or select a replacement provider.

The owner retained D3. The proposed next qualification candidate is [Agora AccessToken2](https://docs.agora.io/en/realtime-media/rtc/build/authenticate-users/deploy-token-server), which documents active channel-privilege expiry and [in-call renewal](https://api-ref.agora.io/en/video-sdk/web/4.x/interfaces/iagorartcclient.html#renewtoken). Server enforcement against an untrusted client, cutoff timing, short-lifetime renewal, revocation/replay behavior and account allowances remain unverified. Daily's [token-ejection settings](https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token.md) remain a reserve option pending active-renewal evidence. Custom enforcement inside an SFU or unavoidable media gateway adds operational and security responsibility. No replacement is selected or installed, no hosted test was run, and no provider has passed D3. The detailed comparison and qualification conditions remain in the local P1-01 specification.

Normal cleanup deletes only this run's room names, verifies their absence, stops the local SFU, removes invitations and writes `.artifacts/media-probe/receipt.json`. If the runner is forcibly killed, stop its app process and run `docker compose -f compose.media-probe.yaml down`; confirm no task container remains before removing the stale `.artifacts/media-probe/run.lock` and invitation/assignment files. This fixture has no volumes or retained media. CI also stops the SFU in an unconditional cleanup step. Synthetic videos and private evidence remain local and ignored.
