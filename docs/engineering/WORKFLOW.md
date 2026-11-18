# Task execution, Git, and evidence

This is the shared operating contract for every [promptbook task](PROMPTBOOK.md). Read it with the [skill manifest](SKILLS.md). Writing this kit has not authorized or performed implementation, pushes, merges, public publishing, infrastructure provisioning, or live-session recording.

## Execute one task

1. Read the task card, its full PRD requirements assigned in TRACEABILITY.md, applicable repository instructions, skill files, current glossary/architecture, and relevant code/tests. Inspect the worktree and preserve unrelated work. Do not assume this author's repository snapshot is still current.
2. Check dependencies and decide whether the card is sufficiently specified. Resolve consequential architecture/provider/security/cost questions through `spec` or `architecture` before implementation; propose a default with a tradeoff. Do not reopen settled product decisions.
3. List the required code, callers, tests, fixtures, configuration, migrations, documentation, and exports. Run Ponytail Full. Reuse an existing branch/PR if continuing. Split an oversized card into explicit child tasks only when each has its own usable outcome and proof; retain the parent ID and dependency gate.
4. Implement the scoped outcome and focused tests. Use current provider/framework documentation for evolving APIs. Record dependencies, versions, and reasons; no custom conferencing protocol or speculative service fleet.
5. Prove each acceptance criterion. Record exact commands, exit codes, browser/device/network flows, and limitations. Fix failures caused by the change. Required unavailable checks are Unverified/Blocked, not Pass.
6. Capture synthetic-data demos where the card requires them; inspect the result. Review the working tree/staged files with Ponytail criteria. Run independent reviews at the point their workflow supports: bootstrap file review before the first commit; Matt's fixed-point `code-review` after task commits exist; `task-to-pr`'s fresh `review` after PR creation. Repair findings and repeat affected checks/review on the changed implementation before declaring delivery complete.
7. Commit, push, and create/update a PR only within the execution request's delivery authorization. Verify the remote branch and required checks on its current HEAD. The default endpoint is an open reviewed PR, not a merge or deployment.
8. Update the original task record/progress state and report result, proof, commit/PR, recording link, and remaining risk. Stop at the card's completion boundary.

## Source of truth and status

- Product: `docs/Debrio_PRD_v0.5.md`; retain its requirement IDs, such as G02 and M12. Do not create a competing REQUIREMENTS.md. If an installed workflow expects that name, explicitly pass the existing PRD instead.
- Architecture: root `ARCHITECTURE.md` when created; glossary: root `GLOSSARY.md`; consequential ADRs: `docs/adr/`. Proposed architecture is not accepted until the decision owner confirms it.
- Work: the task card is the initial delivery brief. If a detailed spec is necessary, use `docs/tasks/<task-id>/spec.md` and link it from the task record; do not create duplicate independent tickets. P0-01 chooses the actual tracker.
- Commands: P0-03 creates `docs/engineering/COMMANDS.md` with commands actually verified in the chosen stack. Later tasks add their real commands. A suggested script name is not evidence that a script exists.
- Execution evidence: `docs/engineering/records/<task-id>.md`, following [TASK-RECORD.md](templates/TASK-RECORD.md). Use [PROGRESS.md](PROGRESS.md) as the compact index, not a second spec.

Track these independently: task state (Not started / In progress / Blocked / Complete), local acceptance, demo, independent review, commit, push, CI, PR, merge, deployment. A task can be locally complete and not pushed. No unrun check, pending review, or missing real-media proof may be represented as passing.

For dependent code work, prefer a merged prerequisite. Reviewed stacked PRs are allowed when `task-to-pr` conditions are met: prerequisite review/CI current, no known blocker, correct PR base, and repeated checks after rebase/base changes. Never interpret a stack as merge authority.

## Git baseline and first commit

The observed checkout had no local commits and an `origin` of `https://github.com/Seth-arc/conductor.git`. P0-01 must verify the actual state, Git identity, remote authentication, default branch, remote history, and branch rules before writing history. Do not expose access tokens or credential helpers in logs.

Read-only inspection examples, run individually and inspect exit codes:

```powershell
git status --short
git remote -v
git symbolic-ref --short HEAD
git rev-parse --verify HEAD
git ls-remote --symref origin HEAD
git ls-remote --heads origin
```

An unborn local HEAD is expected to fail `rev-parse`; it does not prove the remote is empty. Authentication/network failure also does not prove emptiness.

- **Remote has history:** use that history in an isolated checkout/worktree and bring across only approved task files. Preserve the user's uncommitted files. Never force-push an unrelated local root or reset the existing workspace to match the remote.
- **Remote confirmed empty:** prepare and review a minimal baseline containing explicitly selected project files. Creating/pushing the initial default branch is a separate bootstrap action; obtain explicit authorization for that concrete baseline. A feature PR cannot target a nonexistent base branch. Keep later feature work on task branches.
- **Remote status unverified:** produce local artifacts and state that push/PR setup is blocked. Do not fabricate a remote receipt.

