# Debrio skill manifest

Verified from local skill files and `C:/Users/ssnguna/.agents/.skill-lock.json` on 17 November 2026. Source attribution below follows the lockfile, not a guess from a skill's name. Do not reinstall or update working skills merely to execute this book.

## Resolve and load skills

- Matt/Blueprint/general agent skills: `C:/Users/ssnguna/.agents/skills/<name>/SKILL.md`.
- Codex skills such as `playwright` and `security-best-practices`: `C:/Users/ssnguna/.codex/skills/<name>/SKILL.md`.
- Ponytail package observed at `C:/Users/ssnguna/.codex/plugins/cache/ponytail/ponytail/5.3.3/skills/<name>/SKILL.md`. Prefer the current plugin catalog if its cache version changes.
- Debrio bundle: repository `skills/<name>/SKILL.md`. Read it directly if the session's skill catalog has not refreshed; do not claim it is globally installed.

On another workstation, resolve these roots from that user's installation. If a required skill is missing, report that fact; do not silently substitute a similarly named skill or fetch an unreviewed package. Skills guide work within the user's actual authorization. Loading a skill does not itself authorize a push, merge, external message, recording, or deployment.

## Ponytail: always-on implementation discipline

| Skill | Use |
|---|---|
| `ponytail:ponytail` — Full | Every implementation task: smallest complete change, inspect all affected callers, preserve safeguards, meaningful proof for non-trivial logic |
| `ponytail:ponytail-review` | Focused correctness/security/load/test/complexity review, especially before a PR is presented |
| `ponytail:ponytail-audit` | Integrated pre-pilot and release-candidate audit; not a compulsory full-repo audit for every small change |
| `ponytail:ponytail-debt` | At phase gates, collect actual `shortcut:` comments with their ceiling and upgrade trigger |

Persisting the debt report is explicitly part of the phase-gate task. No shortcut may bypass privacy, authorization, accessibility, acknowledged-save durability, or the agreed media behavior.

## Matt Pocock skills verified installed

Source: `mattpocock/skills` in the local lockfile.

| Skill | Use in this project |
|---|---|
| `setup-matt-pocock-skills` | P0-01: choose the tracker, configure domain-doc conventions, and integrate the appropriate agent instruction file |
| `domain-modeling` | P0-02 and later genuine domain changes: resolve terminology, maintain `GLOSSARY.md`, record consequential ADRs |
| `codebase-design` | Design module interfaces and ownership; avoid speculative abstraction and shallow pass-through layers |
| `grill-with-docs` | Consequential unresolved decisions: combines `grilling` and `domain-modeling` |
| `grilling` / `grill-me` | Focused decision interviews; do not reopen the whole settled PRD for each task |
| `setup-pre-commit` | P0-03 if the chosen stack supports its Node/Husky workflow; CI remains authoritative and staged files must be scoped |
| `code-review` | Standards and spec review against an explicit base commit, with both independent review axes |
| `improve-codebase-architecture` | Only after real code exposes an architectural problem; not an upfront greenfield abstraction exercise |

Also verified installed but not required for this baseline: `chief-of-staff` and `git-guardrails-claude-code`. The latter targets Claude Code hooks; it is not a Codex/Git permission boundary.

`setup-matt-pocock-skills` asks for tracker selection and an agent-file choice when neither AGENTS.md nor CLAUDE.md exists. Those are P0-01 decisions; this kit has not pretended setup is complete. Configure only the labels/layout actually needed. Do not invoke `code-review` against an unborn HEAD; use the bootstrap review path in WORKFLOW.md.

## Other installed engineering skills

