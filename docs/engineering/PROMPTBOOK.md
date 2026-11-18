# Debrio phased engineering promptbook

Use with [WORKFLOW.md](WORKFLOW.md), [SKILLS.md](SKILLS.md), [requirement ownership](TRACEABILITY.md), and [PRD v0.5](../Debrio_PRD_v0.5.md). Review the [managed stack proposal](STACK-PROPOSAL.md) in P0-02. This is a staged delivery plan, not a promise that unresolved architecture, cost, provider, or pilot choices have been made. Do not implement a card whose consequential prerequisites are unresolved. Each task owns the complete PRD requirements assigned in TRACEABILITY.md as well as its card criteria.

## Copy this run header, then choose one task

```text
Execute task <TASK-ID> from docs/engineering/PROMPTBOOK.md only.
Use Ponytail Full. Read docs/engineering/WORKFLOW.md and SKILLS.md, the task,
relevant PRD sections, repository instructions, and the named skill files.
Apply docs/engineering/QUALITY-BAR.md and record applicable QG gate evidence.
Load repository-local skills directly from skills/<name>/SKILL.md.
Preserve unrelated work and settled product decisions. Verify prerequisites.
Every schema/data migration needs a descriptive title in its filename and a
matching human-readable title in its file header; record its ID/title in task
and release evidence. Follow WORKFLOW.md's migration naming contract.
If a consequential technical decision is missing, prepare the narrow spec or
decision with evidence before implementing dependent code.

Delivery: pr. This authorizes the task branch, scoped commits, normal push to
the verified intended remote, and creation/update of its PR. It does not
authorize default-branch bootstrap, merge, production deploy, paid account
changes, or unrelated external messages. Use Delivery: local instead if I
want local artifacts only.

Recording: written task/test/commit record plus synthetic-data demo videos
required by the card. Never record live participant sessions. Do not publish
videos outside an approved private evidence destination.

Implement the smallest complete outcome, run meaningful tests and applicable
independent review, fix valid findings, and report exact evidence and gaps.
Use actual commands from COMMANDS.md once it exists; do not invent results.
Update the task record and PROGRESS.md. Stop at this task's completion gate.
```

The literal `<TASK-ID>` is a substitution field, not a runnable command. Each task's branch and subject are suggestions; reuse the existing task branch/PR when continuing. All pushes use WORKFLOW.md's remote/SHA/CI checks. Default merge status is **not merged**. Documentation tasks still need a scoped commit and PR when `Delivery: pr` is chosen, but do not require fabricated application test results.

Every implementation card also uses `ponytail:ponytail`, `debrio-testing-and-release`, and the installed `test` workflow. Use `task-to-pr` for authorized PR delivery, or `lean-build` for local delivery. After a base exists, apply Matt's `code-review` to the actual base/task commits with the task/spec as source; run independent `review` when the delivery workflow requires it. Use Ponytail review criteria on the same change. Do not run a full repository audit for every card.

Task records use criterion IDs `<TASK-ID>-AC1`, `-AC2`, and so on, in the row order below. Keep those IDs stable if details are clarified. Tests listed here are scenarios; P0-03 and each feature task must provide actual executable commands in COMMANDS.md and the record.

The [engineering quality gates](QUALITY-BAR.md) also apply to every card through WORKFLOW.md; existing AC IDs remain stable. P0-01 establishes repository controls and provenance, P0-02 documents architecture and threat boundaries, P0-03 enforces automated checks, and subsequent tasks supply the evidence assigned in that contract. P7-02 must verify all eight gates and include the dependency/asset inventory and an exercised independent handover before declaring the candidate ready.

## Phases and exit gates

| Phase | Observable outcome | Exit gate |
|---|---|---|
| 0 — Working engineering foundation | A reproducible repo and accepted initial technical direction | Tracker/domain conventions chosen, baseline handled safely, verified local/CI commands |
| 1 — Media feasibility | A facilitator can safely control real multi-room media and resources | Demonstrated monitoring, announcements, videos, captions, isolation, recovery, and cost limits accepted before full build |
| 2 — Run a simple session | Invited people follow an agenda and retain submitted work | Scoped identity, reusable stages, durable work, recovery |
| 3 — Facilitate with resources and media | Groups receive the right material and help without leaking across rooms | Integrated meeting controls, releases, announcements, videos, captions and accessible recovery |
| 4 — Run the three formats | Peer instruction, role practice, jigsaw, and debrief work end to end | Three executable formats, uneven groups, private answers, approved publication |
| 5 — Prepare the complete tester setup | Complete subscription/coupon and workshop flows in a supported environment | P6-03 billing first (retained ID), integrated proof, staging recovery, actual 20-plus-person configuration and approved tester access ready |
| 6 — Observe the first pilot | Pilot findings inform fixes and later offer refinements | Written human evidence, fixes and willingness-to-pay findings; initial billing verified before testers |
| 7 — Validate scale and release | Supported 40-person/eight-room behavior and an operable release | Capacity evidence, candidate review/CI, rollback, explicit release authorization and smoke checks |

At exactly 20, role practice requires six concurrent rooms: four trios and two groups of four. Jigsaw uses five home groups of four and four expert groups of five. Twenty is the first-pilot minimum, not a forced minimum for every product session. The later 40-person/eight-room test is a separate milestone.

## Phase 0 — Working engineering foundation

### P0-01 — Establish repository workflow and a safe baseline

**Depends on:** none. **Skills:** Matt `setup-matt-pocock-skills`; Ponytail Full; `review` for the unborn-HEAD exception; `debrio-testing-and-release`.

**Prompt:**

```text
Inspect the current checkout and remote without disturbing user files. Use
setup-matt-pocock-skills to choose the tracker and agent-instruction file,
then configure its domain-doc conventions. Present concrete setup choices
where that skill requires them. Route Debrio work to the four local skills
and the existing PRD; do not import Myelin roles or create another PRD.
Define narrow ignore rules for secrets, local artifacts, captures and build
outputs. Inspect remote history before preparing the initial baseline.
Follow the explicit empty-remote bootstrap rule; do not force unrelated history.
```

| Done when | Testing/proof |
|---|---|
| Tracker and agent-file choices are recorded; required skill paths resolve | Read generated conventions and test their references; no external tickets/labels unless authorized |
| Baseline path is appropriate to actual remote history; unrelated files remain intact | Git inspection, staged-path review, secret/large-file inspection and fresh review; report remote failures explicitly |
| Evidence is ignored appropriately without excluding required project assets | `git check-ignore` on representative artifact/secret paths; inspect intended tracked files |

**Recording:** written setup record; video N/A for configuration-only work.
**Git:** `chore/p0-01-engineering-baseline`; `chore(repo): establish Debrio engineering workflow`. Push a task branch only when a base exists. An empty remote's initial default-branch push needs separate explicit authorization; record its exact SHA.

### P0-02 — Select the stack and initial architecture

**Depends on:** P0-01. **Skills:** Matt `domain-modeling`, `codebase-design`, conditional `grill-with-docs`; Blueprint `architecture`, `architecture-review`; all four Debrio skills as relevant references.

**Prompt:**

