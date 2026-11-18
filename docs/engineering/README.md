# Debrio engineering kit

Prepared 17 November 2026 against [PRD v0.5](../Debrio_PRD_v0.5.md). This kit plans the work; it does not claim the platform has been implemented.

1. Read the [skill manifest](SKILLS.md) for verified installed skills and the four repository-local Debrio skills.
2. Read the [execution, Git, evidence, and recording workflow](WORKFLOW.md).
   Use the [stack settings checklist](STACK-SETTINGS.md) to inventory accounts, configure environments and verify service connections.
3. Copy the run header and one task from the [phased promptbook](PROMPTBOOK.md).
4. Check dependencies and update the [progress register](PROGRESS.md) and a [task record](templates/TASK-RECORD.md) as the task runs.

The [requirement ownership map](TRACEABILITY.md) assigns all 76 current P0 requirements to implementation tasks. The [accepted stack](STACK-PROPOSAL.md) is Next.js/TypeScript on Vercel, Supabase data/auth/storage/realtime, Postmark transactional mail/Auth SMTP, Stripe billing and LiveKit as the conditional media/caption candidate. P0-02 records the implementation architecture and verifies constraints; Phase 1 proves media suitability. Render is excluded.

Start with **P0-01**. Do not run the whole book as a single implementation prompt. Tasks after an unresolved architecture/provider decision are conditional delivery briefs; settle those decisions through the named spec/architecture workflow before coding.

Independent trainers and consultants can own and subscribe to a one-person workspace without a company, corporate email domain or team. The same workshop workflows serve individuals and organisations; one complete paid plan is accepted, with numeric prices/allowances still open. The platform owner has permanent free use; ordinary customer ownership does not confer that exemption. P2-01, P5-01 and P6-03 include explicit onboarding, delivery and billing proof for individuals.

The user also selected [Stripe workspace subscriptions](BILLING.md), free participant access and [transactional communications only](COMMUNICATIONS.md). The promptbook now has 32 tasks, including P3-05 for retained polling, P4-06 for application communications and P6-03 for complete subscription/coupon flows before integrated verification and tester onboarding (ID retained). Poll audience, privacy, revisions, fresh replacement rounds, removed-response handling, retention and export boundaries are accepted. Initial offer/coupon terms must be accepted before billing implementation; they do not block the initial prototype.

Accepted: consultant-owned client delivery with session-scoped access, assisted pilot first, structured group contributions/recorder submission, and [one modular application](../adr/0001-modular-application.md). Prospective pilot contact: East Coast USA. Domain: debrio.app, not configured or verified. No new infrastructure spending; user-provided tester coupons, complete functionality and professional acceptance checks required. Provider allowance suitability remains unverified. See [current decisions](DESIGN-REVIEW.md).

The PRD remains the product source of truth. This kit does not create another PRD. Initial architecture shape/providers and the no-additional-spending constraint are accepted. Actual account allowances, numeric pricing, operational configuration and pilot arrangements remain evidence or delivery inputs; see the [finite readiness checklist](DESIGN-REVIEW.md#finite-readiness-checklist). The existing mockup is a reference, not a working application.

## Consolidated build baseline

Acquisition readiness is an accepted build requirement: the [engineering quality contract](QUALITY-BAR.md) defines eight mandatory gates for structure, CI, correctness, security, operations, accessibility, provenance and independent handover. Apply them from the first implementation task and collect candidate-specific evidence at P7-02. All eight are currently unverified; no Google, Meta or LMS buyer approval is claimed.

The numbered design interview Q1-Q61 is resolved, with Postmark selected in Q55. This is the reviewable plan; no application tasks are complete.

The [SaaS reliability review](SAAS-RELIABILITY-REVIEW.md) is consolidated into existing tasks. Q59 accepts at most three live workshops per workspace; Q60 requires privileged-account two-factor authentication; Q61 requires published support hours and named live pilot coverage. R1-R8 now specify the operational failure tests; implementation and evidence remain outstanding.

| Area | Accepted direction |
|---|---|
| Product | One workshop app for individual trainers, consultants and organisations: peer instruction, role practice, jigsaw and simple custom agendas; native rooms, announcements, captions, videos, scoped resources and polls |
| Workspace and identity | Maximum three live workshops per workspace, subject to verified global capacity; privileged operator/owner/billing/data-admin accounts require two-factor authentication. One account can switch among isolated workspaces; free guest participation with lobby admission/private identity; verified recovery; accepted ownership transfer and delegated facilitation |
| Commercial | One complete monthly paid plan; invited testers get 100% off for 30 days without a card or automatic paid renewal; permanent owner exemption in the designated owner workspace under normal capacity limits |
| Paid lifecycle | Cancellation at paid-period end; seven-day failed-renewal grace; existing sessions may finish within the original four-hour ceiling |
| Work and privacy | Immutable submissions/corrections, explicit reopening after closure, fixed downstream versions; exact-item/audience publication approval; task-only withdrawal; verified scoped deletion with shared-contribution review |
| Retention | Session records 90 days after end; abandoned sessions end at the original four-hour deadline; reusable content has its own 90-day recovery period after entitlement ends |
| Evidence | Written task/test/commit records plus synthetic demo videos; no live-session recording or retained transcript |
| Budget and readiness | Published support hours, named live pilot coverage and exercised incident response; no additional infrastructure spending; verify actual allowances, complete-product feasibility, commercial inputs and actual pilot requirements before their respective gates |

The [promptbook](PROMPTBOOK.md) retains 32 tasks and 96 completion criteria. Delivery proceeds through repository/architecture setup, media feasibility, core session work, resources/media/polls, the three formats/privacy/communications, complete billing, integrated verification, the human pilot, and scale/release gates. P6-03 billing executes before P5-01 despite its retained task ID. Every task retains its skills, required proof, synthetic recording, branch/commit and delivery instructions.

Q56-Q58 require delegated continuation on lead disconnect without automatic promotion; linked correction versions with explicit reopening after closure; and verified deletion handled by the workspace owner or delegated data administrator, preserving others' separable work where possible. These rules are integrated into P2-01, P2-03 and P4-05.

## What is included

- Ponytail Full as the delivery discipline, with review, audit, and debt tools used at appropriate checkpoints.
- Verified Matt Pocock skills for repository setup, domain modeling, codebase design, focused questioning, and standards/spec review.
- Installed Blueprint skills for architecture, feature specs, testing, independent review, and delivery to a PR; these are credited separately from Matt's skills.
- Four Debrio skills under [`skills/`](../../skills/), loaded explicitly by the run header. They are portable source files, not a claim of global installation or automatic discovery in this session.
- A phased task sequence with dependencies, skills, tests, completion conditions, demo requirements, branch names, and commit subjects.
- Written records plus synthetic-data demo videos. No live participant session recording is authorized.

## Current repository facts

At preparation time: branch `main`; no local commits; `origin` points to `https://github.com/Seth-arc/conductor.git`; the remote's contents and authentication were not checked. Existing product files are under `docs/`. There is no application build/test command registry yet.

P0-01 must recheck these facts before Git operations. This authoring task did not commit, push, open issues/PRs, configure accounts, or deploy anything.
