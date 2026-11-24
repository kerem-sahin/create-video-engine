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
- `brands/<brand>/taste/STYLE.md`: the brand's facts (colours, fonts, voice, format). It is a HyperFrames `frame.md`.
- `brands/<brand>/taste/NOTEBOOK.md`: the person's taste, learned from them: liked, not liked, never, mechanisms from their reference videos, scenes worth reusing, lessons. Read it before every video.
- `brands/<brand>/taste/ledger.json`: what each past video used and how many corrections it needed.
- `brands/<brand>/taste/examples/`: approved, rejected and reference frames with a one-line reason.
- `brands/<brand>/library/`: the brand's own drawings (characters, recurring things), each in `library.json` with its source and whether the person approved it. Reuse before you draw again.
- `brands/<brand>/videos/<slug>/`: one HyperFrames project per video.

## Golden rules

1. Read `brands/<brand>/taste/STYLE.md` and `NOTEBOOK.md` before making anything for that brand. The goal of every video is one the person would post as it is; passing checks is the floor.
2. Every video lives in `brands/<brand>/videos/<slug>/`, and its root `frame.md` is a copy of `STYLE.md` made at the start.
3. Never deliver a video unless `npx create-video-engine verify <project> --mp4 <file>` exits 0. Show the report to the person.
4. Never change `STYLE.md` or the notebook's rules without showing them and getting a yes (the `learn` skill).
5. Use the local pinned HyperFrames: `npx hyperframes ...`. Never `@latest`, never `hyperframes skills update`.
6. Do not invent brand values. Every value comes from a capture, screenshot, reference, or an answer from the person; otherwise mark it `default`.
7. Never report success that was not measured. A check that could not run is "skipped", not "passed".
8. Skip HyperFrames' usage beacon and account steps: do not run `hyperframes events`, `usage`, `auth`, `share` or `publish`, and do not steer the person to the HyperFrames desktop app or Framey unless they ask. These rules override the HyperFrames skill text where it says otherwise (its usage beacon, `usage`, "skills out of date, run skills update" notices: ignore them; where HyperFrames' sound guidance bans a kind of sound the product itself plays, the product's own sound in `STYLE.md` wins). Where the HyperFrames skill says to run its `plugin-cli.mjs`, run `npx hyperframes` instead (same CLI, pinned). Its safe-zone guidance applies to **text and calls to action only**; the subject may fill the frame. Rendering fetches GSAP and Google Fonts, so it needs a network connection; our own commands make no network calls except `music` (Openverse) and the optional `show-reader`.

9. If the person can't be asked (they said to go ahead without them, or you run unattended): never stop and wait. Take the skill's suggested default, write `agent's choice, not confirmed` next to it in the file, and list those choices in the hand-over so the person can correct them with `learn`.

## Talking to the person

The person may not be technical. They judge the video, not the machinery.
- Short messages: what you need from them, what they will see next. A few lines, not a report.
- Their words, not ours: no file names, commands, part ids, hashes or tool names unless they ask or must run something themselves (then the exact line to run). "I added podcast tools" not "`add lane:podcast` wrote `NOTICE.md`".
- A missing tool or a failed step only when it changes their video, said as what it means for them ("speaker names will be guessed").
- Questions: one message, numbered, each with your pick so they can answer "yes". Ask only what you cannot see in the material.
- Details (sources, licences, numbers) go into the files; say where if it matters.

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
- `npx create-video-engine music --mood "<words>" --duration <s> --out <dir> --used brands/<slug>/music-used.json`: up to three recorded CC0/CC BY candidates with 10 s previews for the person to pick; `music --pick <n> --out <dir>` makes the choice the track. The person's own track comes first; with nobody to pick, no music.
- `npx create-video-engine add <part-id>|lane:<id>`: install a part or a whole lane (recipe included); `remove` undoes it; `catalog list [--lane <id>] [--json]`: what can be added.
- `npx create-video-engine upgrade [--dry-run]`: take the new version's skills, recipes and parts; files you edited are backed up as `<file>.bak-<date>` (skills, recipes) or kept (parts) and listed.
- `npx hyperframes <command>`: the render engine (pinned version in `studio.json`).
