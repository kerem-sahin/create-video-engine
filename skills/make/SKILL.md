---
name: make
description: Make a video for a brand in this studio: brief, three stories, build, a fast draft the person sees, a fresh critic, the final render and hand-over. Use when the person asks for a video, a launch video, a demo, a talking-head edit, a photo Reel/TikTok/Short or a promo for a brand that already has a taste file.
---

# Make

You make the whole video yourself: story, design, motion, render. The goal is one the person **would post as it is**. Passing checks is the floor, not the goal.

The `hyperframes` skill (`skills/hyperframes/`) is the authority on **how** a composition works (its contract, timing, assets, determinism); read it once per session. This file decides **what** to make. All commands run from the studio root; `<dir>` is `brands/<brand>/videos/<slug>`.

## 0. Know the person first

Read `brands/<brand>/taste/STYLE.md` (brand facts: colours, fonts, voice, format), `taste/NOTEBOOK.md` (what this person liked, disliked and banned, with frames, and what you took from their reference videos), and the last three entries of `taste/ledger.json`. Look at the frames in `taste/examples/`. That is their taste so far; never re-ask it, and never repeat what they rejected. No `STYLE.md`: run `setup` first.

Pick the lane from `studio.json` `lanes` and read its recipe (`skills/make/lanes/<lane>.md`): it says what the material is and what is specific to that kind of video. A kind of video the studio was not set up for: say so and offer `npx create-video-engine add lane:<id>`.

## 1. Brief: one message, prefilled

Ask once, each item with your best guess so the person can just say yes: what the video is for (one sentence); where it goes (sets aspect and length); the facts it must show (real numbers, names, prices, only from them); the ending (what the viewer should do, exact words); which real material to use; plus the recipe's own questions. Write the answers to `<dir>/BRIEF.md`.

## 2. Three stories, the person picks

First answer for yourself in `BRIEF.md`: what is it, who is it for and what does it do for them, what sets it apart, what is the most striking or funniest true thing about it, what is the visual hook, the one-line caption.

Then write **three** storylines, three to five lines each, in the brand's voice, different in **structure** (e.g. problem → product → proof; one continuous walk-through; one bold claim proven three ways), not only in wording. Mark any that repeats the last video's structure. The person picks or merges, in words, before anything is built.

## 3. Build

```
npx hyperframes init <dir> --example blank --resolution <landscape|portrait|square> --skip-skills --non-interactive
cp brands/<brand>/taste/STYLE.md <dir>/frame.md
```

Copy only the assets you use into `<dir>/assets/`. Fonts the brand uses go to `assets/fonts/` with `@font-face`; check the on-screen language's letters (ı, ş, ğ…) render.

### Creative laws

- **The hook is everything.** The first two seconds decide whether anyone keeps watching. Design them first. Frame 0 is the thumbnail: the subject and the hook line are already on screen.
- **Show the real thing.** The person's real screens, components, photos, footage, voice, fonts. Reuse before you rebuild; the working product doing its job beats a page describing it. Never a mock-up or stock you invented, never abstract filler. A named real thing (a car model, a building, an instrument) must be recognisable as that thing: take it from `brands/<brand>/library/` (approved drawings first), else draw it from a real photo (`draw-from-photo`, or the person's own photo), never from memory in a few strokes.
- **The picture proves the line.** A word on screen that makes a claim (hidden, quiet, small, fast, the clue "two stools") must be visible in the picture under it. A hidden place shown as its famous postcard view says the opposite. If no picture proves it, choose another picture or change the line; the critic's "the photo does not show it" is a P0.
- **One story, told by the picture.** Every shot shows what the words say at that moment. If a shot could sit in anyone's video, it is not done yet.
- **Specific.** It must feel made for this exact brand: its own words, claims, behaviour and signature. No generic marketing language.
- **Alive.** Things arrive one by one, the product is used (taps, typing, scrolling), the camera moves with purpose. Nothing sits still as a slide.
- **Design the joins.** Each beat grows out of the previous one: an element carried across the cut, a shape that becomes the next frame, a movement that continues. A hard cut is fine when it is a choice.
- **Readable.** A line meant to be read stays fully settled about 0.3 s per word (at least 1 s), counted from when it is complete. Pace comes from motion and cuts, not from pulling text away early.
- **Every frame postable.** Any frozen frame should be worth sharing.
- **One hand.** Everything drawn in a video looks drawn by the same hand: the same line weight, the same amount of detail. A traced, detailed object next to stick figures is two videos glued together; raise the simple ones or simplify the detailed one.

### Hard limits (the only rules that are not yours to judge)