For the first baseline, review the staged files directly with the fresh `review` workflow and Ponytail criteria. Matt's `code-review` needs a valid fixed-point commit and cannot operate against an unborn HEAD. Once a base exists, use its actual SHA for every later review. Do not create an empty commit solely to evade this distinction.

## Branches, commits, push, and PR

The card supplies a suggested branch and Conventional Commit subject. Example task branch: `feat/p4-01-peer-instruction`. Prefixes: `docs/`, `chore/`, `spike/`, `feat/`, `fix/`, `test/`, `ops/`. Continue a matching existing branch instead of creating duplicates.

Before committing:

- Verify branch, base SHA, diff, tracked and untracked files; enumerate the exact task-owned paths.
- Run the required checks and check the staged diff. Include code/tests/docs/fixtures needed for the outcome. Do not use `git add .` or `git add -A` when unrelated files exist.
- Exclude secrets, raw participant material, browser auth state, node_modules/build output, downloaded test payloads, and large recordings. P0-01 adds appropriate ignore rules for local evidence, including `.artifacts/`; required setup configuration and lockfiles remain tracked.
- Do not bypass hooks, rewrite published history, force-push, reset/clean user files, or delete branches to get past a failure. Non-fast-forward needs investigation and safe integration, not a forced update.

Example after a task has populated the variables with inspected values; this is a template, not a blind paste into an unknown repository:

```powershell
$taskBranch = 'feat/p4-01-peer-instruction'
$taskFiles = @('actual/task-owned/file', 'actual/task-owned/test')
git diff --check
git add -- $taskFiles
git diff --cached --stat
git diff --cached
git commit -m 'feat(instruction): add private answers and individual retries'
git rev-parse HEAD
```

Replace the file examples before execution. On a clean, confirmed base, create the branch with `git switch -c $taskBranch`; when resuming, switch only after preserving unrelated work. Record the actual commit result; a failed hook means no success claim.

For `delivery=pr`, the user's execution prompt authorizes normal commits and pushes to the verified task branch plus creation/update of its PR. It does not authorize default-branch bootstrap, merging, production deployment, account purchases, or unrelated external messages. Do not request the same already-granted task-branch permission again.

```powershell
git push --set-upstream origin $taskBranch
git rev-parse HEAD
git ls-remote --heads origin $taskBranch
```

Compare the exact remote SHA with local HEAD; log denied/network/non-fast-forward outcomes honestly. Pushing to `origin` is conditional on confirming it still identifies the intended repository. Use the connector or authenticated GitHub CLI to create/update the PR against the verified default branch (or reviewed prerequisite branch). Supply the task/spec path, problem/result, tests, recording links, limitations, and rollback notes. For multiline CLI PR bodies, write a real UTF-8 body file and use `--body-file`; never interpolate multiline prose into a shell command.

Wait for required CI/checks and read their actual final status for the latest pushed commit. An independent agent's approval is not a GitHub approval. Leave the PR open unless the user explicitly authorized merging. A blocked branch rule remains a blocker; no admin bypass is implied.

Solo-maintainer policy accepted 18 November 2026: another person's GitHub approval is not required. Keep the PR workflow and applicable independent agent reviews; set the required approving review count to zero while retaining other branch protections. Required automated checks apply once established by P0-03. The user's authorization to merge remains separate from review completion.

## Commit and evidence provenance

A committed record cannot contain the hash of the commit that contains itself. Use one of these concrete patterns:

1. Commit implementation and its pre-commit proof record together. Record base SHA, changed paths, commands, and a content/patch hash in the record. After commit, put the resulting SHA, remote receipt, CI links, and PR URL in the PR/tracker and final response. The record identifies its containing commit via Git history.
2. If a repository-stored implementation SHA is required, make the implementation commit first, then a small evidence-only commit recording that SHA. Push both and verify checks on the final HEAD. Do not recursively create more commits just to store the evidence commit's own hash.

After a code change, repeat affected proof and refresh recordings/reviews when their demonstrated behavior changed. A pure evidence update can reuse applicable runtime proof when the implementation SHA is unchanged, while still running required CI on the final HEAD. Capture post-push receipts in the PR/tracker or `.artifacts/<task-id>/delivery-receipt.json`; do not leave uncommitted proof edits and call the worktree clean.

## Testing and completion

Apply the [engineering quality contract](QUALITY-BAR.md) from the first implementation task. Record applicable QG-01 through QG-08 results alongside the card criteria; these gates are required parts of completion. P0-01/P0-02/P0-03 establish the controls, feature tasks maintain them, and P7-02 collects the candidate-specific evidence and independent handover. The contract's release blockers cannot be replaced by a passing demo or an unsupported acquisition-readiness claim.