```text
Start from the accepted managed stack: Next.js/TypeScript on Vercel, Supabase
data/auth/storage/realtime, Postmark application email and Auth SMTP, Stripe billing,
and LiveKit as the conditional media/caption-worker candidate. Render is excluded.
Use STACK-SETTINGS.md for account inventory, environment separation, required
provider/app settings and verification evidence; proposed names are not configured resources.
Apply the accepted modular-application ADR: one application/database with managed
media and narrow background jobs. First delivery is an assisted invitation-only
pilot with a prospective US East Coast contact and debrio.app as supplied domain.
Verify domain control and actual audience constraints. No new spending under the
confirmed no-new-infrastructure-spend constraint and provider allowance verification.
Keep persistent media/caption workers out of ordinary web request handlers.
Apply SAAS-RELIABILITY-REVIEW.md R1-R8. Define bounded authorization freshness under
partial outage, durable reconciliation intents and their runner, and a dependency
failure matrix with visible states, permitted actions, retry ownership and recovery.
Define the three-live-workshops-per-workspace cap plus measured global headroom,
including paused activities, simultaneous starts, reconnect bursts and credit expiry.
Define coherent database/object restore with deletion/revocation/expiry/billing
reconciliation before access resumes; separate disaster recovery targets from
ordinary acknowledged-save durability. Define old-client release compatibility or
defer incompatible changes until sessions end; no forced refresh to hide breakage.
Compare frontend/backend,
database, auth, task updates, media/captions, resource storage, hosting and CI.
Include the chosen Stripe organisation/workspace subscription model with free
participants. Read BILLING.md; settle prototype billing boundaries and pilot
access now. An initial offer/coupon policy must be accepted after feasibility
evidence and before pre-pilot P6-03 billing implementation; prices do not block
prototype scaffolding. Pilot findings may inform later explicit offer revisions.
Support individual trainers/consultants owning a one-person workspace as well
as organisations; do not require a company, corporate email or team. Separate
workspace membership, billing authority and explicit session permissions.
Consultant client sessions normally belong to the consultant's workspace;
clients receive explicit session access without their own subscription/admin role.
Model one complete paid plan, invited tester coupons and the user's permanent
platform-owner billing exemption. Bind it to the verified owner account and designated owner workspace, retaining
ordinary technical capacity limits unless explicitly configured;
customer workspace ownership and transfer must not confer that exemption.
Read COMMUNICATIONS.md; use Postmark transactional email/Auth SMTP and define dispatch scheduling,
sender/domain, reminder/preferences policy and per-event billing ownership.
Present provider boundaries, cost drivers and one credible alternative. Settle
the consequential choices before scaffolding; media approval still needs Phase 1.
Design the simplest architecture capable of the agreed session, resource,
permission and media behavior. Define session, activity, media room, group,
role, resource assignment, attempt and publication approval in GLOSSARY.md.
Write ARCHITECTURE.md with data flow and ownership, accepted stack/storage/
identity/hosting, recovery and test strategy, and the strongest relevant
alternative. Keep media provider approval pending Phase 1 evidence. Use ADRs
only for consequential settled tradeoffs. Have the proposal reviewed independently.
```

| Done when | Testing/proof |
|---|---|
| A fresh implementer can identify ownership, identity, persistence and room/resource boundaries | Trace success/denial, competing update, reconnect and publication change; review R1-R8 failure matrix, durable reconciliation, aggregate admission and restore/rollout contracts |
| Proposed versus accepted decisions and implementation gaps are explicit | Independent architecture review; render/inspect the architecture diagram |
| Minimum stack choices for the probe are accepted; consequential unknowns block their dependent tasks | Record actual decision-owner confirmation; no invented vendor capability, price or implementation status |

**Recording:** written review/decision record; diagrams are evidence, video N/A.
**Git:** `docs/p0-02-architecture`; `docs(architecture): define Debrio ownership and media probe`. PR remains a proposal until its decision gate is accepted.

### P0-03 — Make the application reproducibly build and check

**Depends on:** P0-02's accepted initial stack. **Skills:** `task-to-pr`, Matt `setup-pre-commit` if applicable; `security-best-practices`; Ponytail Full.

**Prompt:**

```text
Create the minimum runnable application and test environment for the chosen
stack. Provide a non-secret environment example, locked dependencies, a
documented start/stop/reset procedure, and a health/smoke path. Wire formatting,
static/type checks, focused tests and build into CI. Use setup-pre-commit when
the selected stack supports its tooling; keep CI authoritative and stage only
task-owned files. Write COMMANDS.md with commands you actually executed.
```

| Done when | Testing/proof |
|---|---|
| A clean checkout can install locked dependencies, start, and stop | Reproduce setup in a clean environment and exercise the health path |
| Local checks and CI catch a representative intentional failure | Demonstrate failing then restored check without committing the deliberate defect |
| No secret or generated build artifact is tracked; commands match reality | Inspect lock/config/ignore files, run documented checks and inspect CI |

**Recording:** brief synthetic smoke demo; written setup/check log.
**Git:** `chore/p0-03-app-foundation`; `chore(app): add reproducible development and CI checks`. Push/PR after local proof, then verify actual CI.

## Phase 1 — Media feasibility before full build

### P1-01 — Join an isolated multi-room media probe

**Depends on:** P0-03 and authorized provider credentials/budget. **Skills:** `debrio-realtime-media`, `debrio-access-and-data`, `security-best-practices`, `playwright`.

**Prompt:**

```text
Build a thin probe using the candidate provider and current official SDK docs.
Run one main room and four breakouts with synthetic identities, server-issued
scoped grants, device preflight, and visible connection state. Keep administrative
credentials server-side. Separate probe-only fixtures from production guarantees.
Record SDK/browser versions, provider limits, cost and task-owned resource cleanup.
```

| Done when | Testing/proof |
|---|---|
| Authorized clients join only their media room and denied devices have recovery | Unit/contract grant checks; independent browser/device join and denial flows |
| Another room/session and expired grants cannot subscribe/publish | Provider-backed negative tests; no client-side muting as security boundary |
| Probe can be reproduced and cleaned up within approved limits | Actual run/cost record and resource shutdown checks |

**Recording:** synthetic two-device join/device-denial demo, with approved test audio only.
**Git:** `spike/p1-01-media-rooms`; `feat(spike): prove scoped multi-room media joins`. Label probe limitations in PR; no production-readiness claim.

### P1-02 — Prove visible listening and safe room switching

**Depends on:** P1-01. **Skills:** `debrio-realtime-media`, `debrio-access-and-data`, `investigate-first`, `playwright`.

**Prompt:**

```text
Add Listen, Speak, Join, Scan and Stop to the probe. Establish named notice
before monitored audio, use one intelligible monitored conversation at a time,
and close old routes before enabling new ones. Test role revocation, reconnect,
new tracks, device loss and failed transfers without losing acknowledged test work.
```

| Done when | Testing/proof |
|---|---|
| Participants see the right listening/speaking state before access | Instrument authorization/notice order and inspect both participant and facilitator clients |
| No stale route, unintended microphone, or wrong-room audio survives switching/Stop/revocation | Real audio/browser tests plus automated route-state negative checks |
| Reconnect and transfer failure preserve task work and show truthful status | Fault injection with persisted test output; measured switch/recovery timings |

**Recording:** synthetic facilitator/room views showing listen, speak, stop, and one failure/recovery.
**Git:** `spike/p1-02-monitoring`; `feat(spike): prove visible monitoring and route cleanup`.

### P1-03 — Prove spoken announcements to explicit audiences

**Depends on:** P1-02. **Skills:** `debrio-realtime-media`, `debrio-access-and-data`, `playwright`.

**Prompt:**

```text
Demonstrate microphone-only announcements to one, selected, and all rooms in
the same session, with recipient preview and named speaker state. Suspend
conflicting routes and lower target conversation audio. Keep room return audio,
cameras and screen shares isolated. Stop on disconnect/revocation; never resume
publication automatically. Make recipient failures observable.
```

| Done when | Testing/proof |
|---|---|
| Only the previewed rooms hear the announcement; unrelated rooms remain unaffected | Per-target integration assertions and real distinct-room test audio |
| No cross-room return audio or accidental camera/screen publication | Track/grant inspection and two-device observations |
| Stop, permission loss and reconnect behave safely; failures are visible | Inject each interruption and verify stopped publication and target status |

**Recording:** synthetic selected-room broadcast plus an excluded room and a forced interruption.
**Git:** `spike/p1-03-announcements`; `feat(spike): prove isolated targeted announcements`.

### P1-04 — Prove shared video and announcement interruption

**Depends on:** P1-03. **Skills:** `debrio-realtime-media`, `debrio-access-and-data`, `playwright`.

**Prompt:**

```text
Use safe test resources to prove individual viewing and one-controller group
play/pause/seek. Keep each viewer's volume local and resource permissions
independent from media-room visits. Pause controlled videos on targeted spoken
announcements and require explicit resume afterward. Test uploaded video and
the linked-player candidates; label unsupported sources as link-outs. Measure
drift and show buffering/autoplay/controller-loss recovery honestly.
```

| Done when | Testing/proof |
|---|---|
| Authorized viewers share state without broadening resource access | Controller/grant tests, copied-link denial and real multi-client playback |
| Targeted announcement pause and explicit resume work without affecting unrelated rooms | Integration assertions and visible playback before/during/after announcement |
| Supported-source limits and measured recovery/drift are documented | Real supported-player matrix; autoplay, buffering, late-join and controller-loss trials |

**Recording:** synthetic shared playback/seek, announcement pause/resume, and one blocked-player recovery.
**Git:** `spike/p1-04-video-playback`; `feat(spike): prove synchronized video and announcement pause`.

