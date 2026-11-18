# Task record: TASK-ID — title

Use one file per task at `docs/engineering/records/<task-id>.md`. Replace template fields with observed values; use Not run, Not pushed, N/A (reason), or Unknown honestly. Do not paste this template as a completed record.

## Identity and scope

- Task/spec/PRD references:
- Started/updated (timestamp with timezone):
- State and owner:
- Repository, branch, base SHA:
- Implementation SHA or pre-commit patch/content identity:
- Accepted decisions and unresolved blockers:
- Skills loaded (names, source/version where material):
- Changed paths, callers, fixtures/config/migrations:
- Migration identifiers, descriptive titles and file paths (or N/A):
- What is deliberately out of scope:

## Acceptance evidence

Include applicable QG-01 through QG-08 from [QUALITY-BAR.md](../QUALITY-BAR.md) alongside task criteria. Explain N/A gates; identify outstanding required evidence as Unverified. At P7-02, index evidence for all eight gates, the release dependency/asset inventory and independent handover.

| Criterion ID or exact wording | Result: Pass / Fail / Unverified | Command or flow and environment | Evidence / exit code | Gap |
|---|---|---|---|---|

Record real commands and versions. Include denied access, failure/retry/reconnect, accessibility, and data recovery where relevant. Separate automated, browser, real-device media, synthetic-load, and human-pilot evidence.

## Demo evidence

- Scenario and synthetic data source:
- Source revision and browser/device/provider/network:
- Capture scope and allowed audio sources:
- File/artifact URL, access/expiry, SHA-256, duration:
- Playback inspection result and important limitations:
- N/A reason or missing recording dependency, when applicable:

## Review and debt

- Independent reviewer/source revision/verdict:
- Matt Standards findings and disposition:
- Matt Spec findings and disposition:
- Ponytail quality/complexity findings and disposition:
- Shortcut ceiling and upgrade trigger, or none:
- Changes after review and repeated checks:

## Delivery receipt

- Delivery mode: local / pr / separately authorized release:
- Commit subject and implementation SHA:
- Push status and verified remote SHA:
- PR URL/base/head and required CI/check URLs/results:
- Merge status, human approval, and merged SHA (only if verified):
- Deployment environment/version/authorization/smoke result (only if performed):
- Post-commit receipt location (PR/tracker/local artifact):

Do not insert the current record's own future commit SHA. Follow WORKFLOW.md's provenance rules. Pushed is not merged, CI success is not deployment, and a recording is not a substitute for tests.

## Handoff

- Remaining work and next executable task:
- Temporary services, resources, and recording state:
- What was not checked:
- Material risk:
