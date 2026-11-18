# Debrio — Product Requirements Document

Version: 0.5 | Date: 17 November 2026 | Status: agreed product scope; customer and technical validation pending

Supersedes v0.4 following the product interview. Establishes three instructional formats, a simple custom agenda for structured live sessions, a first pilot of at least 20 participants, and explicit announcement, video, caption, resource-access, and sharing-consent requirements. Requirements describe intended behavior, not implemented or validated capabilities. The existing mockup is an older interaction reference. Working name; availability and trademark checks remain outstanding.

## 1. Product decision

Delivery decisions confirmed 17 November 2026: assisted invitation-only testing of the complete product before public self-service rollout; consultant-delivered sessions normally remain in the consultant's workspace with explicit session access for clients. Clients need neither their own subscription nor workspace administration to participate. Start with one modular application, one relational database, managed media and narrow background jobs; Q55 accepts Next.js/TypeScript on Vercel, Supabase data/auth/storage/realtime, Postmark transactional mail/Auth SMTP and LiveKit as the conditional media/caption candidate. Provider capacity, operating settings and media/caption feasibility remain evidence gates. Supplied domain: **debrio.app**. Prospective pilot contact: US East Coast; participant geography, partner commitment and timing remain unconfirmed. No new infrastructure spending; the user will provide tester coupons. Complete functionality and professional acceptance checks remain required. Free-tier suitability is unproven.

Debrio is a browser-based platform for structured live group sessions. Independent trainers, consultants, training providers and online simulation organizers use a simple custom agenda or combine peer instruction, role practice, and jigsaw templates. One facilitator prepares activities, hosts a main room and concurrent breakouts, identifies groups needing attention, intervenes visibly, and builds a debrief from participants' work. Participants use one session link for conversation, instructions, resources, collaboration, and submission.

Debrio owns the workshop and meeting experience. It does not require Zoom, a meeting plugin, or a second conferencing application. Audio/video transport uses an established WebRTC media engine rather than a custom conferencing protocol. LiveKit is the preferred candidate for the prototype, subject to the reliability gate in section 10; it is not an approved production architecture yet.

Three application areas remain: **Build** (reusable agenda and activity setup), **Run** (meeting and facilitation console), and **Review** (participation, attempts, feedback, group outputs, and selected debrief items). A session uses one versioned, facilitator-controlled sequence of activities. Templates supply executable steps and roles; custom stages supply instructions, resources, groups, timing, and outputs without requiring an instructional format. Complete workshops can be duplicated with their content, agenda, roles, and checklists. There is no separate Simulation mode, exercise-control console, or general branching automation engine in the initial scope.

Simulation organizers can distribute private briefs, run deliberation, collect decisions, release new information, and debrief through shared tools. They decide adjudication and scenario progression themselves; Debrio does not implement a specialized proposal, outcome, turn, or modeled-state system.

Selective live listening is required for release. A task-only prototype can support development but cannot satisfy launch acceptance. The former Zoom audio-access gate is replaced by a native media reliability, isolation, and usability gate.

## 2. Problem and value proposition

One facilitator cannot visit every breakout often enough to identify confusion, answer questions, maintain timing, and collect useful work. Separate meeting controls, documents, messages, and timers fragment attention.

Core job: “Help me know which groups need attention, hear what is happening when necessary, and bring their work back into a coherent learning discussion.”

Debrio connects conversation to activity execution and attributable outputs. The advantages to validate are reduced coordination, acceptable preparation effort, repeatable delivery, and useful evidence for debrief. A strong group output is not treated as proof of individual understanding. Neither platform activity nor improved answers alone establish learning or causal training impact. The initial product does not assign an overall learning score or automatically diagnose confusion.

### Five core differentiators

| Differentiator | Delivered experience | Distinct value | Requirement coverage |
|---|---|---|---|
| Executable training plans | Starting a step updates instructions, roles, tools, required outputs, and configured room/work routing | Runs the instructional design with less manual coordination | E01–E04 |
| Practice → feedback → retry | First attempt, rubric-based trainer/peer feedback, and linked revisions remain visible | Makes feedback and improvement part of the live session | F01–F04 |
| Individual learning evidence within group work | Initial individual response, group work, and an individual transfer question have distinct attribution | Separates group performance from individual evidence | L01–L03 |
| Debrief built from the exercise | Facilitator selects linked decisions, assumptions, disagreements, feedback, and revisions | Grounds discussion in actual work without reconstructing recordings | D01–D03 |
| Structured collaboration protocols | Runnable peer instruction, role practice, and jigsaw | Enables structured activities with fewer logistical demands | P01–P04 |

### Shared tools, different uses

| Capability | Workshop | Simulation / wargame |
|---|---|---|
| Authoring unit | Reusable agenda with instructional templates or custom stages | Reusable custom agenda with briefs, groups, stages, and outputs |
| Participant identity | Participant with assigned group and activity role | Same identity and group/role assignment; organizers supply exercise terminology |
| Delivery authority | Facilitator and explicitly delegated co-facilitators | Same explicit delegation model; no separate White Cell capability set |
| Participant work | Individual responses, feedback, retries, group outputs | Decisions and rationale captured as ordinary group outputs |
| Control | Facilitator advances activities and feedback rounds | Organizer advances activities, releases resources, and communicates human decisions |
| Review | Authorized evidence and curated debrief | Authorized outputs, released material, and curated debrief |
| Shared services | Main room, breakouts, media, resources, help, messaging, permissions, audit | Same shared services |

These are uses of one product, not separately implemented modes. The mockup's Workshop/Simulation switch illustrates the superseded v0.4 scope and is not a v0.5 requirement.

## 3. Users, scale, and access

Distinguish the **platform owner** (the user operating Debrio, with permanent free product access) from a **workspace owner** (a customer managing one workspace). Accepted 18 November 2026: each active workspace has exactly one primary owner, supported by administrators with explicitly delegated permissions, rather than equal co-owners. Customer ownership does not confer the platform-owner billing exception. Workspace ownership may be transferred only after the recipient accepts; the current owner remains responsible until the transfer completes and cannot leave without an accepted transfer or explicit closure. A transfer must preserve exactly one primary owner. Recovery when the owner is unavailable remains to be specified. Team-workspace reusable content remains with the workspace when a creator leaves, with attribution preserved and departing-member access revoked.

| User | Needs | Authority |
|---|---|---|
| Independent trainer / consultant | Own a workspace, prepare and run sessions alone, manage their subscription and work with client participants | Workspace ownership and explicitly authorized facilitator capabilities; no company or second staff member required |
| Lead facilitator | Build, admit, assign, launch, monitor, listen, intervene, synthesize | Explicit session control |
| Participant | Join easily, understand the task, converse, contribute, request information | Current activity and assigned room |
| Recorder/reporter | Consolidate and submit group work | Explicit room submission role |
| Co-facilitator | Assist with rooms and help requests | Delegated capabilities; visible identity |
| Organization administrator | Manage organization policies, users, retention, usage | No automatic right to listen to sessions |

Privileged accounts require two-factor authentication: the platform operator, workspace owners, and users with billing or data-administration authority. Require secure recovery and reauthentication for sensitive actions; a role upgrade cannot bypass enrollment. Guest participation remains account-free, and ordinary facilitator-only MFA is optional initially. Host account recovery must invalidate stale sessions and is distinct from facilitator-verified guest recovery.

Initial audiences: independent trainers, consultants, training providers and online simulation organizers. Select a pilot partner with a concrete session, at least 20 participants, and willingness to evaluate delivery against its current workflow. The partner and subject are unconfirmed. Manager training on difficult feedback conversations is a candidate rehearsal scenario, not a fixed market or pilot commitment. Reported interest from simulation organizers is a discovery lead, not validated demand or willingness to pay.

An individual can create and own a one-person workspace, subscribe through Stripe and deliver the same workshop workflows without registering a company, supplying a corporate email domain or inviting a team. The workspace remains the subscription and data boundary; a personal workspace is an ordinary workspace owned by an individual. Account, billing and facilitation capabilities may be held by the same person but remain distinct permissions. Participants join free. A consultant can deliver sessions for clients; clients do not automatically become workspace administrators or gain access to other sessions. One account may belong to multiple workspaces through an explicit switcher, with separate permissions, content and subscriptions. Ownership transfer requires recipient acceptance. Consultant-owned delivery remains the default; membership in a client workspace grants only its explicitly assigned permissions. A dedicated solo price, free allowance or feature tier is not implied. Billing collects applicable personal billing details rather than forcing fictitious company details.

The first observed pilot must have at least 20 participants and one facilitator and cover all three instructional formats. Twenty is a pilot recruitment minimum, not a minimum session size imposed by the product. At exactly 20, role practice uses four trios and two groups of four, with two observers in each group of four; schedule enough rounds for every participant to practise and retry. The pilot jigsaw uses four topics: five home groups of four become four expert groups of five, then return home. Other attendance counts require validated assignments, not an assumption that these counts still work.

Accepted concurrency: at most three live workshops per workspace initially, subject to verified system-wide capacity and provider headroom. A started session still counts while its activity is paused or its facilitator is disconnected; drafts and ended sessions do not count. Enforce starts atomically so simultaneous requests cannot admit a fourth session. Show a clear limit/recovery message without disturbing existing sessions. Prove three concurrent workshops at the published session configuration plus cross-workspace load before advertising that capacity; the cap is not a platform-wide limit or an entitlement to exceed available infrastructure.

Test 40 participants and eight simultaneous breakouts later, after the first pilot. A 90-minute session is an endurance-test hypothesis, not a fixed duration for fitting every format and retry. Pilot duration must account for preparation, regrouping, debrief, and the extra role-practice rounds. Publish supported capacity only after validation; the first pilot must support all rooms needed by its actual agenda (six role-practice rooms at exactly 20).

Initial supported surface: desktop browsers on Windows/macOS. Chrome and Edge are initial certification candidates; exact tested versions must be published for each release. Safari, Firefox, mobile participation, and Linux are subsequent certification decisions, not implied support. No installation or paid participant account is required. Facilitators authenticate; participants use expiring session invitations and identifiable guest sessions, with admission controls. English is the first interface language.

## 4. Goals and scope

Goals:

- Enable one facilitator to run the first pilot of at least 20 participants; validate eight concurrent groups and 40 participants later.
- Give participants one clear workspace for conversation, task, time, help, and output.
- Provide visible, authorized remote listening and deliberate intervention.
- Preserve group attribution, revisions, decisions, and actions.
- Keep task work usable when media is degraded.
- Execute linked instructional steps without rebuilding rooms, documents, or feedback assignments.
- Preserve individual attempts, group contributions, feedback, and revisions with explicit evidence boundaries.
- Support peer instruction, role practice, and jigsaw with facilitator-controlled transitions, plus a simple custom agenda.

### Initial release

One shared session product supports workshops and human-run simulations. Templates are editable before launch and composable in an agenda; the custom agenda remains a straightforward sequence, not an arbitrary workflow builder.

Reusable agendas; three runnable formats; linked individual/group work; written checklist feedback and retry; source-linked debrief and item-specific sharing approval; native main room and breakouts; optional cameras; one active screen share per room with explicit handover; device preflight and admission; Listen/Speak/Join/Scan; facilitator-controlled timers and transitions; simple help requests with optional text; written and spoken announcements to one, selected, or all rooms in the same session; individual/group/role resource allocation and staged release; uploaded videos and supported links; individual and synchronized group viewing; live captions and captioned video resources; collaborative outputs; review, authorized CSV/JSON export and participant summary; accessibility and recovery controls. Existing unaltered baseline safeguards remain requirements; detailed architecture remains provisional.

