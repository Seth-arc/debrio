---
name: debrio-realtime-media
description: Build or verify Debrio media-room switching, visible listening, spoken announcements, screen sharing, resource-video synchronization, captions, and media failure recovery. Use current provider documentation and real browser/device evidence.
---

# Debrio real-time media

Read [PRD v0.5](../../docs/Debrio_PRD_v0.5.md) sections 7–10, 12–13, and 16E. The provider and topology remain provisional until accepted against the media gate. Verify SDK versions, actual APIs, and provider limits from current official documentation before using them; record the source and version in the task evidence.

## Routes and lifecycle

- Listen, Speak, Join, Scan, and Announce are distinct permissions and modes. Establish named listening notice before delivering monitored audio. A facilitator hears one intelligible room conversation at a time.
- Switch monitoring with break-before-make authorization. Stop and role loss close existing routes; reconnect cannot restore stale grants or unmute a microphone automatically.
- Announce previews one/selected/all target rooms within one session. It sends the facilitator's microphone one-way; it never bridges room return audio, camera, or screen share. Suspend conflicting monitoring/transmit routes.
- Targeted participants see the speaker, hear lowered conversation audio, and pause Debrio-controlled video. On announcement end, restore conversation volume but require explicit video resume. Show target failures; do not replay missed live speech as a recording.
- One screen presenter per media room, with explicit start/stop/handover. Leaving the room ends sharing. Screen sharing never follows the announcement audience implicitly.
- Individual viewing and synchronized group viewing are distinct. Shared playback has one designated controller for play/pause/seek; each participant retains volume and caption controls. Verify every viewer's resource grant. Playback state is not permission to access the content.
- Handle buffering, autoplay denial, late joins, controller loss, revocation, and reconnect. Show desynchronization/blocked playback. Publish the actual supported video formats/linked players; label unsupported sources as link-outs without promising pause/synchronization.
- Live captions follow only authorized conversation/announcement audio. Display controls are individual; processing policy is disclosed. Uploaded videos have supplied captions. No persistent live-media recording, replay buffer, or retained transcript is introduced through defaults, tests, diagnostics, or captions.
- Prove partial control-service loss while media stays connected: revocation, withdrawal and expiry obey a documented authorization-freshness bound; reconnect cannot restore stale grants.
- Keep task connectivity and media connectivity distinct. A media interruption must not lose acknowledged participant work.
- Participant-selected task-only withdrawal immediately stops live audio/video and caption processing without facilitator approval. Show task-only status, preserve permitted written activities and require explicit media rejoin; reconnect must not undo withdrawal.

## Proof and cost

Use mocks for state/routing logic, plus multi-client integration tests and actual browser/headset/network trials for transport. A silent/fake media track cannot prove intelligibility, echo behavior, captions, or room isolation. Test at least two independent client devices for critical audio paths and the actual room/participant count before the pilot. Establish measurable caption/latency/synchronization limits at the feasibility gate rather than inventing success claims.

Measure participant-minutes, monitoring and announcement connections, relay/egress, video storage/delivery, caption processing, and support effort. Avoid unbounded retries or idle billable probes; shut down task-created resources after the evidence run.

For engineering evidence, follow [recording rules](../../docs/engineering/WORKFLOW.md#recording-and-evidence). Use synthetic identities and generated/test audio; live participant sessions remain unrecorded.
