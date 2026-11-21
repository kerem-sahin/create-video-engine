---
name: make
description: Make a new video for a brand that already has a taste file — pick the lane, brief, three story options, a numeric spec, the HyperFrames build, verification and hand-over. Use when the person asks for a video, a launch video, a demo, a talking-head edit, a photo Reel/TikTok/Short or a promo for a brand in this studio.
---

# Make: a video in this brand's taste, not a template's

The `hyperframes` skill (in `skills/hyperframes/`) is the authority on **how** to write a composition: its contract, timing, assets, determinism. Read its `SKILL.md` and `references/` the first time in a session. This skill decides **what** to make and keeps it inside the brand's taste. Where the two disagree on look or rhythm, `STYLE.md` wins; on the composition contract, HyperFrames wins.

All commands run from the studio root. `<dir>` below is `brands/<brand>/videos/<slug>`.

This file is the lane-agnostic core. What is specific to one kind of video (product launch, talking head, photo social) lives in the lane's recipe, `skills/make/lanes/<lane>.md`. Where this file says "the lane says", follow the recipe.

## 0. Preconditions

- `brands/<brand>/taste/STYLE.md` exists. If not, run the `setup` skill first.
- Read, in this order: `STYLE.md` (all of it), `taste/CHANGES.md` (last 10 entries), `taste/ledger.json` (last 5 videos), the `.txt` reasons in `taste/examples/rejected/` and `approved/`. These are the person's taste so far; do not re-ask what they already answered.
- Read `studio.json` `lanes` (the kinds of video this studio was set up for). Pick the lane from the brief. If two fit or none does, ask once ("a launch video or a photo Reel?"). If the wanted kind is not in `lanes`, say so and offer `npx create-video-engine add lane:<id>` (see `catalog list`); do not improvise a lane. Then read `skills/make/lanes/<lane>.md` and follow it wherever this file says "the lane says". Parts installed under `parts/<id>/` have a `README.md`; read the ones the recipe names.

## 1. Brief (one message, prefilled)

Ask in **one** message, each item with your best guess so the person can say "yes":

1. **What this video is for**: a launch, one feature, an update, a how-to. One sentence.
2. **Destination** → aspect and length. Default: `STYLE.md` `format`.
3. **The facts it must show**: real numbers, real names, real prices. Every number on screen must come from the person or their material, never from you.
4. **The ending**: what the viewer should do (download, star, visit, buy, subscribe) and the exact words.
5. **Real material**: which footage, photos, screenshots or recordings to use. Never a mock-up or stock you invented.
6. **The lane's extra brief questions** (the recipe lists them; fold them into the same message).

Write the answers to `<dir>/BRIEF.md`.

Use only the person's own material. No personal data, no real people's names, faces or content, nothing showing other people, unless the person gives it to you for this video. If material shows someone else's data or face, crop it out or ask for another.

## 2. Three stories, the person picks

Before writing them, answer for yourself in `BRIEF.md`: what is it (one sentence), who is it for and what does it do for them, what sets it apart, what is the visual hook, and the one-line share caption, plus the lane's own questions (the recipe lists them). A stranger who sees the video once must know what it is, who it is for and what to do next.

Write three different storylines, three to five lines each, in the brand's voice. They must differ in **structure**, not only in wording: e.g. problem → subject → proof; one continuous walk-through; a single bold claim proven three ways. The recipe gives example structures for its lane.

Avoid the structures, transitions and accent use of the last videos in `ledger.json`. If a story repeats the previous video's structure, say so next to it.

Show all three. The person picks one (or merges). Record the choice in `BRIEF.md`.

## 3. Create the project

Create the project **before** any lane step writes files into `<dir>` (`hyperframes init` refuses a folder that is not empty).

```
npx hyperframes init <dir> --example blank --resolution <landscape|portrait|square> --skip-skills --non-interactive
cp brands/<brand>/taste/STYLE.md <dir>/frame.md
```

