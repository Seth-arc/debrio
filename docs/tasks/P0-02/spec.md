# P0-02 decision and evidence register

18 November 2026. This is the narrow decision record for [the P0-02 card](../../engineering/PROMPTBOOK.md#p0-02--select-the-stack-and-initial-architecture), not another PRD. Read the [accepted architecture](../../../ARCHITECTURE.md) and [task evidence](../../engineering/records/P0-02.md). Decision owner: the user/platform owner, who explicitly confirmed “Accept D1–D6 as proposed” after the reviewed PR and concrete decision summary were presented.

## Existing acceptance and prerequisites

- P0-01 merged in [PR #1](https://github.com/Seth-arc/debrio/pull/1), verified by GitHub connector on 18 November; merge/default SHA `b002e5a7873f6d0dcdb181fc812aa7303b51d4d9`. Independent review and repository controls are recorded there. No application CI exists yet; P0-03 owns it.
- Accepted in existing Q55/ADR 0001: Next.js/TypeScript on Vercel, Supabase data/Auth/Storage/Realtime, Postmark and Stripe; one modular application/database; LiveKit only a conditional candidate. Render excluded. This task does not reopen those choices.
- Accepted product inputs: consultant/individual workspaces, separate session/billing authority, single workspace owner with accepted transfer, private session identities with verified optional account link, immutable single-owner attempts and contributor history. Keep the 18 November PRD clarifications intact.
- Accepted no-new-infrastructure-spend, invitation-only complete tester pilot, supplied debrio.app and prospective US East Coast contact. On 18 November the user confirmed they control DNS, have no location/language/data-residency constraints, and have created Supabase and LiveKit projects **only in their dashboards**. No Next.js implementation exists on another supplied branch. Actual DNS/project settings and account allowances have not been inspected; pilot accommodation validation remains required.

## Accepted decisions and remaining proof gates

| ID | Accepted answer / consequence | Blocking scope and alternative |
|---|---|---|
| D1 | Private hashed guest credential in secure cookie, per-session endpoint epoch and server-mediated data. Account participants use verified Auth linkage, no automatic guest-work merge | Accept before P2-01 identity implementation. Alternative: Supabase anonymous Auth, requiring proven admission, cleanup and guest recovery mapping. Host login choice stays in P2-01. |
| D2 | Supabase Cron + authenticated HTTP dispatch to bounded Vercel handler, durable PostgreSQL intents. Test 10-second dispatch / 20-second invocation / 30-second claims | Accept before dependent job implementation; verify account cadence/runtime/usage before hosted enablement. Alternative: verified Vercel scheduler or a managed narrow runner within existing allowance. No persistent caption stream in either path. |
| D3 | Proposed 15-second authorization freshness ceiling, renewal every five seconds; stop even ordinary conversation if freshness cannot be established | Accept continuity tradeoff before media implementation; **provider-side enforcement is unproven**. Phase 1 may probe the missing mechanism; no production approval if browser/worker/control API failure leaves media flowing. Alternative needs a proven trusted enforcement topology, never simply longer JWT expiry. |
| D4 | After tester/paid entitlement expiry, no new admissions; already admitted people can reconnect to sessions within original four-hour deadline | Accept before P6-03/P2-01 expiry behavior. Alternative is bounded late admission, which needs a separate capacity/security decision. No new hosting or automatic charge in either case. |
| D5 | One optional 24-hour reminder; essential change/security/lifecycle notices; explicit billing sender ownership; proposed sender/Reply-To; 30-day delivery metadata, seven-day operational and 90-day security logs | Accept policy before P4-06 and sender/retention configuration before sending. Mailbox/domain/provider retention remain factual blockers. Alternative: no optional reminders initially; essential transactional behavior remains required. |
| D6 | Proposed disaster RPO ≤24 h and RTO ≤8 h after operator acknowledgement, daily coherent DB/object export with seven-day rotation; independently durable control journal, quarantined restore | Accept objectives before hosting real data and prove in P5-02. Normal acknowledged-save durability is unchanged. Destination/allowance/coherence are unverified; if unavailable, block hosted data rather than claim recoverability. |

**Confirmation received on 18 November 2026:** user response “Accept D1–D6 as proposed,” referencing PR #2 and this register. The “accept before” obligations in the table are satisfied for these six design decisions; implementation/provider evidence remains outstanding. Dependent implementation must obey the stated scopes and the card's P0-03 account gate. Commercial numbers do not block scaffolding, but the user must accept the initial offer after feasibility and before P6-03. No new spending, merge or deployment is authorized by this design confirmation.

## Provider evidence checked 18 November 2026

These are public documentation observations, not authenticated account inspection or runtime tests. No SDK version has been installed/selected. Recheck current docs and pin versions at the implementation task.

| Evidence | Observation and design consequence |
|---|---|
| [Supabase Cron](https://supabase.com/docs/guides/cron) | Supports recurring SQL/HTTP work; recommends bounded concurrent jobs. Candidate mechanism for D2, no actual extension/account access verified. |
| [Scheduling HTTP calls](https://supabase.com/docs/guides/functions/schedule-functions) | `pg_cron` plus `pg_net` and Vault provides a documented dispatch path. Queued request secrets need restricted access; use a dedicated dispatch credential, not broad data authority. |
| [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) | Policies are cached until refresh/expiry; do not publish private payloads to a potentially stale channel. Authorize each refetch. |
| [LiveKit token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/) | Token expiry is not an active-media revocation guarantee. D3 enforcement is an unresolved feasibility blocker, not a capability claim. |
| [LiveKit quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/) | Build defaults: 100 connected participants, five agent sessions, five STT streams. Three 40-person workshops or one-caption-worker-per-six-breakouts do not fit those defaults. Actual account headroom is unknown. |
| [LiveKit recording controls](https://docs.livekit.io/reference/agents/session-recording-options/) | AgentSession recording follows project settings by default and has an explicit off setting. Inspect both selected SDK and project and any independent STT/log sinks; no-retention is unverified. |
| [Supabase backups](https://supabase.com/docs/guides/platform/backups) | Database backup does not contain Storage object bytes. Recovery needs coherent object backup and later control journal. |
| [Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines) | Commercial eligibility must be verified; don't assume Hobby fits. No account/plan purchased. |
| [Postmark idempotency](https://postmarkapp.com/support/article/what-is-an-idempotency-key) | No provider idempotency keys; ambiguous sends need reconciliation/controlled retry, not an exactly-once promise. |
| [Postmark callbacks](https://postmarkapp.com/developer/webhooks/webhooks-overview) | Documented HTTPS authentication is distinct from Stripe signatures. Credentials must not appear in logs. |
| [Stripe webhooks](https://docs.stripe.com/webhooks) | Signature validation and duplicate/out-of-order handling shape durable receipts/current-state reconciliation. No Stripe sandbox account or real subscription verified. |

## External facts and dependent gates

| Fact / receipt needed | Observed status | Consequence |
|---|---|---|
| Account names/plans, existing spend allowance, actual usage, hard limits, resets and credit expiry for every provider | Unknown; no credentials requested in chat; user asked for non-secret details | Account/zero-spend gate not passed. No hosted start, provisioning, spending or capacity claim. |
| Control of debrio.app, registrar/DNS edit access, current records and mailbox | User confirms DNS control on 18 November; authenticated DNS/records/mailbox not inspected | Ownership statement recorded; operational DNS/sender verification still pending. No invented DNS target or support inbox. |
| Actual pilot locations, caption languages/accommodations and residency constraints | User confirms no location/language/data-residency constraints on 18 November | Recommend colocated US East web/database placement for prospective East Coast contact; actual project region, caption language and accessibility needs still require configuration/pilot checks. No legal compliance certification implied. |
| Supabase/LiveKit project existence and deployable app | User confirms dashboard-only setup; project IDs/configuration not provided. Repository has only demo/package.json with start/test scripts, no Next.js build | Dashboard creation is not implemented schema/media/auth. Vercel handoff is in STACK-SETTINGS; P0-03 owns the actual app and verified build commands. |
| Operator account ID + designated owner workspace ID | Unknown | P6-03 exemption disabled until verified; no email-domain/ownership heuristic. |
| Private backup/evidence destination and operations contacts | Unknown | No video upload; no real-data hosting/recovery claim. Video N/A for this card. |
| Initial price/currency/offer IDs, redemption deadline, financial retention and selling entity/tax/refund settings | Unknown | P6-03/live billing gates; prices alone do not block local prototype scaffolding. |
| Measured total headroom and trusted media-plane lease enforcement | Unverified | P1-06/P5-03/P7-01 remain blocked on their own evidence; accepted max three per workspace does not promise available global capacity. |

Read-only connected GitHub evidence verifies repository identity/default branch and P0-01 merge. There are no connected provider-account tools supplying the missing account/DNS facts. Public provider docs do not close these gaps. Keep private identifiers and account screenshots out of this public repository.

## Criterion walkthrough / review scope

P0-02-AC1 is assessed against the architecture's module table, data constraints, four walkthroughs, R1–R8 matrix and INV-1–INV-10. P0-02-AC2 has fresh independent architecture review and local rendered diagram inspection. P0-02-AC3 now has actual D1–D6 owner confirmation and existing stack acceptance; account facts remain Unverified, with dependent tasks blocked as documented. No runtime criterion is passed by prose or diagram rendering.

Review must challenge commit-before-provider failure, stale in-flight calls, malicious clients during control outages, concurrent global admission, copy/export approval bypass, email ambiguity, old-client rollback and restored deleted data. Record findings and dispositions in the task record. Do not expand P0-02 into application scaffolding or provider configuration.
