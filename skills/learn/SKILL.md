---
name: learn
description: Turn the person's reaction to a video (what they liked, what they would change, "remember this") into notebook entries and approved changes to the brand's taste, so the next video starts closer to what they want. Use after every video they react to, and whenever they say "remember this for next time".
---

# Learn

This is what makes the studio theirs. A vague reaction is lost next time; a concrete note with their words and the frame is not. You never change their taste silently.

## 1. Listen

Take their answers (would you post it, the one thing to change, what you liked) and anything else they said. A mood only ("meh"): ask once, "which moment, and what would you change there?".

Sort each piece:
- **Liked** → `NOTEBOOK.md` → `Liked`, with the frame. A track of their own they used or praised goes there too (title, what they said), so the next video can start from it. Approval is a lesson: if they posted it or said "this is us", write down exactly what "this" was.
- **Not liked** → `Not liked`, with the frame; if it is a thing they never want again, propose a `Never` line.
- **A rule for the brand** (pace, colour use, type, motion, voice, sound) → a change to `STYLE.md` or a `Never` line.
- **A drawing** (a character, a car, a building): approved when they post the video or say it is right → `approved: true` in `brands/<brand>/library/library.json`; disliked → note why in the entry and in `Not liked`, and draw it again next time. An approved drawing is reused as it is.
- **A fix for this video only** (typo, wrong screenshot) → fix the video; no rule.
- **A missing capability** ("I want captions too") → `npx create-video-engine add <part>` or `add lane:<id>` after their yes (`catalog list` first).

## 2. Make it concrete

Find the frame (`npx hyperframes snapshot <dir> --at <t> -o brands/<brand>/taste/examples/<approved|rejected>`), and name what is in it in plain words a stranger would understand: "the headline flies in letter by letter", not "too much". If their word can mean two things ("too fast": the cuts or the text?), offer both and let them pick. Translate to the place it changes: a `STYLE.md` value (old → new), a `Never` line, or a `Liked` line. `colors` and `typography` are brand facts: change them only if they say the brand value itself is wrong.

## 3. Show, get a yes

Show the proposed notebook lines and `STYLE.md` changes in one short list, each with the words it came from. Write only what they approve; partial approval stays partial. Notebook `Liked` and `Not liked` lines that only quote them need no approval, but show them.

## 4. Write it down

- `taste/NOTEBOOK.md`: the lines, each `date · video · what · frame · "their words"`; approved rule changes under `Lessons` as `old → new`.
- `taste/STYLE.md`: the approved values; bump `updated:`.
- The frames in `taste/examples/approved/` or `rejected/`, each with a one-line `.txt` saying why.
- `taste/ledger.json`: this video's `feedback` (one line) and `corrections` (how many changes they asked for).

## 5. Close the loop

Tell them in two or three lines what will be different next time. The aim is fewer corrections per video; the ledger counts them. A lesson they have to repeat means the notebook line was wrong: rewrite it with them.

Never delete a line silently. If a new note contradicts an old one, show both and ask which wins; mark the old one as replaced.
