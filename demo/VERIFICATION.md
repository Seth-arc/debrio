# Demo verification

## Impeccable UI/UX polish ? 17 November 2026

See [IMPECCABLE-REVIEW.md](IMPECCABLE-REVIEW.md) for findings, fixes, detector interpretation and limits. Seven model tests, the full browser workflow, synthetic media checks and the new focused UI regression suite passed. Desktop reference geometry is preserved. Draft retention, keyboard focus, a visible sound-test action, unobstructed mobile panels and layouts through 320px were checked.


## Workshop-only scope ? 17 November 2026

- Removed the Simulation selector, context switching, fixture/export and theme. Workshop storage continues to use the same key, preserving saved workshop work.
- Removed the simulation landing section, navigation link and copy. Replaced landing screenshots with the current workshop-only interface. Original supplied references in docs are unchanged.
- Seven model tests and full browser smoke passed with no page errors. Includes absence of simulation controls/content, landing links/assets/responsiveness and the complete workshop workflow.
- Camera/audio hardware was not retested; media behavior was not changed. Earlier entries below record previous demo versions.


## Landing-page entry ? 17 November 2026

- Adapted the supplied landing HTML directly, retaining its hero, logo animation, section layouts and three original screenshots. Uses local Public Sans and WebP assets; no runtime libraries or remote assets.
- Root and index without a hash open the landing page; Explore demo enters the existing lobby. Existing app hashes are preserved. Workshops includes a Website return link.
- Replaced placeholder email/privacy links with working local destinations and removed unsupported audit-score claims.
- Syntax checks and expanded browser smoke passed, including all existing workshop checks. Verified images, section anchors, animation pause/resume, reduced motion, and layouts at 1440, 768, 390 and 320 pixels without horizontal overflow. Desktop/mobile screenshots inspected. No page errors.
- No live booking/contact service, publication, formal accessibility audit or physical-device retest was performed for this page addition.


## Mockup layout restoration ? 17 November 2026

- Compared the supplied HTML mockup and demo in the same 1440 ? 1000 viewport. Restored header role/context switches, lobby device rows, Activity timer and visible agenda, bottom tool dock, and participant rail behavior.
- Geometry assertions passed: lobby preview x218/y311.5, width587.3; session presentation x112/y136, width916; bottom footer x76/y927, height73. Screenshots inspected at desktop and mobile widths.
- Eight model tests passed; JavaScript syntax checks passed. Full browser workflow passed with no page errors, including panel closure/reopening and preserving workshop edits across context switches. Nine routes checked at 1440, 768 and 390 pixels without horizontal document overflow.
- Synthetic media checks passed, including speaker selection/rollback, in-session microphone monitoring, Escape closing monitoring, waiting music, preview continuity, permission denial and track cleanup.
- Physical devices, acoustic quality, screen-reader behavior and multi-user calling were not tested. Remote people remain simulated.


## Reference styling and local media update — 17 November 2026

- Restyled against both supplied HTML references. Reused the original mark and embedded Public Sans; included the supplied license. Added light/dark themes, a first-screen lobby, and shorter navigation/copy. Full agenda and poll are expandable.
- Copied the supplied lobby WAV without modification. Playback starts from a user action, has pause/volume controls, and stops when joining or leaving the lobby.
- `node --test demo/model.test.cjs`: 7/7 passed. JavaScript syntax checks passed.
- Updated `browser-smoke.js`: passed with no page errors, preserving the full workshop workflow. All nine routes fit 1440, 768 and 390-pixel viewports without document-level overflow.
- `media-smoke.js`: passed with synthetic canvas video and Web Audio input. Verified no automatic device request, actionable permission denial, video attachment, old-track cleanup on camera switch, actual analyser meter response, opt-in microphone monitoring, speaker-test completion, WAV playback/volume, music stopping on entry, local camera continuity into the session, device-off cleanup, cancelling a pending permission request, disconnect recovery, and route-exit cleanup. No JavaScript page errors.
- Actual microphone, camera, speakers, audio quality, and remote call transport were **not** tested. Synthetic sources validate software behavior, not physical hardware. The user must grant browser permissions to test their own devices.
- Direct-file lobby launch reports a secure context with `getUserMedia` available in the tested browser. The supplied WAV also played from the file URL. Desktop dark/light and mobile lobby screenshots were inspected. The WAV copy matches the supplied file's SHA-256 hash.
- The earlier “simulated device controls” description below applies only to the initial version. Camera/microphone controls now access local hardware when requested; remote participants/room audio remain simulated.

## Initial demo verification

Verified 17 November 2026 (America/Indianapolis). Local prototype only; no production release claim.

## Passed

- `node --test model.test.cjs`: 7 tests passed, 0 failed. Covers actual 20-person group sizes, role coverage across rotation, role/resource release visibility, immutable response text and revision links, approval withdrawal, recorder-only group snapshots, empty/ended submissions, and timer expiry without automatic advancement.
- `node --check app.js`, `node --check model.js`, `node --check server.cjs`: exit 0.
- `browser-smoke.js`, executed with the Playwright browser tool in a fresh isolated context: passed. Checks agenda edit/reload, template insertion, admission, response submission, voting, help, feedback, pinning, debrief approval/withdrawal, shared group drafts, recorder submission, role rotation/private resources, visible listening, announcement, resource creation, CSV download, search empty state, and session closure.
- Eight routes (`home`, `build`, `run`, `participant`, `review`, `resources`, `templates`, `settings`) at 1440, 768, and 390 CSS pixels: no document-level horizontal overflow. No JavaScript page errors during the smoke test.
- Direct `file:///.../demo/index.html` launch: working with local font/script/style assets. Skip-to-content moves keyboard focus to the main landmark without changing routes.
- Desktop overview/session and mobile overview screenshots were inspected. Files: `overview.png`, `session.png`, `mobile.png`.
- Browser reported version: Chromium 154.0.8037.58.

## Limits

No real media devices, multi-user transport, concurrency, backend authorization, upload/video handling, provider integrations, payments, email, client sharing, retention/deletion, or production capacity were implemented or tested. No screen-reader audit or formal WCAG conformance assessment was performed. Mobile layout checks do not certify production mobile participation. The prototype does not replace the planned engineering or pilot acceptance work.

The first interactive browser walkthrough used the normal preview origin; the repeatable smoke suite uses an isolated browser context. Reset demo restores the seeded fixture if browser walkthrough records are visible.

## Delivery

Only demo application files were added. Existing documents and supplied mockup remain unchanged. No dependencies installed, provider accounts configured, commits created, changes pushed, or site deployed. Font files were copied from the supplied archive; redistribution rights were not independently checked.
