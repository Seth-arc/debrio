# Accepted managed stack

Configuration companion: [required settings and readiness checklist](STACK-SETTINGS.md). It separates agreed requirements from unverified account values and proposed implementation names.

Status: **Initial stack accepted in Q55 with Postmark for transactional email; not implemented. LiveKit media/caption suitability remains conditional on feasibility evidence.** Prepared 17 November 2026. The user prefers a simple managed setup and explicitly excludes Render. This does not approve paid plans, regions, retention terms, or provisioning.

Accepted shape: one modular application, one relational database, managed media and narrow background jobs; see [ADR 0001](../adr/0001-modular-application.md). The first delivery is an assisted invitation-only pilot of the complete product, including subscription/coupon flows. The user supplied **debrio.app** and a prospective East Coast US pilot contact; domain control/DNS, participant locations and residency constraints are unverified. No new infrastructure spending is permitted; tester coupons discount customer access and do not establish provider capacity or free-tier suitability. Test provider allowances and restrictions before provisioning; do not silently incur charges or weaken pilot requirements to fit an allowance.

This is an input to promptbook **P0-02**, not a replacement for the PRD or the later accepted ARCHITECTURE.md. The initial stack choices are accepted; P0-02 still records and reviews implementation architecture and verifies account/cost constraints before P0-03 scaffolding. Media/caption topology remains conditional on Phase 1 evidence.

## Accepted starting point

| Part | Accepted choice / conditional candidate | Why it fits Debrio |
|---|---|---|
| Application language | TypeScript for frontend and backend | One main language for UI, validated API contracts, permissions, and orchestration |
| Frontend | Next.js with React and TypeScript | Fits the requested Vercel hosting direction; keep interactive meeting/media state in appropriate client components |
| Application backend | Next.js server route handlers using the Node.js runtime | Short authorized commands, provider grants and database transactions; no long-lived room state or caption stream stored in a request process |
| Hosting | Vercel for the web app and request/response API | User-selected direction; managed real-time transport and caption workers run outside ordinary web functions |
| Subscriptions and checkout | Stripe Billing, hosted Checkout and customer portal | Workspace subscription for individual trainers/consultants or organisations; participants join free; Debrio enforces access and plan limits |
| Transactional communications | Postmark for application transactional email and Supabase Auth custom SMTP; Stripe for supported billing emails | User selected transactional-only scope; one owner per notice, existing in-app notices retained; see [communications plan](COMMUNICATIONS.md) |
| Database | Supabase-managed PostgreSQL | Persist sessions, assignments, immutable submissions, feedback, approvals, messages and lifecycle records transactionally |
| Identity | Supabase Auth | Managed facilitator identity; evaluate guest identity plus Debrio invitations/admission without requiring a paid participant account |
| Files and resource videos | Supabase Storage | Private resource/caption objects with application-controlled allocation and release; define an explicit supported-format policy |
| Task-state notifications | Supabase Realtime private channels | Managed updates for committed task state; the database remains authoritative and clients resynchronize after reconnect |
| Audio/video rooms | LiveKit Cloud, conditional on feasibility | Candidate transport for native room media and explicit publish/subscribe routes; Debrio-specific monitoring and announcements still need proof |
| Live captions | A narrowly scoped transcription worker, with LiveKit Cloud managed agent hosting as the first candidate | Select runtime, speech provider, processing policy and limits through P1-05; no autonomous facilitator or LLM is implied |
| Tests | Vitest, real database integration tests, Playwright Test | Domain/contract tests, transactional proof, and persistent multi-user browser regression tests, supplemented by real-device media trials |
| CI and repository | GitHub Actions and the existing GitHub repository | Run documented checks and retain permitted evidence against the exact commit; branch rules and required checks are configured in Phase 0 |

