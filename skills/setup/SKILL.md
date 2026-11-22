---
name: setup
description: Set up a new brand in this video studio — gather what already exists (site, repo, screenshots), interview the person briefly, analyse the videos they like, and write the brand's taste file (brands/<brand>/taste/STYLE.md). Use when the person says "set up my brand", "add a new product", "start a new studio", or asks for a video for a brand that has no STYLE.md yet.
---

# Setup: get to know a brand

The goal is a `STYLE.md` that describes **this** brand so precisely that two different brands never come out looking alike, and so honestly that every value can be traced to where it came from. You are not choosing a theme. You are writing down a taste.

Read `AGENTS.md` at the studio root first. The format of `STYLE.md` is fixed: copy `skills/setup/assets/STYLE.template.md` and fill it.

## Before you start

- You must be inside a studio (a folder with `studio.json`). If not, tell the person to run `npx create-video-engine init <folder>` and stop.
- Run `npx create-video-engine doctor`. If it fails, show the failing lines and their fixes, and stop.
- If `brands/<slug>/taste/STYLE.md` already exists, this is not setup: use the `learn` skill to change it.

Talk to the person in **their** language (the language of their messages), whatever language the skills are written in.

## 1. Name and sources (one short message)

If the person already gave the name and sources, skip the question. Otherwise ask for the brand name and whatever exists — any of: a website URL, a local repo path, a folder of screenshots, an App Store link. Make a slug (lowercase, hyphens). Create `brands/<slug>/` and write `brand.json` (`name`, `slug`, `sources`, `createdAt`).

## 2. Inventory before questions

Learn everything you can **before** asking anything else. Never ask what the material already answers.

- **Website** → `npx hyperframes capture <url> --json --skip-vision -o brands/<slug>/capture`. If it prints `ok: false`, exits non-zero or writes `BLOCKED.md`, it failed: take nothing from its partial files and say so. Otherwise read `extracted/tokens.json`, `extracted/visible-text.txt`, and look at the screenshots yourself.
- **Repo** → read the README and the files that define the look: CSS variables, Tailwind config, `Theme.swift` / asset catalogs (iOS), `colors.xml` (Android), design-token JSON. Find the app icon and any screenshots. Take exact hex values from code, never estimate them from images when the code has them.
- **Store screenshots** usually have a device frame, a marketing caption and a background. A video may show only the real UI inside, so crop each one: `npx create-video-engine crop <img> --auto --out brands/<slug>/sources/<name>.png` (add `--status-bar` to drop the iOS status bar). Then **look at the result**. It prints what it cut; if the crop still shows caption, frame or a sliver of background, or the command exits 1 (no confident rectangle), read the pixel positions yourself and crop by hand with `--rect x,y,w,h`. If it says the image is already full-bleed UI, use it as it is. Keep the source file name. Never stretch or redraw UI.
- **Screenshots** → look at them. If you must sample a color from pixels, use ffmpeg on a cropped region and record the value as `sampled from <file>`.
- **A page with several looks** (a portfolio, a company with many products): `capture` will return many fonts and colors. Do not average them. List the candidates and ask which belong to this brand.

- **How the product shows itself.** Look at what the product's own interface *does*: how it marks what it understood, how it confirms an action, how it moves between states, what it never does. Read the code that draws it when you have the repo (e.g. a styling function, an animation), or watch a screen recording. These behaviours are the best candidates for the signature, because nobody else's video has them. **Sound too:** if the product plays a sound (search the code for the sound player, a sound file or a system sound id), write down exactly which one and what it is like (a bell, a soft tick); never describe a sound you did not find. The video's effect for that moment is the bundled one closest in character, not a louder or more dramatic one. A popular video effect the product does **not** do (a highlighter sweep behind words, a glow, a bouncing card) goes to `never`.

- **Use only the product's own material.** Never put personal data, real users' names/photos/content, or anything showing other people into a video unless the person explicitly provides it for this purpose; sample data shown in screenshots must be clearly fake or the person's own.

Write down what you found as a short list, each item with its source. This list is the start of `STYLE.md`.

## 3. What do you make, and the interview

### 3a. What do you make? (lanes)

