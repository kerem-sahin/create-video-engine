# Contracts (Phase 1)

The fixed interfaces every part of `create-video-engine` builds against. Change them here first, then in code.

## 0. Principles

- **Thin layer on HyperFrames.** Never reimplement what `hyperframes` does (render, lint, check, capture, snapshot). Call it.
- **Pinned engine.** One HyperFrames version per release: `HYPERFRAMES_VERSION` in `src/lib/constants.mjs` (currently `0.9.67`). Studios install exactly that version locally. Never `@latest`, never `skills update`.
- **No runtime npm dependencies** in this package. Node ≥ 22 built-ins only (`node:child_process`, `node:fs`, `node:test`, …). External tools: `ffmpeg`, `ffprobe`, and the studio's local `hyperframes`.
- **No telemetry** of our own. Every `hyperframes` call we make sets `HYPERFRAMES_TELEMETRY=0` and `DO_NOT_TRACK=1`.
- **Never report success that wasn't measured.** A check that could not run is `skipped` or `error`, never `pass`.
- ESM (`.mjs`), no TypeScript build step, no bundler.

## 1. This repository

```
create-video-engine/
├── package.json            name create-video-engine, "type":"module", bin, engines node>=22, zero deps
├── bin/cli.mjs             dispatcher only (no logic)
├── src/
│   ├── lib/                constants.mjs, exec.mjs, log.mjs, fsx.mjs   (shared helpers)
│   ├── doctor.mjs          export async function runDoctor(argv) → exit code
│   ├── init.mjs            export async function runInit(argv)  → exit code
│   ├── verify/index.mjs    export async function runVerify(argv) → exit code
│   ├── refs/index.mjs      export async function runRefs(argv)  → exit code
│   ├── crop/index.mjs      export async function runCrop(argv)  → exit code
│   ├── catalog/index.mjs   export async function runCatalog(argv) → exit code
│   ├── add/index.mjs       export async function runAdd(argv), runRemove(argv) → exit code (format: docs/PARTS-FORMAT.md)
│   └── upgrade.mjs         export async function runUpgrade(argv) → exit code
├── catalog/                parts catalog: catalog/<kind>/<id>/part.json and catalog/lanes/<id>/lane.json (see catalog/README.md)
├── skills/                 our agent skills (SKILL.md + assets), copied into studios by init
│   ├── setup/  make/  verify/  learn/
├── templates/studio/       files copied verbatim into a new studio
├── docs/
└── tests/                  node:test, run with `npm test` (`node --test tests/*.test.mjs`; Node 24 rejects a bare directory)
```

CLI surface (`npx create-video-engine <command>`):

| Command | Purpose |
|---|---|
| `doctor [--json]` | environment check |
| `init <dir> [--no-install] [--json]` | create a studio |
| `verify <video-project-dir> [--mp4 <file>] [--json] [--no-hf-check] [--no-composition [--expect-duration <s>] [--expect-audio]]` | layers 1–2 of verification. `--no-composition` is for a video assembled by ffmpeg (assemble-long): no HyperFrames check, and the duration and audio checks take their expectation from the flags; without the flags they are `skipped` (exit 2), never `pass` |
| `refs <video-file> --out <dir> [--json]` | analyse a reference video into grammar notes |
| `music --score <cues.json> --out <video-project-dir> [--json]` (or `--mood … --duration …` for a bed without cues) | score music to the edit's beat grid (§6) |
| `crop <image> --out <file.png> [--auto] [--rect x,y,w,h] [--status-bar] [--json]` | crop a store screenshot to the real app screen (no caption, no device frame); `--auto` exits 1 when no confident rectangle is found, and leaves an already full-bleed image unchanged |
| `catalog check [--dir <d>] [--json]` | validate the part cards and lanes, schema 2 (exit 1 on invalid cards) |
| `catalog list [--lane <id>] [--dir <d>] [--json]` | print id, kind, title of the parts, or one lane's parts |
| `add <part-id>\|lane:<id> [--studio <dir>] [--paid] [--dry-run] [--json] [--catalog <dir>]` | install a catalog part (with its `requires`) or a whole lane into a studio; exit 1 on a refusal (link-only, paid without `--paid`) or a changed file |
| `remove <part-id>\|lane:<id> [--studio <dir>] [--json] [--catalog <dir>]` | remove an installed part or lane; exit 1 when files were changed or another part requires it |
| `upgrade [--studio <dir>] [--dry-run] [--json] [--catalog <dir>]` | bring a studio to this package's version: our skills (both copies), `AGENTS.md` (and `CLAUDE.md` while it is still ours), installed lane recipes and installed parts. A file the person edited is never lost: skills, `AGENTS.md` and recipes are backed up as `<file>.bak-<date>` and replaced; an edited part (or a `CLAUDE.md` that is not ours) is kept and listed. Edit detection uses `studio.json` `skills_hash` (written by `init` and `upgrade`; sha256 per studio-relative file), `lane_recipes` and each part's `files`; with no recorded hash a file is current only if identical to the new one, otherwise it counts as edited. Never touches `brands/`, `NOTICE.md` lines of parts not updated, or `package.json`; a differing HyperFrames pin is printed, not changed. Updates `studio.json` `engine`. `--dry-run` writes nothing. Exit 0 (also when files were kept), 2 when no readable studio |
| `--help`, `--version` | |

Exit codes for every command: `0` ok · `1` checks ran and found errors · `2` could not run / something skipped that was required · `64` bad usage.

## 2. A studio (what `init` creates)

One person, many brands. Each brand has its own taste.

```
<studio>/
├── studio.json             { "schema":2, "engine":"create-video-engine@<ver>", "hyperframes":"0.9.67", "brands":[], "lanes":[], "paid":false, "parts":[], "skills_hash":{ "<studio-relative file>": "<sha256>" } }  (docs/PARTS-FORMAT.md §3; `skills_hash` is written by init and upgrade)
├── package.json            private; devDependencies { "hyperframes": "0.9.67" } exact; scripts below
├── AGENTS.md               entry point for any agent (what this studio is, where skills are, the golden rules)
├── CLAUDE.md               single line: @AGENTS.md
├── .gitignore              node_modules/, .hyperframes/, *.mp4 under videos/*/out/, renders/
├── skills/                 canonical copies: ours (setup, make, verify, learn) + HyperFrames' bundled
│                           (hyperframes, hyperframes-cli, media-use) copied from node_modules/hyperframes/dist/skills
├── .claude/skills/         same skill folders, copied (Claude Code discovery). No symlinks.
└── brands/
    └── <brand-slug>/
        ├── brand.json      { "name", "slug", "sources": { "url"?, "repo"?, "screenshots"? }, "createdAt" }
        ├── capture/        `hyperframes capture` output (if a URL was given)
        ├── references/     <ref-slug>/ = output of `create-video-engine refs`
        ├── taste/
        │   ├── STYLE.md    the brand's taste (format §3)
        │   ├── CHANGES.md  append-only log of taste changes
        │   ├── ledger.json { "videos": [ { "slug","date","transitions":[],"structure":[],"accent":"#hex","music":null } ] }
        │   └── examples/   approved/ and rejected/ frames (PNG) with a one-line .txt reason each
        └── videos/
            └── <video-slug>/   a HyperFrames project; its root `frame.md` is a copy of taste/STYLE.md at make time
