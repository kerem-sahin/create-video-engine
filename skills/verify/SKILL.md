---
name: verify
description: Check a rendered video before anyone sees it: the measurements (blank, frozen or silent stretches, wrong length, missing audio, loudness, numbers nobody gave), then a fresh critic who has not seen the code looks at the frames as a stranger would. Use after every draft and final render, and whenever the person asks "is it ready?" or "check this video".
---

# Verify

Two different questions: **is it broken?** (measured) and **is it good?** (looked at by someone who did not make it).

## 1. Measure

```
npx create-video-engine verify brands/<brand>/videos/<slug> --mp4 <rendered.mp4>
```

- Exit `1`: it is broken (blank or frozen stretch, empty first frame, wrong length, no sound when sound is expected, HyperFrames' own check failing). Fix, render, verify again; never show a broken video as done.
- Exit `2`: something could not be checked. That is not a pass: fix the cause or tell the person exactly what was not checked.
- Exit `0`: nothing is broken. Two warnings are hard limits all the same and must be fixed: `loudness` (not −16 LUFS ±1, or true peak above −1 dBTP) and `numbers` (a number on screen that `BRIEF.md` does not have). The other **warnings** are questions for your eye: a still stretch, a large empty area, a small subject, a weak first frame, a cut off the beat, the same transition again. Look at that moment and decide; if you keep it, say why in one line in the hand-over.

`.cve/verify-report.json` has the details; quote problems with their time ("blank at 6.2–7.0 s").

## 2. Fresh critic

Whoever built the video does not grade it. Start a sub-agent whenever your tool can. Give it **only**:
- `.cve/frames/*.png` (one per shot, named by time) and `.cve/contact-sheet.png`;
- `BRIEF.md` (what the video is for and who it is for);
- the person's `Not liked` and `Never` lines from `taste/NOTEBOOK.md`;
- for a speech-led video, the words spoken at each frame's time.

Not the code, not your reasoning, not `STYLE.md` rules. Ask it to:
1. Describe each frame in one line **as a stranger would**: what do I see, what does it tell me? A frame it cannot explain is a finding.
2. List problems ranked **P0** (a viewer would notice and it hurts: unreadable or cut-off text, collisions, an empty or muddy frame, the picture not matching the words, something the person said they dislike, a generic default that could be in anyone's video), **P1** (weakens it), **P2** (polish). Each tied to a frame time.
3. Answer: would a stranger stop scrolling at frame 0? Would the person post this?

Fix every P0, then run the critic again on the new frames (a new sub-agent, not the same one). P1 and P2: fix what you can; list the rest in the hand-over. If you cannot start a sub-agent, do the review yourself from the frames alone and say so.

## 3. Hand-over

Show the person the video, one line per measurement layer, the `MOMENTS` from verify (where to watch and listen), what the critic found and what you changed, and ask: would you post it as it is; if not, the one thing to change; what did you like. Their answers go to `learn`.

You cannot judge taste the way they can; never claim it "looks great".