Copy only the assets you will use into `<dir>/assets/` (from `brands/<brand>/capture/`, the person's screenshots, the repo). Fonts the brand uses and HyperFrames doesn't bundle go to `<dir>/assets/fonts/*.woff2` with `@font-face`; check Turkish/other glyphs if the on-screen language needs them.

## 4. Spec before code

Write `<dir>/SPEC.md` (HyperFrames' `references/spec.md` format) before any scene:

- **LOOK**: from `frame.md` only — hex values, families, weights. No new colours.
- **RHYTHM**: shot lengths and cut rate inside `STYLE.md` `rhythm`. Total length inside `format.length`. The end card is exempt from `rhythm.shot_length` (2–5 s): it runs as long as its lines need to settle and be read (see the lane's recipe).
- **MOTION**: eases and durations from `STYLE.md` `motion`, as numbers.
- **SHOTS**: a table — start, end, what is on screen, the real asset used, the line of copy, the transition out. Shot types come from the lane's recipe.
- **BANNED**: everything in `never`, plus the transitions and structure of the previous video from `ledger.json`.
- **SIGNATURE**: where the brand's signature element appears.

- **SOUND**: BPM, bars, and the cue list — beat, time, the visible action, the cue kind (from `STYLE.md` `sound`). For footage-led videos see "Sound under voice" below.
- **TYPE**: every on-screen text ≥ `format.min_text_px` (default 48 px at 16:9). Small labels may go to 32 px only if they are decoration, not information.

- **POSTER**: frame 0 is the platform thumbnail. It is a designed still: the subject (product, face, photo) and the hook line are fully on screen at t = 0 (entrances start from their final pose or later, not from empty). verify's `poster` check measures it.

Also write `<dir>/shots.json` from the SHOTS table, the transitions and structure in the same words you will use in the ledger:

```json
{ "shots": [ { "start": 0, "end": 2.5, "transition_out": "hard cut" }, { "start": 2.5, "end": 6, "transition_out": "carry: map pin" }, { "start": 6, "end": 9 } ],
  "structure": [ "hook: map on frame 0", "capture screen", "end card" ] }
```
 verify's `variety` check compares it with the ledger, and `on-beat` checks the cuts against `cues.json`.

Add the lane's spec rows (the recipe names them). Every adjective in the spec becomes a number. If a value isn't in `STYLE.md`, write `chosen:` next to it so `learn` can confirm or reject it later.

## 5. Build

Follow the `hyperframes` skill to build the scenes. Then loop:

```
npx hyperframes check <dir> --json
```

until there are **no errors**. Read the warnings; fix the ones that a viewer would see (overflow, unreadable text, dead stretches).

**No empty frames.** The subject fills the frame; how big and how it is framed is the lane's rule. No empty band bigger than about 15 % of the frame outside the end card (verify's `empty-area` and `subject-scale` measure this; the recipe says what a legitimate pass looks like). Platform safe zones apply to **text and the call to action only**: at 9:16 keep text out of the top 14 % (270 px of 1920), the bottom 22 % (420 px) and the right 12 % (130 px, the platform's buttons); at 16:9 keep 5 % margins. Where HyperFrames' check or `vertical.md` gives other numbers, these win; the subject may run under the platform's buttons. Never shrink the subject to make the text fit; shorten the text.

**Big, short headlines.** One headline per shot, at most two lines, at least 2 × `format.min_text_px` (≥ 80 px at 9:16, ≥ 96 px at 16:9), the brand's display face. One or two words of it may carry the accent colour.

**Something happens on every beat that matters.** Each shot has at least one visible action on its highlight beat: the brand signature (ring, underline, stamp) landing on the element the headline names, a card sliding in, a push-in, or whatever action the lane's recipe lists. Every `highlight`/`confirm` cue in `cues.json` has a visible action at that exact time.

**Make it alive.** Nothing is a static slide: the lane's recipe says what "in use" means for its subject, and what the weakest shot is (at most one per video, and something on it must still happen).

**Readable.** Every line meant to be read stays fully visible and settled for at least 0.3 s per word (minimum 1 s), counted from when the whole line is on screen, not from when it starts moving in. Pace comes from motion and cuts, not from pulling text away early.

**No muddy crossfades.** A crossfade between two busy layouts makes a double exposure; stagger it (old content out, then new content in on the beat) or carry one element across.

**Transitions never pass through an empty frame.** The next scene's main content is on screen on its first frame (it may still be moving in); never fade one scene fully out before the next fades in. A cut is better than a gap.

### Motion

If `parts/cve-motion/` is installed, copy `parts/cve-motion/cve-motion.js` to `<dir>/assets/` and load it before the composition script (`<script src="assets/cve-motion.js">`; `parts/cve-motion/README.md` explains it). It gives `window.CVE`: `CVE.ease.snappy | soft | settle` (springs), `CVE.settleIn(tl, el, at)` and `CVE.carry(tl, fromEl, toEl, at, duration)`.

- Use the `CVE` ease named in `STYLE.md` `motion.spring` for everything that enters. Never `linear` or `none` for entering elements; linear stays for rotation, progress and constant speed.
- Every scene change has a continuity link: an element carried across the cut, or a colour or shape that sits in the same place on both sides. Name it in the SHOTS column "transition out". A hard cut is still allowed; say so there. How to carry (`CVE.carry`) is in the lane's recipe.

### Sound: composed with the edit

The music is written **with** the video, not laid under it afterwards. A track found elsewhere can't follow the cuts; that is why it sounds pasted on.

1. **Tempo first.** Pick a BPM inside `STYLE.md` `sound.bpm`. One beat = 60/BPM s. Choose the length as a whole number of bars (e.g. 84 BPM × 28 beats = 20.0 s) inside `format.length`, and set the root `data-duration` to it.
2. **Every scene change lands on a beat**, ideally on the first beat of a bar; every highlight, stamp or confirmation lands on a beat or half-beat. Write the beat number of each into `SPEC.md` next to its time. Timings in the composition are those beat times, exactly.
3. **Write `<dir>/cues.json`** from the SPEC: `duration`, `bpm`, `beats_per_bar`, `key`, `mode`, `palette`, `energy` from `STYLE.md` `sound`, a `style` from `sound.styles` that is **not** the one of the previous video in `ledger.json` (rotate; a brand's music should not be the same song every time), a `seed` that is new for this video (e.g. the sum of the slug's character codes), and one cue per moment (`cut`, `highlight`, `impact`, `confirm`, `type` with `beats`, `tick`, `end`) at its beat:
   ```json
   { "duration": 20, "bpm": 84, "beats_per_bar": 4, "key": "C", "mode": "major", "palette": "felt-piano", "style": "piano-ballad", "seed": 731, "energy": 0.3,
     "cues": [ { "kind": "cut", "beat": 4 }, { "kind": "highlight", "beat": 6 }, { "kind": "type", "beat": 8, "beats": 2 }, { "kind": "confirm", "beat": 20.5 }, { "kind": "end", "beat": 26 } ] }
   ```
   Beats count from 0 at the first frame; half-beats (20.5) are allowed. Cue kinds come from `STYLE.md` `sound.cues`; a moment the brand's product has its own sound for gets the closest kind (a bell → `confirm` or `end`, a stamp → `impact`).
4. Compose:
   ```
   npx create-video-engine music --score <dir>/cues.json --out <dir>
   ```
   It writes `assets/music/track.wav` (music and cue sounds together, in key, one room) and `assets/music/score.json` with every cue's time in seconds.
5. Mount it once: `<audio id="music" class="clip" src="assets/music/track.wav" data-start="0" data-duration="<length>" data-volume="1" data-track-index="<own lane>">`. No separate effect files are needed; use a bundled effect from `skills/media-use/audio/assets/sfx/` only for a non-musical real sound the score can't make, and keep it quiet.
6. Check that the cue times in `score.json` match the moments on screen (snapshot a few cue times).

**Sound under voice.** In a video led by speech, the voice is the sound. Music is the lane's decision: none, or a bed ducked to −20…−24 LUFS short-term under speech and raised only in speech-free stretches; either way cue sounds stay out of the way of words. Cuts then follow the speech, not the beat; `on-beat` applies only to the beats you wrote in `cues.json`. If there is no `cues.json`, verify skips `on-beat`.

Never ask the person for music. `music: none` in `STYLE.md` means silent. `--source openverse` exists but is not the default, for the reason above; if used, its CC BY attribution must go into the hand-over and the post. Never MusicGen (CC-BY-NC weights), never NC/SA/ND tracks. No trailer sounds (booms, whooshes, risers, glitches) unless `STYLE.md` names them.

Look at it before rendering the whole thing:

```
npx hyperframes snapshot <dir> --at <the start of every shot, the middle of every transition, and the moment each text line settles> -o <dir>/snapshots
```

Compare each still with `SPEC.md` and `STYLE.md`: overflow, collisions, low contrast, double exposure mid-transition, text that is still moving when it should be read. Every frame should be worth posting as a still. Fix what doesn't match.

## 6. Render and verify

`--quality` takes exactly these names: `draft` (fast, for checking), `looks` (the default), `delivery` (the highest; `high` is the same thing), `standard`. Use `draft` for drafts and `delivery` for the file you deliver; never any other word.

```
npx hyperframes render <dir> --quality draft -o <dir>/renders/draft.mp4
npx create-video-engine verify <dir> --mp4 <dir>/renders/draft.mp4
```

Follow the `verify` skill completely (measurements, then fresh-eyes review). Fix, re-render, re-verify. When it exits 0:

```
npx hyperframes render <dir> --quality delivery -o <dir>/renders/<slug>.mp4
npx create-video-engine verify <dir> --mp4 <dir>/renders/<slug>.mp4
```

The delivered file is only the one that passed verify.

## 7. Record it in the ledger

Append to `brands/<brand>/taste/ledger.json` `videos`:

```json
{ "slug": "<slug>", "lane": "<lane>", "date": "YYYY-MM-DD", "aspect": "16:9", "length": 24,
  "structure": ["hook: …", "main part", "proof", "end card"],
  "transitions": ["hard cut", "push", "mask wipe"],
  "accent": "#hex", "music": <the "music" object from assets/music/score.json, or null if silent>, "verified": true, "feedback": null }
```

## 8. Hand over

Write `<dir>/share-copy.txt`: 1–3 sentences, postable as-is, specific to this video, in the brand's voice and the person's language (no "excited to share", no generic SaaS phrases). If any music or asset needs attribution (CC BY), the credit line goes at its end.

Give the person: the file path, the share copy, one line per verify layer, the `MOMENTS` list from verify, and the five questions from the `verify` skill. Their answers are the input of the `learn` skill — start it as soon as they reply.

Do not describe the video as great, cinematic or stunning. Say what it is and what was checked.