Vercel documents Next.js deployment and function execution limits. The proposed separation keeps short application requests on Vercel, task notifications in a managed real-time service, and persistent audio/caption processing in a suitable worker runtime. Do not host a whole workshop inside one function invocation or assume a process remains alive after a response. [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Function limits](https://vercel.com/docs/functions/limitations), [Vercel real-time guidance](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections).

Supabase provides database, authentication, storage, and real-time services. Its private-channel authorization must be designed and tested against Debrio's group/session boundaries, including changes to active permissions. Anonymous authentication is a candidate identity mechanism, not a substitute for invitation validation or admission. [Supabase products](https://supabase.com/docs), [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization), [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous).

LiveKit models rooms, participants, and published/subscribed tracks. Its official multi-user transcriber example and managed agent deployment documentation support investigating a hosted caption worker. They do not establish Debrio's isolation, quality, cost, or no-retained-transcript behavior; inspect observability/recording settings and disable content retention before testing with people. [Media concepts](https://docs.livekit.io/intro/basics/rooms-participants-tracks/), [Multi-user transcription example](https://github.com/livekit/agents/blob/main/examples/other/transcription/multi-user-transcriber.py), [Managed worker deployment](https://docs.livekit.io/deploy/agents/).

Vitest supplies a Vite-oriented test runner; Playwright Test supplies browser test execution and isolation. Browser tests still cannot replace real audio/device/network evidence. [Vitest guide](https://vitest.dev/guide/), [Playwright Test](https://playwright.dev/docs/intro).

## How the responsibilities would fit

1. The browser authenticates and joins through Debrio's invitation/admission flow.
2. Next.js server handlers validate commands, enforce Debrio permissions, and commit state changes in PostgreSQL. Important writes do not rely on unvalidated browser messages or process-local memory. Transactions/retries must tolerate concurrent function instances.
3. Authorized private-channel notifications tell clients that committed state changed. Clients recover from missed notifications by reading the authoritative state; channel membership alone never grants access to private rows/resources.
4. LiveKit carries room microphone/camera/screen media through explicitly issued grants. Media membership remains separate from resource/group assignments.
5. Resource videos upload directly to protected object storage through authorized upload grants, with validation before publication; do not proxy large files through ordinary function request bodies. Videos play from authorized storage or supported external players. Group play/pause/seek state is application state, not a recording or retransmission of the participant's screen. Check the current [function payload limits](https://vercel.com/docs/functions/limitations) during implementation.
6. A disclosed, authorized caption process consumes only the permitted tracks and sends ephemeral captions to the correct audience. Persistent transcript logging and provider recording defaults must be disabled/verified.

This is the accepted initial division of responsibility, with technical implementation subject to evidence. We have not validated SDK combinations, transport topology, synchronization, provider account settings, costs, or deployed behavior. Keep durable state out of process memory; do not add a second notification system unless a measured requirement justifies it.

## Accepted reliability contracts

Apply [review R1-R8](SAAS-RELIABILITY-REVIEW.md) through the existing tasks: bounded authorization during partial outage, durable committed-action recovery, atomic three-live-workshop workspace admission plus verified global/provider headroom, live-client-safe release/rollback, privacy-safe coherent restore, host-account/closure lifecycle, exercised incident response and visible dependency-failure states. Privileged operator/owner/billing/data-administration accounts require two-factor authentication with secure recovery. Published paid-service support hours and named live pilot coverage are accepted; actual staffing/configuration and performance must be proved. No additional spending is authorized.

## Choices still requiring evidence or a decision

- **Permitted existing infrastructure:** existing accounts, included allowances and available credits may support the complete pilot only with no additional spending. Verify actual account entitlements, duration, capacity, usage meters and overage controls; no new paid plan or assumed free capacity is authorized.
- **Communications:** use accepted Postmark; verify sending domain/reply-to and document reminder timing/preferences, retention, dispatcher/scheduler and per-event billing sender ownership in P0-02. No marketing campaigns/newsletters. See [COMMUNICATIONS.md](COMMUNICATIONS.md); P4-06 implements application delivery and P6-03 billing notices.
- **Commercial policy:** workspace subscriptions through Stripe support individuals and organisations. Company or team setup cannot be required for an individual trainer. One complete paid plan plus invited testers is accepted; public free workspaces deferred. The verified platform owner has permanent free use in the designated owner workspace under normal technical capacity limits; customer workspaces remain separately billed. One account can switch among isolated workspace memberships. Monthly billing, period-end cancellation and seven-day failed-renewal grace are accepted. Numeric price/currency/allowances and remaining lifecycle details are open. P0-02 settles the prototype architecture and pilot access; P6-03 accepts an initial offer/coupon policy after feasibility evidence and implements billing before integrated verification and tester onboarding; pilot findings may refine later offers. See [BILLING.md](BILLING.md).
- **Caption implementation:** Node is preferred to keep the main stack consistent, but do not force a custom port if the proven provider-supported path needs a small Python worker. Compare reliability and operating cost before selecting it. No LLM or automated facilitator is required for speech-to-text.
- **Resource video scope:** uploaded object storage does not supply an arbitrary-format transcoding pipeline. Decide the supported formats, upload limits, captions, delivery behavior and external-player matrix; add a dedicated video platform only if the actual requirements justify it.
- **Live access revocation:** test active media, private-channel and resource-link revocation. A row policy or short token lifetime alone does not prove immediate cleanup.
- **Hosting regions and data handling:** choose compatible regions and processing/retention terms for the actual pilot audience. Do not infer residency or legal compliance from the provider name.
- **Operating cost:** measure app/worker uptime, database/storage, real-time usage, media minutes/relay/egress, caption processing, resource-video delivery and support. No monthly price estimate or free-tier capacity claim is made here.
- **Deployment and environments:** choose development/test/staging isolation, backups, log access and artifact retention before real customer data. Do not purchase plans or provision services from this proposal alone.

## Credible alternative

React/Vite as a static frontend on Vercel with a separately hosted backend is feasible, but introduces another application deployment boundary. Given the requested Vercel-based setup, my preference is one Next.js application for the web/API surface plus managed data/media services. Add a separate general backend only when a proven requirement cannot fit the selected request/worker boundaries. Render is excluded by the user's instruction.

## Skill consequences

- The four local Debrio skills remain applicable regardless of this choice.
- Matt's Node-oriented `setup-pre-commit` fits this proposal if accepted. Pin and verify tooling when scaffolding; do not copy dependency versions from this document.
- Use current Next.js/Vercel/Supabase/LiveKit official documentation during implementation. The installed AWS skills are unnecessary unless the hosting decision changes to AWS.
- Keep a provider-specific decision/reference inside the task or accepted architecture. A new global skill pack is not a prerequisite to start the feasibility work.

Q55 accepts Next.js/TypeScript on Vercel, Supabase data/auth/storage/realtime, LiveKit as the media/worker candidate and Postmark transactional mail. P0-02 translates these accepted choices into the reviewed implementation architecture; caption details and final media approval remain Phase 1 gates. Account configuration, provisioning, sends and spending are not performed by this planning decision.