```

Studio `package.json` scripts: `"doctor": "create-video-engine doctor"`, `"verify": "create-video-engine verify"`, `"hf": "hyperframes"`. `create-video-engine` itself is also a devDependency (same version as the one that ran `init`), unless `init` runs from a local checkout, then `file:` path.

## 3. STYLE.md format

`STYLE.md` **is a HyperFrames `frame.md`**: HyperFrames reads `frame.md` at a project root and treats its frontmatter `colors`, `typography`, `spacing`, `components` as normative and the prose as intent. We add our own keys; HyperFrames ignores keys it doesn't know.

```yaml
---
version: 1
name: <Brand> — taste
brand: <brand-slug>
updated: 2026-11-18
colors:                 # normative. hex only. roles, not just names
  ground: "#F1F0EC"
  ink: "#111111"
  accent: "#34C759"
typography:             # normative. real families the brand uses
  display: { fontFamily: "Bricolage Grotesque", weight: 800, tracking: "-0.02em" }
  body:    { fontFamily: "Geist", weight: 400 }
  mono:    { fontFamily: "Geist Mono", weight: 500 }
spacing: { safe: "8%" }
motion:                 # ours. numbers, never adjectives
  ease: { enter: "power3.out", exit: "power2.in" }
  durations: { enter: [0.35, 0.6], hold_min: 1.2 }
  camera: { push_in_max: 1.15 }
