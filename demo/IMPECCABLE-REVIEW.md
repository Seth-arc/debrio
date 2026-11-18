# Debrio UI/UX polish

Reviewed 17 November 2026 with Impeccable 4.8.0. Scope: local workshop demo, from landing page through Build, lobby, session, participant work and Review. This was a preservation/polish pass, not a redesign or accessibility certification.

The supplied mockup remains the visual authority: Public Sans, charcoal/mineral palette, compact rail, original desktop lobby geometry, Activity panel and bottom session dock. Simulation remains removed.

## Findings addressed

| Priority | Observed problem | Change |
| --- | --- | --- |
| High | Theme changes discarded unsaved activity and settings edits; media refreshes could discard message text. | Keep form drafts in memory across refreshes and panel/activity switches. Preserve text focus and caret. Clear drafts after successful saves/submission. Show “Unsaved edits” in Build. |
| High | The mobile bottom dock overlapped the Activity panel and obscured its heading. | Keep the dock in normal page flow below the panel on narrow screens. Desktop placement is unchanged. |
| Medium | Sound check was a 16 × 16 icon hidden inside the speaker selector. | Added a visible “Test sound” button within the existing speaker row, with a 40px-high target. |
| Medium | Three rows of participant thumbnails pushed mobile task content down. | Use one horizontally scrollable participant strip below the presentation. |
| Medium | Selected roles, rooms and filters did not expose their selected state; panel closure could lose keyboard focus. | Added selected-state semantics, current-page navigation, focus return and route focus. Only genuine toggle controls expose pressed state. Camera-off also has a crossed-out icon. |
| Medium | Agenda, Review filters and workspace links could overflow at 320px. | Allow constrained grid columns and wrapping controls; test maximum-length workshop titles. |
| Low | Repeated editor/debrief labels and unspecified screenshot dimensions added noise and layout instability. | Simplified redundant labels, reserved image dimensions, and lazy-loaded the lower screenshot. |

## Verification

- `node --test demo/model.test.cjs`: 7 passed.
- `browser-smoke.js`: passed the landing and complete workshop workflow, including reference geometry checks and nine routes at 1440, 768 and 390 pixels; no page errors.
- `ui-smoke.js`: passed draft retention, explicit-save behavior, message clearing, caret preservation, keyboard dialog entry/Escape, panel focus return, selected-role semantics, layouts through 320px, and 100-character workshop titles; no page errors.
- `media-smoke.js`: passed synthetic video/audio, speaker switching and rollback, music, monitoring and lifecycle cleanup; no page errors.
- Visually inspected desktop dark/light and mobile states. Synthesized touch taps opened and closed Sound check. Checked representative participant text and placeholder contrast in both themes; no failures in that sample.

## Impeccable detector

Ran the requested mechanical detector once on `demo/app.js` and `demo/landing.html`. Raw results: [impeccable-detection.json](impeccable-detection.json).

Three `cramped-padding` warnings flagged full-width landing sections. These are false positives: their immediate inner containers have 40px horizontal padding on desktop and 20px on mobile. Verified rendered padding: console 112px/40px, accessibility 104px/40px, final CTA 120px/40px. No style change was made merely to silence the warnings. The source detector does not replace browser inspection of JavaScript-rendered controls.

## Limits

Unsaved activity, settings and message drafts remain in the current tab only; use Save/Send before reloading. Participant response drafts retain their existing browser-storage behavior.

No physical device, physical touch-device, screen-reader, cross-browser or formal WCAG audit was performed. Remote participants remain fictional. Product/design context came from the supplied references and existing implementation; `/impeccable init` could capture that context in PRODUCT.md later.
