---
name: make-talking-head
description: Lane recipe for talking-head videos (YouTube lessons, podcasts, a person speaking to the camera) and the Reels clips cut from them. Extends the make skill; read it after make's steps 0-2.
---

# Talking-head lane: the person's footage is the video

This extends `skills/make/SKILL.md` and assumes its core steps (taste first, brief, three stories, spec before code, HyperFrames contract, verify, ledger, hand-over). Where a step below says the same thing differently, this lane wins for talking footage. The parts live in `parts/` (installed by `add lane:talking-head`): `transcribe-local`, `silence-cut`, `captions`, `overlay-cards`, `shorts-from-long`. Every command below runs from the studio root; `<dir>` is `brands/<brand>/videos/<slug>`.

The footage is the hero and it is the person's. You do not invent a face, a voice or a quote; every card says something the person said or showed.

## 1. Brief extras

Ask these inside make's one brief message, each with your guess:

1. **The recording**: the file(s), the language spoken (`tr`, `en`, ...), one person or several, the face position (centred or off to one side: it sets `--face-x` and where cards may go).
2. **Cut style**: `--mode tight` (pauses shortened to 0.25 s, fillers out) or `--mode normal` (pauses shortened to 0.4 s); `--keep-pause <s>` sets it exactly. Default tight for YouTube lessons and Reels.
3. **Fillers**: Turkish "ıı, eee" always out; "şey" stays unless the person says it is a tic. English "um, uh" out.
4. **Captions**: on or off, `pop` (word highlight, short-form) or `clean` (sentence lines, long-form). Default: long video `clean`, shorts `pop`.
5. **Cards**: which moments deserve one (a name at the start, a number, the takeaway). Default: a name card at the first sentence, a card only where the person says a number or a rule.
6. **Music**: none (default for speech), or a quiet bed ducked under the voice. Never ask for a track: if wanted, `music --mood ... --duration ...` writes one.
7. **Shorts**: how many and for which platform; default 3 clips of 20-40 s.

Put the answers in `BRIEF.md`. The structure of a talking video is the person's own order of ideas, so the "three stories" of make step 2 become three **cut plans** for the same footage: e.g. keep everything but tighten; lead with the strongest claim then explain; trim to the three key points with cards. They differ in structure, not wording.

## 2. Transcribe

```
# first: make step 3 (init <dir>, copy frame.md); then, always:
node parts/transcribe-local/normalize.mjs <recording> --out <dir>/assets/work.mp4
node parts/transcribe-local/transcribe.mjs <dir>/assets/work.mp4 --language <code> --out <dir>/words.raw.json
```

**Always normalize first.** Phone recordings have a variable frame rate and a rotation flag; cutting them directly lets captions drift (about 0.2 s per minute, measured). `normalize` makes a constant-frame-rate, upright working copy; every later step uses `work.mp4`, never the original.