rhythm:                 # ours. from references when measured
  shot_length: [1.2, 3.5]
  cuts_per_10s: [3, 6]
  source: measured | interview | default
format: { aspect: "16:9", length: [20, 35], fps: 30 }
never:                  # ours. hard bans, each one checkable or at least concrete
  - "Inter or Space Grotesk as display face"
  - "zoom-blur transitions"
signature: "<the one recurring element that makes this brand recognisable>"
---
```

Prose sections, in this order: `## What this brand is` · `## Voice` (copy rules, language, banned words) · `## Do` · `## Don't` · `## References` (what was taken from each reference and what was not; mark **measured** vs **guessed**) · `## Learned` (rules added by the learn skill, each with the video it came from).

Rules: every value traceable to a source (capture, screenshot, reference, interview answer) or marked `default`. No invented brand values.

## 4. `verify` report (`<video-project>/.cve/verify-report.json`)

```json
{
  "schema": 1,
  "ok": false,
  "project": "<abs path>",
  "mp4": "<abs path or null>",
  "startedAt": "ISO", "durationMs": 0,
  "tools": { "ffmpeg": "9.0.2", "hyperframes": "0.9.67" },
  "layers": {
    "hfCheck": { "status": "pass|fail|skipped|error", "reason": "", "summary": { "<section>": { "ok": true, "errors": 0, "warnings": 0 } }, "findings": [] },
    "mp4":     { "status": "pass|fail|skipped|error", "reason": "", "checks": [ { "id": "first-frame", "status": "pass|fail|warn|skipped|error", "message": "", "at": 0.0, "data": {} } ] }
  },
  "contactSheet": "<abs path or null>",
  "frames": ["<abs path of .cve/frames/NN-<time>s.png>", "..."],
  "moments": [ { "t": 0, "why": "hook: the first 2 s. Would this stop a scroll?" } ],
  "soundCues": [],
  "skipped": ["<id>: <reason>"]
}
```

When `assets/music/score.json` exists, `soundCues` lists each scored cue (`{start, kind, beat, src: "assets/music/score.json", …}`) instead of the music `<audio>`; other `<audio>` cues stay. `moments` is up to 5 `{t, why}` for the person to watch or listen to, sorted by time, moments closer than 1 s merged: first 2 s (hook), the end card (start of the final still, else the last cut), the loudest sound cue (`soundCues` by gain; else the strongest cue in `score.json`; else the loudest short-term passage), the second with most on-screen change, then cuts flagged by `on-beat`. The human output prints them as a `MOMENTS` block.

`shots.json` (written by the make skill next to `index.html`):
```json
{ "shots": [ { "start": 0, "end": 2.5, "transition_out": "hard cut" }, { "start": 2.5, "end": 6, "transition_out": "mask wipe up" }, { "start": 6, "end": 9 } ],
  "structure": [ "hook: store caption + map on frame 0", "capture screen", "end card" ] }
```
`transition_out` is the way a shot ends, in the same words as the ledger's `transitions` (the last shot has none; whatever it says is ignored). `structure` is the ordered beat list, in the ledger's words. Missing file: `variety` is skipped; malformed file: `error`.

