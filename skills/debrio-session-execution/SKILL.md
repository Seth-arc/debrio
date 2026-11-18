---
name: debrio-session-execution
description: Implement or review Debrio agendas, activity transitions, peer instruction, role practice, jigsaw, and session recovery. Use for orchestration and instructional behavior, not physics or automated simulation adjudication.
---

# Debrio session execution

Read [PRD v0.5](../../docs/Debrio_PRD_v0.5.md) sections 6–7, 11, and 16 and the task's accepted spec. Use [access and data](../debrio-access-and-data/SKILL.md) when routing changes permissions or persisted work.

## Execution contract

- One versioned linear agenda can combine the three templates and custom stages. Custom stages expose instructions, resources, groups, timing, and submitted outputs. No arbitrary branching engine or dedicated simulation-control system is implied.
- The facilitator previews and confirms stage/group changes. Timers prompt; they never submit work, move people, or declare completion automatically. Show missing prerequisites and record explicit overrides.
- The four-hour hosting ceiling ends abandoned sessions at the original deadline even without the facilitator; retention starts at that effective end, not delayed cleanup. Preserve saved work without submitting drafts; unlaunched definitions follow reusable-content policy.
- Opening a poll freezes its question/options. Corrections create fresh rounds; removed participants lose future access/voting but cast votes remain historical results subject to authorized deletion.
- Lead-delegated co-facilitators may continue within their capabilities on lead disconnect; the lead can designate a successor. Without an authorized facilitator, retain the current activity and show the disruption; do not promote a participant or reset the session deadline.
- Corrections create linked versions while work is accepted. After closure, only an authorized facilitator may reopen corrections. Preserve consumed downstream snapshots and original publication approvals.
- Cap each workspace at three live workshops, counting started sessions through activity pauses/disconnection. Enforce admission atomically with separate verified global/provider headroom; deny a fourth start without disrupting existing sessions. Drafts/ended sessions do not count.
- Commit recoverable reconciliation intent with state changes; a bounded runner must finish interrupted provider actions without browser retries, rechecking authorization and superseded revisions.
- The server owns state and deadlines. Commit the stage/assignment revision once, then reconcile media movement. Retries cannot advance twice or duplicate output/review assignments. A failed transfer is visible and recoverable.
- Peer instruction: private individual answer and rationale, discussion, individual re-answer, controlled summary/reveal and debrief. Preserve both answers. Do not infer mastery or assign an overall learning score.
- Role practice: practitioner, counterpart, observer; brief, practise, written checklist feedback, retry, rotate. Groups of four use two observers. Every participant is scheduled for a practitioner turn and retry; incomplete turns remain visible. At exactly 20, the agreed pilot uses four trios and two groups of four, requiring six simultaneous rooms and enough rounds for the groups of four.
- Jigsaw: trainer-defined topics, previewed home/expert groups, expert activity, return home, synthesis, individual transfer. The 20-person pilot uses four topics, five home groups of four and four expert groups of five. Missing topic coverage needs adjustment or explicit fallback. These are pilot defaults, not a fixed grouping algorithm for every attendance count.
- Attendance and disconnection must not manufacture evidence or delete authorship. Retain immutable submissions, feedback links, outstanding work, and permitted recovery context.
- Human-run simulations use custom stages/resources/messages/outputs. No turn engine, modeled outcomes, or proposal/adjudication lifecycle is required.

## Required proof

Test each changed transition through the public interface, including duplicate commands, competing facilitator actions, disconnect/reconnect, missing input, and role change where relevant. Prove grouping covers the actual roster and topic/role constraints, including uneven membership and an absent expert. Test persistence and media reconciliation separately so a mocked provider cannot conceal lost work.

Record task proof through [the engineering workflow](../../docs/engineering/WORKFLOW.md). The first observed pilot covers all three formats with at least 20 people and one facilitator; later scale validation is 40 people/eight breakouts. Automated clients do not substitute for observed human facilitation.