### P1-05 — Prove captions and screen-presenter handover

**Depends on:** P1-04. **Skills:** `debrio-realtime-media`, `debrio-access-and-data`, `playwright`, `security-best-practices`.

**Prompt:**

```text
Validate live captions for authorized conversation and announcements, with
individual display controls and no retained transcript. Demonstrate supplied
captions on uploaded/supported linked videos. Validate one screen presenter
per room and explicit handover/exit cleanup. Measure quality, latency, language
support and cost, and record any blocking provider/browser limitation.
```

| Done when | Testing/proof |
|---|---|
| Captions are usable and follow audience permissions through switches/reconnect | Distinct-room test speech, negative subscription tests, manual caption assessment |
| Video caption controls work; missing captions are detectable | Actual player checks, keyboard controls and missing-caption readiness case |
| Screen sharing is room-scoped and handover/exit terminates prior publication | Real screen-share trials; inspect publication state after exit/revocation |

**Recording:** generated/test speech and synthetic screen content only; show caption isolation and handover.
**Git:** `spike/p1-05-captions-sharing`; `feat(spike): validate captions and screen handover`.

### P1-06 — Decide whether the media foundation passes

**Depends on:** P1-01 through P1-05. **Skills:** `debrio-testing-and-release`, `debrio-realtime-media`, `verify-and-stop`, Matt `domain-modeling`; Ponytail review/debt.

**Prompt:**

```text
Evaluate the PRD media gate using the actual probe evidence. Produce a supported
browser/device/video/caption matrix, explicit limits, measured cost model and
unresolved failures. Test media remaining connected while Debrio/control services
fail: revocation, participant withdrawal and session expiry must meet documented
authorization freshness bounds, with no stale access restored on recovery. Include
aggregate allowance/headroom evidence and the planned three-session workspace cap;
full published concurrent-capacity proof remains a release gate. Accept or reject the candidate only with evidence and the
decision owner's confirmation. Update architecture/ADR status; identify reusable
probe code without treating test shortcuts as production controls. Do not begin
the full build if required media or isolation proof remains unverified.
```

| Done when | Testing/proof |
|---|---|
| Every PRD section 10 gate item has Pass/Fail/Unverified and evidence | Criterion-to-run/artifact mapping; repeat only missing/stale/failed checks |
| Provider choice, supported limits and measurable bounds are accepted or clearly blocked | Recorded decision and documented alternative if the candidate fails |
| No open leak, data-loss or missing-required-caption issue is hidden by a summary | Independent gate review and shortcut/debt disposition |

**Recording:** link verified probe demos; add one concise synthetic integrated demonstration if existing clips do not cover the gate.
**Git:** `docs/p1-06-media-gate`; `docs(media): record feasibility evidence and operating limits`. A pushed report is not an accepted gate without the required evidence/decision.

## Phase 2 — Run a simple session

### P2-01 — Admit people to a managed session

**Depends on:** P1-06 accepted; P0 architecture updated. **Skills:** `debrio-access-and-data`, `security-best-practices`, `impeccable`, `playwright`.

**Prompt:**

```text
Deliver facilitator authentication plus scoped guest invitations, lobby,
admission, removal, session lock, and scoped co-facilitator delegation. The lead
can designate a successor. Authorized co-facilitators continue within delegated
permissions on lead disconnect; otherwise keep participants in the current activity,
show the disruption and never automatically promote anyone or reset the deadline. Include
one-person workspace creation/ownership and
onboarding for independent trainers/consultants without a company, corporate
email or second staff member. Grant explicit session facilitation permissions.
Apply the accepted identity design. Capability grants/revocation must affect active routes;
an administrator does not automatically gain listening access. A
participant joins one session without a paid account and receives only its
authorized task/media context. Enforce server and existing-connection revocation.
Use one stable participant identity per person within a session for work and
assignments, independent of browser/media connections. On signed-in entry, link
it to the verified authenticated account; leave the account reference empty for
guests. Never infer or merge identities from names or entered email addresses.
Account linkage grants neither admission nor workspace membership and never
automatically merges existing guest work. Keep identities and permissions separate
across sessions, including sessions attended by the same account. Verify guest and
signed-in entry, forged account IDs, duplicate names, reconnect/display-name changes,
and cross-session access denial. Later guest-to-account conversion remains undecided.
Use shared-link/lobby admission with stable private guest identities. A facilitator
verifies the person before lost-identity/new-device recovery, restores their work
and assignments, and revokes the old endpoint. Shared links/names alone grant no
existing private identity. Test recovery racing with old-device writes/media.
Require two-factor authentication for the platform operator, workspace owners and
billing/data administrators. Enforce enrollment on privileged-role assignment and
reauthenticate sensitive actions; facilitator-only MFA is optional, guests unchanged.
Prove host recovery, expired/reused links, credential/contact changes, sign-out,
mail failure and stale-session denial separately from guest identity recovery.
Secure MFA recovery must not bypass identity verification or silently remove protection.
Maintain exactly one primary owner per active workspace, with explicitly delegated
administrators rather than equal co-owners. Implement recipient-accepted ownership
transfer atomically; prevent owner removal without accepted transfer or explicit
closure. Specify verified recovery when the owner is unavailable. Creator departure preserves
workspace-owned reusable content/authorship and revokes that person's access.
Support one account in multiple workspaces with an explicit switcher. Keep
permissions, content, subscriptions and the owner exemption scoped to each workspace.
Test stale requests/connections and open tabs across switching and membership removal.
```

| Done when | Testing/proof |
|---|---|
| An individual can create their workspace, become its authorized facilitator, invite/admit guests and lock/end access without a company or team | API/database integration plus individual-owner/facilitator/guest browser flow; workspace isolation and organization onboarding regression |
| Admission/recovery, membership and ownership changes preserve isolation and exactly one primary owner per active workspace | Copied-link/name denial, verified recovery/old-device races, recipient acceptance/decline, owner-removal/concurrent-transfer checks, unavailable-owner recovery, delegated-admin boundaries, creator departure, workspace switching/stale requests, privileged MFA/role-upgrade/recovery/reauthentication, host-session invalidation and no platform exemption inherited |
| Device denial, auth failures and lead disconnection are accessible and recoverable | Keyboard/focus/error-state browser checks; no secrets in client payloads; delegated continuation, no-delegate disruption and no automatic promotion |

**Recording:** synthetic invitation/admission followed by expired or removed-guest denial.
**Git:** `feat/p2-01-session-admission`; `feat(session): add scoped invitations and admission`.

### P2-02 — Prepare and run a reusable custom agenda

**Depends on:** P2-01. **Skills:** Matt `codebase-design`, `domain-modeling`; `debrio-session-execution`, `debrio-access-and-data`, `impeccable`, `playwright`.

**Prompt:**

```text
Let a facilitator create, save, duplicate and run a simple linear agenda with
instructions, timing, groups and output schemas, plus objectives/checklists and
unmapped-step warnings. Keep a stable workshop definition identity and separate
draft/ready versions. Explicit Ready to run validates and freezes configuration
and its rubric/resource-version references; later edits create a new draft.
Require a ready version for live start, retain each session's selected version,
and keep logged live overrides separate from the immutable source version.
Frozen references never bypass revocation, deletion or retention. Session admission,
capacity and runtime prerequisite checks remain independent of version readiness.
Validate fixed prior-output inputs and missing/invalid dependencies.
Provide isolated rehearsal, manual/random assignment preview, and
live extend/skip/reorder/partial-prerequisite overrides with recorded reasons.
Starting a stage updates
the participant task after a preview/confirmation. Disclose group sharing within
the workshop before contribution; it does not permit external-client sharing or
private individual/observer-feedback disclosure. Enforce a separate four-hour
session deadline from entering Live; activity pause/extension/reconnect cannot
reset it. End an abandoned session at that original deadline even if the facilitator
never returns; use the effective deadline for retention, not a delayed cleanup time.
Never-launched workshop drafts remain reusable preparation content.
Warn before closure and preserve acknowledged work without auto-submission.
Enforce at most three live workshops per workspace using atomic admission, with
separate measured global/allowance headroom. Started sessions with paused activities
or disconnected hosts still count; drafts/ended sessions do not. Deny a fourth
start clearly without interrupting existing sessions. Test competing starts, retries,
end/start races and stale capacity reservations without exceeding either limit.
Persist reconciliation intent with committed transitions; a bounded runner rechecks
current authorization and superseded revisions after crashes before media actions.
Activity timers only prompt. Duplicate
configuration without personal records, live state or approvals. Establish
Debrio DESIGN.md and reusable accessible controls for this actual UI.
```

