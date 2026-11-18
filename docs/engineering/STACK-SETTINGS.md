# Debrio stack settings and setup checklist

Prepared 17 November 2026. This is the configuration companion to the [accepted stack](STACK-PROPOSAL.md), [promptbook](PROMPTBOOK.md), [billing contract](BILLING.md) and [communications contract](COMMUNICATIONS.md). The PRD remains the product source of truth.

**Status, updated P0-02 on 18 November 2026:** user confirms Supabase and LiveKit projects exist in dashboards only, control of debrio.app DNS, and no location/language/data-residency constraints. Account plans/allowances, project configuration, DNS records and capacity have not been independently inspected. No application has been scaffolded. Nothing here authorizes purchases, deployment, live charges or sending messages. No new infrastructure spending is permitted. Existing subscriptions/credits are usable only within verified available allowances and terms. See [architecture](../../ARCHITECTURE.md) and [P0-02 decision/evidence register](../tasks/P0-02/spec.md).

Use `Unknown`, `Ready`, `Blocked` or `N/A with reason` in the readiness register. An unchecked box means proof is still required. Examples of URLs, resource names, environment variables and routes below are implementation conventions to adopt or reconcile during P0-02/P0-03, not existing endpoints or resources.

## 1. Ownership and account inventory

The platform owner supplies account access and business decisions through appropriate secure mechanisms. Engineering configures and verifies the agreed setup. Name a real person for ongoing operations before the pilot; a role label is not an on-call rota.

| Component | Record before setup | Task owner | Current status |
|---|---|---|---|
| GitHub | Repository owner, access, actual remote history/default branch, Actions/branch-rule availability | P0-01/P0-03 | Verified Seth-arc/debrio, main; P0-01 merged at b002e5a; application CI pending P0-03 |
| Vercel | Account/team, plan, available allowance, commercial-use eligibility, project and region | P0-02/P0-03/P5-02 | Unknown |
| Supabase | Organisation/project IDs, plan, regions, project slots, connection/storage/realtime quotas, recovery facilities | P0-02/P0-03/P5-02 | Dashboard project exists, user-confirmed; IDs/plan/settings unverified |
| LiveKit Cloud | Project, plan, region/routing options, media/worker/transcription limits and current usage | P0-02/P1-01 through P1-06 | Dashboard project exists, user-confirmed; IDs/plan/settings unverified; suitability conditional |
| Speech-to-text | Model/provider, access method, concurrency, processing/retention terms, available allowance | P1-05/P1-06 | Not selected |
| Postmark | Account/server/stream, sending eligibility, monthly allowance, verified sender/domain | P0-02/P2-01/P4-06 | Provider selected; account unknown |
| Stripe | Account country/selling entity, sandbox, live activation status, billing contact | P0-02/P6-03 | Unknown |
| Domain/DNS | Registrar, authoritative DNS provider, edit access, existing application/mail records | P0-02/P5-02 | User confirms control of `debrio.app`; records/provider/settings not inspected |
| Operations | Support owner/backup contact, published hours/timezone, incident destination, private evidence/backup locations | P5-02/P5-03/P7-02 | Unknown |

For each provider, record allowance reset/credit expiry, automatic billing behavior, available limits and what happens when capacity is exhausted. Budget alerts alone are not proof that charges cannot occur.

## 2. Environment separation

| Environment | Required boundary | Mail and payments | Data |
|---|---|---|---|
| Local development | Local Next.js and local Supabase test stack; no production credentials | Local mail sink and Stripe sandbox | Synthetic fixtures only |
| CI | Disposable test database/runtime; least-privilege workflow credentials | Mock/sandbox paths; no participant mail | Synthetic, reproducible fixtures |
| Preview/staging | Isolated test services/identities/storage; restricted access | Postmark test mode or explicitly authorized recipient allowlist; Stripe sandbox | Synthetic data and test media |
| Production/pilot | Explicitly authorized environment with verified limits and recovery | Approved live mail/Stripe configuration only | Data under agreed permissions/retention |

- [ ] Record actual origins: local example `http://localhost:3000`; proposed production origin `https://debrio.app`; staging origin TBD.
- [ ] Keep preview branches out of production databases, storage, media rooms, email recipients and Stripe accounts/keys.
- [ ] Do not automatically provision separate paid projects. If available accounts cannot provide adequate isolation, record the blocker.
- [ ] Keep environment-specific credentials in approved secret stores. `.env.example` contains names/placeholders only; local secret files and recordings are ignored by Git.
- [ ] Rehearsal must not send email, change real entitlements or retain live participant media.

