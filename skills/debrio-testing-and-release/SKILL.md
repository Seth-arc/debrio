---
name: debrio-testing-and-release
description: Prove Debrio task acceptance and pilot or release readiness with focused tests, browser and media evidence, CI, work records, and rollback checks. Use for delivery verification; no authority to merge, deploy, or record live participants is implied.
---

# Debrio testing and release

Read the task card, [workflow](../../docs/engineering/WORKFLOW.md), relevant [PRD acceptance scenarios](../../docs/Debrio_PRD_v0.5.md), and accepted architecture. Use installed `test` and `verify-and-stop` for criterion-level proof; use `playwright` for browser operations. Actual script names come from the repository's verified command registry, not imagined package scripts.

## Match proof to failure

| Layer | Prove |
|---|---|
| Unit/contract | Permission policy, grouping constraints, transitions, retry identity, immutable revision rules, message targeting |
| Persistence/API integration | Real transactions, competing updates, scoped reads/exports, revocation, durable acknowledgement and reconnect |
| Multi-user browser | Participant/facilitator workflows, separate users/groups, privacy, UI recovery, keyboard operation and accessible status |
| Real media | Device permission, headset/audio intelligibility, monitoring/announcement isolation, captions, screen handover, playback drift, network interruption |
| Operational | Restore, migration compatibility, rollback, monitoring/alerts, cost and capacity limits |

- New non-trivial behavior needs a focused test that fails when the behavior breaks; do not replace it with a mirrored implementation assertion. No percentage-of-test-type quota.
- Check every new schema/data migration has a descriptive filename title and matching file-header title under WORKFLOW.md; record its ID/title/path in task and release evidence. Preserve already-applied migration identities.
- Map each task criterion to Pass, Fail, or Unverified, with command/flow, result, and artifact. Required unverified proof blocks readiness; describe the external dependency without marking the task done.
- Check accessibility as behavior: keyboard/focus, screen-reader names and status, contrast, non-color cues, captions, usable device-denied states, and participant control over video/caption settings. Automated scans are only part of the proof. Desktop browser scope follows the PRD; incidental responsive checks do not certify mobile meeting support.
- Negative authorization cases are as important as success: another group/session/organization, expired/revoked grant, unreleased resource, changed publication version, stale connection, and export route.
- Distinguish source/test success from actual browser evidence, real media evidence, and human pilot results. Synthetic load does not prove one facilitator can manage actual people.
- Record exact source/base revision, tool versions, environment/network, commands, redacted output, timestamps, and limitations. Use synthetic-data demo videos, never real participant recordings.

## Reliability proof

Use [review R1-R8](../../docs/engineering/SAAS-RELIABILITY-REVIEW.md) and affected cards. Include commit-before-provider-action crashes; partial service loss; three simultaneous workshops and multi-workspace load; competing fourth-start denial; active old/new-client deployment and rollback; restored deletion/revocation/expiry/billing; privileged MFA/host recovery/closure; and actual alert receipt through acknowledgement and recovery. Named pilot coverage precedes the pilot; published support hours/incident/contact information precede paid release. No additional infrastructure spend or unmeasured service guarantee is implied.

## Gates

1. Before full build: pass the documented media feasibility demonstration and accept its operating limits/cost assumptions.
2. Before first pilot: all three formats, at least 20 participants and the actual concurrent room count; caption, access, recovery, and support checks pass. At exactly 20, role practice needs six rooms. A missing partner or accommodation remains a readiness blocker, not an implementation failure to hide.
3. Before advertising 40-person/eight-room capacity: repeat capacity, isolation, recovery, accessibility, and workload validation at that configuration.
4. Before production: complete task scope, passing required checks on the candidate commit, independent review, no unresolved blocking findings, tested restore/rollback, operating ownership, and explicit deployment authority.

Do not weaken tests to obtain a pass, silently skip unavailable media checks, bypass branch protection, or treat a pushed branch as merged/deployed. Track local completion, push, CI, review, merge, and release separately. Use Ponytail's review/debt tools proportionately; simple fixes do not require a full-repository audit.