### Deferred

Rotating case clinic and gallery critique templates; dedicated simulation console, scenario/turn engine, proposal/adjudication/outcome workflows and complex branching; elaborate request-management lifecycle; numerical grading and overall learning scores; autonomous AI facilitation and confusion diagnosis; transcript analysis; replay buffers and live-session recording; public template marketplace; LMS grade synchronization; telephony; native desktop/mobile apps; webinar scale; simultaneous interpretation; automated simulation adjudication, modeled consequences, and AI-driven actors; cross-platform meeting adapters; self-hosted or air-gapped distribution. Uploaded resource videos are in scope and are distinct from recording participants.

Live captions and captioned video resources are requirements for the first usable pilot. Validate caption-provider authorization, processing policy, supported languages, accuracy, latency, cost, and room/announcement isolation before that pilot. Participants enable captions independently; captions follow only authorized conversation or announcement audio. Trainers provide captions for uploaded videos. Captions do not imply retained transcripts or AI analysis.

## 5. Product principles

1. One current task and one primary conversation surface for participants.
2. Progressive disclosure in the console: current activity, clock, help requests, rooms; detail opens on demand.
3. Observed facts and inferred signals remain separate.
4. Listening, speaking, joining, and recording are distinct concepts and states.
5. The server owns workshop state and authorization; a hidden UI control is not an access boundary.
6. Saving, message delivery, media connection, and submission show acknowledged states.
7. Time expiry never silently converts incomplete work into complete work.
8. Keep authorship, subject of assessment, review assignment, and visibility distinct.
9. Automation executes a previewed plan; the facilitator controls transitions, exceptions, and publication.
10. Reuse existing work through versioned references and snapshots rather than untraceable copying.

### Interface direction: a tactile meeting environment

The design reference is the familiarity of Google Meet's meeting composition with Debrio's own visual language. The product must look like a place to meet and deliver an exercise, with training/control tools available in context.

- Main room is the default opening live view. Persistent Main room / Breakout rooms (or Team rooms) navigation makes the current location unambiguous.
- Presentation-first and participant-gallery layouts; a shared presentation occupies the primary stage, with participant tiles alongside/below. Use bounded visible tile counts at larger capacity.
- Warm neutral and mineral-green surfaces, soft raised controls, restrained inset/pressed states, rounded panels, and subtle depth. Text contrast and focus indicators must remain legible; shadows cannot be the only state cue.
- A consistent bottom dock for microphone, camera, present, hand raise, session options, and leave. Show labels through accessible names/tooltips; touch use must not depend on hovering.
- One main side panel at a time: Activity/Brief, Rooms, Resources, or Messages/Help. Closing it returns space to the meeting stage.
- Current activity, room, and facilitator/participant role remain visible. Production roles come from server authorization; preview role/group selectors are not participant privileges.
- Individual responses, room chat, presentation, and resources remain distinct surfaces. Information access follows individual/group/role assignment and release policy, not the current video room alone.

## 6. End-to-end experience

1. Start from a reusable agenda, duplicate an existing workshop, or create a simple custom sequence. Combine the three supported formats where useful.
2. Edit content, timing, group sizes, role briefs, written feedback criteria, outputs, and release rules. Templates retain their core sequences; preview assignments and validate prerequisites.
3. Assign resources to named individuals, groups, or roles. Select availability from the start, on activity start, or on manual release. Configure video viewing mode and verify captions.
4. Rehearse uneven attendance, role rotation, home/expert regrouping, missing work, and disconnects in an isolated test session. Share invitations, complete preflight, and admit participants to the main room.
5. Advance each activity deliberately. Peer instruction collects private initial answers, opens discussion, collects individual re-answers, and supports a controlled reveal and debrief. Role practice uses briefings, practice, checklist feedback, retry, and role rotation. Jigsaw moves from home groups to expert groups, returns home for synthesis, and collects individual transfer work.
6. Monitor help requests and task progress; listen or intervene visibly. Make written or spoken announcements to explicit room audiences. Speech announcements lower other conversation audio and pause Debrio-controlled videos; resuming videos is explicit.
7. Pin evidence for debrief. Ask authors to preview and approve each identifiable individual item before sharing it with the workshop. Declining never blocks participation or debrief; group-output sharing rules are stated from the outset.
8. Return to the main room for the curated debrief. Preserve original work, feedback, revised answers, group outputs, missing-work states, and confirmed actions without assigning an overall learning score.
9. End the session, revoke media access, and publish/export only authorized content. Review preparation effort and delivery workload against the trainer's existing process.

At any step, a participant can request help with an optional short message. The facilitator acknowledges the request and replies in writing or visits the room. Replies and announcements remain separate: a broadcast never reveals the source group's private request automatically.

### Human-run simulation through the shared agenda

An organizer creates briefing, deliberation, decision, and debrief stages; assigns private individual/group/role resources; opens rooms; and manually releases new information. Groups submit ordinary outputs. The organizer decides outcomes outside a specialized software workflow, then communicates them through authorized messages or resources and advances the next stage. Private material remains restricted in live views, review, and exports. No separate simulation context, turn engine, proposal state machine, or adjudication console is required.

## 7. Release requirements

P0: initial product requirement; the first pilot must exercise the core flows at its actual participant/room count. P1: deferred, not a first-pilot dependency. Forty-person capacity is a later validation milestone. Requirements apply at the published capacity and supported-browser matrix. IDs retained from earlier versions may have gaps where specialized scope was removed.

### Build

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| B01 | P0 | Create, duplicate, reorder, save complete workshops | Agenda, template configuration, prompts, resource references, roles, checklists, and durations survive save/reload; explicit Ready to run freezes a validated version, later edits create a new draft, and existing sessions retain their selected version; duplication copies configuration without past participant identities, submissions, sharing approvals, or live state |
| B02 | P0 | Simple custom stages and composable templates | Facilitator combines instructional templates and stages with instructions, resources, groups, timing, and outputs in one linear agenda; no arbitrary branching engine required |
| B03 | P0 | Configure output schema, timing, roles, and completion policy | Launch validation identifies missing configuration |
| B04 | P0 | Common or differentiated room tasks | Participants receive only authorized task content |
| B05 | P0 | Preview and rehearsal | Test sessions cannot message or change live sessions; role previews include dependencies, review allocations, and protocol movement |
| B06 | P0 | Objectives and criteria | Steps and rubric criteria can reference objectives; unmapped steps are flagged for review without inventing mappings |

Accepted 18 November 2026: a workshop definition has a stable identity and separate versions. Facilitators edit a draft and explicitly select **Ready to run** to validate and freeze its agenda, instructions, roles, rubric and resource-version references. Starting a live session requires a ready version; start does not silently freeze a draft. Further edits create a new draft version without changing ready versions or existing sessions. Each delivery remains linked to its selected ready version. Readiness of reusable configuration is separate from session admission, capacity and runtime prerequisite checks. Authorized live adaptations remain logged session overrides and never rewrite the source version. Frozen references do not bypass resource revocation, deletion or retention.

### Executable plans, practice, and learning evidence

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| E01 | P0 | Executable step definitions | Each step specifies individual/group scope, prompt, roles, tool configuration, required outputs, timing, dependencies, visibility, and completion policy; starting applies the versioned configuration |
| E02 | P0 | Linked inputs and outputs | A downstream step resolves an explicit submitted revision; missing input blocks readiness or requires a logged facilitator override; later revisions never silently change the assigned input |
| E03 | P0 | Transition preview and execution | Preview shows participant/work movement, permission changes, missing prerequisites, and next tools; facilitator confirms; acknowledged server state drives each client; retries do not duplicate assignments |
| E04 | P0 | Controlled live adaptation | Extend, skip, reorder a future step, or accept partial prerequisites via logged override; dependency validation reruns; completed attempts remain intact |
| F01 | P0 | Versioned written feedback checklists | Trainer defines criteria, descriptors, and observations; published checklist version is frozen for a feedback round; numerical scoring is deferred |
| F02 | P0 | Trainer and peer feedback | Reviewer assignments target a fixed attempt version; reviewers see only assigned work; criterion feedback retains author, timestamp, and rubric version; self-review requires explicit configuration |
| F03 | P0 | Retry and comparison | Each role-practice participant receives a practitioner turn, written feedback, and a retry; first attempts, feedback, and submitted revisions remain linked; outstanding turns/retries are visible and facilitator may explicitly accept partial completion |
| F04 | P0 | Review exceptions | Missing reviewer, absent author, uneven pairing, and late feedback are visible; facilitator can reassign or waive with a reason without deleting feedback; feedback is not silently attached to a different attempt |
| L01 | P0 | Distinct individual and group submissions | Initial individual response, joint output, and individual transfer response have separate ownership and status; editing a group document never manufactures an individual submission |
| L02 | P0 | Individual evidence view | Authorized trainer can trace participation, submitted attempts, feedback, group outputs, and debrief items; missing work is marked missing, not zero understanding; no overall learning score or inferred mastery |
| L03 | P0 | Private responses and controlled reveal | Individual answers are visible to author and authorized facilitator, not peers; peer instruction may reveal an anonymous response summary; sharing identifiable individual work requires the author's approval for the exact item/version and workshop audience |

### Exercise-based debrief

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| D01 | P0 | Evidence selection board | Facilitator can pin submitted decisions, declared assumptions, authored disagreements, feedback, and revisions with source/version links; no transcript is required |
| D02 | P0 | Curated comparison and reveal | Facilitator orders evidence, compares attempts, adds prompts, and previews the participant view; author previews the exact identifiable individual item and approves or declines sharing with the workshop; decline does not block participation or debrief; original submissions stay unchanged |
| D03 | P0 | Traceable debrief record | Record distinguishes submitted evidence, facilitator interpretation, participant reflection, and confirmed action; exports preserve permitted provenance and exclude restricted content |

Group submissions have an explicit workshop-sharing rule shown before contribution. Assigned observer feedback remains visible only to its authorized author, subject, and facilitator until publication is permitted. Item approval is not blanket consent for future revisions, external audiences, or unrelated work; publication and participant-summary exports must enforce the approved scope.

### Structured collaboration protocols

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| P01 | P0 | Three runnable protocol templates | Peer instruction, role practice, and jigsaw include executable steps, roles, routing, outputs, timing, and debrief; templates are editable before launch and can be combined in one agenda |
| P02 | P0 | People/work routing | Each round declares whether people move or fixed work snapshots move; facilitator previews destinations and reviewers; work ownership stays stable and grants follow the routing policy |
| P03 | P0 | Protocol exceptions | Attendance/role constraints are validated before a round; facilitator can adjust groups, rebalance assignments, provide missing material, or waive with a logged reason; no impossible allocation is silently accepted |
| P04 | P0 | Protocol rehearsal and recovery | Rehearsal covers every template with uneven membership and a disconnect; reconnect restores the current round, role, assignment, and input revision; retries cannot double-advance a round |

### Minimum protocol behavior

| Protocol | Executable sequence | Required routing/output behavior |
|---|---|---|
| Jigsaw | Home groups → expert groups → home-group synthesis → individual transfer | Trainer defines topics; system previews home/expert assignments and restores home groups; at 20 pilot participants use four topics, five home groups of four and four expert groups of five; missing topic coverage requires facilitator correction or explicit fallback |
| Peer instruction | Individual answer with rationale → peer discussion → individual re-answer → reveal/debrief | Hide peer answers until configured reveal; retain both answers; correctness is optional and only uses an authored answer key; grouping alone does not imply mastery |
| Role practice | Practitioner/counterpart/observer briefing → practice → written criterion feedback → retry → role rotation | Default trios; allow groups of four with two observers; at 20 use four trios and two groups of four; show outstanding practitioner turns/retries and allow enough rounds for everyone; private briefs and observer checklist respect assignments; no automatic speech grading |

Automation advances assignments only after facilitator confirmation of a step/round. Timers can prompt the next step but cannot bypass incomplete prerequisites. Templates require no AI, transcripts, or recording. A generic form plus a template title does not satisfy P01: role changes, routing, revision links, and exception handling must execute.

### Meeting interface and session context

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| U01 | P0 | Main-room-first meeting shell | New live session opens in main room with presentation/gallery, participant tiles, device dock and room navigation visible |
| U02 | P0 | Tactile accessible controls | Raised/pressed states accompany text/icon labels, visible keyboard focus, non-color status and sufficient contrast; reduced-motion preference is respected |
| U03 | P0 | Presentation/gallery switching and contextual panel | Layout switching does not reset media or drafts; only one primary side panel is open; current room and active monitoring room remain distinct |
| U04 | P0 | Activity and role context | Interface shows current activity, room, and authorized role capabilities; no separate simulation mode is required; preview switches are absent from participant controls |

### Resource assignment and delivery

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| G01 | P0 | Resource library and attachment | Facilitator adds text, approved HTTPS link, file, or uploaded video with title, type, owner and revision; upload readiness/error state is visible; videos have captions; links resolve before release |
| G02 | P0 | Individual, group, and role allocation | Explicitly select one or more named individuals, groups, roles, or the shared session audience; preview recipient combinations and activity assignment; a resource is reusable without duplicating its content |
| G03 | P0 | Start, activity, or manual release | Select availability from session start, when a specified activity starts, or on explicit manual release; facilitator previews recipients; retries do not duplicate delivery; unreleased titles and previews remain inaccessible |
| G04 | P0 | Participant Resources tray | Materials appear beside the task with audience, version, release state and open/download action; only released authorized items are listed; unauthorized titles/previews are not leaked |
| G05 | P0 | New-information notice | Manual release produces a recipient-scoped new-information notification and message linking to the released version; delivery states are visible without claiming the content was read |
| G06 | P0 | Prior outputs as resources | Route a fixed submitted artifact version as read-only input to assigned reviewers; preserve source authorship, version and permissions; reviewers cannot alter the original |
| G07 | P0 | Assignment-based access and revocation | Moving between media rooms neither grants nor revokes resources by itself; individual briefs persist while that individual assignment is valid; explicit group/role changes re-evaluate access, including jigsaw home/expert membership; revoked links/playback subscriptions are stopped where supported; downloaded copies cannot be recalled |
| G08 | P0 | Video resource playback | Uploaded videos and supported links play inside Debrio; unsupported embeds are clearly identified as external link-outs; publish tested sources/formats and caption support; external links do not imply synchronized playback capability |
| G09 | P0 | Individual and synchronized group viewing | Activity chooses individual playback or group playback with one designated controller for play/pause/seek; validate that every intended viewer has resource access; playback never broadens an assignment; volume and captions remain local; buffering, autoplay blocks, controller loss, and reconnect have visible recovery without losing work |
| G10 | P0 | Announcement interruption | Spoken announcements pause Debrio-controlled video playback for targeted participants; shared group state pauses when that group is targeted; video resumes only by an explicit user/controller action after the announcement; link-outs cannot be promised automatic pause |

Production attachments require MIME/size policy, validation and malware handling, tenant-isolated object storage, authorized downloads, expiring access, retention/deletion, and safe rendering. External links do not bypass external-site authorization; Debrio cannot guarantee availability or revoke access on those sites. Assignment policy must state whether material persists after a step. Default: released shared material persists for the session; private material remains subject to current assignment and any explicit historical-access grants.

### Help requests and room messaging

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| Q01 | P0 | Request help | Participant requests help with an optional short message; record author, originating room/group, activity, and time; acknowledge server receipt and show request age |
| Q02 | P0 | Simple acknowledgement | Facilitator acknowledges, replies or visits, and can mark the request handled; receipt and acknowledgement do not imply that help was delivered; no category/assignee/escalation workflow required |
| Q03 | P0 | Direct response | Facilitator replies to the originating room or visits it; a written reply stays linked to the request and is not sent to other rooms |
| Q04 | P0 | Written announcements | Facilitator targets main room, one room, selected rooms, or all rooms in the same session; preview recipients before sending; snapshot recipients and track per-room delivery/failure separately from read status |
| Q05 | P0 | Resilient requests and messages | Reconnect restores permitted records; retries deduplicate; removed members lose future room access; failures remain pending/failed instead of appearing delivered |

UI vocabulary is **Request help**, with the optional message visible in the queue. Replies and announcements are distinct actions: broadcasting a general answer never silently exposes the originating group's private request. Participants can send ordinary messages within their room; participant cross-room channels remain deferred.

### Boundaries for polling and simulation use

Peer-instruction answers and optional anonymous aggregate reveal remain covered by P01 and L01–L03. Standalone polling is also in initial scope. P3-05 owns implementation; P5-01 owns integrated verification. The historical mockup is not the specification.

- Support single-choice and multiple-choice polls; ranking and free-text polls are deferred.
- Facilitator previews and targets the main room, selected breakouts or the whole session. Only permitted audience members may respond or see results.
- Snapshot eligible respondents when opening. Moving rooms does not change poll eligibility, transfer votes or grant another audience's poll. New admissions use later polls unless an inclusion mechanism is explicitly accepted. Explicit removal/revocation still denies future access; historical eligibility is not an irrevocable grant.
- Before opening, select identified responses or aggregate-only results. Privacy mode cannot change once responses begin. Identified answers are visible only to authorized facilitators; participants see aggregates only when revealed. Aggregate-only mode exposes no named-answer UI, API or export; internal identity may prevent duplicate voting and is disclosed, not marketed as untraceable anonymity.
- Participants may revise their response while open. Facilitator closes to freeze answers and separately reveals results. Repeating a closed poll creates a new round with fresh responses and its own audience snapshot, preserving original results. Opening freezes the question and options; corrections require a replacement round with fresh responses while preserving original results. Removal stops future access/voting but preserves already-cast votes as historical results, subject to authorized deletion. Poll records follow the 90-day session-retention policy; exports preserve the selected audience and identified/aggregate-only privacy rules.
- Polling does not automatically grade participants or bypass exact-item/version/audience approval for identifiable publication.

Simulation organizers use B02 custom stages, G01–G10 resources, Q01–Q05 help/messages, ordinary group outputs, and media controls. Earlier S01–S08 specialized scenario, turn, proposal, adjudication, and outcome requirements are deferred. A human decision can be communicated as an ordinary scoped message or resource; it does not change modeled state or imply real-world execution.

### Access and meeting experience

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| M01 | P0 | Browser invitation, guest identity, lobby, admission, session lock | Rejected, expired, or removed users cannot regain access through an old active connection |
| M02 | P0 | Device preflight and in-session selection | Device selection, denial, unplugging, and unavailable devices expose recovery states |
| M03 | P0 | Native main-room and breakout audio | Assigned participants converse without hearing unauthorized rooms |
| M04 | P0 | Optional camera video | Camera-off remains fully usable; receiving video can be reduced without losing task work |
| M05 | P0 | One screen share per room | Participants and facilitators share in their current main/breakout room; start/stop and presenter handover are explicit; room exit ends prior sharing; sharing never follows an announcement to other rooms; browser limitations are disclosed |
| M06 | P0 | Mute, request unmute, remove, admit, lock | Facilitator can mute but cannot silently activate another person's microphone |
| M07 | P0 | Media status and recovery | Reconnecting, denied, unavailable, and connected are distinct; task connectivity is separately shown |
| M08 | P0 | Low-bandwidth operation | Users can disable video reception/publication; audio and task work are prioritized |
| M09 | P0 | Session end | Publishing and listening stop; media access is revoked; unfinished outputs remain saved |
| M10 | P0 | Live captions | Each participant enables captions independently for authorized conversation and announcements; content follows audience permissions through switching/reconnect; provider processing, accuracy, latency, languages, and cost are validated before the usable pilot; no retained transcript implied |
| M11 | P0 | Captioned video resources | Trainer supplies captions for uploaded videos; supported linked players expose usable captions; participants control caption visibility; readiness checks identify missing/inaccessible captions |
| M12 | P0 | Spoken announcements | Facilitator previews one, selected, or all room targets in the same session and explicitly starts/stops microphone broadcast; targets see the speaker, hear lowered conversation audio, and have controlled videos paused; no return-audio, camera, or screen-share bridge; failed recipients are visible |

### Run

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| R01 | P0 | Current/next activity, clock, schedule variance | Pause, extend, finish, and advance propagate to connected clients |
| R02 | P0 | Room board | Shows output progress, help-request age, app freshness, membership, and media availability; absent telemetry is unknown; no automatic confusion or engagement diagnosis |
| R03 | P0 | Help queue | Shows request author, room, age, optional message, acknowledgement, and reply or visit; simple handling follows Q01–Q03 |
| R04 | P0 | Targeted written announcements | Facilitator previews one, selected, or all room recipients; delivery records distinguish delivered from read; participants message their assigned room without cross-room privileges |
| R05 | P0 | Create, open, close, and assign native breakouts | Confirmed room and media membership agree; failures remain visible |
| R06 | P0 | Reassignment and late arrivals | Media permissions follow confirmed media membership; resource permissions follow explicit individual/group/role assignments; prior authorship survives; failed transfers have a recoverable state |
| R07 | P0 | Manual/random groups and recorder/reporter roles | Facilitator can preview groups and correct assignments before opening |
| R08 | P0 | Collaborative structured output | Server-acknowledged saves, required-field validation, and revision history; concurrent edits cannot silently overwrite work |
| R09 | P0 | Partial acceptance | Timer expiry does not submit; facilitator explicitly accepts partial work |
| R10 | P0 | Listen | Selected breakout audio is audible without changing the facilitator's participant-facing room assignment; no microphone/camera is published there |
| R11 | P0 | Scan | Configurable dwell, pause, next, stop; help requests may interrupt; unavailable rooms are skipped with status |
| R12 | P0 | Listening notice | Room sees listener identity and active-listening status; notice is established before audio delivery is authorized |
| R13 | P0 | Stop and media failure | Stop immediately silences local playback and revokes the subscription; stale feeds cannot show live |
| R14 | P0 | Speak | Explicit action transmits only to the selected room, with a conspicuous state; release/stop, room switch, disconnect, or role loss ends transmission |
| R15 | P0 | Join | Facilitator enters full room interaction; prior listening/speaking routes close; return destination is explicit |
| R16 | P0 | Breakout return countdown | Facilitator confirms closure; connected members return; failed returns appear in a reconciliation list |
| R17 | P0 | Co-facilitator delegation | Capability changes apply to existing media connections; room shows every active listener |

### Review and later assistance

| ID | Priority | Requirement | Acceptance criterion |
|---|---|---|---|
| V01 | P0 | Synthesis board | Original room submissions remain accessible beside facilitator edits |
| V02 | P0 | Confirmed action capture | Facilitator records explicit decisions/actions separately from submitted suggestions; no ranking or voting engine required |
| V03 | P0 | Workshop record and CSV/JSON export | Outputs, individual/group attempts, rubric versions, authorized feedback, revision lineage, debrief evidence, actions, timings, and intervention history export with attribution and scope |
| V04 | P0 | Publishable participant summary | Facilitator selects content; private notes and restricted work are excluded; identifiable individual work requires item/version-specific author approval for that audience, checked on publication/export |
| A01 | P1 | Suggested clustering | Source links and facilitator acceptance required |
| A02 | P1 | Transcript-based signals | Evidence, freshness, uncertainty, dismissal, and processing authorization required |
| A03 | P1 | Short rolling audio buffer | Separate policy, disclosure, expiry, and revocation; disabled at launch |
| A04 | P1 | Adaptive agenda suggestions | Remaining-time impact is visible; facilitator accepts changes |
| A05 | P1 | PDF reports, LMS/productivity integrations | Separate permissions and delivery contracts |

## 8. Facilitator controls and attention model

| Control | Receive | Transmit | Participant-facing state |
|---|---|---|---|
| Listen | Selected room audio only | Nothing to selected room | Named facilitator listening |
| Speak | Selected room audio | Explicit microphone transmission to selected room only | Named facilitator speaking |
| Announce | No new room return-audio route | Explicit microphone transmission to previewed one/selected/all rooms | Named speaker; conversation lowered and controlled videos paused in targets |
| Join | Assigned room audio/video | Normal room microphone/camera controls | Facilitator present as a member |
| Scan | One room at a time | Nothing | Listening notice only in current room |
| Stop | No monitored room audio | No remote intervention or announcement audio | Listening/speaking/announcement ends; video awaits explicit resume |

Listen and Scan suppress other conversation playback, including the main room. Speak temporarily suspends microphone publication to the facilitator's other room. Announce suspends monitoring and other microphone routes before enabling only the previewed targets. Camera and screen-share publication never follow Listen, Speak, or Announce. Restoring main-room playback does not automatically unmute a microphone. Announcement end restores ordinary conversation volume but leaves controlled videos paused until explicit resume.

Spoken announcements are one-way within one session. They neither expose conversations between rooms nor add monitoring grants. Stop, disconnect, role loss, session end, or explicit route change ends the broadcast; reconnect never restarts it automatically. Each target shows delivery or failure. Missed live announcements are not replayed as recordings; the facilitator can follow up in writing. External link-outs may not support pause/control; in-app playback must be proven at the media gate.

A single facilitator hears only one intelligible room conversation at a time. Do not prefetch audible feeds or download all room audio merely to shorten switching. Room switching uses break-before-make behavior: silence and revoke the old route before authorizing the new one. New talk/screen-share tracks inherit current permissions; reconnect cannot reactivate stale grants.

The listening strip always shows selected room, mode, live/reconnecting state, elapsed listening time, Stop, and Next. Room cards prioritize task completion and help. Default signals are factual: “0 of 3 fields submitted,” “help requested,” “last task update 90 seconds ago.” Silence and inactivity are not evidence of disengagement.

The participant layout prioritizes the current prompt, conversation, time, role, contribution, save state, and Help. It shows only the tools needed for the current step. Critique opens the assigned work snapshot and rubric; revision opens the participant's own attempt and received feedback; transfer opens an individual response form. These changes must not require switching between separate applications. Advanced facilitator telemetry never appears in the participant task view.

The older mockup illustrates only some controls and is not coverage of this scope. The production interface distinguishes inspecting a room from joining, listening, speaking, or announcing. Switching panels never changes room membership or activates a microphone. Closing a panel never silently starts/stops delivery or releases resources.

## 9. Architecture direction and domain contracts

### Components

| Component | Responsibility |
|---|---|
| Browser application | Build/Run/Review, participant workspace, device controls, media playback |
| Identity/admission service | Authenticated facilitators, scoped guest sessions, lobby, expiring invitations |
| Workshop execution service | Authoritative steps/rounds, clocks, dependencies, protocol routing, roles, assignments, revisions, transitions |
| Practice/evidence service | Rubric versions, attempts, review allocation, feedback, revision lineage, individual evidence views, debrief curation |
| Collaboration service | Structured output updates, help queue, messages, presence |
| Media orchestration service | Provider room mappings, scoped grants, listening/speaking/announcement lifecycle, transfer reconciliation |
| WebRTC media engine | Audio/video transport, room connections, screen-share tracks, connectivity relay |
| Resource delivery service | Revisioned attachments/videos/captions, individual/group/role access and release rules, authorized object access, playback state and revocation |
| Messaging/help service | Scoped requests, acknowledgement, replies, written announcements and delivery reconciliation |
| Caption processing | Authorized live conversation/announcement captions, participant display controls, no transcript retention by default |
| Persistence/export service | Tenant-isolated definitions, outputs, event history, summaries, exports |
| Operations layer | Health, redacted diagnostics, usage, cost limits, incident recovery |
| Optional later workers | Authorized analysis under separate scope and processing policies |

These are logical responsibilities, not a requirement for independently deployed services. Keep implementation boundaries proportionate to the pilot.

Prototype media topology: separate provider room per main room/breakout, mapped to Debrio room IDs. Participant conversation access is limited to the assigned media room. A facilitator can use an explicitly authorized monitoring connection to a selected breakout while retaining the main-room app assignment. One-way announcement publication needs separate grants to the selected room set without return-audio subscriptions. Validate connections, microphone routing, caption isolation, browser playback controls, switching, and cleanup before accepting this topology. Provider primitives alone are not proof of the application behavior.

Do not use a single shared provider room with client-side muting as the security boundary. Provider permissions and server-enforced membership must prevent unauthorized subscriptions and publication. Media engine room membership and workshop membership are different records and must be reconciled.

Use provider-managed media hosting for the prototype unless the reliability/cost assessment rejects it. Keep the adapter boundary small: room lifecycle, connection grants, publish/subscribe authorization, disconnect, and health. A replaceable adapter does not guarantee effortless provider portability. Backend framework/database choices belong in the technical design; a transactional relational store and acknowledged real-time transport are required capabilities.

### Core entities

| Entity | Essential fields |
|---|---|
| WorkshopDefinition | Tenant, stable workshop ID, authorship; reusable identity shared by its versions |
| WorkshopVersion | Workshop definition reference, version, draft/ready state, objective, activities, templates, fixed rubric/resource-version references; frozen by explicit Ready to run |
| Session | Selected ready workshop version, facilitator, state, admission policy, processing/retention policy snapshot |
| ActivityRun | Definition reference, state, server deadline, pause/extension history |
| RoomRun | Activity, logical room, provider room reference, task, membership revision, status |
| ParticipantSession | Stable per-session identity, optional authenticated account reference (empty for guests), display name, assignment, roles, access state; work and assignments reference this identity rather than a connection or name |
| OutputRevision | Activity/step, exactly one participant-session or group owner, schema, content, author, timestamp, revision, visibility; ownership consistent with its submitted attempt |
| StepDefinition / StepRun | Scope, objective IDs, prompts, tools, roles, dependencies, completion/reveal policy; run state and override history |
| ProtocolDefinition / ProtocolRun | Template/version, parameters, group/role mappings, round order, current round, exceptions |
| Objective / RubricVersion | Observable objective; written checklist criteria, descriptors, version, publication state |
| Attempt | Exactly one participant-session or group owner, submitted-by participant, step, ordinal, submitted output revision, preceding attempt, status, change rationale; group contributor roster frozen at submission |
| ReviewAssignment / Feedback | Reviewer, subject attempt revision, rubric version, round, status; criterion responses, author, timestamps, visibility |
| EvidenceLink | Source attempt/output/feedback revision, objective/criterion, relation type, individual/group scope |
| DebriefItem | Ordered source references/snapshots, curator, prompt, interpretation label, permitted audience, identity display policy |
| PublicationApproval | Required approver and role (author; also subject for expanded identifiable feedback), exact item/version and audience preview, pending/approved/declined state and decision time; all required approvals must hold and no approval carries to changed items/copied sessions |
| RoutingAssignment | Protocol round, source/destination person/group/artifact, role, fixed input revision, grant revision, confirmation state |
| HelpRequest | Origin room/group, author, optional message, activity, raised/acknowledged/handled state and times, linked reply or facilitator visit |
| Intervention | Actor, room, type, timestamp, delivery/result |
| MediaConnection | Provider connection, participant identity, room, publish/subscribe grants, availability |
| ListeningSession | Listener, target room, mode, authorization revision, notice state, start/end, termination reason |
| Announcement | Speaker, session, explicit target-room snapshot, authorization revision, start/end, per-room connection/delivery state, termination reason; no audio recording |
| Transfer | Participant, source/destination, membership revision, requested/confirmed/failed state |
| Decision/Action | Text, confirmation state, rationale, owner, deadline, source outputs |
| ResourceVersion / ResourceAssignment | Tenant, owner, title/type/content/file/video/caption reference and version; individual/group/role audiences, start/activity/manual release rule, expiry and historical access policy |
| ResourceRelease | Assignment and fixed version, controller, audience snapshot, idempotency key, release time, per-recipient deliveries |
| Message / MessageDelivery | Content, author, activity, explicit target and recipient snapshot; room, sent/delivered/failed times, optional linked help request or resource release |
| VideoPlayback | Resource version, activity, individual/group mode, authorized group/controller, play/pause state, position, server timestamp/revision, announcement pause state; volume/caption visibility are local |
| GroupRoleAssignment | Stable participant, group/role, activity/round, membership history; jigsaw home/expert mapping separate from current media-room membership |


Events include tenant/session, activity/room where relevant, event ID, actor, server timestamp, type, schema version, correlation ID, and state revision. Deduplicate retries. Enforce optimistic concurrency for control changes. Preserve observed facts separately from interpretations. The media provider is not the system of record for workshop progress. Individual evidence uses the stable ParticipantSession identity, never display name or transient media identity. Cross-session learner profiles are deferred. Work routing grants access to a specific artifact without granting unrelated source-room access. Debrief and export projections enforce the same policies as live reads.

## 10. Native media reliability gate

Provider building blocks are insufficient evidence of a working Debrio experience. The candidate LiveKit references carried forward from v0.4 [1–2] must be checked during the technical investigation. This revision does not verify provider support for Debrio's room workflow, announcements, captions, playback, accessibility, privacy, or performance.

### Gate tests

1. Begin with one main room and four breakouts on actual browsers/devices; before the first pilot, test at least 20 participants and every concurrent room required by its agenda (six for the agreed 20-person role-practice arrangement). Validate 40 participants/eight breakouts at the later scale milestone.
2. Demonstrate Listen, Speak, Join, Scan, Stop, and spoken announcements to one, selected, and all rooms. Verify explicit target preview, named notice, no unintended microphone/camera/screen-share publication, and no cross-room return audio.
3. Instrument every room boundary: unauthorized subscriptions, new tracks, reassignment, stale tokens, reconnect, guest removal, role loss, and session end. No cross-room leakage is acceptable.
4. Verify room notice before delivery, named listeners, co-facilitator changes, stop cleanup, and fail-closed authorization during control-service loss.
5. Test device denial/unplugging, Bluetooth/headset changes, echo, screen sharing, permission prompts, autoplay restrictions, and browser refresh.
6. Test ordinary network loss, relay-only/restricted-network paths, media-provider interruption, and degraded bandwidth. Publish the actual tested network profiles and unsupported cases.
7. Verify participant transfers preserve acknowledged work, revoke old media-room access, and reconcile provider membership without duplicate active publication; resource assignments remain independent.
8. Measure participant-minutes, monitoring and announcement connections, media egress/relay, uploaded-video storage/delivery, live-caption processing, and total cost per session.
9. Observe a real facilitator: room switching and notices must support attention rather than create distracting UI work.
10. Complete the accessibility/browser matrix, including live captions for authorized conversation and announcements, participant caption controls, captioned uploaded/linked videos, and screen-presenter handover.
11. Test individual and group video playback with controller play/pause/seek, buffering, autoplay restrictions, late joins, controller disconnect, revocation, and reconnect. Show desynchronization/failure rather than pretending every participant is watching the same moment.
12. Announce while rooms are talking and watching different videos. Only targets hear the announcement, lower conversation audio, and pause controlled playback; captions follow the correct audience. End/disconnect/role loss stops publication, restores conversation volume, and requires explicit video resume. External link-out limitations are visible.
13. Test resource and caption access for individuals, groups, and roles before/after release, room moves, and actual assignment changes. Verify that a copied URL, stale playback connection, or reconnect does not bypass permission checks.

Exit evidence: repeatable results, connection/permission diagrams, isolation tests, supported browser/video/caption matrix, measured playback synchronization and performance, per-session cost model, runbook draft, and accepted operating limits. A working demonstration of the critical media, resource-isolation, and work-recovery paths is required before committing to the full build. Repeat at the actual pilot configuration before participants join; failure blocks the usable pilot. Any fallback is explicit; no silent switch to a second conferencing tool.

## 11. State rules and recovery

Initial session ceiling: four hours from entering Live, including post-tester-discount continuation. Use one server-owned deadline; activity pauses/extensions, refresh, reconnect or host replacement cannot reset it. Show the limit and warnings, preserve acknowledged work on closure and do not convert unfinished work into a submission. Activity timers remain facilitator prompts; this separate hosting ceiling still needs capacity/cost validation.

Session: Draft → Ready → Live ↔ Paused → Completed → Archived. Activities: Pending, Running, Paused, Completed, Skipped. Room work: Not started, Working, Submitted, Accepted partial. Media, help, resource assignment, playback, and connectivity states remain separate.

- Lock the session's definition version; live changes are logged overrides.
- Server deadlines drive timers; local clocks display them. Pausing activity time does not mute conversation or close rooms.
- Timer expiry prompts the facilitator. Breakout closure is a separate explicit command with a countdown.
- Media transfer revokes source media permissions, establishes destination media permissions, and confirms arrival. Failure leaves a visible transfer/retry state, never unrestricted access to both rooms. Resource access changes only when an explicit individual/group/role assignment changes.
- Room closure preserves outputs and supports participants reconnecting into their current assignment, usually the main room.
- Acknowledged saves survive reconnect. Unacknowledged edits show an unsaved/retry state; conflicts require explicit merge/recovery rather than silent overwrite.
- Distinguish task-service loss from media loss. During control-service loss, disable privileged transitions and stop monitoring/intervention grants when authorization cannot be renewed. Ordinary in-room conversation may continue only while its valid room authorization remains in force.
- The lead grants explicit co-facilitator capabilities and may designate a successor. Authorized co-facilitators continue within those permissions when the lead disconnects. Without one, participants retain the current activity and see the disruption; nobody is automatically promoted and the original four-hour deadline remains.
- Duplicate guest tabs cannot create uncontrolled duplicate microphone publication. Define a single active media endpoint with explicit takeover.
- Normal guest entry uses a shared session link and facilitator-controlled lobby without an account. Each admitted person gets a stable private session identity; shared links or display names cannot retrieve existing work. On identity loss or device change, the facilitator verifies the person before restoring identity/work/assignments and revokes the previous active endpoint. Test recovery racing with old-device writes and media publication.
- Accepted 18 November 2026: participants joining while signed in have their participant session identity linked to their authenticated account; guests have no account reference and need no account. Each session has its own participant identity and permissions even when the same account attends multiple sessions. Submissions, feedback attribution and assignments use that stable participant session identity; reconnects and display-name changes do not change attribution. Resolve any account link from verified authentication, never a client-supplied account ID, matching display name or entered email. Account linkage grants neither workspace membership nor admission and does not merge existing guest work automatically. A later guest-to-account conversion is outside this decision; cross-session learner profiles remain deferred.
- Removal, role revocation, and session end affect existing connections, not only newly issued tokens. Short-lived tokens alone are insufficient.
- No live-session recording or hidden replay is introduced through logs, debugging, captions, or provider defaults. Uploaded resource video is separate content with its own permissions and retention.
- A broadcast grant is explicit and ends on Stop, disconnect, role loss, route change, or session end. Reconnect cannot resume microphone publication automatically. Recipient failures remain visible without implying that an announcement was heard.
- Group video playback has one authorized controller and an authoritative state revision. Reconnect restores permitted playback state; it cannot silently resume an announcement-paused video. If browser autoplay blocks playback, show a local action to recover and keep task work available.

### Instructional execution rules

External-client publication of a group submission requires approval from every contributing member for the exact content/version and client audience. The recorder cannot approve on behalf of others. For this approval, contributors are everyone assigned to the group at submission time, including verbal contributors. Preserve that roster snapshot and attribution across later membership changes; missing approvals block external sharing. Within-workshop sharing follows the previously disclosed rule.

Disclose before group contribution that group submissions may be shared within the same workshop. This does not permit external-client publication or disclosure of private individual answers/observer feedback. Identifiable feedback shared beyond its original audience requires both author and subject approval for the exact version/audience; either pending, declined or withdrawn approval blocks expanded publication.

Client-summary invitations expire seven days after issue. Verified grants last 30 days, subject to earlier consultant revocation, source expiry or withdrawn approval. A replacement invitation or repeat verification cannot silently restart an existing grant. Invitation validity and access duration are separate.

Group drafting uses structured fields, visible conflict recovery and a designated recorder submitting. Assigned members can contribute without a simultaneous rich-text editor. Field types and detailed conflict handling remain to be specified; acknowledged contributions cannot be silently overwritten.

Accepted 18 November 2026: individual and group submissions share one submission model with exactly one owner: a participant session identity or a group. Record who submitted separately from ownership. An individual submits their own work; the currently assigned recorder submits on behalf of the group. Group submissions freeze the roster of everyone assigned at submission time, including verbal contributors. Recorder replacement and later membership changes never transfer ownership or rewrite that roster. Revisions remain linked attempts and publication approvals remain tied to the exact item/version and audience.

The facilitator may appoint or replace the recorder while preserving draft content and attribution. All assigned members may contribute; only the current recorder may submit. A recorder change is a permission change, not a change in authorship. Race handling between replacement and submission must be tested.

A consultant can share a curated, read-only session summary with an explicitly invited client contact who verifies the invited email address; no paid account is required and public-link possession alone is insufficient. Verified access lasts 30 days from granting access, subject to earlier consultant revocation, source-content expiry or withdrawn publication approval. Re-verifying the same grant cannot reset its expiry. Only material approved for that client audience is exposed. Session-only approval does not automatically permit client publication. Private answers/observer feedback, unrelated sessions and workspace administration remain inaccessible. The seven-day invitation redemption deadline is separate from the 30-day verified grant.

- A step is Pending, Ready, Running, Paused, Completed, or Skipped. A review assignment is Pending, Assigned, Submitted, Reassigned, or Waived. These are separate from media connectivity and room-work status.
- Submitted attempts are immutable snapshots; edits create drafts and a later submission creates a linked attempt while the activity accepts work. After closure, an authorized facilitator must explicitly reopen corrections. Feedback and consumed downstream inputs retain their referenced versions; publication approvals never silently move to a new version. Reopening never rewrites history.
- The agenda is sequential. Input references point to valid earlier outputs; reject missing or incompatible inputs, forward references, and cycles. Reordering cannot invalidate consumed inputs without an explicit recovery decision; no general branching engine is required.
- Group membership is snapshotted at submission. Leaving or moving groups does not rewrite authorship, expose private responses, or transfer ownership of individual work.
- Advancing a step first commits the plan/assignment revision. Media movement is then reconciled; clients with failed transfers see a pending state and never gain both room privileges. A failed transfer does not cause a second attempt or review assignment.
- Accepted 18 November 2026: joining a group grants access to the current activity's shared draft and subsequent group work while assigned, subject to step policy and current permissions. Membership alone does not expose submissions made before the person joined; earlier submissions require an explicit sharing or activity-routing grant. Individual answers and private feedback retain their separate permissions. Assigned reviewers and authorized facilitators retain their explicitly scoped access. After reassignment, participants retain access to submitted group-output snapshots they helped produce, subject to explicit revocation and retention; former-group private resources and ongoing/future drafts are no longer accessible unless independently assigned. This historical grant does not grant access to later group work. Membership changes and submission must resolve consistently so access and contributor snapshots agree.
- Late arrivals receive a facilitator-assigned path for missed prerequisites; no initial response is fabricated. Missing reviewers do not cause automatic self-review or accidental disclosure.
- Checklist changes create a new version for future rounds. Comparisons across different criteria are labeled and never treated as equivalent measurements.
- Debrief identity hiding removes names from the display, not identifying details within authored content. Facilitator previews/redacts a publication copy; the restricted original stays intact.

### Reliability acceptance across services

Implement the operational proof in [SaaS reliability review R1-R8](engineering/SAAS-RELIABILITY-REVIEW.md) through existing tasks. Define bounded authorization freshness under partial service loss; durable retry of committed transitions; aggregate admission/headroom limits; active-client release/rollback compatibility; coherent database/storage restoration that reapplies deletions, revocations, absolute expiry and current billing before reopening access; complete host-account/closure handling; exercised incident response; and visible, accessible degraded states for each dependency. These are proof obligations, not implemented capabilities or service-level guarantees.

### Delivery consistency rules

- Each session fixes its definition and policy snapshot; identifiers never collide across tenants/sessions. Duplicating a workshop copies configuration, not live state or personal records.
- Resource release and message creation commit stable recipient records before delivery; retries reuse IDs. Show partial delivery and allow targeted retry without duplicate messages or release effects.
- Manual resource release is permissioned independently from room management. Role loss stops pending privileged operations and denies further private reads.
- Help acknowledgement is distinct from a reply/visit and being marked handled; a broadcast never silently handles every request.
- Resource, response, caption, and playback permissions apply to subscriptions, downloads, previews, exports, and reconnect recovery, not just visible UI lists.
- Private individual publication checks exact item/version, author approval, and audience. Changes to the proposed publication require a new preview/approval; declined or pending items cannot leak through debrief or participant-summary exports.
- The mockup's identity/role switch and reset-on-refresh behavior are demonstration affordances, not production identity, persistence or security specifications.

## 12. Performance and quality targets

All values below are proposed acceptance targets, not demonstrated performance. Record test networks, browsers, media settings, and sample sizes.

| Measure | Target |
|---|---|
| First pilot | At least 20 participants, one facilitator, one main room, all rooms required by the agenda; all three formats |
| Later capacity validation | 40 participants, eight breakouts, one main room; 90-minute endurance hypothesis |
| Task/message propagation | p95 ≤2 seconds after server acknowledgement |
| Autosave acknowledgement | p95 ≤2 seconds on supported test network |
| Listen switch | p95 ≤3 seconds from selection to usable audio when room is available |
| Conversation latency | p95 ≤500 ms one-way mouth-to-ear on declared supported network |
| Local Stop | Audible monitored playback ceases within 250 ms; subscription cleanup separately measured |
| Task reconnect | Authoritative state restored within 10 seconds after network restoration |
| Media reconnect | p95 ≤15 seconds after network restoration on declared profile |
| Room transfer | p95 ≤5 seconds on declared profile; pending/failure always visible |
| Isolation | Zero unauthorized room media delivery in acceptance tests |
| Endurance | Full agreed pilot duration at its actual capacity without lost acknowledged outputs; 90-minute scale test later |
| Step configuration propagation | p95 ≤2 seconds after transition acknowledgement; media transfer target measured separately |
| Instructional correctness | Zero wrong-person feedback disclosure, overwritten submitted attempts, or misattributed individual evidence in acceptance tests |
| Resource/message propagation | p95 ≤2 seconds after server acknowledgement on supported network; video/file download time measured separately |
| Delivery isolation | Zero wrong-audience resource, caption, response, feedback, or debrief exposure; no unauthorized announcement recipients |
| Session persistence | Acknowledged responses, outputs, feedback, help requests, messages, releases, and publication approvals survive disconnect and service restart |
| Video synchronization | Measure startup, play/pause/seek propagation and drift under the supported network matrix; agree acceptance bounds at the media gate; blocked/desynchronized clients are visible |
| Announcements | Test one/selected/all targets, intelligibility, video pause and explicit resume, delivery failures, and route termination; quantify latency at the media gate |
| Captions | Validate language coverage, accuracy, latency, controls, and audience isolation before the first usable pilot; agree acceptance bounds with pilot accessibility needs |

