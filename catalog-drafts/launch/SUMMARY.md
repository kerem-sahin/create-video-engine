# Launch / brand / distribution group: summary

| repo | licence (verified) | stars | last push | parts | decision |
|---|---|---|---|---|---|
| latent-spaces/brag | MIT (music CC BY 4.0, SFX Kenney: separate) | 21982 | 2026-11-15 | tone presets, share copy, inspect rubric | install x3; check/SFX guide idea; poster, beat grid skip (already done) |
| heygen-com/hyperframes-launches | Apache-2.0 (media, logos, fonts excluded by NOTICE) | 689 | 2026-10-04 | 4 re-brandable templates, rebrand protocol, seam ledger | install x5 (templates and protocol), ledger idea, other films link-only |
| diggerhq/shipvideo | none (no LICENSE) | 385 | 2026-10-01 | none | link-only |
| lemomo-ai/lemo-opuscar | docs and prompts CC BY-NC 4.0, code MIT, films CC BY 4.0 | 18547 | 2026-11-17 | style texts, my-styles flow | link-only, flow idea |
| feitangyuan/onetake | PolyForm Noncommercial 1.0.0 | 4244 | 2026-11-19 | continuity oracle | link-only |
| shadcn-labs/snapcn | MIT | 657 | 2026-11-18 | Remotion components | skip (React/Remotion), registry ideas |

Caveats: HeyGen templates pin hyperframes 0.7.94, not rendered here under 0.9.67. lemo-opuscar read via API (README, LICENSE, REUSE.toml), not cloned. onetake: README and LICENSE only.

## Distribution: how `add` should work
snapcn uses the shadcn registry: `npx shadcn add @snapcn/text-reveal`. Each part is one JSON (`public/r/<name>.json`) with name, title, description, `dependencies` (npm), `registryDependencies` (URLs of other parts), `files[]` each with `path`, inline `content`, `type` and `target` (where it lands in the user's project), plus `docs` printed after install. An index `registry.json` lists items. There is no version pinning: the files are copied and then owned. A separate `__measured__.json` stores duration, size, fps, copy limits and a source hash per part.

Our card is missing:
1. `files` with `target` paths (install location) and inline or relative content, not just a list.
2. `requires` as part ids, resolved recursively (shadcn registryDependencies), separate from npm/system `needs`.
3. `measured`: duration, canvas, fps, max text length, sourceHash (detects drift).
4. `lane` and `decision`, `paid_api`, `licence_of_assets` separate from code licence (brag music, HeyGen logos).
5. `attribution` text the installer writes to a NOTICE file in the user's project.
6. `catalog.json` index so setup can filter by lane without reading every card.

`add <part>`: resolve requires, check licence field (refuse link-only), copy files to targets, append NOTICE, print `docs`, record id plus sourceHash in a lockfile. No auto-update; `update` shows a diff.

## Product-launch person's part set
Tone presets, share copy, inspect rubric, rebrand protocol, one or two HeyGen templates (ui-sting; generate-reel if vertical), the seam-ledger check (our own), screenshot-crop, poster frame, beat-grid music, measured-metadata step. Style texts and onetake stay as reading links.