- Every number, name, price and claim on screen comes from the person or their material.
- No personal data, no real people's names or faces, nothing showing other people, unless the person gave it for this video.
- Only material they own or that is licensed for it (CC0/CC BY with credit; never NC/SA/ND).
- Text at least `format.min_text_px`; at 9:16 text and the call to action stay out of the top 270 px, the bottom 420 px and the right 130 px (the subject may run under them). These numbers win over HyperFrames' `vertical.md` band.
- Audio −16 LUFS ±1, true peak ≤ −1 dBTP, measured by verify on the rendered file (HyperFrames' mix changes the level, so measuring the source file is not enough).

### Defaults to avoid

These are what a model makes when nobody is looking. Use one only if this brand really does it:
a small centred item in a dark void; a centred white headline on a gradient; glow, glass cards, sparkles; three feature cards in a row; the logo parked in a corner; everything entering on the same frame; a slow fade between two busy layouts (double exposure); a frame that empties before the next scene arrives. Add the person's own bans from `NOTEBOOK.md` → `Never`.

### Sound

The engine does not find or make music: you cannot hear it, and free catalogues and code-made tracks were the weakest part of every test video.

1. **Their own track** (`STYLE.md` `sound.track`, or a file they give for this video, rights theirs): use it, cut the edit to its beats and write `cues.json`. Name it in the ledger.
2. **No track** (the default): the video is made without music. The product's own sound and effects with a visible cause (a tap, a stamp) stay, a few kinds, quiet. Cut to a steady pulse anyway (`cues.json` with the bpm you cut to) so a sound added later sits on the cuts. In the hand-over tell them where music goes: on Reels or TikTok they add a sound from the app's own library when posting (that also helps the video travel); elsewhere they can send you a track of their own and you put it under. Give the cut times and the bpm.
3. A speech-led video: the voice is the sound. Their own track only under it, ducked.

### Two small files for verify

Write them as you build; they let verify check what the eye might miss:
- `<dir>/shots.json`: `{ "shots": [ { "start": 0, "end": 2.5, "transition_out": "carry: map pin" }, { "start": 2.5, "end": 6 } ], "structure": [ "hook: map on frame 0", "walk-through", "end card" ] }`. verify compares cuts with it and with the last video in the ledger (the same transitions or structure again is a warning).
- `<dir>/cues.json`: the pulse the edit is cut to, `{ "bpm": 96 }` (beat 0 = the first frame). verify then checks the cuts against that grid.

## 4. Look, then a fast draft

**Look before rendering.** `npx hyperframes snapshot <dir> --at <every shot start, every transition midpoint, the moment each line settles> -o <dir>/snapshots` takes seconds. Look at every still as a stranger would: what does it say, is anything cut off, colliding, unreadable, empty, generic? Fix and snapshot again until every still is worth posting.

**Draft.** `npx hyperframes render <dir> --quality draft -o <dir>/renders/draft.mp4`, then `npx create-video-engine verify <dir> --mp4 <dir>/renders/draft.mp4`. Exit 1 is a broken video (blank, frozen, wrong length, no sound, wrong loudness, a number they never gave): fix it. Warnings are questions for your eye, not orders. A speech-led video also runs `node parts/transcribe-local/sync-check.mjs <draft.mp4> --words <words.json> --language <code>`: you cannot hear, so this is the only proof that captions and pictures land on the words.

**Fresh critic.** Follow the `verify` skill: a sub-agent that has not seen the code looks at the frames with the brief and the person's dislikes and says what a stranger would see. Fix every P0 and re-check.

**Show the draft.** Give the person the draft, three or four stills and the `MOMENTS` from verify, and ask for one note. If nobody can be asked (AGENTS rule 9), render the final and say in the hand-over that no one saw the draft.

**Keep the loop short.** Check every change with `snapshot` at the moments it touches (a few seconds), not with a render. Render a draft only when you are about to show it (on an M1 a 15 s draft takes about 30 s; `--fps 15` saves a little; `--start/--end` does not save time). Footage-heavy and long videos have their own fast path in the recipe.

## 5. Final and hand-over

`npx hyperframes render <dir> --quality delivery -o <dir>/renders/<slug>.mp4` and verify it. Only a file that passed verify is delivered.

- `<dir>/share-copy.txt`: 1–3 sentences, postable as-is, specific, in the brand's voice and the person's language; any CC BY credit at the end.
- Append to `taste/ledger.json` `videos`: `{ "slug", "lane", "date", "aspect", "length", "structure": [...], "transitions": [...], "music": <their track's title, or null>, "drawings": [<library names used>], "verified": true, "feedback": null }`. Add this video's slug to each used drawing's `used_in` in `library.json`. Copy each used drawing's `credit` line from `library.json` into `<dir>/CREDITS.md`; a CC BY credit also goes at the end of `share-copy.txt`.
- Tell the person: the file, the share copy, one line on the idea, what verify measured, the moments to watch. Ask three things: would you post it as it is; if not, the one thing to change; what did you like. Their answers go to the `learn` skill.

Never call the video great, cinematic or stunning. Say what it is and what was checked.