Every implementation task uses `debrio-testing-and-release` plus relevant specialist skills. Each card adds its own proof. The baseline is:

| Change | Minimum meaningful proof |
|---|---|
| Documents/skills only | Local links and required files resolve; frontmatter valid; task dependencies, acceptance mapping, and instructions are consistent; no runtime claim |
| Domain logic | Focused valid, invalid, and boundary/duplicate tests through the public interface |
| Persistence/API | Actual test database, relevant concurrency and permission cases, recovery after a failed/retried write |
| UI | Real browser path, keyboard/focus, failure states, console/network errors; automated regression tests for critical flows |
| Media/captions/video | Multi-client integration plus real browser/device/audio/network trials; record provider/browser versions and actual limits |
| Release/operations | Restore/rollback drills, expected alerts, capacity/cost evidence, access revocation, supported-browser checks, current candidate review and CI |

No fixed coverage percentage substitutes for the relevant tests. No mock-only result certifies transport quality. Missing browser, provider, budget, devices, pilot participants, or CI access must be reported as a specific unverified gate. Implement independent local work while an external dependency is unavailable, but do not mark the dependent gate complete.

Completion means the task's observable criteria pass, required evidence is inspectable, required review findings are resolved, documents/records reflect reality, and the requested delivery mode has actually succeeded. For a design task, completion means a reviewable proposal; downstream implementation separately requires acceptance of consequential decisions.

## Migration titles

Every schema or data migration must have a descriptive, action-oriented title. For SQL migrations, use `<timestamp>_<descriptive_snake_case_title>.sql`, for example `20261117143000_backfill_workspace_owner_memberships.sql`, with a matching first-line header: `-- Title: Backfill workspace owner memberships`. Keep the ordering identifier unique and compatible with the selected migration tool. Non-SQL migration files use the same descriptive suffix and their language's comment syntax for the title.

Reject timestamp-only names and generic titles such as `migration`, `update` or `fix`. Record each migration's identifier, title and path in the task record and applicable release/rollback manifest. Review naming and header agreement alongside the migration's behavior checks. Do not rename, renumber or rewrite an already-applied migration merely to satisfy this convention; document its title in the release/task record and preserve its applied identity.

## Recording and evidence

The user requested **written logs and demo videos**. This is engineering evidence, not a feature to record participants.

- Every task has a written record. User-visible/UI/media tasks require a short demo showing their acceptance path and an important failure/recovery path. Phase gates collect links to those demos; do not re-record identical behavior without a change or proof gap.
- Pure documentation/configuration tasks can mark video N/A with a reason; retain commands/diffs as evidence. A developer may add a short safe walkthrough when it helps review.
- Use a clean demo session with synthetic participant names, fixtures, and generated/test media. No real workshop participants, private customer briefs, personal calls, credentials, auth tokens, or sensitive browser tabs in a recording. Actual human pilot sessions remain unrecorded; document observations and approved non-media measurements in writing.
- Capture the application window/region, not the whole desktop by default. Disable unrelated microphone/desktop sources. Include test audio only when proving media behavior; confirm the source names and capture scope first. OBS or an available equivalent can be used, but inspect current recording/streaming state and output settings before changing them. Never stop an unrelated recording or start a stream.
- Use `.artifacts/<task-id>/<date>-<scenario>.mp4` for local videos and similarly named screenshots/logs. P0-01 must confirm the directory is ignored. Do not commit large binaries or publish evidence to a public host automatically.
- Keep durable evidence in an approved private artifact store/CI artifact location when available. Record its location, access policy, retention/expiry, file hash, duration, source revision, scenario, tool versions, and limitations. A local-only artifact is not remotely reviewable; say so. If durable sharing is unavailable, mark that part of PR evidence pending rather than inventing a link.
- Preview the finished recording: correct window, readable text, required audio, caption visibility, no sensitive data, no empty/black capture, and complete stop. Check that the file exists and plays. Record zero-byte/corrupt/blocked capture as failed evidence.
- A video supports behavior review but cannot prove hidden authorization, persistence, isolation, or load properties by itself. Pair it with the task's tests and measurements.

The product's no-live-session-recording requirement remains unchanged. This promptbook does not authorize durable caption transcripts, provider session recording defaults, or recordings of the observed pilot.

## Stop/resume and task report

On interruption, record the current branch, base/implementation SHA, modified files, tests run, pending checks, temporary services/cloud resources, recording state, and next action. Stop only task-owned captures/processes/resources when appropriate; do not leave a capture running accidentally. Never paste secrets into the handoff.

End a task with: outcome; criteria results; tests and recording; review status; local commit; verified push/PR/CI status; remaining dependency. End with Ponytail's one or two lines naming what was not checked and the material risk. Do not turn this into a claim that unexecuted future phases are complete.