| Done when | Testing/proof |
|---|---|
| Saved/reloaded/duplicated agendas retain objectives, schemas, differentiated tasks and fixed input references; explicit Ready to run freezes a version and rehearsal is isolated | Persistence integration and browser draft/ready/run/duplicate/rehearse flow; draft-start rejection, concurrent edit/freeze, new-draft isolation, existing-session version stability and separate live overrides |
| Duplicate advance, invalid dependencies and competing live changes cannot corrupt stages or consumed inputs | Transaction/concurrency/idempotency tests, forward/cyclic/missing-input cases; three-session cap, racing fourth starts, global headroom and commit-before-dispatch crash recovery |
| Participants see one current task; timeouts never force completion and live adaptations require explicit control | Extend/skip/reorder/partial-override browser checks, keyboard use, no copied personal records; absent-host deadline, delayed cleanup, preserved drafts/no auto-submission |

**Recording:** synthetic author/save/duplicate/run flow and duplicate/blocked transition.
**Git:** `feat/p2-02-custom-agendas`; `feat(agenda): add reusable facilitator-controlled stages`.

### P2-03 — Preserve participant work through interruption

**Depends on:** P2-02. **Skills:** `debrio-session-execution`, `debrio-access-and-data`, `migration` if schema changes; `playwright`.

**Prompt:**

```text
Use one submission model for individual and group work, with exactly one owner:
a participant session identity or a group. Record the submitter separately;
validate individual self-submission or the current group recorder. Freeze all
assigned group contributors at submission, including verbal contributors, and
preserve ownership/rosters through recorder replacement and membership changes.
Deliver individual and group drafts/submissions with explicit saving, saved,
unsaved and conflict states. Use structured group contributions and a designated
recorder submitting; no simultaneous rich-text editor. Specify field/conflict/
recorder permissions before coding. Facilitator can replace the recorder while
preserving draft and attribution; only the current recorder can submit. Test
replacement racing with submission. Validate required fields and support explicit
acceptance of partial work; never infer submission from timer expiry. Freeze
submitted versions and attribution. Corrections while the activity accepts work
create linked versions; after closure an authorized facilitator must reopen corrections.
Never silently update consumed downstream snapshots or earlier publication approvals.
Test authorized/denied reopening, concurrent corrections and unchanged consumed inputs. Recover
acknowledged work after refresh, disconnect and service restart. Reconcile
stage/room transfers without duplicating submissions or overwriting concurrent work.
Kill execution after state commit but before provider reconciliation, then replay
duplicate/superseded intents. Prove work survives and obsolete permissions/actions
are not restored; do not rely on a browser retry to finish acknowledged operations.
```

| Done when | Testing/proof |
|---|---|
| Acknowledged submissions survive restart with exactly one owner, an authorized submitter and preserved contributor attribution | Real database restart/retry/concurrency tests; missing/dual owner and cross-session owner denial, recorder-replacement/membership/submission races, immutable contributor rosters; commit-before-provider-action crash and duplicate/superseded reconciliation |
| Conflicts, unacknowledged edits and incomplete required fields are visible; partial acceptance is explicit | Two-client conflict/network tests and incomplete/partial-submission browser flows; closed-write denial, authorized reopening and immutable downstream/approval versions |
| A reconnect restores the permitted stage/work without extra privilege or duplicate submission | Negative access plus idempotent recovery tests |

**Recording:** synthetic edit/save, forced outage, reconnect and explicit conflict resolution.
**Git:** `feat/p2-03-durable-work`; `feat(work): preserve submissions and recover interrupted edits`.

## Phase 3 — Facilitate with resources and media

### P3-01 — Allocate and release resources safely

**Depends on:** P2-03. **Skills:** `debrio-access-and-data`, `security-best-practices`, `debrio-session-execution`, `playwright`.

**Prompt:**

```text
Deliver text/file/video/link resources assigned to named individuals, groups,
roles or a shared audience. Support start/activity/manual release with preview.
Implement the accepted upload validation/storage policy and protected access.
After reassignment preserve access to contributed submitted group snapshots, subject
to revocation/retention; remove former-group private resources and ongoing/future drafts
unless independently assigned. A new group member receives the current activity's
shared draft and subsequent group work while assigned, subject to current permissions;
earlier submissions require an explicit sharing or activity-routing grant. Preserve
separate individual-answer/private-feedback permissions. Test joins before/after
submission, leave/rejoin, simultaneous membership/submission changes, approved
historical grants and direct URL/read denial, including alternate views and exports.
Route fixed submitted output snapshots as read-only resources to assigned
reviewers, preserving authorship and forbidding source edits or unrelated access.
Keep room visits independent from assignments; hide unreleased metadata. Include
release notifications, retry-safe delivery and explicit revocation limitations.
```

| Done when | Testing/proof |
|---|---|
| Each allowed audience receives the correct version at the configured time, including fixed prior-output inputs | Assignment/release/routing tests; later source revision does not change an assigned snapshot |
| Other recipients cannot read metadata, captions, files or URLs before/after revocation | Cross-person/group/session/organization direct-access and reconnect tests |
| Invalid uploads and repeated release cannot corrupt or duplicate resources | Boundary validation and retry tests; safe rendering inspection |

**Recording:** synthetic private brief, group resource, manual release, denied recipient and room-visit example.
**Git:** `feat/p3-01-resource-release`; `feat(resources): add scoped allocation and staged release`.

### P3-02 — Integrate the meeting and monitoring experience

**Depends on:** P3-01 and accepted probe paths. **Skills:** `debrio-realtime-media`, `debrio-access-and-data`, `impeccable`, `playwright`.

**Prompt:**

```text
Integrate verified media paths into the session UI: main room, breakouts,
optional cameras, screen sharing, Listen/Speak/Join/Scan/Stop, device selection,
captions and recoverable transfer states. Make current room, monitored room and
transmitting state unambiguous. Add facilitator mute/request-unmute without
remote microphone activation, explicit presenter handover, and confirmed breakout
closure/countdown with failed returns listed. Reuse the proven provider integration; remove
probe bypasses and keep task work usable when media fails.
```

| Done when | Testing/proof |
|---|---|
| Facilitator and participant can complete room/monitoring, moderation, handover and return-countdown actions | Multi-user browser and real-media trials; request-unmute cannot silently activate a microphone |
| Old grants stop on role loss/removal/end; failed transfers preserve work | Integrated negative authorization and forced-failure tests |
| Critical controls are keyboard accessible with clear state and device recovery | Accessibility inspection, console/network checks, caption controls |

**Recording:** synthetic meeting/monitoring walkthrough including device or transfer failure.
**Git:** `feat/p3-02-meeting-controls`; `feat(meeting): integrate visible monitoring and recovery`.

### P3-03 — Deliver help and targeted announcements

**Depends on:** P3-02. **Skills:** `debrio-session-execution`, `debrio-access-and-data`, `debrio-realtime-media`, `impeccable`, `playwright`.

**Prompt:**

```text
Let participants request help with optional text. Show room/author/age, allow
acknowledgement and a reply or visit, and explicit handling. Show the facilitator
room board with output progress, request age, membership, app freshness and media
availability; missing telemetry is unknown. Add participant chat scoped to the
current authorized room, including reconnect and membership revocation. Add written and
spoken announcements with one/selected/all room preview. Preserve private
request content; distinguish sent/delivered/read and live target failure.
No elaborate ticket-management workflow or participant cross-room messaging.
```

| Done when | Testing/proof |
|---|---|
| Help, room chat and factual room-board status reach only their permitted audience and recover after reconnect | Integration/browser tests for no-text help, ordinary chat, duplicate submit, stale telemetry and membership change |
| Broadcast targets are explicit and never expose the source request to others | Negative audience tests plus real spoken announcement checks |
| Failure/acknowledgement/handled states are truthful and accessible | Failed-delivery injection, keyboard/status checks; broadcast does not auto-handle requests |

**Recording:** synthetic help request, reply/visit, selected-room announcement and excluded room.
**Git:** `feat/p3-03-help-announcements`; `feat(facilitation): add help requests and targeted announcements`.

### P3-04 — Integrate captioned individual and group video

**Depends on:** P3-03. **Skills:** `debrio-realtime-media`, `debrio-access-and-data`, `impeccable`, `playwright`.

