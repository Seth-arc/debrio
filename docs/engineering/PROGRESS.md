# Debrio progress register

Prepared 17 November 2026. This is an execution index for [PROMPTBOOK.md](PROMPTBOOK.md); all platform tasks below are initially unstarted. The engineering kit itself is documented in [PB-SETUP.md](records/PB-SETUP.md).

Update from observed task evidence. Track local acceptance, demo, review, push/CI, merge, and deployment separately. A phase remains blocked until its gate passes; a future task is not complete because its prompt exists.

| Task | Outcome | State | Local / demo / review | Delivery | Record |
|---|---|---|---|---|---|
| P0-01 | Establish repository workflow and a safe baseline | Complete | AC1–AC3 pass; 3 tests pass; independent implementation review Approve; authorized review protection verified; video N/A | [PR #1](https://github.com/Seth-arc/debrio/pull/1), implementation `b2f409f`; application CI deferred to P0-03; **not merged** | [P0-01](records/P0-01.md) |
| P0-02 | Select the stack and initial architecture | Not started | Not run | Not committed/pushed | Not created |
| P0-03 | Make the application reproducibly build and check | Not started | Not run | Not committed/pushed | Not created |
| P1-01 | Join an isolated multi-room media probe | Not started | Not run | Not committed/pushed | Not created |
| P1-02 | Prove visible listening and safe room switching | Not started | Not run | Not committed/pushed | Not created |
| P1-03 | Prove spoken announcements to explicit audiences | Not started | Not run | Not committed/pushed | Not created |
| P1-04 | Prove shared video and announcement interruption | Not started | Not run | Not committed/pushed | Not created |
| P1-05 | Prove captions and screen-presenter handover | Not started | Not run | Not committed/pushed | Not created |
| P1-06 | Decide whether the media foundation passes | Not started | Not run | Not committed/pushed | Not created |
| P2-01 | Admit people to a managed session | Not started | Not run | Not committed/pushed | Not created |
| P2-02 | Prepare and run a reusable custom agenda | Not started | Not run | Not committed/pushed | Not created |
| P2-03 | Preserve participant work through interruption | Not started | Not run | Not committed/pushed | Not created |
| P3-01 | Allocate and release resources safely | Not started | Not run | Not committed/pushed | Not created |
| P3-02 | Integrate the meeting and monitoring experience | Not started | Not run | Not committed/pushed | Not created |
| P3-03 | Deliver help and targeted announcements | Not started | Not run | Not committed/pushed | Not created |
| P3-04 | Integrate captioned individual and group video | Not started | Not run | Not committed/pushed | Not created |
| P3-05 | Run scoped polls | Not started | Not run | Not committed/pushed | Not created |
| P4-01 | Run peer instruction end to end | Not started | Not run | Not committed/pushed | Not created |
| P4-02 | Run role practice with fair rotations and retries | Not started | Not run | Not committed/pushed | Not created |
| P4-03 | Run jigsaw and restore home groups | Not started | Not run | Not committed/pushed | Not created |
| P4-04 | Curate, approve, and export the debrief | Not started | Not run | Not committed/pushed | Not created |
| P4-05 | Implement privacy choices and the data lifecycle | Not started | Not run | Not committed/pushed | Not created |
| P4-06 | Deliver transactional workshop communications | Not started | Not run | Not committed/pushed | Not created |
| P6-03 | Implement Stripe workspace subscriptions | Not started | Not run | Not committed/pushed | Not created |
| P5-01 | Verify integrated resilience, isolation, and accessibility | Not started | Not run | Not committed/pushed | Not created |
| P5-02 | Operate a recoverable staging environment | Not started | Not run | Not committed/pushed | Not created |
| P5-03 | Certify readiness for the actual 20-plus-person pilot | Not started | Not run | Not committed/pushed | Not created |
| P6-01 | Record real pilot findings without recording participants | Not started | Not run | Not committed/pushed | Not created |
| P6-02 | Resolve pilot blockers and prove the fixes | Not started | Not run | Not committed/pushed | Not created |
| P7-01 | Validate 40 participants and eight breakouts | Not started | Not run | Not committed/pushed | Not created |
| P7-02 | Prepare an independently reviewed release candidate | Not started | Not run | Not committed/pushed | Not created |
| P7-03 | Deploy the authorized release and verify operation | Not started | Not run | Not committed/pushed | Not created |

## Open execution dependencies

Q59-Q61 accepted: maximum three simultaneous live workshops per workspace; two-factor authentication for platform operator, owners and billing/data administrators; published support hours and named live pilot coverage. R1-R8 reliability proof is integrated into existing tasks. These are requirements, not passed tests; all task states remain unchanged.

- Individual trainers/consultants are confirmed users: one-person workspace onboarding belongs to P2-01, complete solo delivery proof to P5-01, and individual billing to P6-03. One complete paid plan is accepted; numeric pricing/allowances and actual owner account/workspace identifiers remain setup inputs; exemption scope is the designated owner workspace; no implementation is claimed.
- Tracker and agent file: GitHub Issues in Seth-arc/debrio and root AGENTS.md, selected and draft accepted during P0-01. No issue/labels created.
- P0-01 verified existing local/remote `main` at `2fceb2d8af0f284a5f8676ed5a3bb5aff5280126`; origin is now Seth-arc/debrio. Earlier unborn-HEAD/conductor notes describe the preparation snapshot. Branch controls and delivery evidence: [P0-01](records/P0-01.md).
- Vercel and modular-application shape chosen; Render excluded. Initial stack accepted: Next.js/TypeScript, Supabase, Postmark and conditional LiveKit. Implementation architecture/account evidence: P0-02; media proof: Phase 1. No new infrastructure spending; complete setup with user-provided tester coupons; allowance verification pending. Domain debrio.app supplied; control/DNS unverified.
- Stripe workspace subscriptions chosen; participants join free. P0-02 accepts billing architecture/pilot access; initial offer/coupon terms require acceptance after feasibility evidence; P6-03 now runs before P5-01 and tester readiness, retaining its ID.
- Poll audience fixed at opening; repeats create fresh rounds preserving results. Opened questions/options frozen; removed votes retained subject to authorized deletion; 90-day retention and scoped exports accepted in P3-05. P5-01 includes integrated verification.
- Tester discounts: 100% for 30 days from redemption, no card, once per invited workspace, operator-approved extensions and explicit paid opt-in. Expiry preserves read-only work/exports under retention; block new hosting, allow active sessions to finish within four hours of original start, without resets. Existing accounts/allowances/credits may be used without extra spending.
- Verified client-summary grants last 30 days, subject to earlier revocation/source expiry/withdrawal. Invitation redemption lasts seven days; reissue cannot silently reset a grant.
- Transactional communications only chosen; marketing excluded. Postmark selected; sender/timing/preferences configuration: P0-02 and COMMUNICATIONS.md. Auth SMTP: P2-01. Application delivery: P4-06 before pilot; billing notices: P6-03.
- Supported media/video/caption limits and accepted feasibility: P1-06.
- Private artifact destination and retention: configure before publishing demo evidence.
- Assisted invitation-only pilot first; prospective East Coast US contact. Partner commitment, at least 20 actual participants, timing, baseline and accommodations remain open: P5-03/P6-01.
- Pilot incident-response ownership and exercised alert/contact path: P5-02/P5-03 before the human pilot. Ongoing operating coverage, observed human workload at later scale and release approval: Phase 7.

No live-participant recording is authorized. Synthetic-data demos and written task records are the evidence policy.