Run `npx create-video-engine catalog list --json` and read the `ask` of every lane in it (for example talking-head, product-launch, social-photo). Ask them as one short question, "What do you make?", listing the asks in the person's words; they pick one or more (a studio can have several). Prefill your guess from step 2 (a repo with screenshots suggests product-launch). For each pick run `npx create-video-engine add lane:<id>`. Then tell the person what was installed (the new lines in `NOTICE.md`, the lane's recipe) and which tools are missing (`add` prints them with how to install; you never install system tools yourself). If a lane or part is refused, say why. Later, adding a lane is `add lane:<id>`; adding or removing one part is `add <part-id>` or `remove <part-id>`.

Ask once, after the lanes: *"For better results some parts can use a paid service (for example synthetic voice, better transcription). Do you want that?"* The default is **no**, and on no you never ask again. On yes, set `paid: true` in `studio.json`, say which parts are paid and what data they send (the part card's `paid_api.sends`: audio, text), and explain that the keys live only in the person's environment variables or `.env`, never in files you write, logs or videos. Every paid part keeps a free fallback; without a key the studio uses the free one and says so.

### 3b. The interview (one message, at most six questions in total)

The lanes question and the paid question are not part of these six; they come first. Ask everything below in **one** message. Prefill each question with your best inference from step 2 so the person can answer "yes" instead of writing — e.g. *"It looks like a calm day planner for people who hate busy calendars — right?"*

1. **What it is and who it's for**, in one sentence.
2. **Where the videos go**: App Store preview, X/LinkedIn launch post, Reels/TikTok/Shorts, YouTube, a README. (This sets aspect ratio and length; see the table below.)
3. **Three words for how it should feel**, and **one word it must never feel like**.
4. **Two or three videos they love** — any brand, any topic — as files or links, and one line each on *what* they love in it.
5. **One video they dislike**, or that looks like "an AI template" to them.
6. **On-screen language(s).**

If they have no reference videos, say plainly that the style will rest on the brand material and their words only, and that the first video will teach the system more than usual.

| Destination | aspect | length (s) |
|---|---|---|
| App Store preview | 9:16 (or device) | 15–30 |
| Reels / TikTok / Shorts | 9:16 | 15–35 |
| X / LinkedIn launch post | 16:9 or 1:1 | 20–45 |
| YouTube | 16:9 | 30–90 |
| README / website hero | 16:9 | 10–25, loops |

## 4. Read the references

For each reference video:

```
npx create-video-engine refs <file-or-url> --out brands/<slug>/references/<ref-slug>
```

Read its `GRAMMAR.md` and look at `contact-sheet.png` and the frames. Then find the **mechanisms** that make it work, the way a craftsperson would name them: "the product screen carries into the next shot by growing from the button that was tapped (0:04)", "each new line pushes the previous one up instead of replacing it (0:09)". For each: the time, a saved frame (`brands/<slug>/taste/examples/refs/<ref>-<t>.png`), and whether it explains what the person said they love. "Looks nice" or "clean" is not a mechanism. Write them in `NOTEBOOK.md` → `From their reference videos`; ask the person which ones they meant and mark those `confirmed`. Never take its content, logo, footage, copy or exact palette.

For the disliked video, do the same and turn what you see into concrete `Never` lines in `NOTEBOOK.md` ("cuts every 0.8 s", "white centred title on a purple gradient"), not adjectives.

## 5. Write STYLE.md

Copy `skills/setup/assets/STYLE.template.md` to `brands/<slug>/taste/STYLE.md` and fill it.

- **colors / typography**: only real brand values from step 2. Use the role names (`ground`, `ink`, `accent`, …). If a font isn't bundled with HyperFrames, note that it needs `@font-face` and a `.woff2` in the video's `assets/fonts/`.
- **System or licensed fonts**: if the brand uses Apple system fonts (SF Pro, New York, SF Mono), Windows/Android system fonts or a paid font you have no file for, you cannot ship them in a video. Pick the closest freely licensed family — first HyperFrames' bundled fonts (see `skills/hyperframes/references/format.md`), otherwise an OFL family from Google Fonts downloaded as `.woff2` — say which one replaces which, and mark it `substitute for <font>` in `typography`.
- **Language check**: if on-screen text includes Turkish, German, Polish or any non-ASCII Latin script, confirm every chosen font has those glyphs (ğ ş ı İ ç ö ü Ğ Ş Ç Ö Ü for Turkish): put that line in the style frame in each font and look at the snapshot; a box, a different-looking letter or a fallback face means the glyph is missing. Many bundled fonts are Latin-only; from Google Fonts take the `latin-ext` subset. If a font fails, pick the closest family that passes and say so.
- **rhythm**: the median of the measured references; set `source: measured`. With no references, derive from the destination and the three words and set `source: interview`. Never present an interview guess as measured.
- **motion**: numbers. Calm words → longer enters (0.6–0.9 s), fewer cuts. Energetic words → shorter (0.25–0.4 s). Mark the origin in the prose.
- **motion.spring**: choose the preset from the product's own feel, as the person describes it: a snappy UI → `snappy` (300/30), a calm one → `soft` (120/20), a friendly, physical one → `settle` (180/16). Mark the origin in the prose.
- **never**: always include the generated-design defaults unless the brand itself uses them: *Inter, Space Grotesk, Instrument Serif, Geist or JetBrains Mono as the display face; centered white headline on a dark gradient; purple-blue gradients; glassmorphism cards; generic "✨" sparkle motifs.* The disliked video's rules go to `NOTEBOOK.md` → `Never`. Every item concrete enough that someone could check it by looking at a frame.
- **signature**: offer two options drawn from the brand's own world — first choice: a behaviour of the product itself from step 2 (how it marks, confirms or moves); otherwise its icon's shape or a phrase it uses. Let the person pick. The signature recurs in every video.
- **format.min_text_px**: 48 for 16:9 social posts, 40 for 9:16, 32 for a README or website hero. A 1920-wide video in a phone feed is shown about 390 px wide; smaller text is unreadable there.
- **sound**: ask once whether they have a track of their own (a file, or a song they own the rights to) and write it as `sound.track`. Otherwise write three `sound` feel words (from their feel words and the brand's world) that the `music` command searches with, and whether a product sound exists (a bell, a tick: write exactly what you found). `music: none` if they want no music. Music is never composed in code.
- **Prose sections**: as in the template.

Every value has a source or is marked `default`. Do not invent brand facts. Do not flatter the brand in the prose; describe it.

## 6. Confirm with the person

Do not paste the whole file. Show a compact summary:

- palette as hex with roles, fonts with weights
- format (aspect, length) and rhythm numbers with their source
- the `never` list
- the two signature options

Ask what is wrong. Apply corrections. Then write the rest:

- `taste/NOTEBOOK.md` from `skills/setup/assets/NOTEBOOK.template.md`: the reference mechanisms and `Never` lines from step 4, the person's words about what they love and dislike (`setup` as the video), and under `Lessons` one line "created by setup" with the sources used.
- `taste/ledger.json` — `{ "videos": [] }`
- `taste/examples/approved/` and `taste/examples/rejected/` (empty)
- add the slug to `brands` in `studio.json`

## 7. Style frame (strongly recommended)

Before any full video, prove the taste on one still. Create `brands/<slug>/style-frame/` with `npx hyperframes init brands/<slug>/style-frame --example blank --resolution <landscape|portrait|square> --skip-skills --non-interactive` **first** (it refuses a folder that is not empty), then add fonts and assets: a minimal HyperFrames project (one 3-second scene: the brand's real product UI or icon, one headline in the brand's voice, the signature element), copy `STYLE.md` into it as `frame.md`, then run from the studio root:

```
npx hyperframes check brands/<slug>/style-frame --json
npx hyperframes snapshot brands/<slug>/style-frame --at 2 -o brands/<slug>/style-frame/snapshots
```

The style frame follows the `make` creative laws and avoids its defaults: a small product in a big empty frame is the most common failure, not a style. Fix every `check` error before the snapshot. Show the PNG from `snapshots/`. If the person approves, save it to `taste/examples/approved/style-frame.png` with a one-line `.txt` saying why and a `Liked` line in the notebook. If not, ask what is off, fix `STYLE.md`, and note it under `Not liked`. Two rounds at most; then move on and let the first video teach the rest.

## 8. Finish

Tell the person, in two lines: what the brand's taste is, and that the next step is *"make a video for <brand>"* (the `make` skill).

## Honesty rules

- Say what you could not get (capture blocked, no references, font without Turkish glyphs).
- Mark guesses as guesses.
- If the material for a brand is too thin to write a real taste (no site, no repo, no screenshots, no references), say so and ask for one of them rather than producing a generic file.
