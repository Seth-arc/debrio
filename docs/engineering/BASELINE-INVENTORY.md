# Baseline provenance inventory

Inspected for P0-01 on 18 November 2026 against existing commit
`2fceb2d8af0f284a5f8676ed5a3bb5aff5280126` in `Seth-arc/debrio`.
This inventory records evidence and gaps; it does not certify ownership or release rights.

| Material | Source and use observed in the baseline | Rights / remaining evidence |
|---|---|---|
| `docs/Debrio_PRD_v0.5.md`, engineering documents, `GLOSSARY.md`, ADR | Existing project planning; retained as the source of truth | Contributor ownership/assignment evidence is not in the repository. Project owner must resolve before release. |
| `skills/debrio-*/SKILL.md` | Four existing Debrio instruction files; external workflow provenance is recorded in [SKILLS.md](SKILLS.md) | Local skill lockfile is workstation evidence, not a shipped dependency or proof of assignment. No skills installed or upgraded here. |
| `demo/*.{js,cjs,html,css}`, `demo/package.json` | Existing local prototype; Node standard library; package has no dependencies or devDependencies | No application package/lockfile or production SBOM yet. P0-03 owns tooling; contributor rights remain unverified. |
| `docs/Debrio_Mockup.html`, `docs/Debrio_Landing page.html` | Supplied design references; demo README documents adaptation | Embedded code/assets also need source/rights confirmation; supplied material is not automatically cleared. |
| `demo/assets/PublicSans.woff2` | Extracted from supplied mockup per demo README | `demo/assets/PublicSans-LICENSE.txt` identifies Public Sans and SIL OFL 1.1. Exact upstream font version/hash provenance remains unverified. |
| `docs/fonts/satoshi/*.otf`, `demo/assets/Satoshi-*.otf` | Supplied fonts and prototype copies; Satoshi declarations remain in demo CSS | No corresponding license/source receipt found. Do not assume rights from availability. |
| `docs/fonts/bogle/*.OTF` | Supplied reference fonts | No corresponding license/source receipt found. Distribution/usage rights unverified. |
| `docs/Debrio_Lobby_music.wav`, `demo/assets/Debrio_Lobby_music.wav` | Supplied lobby music; identical Git blob `d755e4bc87a1840e823b01bb9da6a2ad684984d7`, 28,816,906 bytes per path | Author, origin and license/assignment unverified. Existing large assets preserved; no new binary added by P0-01. |
| `demo/assets/logo.svg`, `demo/assets/landing-*.png`, `demo/*.png`, `docs/Debrio_loading.gif` | Existing mark, screenshots/reference images and animation; demo README/verification describe their use | Underlying asset rights and contributor provenance unverified. Existing reference images preserved; future captures belong in ignored `.artifacts/`. |
| `.playwright-mcp/*` | Six existing browser log/snapshot captures, already present in baseline history | P0-01 removes from the task index and ignores future captures. Original checkout files remain intact. This does not purge public Git history. |

Provider choices are documented in [STACK-SETTINGS.md](STACK-SETTINGS.md):
Vercel, Supabase, Postmark, Stripe and conditional LiveKit. P0-01 creates no
provider resources or paid accounts. Account control, allowances and export/exit
constraints belong to P0-02; production dependency/asset evidence is consolidated
at P7-02. Reference-only and shipped assets must be distinguished in that release inventory.

QG-07 baseline inventory is established; rights clearance remains Unverified.
The project owner must supply source/license/assignment receipts or authorize
replacement/removal before these materials ship. No license is inferred or added
to project-owned material by this task.