**Prompt:**

```text
Connect the proven player to assigned/released production resources. Support
individual viewing and designated-controller group viewing, local volume and
caption controls, supported links, and clear link-out limits. Pause controlled
video for targeted announcements, require explicit resume, and recover from
controller loss, buffering, autoplay denial and reconnect without broadening access.
```

| Done when | Testing/proof |
|---|---|
| Released authorized viewers can use the right viewing mode and captions | Actual player/browser source matrix and controller permission tests |
| Announcement pause/resume affects only intended audiences | Integrated state assertions plus real multi-room video/audio demo |
| Revocation and failure stop unauthorized playback and show useful recovery | Direct URL, stale connection, controller-loss and reconnect tests |

**Recording:** synthetic individual/group video, caption control, announcement interruption and recovery.
**Git:** `feat/p3-04-resource-video`; `feat(video): integrate scoped captioned group playback`.

### P3-05 — Run scoped polls

**Depends on:** P3-03, P2-03 and accepted polling specification. **Skills:** Matt `domain-modeling`, `codebase-design`; `debrio-access-and-data`, `debrio-session-execution`, `playwright`; Blueprint `spec`, `test`; Ponytail Full/review.

**Prompt:**

```text
Implement single-choice and multiple-choice polls. Facilitator previews main-room,
selected-breakout or whole-session audience. Select identified or aggregate-only
mode before opening; snapshot eligible respondents at opening. Room moves do not
change eligibility; explicit removal/revocation still denies access. Newly admitted
participants use later polls unless an inclusion rule is separately accepted.
Privacy mode is immutable after responses begin. Only authorized
facilitators see identified answers; aggregate-only has no named UI/API/export.
Disclose internal identity used for deduplication. Participants revise while open;
facilitator closes to freeze and reveals separately. Ranking/free-text deferred.
Repeating a closed poll creates a fresh round/audience snapshot; never reopen or
merge the original ballots. Freeze question/options at opening; corrections require
a fresh replacement round. Removal denies further access/voting but preserves cast
votes as historical results, subject to authorized deletion. Apply 90-day session
retention and scoped exports preserving the chosen privacy mode. Use server-authorized commands,
stable response identity, durable saves, deduplicated retries and scoped results.
Preserve the separate peer-instruction original/revised-answer sequence.
```

| Done when | Testing/proof |
|---|---|
| Single/multiple-choice polls fix the previewed audience at opening, allow revision until close and reveal separately | Browser target/open/respond/revise/close/reveal; room-move and late-admission isolation; removed-recipient denial; closed-write/unrevealed-result denial |
| Identified/aggregate-only policy cannot change after responses begin and has no unintended named exposure | Cross-participant/group/session/workspace tests; identified-answer denial to participants; aggregate-only named API/UI/export denial and mode-change rejection |
| Responses/results survive retries, reconnect and competing controls without double counting | Real database duplicate/concurrency/restart tests; frozen question/options, replacement separation, retained removed votes and authorized deletion; accessible controls/status and peer-instruction regression |

**Recording:** written spec/test/commit record and synthetic creation, response, result-release and denied-access demo.
**Git:** `feat/p3-05-polling`; `feat(polls): add scoped workshop polling`. Follow standard task-branch commit/push/PR rules after spec decisions are accepted.

## Phase 4 — Run the three formats and debrief

### P4-01 — Run peer instruction end to end

**Depends on:** P3-04. **Skills:** `debrio-session-execution`, `debrio-access-and-data`, `impeccable`, `playwright`.

**Prompt:**

```text
Implement peer instruction through the existing agenda: private individual
answer/rationale, discussion, individual re-answer, controlled anonymous summary
and facilitator debrief. Preserve answer versions and identity. Keep correctness
optional and trainer-authored; do not add an overall learning score or silently
publish named answers. Reconnect resumes the right step without extra submissions.
```

| Done when | Testing/proof |
|---|---|
| Facilitator and participants complete the full sequence with both answer versions preserved | Multi-user E2E plus persistence/version checks |
| Peers cannot read private answers through any response/reveal endpoint | API/browser negative tests and anonymous-summary inspection |
| Missing/late/retried answers and reconnect remain explicit and attributable | Transition/idempotency tests and one interrupted participant flow |

**Recording:** synthetic complete sequence with changed/unchanged answer and private-view contrast.
**Git:** `feat/p4-01-peer-instruction`; `feat(instruction): add private answers and individual retries`.

### P4-02 — Run role practice with fair rotations and retries

**Depends on:** P4-01. **Skills:** `debrio-session-execution`, `debrio-access-and-data`, Matt `codebase-design`; `impeccable`, `playwright`.

**Prompt:**

```text
Implement role briefs, practitioner/counterpart/observer assignments, written
checklist feedback, retry and role rotation. At exactly 20, use four trios and
two groups of four with two observers. Schedule enough rounds for every person
to practise and retry, show outstanding turns, and handle absences/reassignment
without disclosing private briefs or fabricating completion. Keep numerical grading out.
```

| Done when | Testing/proof |
|---|---|
| Every roster member is assigned a practitioner turn and retry; outstanding work is visible | Property/boundary grouping tests plus a complete synthetic 20-person fixture |
| Roles receive only their briefs and appropriately scoped feedback | Negative role/feedback tests through API and participant views |
| Absence/disconnect/waiver preserves history and lets the facilitator recover | Integration tests and browser exception flow, including groups of four |

**Recording:** synthetic trio/quartet examples, observer feedback, retry and one absent-member recovery.
**Git:** `feat/p4-02-role-practice`; `feat(practice): add private roles feedback and fair rotations`.

### P4-03 — Run jigsaw and restore home groups

**Depends on:** P4-02. **Skills:** `debrio-session-execution`, `debrio-access-and-data`, Matt `domain-modeling`; `impeccable`, `playwright`.

**Prompt:**

```text
Implement trainer-defined topics, home/expert assignment preview, expert work,
return to home groups, synthesis and individual transfer. At exactly 20 use
four topics, five home groups of four and four expert groups of five. Preserve
both mappings independently of current media room. Detect missing topic coverage
and require correction or explicit fallback before the dependent stage.
```

| Done when | Testing/proof |
|---|---|
| Participants reach the correct expert group and return to their original home group | Assignment/transition tests and full synthetic 20-person scenario |
| Topic resources follow explicit assignments, not room visits | Cross-group/resource denial and transfer/reconnect tests |
| Missing expert/uneven roster cannot silently leave an impossible allocation | Boundary tests and actual facilitator correction/fallback UI |

**Recording:** synthetic home/expert/home movement, resource distinction and missing-expert recovery.
**Git:** `feat/p4-03-jigsaw`; `feat(jigsaw): add expert regrouping and home-group recovery`.

### P4-04 — Curate, approve, and export the debrief

**Depends on:** P4-03. **Skills:** `debrio-access-and-data`, `debrio-session-execution`, `security-best-practices`, `impeccable`, `playwright`.

**Prompt:**

```text
Let the facilitator pin/order permitted answers, feedback and group outputs,
compare revisions, and present a debrief. Request author approval for the exact
identifiable individual item/version/audience. Decline must not block participation.
Keep group sharing rules explicit. Provide scoped participant summary and CSV/JSON
exports with provenance and no overall learning score or private-content bypass.
Support post-session return through the private participant identity during the
90-day retention period, subject to revocation/deletion and resource permissions.
Shared session links cannot unlock history; lost access uses facilitator-verified
recovery that revokes the old endpoint. Test return, expiry, copied-link denial
and cross-participant access, including recovery after session end.
For identifiable feedback shared beyond its original audience, collect separate
author and subject approvals for the exact version/audience; either missing,
declined or withdrawn approval blocks the expanded publication.
External-client publication of group submissions needs every contributing member's
exact-version/audience approval; the recorder cannot consent for others. Snapshot
every assigned group member at submission, including verbal contributors, as the
required approver set. Preserve that set across
membership changes rather than dropping an approver to make sharing pass.
Record explicit confirmed decisions/actions separately from suggestions; include
permitted action/timing/intervention history without treating votes as agreement.
Allow explicitly invited client contacts to view a curated read-only summary.
Verify the invited email, bind access to that contact/session and require no paid
account. A public link alone grants nothing. Test wrong-email and revoked access.
Only include material approved for that client audience; session-only approvals
are insufficient. Deny private answers/feedback, other sessions and administration.
Client grants last 30 days; enforce earlier revocation/source expiry/withdrawal.
Unredeemed invitations expire after seven days. Re-verification or replacement
invitation cannot silently restart an existing 30-day grant. Test both deadlines.
```

