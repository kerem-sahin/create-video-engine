---
name: learn
description: Turn the person's feedback on a video into concrete, approved changes to the brand's taste file (STYLE.md), with a logged reason, so the next video starts closer to what they want. Use after the person reacts to a video ("too fast", "not our colour", "love this scene"), or when they say "remember this for next time".
---

# Learn: feedback becomes rules

This is what makes the studio personal over time. A vague reaction is useless next time; a concrete rule with its reason is not. You never change the taste silently.

## 1. Collect the feedback

Use the person's answers to the five `verify` questions and anything else they said. If they gave only a mood ("meh"), ask one question to make it concrete: *"Which moment, and what would you change there?"* — once, not an interrogation.

Sort each piece into:

- **Rule for this brand**: about pace, colour use, type, motion, structure, voice, sound. → goes to `STYLE.md`.
- **Fix for this video only**: a typo, a wrong screenshot, a fact. → fix the video; do not touch `STYLE.md`.
- **A missing capability or kind of video**: "I also want captions", "I'll make Reels from photos too", "I never use this". → not a taste rule: `npx create-video-engine add <part-id>` or `add lane:<id>` (or `remove`), after the person says yes; log it in `CHANGES.md` and tell them what was installed and what tools are missing. Check `catalog list` first.
- **Praise**: what to keep. → becomes a `Do` rule or an approved example.

## 2. Translate to concrete changes

Each rule change names the exact place in `STYLE.md` and the old → new value. Translate words into numbers using this video's `SPEC.md` as the baseline:

| They said | Becomes |
|---|---|
| "too fast" | `rhythm.shot_length` min +30–50 %, `cuts_per_10s` max −1 or −2, enter durations +0.1–0.2 s |
| "too slow / boring" | the opposite, and check `frozen-stretch` warnings in the verify report |
| "text flies in too much" | `motion.ease.enter` to a softer curve, a `never` line naming the effect seen |
| "doesn't look like us" | find the frame; compare with `colors`/`typography`; usually a `never` (the off-brand element) plus a `Do` |
| "no sound" / "something is missing" (with sound off) | the `sound` block: effects per visible action, or a music source they provide |
| "the music is too happy / too sad / boring" | `sound.mode`, `sound.energy` (±0.15), `sound.bpm`, or `sound.palette` — propose two options |
| "this sound doesn't fit" / "irrelevant sound effect" | find the cue in the verify `SOUND` list at that time; check what the product itself plays there (code); replace or remove it, and add a `never` line naming the file or kind of sound |
| "this looks like other AI videos" | find the exact effect in the frames; check whether the product itself does it (code, screens). If not: a `never` line naming it, and propose the product's own behaviour instead |
| "love the moment at 0:12" | a `Do` line describing it concretely, and the frame saved as an approved example |

If a word can't be made concrete with confidence, propose two interpretations and let the person choose.

`colors` and `typography` are brand facts. Change them only if the person explicitly says the brand value itself is wrong, not because one video used them badly.

## 3. Show the diff, get a yes

Show the proposed changes as a short diff of `STYLE.md` (only the changed lines) and one sentence per change saying which feedback it comes from. Apply only what the person approves. Never apply partial approval as full.

## 4. Write it down

For every approved change:

- edit `brands/<brand>/taste/STYLE.md`; bump `updated:`; add a line under `## Learned`: `YYYY-MM-DD · <video-slug> · <rule> · because "<their words>"`
- append to `taste/CHANGES.md`: date, video, old → new, the person's words, approved by the person
- frames: save the frames they praised to `taste/examples/approved/` and the ones they disliked to `taste/examples/rejected/` (`npx hyperframes snapshot <dir> --at <t> -o <folder>`), each with a one-line `.txt` saying why
- set `feedback` on this video's entry in `taste/ledger.json` to a one-line summary

## 5. Close the loop

Tell the person in two or three lines what will be different next time. If they want, re-make the video with the new taste (`make`), and afterwards compare the number of corrections they asked for: fewer is the goal. Record that count in the ledger entry as `"corrections": <n>`.

## Rules

- No change without the person's yes. No "I've updated your style" after the fact.
- Never delete a rule silently; if a new rule contradicts an old one, show both and ask which wins, then mark the old one as replaced in `CHANGES.md`.
- Keep `STYLE.md` readable: if `## Learned` grows past ~20 lines, propose folding settled rules into `Do`/`Don't`/`never` and the frontmatter.
