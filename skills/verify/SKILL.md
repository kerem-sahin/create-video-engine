---
name: verify
description: Check a rendered video before it is shown or delivered — HyperFrames' own check plus measurements on the MP4 (blank, frozen or motionless stretches, empty first frame, wrong duration, missing audio, loudness, cuts off the beat, repeated transitions, numbers not in the brief), then a fresh-eyes review of the frames and a short human checklist. Use after every render, and whenever the person asks "is it ready?" or "check this video".
---

# Verify: never hand over a broken video

A video is ready only when it has been **measured**, not when it looks finished in your head.

## 1. Run the measurements

```
npx create-video-engine verify brands/<brand>/videos/<slug> --mp4 <rendered.mp4>
```

Render names for `hyperframes render --quality`: `draft` for a draft, `delivery` for the file to deliver (verify the delivery render too); `looks` is the default, `high` equals `delivery`.

- Exit `0`: every required check ran and passed. Continue to step 2.
- Exit `1`: checks found errors. Fix them in the composition, re-render, run verify again. Do not show the video as "done" in between.
- Exit `2`: something could not run (missing binary, no MP4, a check errored). That is **not** a pass. Fix the cause or tell the person exactly what was not checked.

`near-empty` and `loudness` are warnings, but treat them seriously: `near-empty` means a viewer sees an almost blank frame between scenes (fix the transition); `loudness` on effects-only audio is judged by true peak, and "too quiet" means the effects will not be heard on a phone.

The other warnings, briefly: `on-beat` (a cut more than 1.5 frames from a beat of `cues.json`: move the cut or the music), `variety` (needs `shots.json`; same transition 3+ times in a row, or the same transitions or structure as the last video in the ledger), `stillness` (more than 3 s with no movement but a slow drift: add motion or cut it), `poster` (frame 0 is a weak thumbnail: put the hook on it; the still is `.cve/poster.png`), `numbers` (a number on screen that `BRIEF.md` does not contain: fix the copy or the brief, never wave it through), and `loudness` on effects-only audio is also capped at −9 LUFS short-term. `empty-area` and `subject-scale` warn when most of the frame is background or the content covers under a fifth of it: the subject is too small, make it fill the frame (scale it or crop in), do not wave it through. A full-bleed photo or face naturally passes; the lane's recipe says what a warning means for its kind of video. `on-beat` also uses the boundaries in `shots.json` when no cuts are detected and warns when a declared boundary shows no visual change. A `skipped` new check means its input file is missing: write `shots.json` and `cues.json` in the make step so they can run.

Read `.cve/verify-report.json`. Quote failing checks with their time in the video (e.g. *"blank stretch at 6.2–7.0 s"*). Warnings (`warn`) don't block, but mention them.

## 2. Fresh-eyes review

Whoever built the video must not be the one who grades it. **Start a sub-agent for this whenever your tool can** — it is part of the job, not an optional extra. Give it **only**: `.cve/frames/*.png` (one readable frame per shot start, named by time), `.cve/contact-sheet.png` for the overall rhythm, the brief, and `brands/<brand>/taste/STYLE.md` — not the code, not your reasoning. Also give it the `SOUND` cue list from the verify output (time, file, what the file is; for scored music, each cue's time, kind and beat) — the reviewer can't hear, but it can check each sound against what is on screen at that second and against `STYLE.md` `sound`. Ask for at most 5 defects, ranked, each tied to a frame and to a STYLE.md rule (`never`, `do`, rhythm, signature). If you cannot start a sub-agent, do this yourself from the frames and the contact sheet alone and say so.

Fix real defects. You may reject a defect only when it contradicts an explicit rule in `STYLE.md` or the `make` skill — quote that rule. "The platform UI covers that area", "it is the real size of the source" or "the style frame looked like that" are not reasons: a small subject, an empty band or small text is fixed, not explained. List every rejected defect, with its quoted rule, in the hand-over. The same goes for the `empty-area`, `subject-scale`, `stillness` and `poster` warnings: fix them, or name the rule that allows it.

## 3. Hand over with the human checklist

Show the person the video, the verify summary (one line per layer), the `MOMENTS` list from the verify output (at most 5 timestamps, each with why: tell them to watch and listen at exactly those times) and these five questions:

1. Do the first two seconds make you stop scrolling?
2. Does the pace feel right — too fast, too slow, or right?
3. Is the sound right (or should there be none)?
4. Does it look like *your* brand, not a template?
5. Would you post it as it is? If not, what is the one thing to change?

Their answers go to the `learn` skill. You cannot judge taste the way they can; do not claim the video "looks great".
