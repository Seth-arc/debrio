# Requirement ownership

Source: [PRD v0.5](../Debrio_PRD_v0.5.md). Each current P0 requirement has an implementation owner below. Titles are navigation aids; the PRD acceptance criterion remains authoritative. Owners must include the complete requirement in their detailed spec/proof, not just the abbreviated task-card text.

Each owner task tests its own behavior before completion. P5-01 performs integrated verification; P5-03 checks the actual pilot configuration; P7-01 repeats applicable proof at 40 participants/eight rooms. A probe task proves feasibility and does not replace a production implementation owner.

| PRD ID | Requirement | Implementation task(s) |
|---|---|---|
| B01 | Create, duplicate, reorder, save complete workshops | P2-02 |
| B02 | Simple custom stages and composable templates | P2-02 |
| B03 | Configure output schema, timing, roles, and completion policy | P2-02 |
| B04 | Common or differentiated room tasks | P2-02 |
| B05 | Preview and rehearsal | P2-02 |
| B06 | Objectives and criteria | P2-02 |
| E01 | Executable step definitions | P2-02 |
| E02 | Linked inputs and outputs | P2-02, P2-03 |
| E03 | Transition preview and execution | P2-02 |
| E04 | Controlled live adaptation | P2-02 |
| F01 | Versioned written feedback checklists | P4-02 |
| F02 | Trainer and peer feedback | P4-02 |
| F03 | Retry and comparison | P4-02 |
| F04 | Review exceptions | P4-02 |
| L01 | Distinct individual and group submissions | P2-03, P4-01 |
| L02 | Individual evidence view | P4-04 |
| L03 | Private responses and controlled reveal | P4-01, P4-04 |
| D01 | Evidence selection board | P4-04 |
| D02 | Curated comparison and reveal | P4-04 |
| D03 | Traceable debrief record | P4-04 |
| P01 | Three runnable protocol templates | P4-01, P4-02, P4-03 |
| P02 | People/work routing | P3-01, P4-02, P4-03 |
| P03 | Protocol exceptions | P4-02, P4-03 |
| P04 | Protocol rehearsal and recovery | P4-01, P4-02, P4-03 |
| U01 | Main-room-first meeting shell | P3-02 |
| U02 | Tactile accessible controls | P2-02, P3-02 |
| U03 | Presentation/gallery switching and contextual panel | P3-02 |
| U04 | Activity and role context | P2-02, P3-02 |
| G01 | Resource library and attachment | P3-01 |
| G02 | Individual, group, and role allocation | P3-01 |
| G03 | Start, activity, or manual release | P3-01 |
| G04 | Participant Resources tray | P3-01 |
| G05 | New-information notice | P3-01 |
| G06 | Prior outputs as resources | P3-01 |
| G07 | Assignment-based access and revocation | P3-01 |
| G08 | Video resource playback | P3-04 |
| G09 | Individual and synchronized group viewing | P3-04 |
| G10 | Announcement interruption | P3-04 |
| Q01 | Request help | P3-03 |
| Q02 | Simple acknowledgement | P3-03 |
| Q03 | Direct response | P3-03 |
| Q04 | Written announcements | P3-03 |
| Q05 | Resilient requests and messages | P3-03 |
| M01 | Browser invitation, guest identity, lobby, admission, session lock | P2-01 |
| M02 | Device preflight and in-session selection | P3-02 |
| M03 | Native main-room and breakout audio | P3-02 |
| M04 | Optional camera video | P3-02 |
| M05 | One screen share per room | P3-02 |
| M06 | Mute, request unmute, remove, admit, lock | P3-02 |
| M07 | Media status and recovery | P3-02 |
| M08 | Low-bandwidth operation | P3-02 |
| M09 | Session end | P3-02 |
| M10 | Live captions | P3-02 |
| M11 | Captioned video resources | P3-04 |
| M12 | Spoken announcements | P3-03 |
| R01 | Current/next activity, clock, schedule variance | P2-02 |
| R02 | Room board | P3-03 |
| R03 | Help queue | P3-03 |
| R04 | Targeted written announcements | P3-03 |
| R05 | Create, open, close, and assign native breakouts | P2-02, P3-02 |
| R06 | Reassignment and late arrivals | P2-02, P3-02 |
| R07 | Manual/random groups and recorder/reporter roles | P2-02 |
| R08 | Collaborative structured output | P2-03 |
| R09 | Partial acceptance | P2-03 |
| R10 | Listen | P3-02 |
| R11 | Scan | P3-02 |
| R12 | Listening notice | P3-02 |
| R13 | Stop and media failure | P3-02 |
| R14 | Speak | P3-02 |
| R15 | Join | P3-02 |
| R16 | Breakout return countdown | P3-02 |
| R17 | Co-facilitator delegation | P2-01, P3-02 |
| V01 | Synthesis board | P4-04 |
| V02 | Confirmed action capture | P4-04 |
| V03 | Workshop record and CSV/JSON export | P4-04 |
| V04 | Publishable participant summary | P4-04 |

