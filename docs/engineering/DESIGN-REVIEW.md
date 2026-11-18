# Build-plan and architecture interview

Started 17 November 2026 using grill-with-docs, grilling and domain-modeling. This records accepted directions and remaining questions; it does not authorize implementation or provisioning. Only decisions explicitly marked accepted are settled.

## Current status

All numbered design decisions Q1-Q61 are resolved. The later reliability review adds a three-live-workshop workspace cap, privileged-account two-factor authentication and published support hours/named live pilot coverage; its proof requirements are integrated into existing tasks. Q55 selects Postmark in place of the earlier email proposal. Read the [consolidated build baseline](README.md#consolidated-build-baseline), [PRD](../Debrio_PRD_v0.5.md), [accepted stack](STACK-PROPOSAL.md), [billing](BILLING.md) and [communications](COMMUNICATIONS.md) for current requirements. The final accepted decisions and finite readiness checklist appear below.

The chronological material below preserves answers as they were given. Earlier references to unresolved packaging, retention, ownership, polling or providers are historical and superseded by later accepted answers; they must not create new interview rounds. Routine engineering choices are documented and verified in the assigned tasks. A material feasibility/cost conflict must be reported with concrete evidence.

## Historical interview record: first seven-question round

The latest numbered answers supersede earlier recommendations on the same topics. In this round Q7 means polling, not the older free-workspace question.

| Question | Answer and resulting status |
|---|---|
| Q1 | Accepted: consultant-delivered client sessions normally live in the consultant's workspace; clients receive explicitly permitted session access without needing their own subscription or workspace administration. Client-owned delivery with an invited consultant is a later membership decision. |
| Q2 | Accepted: assisted invitation-only pilot first, paid self-service after validation. Final prices/allowances follow cost and buyer evidence and must be settled before billing implementation, not before the prototype. |
| Q3 | Accepted: structured group drafts, visible conflict recovery and a designated recorder submits; no simultaneous rich-text editor initially. Detailed field/conflict/recorder rules remain open. |
| Q4 | Accepted: one application with clear internal modules, one relational database, managed media and narrowly scoped background jobs. Specific providers and runtime details still need evidence/acceptance. |
| Q5 | Prospective pilot contact on the East Coast, USA. Actual partner commitment, participant locations, date, caption/accommodation needs and hosting restrictions remain unconfirmed. |
| Q6 | User says keep the pilot at zero for now; conservatively treat this as no new spending pending clarification of infrastructure cost versus pilot customer price. Domain supplied: debrio.app. Ownership/DNS and provider accounts/credits are not verified; no date supplied. |
| Q7 | Polling is retained in initial scope. Poll types, audience, identity/aggregate visibility, result release, edit/close/reopen semantics and export/retention remain open; ranking is not implicitly approved. |

These answers do not approve the earlier free/trial packaging, exact prices, a free-tier capacity claim, provider activation or domain configuration.

## Follow-up answers Q8–Q14

These answers supersede the provisional budget interpretation and unresolved polling statements above.

| Question | Accepted decision |
|---|---|
| Q8 | The entire setup must be professional and complete; the user will provide tester coupons. No new infrastructure spending. Coupons are customer discounts, not infrastructure credits. Do not cut agreed features or substitute mock/manual billing to meet the budget. Discount amount, term, eligibility and renewal behavior remain open. |
| Q9 | Initial polls support single-choice and multiple-choice; ranking and free-text polls deferred. |
| Q10 | Facilitator targets the main room, selected breakout rooms or whole session; preview audience and restrict responses/results to that audience. |
| Q11 | Facilitator chooses identified or aggregate-only responses before opening; privacy mode cannot change once responses begin. Identified answers are available only to authorized facilitators; participants see revealed aggregates. Aggregate-only mode exposes no named-answer view/export, though internal identity may deduplicate votes; do not promise untraceable anonymity. |
| Q12 | Participants may revise until facilitator closes the poll; closing freezes responses. Results are revealed by a separate facilitator action. |
| Q13 | Consultant can share a curated read-only session summary with an explicitly invited client contact, exposing only approved material, not private answers/feedback, unrelated sessions or workspace administration. Existing approvals must cover the client audience. |
| Q14 | Facilitator may appoint/replace the recorder, preserving draft and attribution; assigned members contribute, only the current recorder submits. |

Delivery consequence: complete billing/coupon support must precede tester onboarding. Retain task ID P6-03 for traceability but execute it before pilot readiness; initial offer and coupon policy need acceptance before that implementation, then can be revisited after the pilot. Assisted onboarding and delayed public rollout do not mean an incomplete product. Provider/cost feasibility remains unverified and cannot be claimed from a zero budget.

## Settled inputs

Latest answers Q49–Q54 are accepted:

| Question | Decision |
|---|---|
| Q49 | Reassigned participants retain access to submitted group-output snapshots they helped produce, subject to explicit revocation/retention. Former-group private resources and ongoing/future drafts require an independent grant. |
| Q50 | Participants can immediately leave live audio/video and caption processing without facilitator approval while continuing permitted written tasks. Show task-only status to the facilitator; media rejoin requires explicit action. |
| Q51 | Opening freezes poll questions/options. Corrections create replacement rounds with fresh responses while preserving original results. |
| Q52 | Removal stops future poll access/voting but preserves already-cast votes as historical results, subject to authorized deletion. |
| Q53 | Participants can return to permitted work/exports during 90-day session retention using their private identity. Shared session links cannot unlock history; lost access requires facilitator-verified recovery. Current resource permissions and revocation still apply. |
| Q54 | An abandoned session ends at its original four-hour deadline; retention starts at that effective end even if cleanup runs later. Preserve saved work without submitting unfinished drafts. Never-launched workshop drafts follow reusable-content policy. |

Interview closure: after these answers, present one final consolidated batch of consequential choices. Resolve routine engineering defaults in the plan with rationale and tests. Provider/account feasibility, actual pilot arrangements and pre-billing commercial inputs remain explicit delivery gates rather than assumed facts or an endless interview.

Latest answers Q42–Q48 are accepted and supersede earlier open scope, interval and membership notes:

| Question | Decision |
|---|---|
| Q42 | Permanent free use applies to the designated owner workspace linked to the verified platform-owner account. Customer workspaces keep separate subscriptions when the owner joins or administers them. |
| Q43 | The owner workspace retains ordinary technical capacity limits; changes require explicit configuration. Free subscription access does not imply unlimited infrastructure usage. |
| Q44 | External group-publication approvers are everyone assigned to the group at submission, including verbal contributors. Preserve that roster snapshot across later membership changes. |
| Q45 | Initial paid plan offers monthly billing only; annual billing deferred. Numeric price/currency and allowances remain open. |
| Q46 | Cancellation stops the next renewal, retains access through the paid period, then enters the agreed read-only recovery period. |
| Q47 | Existing paid customers have seven days to resolve failed renewal with clear notices; afterward block new hosting. An already-running session can finish within its original four-hour limit. |
| Q48 | One account can belong to multiple workspaces through an explicit switcher. Permissions, content and subscriptions remain separate. |

These decisions are planning inputs, not configured billing or tested authorization. Exact owner account/workspace identifiers are deployment inputs; they do not reopen the accepted exemption scope. Provider feasibility and remaining product decisions still require evidence.

Latest answers Q35–Q41 are accepted and supersede earlier packaging/reusable-content proposals:

| Question | Decision |
|---|---|
| Q35 | One paid plan with the complete core feature set for solo trainers and organisations; explicit capacity/usage allowances, numeric price/limits still open. |
| Q36 | Initial public offering is paid subscriptions plus invited tester coupons; permanent public free workspaces deferred. Exception: the user, Debrio's platform owner, has permanent free access. Exact identity/workspace scope of this exception remains to confirm; ordinary customer workspace ownership cannot grant it. |
| Q37 | Reusable agendas/templates/resources persist while workspace entitlement is active until authorized deletion, separately from session-record retention. |
| Q38 | After workspace entitlement ends, reusable content is read-only/exportable/recoverable for 90 days with deletion warnings. Reactivation during that window restores editing; expired participant records are not restored. |
| Q39 | External-client publication of a group submission requires every contributing member's approval for exact content/audience; recorder cannot approve for others. |
| Q40 | Team-workspace agendas/resources belong to the workspace and survive their creator's departure; preserve authorship and remove departing-member access. |
| Q41 | Workspace ownership transfer requires recipient acceptance before the original owner leaves; no removal of last owner without accepted transfer or explicit closure. |

Platform-owner lifetime use is a billing exception, not implicit access to customer workspaces or unlimited provider capacity. Its implementation must be explicitly bound to trusted identity and tested against self-assigned roles, public claims and customer ownership transfers. No owner exemption, customer subscription or provider account has been configured.

Latest answers Q28–Q34 are accepted and override older open-limit/retention/identity notes:

| Question | Decision |
|---|---|
| Q28 | Four-hour session ceiling including post-discount continuation; reconnect/activity extension cannot reset it. Actual capacity/cost needs validation. |
| Q29 | Outputs, responses, feedback, polls and messages normally remain for 90 days after session end, subject to earlier authorized deletion. Reusable agendas/resources need a separate policy. |
| Q30 | Shared session link and facilitator-controlled lobby without participant accounts; distinct stable private identities; the shared link exposes no saved work. |
| Q31 | Facilitator verifies a person before lost-identity/new-device recovery of their work/assignments. A display name alone is insufficient; revoke the previous active endpoint. |
| Q32 | Disclose before contribution that group submissions may be shared within the workshop, without external-client rights or private individual/observer-feedback disclosure. |
| Q33 | Identifiable feedback publication beyond its original audience requires both author and subject approval for the exact version/audience. |
| Q34 | Unredeemed client invitations expire after seven days; verified grants last 30 days subject to earlier revocation/expiry. Replacements cannot silently extend an existing grant. |

These product defaults do not establish provider capacity or statutory retention. Reusable content, abandoned-session timing, post-session guest access, external group publication and backup/log retention remain open.

Latest answers Q21–Q27 are accepted and supersede earlier open-duration/expiry notes:

| Question | Decision |
|---|---|
| Q21 | Tester discount lasts 30 days from redemption; show the exact end date during signup and in billing settings. |
| Q22 | No payment card required for tester redemption; collect payment details only for explicitly chosen paid continuation. |
| Q23 | One tester discount per invited workspace; an extension requires the user's approval. Repeated redemption cannot restart the period. |
| Q24 | After tester expiry, saved work and permitted exports remain read-only within the agreed retention policy; block new workshop hosting and do not immediately delete work. |
| Q25 | A session already running at tester expiry can finish within its configured maximum duration. Exact duration cap and detailed reconnect/admission behavior remain open. |
| Q26 | Repeating a closed poll creates a new round with fresh responses; preserve original results rather than reopening/mixing ballots. |
| Q27 | Verified client-summary access lasts 30 days, subject to earlier consultant revocation, source expiry or withdrawn publication approval. Record grant start/end; invitation redemption lifetime remains open. |

Normal public free/paid packaging is still undecided; these are invited-tester rules, not a permanent free tier. Numeric session limits, evidence retention, invitation expiry and guest recovery remain next decisions.

Latest answers Q15–Q20 are accepted:

| Question | Decision |
|---|---|
| Q15 | Tester coupons cover 100% of the subscription price for a defined period; duration still to decide, not indefinite access. |
| Q16 | Testers explicitly opt in to become paying customers; no automatic paid renewal after the discount. |
| Q17 | Tester codes restricted to invited customers with controlled redemption limits; exact limits remain open. |
| Q18 | Existing accounts, included allowances and available credits may be used only with no additional spending; capacity/terms still require verification. |
| Q19 | Poll eligible audience fixed at opening; room movement cannot transfer a vote or expose another audience's poll. Newly admitted participants use a later poll unless an explicit inclusion mechanism is subsequently accepted. Revocation/removal remains authoritative. |
| Q20 | Client-summary recipient verifies the invited email, needs no paid account, and receives only that contact/session grant; public-link possession alone is insufficient. |

Coupon duration/start, card collection, exact redemption limits, post-expiry access and normal paid offers remain open. Poll reopening/question edits/export/retention and client invitation/grant expiry still need decisions. These answers do not approve provider charges or establish free capacity.

- One workshop product for training and human-run simulations; peer instruction, role practice and jigsaw, plus simple custom agendas.
- First observed pilot: at least 20 participants, one facilitator, all three formats; later validation at 40 participants/eight breakouts.
- Vercel hosting direction; Render excluded. Stripe organisation/workspace subscriptions; participants join free. Transactional communications only.
- No live-session recordings or retained live transcripts; synthetic demo videos and written engineering evidence required.
- Independent trainers and consultants are explicitly supported. An individual may own and subscribe to a one-person workspace without a company, corporate email or team; participants remain free. Solo/team pricing, client-workspace ownership and broader membership rules remain open.
- Group membership, media-room membership and resource grants remain distinct. Definition/session, immutable attempts and exact-version/audience publication approval are established distinctions; see [GLOSSARY.md](../../GLOSSARY.md).
- Q55 subsequently accepts Next.js/TypeScript on Vercel, Supabase, LiveKit as the conditional media/caption candidate and Postmark transactional mail. No application implementation exists in the reviewed files.

## Round 1: foundational decisions

| Question | Open decision | Recommendation, not acceptance |
|---|---|---|
| Q1 | Workspace/customer ownership | Consultant-owned delivery accepted in the latest round; broader membership and transfer remain open |
| Q2 | Delivery milestone | Assisted pilot and evidence-led commercial decisions accepted |
| Q3 | Group drafting/submission | Structured contributions, explicit conflicts and recorder submission accepted |
| Q4 | Application shape | One modular application and relational database accepted; vendors remain proposed |
| Q5 | Pilot geography | East Coast US contact identified; actual audience/constraints remain open |
| Q6 | Budget and timing | Clarified by Q8: no new infrastructure spending; user supplies tester coupons; date remains open |

## Historical branch map (superseded by accepted answers and readiness checklist)

### Commercial branch requested before Round 1 answers

The user asked to discuss free and paid features. The table below preserves earlier proposals, now superseded by the accepted Q35–Q41 decisions above: one complete paid plan, invited testers and the platform-owner exemption. It does not authorize a free preparation tier or implement entitlements. Numeric pricing and allowances remain open.

| Question | Open decision | Recommendation, not acceptance |
|---|---|---|
| Q7 | What a non-paying workspace can do | Free preparation and participant-view preview within limits; a bounded live trial; subscription for ongoing hosted workshops, rather than permanent free live hosting |
| Q8 | Which features the first paid plan includes | All three formats, custom agendas, resource allocation/video, facilitation/announcements, feedback/debrief and scoped exports; accessibility, privacy and recovery accompany every permitted session, including trials |
| Q9 | What drives the initial subscription price | One workspace subscription with explicit included usage/capacity; avoid automatic metered overage charges initially; determine numeric allowances after costs and demand are measured |

After these answers, resolve saved-definition/storage limits, preview boundaries, live-trial start/expiry and eligibility, payment-card requirement, repeat-trial abuse, participant/session/facilitator allowances, exhausted-quota behavior, upgrade/downgrade and post-expiry access. Free participant access remains settled and does not mean free workspace hosting. Preserve separate pilot entitlements and data-retention rules.

- Q1: workspace creation/ownership transfer, staff membership across workspaces, client/session isolation, billing authority, template ownership/sharing, supported concurrent sessions.
- Q2/Q5/Q6: actual pilot partner/content, delivery/support owner, success criteria, provider/account/region choices, budgets, minimum feasibility evidence, fail/continue policy and revised task gates.
- Q3: output field types, edit conflicts, recorder replacement, submit/retry/reopen authority, group-sharing disclosure and mixed-author publication.
- Q4/Q5/Q6: authorization boundary and database policies, durable jobs/reconciliation, caption worker/runtime, media control loss, reconnect/revocation, resource-video formats and delivery.
- Workspace/session policy: guest invitation scope, identity recovery across devices, endpoint takeover, facilitator succession, post-session access and summary retrieval.
- Content lifecycle: publication withdrawal/expiry, retention/deletion/backups, exports and external-copy limits.
- Commercial/communications: plan limits and grace, session continuity, cancellation/proration, notification ownership/timing/preferences and sender setup.
- Engineering operation: tracker/agent conventions, task sizing and dependency ordering, CI/review/merge authority, evidence retention, staging/release and incident responsibilities.

## Findings to reconcile as decisions settle

- Resolved: PRD section 17 states workspace subscriptions supporting individual and organisation customers through one complete paid plan; numeric pricing and allowances remain open.
- The PRD uses workshop for both reusable configuration and a live lifecycle; use Workshop definition and Session consistently. Workspace is also overloaded between the tenant and interface surfaces.
- Resolved: early architecture acceptance no longer requires final prices/allowances. Q8 brings complete billing/coupons before testers: P6-03 accepts an initial offer after feasibility evidence; pilot findings refine it later.
- The initial media probe uses four breakouts; the actual 20-person role-practice arrangement needs six. Make the capacity evidence required at each gate explicit before full build.
- The historical mockup contains superseded simulation/gallery behavior and four visible rooms. Polling is now retained, but its simulated controls do not settle the new polling specification or prove delivery.

## Final decision batch (accepted)

Q55-Q58 are accepted. The user changed the email provider to Postmark in Q55; the other final recommendations were accepted unchanged:

| Question | Proposed decision |
|---|---|
| Q55 | Accept Next.js/TypeScript on Vercel, Supabase data/auth/storage/realtime, LiveKit media/caption candidate and Postmark transactional email as the initial stack. No additional spending; media, captions, isolation and account-capacity proof remain gates. |
| Q56 | Lead delegates explicit co-facilitator capabilities and may designate a successor. Authorized co-facilitators can continue on lead disconnect; otherwise participants retain the current activity, with no automatic promotion or reset of the four-hour deadline. |
| Q57 | Corrections create linked immutable submissions while the activity accepts work; after closure, a facilitator must reopen corrections. Existing downstream input snapshots and publication approvals never silently follow a new version. |
| Q58 | Workspace owner or explicitly delegated data administrator handles verified early-deletion requests within authorized scope. Remove affected personal evidence and dependent publications; preserve separable contributions from other members where possible. Joint records needing indivisible deletion receive explicit review, not automatic whole-group deletion. Publication withdrawal remains independently immediate. |

The numbered design questions are resolved. The accepted plan is consolidated in the PRD and engineering index; readiness checks below remain explicit gates. No implementation, provisioning or deployment was performed. Confirm the consolidated plan as shared understanding before starting implementation, as required by the invoked grilling skill.

### Finite readiness checklist

These are task inputs or evidence gates, not reasons to repeat the design interview:

- P0-02/P1-06: inspect existing provider accounts, allowances/credits, regions and overage controls; prove complete scope can meet the no-additional-spending constraint. Report a concrete blocker if it cannot.
- P0-02 and affected task specifications: document engineering defaults for field types/conflicts, supported attachments/video sources and limits, scheduling/retries, notice timing, coupon redemption deadlines and admission continuity. Validate against the agreed privacy, accessibility, capacity and lifecycle rules; surface only a material scope/cost conflict.
- P0-02/P4-05: choose bounded operational-log and backup lifecycles and verify provider processing/retention settings before real participant data.
- P6-03 before billing implementation: obtain an accepted numeric price/currency/allowances, selling entity/country and refund/tax policy using cost evidence and applicable review. Do not invent business facts or charge customers before these are settled.
- P5-03 before testers: verify owner account/workspace identifiers, domain/sender/support setup, actual tester offers, partner/roster/date and accommodation/language requirements; complete the full-product checks and human/device media evidence.
- P7-03: obtain the applicable concrete release authority after the candidate and evidence are reviewable.

## Accepted reliability follow-up Q59-Q61

| Question | Accepted decision |
|---|---|
| Q59 | Maximum three live workshops per workspace initially; started sessions count through activity pauses and facilitator disconnection. Enforce atomic starts plus verified system-wide/provider headroom; prove all three before offering that capacity. |
| Q60 | Two-factor authentication required for platform operator, workspace owners and billing/data administrators; secure recovery and sensitive-action reauthentication. Guests remain account-free; facilitator-only MFA is optional initially. |
| Q61 | Publish initial paid-service support hours/timezone, incident information and contact route; named live incident coverage for scheduled pilots. Actual owners/contact settings must be confirmed and rehearsed; no 24/7 response guarantee implied. |

See [the reliability review](SAAS-RELIABILITY-REVIEW.md) for R1-R8 findings and proof now incorporated into existing cards. No additional design questions arise from these answers; provider capacity, operating configuration and actual pilot arrangements remain finite readiness gates.

## Evidence status

Project review and independent fresh-context fact-finding were followed by recording the user's decisions in this round. See the accepted application-shape [ADR](../adr/0001-modular-application.md). No runtime/provider tests, commits, pushes or service configuration performed. The numbered design interview is resolved; consolidated-plan confirmation and delivery readiness remain distinct from implementation.
