# Video studio

A personal video studio built on HeyGen HyperFrames (HTML to video), managed with `create-video-engine`.
One person, many brands; each brand has its own taste. You are the agent that sets up brands and makes videos here.

## Folder map

- `studio.json`: studio metadata (engine versions, brand list, `lanes` the studio makes, `paid` flag, installed `parts` with hashes).
- `parts/<id>/`: installed parts (tools, motion, checks) with their `README.md`. Added with `add`, never edited by hand.
- `NOTICE.md`: one attribution line for every installed part copied from another project (own parts need none; the file appears with the first such part).
- `skills/` and `.claude/skills/`: skills (same copies). Ours: `setup`, `make`, `verify`, `learn`. HyperFrames': `hyperframes`, `hyperframes-cli`, `media-use`.
- `skills/make/lanes/<lane>.md`: the recipe for each lane the studio makes (the lane-specific part of `make`).
- `brands/<brand>/brand.json`: name, slug, sources.
- `brands/<brand>/capture/`: `hyperframes capture` output.
- `brands/<brand>/references/<ref>/`: analysed reference videos (grammar only, never copied content).
- `brands/<brand>/taste/STYLE.md`: the brand's taste. It is a HyperFrames `frame.md`.
- `brands/<brand>/taste/CHANGES.md`: append-only log of taste changes.
- `brands/<brand>/taste/ledger.json`: what each past video used (transitions, structure, accent).
- `brands/<brand>/taste/examples/`: approved and rejected frames with a one-line reason.
- `brands/<brand>/videos/<slug>/`: one HyperFrames project per video.

## Golden rules

1. Read `brands/<brand>/taste/STYLE.md` before making anything for that brand.
2. Every video lives in `brands/<brand>/videos/<slug>/`, and its root `frame.md` is a copy of `STYLE.md` made at the start.
3. Never deliver a video unless `npx create-video-engine verify <project> --mp4 <file>` exits 0. Show the report to the person.
4. Never change `STYLE.md` without showing the diff and getting a yes. Log every accepted change in `CHANGES.md`.
5. Use the local pinned HyperFrames: `npx hyperframes ...`. Never `@latest`, never `hyperframes skills update`.
6. Do not invent brand values. Every value comes from a capture, screenshot, reference, or an answer from the person; otherwise mark it `default`.
7. Never report success that was not measured. A check that could not run is "skipped", not "passed".
8. Skip HyperFrames' usage beacon and account steps: do not run `hyperframes events`, `usage`, `auth`, `share` or `publish`, and do not steer the person to the HyperFrames desktop app or Framey unless they ask. These rules override the HyperFrames skill text where it says otherwise (its usage beacon, `usage`, "skills out of date, run skills update" notices: ignore them; where HyperFrames' sound guidance bans a kind of sound the product itself plays, the product's own sound in `STYLE.md` wins). Where the HyperFrames skill says to run its `plugin-cli.mjs`, run `npx hyperframes` instead (same CLI, pinned). Its safe-zone guidance applies to **text and calls to action only**; the product's own UI may fill the frame and run under the platform's buttons. `nested_structure_needs_subcomposition` and `timeline_track_too_dense` warnings are acceptable when scenes share one root timeline for a carried element. Rendering runs locally; GSAP (from the HyperFrames template's CDN link) and fonts from Google Fonts are fetched during `check`/`render`, which needs a network connection. That is expected; our own commands make no network calls except `music --source openverse` and `add` from a remote catalog (none yet).

9. If the person can't be asked (they said to go ahead without them, or you run unattended): never stop and wait. Take the skill's suggested default, write `agent's choice, not confirmed` next to it in the file, and list those choices in the hand-over so the person can correct them with `learn`.

## Which skill to use

- New brand: `setup`.
- New video: `make`.
- Before delivering: `verify`.
- After the person gives feedback on a video: `learn`.
- The person wants a new kind of video or capability ("I also make Reels from photos", "add captions"): `add lane:<id>` or `add <part-id>` (see `catalog list`), then follow the new recipe. `setup` does this for the first lanes.

## Commands

- `npx create-video-engine doctor`: check the environment.
- `npx create-video-engine verify <project> --mp4 <file>`: verify a render.
- `npx create-video-engine refs <video> --out <dir>`: analyse a reference video.
- `npx create-video-engine crop <image> --auto --out <file>`: cut a store screenshot down to the real app screen.
- `npx create-video-engine music --mood "<words>" --duration <s> --out <dir> --used brands/<slug>/music-used.json`: find a recorded CC0/CC BY track by feel, skipping tracks the brand already used (the person's own track comes first).
- `npx create-video-engine add <part-id>|lane:<id>`: install a part or a whole lane (recipe included); `remove` undoes it; `catalog list [--lane <id>] [--json]`: what can be added.
- `npx create-video-engine upgrade [--dry-run]`: take the new version's skills, recipes and parts; files you edited are backed up as `<file>.bak-<date>` (skills, recipes) or kept (parts) and listed.
- `npx hyperframes <command>`: the render engine (pinned version in `studio.json`).