## Cross-cutting requirements outside the ID table

| PRD area | Owner and proof |
|---|---|
| Sequential state, duplicate commands, persistence, conflicts | P2-02/P2-03; concurrency and reconnect integration; P5-01 fault matrix |
| Individual/group/role resource independence and prior-output routing | P3-01 with E02/G06; snapshot, direct-access, reassignment and version tests |
| No recording or retained live transcript | P1-05/P3-02/P3-04 configuration and runtime checks; P4-05 lifecycle; P7-02 candidate audit |
| Participant notices and monitoring withdrawal | P4-05 implementation; live grant termination plus task-only/leave flow proof |
| Retention/deletion, linked records/uploads/publications and backup limits | P4-05 implementation after policy acceptance; P5-02 restore/backup drills |
| Complete supported-browser/accessibility proof | Every UI owner; P5-01 integrated checks and P5-03 actual accommodations |
| Operational health, incident ownership, cost visibility, restore and rollback | P5-02 implementation/drills; P7-02 release review |
| At least 20 people, one facilitator, all three formats | P5-03 readiness; P6-01 actual observed pilot, not synthetic evidence |
| Later 40-person/eight-room capacity | P7-01 measured scale and separate human workload evidence |
| Customer value, preparation/coordination baseline and willingness to pay | P5-03 measurement agreement and P6-01 observed findings |
| Stack/provider/budget/deployment choices | P0-02 proposal/acceptance; P1-06 media evidence; P5-02 authorized staging |
| Stripe organisation/workspace subscriptions; participants join free (17 November decision) | P0-02 policy/architecture in BILLING.md; P6-03 billing implementation/tests; P7-02 paid-release review; P7-03 authorized live-configuration checks |
| Individual trainers/consultants can own, subscribe to and run a one-person workspace without a company/team (17 November decision) | P0-02 domain/access boundaries; P2-01 onboarding/workspace ownership; P4-06 personal-name/email templates; P5-01 solo delivery flow; P6-03 individual Checkout/portal proof |
| Transactional communications only (17 November decision) | P0-02 policy/provider in COMMUNICATIONS.md; P2-01 auth/invitation semantics; P4-06 application delivery/tests before P5-01; P6-03 billing notices |
| Single/multiple-choice polls; fixed audience; identified/aggregate-only; revise until close; separate reveal; repeats create fresh rounds | P3-05 implementation; P5-01 audience/revocation/round-separation proof; settle removed-response/edit/export/retention cases |
| Consultant-owned delivery; structured drafts; facilitator replaces recorder without losing content/attribution; current recorder submits | P0-02 boundaries; P2-01 scoped access; P2-03 drafts/submission/conflict and recorder-change race proof |
| Invited client verifies email and gets approved read-only summary for 30 days, no paid account or public-link-only access | P4-04 recipient/audience approval; P4-05 expiry/earlier revocation/source-expiry/withdrawal; P5-01 wrong-email/link/scope denial and no expiry reset |
| Complete setup; invited tester 100% for 30 days, no card, once/workspace, operator-approved extensions, paid opt-in and read-only expiry; no additional infrastructure spend | P0-02/P1-06 allowance/credit evidence; P6-03 discount/expiry/active-session-continuity proof before P5-01; P5-03 approved configuration |
| Four-hour session ceiling; no resets on reconnect/activity extension; existing sessions may finish after tester expiry | P2-02 runtime; P6-03 entitlement boundary; P5-01 expiry/start/reconnect race proof |
| Shared-link/lobby admission and facilitator-verified identity recovery revoking prior endpoint | P2-01 identity/active-grant implementation; P2-03 durable work; P5-01 old-device denial |
| Disclosed workshop-only group sharing and dual author/subject approval for expanded identifiable feedback | P2-02 notices; P4-04 approval/publication; P4-05 withdrawal; P5-01 denied publication/export |
| Session content retained 90 days after end with earlier authorized deletion; seven-day client invitation separate from 30-day grant | P4-04 invitation/grant; P4-05 linked retention/deletion; P5-01 combined deadline/revocation tests |
| One complete paid plan, invited tester coupons, no public free workspace; permanent platform-owner billing exemption | P0-02 trusted scope; P6-03 entitlement/exemption and customer-owner-transfer negative tests; P5-01 integrated proof |
| Workspace-owned reusable content survives creator departure; 90-day read-only recovery after entitlement ends; accepted ownership transfer | P2-01 membership/transfer; P4-05 independent clocks/reactivation/deletion warnings; P5-01 race/isolation tests |
| Submission-time group roster, including verbal contributors, approves exact external-client publication | P4-04 roster snapshot/approval; P4-05 withdrawal; P5-01 recorder/missing-member/changed-version denial |
| Monthly billing, period-end cancellation and seven-day failed-renewal grace | P6-03 exact boundaries/recovery/notices; P5-01 running-session continuity and no-reset proof |
| One account across isolated workspaces; owner exemption only in designated owner workspace under ordinary capacity limits | P2-01 switcher/membership and stale-request denial; P6-03 subscription/exemption scope; P5-01 cross-workspace proof |