## 3. Local development tools

Observed locally: `node`, `npm`, `git` and `docker` commands are available. Docker engine health, image availability and running services have not been checked. The `gh` command was not found; GitHub connector/browser workflows remain possible.

- [ ] Pin compatible Node, package-manager, Next.js and Supabase CLI versions in the repository; verify build/runtime support before choosing versions.
- [ ] Verify the Docker-compatible runtime can run the local database/Auth/Storage stack with sufficient disk and memory.
- [ ] Install project dependencies and browser-test binaries through the repository's locked tooling; record working commands in `COMMANDS.md` when created.
- [ ] Add Vitest, real database integration checks, Playwright, formatting, type checks and a reproducible build.
- [ ] Use synthetic fixtures, a local email sink and separate test identities/workspaces.
- [ ] Provide headset/microphone and independent browser/device clients for real media tests; silent test tracks do not prove usable audio.
- [ ] Every schema/data migration has a descriptive filename title and matching header, following [WORKFLOW.md](WORKFLOW.md#migration-titles).

The normal local Supabase stack uses a container runtime; install/pin the CLI using its supported project tooling. [Supabase local setup](https://supabase.com/docs/guides/local-development/cli/getting-started).

## 4. GitHub

| Setting | Required configuration |
|---|---|
| Repository identity | Verify `origin`, remote history and intended repository before any push; preserve the existing folder/remote name unless separately changed |
| Planning baseline | Review selected files, ignore secrets/generated output and establish the authorized baseline commit; do not assume an unborn local branch means an empty remote |
| Main branch | Record actual default branch; configure available protection/rules, required checks and review policy without bypasses |
| CI checks | Install from lockfile; formatting/type checks, focused tests, real-database integration, build and relevant browser checks; fail when required checks cannot run |
| Workflow access | Least privilege; scoped credentials; untrusted contributions cannot access deployment/payment secrets |
| Deployments | Treat push/CI, merge and deployment as distinct actions; preview must not activate production billing or touch customer data |
| Evidence | Private destination, explicit retention, redacted logs and synthetic demos; no large recordings or browser authentication state in Git |

Proof: a representative bad change fails CI, the corrected change passes on the exact commit, protected secrets are absent from logs, and task/release identity is traceable. [GitHub workflow security](https://docs.github.com/en/actions/reference/security/secure-use).

## 5. Vercel application hosting

### Build and environment handoff requested during P0-02

The current repository cannot build the Next.js product: its only package manifest is `demo/package.json`, containing `start` and `test`, with no Next.js dependency or build script. The user confirmed Supabase/LiveKit setup is dashboard-only. Connecting those projects to the repository does not create application code. Do not deploy the historical demo as the completed product. P0-03 must first scaffold and prove the build. No Vercel setting below is a claim that a command exists today.

For the proposed root-level Next.js application after P0-03:

| Vercel field | Setting |
|---|---|
| Framework Preset | **Next.js** |
| Root Directory | Repository root (`.`); only change if P0-03 deliberately locates the app elsewhere |
| Build Command | Keep framework default; P0-03 should supply the actual `build` script using `next build`, and verify the command in COMMANDS.md |
| Output Directory | **Leave override off**; Next.js normally builds `.next`. Do not set `out` for this server-backed app |
| Install Command | Keep detected package-manager default until P0-03 pins its lockfile; if npm is selected, verify `npm ci` there before using an override |
| Node.js Version | Match P0-03's tested package/runtime version; local Node version alone is not deployment proof |
| Development Command | Framework default after the app exists; not the demo's `node server.cjs` |
| Production branch | `main` once the app is merged and deployment is separately authorized; a task PR is not merge/deploy authority |

Current official references: [Next.js integration](https://vercel.com/docs/frameworks/full-stack/nextjs), [build configuration](https://vercel.com/docs/builds/configure-a-build), [environment settings](https://vercel.com/docs/environment-variables). Checked 18 November 2026. Prefer framework detection over a speculative `vercel.json`.

Set **only variables consumed by implemented code**, separately for Development/Preview/Production. Below are proposed names, matching section 12; P0-03 and feature tasks must align the actual code and `.env.example`. Copy values from the intended provider project into Vercel's secret UI, not this public repository or chat.

| Variable | Value source / intended use | Exposure |
|---|---|---|
| `APP_ORIGIN` | Actual HTTPS deployment origin; use `https://debrio.app` only after domain setup, and a separate preview/staging origin | Server config |
| `NEXT_PUBLIC_SUPABASE_URL` | Intended Supabase project's API URL | Browser-safe |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable API key; requires row policies | Browser-safe; never substitute a secret/service key |
| `SUPABASE_SECRET_KEY` | Supabase elevated key, only for implemented narrow privileged operations | Server secret |
| `DATABASE_URL` | Chosen pooled runtime connection, only if code uses direct SQL | Server secret |
| `LIVEKIT_URL` | Intended LiveKit project's WebSocket endpoint | Non-secret server config, supplied to authorized client when needed |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Matching project's signing credentials | Server only; never `NEXT_PUBLIC_*` |
| `POSTMARK_SERVER_TOKEN` | Intended application transactional server token | Server secret, when mail is implemented |
| `POSTMARK_MESSAGE_STREAM`, `MAIL_FROM`, `MAIL_REPLY_TO` | Verified stream/sender and monitored inbox | Server config, not yet verified |
| `POSTMARK_WEBHOOK_USERNAME`, `POSTMARK_WEBHOOK_PASSWORD` | Configured callback authentication | Server secrets, when callback exists |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Sandbox API key and that endpoint's signing secret | Server secrets; production values remain separately gated |
| `STRIPE_MONTHLY_PRICE_ID` | Server-allowlisted sandbox recurring Price after commercial acceptance | Server config; not invented for scaffolding |
| `JOB_DISPATCH_SECRET` | Dedicated authenticated scheduler secret shared with approved dispatch configuration | Server secret if D2 is accepted/implemented |

Keep `MIGRATION_DATABASE_URL` in the restricted migration/CI path rather than routine app requests. Postmark SMTP credentials belong in **Supabase Auth SMTP settings**, not public Vercel variables. Caption/STT secrets belong in the selected worker runtime. Owner account/workspace identifiers belong in protected server/database configuration only after identity verification. Do not invent secrets or use placeholders in a live deployment. Redeploy an authorized environment after changing its variables; verify Auth redirect allowlists, webhook origins and environment isolation together. Setting variables does not establish working integrations.

| Setting | Required configuration |
|---|---|
| Project | Connect the verified GitHub repository and actual application root; select the Next.js framework |
| Runtime/build | Pin the supported Node runtime and actual install/build commands; do not copy speculative commands into production |
| Region | Select with database placement, pilot geography and processing constraints; exact region TBD |
| Origins/domains | Canonical production origin and explicit staging origin; configure redirects consistently with Auth and Stripe return URLs |
| Variables | Separate Development, Preview and Production values; browser-safe public values only under `NEXT_PUBLIC_*` |
| Public callback routes | Stripe/Postmark endpoints must be reachable by their providers and authenticated by their own controls; preview protection must not silently break them |
| Execution | Short request handlers; no process-local authoritative workshop state or assumed work after a response. Caption-worker runtime remains separately verified |
| Releases | Test older live browser clients against new APIs/schema; defer incompatible releases until workshops end; test rollback after newer writes |
| Capacity/cost | Inspect current limits/allowances and billing controls; account for build/preview and production usage together |

Vercel documents environment-specific variables; changing settings requires verifying the resulting deployment uses the intended values. [Environment variables](https://vercel.com/docs/environment-variables).

**Commercial-use gate:** Vercel describes Hobby as personal/non-commercial. Verify an appropriate existing plan or arrangement for Debrio; do not assume free Hobby hosting covers this commercial SaaS. [Vercel pricing](https://vercel.com/pricing).

## 6. Supabase

### Database and access

- [ ] Record project URL/reference, region and environment owner.
- [ ] Apply version-controlled, titled migrations; no undocumented dashboard-only production schema changes.
- [ ] Enable and test row-level policies for exposed application tables; scope reads/writes by workspace, session, current role and grants.
- [ ] Keep elevated secret/service credentials server-side and narrowly used; their possession must not substitute for per-request user authorization.
- [ ] Use the appropriate connection mode for each process. Verify request-traffic pooling, connection limits and migration-tool compatibility independently; do not send every request through an unrestricted administrative connection.
- [ ] Use constraints/transactions for immutable submissions, retry identity, membership changes and atomic workshop admission.

Supabase distinguishes browser-safe publishable keys from elevated secret keys. Legacy key compatibility, if needed, must be explicit; elevated keys cannot be placed in browser configuration. [API keys](https://supabase.com/docs/guides/getting-started/api-keys). Connection/pooler choices depend on the client and workload. [Database connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

### Authentication

| Setting | Required configuration |
|---|---|
| Site URL | Actual canonical app origin for the environment |
| Redirect allowlist | Exact implemented callback/recovery routes for local, staging and production; restrict preview patterns, never an arbitrary external redirect |
| Host sign-in | Select/document the actual host login method in P2-01; test verification, recovery, reused/expired links and mail failure |
| Privileged MFA | Require second-factor assurance for platform operator, workspace owners and billing/data administrators; ordinary facilitator-only MFA optional; recommend TOTP as the initial method subject to implementation review |
| Enforcement | Check assurance server-side and in applicable database policies; enabling enrollment in a dashboard alone does not enforce Debrio's role policy |
| Recovery/changes | Verified recovery, sensitive-action reauthentication and old-session invalidation; test email/credential changes and role upgrades |
| Guests | Shared-link/lobby admission plus stable private identities; guest mechanism selected/tested independently from host accounts; no mandatory guest email/payment/MFA |
| Custom SMTP | Postmark configuration from section 8; Supabase retains token generation and validation |
| Abuse limits | Bound signup/login/recovery/invitation attempts; account for real pilot bursts without opening an unrestricted relay |

Use environment-specific redirect settings and verify the complete callback flow. [Auth redirects](https://supabase.com/docs/guides/auth/redirect-urls). Application MFA enforcement must check the authenticated assurance level, not merely factor existence. [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa).

### Storage, Realtime and recovery

- [ ] Private buckets for resources/video/captions with versioned ownership, upload validation, size/type limits and protected delivery. Final limits/source formats remain engineering settings to verify.
- [ ] Check current grant and release state for preview/download/playback; expiry of a signed URL alone must not be the complete revocation strategy.
- [ ] Private Realtime channels with workspace/session/group authorization; permission changes affect active subscriptions. Recover missed events from authoritative database state.
- [ ] Database and stored-object recovery are tested together; do not assume a database backup contains object bytes.
- [ ] Keep restored data quarantined until deletions, revocations, absolute expiry and current billing are reconciled; measure recovery time and potential data loss.
- [ ] Verify actual backup/export schedule, destination/access, retention and restore credentials; no purchased backup add-on is presumed.

Supabase recommends regular exports/off-site backups for free-tier projects and documents free-project inactivity pausing. Assess these against the required service and recovery experience. [Backups](https://supabase.com/docs/guides/platform/backups), [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

## 7. LiveKit and live captions

| Setting | Required configuration |
|---|---|
| Project | Environment-specific project/namespace and verified plan, allowances, concurrency and expiry |
| Credentials | Project URL plus server-held API key/secret; issue participant grants on the server after Debrio authorization |
| Identity/rooms | Stable participant mapping and unique workspace/session/room IDs; room membership remains separate from resource/group membership |
| Grants | Explicit room/publish/subscribe/screen permissions; monitor/announce routes cannot bridge unrelated audiences |
| Revocation | Active route cleanup plus tested bounded authorization freshness during control-service loss; do not depend only on token expiry |
| Network/devices | Test real networks/headsets and supported browsers, relay behavior, autoplay/device denial, reconnect and gallery load |
| Worker | Select supported runtime, deployment method, region, concurrency, cold-start behavior, dispatch and restart policy through P1-05/P1-06 |
| Speech-to-text | Select model/provider and either supported LiveKit inference or external-provider access; verify languages, caption quality/latency, concurrent streams and cost |
| Privacy | Disable live audio recording, retained transcripts and replay; inspect project settings, worker settings, logs and speech-provider retention, not just the application UI |
| Degradation | Show caption/media failure, preserve permitted written work and explicit task-only withdrawal; recovery cannot silently restore withdrawn access |

Server-held LiveKit key/secret pairs support signing scoped access tokens. [LiveKit keys](https://docs.livekit.io/reference/api/projects/keys/). Agent observability can retain transcripts/audio; explicitly configure the selected SDK/project to prevent this and verify generated artifacts. If using `AgentSession`, verify its current recording options rather than assuming defaults. [Session recording options](https://docs.livekit.io/reference/agents/session-recording-options/).

**Capacity checkpoint, checked 17 November 2026:** LiveKit's published Build limits include 100 connected participants (agents and end-users), five hosted agent sessions and five LiveKit Inference STT connections. Free allowances are shared across free projects. Recheck the actual dashboard before testing. Three 40-person workshops would exceed 100 human connections before staff/workers. The six-breakout pilot also requires a caption topology proven against stream/worker limits; a one-agent-per-room design cannot be assumed to fit. These observations do not select a different plan/provider or authorize spending. [Current quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/).

Proof: authorized multi-room media/captions, revocation under partial outage, announcements, screen handover, video interruption, no retained live media, exact pilot configuration and later three-workshop/cross-workspace load.

## 8. Postmark and email

| Setting | Required configuration |
|---|---|
| Server/environment | Record server and sending eligibility; isolate testing from production recipients and credentials |
| Stream | Use the appropriate transactional stream for Debrio's transactional-only scope; verify template/event classification with Postmark rather than enabling marketing |
| Sender | Verified sender/domain; proposed display name `Debrio`; actual From and monitored Reply-To addresses TBD |
| DNS | Copy provider-generated DKIM/Return-Path records; verify existing mail records and DMARC policy with the domain owner |
| Application API | Server-held sending token; minimal templates, scoped links, deduplication and bounded retry/reconciliation |
| Auth SMTP | `smtp.postmarkapp.com`, port `587`, TLS/STARTTLS; stream-scoped SMTP access key as username and secret key as password; set these in Supabase Auth, not browser variables |
| Tracking | Disable open/click tracking for the agreed privacy baseline; authentication links must not be altered in a way that breaks their flow |
| Callbacks | Authenticate HTTPS Postmark callbacks using documented protection, such as Basic Auth and provider IP allowlisting where supported; validate event/message/tenant association |
| Events | Delivery, bounce and spam-complaint handling; deduplicate by appropriate event identity, not solely a message ID that could suppress a different event type |
| Suppression | Respect bounce/complaint suppression; distinguish provider acceptance from delivery and never label delivery as a human read |
| Retention/limits | Record email content/activity retention, available monthly sends, rate limits and token rotation procedure |

SMTP credentials and transactional hostname must follow Postmark's supported settings. [SMTP guide](https://postmarkapp.com/developer/user-guide/send-email-with-smtp), [Supabase integration](https://postmarkapp.com/support/article/integrating-postmark-with-supabase-via-smtp). Postmark webhooks do not use Stripe's HMAC scheme; use its documented endpoint protection. [Webhook protection](https://postmarkapp.com/developer/webhooks/webhooks-overview).

Proof: authorized test-recipient delivery, Auth recovery, invalid/expired links, duplicate/ambiguous sends, cancellation/reschedule races, suppression and authenticated callback replay. A monitored support inbox is a separate requirement; selecting an email delivery provider does not establish a staffed mailbox.

## 9. Stripe

| Setting | Required configuration |
|---|---|
| Account | Record selling entity/country, account owner and verification status; sandbox first, live activation separately authorized |
| Product/Price | One complete monthly workspace plan; numeric price/currency and allowances accepted before implementation; no annual tier or automatic overage charges |
| Checkout | Server-selected allowed Price and workspace/customer mapping; duplicate-purchase prevention; individual buyers must not require fictitious company details |
| Portal | Authorized workspace billing administrators only; payment/invoice management and period-end cancellation consistent with policy |
| Tester offer | 100% discount, 30 days from redemption, no card, once per invited workspace, operator-approved extensions; restrict actual offers to approved invitees |
| Tester expiry | Explicit no-charge termination/transition; no automatic paid renewal, including accounts with a saved card. Coupon expiry alone is not this policy |
| Paid lifecycle | Seven-day failed-renewal grace, period-end cancellation and explicit access deadlines; retries/events cannot reset grace |
| Owner exemption | Trusted permanent entitlement only for verified owner account/designated workspace; no fabricated paid Stripe subscription or transferable customer-owner benefit |
| Webhooks | HTTPS endpoint, selected events/API version, endpoint signing secret, raw-body signature verification, durable acceptance and replay/reordering handling |
| Reconciliation | Recover missed events from authoritative Stripe state; a successful return URL alone does not grant paid access |
| Notifications | Assign each billing email to Stripe or Debrio/Postmark; avoid duplicate notices and keep participants out of billing audiences |
| Live prerequisites | Business verification, actual price/currency, refund/tax configuration and customer-facing contact information confirmed before activation |

Start in a sandbox; live services require activation/verification. [Stripe account setup](https://docs.stripe.com/get-started/account/set-up). Verify webhook signatures on the original request body, persist processing identity and test repeated/out-of-order events. [Stripe webhooks](https://docs.stripe.com/webhooks). Detailed lifecycle requirements and tests remain in [BILLING.md](BILLING.md).

## 10. Domain, DNS and application routes

- [ ] Verify registrar/authoritative DNS access for `debrio.app`; inventory current records first.
- [ ] Select canonical app and staging origins. Copy actual Vercel-provided DNS values; do not invent A/CNAME destinations.
- [ ] Verify HTTPS, canonical redirects and application/Auth/Stripe return origins together.
- [ ] Choose the sending subdomain/From/Reply-To and monitored support mailbox; examples such as `support@debrio.app` are not existing addresses.
- [ ] Add exact Postmark-provided verification/DKIM/Return-Path values. Preserve existing MX records; do not create duplicate SPF records or change DMARC enforcement blindly.
- [ ] Ensure necessary provider callbacks are reachable without public access to admin pages. Provider authentication still applies.

Routes to implement and record, with exact paths settled in code: Auth callback/recovery; Stripe webhook; Postmark webhook; health/readiness; authenticated background-job dispatch if the chosen scheduler uses HTTP. Return URLs come from trusted configuration, not unrestricted client input.

## 11. Durable jobs and operating settings

P0-02 proposes Supabase Cron/pg_net dispatch to a bounded Vercel handler; see [D2 and its limits](../../ARCHITECTURE.md#commands-acknowledgement-and-durable-reconciliation). Owner acceptance, extension/runtime configuration and actual allowance remain unverified. No runner has been provisioned.

| Setting | Required value or behavior |
|---|---|
| Work ownership | Persist intents with committed state for media reconciliation, email, billing reconciliation, expiry and deletion |
| Execution | Authenticated dispatcher; bounded batches/timeouts, lease/claim, retry/backoff, duplicate protection and recoverable failed-job state |
| Revalidation | Recheck latest permissions, schedule/version and expiry before acting; superseded jobs cannot restore old grants |
| Scheduling | Select cadence compatible with required deadlines and verified provider limits; do not confuse delayed cleanup with an extension of access |
| Workspace concurrency | Maximum **3 live workshops**; started sessions count during activity pauses/disconnection; atomic admission denies a fourth |
| Global admission | Separate measured system-wide cap and remaining provider headroom, including other workspaces/environments and credit expiry |
| Session lifetime | **4 hours from original Live start**; abandoned sessions end at that deadline without auto-submitting drafts |
| Retention | Session records **90 days after end**; reusable content **90-day recovery after entitlement ends**; independent clocks |
| Client summary | Invitation redemption **7 days**; verified grant **30 days**, bounded by earlier source expiry/revocation |
| Support | Published hours/timezone and incident/contact information; named live pilot coverage; no implied 24/7 response guarantee |
| Alerts | Save/dispatch failures, stale queues, auth/media/caption failures, billing drift, quota/headroom and backup/restore failure; redacted payloads |
| Incident proof | Actual authorized alert receipt, acknowledgement, runbook action and verified recovery before pilot readiness |
| Restore/release | Isolated restore of database/objects plus later deletion/revocation reconciliation; mixed-client deploy and rollback drills |

Read [SAAS-RELIABILITY-REVIEW.md](SAAS-RELIABILITY-REVIEW.md) for the complete failure matrix. Numeric retry, alert and recovery targets must be documented and measured before the corresponding gate, not silently treated as provider guarantees.

## 12. Proposed variable and secret inventory

These names are proposed Debrio conventions, not existing configuration. Implementation must keep code, `.env.example`, deployment settings and tests aligned. Set only variables consumed by the chosen implementation. Account-only settings such as Auth SMTP credentials need not be copied into application hosting.

| Name / value | Visibility and location | Purpose |
|---|---|---|
| `APP_ORIGIN` | Server configuration | Trusted canonical origin for links/returns |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe | Project API URL for this environment |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable key | Normal authenticated client access, still subject to policies |
| `SUPABASE_SECRET_KEY` | Server secret, only if required | Narrow privileged operations; never browser-bundled |
| `DATABASE_URL` | Server/CI secret, if direct SQL is used | Selected pooled application connection |
| `MIGRATION_DATABASE_URL` | Restricted CI/operator secret | Verified migration-compatible connection |
| `LIVEKIT_URL` | Non-secret project endpoint | Media connection; browser may receive approved endpoint |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Server/worker credentials | Grant signing/provider operations |
| Speech-provider credentials | Worker secrets, exact names TBD | Only if the selected STT route requires them |
| `POSTMARK_SERVER_TOKEN` | Server secret | Application email API |
| `POSTMARK_MESSAGE_STREAM`, `MAIL_FROM`, `MAIL_REPLY_TO` | Server configuration | Sending stream/identity |
| Postmark SMTP access/secret keys | Supabase Auth secret settings | Authentication email delivery |
| `POSTMARK_WEBHOOK_USERNAME`, `POSTMARK_WEBHOOK_PASSWORD` | Server/provider secrets | Callback authentication; never log credential-bearing URLs |
| `STRIPE_SECRET_KEY` | Server secret, sandbox/live isolated | Subscription and portal operations |
| `STRIPE_WEBHOOK_SECRET` | Server secret per endpoint/environment | Stripe callback verification |
| `STRIPE_MONTHLY_PRICE_ID` | Server configuration | Allowlisted recurring price; separate sandbox/live IDs |
| `JOB_DISPATCH_SECRET` | Conditional server/scheduler secret | Only if the selected job runner uses authenticated HTTP |
| Owner account/workspace IDs | Protected server/database configuration | Exact permanent billing-exemption scope, never a browser-granted role |

Hosted Checkout does not by itself require adding a browser payment library or public Stripe key; add one only if the implemented flow needs it. Never use `NEXT_PUBLIC_*` for administrative Supabase keys, database passwords, provider signing secrets, SMTP passwords or job credentials.

## 13. Readiness and evidence register

For each item record: responsible person, environment, non-secret resource ID, status, evidence location, verification date and unresolved blocker. Never paste secret values into this register.

| Gate | Required evidence | Status |
|---|---|---|
| P0-01 baseline | Intended remote/history, reviewed baseline, ignore rules, skill paths and Git convention | Ready for P0-01 scope; PR #1 merged; application CI still P0-03 |
| P0-02 architecture/accounts | Actual account plans/allowances, regions, environment isolation, runner/caption design and settings ownership | Proposal prepared; dashboard projects/DNS control confirmed by user; acceptance/configuration/allowances unverified |
| P0-03 local/CI foundation | Repeatable setup/build/tests, titled migrations, safe variables, isolated database and CI proof | Unknown |
| P1-06 media feasibility | Real multi-device media/caption/isolation/recording-disabled evidence and measured allowance fit | Unknown |
| P2-01/P4-06 identity/mail | Privileged MFA/recovery, private guest identity, authorized Postmark SMTP/API/callback delivery | Unknown |
| P6-03 billing | Accepted commercial inputs, full sandbox lifecycle/coupon/no-charge-expiry proof and scoped portal access | Unknown |
| P5-02 operations | Restore/rollback, active-client compatibility, headroom and actual incident-response drill | Unknown |
| P5-03 pilot | Complete configuration, approved tester offers, actual partner/roster/devices/accommodations and named coverage | Unknown |
| P7-01/P7-02 capacity/release | Three-workshop and multi-workspace load, operating limits, current candidate review and support settings | Unknown |

**Setup order:** preserve the planning baseline; inventory existing accounts/DNS; establish local/CI tooling; configure isolated test services; prove media/captions; complete identity/mail/billing and operational controls; verify the actual pilot; authorize release only against its evidence.

No service was configured, credential created, DNS record changed, email sent or payment taken while preparing this file.