| Source | Skills | Use |
|---|---|---|
| `owainlewis/blueprint` | `architecture`, `architecture-review` | Design/review proposed architecture; distinguish proposed, accepted, and implemented |
| `owainlewis/blueprint` | `spec`, `plan` | Settle feature-specific behavior and split oversized work into usable outcomes |
| `owainlewis/blueprint` | `test`, `review` | Criterion-level proof and fresh independent review |
| `owainlewis/blueprint` | `task-to-pr` | Implement a decided task, test, push/open PR when authorized, repair valid findings/CI, leave PR open by default |
| `JuliusBrussee/caveman` | `lean-build`, `investigate-first`, `surgical-patch`, `safe-refactor`, `migration`, `verify-and-stop` | Narrow delivery, diagnosis, fixes, safe structural/data changes, focused completion checks |
| Installed locally | `impeccable` | UI design and refinement consistent with Debrio's tactile warm-neutral/mineral-green direction |
| Codex skill installation | `playwright`, `security-best-practices` | Browser operations and language/framework-specific security guidance |

These are not all Matt Pocock skills. The installed `plan` skill usually returns a plan in chat; the user's explicit request to write this promptbook governs this artifact. `create-plan` is a separate read-only skill and is not the execution engine for this book.

Select one implementation workflow, usually `task-to-pr` with Ponytail Full. Use `lean-build` for a local-only or especially narrow slice; do not stack redundant process skills on every action. `playwright` is a browser-operation skill, not by itself a persistent E2E regression suite.

## Repository-local Debrio skills

| Skill | Source | Trigger |
|---|---|---|
| `debrio-access-and-data` | [SKILL.md](../../skills/debrio-access-and-data/SKILL.md) | Authentication/authorization, invitations, allocation/release, persistence, publication, exports |
| `debrio-session-execution` | [SKILL.md](../../skills/debrio-session-execution/SKILL.md) | Agendas, group/role routing, three formats, stage transitions and recovery |
| `debrio-realtime-media` | [SKILL.md](../../skills/debrio-realtime-media/SKILL.md) | Monitoring, announcements, captions, shared videos, screen sharing, provider tests |
| `debrio-testing-and-release` | [SKILL.md](../../skills/debrio-testing-and-release/SKILL.md) | Task proof, CI, browser/media verification, pilot/scale/release gates |

These reference the PRD rather than duplicating it. Their narrow descriptions prevent them from governing unrelated projects. They do not choose a cloud, database, framework, or media vendor.

## Do not import Myelin contracts unchanged

The installed `auth-and-rbac`, `data-model-entities`, `multi-tenant-isolation`, `security-controls`, `test-pyramid`, `release-gate-checklist`, `accessibility-baseline`, `design-system-tokens`, and `popia-compliance` explicitly contain Myelin rules. Their role maps, lifecycle rules, fixed schemas, LOTO/3D tests, retention assumptions, or visual language are not Debrio's contracts.

Use Debrio's PRD, the local skills, accepted architecture, and framework-specific security guidance. Document Debrio UI/accessibility rules in `DESIGN.md` during the first UI task. Do not mutate the user's shared Myelin skills. Assess jurisdiction-specific legal requirements for actual deployment markets separately; this book does not adopt another project's compliance claims.

The installed `notification-service` skill was also inspected and is Myelin-specific. Its notification registry, mandatory-message bypass and retry/preferences defaults are not adopted. Communications tasks use [COMMUNICATIONS.md](COMMUNICATIONS.md), the existing Debrio access/testing skills and official provider documentation instead.

LOTO, physics, WebGL, PBR materials, and AI-agent response/transcript skills are not needed for the agreed human-run simulation scope. AWS skills are conditional on selecting AWS; choose only the service skills relevant to the accepted architecture.

## Review combination

For code-bearing delivery after a base commit exists, `code-review` supplies Matt's independent Standards and Spec axes. Apply Ponytail's quality criteria to the same change; a separate `ponytail-review` is useful when it adds a material check, not a second identical ceremony. If the `task-to-pr` workflow requires `review`, execute it as specified and keep its independent verdict distinct from GitHub's human approval. Reviews and CI must cover the latest changed implementation.