Measure main-room gallery performance separately from breakouts. Use limited visible video tiles and adaptive receive quality; optional camera use must not imply every camera is rendered at full resolution. Measure facilitator device CPU, memory, network, and connection cleanup as well as server load.

### Engineering quality and acquisition readiness

Accepted 17 November 2026: the programming structure and quality must support technical due diligence by a potential acquirer such as Google, Meta or an LMS company. Build for maintainability, reproducible verification, security, reliability, documented ownership/provenance and transfer to another engineering team from the outset. The [engineering quality contract](engineering/QUALITY-BAR.md) defines gates QG-01 through QG-08 and assigns them to existing delivery tasks. These are required engineering outcomes, not a guarantee of purchase or buyer approval. Their implementation and evidence are currently unverified.

## 13. Authorization, accessibility, and data handling

Tenant, session, room, and capability checks apply to every task read/write, export, media grant, and privileged command. Shared session links do not grant organization browsing or historical work. A participant may return to permitted work and exports using their private participant identity during the 90-day session-retention period; lost access requires facilitator-verified recovery. Resource permissions, revocation and earlier deletion still apply. Administrative access does not imply live listening authority. Keep listening start/stop and policy changes auditable. Individual responses, rubric feedback, review allocations, and debrief publication have distinct audience permissions. Peer reviewer access expires when the round closes or authorization is withdrawn; received feedback remains available to its authorized subject under retention policy. Verified early-deletion requests are handled by the workspace owner or explicitly delegated data administrator within authorized scope. Remove affected personal evidence and dependent publications; preserve separable contributions from other members where possible. Inseparable joint records require explicit review rather than automatic whole-group deletion. Publication withdrawal remains independently immediate. Deletion follows linked artifacts and publication copies; broken references are marked unavailable rather than silently substituted.

Participant notice explains live media transport, named listening, speaking/announcements, caption processing, and retention. Caption display is individually controlled; the processing policy is disclosed. Capture/transport availability and active human listening are different states. Named listening notices are mandatory; undisclosed listening is unsupported. Participants may immediately leave live audio/video and caption processing without facilitator approval and continue permitted written activities. Show task-only status to the facilitator and require explicit action to rejoin media. Stop active media/monitoring/caption grants and prevent automatic reconnect from undoing withdrawal; do not promise that audio already heard can be withdrawn.

Use encrypted transport and storage. Do not claim end-to-end encryption merely because WebRTC transport is encrypted; any E2EE offering requires a separate key-management and processing design. Secrets and provider administrative credentials remain server-side.

No live-session recording, retained transcript or replay buffer. Accepted product default: retain session outputs, responses, feedback, polls and messages for 90 days after session end, subject to earlier authorized deletion. Reusable workspace agendas/resources persist under active entitlement and have a separate 90-day read-only recovery period after entitlement ends; ending one delivery does not schedule their deletion. Abandoned Live sessions end at their original four-hour deadline, including when the facilitator never returns; that effective end timestamp starts retention even if cleanup runs later. Never-launched workshop drafts remain reusable preparation content. Operational/security logs and backups still require explicit policies. Live captions remain ephemeral; uploaded videos/caption files follow the applicable resource/content policy. Export and deletion remain access-controlled.

Accessibility acceptance covers keyboard navigation, screen-reader names/status, readable contrast, non-color indicators, usable task work without camera/microphone, text help/messages, accessible video controls, live captions, and captioned resource videos. Validate languages and accommodations with the pilot partner before recruitment; caption capability is a requirement, not an optional upgrade. Timer announcements must not overwhelm assistive technology. Do not claim full accessibility from a checklist alone.

Retention applies to resource versions, uploaded videos/captions, help requests, message threads, sharing approvals, and workshop outputs. Individual answers remain private to author and authorized facilitator; anonymous response summaries must not expose identities. Authors preview and approve each identifiable item for workshop sharing, and can decline without blocking participation. Group submissions follow the workshop-sharing rule disclosed before contribution. Private briefs and group requests stay out of general summaries. File attachments and linked content need their own deletion/revocation coverage; external copies cannot be recalled.

AI summaries, when later introduced, remain drafts. Do not infer learning, engagement, consensus, or cognitive change solely from speech quantity, silence, typing, or presence.

## 14. Success measures

Pilot success requires reduced facilitator coordination work, acceptable preparation effort, and willingness to pay for another delivery. Establish the partner's existing workflow and preparation/delivery baseline before setting numerical improvement targets. Prefer equivalent tasks and the same facilitator where feasible. Completion alone demonstrates operation, not adoption or learning effectiveness.

| Measure | Pilot target | Evidence |
|---|---|---|
| Solo administration | One facilitator runs at least 20 participants through all three formats; eight-room load tested later | Observation, help handling, activity completion, workload rating |
| Preparation effort | Acceptable to the pilot facilitator; measure first setup and subsequent duplication/editing | Timed preparation, errors, and reusable-agenda feedback |
| Administration time | Lower than the partner's baseline; numerical threshold agreed before evaluation | Matched-task navigation, transitions, help, and collection time |
| Willingness to pay | Concrete willingness to pay for another delivery; pricing remains open | Follow-up commercial discussion and stated price/conditions; interest alone is insufficient |
| Help responsiveness | Measure acknowledgement and reply/visit delays; set target against baseline | Request and response timestamps, outstanding requests |
| Output completion | Measure required work completed, partial, missing, and waived | Attributed submissions; denominator and exceptions reported |
| Onboarding and media readiness | Measure time to usable task, conversation, and captions; agree thresholds for the pilot | Device/network failures, recovery and task-only entry reported separately |
| Participant clarity | Improved relative to baseline | Short participant survey |
| Audio correctness | Zero cross-room leakage in acceptance testing | Instrumented authorization/media tests |
| Executable delivery | All planned step changes and input references resolve correctly or surface an explicit override | Step/assignment audit and facilitator observation |
| Feedback/retry completion | Every participant is scheduled for a practitioner turn and retry; completed/missing/waived work is visible | Role rotations, feedback records, and attendance exceptions |
| Individual evidence coverage | Every consenting pilot participant has an initial and transfer response or explicit missing/waived status | Individual records; group work never substituted |
| Debrief provenance | Every published evidence item resolves to its authorized source version | Traceability and audience tests |
| Protocol coverage | All three formats pass functional rehearsals and are covered in the first observed pilot | Run records, uneven-group handling, facilitator and participant feedback |
| Media-resource usability | Announcements, individual/group video, captions, and allocated resources work during real activities | Observation of interruptions, resume behavior, controller burden, and access errors |

Pilot performance improvement is exploratory: use criterion-level comparison where tasks and rubrics are comparable, report missing data and rater limitations, and do not claim causal learning gains. Transfer tasks must be authored to test application, not simply repeat the initial answer.

A response means explicitly submitted work. Do not count speech or presence as a completed response. Measure the additional burden of replacing a familiar meeting tool, including admission, device support, and trust in listening notices.

Additional acceptance measures: targeted releases and announcements reach the intended audience or show failure; no unintended recipient gains content; publishing identifiable individual work requires approval for its exact version/audience. Report these as operational correctness, not proof of learning effectiveness.

## 15. Release sequence

| Phase | Deliverable | Exit |
|---|---|---|
| 0 — Media and interaction demonstration | Begin with main room + four breakouts; switching, visible listening, spoken announcements, videos, captions, resource isolation, and work recovery | Repeatable evidence for critical paths, topology and supported-source limits, initial cost model; pass before committing to full build |
| 1 — Integrated prototype | Build/Run/Review; reusable custom agendas and all three templates; help; media/resources; checklist feedback/retry; item-specific publication approval; review/exports | Complete linked activities, preserved attempts, valid access/release behavior, and recovery; no dedicated simulation system |
| 2 — First pilot readiness | At least 20 participants and required room count; all three formats; actual browser/network/media configuration; baseline measurements; operational support | Rehearse uneven groups, missing experts, role rotations, video interruption, caption isolation, reconnect, and permissions; confirm partner and practical session duration |
| 3 — First observed pilot | One facilitator, at least 20 participants, all three formats; partner may run training or simulations | Compare coordination and preparation effort with baseline; inspect workload, media usability, evidence, costs, and willingness to pay |
| 4 — Later capacity validation | 40 participants, eight concurrent breakouts, agreed endurance scenario | Repeat media, recovery, accessibility, isolation, and workload checks at scale before advertising that capacity |
| 5 — Initial release | Organization onboarding, deletion/export, monitoring, support/runbooks, usage limits | P0 requirements pass at published operating capacity; support owner and cost limits accepted |
| 6 — Expansion | Additional formats, specialized simulation features, AI, integrations, broader browsers/mobile or deployment options | Separate demonstrated demand and technical/permission evidence; no automatic scope commitment |

Calendar and budget estimates follow phase 0. The standalone decision removes dependence on Zoom breakout audio support; it does not remove the need to prove media reliability and operating costs.

## 16. Acceptance scenarios

### A. Reusable agenda and native operation

One facilitator duplicates a complete agenda, changes its scenario content, and combines jigsaw, peer instruction, and role practice with custom briefing/debrief stages. Configuration, role briefs, resources, checklists, and timing survive reload; the duplicate contains no prior participants, attempts, approvals, or live state. Rehearsal is isolated from the live session. Manager training on difficult feedback conversations is a candidate example; the pilot partner and subject remain open.

At least 20 participants join through one browser link, complete device preflight, and enter the main room. Test denied microphone permission, camera-off participation, and independent caption controls. The facilitator previews each transition, adjusts groups or timing, and advances explicitly. Timer expiry never forces a room move or submission. Participants see one current task and an unambiguous room/role.

At exactly 20, support six concurrent role-practice rooms, five jigsaw home rooms, and four expert rooms at their respective stages. No initial eight-room requirement substitutes for the agreed first-pilot configuration. Later, repeat the relevant tests at 40 participants/eight simultaneous breakouts before publishing that capacity.

### B. Peer instruction and publication consent

Participants submit private individual answers with rationale. Their peers cannot retrieve answers or identities through UI, API, or export before a permitted reveal. Group discussion begins; each person then submits an individual re-answer. The original and revised answer remain distinct and attributable to the same stable participant. An anonymous response summary can be revealed without publishing named answers; neither answer changes nor group performance create a learning score.

The facilitator pins a specific individual answer for debrief and requests publication permission. Its author previews the exact item/version and intended workshop audience, then approves or declines. A pending or declined item is excluded from public debrief and participant-summary exports without blocking the activity. Editing the proposed publication or changing its audience invalidates the earlier approval. Preserve the original submission. Group work follows the sharing rule shown before contribution.

Pass: both answer versions survive reconnect; unauthorized reads fail; approvals are version/audience-specific; a declined item never leaks through another view or export; the facilitator can still complete the debrief.