Free and local. The first run downloads whisper and its model (minutes); say so before starting. Read the words before using them (HyperFrames' captions.md): a transcript full of `♪` or nonsense means retry with `--model medium`. Names and brand words are often wrong; fix them in the JSON by hand now, once.

## 3. The cuts: EDL first, the person approves

The transcriber marks words it is unsure of (`"unsure": true`) and lists them. Show the person each one with its sentence and ask what was said; if they can't be asked, keep the word, flag it in `BRIEF.md`, and never put an unsure word on a card.

```
node parts/silence-cut/silence-cut.mjs plan --video <dir>/assets/work.mp4 --words <dir>/words.raw.json --out <dir>/edl.json --mode <tight|normal>
```

Open `edl.md`. Show the person the totals and the unusual cuts: what was removed (seconds, count), every filler with its context, and any pause longer than 2 s. Nothing is cut before they say yes. They may keep a cut (`"approved": false`) or ask for a different `--min-pause`; re-plan, do not hand-edit times. Then:

```
node parts/silence-cut/silence-cut.mjs apply --edl <dir>/edl.json --out <dir>/assets/cut.mp4 --words-out <dir>/words.json
```

From here on use only `cut.mp4` and `words.json` (times on the cut timeline). Re-encoded with a keyframe every second so HyperFrames can seek it. Listen to the joins: play 3 of them (`snapshot` shows only pictures; use `ffplay` or ask the person to listen).

## 4. Build the composition

`init` and `frame.md` as in make step 3. Then:

```
node parts/captions/frame-vars.mjs <dir>/frame.md --out <dir>/assets/brand.css
```

`index.html`: link `assets/brand.css`; one `<video id="talk" class="clip" src="assets/cut.mp4" data-has-audio="true" ...>` full frame at track 0 (the person's own audio is the voice; never mute it); captions and cards as sub-composition hosts above it. The video's `data-duration` is the cut file's ffprobe length, the root's `data-duration` is the same.

- **Captions**: `node parts/captions/build-captions.mjs --words <dir>/words.json --style <clean|pop> --aspect <16:9|9:16> --duration <cut length> --out <dir>/compositions/captions.html`, mounted with `data-track-kind="captions"`. Colours and fonts come from `frame.md` only. Check the Turkish glyphs (ç ğ ı ö ş ü İ) in the brand's display font on a snapshot.
- **Cards on the beats of the speech**: read `words.json` and pick the moment each card belongs to: the name card when the first sentence starts (about 1 s in), a stat card when the number is spoken (start the card 0.2 s before the word), a takeaway when a sentence begins "so", "the point is", "kısacası", "özetle". `node parts/overlay-cards/build-card.mjs --kind ... --text ... --aspect ... --duration ... --id card-1 --out <dir>/compositions/card-1.html`. At most one card on screen at a time, about one per 6-8 s, never on the face, never while a caption group needs the same area (16:9: cards above the caption row; 9:16: upper band). Words on a card are words the person said or numbers they gave.
- **Emphasis without effects**: a slow push-in (scale 1.00 to the brand's `camera.push_in_max`) on a wrapper around the video during the strongest sentence is enough. No shake, no zoom blur, no flashes.
- **Sound**: none added by default. If the person wants music: a bed at -22 LUFS under the voice, ducked 8-10 dB while words are present (HyperFrames `data-automation` envelope from the word timings, `/media-use`), faded out before the last word; never music over the first sentence. Use `music --mood calm --duration <len>`; no vocal tracks.

Spec, `check`, snapshots: as in make steps 4-5. Snapshot at the first caption, a card's start and settle, a cut join, and the end.

## 4b. Long recordings (over about 2 minutes): assemble with ffmpeg

Rendering every frame of footage through HyperFrames takes about 13 s per second of video on a small laptop (an hour for 5 minutes). For anything longer than about 2 minutes, don't build the footage into a composition; assemble it:

```
node parts/assemble-long/assemble-long.mjs assemble --video <dir>/assets/cut.mp4 --words <dir>/words.json \
     --frame <dir>/frame.md --out <dir>/renders/<slug>.mp4 --cards <dir>/cards.json --chapters <dir>/chapters.json
```

- `cards.json`: the same cards as in step 4 with their times; HyperFrames renders only the cards (transparent) and ffmpeg overlays them.
- `chapters.json`: `[{"start": 0, "title": "…"}, …]`, first at 0, at least 3, ≥ 10 s apart, titles in the person's words; it writes YouTube's `chapters.txt` next to the MP4 and a sentence-level `.srt`. Put both in the hand-over (the chapter list goes into the YouTube description, the SRT can be uploaded as subtitles).
- Captions here are clean sentence lines shown on the words' timing (no per-word pop animation on this path).

Verify it with `npx create-video-engine verify <dir> --mp4 <file> --no-composition --expect-duration <cut length> --expect-audio`.

## 5. Verify

```
npx hyperframes check <dir> --json
npx hyperframes render <dir> --quality draft -o <dir>/renders/draft.mp4   # --quality: draft for drafts, delivery for the delivered file
npx create-video-engine verify <dir> --mp4 <dir>/renders/draft.mp4
```

Then the lane's own questions, answered with a measurement or a still, never from memory:

- Does every caption group appear with its words (compare 3 snapshots against `words.json`)? Is any word split or cut off at the edge?
- Is the face clear of every card and caption in every snapshot?
- Is the loudness of the voice acceptable (verify's audio measurement; speech around -16 to -14 LUFS)? Is there a click at any cut join?
- Do cuts feel natural: no word clipped at its start or end, no 0 s gap between a sentence and the next.
- Is the first second worth watching: a face and speech from frame 0, and frame 0 already designed as the thumbnail (the name card or the first caption on screen at t = 0, not fading in), so verify's `poster` passes.

Fix, re-render, re-verify; deliver with make step 6.

## 6. Shorts

```
node parts/shorts-from-long/shorts.mjs pick --words <dir>/words.json --out <dir>/shorts.json
```

Read `shorts.md` and choose with the person: whole thoughts, a hook in the first 2 s (the picker flags when there is none; say so honestly instead of picking a weak one), a clear end. Adjust a start or end to another sentence boundary if the text asks for it. Then per chosen short, track the speaker and cut with a crop that follows them:

```
node parts/subject-track/subject-track.mjs --video <dir>/assets/cut.mp4 --out <dir>/track.json --start <s> --end <e>
node parts/shorts-from-long/shorts.mjs cut --video <dir>/assets/cut.mp4 --words <dir>/words.json --from <dir>/shorts.json --id N --track <dir>/track.json --out brands/<brand>/videos/<slug>-short-N/assets/short.mp4
```

The cut also writes `short.safe-text.json`: the band where text can go without covering the face. Put captions and cards there (`--band y=<y_min>`). If it says `fits: false` (the speaker is close to the camera and there is no room under the chin), put text in the top band below the platform's top 270 px, never over the mouth or eyes. Snapshot a few frames of the short and check the face stays in frame; `--face-x` is the manual fallback.

Each short is its own HyperFrames project (`init --resolution portrait`, `frame.md` copied): 9:16, `short-N.words.json` into captions in `pop` style, the name card only if the short stands alone, cards in the upper band. Same check, render and verify as the long video, with make's 9:16 rules (text out of the top 270 px, the bottom 420 px and the right 130 px, frame 0 is the thumbnail: the face and the hook caption already on screen). Each short gets its own ledger entry and `share-copy.txt` in the person's language.

## 7. Ledger and hand-over

As make steps 7-8, plus: in the ledger entry `structure` lists the cut plan, `transitions` is `["hard cut"]`, and a `lane: "talking-head"` field; in the hand-over give the cut summary (before/after length, number of cuts, fillers removed), what was approved, and the list of shorts with their length and first line.

## Do not

- Cut without the person's yes on the EDL.
- Show a card, number or claim the person did not say or give.
- Put text over the face, or burn captions into the footage when a caption scene can carry them.
- Use a paid transcription service without the studio's `paid` setting; the free path is the default.
- Re-transcribe the cut file to "fix" timings: `words.json` from `apply` is already on the cut timeline.