`ok` is true only if every required layer has `status: "pass"` and no check is `fail`/`error`. `warn` does not fail. Exit code follows §1.

Layer 1 = `hyperframes check --json` run in the project with the studio's local binary. Parse the JSON, not the exit code alone (HyperFrames' exit code and `ok` can disagree; trust `ok` and section `errorCount`).

Layer 2 checks on the rendered MP4 (ffprobe/ffmpeg only):

| id | rule | severity |
|---|---|---|
| `probe` | file readable, has video stream; record w/h/fps/duration/audio | error if unreadable |
| `duration` | duration matches root `data-duration` of `index.html` within 1 frame; frame count = duration × fps ±1 | fail |
| `first-frame` | frame 0 is not blank/near-black/near-uniform (platforms use it as the thumbnail) | fail |
| `blank-stretch` | black or near-uniform stretch: 0.5–1 s warn (can be an intended beat), ≥ 1 s fail; final 0.5 s ignored | warn / fail |
| `near-empty` | content coverage (share of pixels differing from the background luma by > 12) under 0.4 % for ≥ 0.2 s, outside the first 0.1 s / last 0.5 s (background plus a tiny label) | warn |
| `frozen-stretch` | mid-video: warn 2–3 s, fail ≥ 3 s. A still that runs to the end (end card): fail only ≥ 5 s | warn / fail |
| `audio-present` | if the composition contains `<audio>` or `data-has-audio="true"`, the MP4 has an audio stream | fail |
| `loudness` | sparse audio (< 40 % of time above −50 dB): true peak −6…−1 dBTP ("effects too quiet" / "may clip") and max short-term (3 s) loudness ≤ −9 LUFS ("too loud for sparse effects": the platform ceiling −12 plus 3 LU for a sparse mix's loudest 3 s; an effects-only video measured −5.9 LUFS integrated and −7 short-term); otherwise integrated −17…−12 LUFS (target −16, 1 LU tolerance: the approved brag reference measures −16.3) and true peak ≤ −1 dBTP. `data` carries LUFS, LRA, true peak, non-silent share and the rule used (note: only comparable on ffmpeg 8.0.1) | warn |
| `on-beat` | needs `<project>/cues.json` (`bpm`; `assets/music/score.json` is used for `bpm` if missing). Cuts found by scene detection (`detectCuts`) must lie within 1.5 frames of a beat or half-beat; when scene detection finds none, the interior boundaries of `shots.json` (each shot `start` after the first) are checked on the grid instead. With `shots.json`, each declared boundary must also show a real change: mean absolute gray difference (160×90) between the frames 2 before and 2 after ≥ 1.0 (calibrated on a video whose cuts change only a phone-sized area: 2.4–12.0; unchanged frames 0.02–0.1). A boundary with no change is a warn. Message names the worst offenders with times. `skipped` only without cues.json and shots.json, or with neither cuts nor shots.json boundaries | warn |
| `empty-area` | per 10 fps 160×90 gray frame, the largest run of full-width rows (and of full-height columns) in which ≥ 98 % of the pixels are within 12 luma of the frame's background (most common luma). Median over the video without the last 5 s (end card); above 20 % of the height or of the width warns and says where (top, bottom, left, right, middle) and how big. Measured: reference that fills the frame 13 % / 7 %, a video with a small phone and an empty bottom 30 % / 29 %. `skipped` when the video is not longer than 5 s | warn |
| `subject-scale` | median share of the frame covered by non-background content (same frames and background as `near-empty`, end card excluded); below 20 % warns ("the product is too small"). Measured: reference 29 %, small-phone video 13 % | warn |
| `variety` | needs `<project>/shots.json` (below). Warn if the same `transition_out` occurs 3+ times in a row, or the transition list equals the previous ledger video's (same items, same order, case-insensitive), or `structure` equals the previous video's. Ledger = `<project>/../../taste/ledger.json` (`{videos:[{slug, structure:[], transitions:[]}]}`), previous = last entry whose slug is not this project's folder name. Music: when `<project>/assets/music/score.json` exists, it is compared with the ledger entries' `music` object (`{style, palette, progression, bpm, key, mode, fingerprint}`). Warn if style AND progression equal the previous video's, or if the same `fingerprint` occurs in any of the last 3 ledger videos. A score without `fingerprint` and `style` (older score) is compared by palette + progression only, and the message says so. A previous entry without `music` is not compared (noted). `skipped` without shots.json; a missing ledger only skips the comparison (noted) | warn |
| `static-shots` | per shot (boundaries from `<project>/shots.json`, else detected cuts; the last shot = end card is excluded) the `stillness` motion bins (0.5 s) after the shot's first 0.6 s (the entrance), whole bins only. A shot is static when ≥ 70 % of those bins are still (below the stillness threshold). Warns when ≥ 50 % of the non-end shots are static and lists them with times ("the subject should keep moving: push-in, pan, parallax, a UI action"). Measured: the Mert 4-photo video has bin means of 0.9–1.1 (a slow push of about 6 px/s, which `stillness` calls still) in 3 of 4 shots (shot 3 at 1.4 counts as moving), static 3 of 4; moving videos have no static shot (still share 0–0.33). `skipped` without boundaries or when no shot has a whole bin after the entrance | warn |
| `stillness` | a stretch longer than 3 s without movement. Sampled at 10 fps on 128 px gray, 16 px cells: a half-second counts as moving if its frame mean difference is ≥ 1.2, or one cell changes by ≥ 1.0 while under 25 % of the cells change (cursor, typing, a UI element). A slow drift (about ≤ 6 px/s at 1080 wide) is still. The last 5 s (`FREEZE_END_HOLD_FAIL_SECONDS`, the end card) are excluded; `skipped` when the video is too short for that | warn |
| `poster` | frame 0 must be usable as a thumbnail: content coverage ≥ 5 % and edge share ≥ 1 % (320 px gray). Always writes `.cve/poster.png` | warn |
| `numbers` | every number in the visible text of `index.html` and `compositions/*.html` (no `<head>`, script, style, comments, tags, attributes) must appear in `BRIEF.md`. `1.200` = `1,200` = 1200, `4,8` = `4.8`, `%`/`%50`/`50%` = 50, dates and times split into parts (`07.10.2026` → 7, 10, 2026). Nothing is ignored silently: a year not in the brief is listed. `skipped` without BRIEF.md | warn |
| `critic-frames` | write one PNG, at most 960 px wide, per shot start (cut + 0.1 s), plus t = 0.2 s and the last second, to `.cve/frames/NN-<time>s.png`, at most 16 (first and last kept, the rest spread evenly). If scene detection finds fewer than 6 frames' worth (soft cuts, wipes, typing), evenly spaced frames fill in. Listed in `frames` | — |
| `contact-sheet` | write `.cve/contact-sheet.png` (one frame per second, tiled) for the critic and the human | — |

## 5. `refs` output (`<out>/`)

`analysis.json` `{ schema, source, duration, fps, width, height, cuts:[t…], shots:[{start,end,len}], shot_length:{min,median,max}, cuts_per_10s, palette:[{hex,share}] (k-means-free: from downscaled frames, top 6 by frequency), motion_energy:[per-second mean frame diff] }`, `frames/` (one PNG every 0.5 s, 480 px wide), `contact-sheet.png`, `GRAMMAR.md` (human-readable summary; every number marked measured). URL input is accepted only if `yt-dlp` is on PATH; otherwise exit 2 with a clear message. Reference content is never copied into a brand, only its grammar.

## 6. `music`

Music is **scored with the edit**, not laid under it. A video's music is composed from its timing: a tempo is chosen first, every scene cut lands on a beat, and the sound cues are notes in the music's key on the same grid, through one shared reverb. The user is never asked to supply music.

```
create-video-engine music --score <cues.json> --out <video-project-dir> [--json]
create-video-engine music --mood "<words>" --duration <seconds> --out <video-project-dir> [--bpm <n>] [--source openverse] [--offline] [--json]
```

Bad usage (unreadable or invalid cues.json, `--duration` outside 3–3600, `--bpm` outside 40–200, `--score` with `--source`) exits 64; missing ffmpeg/ffprobe exits 2. Output for every route: `<dir>/assets/music/track.wav` (44.1 kHz 16-bit stereo, exactly the duration ±1 sample) and one line appended to `<dir>/CREDITS.md`.

### Scored route (`--score`)

`cues.json`:
```json
{ "duration": 20.0, "bpm": 84, "beats_per_bar": 4, "key": "G", "mode": "major", "palette": "nylon", "style": "acoustic-strum", "energy": 0.4, "seed": 11,
  "cues": [ {"beat": 6, "kind": "cut"}, {"beat": 2, "kind": "highlight"}, {"beat": 18.5, "kind": "impact"},
            {"beat": 12, "kind": "type", "beats": 2}, {"beat": 22.5, "kind": "tick"}, {"beat": 25, "kind": "end"} ] }
```
`duration` 3–3600 s (required; `--duration` is used only if the file has none), `bpm` 40–200, `beats_per_bar` 2–12 (default 4), `key` C…B with `#` or `b`, `mode` major|minor, `palette` nylon|felt-piano|marimba|kalimba|soft-synth, `style` classic|acoustic-strum|lofi|ambient|pop-pluck|piano-ballad|minimal-pulse|warm-groove (any style with any palette; an unknown name exits 64), `energy` 0–1, `seed` integer. Missing key/mode/palette/energy/bpm are derived from `--mood` (calm/quiet/warm: major, 70–85 BPM; serious/dark: minor; playful: marimba or kalimba; energetic: 0.7, 100–118 BPM), otherwise G major, nylon, 0.35. A missing `style` is derived (seeded, so the same seed gives the same style): mood words first (study/chill → `lofi`; dreamy/ambient/meditative → `ambient`; playful/energetic → `pop-pluck` or `warm-groove`; tech/focus/minimal → `minimal-pulse` or `pop-pluck`; serious/dark/romantic → `piano-ballad` or `ambient`; warm/cafe/organic → `acoustic-strum`, `warm-groove` or `lofi`), otherwise by energy (below 0.2 `ambient` or `piano-ballad`; above 0.6 `pop-pluck` or `warm-groove`; between, one of five). `classic` is never derived: it is the original arrangement and is used only when asked for. A cue's `beat` is a number ≥ 0 and must fall before `duration`; the sound lands exactly at `beat × 60 / bpm` seconds.

Palettes: `nylon` Karplus-Strong pluck; `felt-piano` sine + 2–3 partials, soft hammer attack, felt decay; `marimba` sine + 4th partial, fast decay; `kalimba` sine + inharmonic partial, short; `soft-synth` two detuned saws, one-pole low-pass, slow attack.

Styles (D8): the **palette** is only the timbre of the notes; the **style** is the arrangement: rhythm, texture, form. Every style has a bass behaviour, a harmonic rhythm, an accompaniment figure, a melody density and a section shape (bar 1 is a thinner intro; drums and accompaniment stop at an `end` cue and only the pad and the end bell remain; some styles add a short fill in the bar before the end). `type`, `cut` etc. cues are identical in every style.

| style | rhythm and texture | drums | bass | chords per bar | melody |
|---|---|---|---|---|---|
| `classic` | pad + eighth-note arpeggio + sparse random pentatonic notes (the original, byte-identical to earlier output; energy as below) | felt kick on 1 and 3, brushes | root on 1 and 3 | 1 | random pentatonic (no motif; `motif` is null) |
| `acoustic-strum` | strummed chords, syncopated down/up pattern (16ths 0, 4, 6, 10, 12, 14), 11 ms stagger per string | none | root on 1 and 3 | 1 | motif, density 0.55, from bar 2 |
| `lofi` | swung 16ths (odd ones late), short chord stabs, vinyl crackle, whole mix low-passed at 3 kHz, short room | dusty kick 0/7/10, snare on 2 and 4, swung hats and ghosts (none below energy 0.2) | root + fifth, sine | 1 or 2 | motif, density 0.35, low register |
| `ambient` | pad swells over about 60% of the bar, low drone, rare high bells, reverb about 2.5 s | none | drone only | 1 | bell motif, density 0.5, slow |
| `pop-pluck` | 3-3-2 pluck ostinato (16ths 0, 6, 12) rising through the chord, bass doubles it | kick on every beat, off-beat hat, rim on 2 and 4 from bar 3, hat fill before the end | octave pulse on the ostinato | 1 or 2 | motif, density 0.7, bright |
| `piano-ballad` | left-hand broken chords in eighths (root, 5th, octave, 10th), pedal pad | none | left hand | 1 | motif, density 0.9, phrases hold their last note |
| `minimal-pulse` | steady eighths cycling a 6-note cell against the 8-eighth bar (it phases), notes added then removed bar by bar (triangle count 3…8…3), a second octave-up voice with a 5-eighth period from bar 3 | none | one root per bar | 1 or 2 | motif, density 0.25, from bar 5 |
| `warm-groove` | syncopated bass (16ths 0, 3, 6, 8, 11, 14) on even bars, walking quarter notes on odd bars, chromatic approach to the next root; off-beat chord stabs | rim click on 2 and 4, shaker on off-beat 16ths, soft kick 0 and 10, snare fill before the end | walking / syncopated | 1 or 2 | motif, density 0.5 |

`classic` energy: below 0.2 a pad and sparse plucks, no drums; 0.2–0.6 adds bass, felt kick on 1 and 3, brushes, an eighth-note arpeggio and a sparse pentatonic melody; above 0.6 the arpeggio runs on every eighth, kick on every beat, brighter plucks. In the other styles energy below 0.2 removes drums and above 0.6 adds hat and ghost notes. Drums and arpeggio stop at an `end` cue.

Melody (every style but `classic`): a seeded **motif** of 3–5 pentatonic scale degrees with onsets and lengths inside one bar (`score.json` `motif`: `{ scale, degrees, onsets, durs }`). In each four-bar phrase bar 1 states it with its first note moved to a chord tone, bar 2 repeats it displaced by half a beat, bar 3 varies it (inversion, a step up, or a step down, chosen per phrase by seed), bar 4 is a shortened fragment ending on a held chord tone of the chord sounding there; the end of bar 8 (and the last bar) holds the chord root.

Harmony: one progression picked by seed per style. `classic` keeps its original pick from the first five per mode. The other styles pick from twelve per mode (one chord per bar over four bars): major I–vi–IV–V, I–V–vi–IV, I–iii–IV–V, vi–IV–I–V, I–IV–vi–V, I–bVII–IV–I, I–IV–iv–I (borrowed iv), Iadd9–V–vi–IVadd9, Isus2–IVadd9–vi–Vsus4, I–bVI–bVII–I, I–ii–V7–vi, IVadd9–I–V–vi; minor i–VI–III–VII, i–iv–VII–III, i–VII–VI–VII, i–iv–VI–v, VI–VII–i–v, i–VI–iv–V7, iadd9–VII–VIadd9–VII, isus2–VI–IIIadd9–VII, i–bII–VII–i, VI–III–VII–i, i–iv–VII–VI, isus4–i–VI–VII. Styles that allow two chords per bar (`lofi`, `pop-pluck`, `minimal-pulse`, `warm-groove`: one or two by seed) pick from four eight-chord sets per mode (e.g. I V | vi iii | IV I | IV V). Chords are 7th, 6th, add9, sus2, sus4 or 7sus4 voicings of four notes; flat degrees are spelled with flats. The last bar, and every bar from an `end` cue on, is the tonic chord.

Cue kinds, all pitched to the chord sounding at that beat: `cut` soft bell on a chord tone an octave up; `highlight` short high tick; `impact` one gentle felt thump plus a low bell (never a bass boom); `confirm` two-note rising pair (second note half a beat later); `type` very soft muted plucks on 16ths for `beats` (default 1); `tick` single tick, consecutive ticks less than two beats apart rise through the chord; `end` long bell on the tonic.

Mix: one comb-filter reverb shared by bed and cues; cues about 4 dB above the bed; soft knee limiter (ceiling about −2 dBFS, true peak ≤ −1 dBTP); integrated loudness −16 LUFS measured with ffmpeg ebur128 and set with one gain (a second correction only if the limiter moved it); 30 ms fade-in, 1.2 s fade-out. Deterministic: the same file and seed give identical bytes. A 30 s score renders in about a second.

Outputs: `<dir>/assets/music/score.json` is the resolved score: `{ duration, bpm, beat_seconds, beats_per_bar, bar_seconds, key, mode, palette, energy, seed, style, chords_per_bar (1 or 2), progression (the four chords, or eight when `chords_per_bar` is 2, as names), motif (null for `classic`), fingerprint, music, bars (chord per bar), cues: [{ beat, kind, beats?, time (seconds), bar, chord }] }`; compare the video's cut times with `cues[].time`. `fingerprint` is `style|palette|progression|bpm|key|mode` with the progression's chords joined by `-` (for example `acoustic-strum|nylon|Gmaj7-Em7-Cmaj7-D7|84|G|major`). `music` is the object to copy into the ledger entry of the video (`ledger.json` `videos[].music`), the same keys in this order: `{ "style", "palette", "progression" (string, chords joined by `-`), "bpm", "key", "mode", "fingerprint" }`; `verify`'s `variety` check compares it with the previous videos' entries. CREDITS line: "scored by create-video-engine, no licence restrictions". `--json` prints `{ ok, route: "scored", file, duration, bpm, key, mode, palette, style, fingerprint, cues: n }`.

### Without `--score`

Default route `generated`: the same scorer with no cues, from `--mood`, `--duration` and `--bpm` (also writes `score.json`). `--json` prints `{ ok, route: "generated", file, duration, bpm, credit, candidates_considered: 0 }`. It is a bed only; use `--score` whenever the video has cuts.

`--source openverse` (no longer the default: a found track cannot follow the cuts; skipped with `--offline`; any network or download failure silently falls back to the generated route and the command still succeeds): anonymous `GET https://api.openverse.org/v1/audio/?q=<mood>&license=cc0,by&category=music&page_size=20`, User-Agent `create-video-engine`, 10 s timeout; nothing but the mood words is sent. A multi-word phrase often matches nothing, so up to three single words are tried afterwards. Accepted: licence `cc0` or `by` only; filetype mp3/mp32/ogg/oga/wav/flac; duration ≥ min(`--duration`, 30 s); https URL on jamendo.com, freesound.org or wikimedia.org (and subdomains), also after redirects; known size ≤ 25 MB. Ranked cc0 first, then mood words in title/tags, then closeness to the target length. The download goes to a temp file, is size-capped, probed with ffprobe, and only ever passed to ffmpeg/ffprobe as input; it is looped or trimmed to `--duration` (0.4 s fade-in, 1.5 s fade-out). For CC BY the credit line carries the `attribution` text Openverse returns (legal requirement). `--json` has `route: "openverse"`, `bpm: null`, `credit`, `candidates_considered` (results returned before filtering).