Q49–Q54 add proof within existing cards: P3-01 tests reassignment snapshot access and former-resource denial; P3-05 tests frozen poll content, fresh replacements and retained removed votes; P4-04 tests private-identity post-session review/recovery; P4-05 and P3-02 test immediate task-only withdrawal and explicit rejoin; P2-02/P4-05 test abandoned-session deadlines and retention timestamps.

Q55-Q58: P0-02 records the accepted stack with Postmark; P2-01 proves Auth SMTP and delegated continuation/no automatic promotion; P2-03 proves explicit reopening with immutable downstream/approval versions; P4-05 proves verified scoped deletion and shared-contribution handling; P4-06 proves Postmark application delivery and authenticated callbacks. P5-01 verifies these boundaries together.

Q59-Q61 and R1-R8: P0-02 specifies recovery/admission/dependency contracts; P1-06 proves partial-outage authorization; P2-01 implements privileged MFA/host recovery; P2-02/P2-03 prove three-session atomic admission and durable reconciliation; P4-05/P6-03 coordinate closure/retention/billing; P5-01 injects dependency failures; P5-02 proves safe restore/live-client rollout and actual incident response; P5-03 confirms named pilot coverage/headroom; P7-01 proves three-workshop and cross-workspace capacity; P7-02/P7-03 verify the release against those contracts.

Acquisition readiness (17 November decision, PRD section 12): [QUALITY-BAR.md](QUALITY-BAR.md) maps QG-01 through QG-08 to existing tasks. P0-01 establishes repository controls/provenance; P0-02 architecture/threat boundaries; P0-03 reproducible CI; every implementation task maintains applicable gates; P5-01/P5-02 verify integrated behavior/operations; P7-01 measures capacity; P7-02 verifies the complete candidate evidence and independent handover. All quality gates remain unverified until execution evidence exists.

P1 improvements, dedicated simulation workflows and unconfirmed ranking are not silently added to this implementation map. Polling is explicitly retained and assigned above; accepted behavior is recorded in the PRD and P3-05. Existing 76 numbered P0 requirements are preserved alongside these later decision rows.