| Done when | Testing/proof |
|---|---|
| Expanded feedback needs author/subject approval; external group submissions need every required contributor's approval | Debrief/summary/export negative tests for missing/declined/withdrawn/changed approvals; recorder-only and membership-change bypass denial |
| Participants can preview/decline without blocking the activity | Multi-user browser flow with approved and declined items; private-identity post-session return/recovery/export and shared-link/expired/revoked denial |
| Review/exports and invited-client read-only summaries preserve scope, provenance and action confirmation | Verified invited-email and client-audience approval checks; deny wrong-email/public-link-only, private/other-session/admin access, stale invitations and unapproved publication |

**Recording:** synthetic selection/approval/decline, revision invalidation and permitted export.
**Git:** `feat/p4-04-debrief`; `feat(debrief): add item approval and scoped evidence exports`.

### P4-05 — Implement privacy choices and the data lifecycle

**Depends on:** P4-04 and accepted retention/withdrawal policy. **Skills:** `debrio-access-and-data`, `debrio-realtime-media`, `migration`, `security-best-practices`, `playwright`.

**Prompt:**

```text
Implement the agreed participant notices, monitoring-withdrawal path, scoped
data access/export/deletion and retention handling. Verified early-deletion requests
are handled by the workspace owner or explicitly delegated data administrator, within
authorized scope. Remove affected personal evidence and dependent publications;
preserve separable contributions from other members where possible. Inseparable
joint records require explicit review, not automatic whole-group deletion. Keep
publication withdrawal immediate and separate. Test unauthorized requests, shared
contribution boundaries, dependent copies and interrupted/retried deletion. Withdrawal stops future
monitoring access and exposes the accepted task-only/leave path; it cannot recall
audio already heard. Apply deletion/retention to linked attempts, approvals,
publication copies, uploads/captions and operational records under the accepted
policy, and disclose backup/external-copy limits. Keep recording/transcript
retention disabled. Resolve missing policy choices before destructive automation.
Retain session outputs/responses/feedback/polls/messages for 90 days after session
end unless authorized deletion occurs earlier. Reusable workspace agendas/resources
persist while entitled and become read-only/exportable for 90 days after entitlement
ends, with deletion warnings. Reactivation restores reusable editing, never expired
participant records. Preserve content when its creator leaves. Settle log/backup
policies; test both independent expiry clocks. Abandoned sessions end at the original
four-hour deadline, which starts retention even if cleanup executes later.
Implement immediate participant-selected task-only withdrawal without facilitator
approval: stop live audio/video and caption processing, show the facilitator the
task-only status, preserve permitted written work and require explicit media rejoin.
Test active routes and reconnect so withdrawal cannot be silently undone.
Test 90-day content expiry together with seven-day invitations and 30-day client
grants: later grants cannot revive expired content or withdrawn publication.
Record enough recovery information to reapply deletion/revocation/absolute expiry
to restored data before reopening access; include linked object files and approvals.
Coordinate account closure across each workspace, ownership transfer/closure and
authorized Stripe cancellation without deleting another workspace's shared work.
```

| Done when | Testing/proof |
|---|---|
| Participant notices and withdrawal behave according to the accepted policy | Multi-user browser plus active-grant test; no hidden monitoring after withdrawal |
| Authorized lifecycle actions follow linked data and do not delete another user's/session's records | Real database/storage fixtures, verified requester/authorized administrator, separable/joint contributions, dependent publications, protected scope, retry and interrupted-job tests |
| Retention, backup expiry and provider limits are explicit and executable where required | Synthetic age-boundary retention/deletion test, recoverable job failure, configuration inspection; no production data used |

**Recording:** synthetic withdrawal and permitted lifecycle flow; no real-person data or live-session capture.
**Git:** `feat/p4-05-privacy-lifecycle`; `feat(privacy): enforce monitoring withdrawal and data lifecycle`.

### P4-06 — Deliver transactional workshop communications

**Depends on:** P4-05, P2-01 and P0-02's accepted communications policy/provider. **Skills:** Matt `domain-modeling`, `codebase-design`; `debrio-access-and-data`, `debrio-testing-and-release`, `security-best-practices`, `playwright`; Blueprint `spec`, `test`; Ponytail Full/review.

**Prompt:**

```text
Implement COMMUNICATIONS.md's accepted transactional-only scope: auth email
configuration, workspace/workshop invitations, reminders, reschedules and
cancellations, with existing in-app status. Preserve guest admission without
requiring an email address. Use Postmark transactional mail and its documented
webhook authentication; P2-01 already owns functional Auth SMTP delivery. Use
a durable retryable dispatch path; recheck current audience, schedule version,
preferences and suppression at send time. Add scoped delivery status, provider
webhook verification, deduplication, bounded retries and operator recovery.
Use accessible escaped templates with authorized links and minimal content.
Keep rehearsal/test sends in a mail sink or approved test-recipient allowlist.
Prove actual provider delivery only with explicitly authorized test addresses.
Read the Debrio contract instead of importing Myelin notification defaults.
Billing integration belongs to P6-03; marketing campaigns are excluded.
```

| Done when | Testing/proof |
|---|---|
| Accepted account/invitation/reminder/change flows reach only permitted recipients with usable links and accessible templates | Synthetic email preview/in-app demo; auth and expired/revoked links; cross-workspace/recipient denial, escaping and email-free guest admission tests |
| Scheduling, preferences and reliable delivery survive changes and failures | Real database outbox/concurrency tests; duplicate/ambiguous send, outage/retry, cancellation/reschedule, timezone/DST and preference-change scenarios; authenticated Postmark webhook replay/reordering and bounce/complaint suppression |
| Sender settings, evidence and recovery match the accepted policy | Domain/SMTP/provider inspection, authorized test-address delivery evidence, rate limits, delivery-status accuracy, redacted logs and test-recipient isolation; unavailable provider proof stays Unverified |

**Recording:** written task/test/commit record and synthetic email-preview/in-app demo; no real recipient data, secret tokens or participant sessions.
**Git:** `feat/p4-06-transactional-communications`; `feat(comms): deliver scoped workshop notifications`. Follow task-branch commit/push/PR rules; customer messaging and domain/account changes require their applicable authority.

## Phase 5 — Prepare the first pilot

### P6-03 — Implement Stripe workspace subscriptions

**Depends on:** P4-06, P1-06, P0-02's billing architecture, accepted initial offer/coupon policy and authorized Stripe test-environment access. **Skills:** Matt `domain-modeling`, `codebase-design`; `debrio-access-and-data`, `debrio-testing-and-release`, `security-best-practices`; Blueprint `spec`, `test`; Ponytail Full/review.

**Scheduling:** ID retained from the original plan; now execute before P5-01 so coupon-based testers receive the complete product. Actual pilot findings are not a prerequisite for initial billing; they may drive later explicit offer revisions.

**Prompt:**

```text
Implement BILLING.md's accepted organisation/workspace subscription policy
using Stripe Billing, hosted Checkout and the customer portal. Participants
join free. Apply COMMUNICATIONS.md: assign one email owner per billing event,
configure/test supported Stripe notices and required Debrio gaps, and show
in-app billing status only to authorized workspace administrators.
Build the pricing/billing UI and server-authorized purchase/portal
flows with server-owned customer/Price mappings and duplicate-purchase protection.
Support both individual and organisation subscribers; company-only billing
fields must not block a trainer subscribing in their own name. Do not invent
a separate solo/team tier; one complete paid plan is accepted and public free
workspaces are deferred. Add permanent free use only for the verified platform
owner account and its designated owner workspace, with ordinary technical capacity
limits unless explicitly configured. Customer workspaces remain separately billed. It is a server-managed billing
entitlement, not a global access bypass or a transferable customer-owner benefit.
Test forged claims, customer self-upgrade, owner transfer, multi-workspace switching
and exemption stability. Offer monthly billing only; annual billing is deferred.
Cancellation retains paid access through period end before read-only recovery.
Existing paid customers get seven days to resolve failed renewal, with clear notices;
then block new hosting while running sessions keep the original four-hour ceiling.
Test exact period/grace boundaries, recovery, repeated failure events and no resets.
Integrate user-approved tester coupons/promotion codes through normal Checkout,
with 100% subscription discount for 30 days from redemption, no card required and
one discount per invited workspace. Extensions require the platform operator's approval;
retries/repeated redemption cannot reset time. Display the exact end date.
No automatic paid renewal: test no-charge expiry even with a saved payment method;
paid continuation requires explicit opt-in to the displayed price/interval.
Do not implement a manual entitlement bypass. Test zero-total activation against
authoritative subscription/invoice state, not a positive-payment requirement.
At tester expiry preserve read-only work/permitted exports under retention, block
new hosting and let already-running sessions finish within four hours of the
original Live start. Activity extensions/reconnect never reset this deadline.
Settle late-admission policy; test expiry racing with session start,
redemption retries, unauthorized extensions and no timer resets on reconnect.
Synchronize scoped entitlements through verified, idempotent webhooks and
reconciliation. Handle retries, reordered events and concurrent updates safely.
Enforce plan limits and the accepted session-continuity/cancellation policy
without granting resource or monitoring privileges through billing ownership.
Use current official Stripe documentation. Keep test/live data isolated.
Add operational recovery instructions and synthetic evidence. Live activation
and real charges require their own concrete authorization; do not perform them.
```