### C. Role practice and jigsaw with uneven attendance

Role practice at 20 uses four trios and two groups of four. Assign practitioner, counterpart, and observer; groups of four have two observers. Briefs are role-scoped. Observers record trainer-authored checklist feedback in writing. Each person gets a practitioner turn and retry after feedback; the schedule includes sufficient rounds for groups of four and shows outstanding turns, feedback, and retries. An absence or disconnect prompts reassignment or an explicit recorded waiver, never fabricated completion. No numeric or automatic speech grading is required.

Jigsaw uses four trainer-defined topics. Preview five home groups of four, then four expert groups of five. Preserve both mappings, return participants to their original home groups, collect synthesis, and then individual transfer work. Remove an expert during rehearsal: surface the missing topic coverage and require a facilitator adjustment or explicit fallback. A media-room visit alone cannot grant private topic resources.

Pass: all three templates work with normal and uneven rosters, missing members, disconnects, and retried advance commands. No duplicate transitions, overwritten attempts, unauthorized feedback, or silently impossible assignments. Cover all three formats in the first observed pilot.

### D. Resources for individuals, groups, and roles

Allocate an individual brief, distinct group case packs, observer-only instructions, a shared captioned video, and a manual-release update. Exercise availability from session start, on activity start, and on manual release. Preview the exact intended recipients, including mixed individual/group/role allocations. Before release, unauthorized users cannot list titles, previews, files, captions, or playback state.

Move a participant between media rooms without changing their resource assignment: their individual brief remains available and the visit alone grants no destination-group material. Then change an actual group/role assignment: re-evaluate access and stop revoked playback/subscriptions where supported. Preserve explicit jigsaw home/expert membership rules. Retry release after a connection loss without duplicate messages. Link access and exports enforce the same policy. Previously downloaded copies cannot be recalled.

Pass: correct audience, timing, version, and release notification; missing delivery is visible; zero wrong-recipient disclosure; room movement and assignment changes remain distinct.

### E. Announcements, video playback, captions, and screen sharing

Different rooms watch different videos while another discusses its task. Demonstrate individual viewing and synchronized group viewing with one designated controller. Play, pause, and seek propagate only to the authorized group; participants retain local volume/caption controls. Exercise buffering, a late join, autoplay denial, controller disconnect, and reconnect. Show blocked/desynchronized playback and a recovery action; do not silently claim successful synchronized viewing. Test uploaded video and each supported linked player; label unsupported embeds as link-outs without promising automatic pause or synchronization.

The facilitator previews and starts spoken announcements to one, selected, and all rooms within the same session. Targets see the named speaker, hear reduced conversation audio, and have Debrio-controlled videos paused. Untargeted rooms are unaffected. No room hears another room, and no camera or screen-share is broadcast implicitly. Captions contain only the authorized conversation/announcement. End, Stop, disconnect, or revoke the facilitator role: transmission ends, conversation volume restores, and controlled videos stay paused until an explicit user/controller resume. Reconnect cannot restart the broadcast. Show failed targets; written follow-up is available without replaying recorded audio.

Test one screen presenter in the main room and independently in each breakout, with explicit handover. Leaving a room ends its screen share. Participants can enable live captions independently; video caption controls are usable and uploaded resources have supplied captions. Missing required captions block readiness for the affected activity. No session recording or retained transcript is created by these flows.

Pass: no media/caption/resource leakage; explicit targets and handover; supported videos recover; announcement pause/resume works; actual synchronization, caption quality, latency, browser limitations, and cost meet documented gate criteria.

### F. Help, work recovery, and session end

A participant requests help with no message; another includes a short message. Both reach the queue with author, room, age, and acknowledgement state. The facilitator acknowledges, replies in writing or visits, and explicitly marks handling complete. A broadcast never exposes the private request or automatically handles it. A failed written announcement shows pending/failed delivery and retries without duplication; delivered never implies read.

A participant loses task connectivity and sees unsaved work. Acknowledged revisions survive; conflicts cannot silently overwrite work. Media failure and task failure are shown separately. Transfers preserve work and revoke old media permissions without altering unrelated resource assignments. Failed transfers have recovery controls. A co-facilitator loses authorization; existing monitoring and announcement routes stop. Closing rooms returns participants with failures listed; ending the session revokes live access and prevents stale connections or invitations from reopening it.

Pass: no lost acknowledged work, unauthorized media, silent privilege retention, or falsely reported delivery/completion.

### G. Human-run simulation through shared tools

An organizer creates custom briefing, deliberation, decision, and debrief stages. Assign private group/individual briefs, release an update to selected groups, collect decisions and rationale as ordinary outputs, and communicate a human-authored outcome as a scoped message or resource. The organizer controls progression explicitly. No separate Simulation mode, proposal lifecycle, turn engine, or adjudication console is needed.

Verify that groups cannot retrieve one another's restricted briefs, outputs, messages, or videos. Review and export preserve those boundaries. An organizer's written outcome is an attributed communication, not a calculated effect or claim of real-world execution. This scenario checks the shared-tool boundary; it does not replace first-pilot coverage of all three instructional formats.

### H. Product validation

Before evaluation, document the partner's current preparation and delivery workflow and agree numerical success criteria. Observe one facilitator with at least 20 participants through all three formats. Measure setup and repeat preparation time, coordination work, help delays, regrouping, media interruptions, evidence completeness, debrief effort, and participant clarity. Record absent/waived work separately.

Discuss willingness to pay for another delivery, including the required support and realistic media/video/caption costs. Usable software and completed activities alone do not prove adoption or learning effectiveness. Report results, failures, and unresolved limits before the later 40-person/eight-room validation.

## 17. Commercial hypotheses and operating model

Accepted packaging: one complete paid plan for solo trainers and organisations, plus invited tester coupons; permanent public free workspaces are deferred. Participants remain free. The user as platform owner has permanent free use, implemented as a scoped billing entitlement rather than a universal permission bypass. The exemption applies to the designated owner workspace linked to the verified owner account, with ordinary technical capacity limits unless explicitly reconfigured. It does not follow the account into customer workspaces. Numeric price/currency and allowances remain open.

Reusable agendas/templates/resources stay available under an active entitlement until authorized deletion. After entitlement ends, retain them read-only/exportable/recoverable for 90 days with deletion warnings. Reactivation within that window restores editing but not expired participant records. This is separate from the 90-day session-record clock measured from session end.

Commercial direction: workspace subscriptions through Stripe support both an individual trainer/consultant and an organisation. Guest participants do not need paid accounts. One complete paid plan is accepted; monthly billing only initially; numeric price/currency and usage/capacity allowances remain open. Cancellation retains access through the paid period, then the agreed read-only recovery period. Existing paid customers get seven days to resolve failed renewal before new hosting is blocked; running sessions retain their original four-hour ceiling. Validate willingness to pay for reduced delivery coordination, repeatable practice/feedback workflows, and usable evidence of participant performance. Validate the cost and effort of authoring reusable plans and rubrics as well as running them; sophisticated execution is valuable only if trainers can prepare it efficiently.

Track cost per session: participant connection minutes, monitoring and announcement connections, media bandwidth/egress, relay traffic, uploaded-video storage/delivery, caption processing, collaboration/database usage, and support effort. Model camera-on/off, video-resource use, and simultaneous announcement targets separately. Do not price from participant count alone. Provide usage visibility and advance warnings; avoid abruptly cutting off a running workshop because a soft allowance was reached. Hard capacity limits are enforced before admission and explained clearly. Pricing and commercial terms remain unconfirmed.

Initial operating responsibilities include media-provider incidents, browser/device support, participant admission problems, lost-control recovery, data deletion, and workshop export recovery. Provide named live incident coverage for scheduled pilot sessions. Publish initial paid-service support hours with timezone, incident information and a contact route; no 24/7 response guarantee is implied. Before the applicable gate, confirm the actual owner/escalation/contact configuration and rehearse alert receipt, acknowledgement, action and verified recovery.

## 18. Open decisions and required next documents

| Decision | Current baseline | Needed before |
|---|---|---|
| First pilot partner and subject | Training provider or online simulation organizer with a concrete session, at least 20 participants, and evaluation commitment; all three formats must be covered; manager training is a candidate only | Pilot recruitment |
| Pilot schedule and assignments | At 20: four trios plus two groups of four for role practice; four-topic jigsaw with five home groups/four expert groups; duration and actual attendance require validation | Pilot rehearsal |
| Simulation boundary | Human decisions and progression through shared custom stages/resources/messages; specialized console and workflows deferred | Check candidate organizer's actual exercise needs before promising fit |
| Standalone polling | Single/multiple-choice; fixed opening audience; privacy fixed once responses begin; revise until close, separate reveal; repeats create fresh rounds. Opened questions/options frozen; corrections use fresh rounds; removed participants' cast votes retained subject to authorized deletion; 90-day retention and scoped exports | P3-05 before implementation |
| Resource retention/historical access | Released shared content persists in session; reassigned members retain contributed submitted snapshots, lose former private resources/drafts; revocation and retention apply | Access implementation |
| Attachment policy | File types, size limits, malware handling, residency and download controls unconfirmed | Production upload implementation |
| Objectives and checklists | Trainer-authored written observations; versioned criteria; numeric and overall grading deferred | Integrated prototype |
| Publication lifecycle | Item/version/audience-specific author approval required for identifiable individual work; group-sharing and approval rules accepted; withdrawal blocks expanded access; verified deletion handled by workspace owner/delegated data administrator with shared-contribution review | Permission design and pilot agreement |
| Protocol defaults | Peer instruction, role practice, jigsaw; core sequences fixed, content/timing/group sizes configurable; validate rounds and missing-member recovery | Pilot readiness |
| Assessment interpretation | Descriptive evidence; transfer-task and rubric quality reviewed with pilot owner | Pilot protocol |
| Media engine/topology | LiveKit candidate; separate media rooms | Phase 0 exit |
| Browser/network support | Desktop Chrome/Edge candidates | Pilot readiness |
| Captions/accommodations | Live captions and captioned videos required; provider, languages, accuracy/latency bounds, processing terms, and cost unconfirmed | Media gate and recruitment |
| Video sources and playback | Uploads and supported links; individual/group viewing and announcement pause required; formats/providers, limits, synchronization bounds, and link-out behavior unconfirmed | Media gate |
| Announcement delivery | One/selected/all rooms in one session; microphone only; audience preview and named notice; transport, collision handling, latency, and failure thresholds need validation | Media gate |
| Admission assurance | Expiring guest link + lobby; authenticated facilitators | Prototype security review |
| Retention/residency | Session content: 90 days after session end, earlier authorized deletion allowed. Reusable content has a separate 90-day recovery period after entitlement ends; abandoned sessions end at the original four-hour deadline. Logs/backups and provider residency remain open | Lifecycle implementation and pilot agreement |
| Cameras/gallery limits | Optional camera; bounded visible tiles | Capacity test plan |
| Budget and delivery date | No new infrastructure spending; tester coupons supplied by user, terms and provider allowance validation pending. Date unconfirmed; prospective East Coast US contact; debrio.app supplied, domain control/DNS unverified | Prototype planning and pilot readiness |
| Pricing and repeat-delivery value | Organisation/workspace subscription through Stripe; workshop participants join free. Monthly billing, period-end cancellation and seven-day failed-renewal grace accepted; price/currency, allowances and remaining lifecycle details remain open; measure baseline and willingness to pay. See [billing decision](engineering/BILLING.md) | Architecture, pilot evaluation and paid-release decision |
| Public availability | Assisted invitation-only pilot first; paid self-service after validation; onboarding/support/distribution details remain open | Release planning |
| Self-hosting/air-gap | Deferred; no current promise | Separate customer-led scope decision |

