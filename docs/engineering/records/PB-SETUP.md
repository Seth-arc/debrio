# PB-SETUP — Compile the engineering kit

Date: 17 November 2026 (America/Indianapolis).
Scope: compile installed engineering skills and create a phased Debrio promptbook with tasks, testing, completion, Git delivery, and written/demo evidence requirements. This is an authoring task, not platform implementation.

## Inputs and decisions

- Product source: `docs/Debrio_PRD_v0.5.md`.
- User explicitly requested Ponytail and installed Matt Pocock skills.
- User confirmed both written records and synthetic-data demo videos; actual participant sessions remain unrecorded.
- User selected a simple managed Vercel-based hosting direction and explicitly excluded Render. The complete Next.js/Supabase/LiveKit proposal still needs acceptance before scaffolding; no accounts or infrastructure were provisioned.
- Local lockfile verified Matt source attribution. Blueprint and Caveman skills are listed separately.
- Myelin-specific role/data/test/release/UI instructions are not imported as Debrio contracts.
- Local source skills live under `skills/`; promptbook tasks read them explicitly. No global skill installation or automatic catalog refresh is claimed.

## Artifacts

- `docs/engineering/README.md`: starting point and current repository facts.
- `docs/engineering/SKILLS.md`: verified inventory, provenance, roles, local paths, exclusions.
- `docs/engineering/WORKFLOW.md`: task execution, first commit, branch/commit/push/PR, CI, evidence provenance, recording, stop/resume.
- `docs/engineering/PROMPTBOOK.md`: phased task cards and reusable execution prompts.
- `docs/engineering/PROGRESS.md`: tasks initialized as Not started.
- `docs/engineering/TRACEABILITY.md`: all 76 current P0 requirements assigned to implementation tasks, plus cross-cutting ownership.
- `docs/engineering/STACK-PROPOSAL.md`: current officially sourced Vercel-based proposal and remaining technical decisions.
- `docs/engineering/templates/TASK-RECORD.md`: per-task evidence/delivery record template.
- Four `skills/debrio-*/SKILL.md` files: access/data, session execution, real-time media, testing/release.

## Validation status

Initial structural checks passed for the original draft. Independent review identified missing task ownership for several existing PRD requirements. The task scopes were corrected, a P0 ownership map added, and P4-05 added for privacy/lifecycle implementation before integrated verification. The independent reviewer returned Approve for the corrected kit and then separately approved the Vercel-specific proposal update. These are reviews of the instructions and proposal, not approval to deploy or evidence that the product works.

Final authoring checks executed with Node.js v24.22.1 using stdin assertions:

| Check | Result |
|---|---|
| Markdown encoding, code fences, trailing whitespace, table structure | Pass across 13 Markdown files |
| Local file links and heading anchors | Pass, 34 references |
| Local skill frontmatter, names, descriptions, unfinished scaffolds | Pass, four skills |
| Unique task IDs, required card sections, criteria and dependency order | Pass, 29 tasks and 87 card criteria |
| Progress register matches task order and unstarted state | Pass |
| Every current PRD P0 ID has valid implementation owners | Pass, 76 requirements |
| Matt Pocock skill sources and installed files | Verified against local lockfile/files |
| Vercel preference, Render exclusion and proposed-stack status | Pass |
| Independent instruction-level scenario review | Pass: changed/declined publication, missing expert, revoked announcement, unavailable real-media proof |

No application runtime, provider account, real-media, remote authentication, CI, deployment, or human-pilot test was run. The authoring task is complete; platform tasks remain Not started.

The bundled skill validator was inspected. The installed Python launcher could not start its WindowsApps Python interpreter in the current environment; no package or runtime was installed to work around that. Equivalent frontmatter/name/reference checks and independent behavioral review are the planned fallback, with that limitation reported.

## Delivery and recording

- Branch observed: `main`; local HEAD unborn (no commits).
- Remote observed: `origin` → `https://github.com/Seth-arc/conductor.git`; reachability/history/authentication not verified.
- Commit: not performed.
- Push / PR / CI / merge / deployment: not performed.
- Video: N/A for this documentation-and-skill authoring task; no application or media demo was run. Future task cards require synthetic demos for user-visible/media work.
- Product/mockup files: not edited by this task.

## Remaining work

Execute P0-01 when ready. The entire platform build, real-media tests, operating-cost validation, actual pilot, and all release gates remain unexecuted. A compiled plan does not establish technical feasibility.