| Done when | Testing/proof |
|---|---|
| Solo/organisation customers use one paid plan; invited testers redeem approved discounts; only the platform owner has permanent exemption | Test-mode checkout/portal/coupon cases, concurrency and zero-total activation; verified operator exemption, forged-client/customer-owner/transfer denial; no public free workspace bypass |
| Entitlements match the subscription and 30-day coupon lifecycle despite missed, duplicate, reordered or concurrent events | No-card zero-total redemption; exact expiry, no-charge expiry with saved card, no automatic paid renewal, one-discount limit and denied workspace-owner extension; webhook/database/reconciliation proof |
| Plan limits, session continuity, billing notices and operating recovery are demonstrated | New start, active workshop, late join/reconnect, seven-day grace expiry, period-end cancellation and retained-data checks; billing audience/sender/deduplication and configured notice tests; test/live separation and redacted logs; reviewed recovery and live-configuration checklist |

**Recording:** written policy/test/commit evidence plus a synthetic Stripe test-environment purchase, portal and lifecycle demo; hide credentials/payment details and never record real customers.
**Git:** `feat/p6-03-stripe-subscriptions`; `feat(billing): add Stripe workspace subscriptions`. Follow the task-branch push/PR workflow; do not activate live billing from this card.

### P5-01 — Verify integrated resilience, isolation, and accessibility

**Depends on:** P4-06, P3-05 and P6-03 (moved before this task). **Skills:** `debrio-testing-and-release`, all affected Debrio skills, `security-best-practices`, `playwright`, `test`, Ponytail audit/debt.

**Prompt:**

```text
Run the PRD acceptance scenarios against the integrated build. Cover cross-user/
group/session/organization boundaries, stale connections, duplicated actions,
restarts, failed room transfers, unpublished approvals and direct resource access.
Audit keyboard/focus, screen-reader states, contrast, captions and device-denied
paths. Review the complete delivered surface and actual shortcut debt. Fix only
identified in-scope defects, each with regression proof.
Include an independent trainer creating a one-person workspace, preparing and
running a client session, then reviewing permitted work without company/team setup.
Include normal subscription checkout, tester coupon redemption, billing portal,
configured coupon-end behavior and denied/ineligible redemption in test mode.
Run the R1-R8 dependency fault matrix: database, task notifications, auth/email,
media/captions, files and Stripe. Verify truthful saving/failed/pending states,
accessible recovery, partial outages, stale grants and delayed commands. Cover
privileged MFA/host recovery, account closure across subscriptions/workspaces,
three-session admission races and recovery of committed but undispatched actions.
```

| Done when | Testing/proof |
|---|---|
| Every integrated acceptance case has current evidence and no unresolved blocking defect | Criterion matrix with automated, browser and real-media results distinguished |
| Critical privacy/recovery/accessibility paths pass under injected failure | Dependency fault matrix R1-R8, host/MFA/closure and concurrent-admission tests plus manual assistive/keyboard checks |
| Audit findings and shortcuts have evidence-based dispositions | Independent review, updated records and narrow regression tests for fixes |

**Recording:** synthetic failure/recovery montage with links to original format demos; no live users.
**Git:** `test/p5-01-integrated-proof`; `test(session): verify integrated isolation and recovery`. Separate a substantial fix into a linked focused PR rather than hiding it in test-only scope.

### P5-02 — Operate a recoverable staging environment

**Depends on:** P5-01 and accepted hosting/budget. **Skills:** `debrio-testing-and-release`, `migration`, `security-best-practices`; relevant AWS skills only if AWS was selected; Ponytail Full.

**Prompt:**

```text
Provision/deploy only the explicitly authorized staging resources. Add redacted
operational logs, health checks, alerts for the critical failure paths, usage/cost
visibility, backup/restore and migration rollback procedures. Define support owner
and incident actions for media/device admission, permission failures and lost-control
recovery. Restore a backup predating deletion/revocation/expiry, reconcile database
and objects plus current Stripe entitlements, and verify access stays quarantined
until safe. Measure recovery time and lost acknowledged writes. Drill active older
clients/workers across deployment, writes after deploy, pending saves, reconnect
and rollback; defer incompatible releases until active sessions finish.
Exercise alerts through the actual authorized contact destination, acknowledgement,
runbook action and recovery verification. Publish support hours/timezone and incident/
contact information for paid launch; confirm named live pilot coverage before testing.
Do not record raw live media or retained transcripts in diagnostics.
```

| Done when | Testing/proof |
|---|---|
| Staging runs the candidate securely with no production data/secrets in evidence | Deployment/config inspection and scoped smoke tests |
| Restore and rollback recover agreed data/version behavior | Isolated database/object restore with deletion/revocation/expiry/billing reconciliation; active old/new-client migration/rollback drill including post-deploy writes; measured recovery time/data loss |
| Critical failures generate useful redacted alerts within defined operating limits | Inject failures through actual alert receipt, acknowledgement, runbook action and recovery; verify named coverage, support/contact information and usage/headroom controls |

**Recording:** synthetic staging recovery/restore demonstration with secret-bearing screens excluded.
**Git:** `ops/p5-02-staging-recovery`; `chore(ops): add staging observability and recovery drills`. Deployment is separate from Git push and requires the task's concrete staging authorization.

### P5-03 — Certify readiness for the actual 20-plus-person pilot

**Depends on:** P5-02 and a confirmed partner/roster/accommodations. **Skills:** `debrio-testing-and-release`, `debrio-realtime-media`, `verify-and-stop`, Ponytail review/debt.

**Prompt:**

```text
Prepare the actual pilot agenda covering all three formats, at least 20 people
and one facilitator. Validate the real concurrent room requirements, including
six role-practice rooms at exactly 20. Rehearse the full configuration, media/caption
matrix, assignments, recovery and support plan. Agree session length, baseline
coordination/preparation measures and success thresholds with the partner.
Verify the complete tester onboarding/subscription/coupon path and reviewed,
explicitly authorized live tester configuration if real Stripe codes are used.
Record the actual discount, duration and end behavior; no unstated renewal charges.
Verify the required workload fits available infrastructure without new spending;
do not waive capabilities or professional acceptance checks to fit a free plan.
Verify remaining allowance/expiry and conservative headroom for admitted sessions
through their original deadline, including combined environments. Exercise the
three-session cap/global admission controls and confirm named live incident coverage.
Do not substitute the later 40-person target or synthetic load for human pilot proof.
```

| Done when | Testing/proof |
|---|---|
| Partner, minimum roster, agenda duration, accommodations and support are confirmed | Readiness record; synthetic rehearsal plus actual device/network preflight evidence |
| Complete workshop, polling, client-summary and subscription/coupon flows pass in the pilot configuration | Candidate matrix, failure drills, approved tester billing configuration/terms and verified no-new-spend operating limits |
| Baseline and evaluation method are agreed before observing outcomes | Recorded criteria and measurement protocol; absent partner is a blocker |

**Recording:** synthetic rehearsal at the pilot configuration. Do not record actual participant preflight conversations.
**Git:** `docs/p5-03-pilot-readiness`; `docs(pilot): record readiness and evaluation protocol`.

## Phase 6 — Observe the first pilot

### P6-01 — Record real pilot findings without recording participants

