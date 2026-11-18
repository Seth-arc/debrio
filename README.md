# Debrio

Minimal Next.js application foundation. No account, workshop, media or hosted-provider integration is implemented yet.

## Run locally

Use Node **24.22.1**, npm **11.19.1**, Git and Docker Desktop (Linux containers) / Docker Engine with Compose v2. Use a trusted local development machine. No cloud account or secret is needed. On Windows PowerShell, use `npm.cmd` and `npx.cmd` if script execution policy blocks their `.ps1` shims.

```sh
npm ci --include=dev
npm run dev
```

Open http://127.0.0.1:3000. Stop with Ctrl+C. `.env.example` lists optional non-secret configuration; copying it to `.env.local` is optional. `GET /api/health` returns `{"status":"ok"}` with `Cache-Control: no-store`. This is application liveness, not database/provider readiness. Other HTTP write methods return 405.

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
- Do not add Supabase/LiveKit secrets yet: no code consumes them. `NEXT_PUBLIC_*` values are browser-visible.

These are configuration instructions, not a deployment receipt. Hosted providers, capacity, billing and media remain unverified.

Dependency review uses an expiring exception only for withdrawn advisory [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), still present in the npm feed on 18 November 2026. The maintainer must remove/review it by 18 December 2026. ESLint 9.39.5 is pinned because the current Next.js React/accessibility lint plugins do not yet accept ESLint 10; upgrade when their peer ranges support it. No vulnerable runtime package is exempted.