Next documents, produced only as needed for the next delivery stage: media architecture/authorization decision with announcement, caption, and video feasibility evidence; simple agenda and three-template execution rules; assignment/release and item-sharing permission specification; API/state contracts; reliability/isolation/accessibility and instructional test plan; pilot protocol with baseline measures and cost model; operating runbook. This PRD records agreed product direction, not implementation readiness. The initial stack and no-additional-spending constraint are accepted. Timeline, actual partner, numeric pricing, account allowances/configuration and conditional media/caption feasibility remain delivery inputs or evidence gates.

## 19. Change record

### 17 November 2026 — Acquisition readiness quality requirement

The user requires programming structure and quality suitable for serious acquisition due diligence. Section 12 and the engineering quality contract add explicit architecture, CI, testing, security, operations, accessibility, provenance and handover gates within the existing task sequence. No application or buyer certification is claimed.

### 17 November 2026 — Final interview consolidation, Q42–Q58

Accepted the initial stack with Postmark transactional mail/Auth SMTP, conditional LiveKit media/captions and unchanged no-additional-spending constraint. Confirmed designated owner-workspace exemption, ordinary capacity limits, isolated multi-workspace membership, monthly billing, period-end cancellation and seven-day failed-renewal grace. Confirmed submission-roster approval, reassignment history, task-only withdrawal, frozen poll questions/fresh corrections, retained removed votes, private-identity post-session review and abandoned-session expiry. Lead-delegated continuation, explicit reopening of corrections and scoped verified deletion of shared evidence complete the numbered interview. The engineering index consolidates the build baseline; readiness checks remain explicit. Earlier change entries below preserve historical decisions and unresolved states at that time, superseded by later accepted answers.

### 17 November 2026 — Offering, owner exemption and workspace lifecycle

Accepted one complete paid plan and invited tester coupons, with no permanent public free workspace initially. The platform owner receives permanent free use; scope/identity still to specify securely. Reusable content persists while entitled and for a 90-day read-only recovery period afterward. External group publication requires every contributor's exact-item/audience approval. Team content survives creator departure; ownership transfer requires recipient acceptance and preserves exactly one primary owner for an active workspace, or explicit closure.

### 17 November 2026 — Session limits, recovery and sharing

Accepted four-hour sessions without resetting on reconnect/extension; 90-day session-content retention after session end; shared-link/lobby admission; facilitator-verified recovery revoking the old device; disclosed within-workshop group sharing; feedback author-and-subject approval for expanded publication; seven-day client invitations separate from 30-day verified grants. Resource/log/backup policy and hosting feasibility remain open.

### 17 November 2026 — Tester and client access periods

Accepted 30-day 100% tester discount from redemption, no payment card, one discount per invited workspace and platform-operator-approved extensions. On expiry retain read-only work/permitted exports within retention, block new hosting and allow an already-running session to finish within its configured maximum. Paid continuation remains explicit opt-in. Repeating closed polls creates fresh rounds preserving earlier results. Client-summary grants last 30 days with earlier revocation/source-expiry/withdrawal enforced; verification does not reset the grant. Numeric session maximum, retention and invitation lifetime remain open.

### 17 November 2026 — Tester discount and access follow-up

Accepted 100% tester subscription discounts for a defined period, restricted to invited customers with controlled redemptions. No automatic paid renewal: paid continuation requires explicit opt-in. Existing accounts/allowances/credits may be used without additional spending. Poll audience fixed at opening, with room movement not changing eligibility and revocation still enforced. Client-summary access requires verification of the invited email without a paid account. Duration/card/expiry details remain open; no offers or provider accounts configured.

### 17 November 2026 — Complete tester setup and accepted interaction rules

The user requires a professional, complete setup, will provide tester coupons and prohibits new infrastructure spending. Coupon amounts/terms are not set; no permanent free tier or reduced tester product is implied. Billing/coupon support therefore moves before tester readiness, retaining task ID P6-03. Accepted single/multiple-choice polling, main/selected/all-room targeting, identified/aggregate-only privacy, answer changes until close and separate result reveal. Accepted invited-client read-only approved summaries and facilitator-controlled recorder replacement preserving work/attribution. Earlier provisional budget/poll statements are superseded.

### 17 November 2026 — Foundational interview decisions

Accepted consultant-owned delivery with session-scoped client access, assisted pilot before paid self-service, final pricing after cost/buyer evidence, structured group drafts with recorder submission, and one modular application/relational database with managed supporting services. Prospective pilot contact: East Coast USA. Domain: debrio.app. Zero pilot budget requested, conservatively no new spending until clarified. Polling retained; detailed rules and ranking unresolved. Vendor plans, free-tier capacity, trial packaging and delivery date are not accepted by these answers.

### 17 November 2026 — Independent trainers and consultants

The user explicitly included consultants and individual trainers. A single person can own a workspace, subscribe and facilitate without a company or team. Workspace-based billing and free participant access are preserved; no distinct solo pricing tier is accepted. P2-01 owns individual onboarding/workspace access, P6-03 owns individual billing proof, and P5-01 includes the complete solo delivery path.

### 17 November 2026 — Platform name

The platform is named **Debrio**. Project documents, the interaction mockup, exported demo filenames and repository-local skill names use this name. Product requirements and open interview decisions are unchanged.

### 17 November 2026 — Transactional communications

The user requested communications and confirmed transactional messages only. Add account/invitation emails, workshop reminders and change/cancellation notices, and billing communications to the existing scoped in-app notices. Marketing campaigns and newsletters are excluded. Guests still join free without an added email requirement. The [communications contract](engineering/COMMUNICATIONS.md) defines proposed channels/providers and unresolved policies; P0-02 accepts those choices, P4-06 implements application delivery and P6-03 integrates billing notices. No messaging service is implemented or configured by this decision.

### 17 November 2026 — Subscription decision

The user selected Stripe for subscriptions and confirmed an organisation/workspace subscription with free participant access. Prices, tiers, billing intervals, usage allowances and failure/cancellation policies remain undecided. The [billing decision and delivery contract](engineering/BILLING.md) records these choices; P0-02 owns policy/architecture and P6-03 owns implementation before paid release. This supplements the existing workshop requirements without changing their IDs or claiming billing is implemented.

### v0.5 — Agreed structured-session scope and media requirements

Repositions Debrio for training providers and online simulation organizers using one shared session product. Narrows instructional templates to peer instruction, role practice, and jigsaw; adds reusable complete agendas and simple custom stages. Removes initial obligations for separate simulation-control/proposal/adjudication workflows and elaborate RFIs; flags unaddressed standalone polling/ranking as an open carryover decision. Adds simple help requests, written checklist feedback, item-specific publication approval, and explicit individual/group/role resource assignment with start/activity/manual release.

Makes spoken announcements to one/selected/all rooms, uploaded/linked video resources, individual/group playback, announcement pause with explicit resume, live captions, captioned videos, and screen-share handover explicit. No live-session recording. Expands the media gate and acceptance scenarios accordingly. Moves the first pilot to at least 20 participants with one facilitator and all three formats, uneven-group handling, and later 40-person/eight-room validation. Commercial validation requires baseline coordination/preparation measures and willingness to pay. Earlier entries below are historical, not current scope.

### v0.4 — Tactile workshop and simulation delivery

Adds the meeting-first interface and explicit main room, Workshop/Simulation contexts, human White Cell controls, scoped resource assignment and release, written RFIs with room replies, one/all-room messaging, and scoped polling. Adds U01–U04, G01–G07, Q01–Q05, O01–O06 and S01–S08. Updates R03/R04, domain contracts, state/authorization rules, release gates and acceptance scenarios. Manual adjudication is now in scope; automated simulation engines remain deferred. Expanded delivery scope requires re-estimation. The mockup is an interaction reference, not a passed production acceptance test.


### v0.3 — Training differentiation

Executable plans, practice/feedback/retry, individual evidence within group work, exercise-based debrief, and five structured collaboration protocols are P0 release capabilities. Added E01–E04, F01–F04, L01–L03, D01–D03, P01–P04, and B06; extended data contracts, permissions, transition/recovery rules, success measures, acceptance scenarios, and release gates. The expanded scope requires re-estimation after phase 0; the earlier delivery scope is not an unchanged effort baseline.

### v0.2 — Standalone direction from v0.1

| Previous direction | v0.2 direction |
|---|---|
| Zoom-integrated application | Standalone browser workshop platform |
| Zoom meeting binding and app context | Debrio invitations, admission, session identity |
| Zoom breakout adapter and manual-host reconciliation | Native room orchestration and media-membership reconciliation |
| Unverified Zoom breakout audio route | Explicit native monitoring design tested through reliability gate |
| Compact Zoom panel | Full web facilitator console |
| Browser task fallback | Browser is the primary conversation and task surface |
| Zoom distribution approval | Browser support, media operations, accessibility, and support readiness |

Build/Run/Review, versioned definitions, structured outputs, help, attribution, review, and export remain core requirements. Listen/Speak/Join now have explicit routing and failure semantics.

## 20. Technical references

Candidate references carried forward from v0.4; not re-verified during this product revision. They inform future investigation only. Debrio-specific media, announcements, captions, and video behavior remain subject to testing.

1. LiveKit — Subscribing to tracks: selective subscription and media playback controls.
   https://docs.livekit.io/transport/media/subscribe/
2. LiveKit — Room service API: backend room, participant, and subscription management.
   https://docs.livekit.io/reference/other/roomservice-api/

Provider selection, pricing, exact SDK versions, deployment conditions, and connection-grant behavior must be verified in the architecture decision and prototype. No adjacent infrastructure capability should be treated as proof that the complete workshop workflow is supported.

## 21. Downloadable interaction reference

Existing reference: [Debrio_Mockup.html](Debrio_Mockup.html). This older simulated UI has not been changed to implement v0.5. Its gallery-critique sample, polling controls, and dedicated simulation views describe earlier scope; they do not expand the current requirements. Open it in a desktop browser for interaction reference only. No production implementation or validated download package is claimed here.

| Area | Mockup behavior | Production requirement still outstanding |
|---|---|---|
| Meeting shell | Tactile presentation/gallery, side panels, role/context previews | Real WebRTC, certified devices/browsers, accessibility and capacity validation |
| Rooms/resources | Sample assignments, text/link/local-file attachments, release previews | Server authorization, durable object storage, malware handling and revocation |
| Messaging/RFI | Earlier detailed request flow and one/all-room messages in one tab | v0.5 simple help flow; real delivery to one/selected/all rooms, persistence, receipts, roles and recovery |
| Polls | Earlier local polling controls | Polling retained; precise behavior awaits specification and P3-05 implementation; peer-instruction remains separate |
| Simulation | Earlier dedicated briefs, injects, proposals, outcomes and turn controls | Dedicated simulation system is deferred; shared custom-agenda use needs validation |
| Workshop protocols | Gallery-critique sample and other previews | Implement the three agreed formats; gallery critique is deferred |
| Media resources and accessibility | No validated live media | Announcements, uploaded/linked video, synchronized playback, captions, screen-share handover, and recovery require implementation and testing |
| Evidence and persistence | Selected sample records and tab-memory state | Durable acknowledged saves, complete version lineage, tenant isolation and exports |

All camera/microphone/audio routing is simulated. No messages, polls, injects or proposed actions are transmitted to other users. Demo role/team selectors expose sample perspectives and are not security controls. Refresh resets local edits, messages, ballots, submissions and uploads. External user-supplied links require internet access. Mockup observations must not be used to claim production compliance, security, accessibility or scale.