**Depends on:** P5-03. **Skills:** `debrio-testing-and-release`, `verify-and-stop`; Matt `grill-with-docs` only for new consequential product decisions.

**Prompt:**

```text
Support the authorized pilot with one facilitator and at least 20 actual people
through all three formats. Record written observations and permitted operational
measurements: preparation, coordination, help delays, regrouping, interruptions,
work completeness, debrief burden and participant clarity. Compare with the agreed
baseline and discuss willingness to pay for another delivery. Do not capture live
participant audio/video or preserve captions as a transcript. Mark missing evidence.
```

| Done when | Testing/proof |
|---|---|
| Actual attendance and completion/partial/waived states are distinguished from synthetic tests | Anonymized written pilot record and authorized operational counts |
| Coordination/preparation comparison and repeat-delivery willingness are grounded in observations | Baseline/observed measures and attributed consented feedback without invented metrics |
| Defects and open decisions are actionable and do not rewrite history | Prioritized findings linked to criteria and explicit next tasks |

**Recording:** written live-pilot record only; recreate any demonstrated defect with synthetic data and record that reproduction. No real-participant session video.
**Git:** `docs/p6-01-pilot-findings`; `docs(pilot): record observed delivery and adoption findings`. Keep personal/customer details out of a potentially public repository.

### P6-02 — Resolve pilot blockers and prove the fixes

**Depends on:** P6-01. **Skills:** `investigate-first`, `surgical-patch`, affected Debrio skills; `migration`/`safe-refactor` only if needed; Matt `code-review`; Ponytail review.

**Prompt:**

```text
Take the highest-priority confirmed pilot blocker, reproduce its mechanism
with synthetic fixtures, and fix it at the narrowest responsible layer. Keep
one issue/PR per independent fix. Add a regression test and rerun affected
browser/media paths. Update evidence, limits and the pilot disposition without
expanding to unrelated feature requests. Repeat this task for each blocking finding.
```

| Done when | Testing/proof |
|---|---|
| Each addressed defect has a reproducible trigger and a test that fails before the fix | Before/after regression evidence |
| The fix preserves relevant security/recovery/format behavior | Affected integration/browser/media checks and fresh review |
| All pilot blockers are resolved or explicitly prevent the next gate | Findings register with linked commits/PRs; no unsupported closure |

**Recording:** synthetic before/after reproduction for user-visible/media fixes.
**Git:** `fix/p6-02-<finding-slug>`; `fix(<area>): <specific corrected behavior>`. One normal push/PR per focused finding; the parent card completes only when blocking findings are cleared.

## Phase 7 — Validate scale and release

### P7-01 — Validate 40 participants and eight breakouts

**Depends on:** P6-02. **Skills:** `debrio-testing-and-release`, `debrio-realtime-media`, `investigate-first`; relevant operational skills for the chosen host; Ponytail Full.

**Prompt:**

```text
Validate the later 40-person/eight-breakout configuration against the agreed
capacity and endurance criteria. Measure task/transfer latency, recovery, captions,
announcement targets, synchronized video, resource isolation, device/client load,
relay/egress and cost. Separate synthetic transport load from observed facilitator
workload with real people. Prove three simultaneous workshops in one workspace
at the proposed published per-session configuration and multi-workspace aggregate
load, including reconnect bursts and exhausted headroom. A fourth racing start
must fail without disrupting admitted sessions. Do not advertise three-session
capacity until this evidence and the no-additional-spending checks pass.
Publish only the supported configuration and actual limits.
```

| Done when | Testing/proof |
|---|---|
| Candidate meets agreed latency/endurance/recovery bounds at the declared configuration | Repeatable load runs with versions, network, media settings, distributions and failures |
| Capacity does not compromise grants, captions, broadcasts or saved work | Three-workshop and multi-workspace load; fourth-start/global-headroom denial; scale-time authorization/fault/reconnect and real-device media checks |
| Human workload claims and cost limits have their own evidence | Actual facilitation observation or explicitly unverified claim; no synthetic-human equivalence |

**Recording:** synthetic load/media demo; written human workload observations only.
**Git:** `test/p7-01-capacity`; `test(scale): validate forty participants and eight breakouts`.

### P7-02 — Prepare an independently reviewed release candidate

**Depends on:** P7-01 and P6-03 for paid release. **Skills:** `debrio-testing-and-release`, `security-best-practices`, `verify-and-stop`, Matt `code-review`; Ponytail audit/debt; Blueprint `review`.

**Prompt:**

```text
Pin the release candidate and verify all agreed P0 requirements at its published
limits. Review security, accessibility, isolation, data durability, captions,
recording-disabled settings, migrations, restores, monitoring, usage limits and
support ownership. Verify privileged MFA/secure recovery and accepted support hours,
incident/contact information, named pilot coverage and actual escalation readiness.
Recheck R1-R8 proof, three-session capacity, live-client compatibility and safe restore
against the release candidate. Resolve valid candidate findings.
Include BILLING.md's paid-release tests, accepted offer and live-configuration
review; billing evidence is required before enabling paid subscriptions.
Prepare release notes, rollback plan and concrete deployment steps. Record open commercial/legal/operating
decisions that actually block this release. Do not deploy or merge without authority.
```

| Done when | Testing/proof |
|---|---|
| Candidate has current required CI and no unresolved blocking acceptance/review finding | Criterion matrix, Matt Standards/Spec reports, independent review and exact candidate SHA |
| Backup/rollback/support/cost controls are proven for this candidate | Restore/rollback evidence and approved operational limits/owners |
| Release package is reviewable and publication scope is clear | Release notes, supported matrix, migration steps, evidence links and deployment decision |

**Recording:** synthetic release walkthrough; link earlier evidence when still valid for the candidate.
**Git:** `chore/p7-02-release-candidate`; `chore(release): prepare verified Debrio release candidate`. Leave reviewed PR open pending actual merge/release authority.

### P7-03 — Deploy the authorized release and verify operation

**Depends on:** P7-02 plus explicit authority for the concrete merge/deployment, environment and version. **Skills:** `debrio-testing-and-release`, `migration`, `verify-and-stop`; selected deployment/operations skills; Ponytail Full.

**Prompt:**

```text
Execute only the approved release plan for the identified candidate/environment.
Verify merge/base/candidate identity and final required checks, apply compatible
migrations and deploy with the tested rollback available. Respect the reviewed
active-session compatibility/drain policy and verify retained older clients/workers.
Run scoped post-deploy
smoke tests using synthetic accounts, inspect health/alerts and unexpected usage,
and confirm live-session recording remains off.
For paid release, verify the approved Stripe live Price/customer mapping,
webhook configuration and portal policy; do not make an unapproved real charge.
If the release fails its criteria, use the approved rollback and report the
actual deployed version and data state.
```

| Done when | Testing/proof |
|---|---|
| Authorized version/environment and migration state match the approved plan | Deployment receipt, artifact SHA, migration result and health checks |
| Essential synthetic flows pass after deployment without leaks or retained live media | Admission, room/resource, announcement/caption, save/reconnect and scoped export smoke tests |
| Release or rollback outcome and operating ownership are recorded | Verified deployed version, monitoring/cost observation, incident/rollback receipt if used |

**Recording:** synthetic post-release smoke demo; never capture customer sessions or secrets.
**Git:** `ops/p7-03-release-record` for any resulting documentation/code; `docs(release): record deployment verification`. Deployment does not imply a new code commit; tag or merge only within explicit authority. Record actual pushed/merged/deployed SHAs separately.

## Resume prompt

```text
Resume <TASK-ID>. Read its record, PROGRESS.md, current branch/PR state and
changed files. Verify which tests/review/demo evidence still matches the source.
Continue the existing task branch/PR, preserve unrelated changes, and do only
the remaining work. Keep previous authorization in force within its stated scope.
Report blockers precisely. Do not redo completed phases or mark unavailable
media/human-pilot evidence as passed.
```

## Phase-gate prompt

```text
Evaluate Phase <N> only against its task criteria and PRD gate. Use Ponytail
Full, debrio-testing-and-release and verify-and-stop. Use ponytail-debt and
persist the actual findings when code exists. Review records, current source
and PR/CI receipts; repeat only stale, changed, failed or missing checks.
Return Pass / Fail / Blocked with evidence for each criterion. A completed
document, pushed branch, mock-only demo, or synthetic load run cannot replace
the separate real-media or human-pilot evidence. Update PROGRESS.md honestly.
```
