# draw-from-photo

A thing that is named in the video (a Porsche 911, the Galata Tower, a Fender Stratocaster) has to look like that thing. Drawn from memory in a few strokes it becomes "a car". This part draws it from a real photo, in the brand's ink.

```
node parts/draw-from-photo/draw-from-photo.mjs find "Porsche 911 side view" --out <dir>/assets/refs/porsche
```
Writes up to 6 previews (`1.jpg` …) and `candidates.json`. Only photos that may be reused: CC0, public domain, CC BY. **Look at them** and pick the one with the whole thing, from the side you need, on a plain background, with no people (a face or a number plate must not end up in the drawing). None fits: other words (the model, "side view", "profile"), the person's own photo, or draw it by hand.

```
node parts/draw-from-photo/draw-from-photo.mjs ink <dir>/assets/refs/porsche/candidates.json --pick 2 \
  --out <dir>/assets/porsche.png --width 1000 --flip --ink "#0a0c0a" --paper "#f9f9f9" \
  --credits <dir>/CREDITS.md --library brands/<brand>/library --name porsche-911 --what "Porsche 911, side, facing right"
```
- `--width`: the width it will have on screen (lines are drawn at that size).
- `--detail low|mid|high`: low for small or busy photos, high for big close-ups. Default mid.
- `--flip`: mirror it so it faces where it moves.
- `--ink` / `--paper`: the brand's colours (`STYLE.md`).
- The person's own photo: give its path instead of `candidates.json` (no credit line).
- `--credits`: required for a photo from `find`; the credit line goes there.
- `--library`: keeps it in the brand's drawing library (`library.json`, `approved: false` until the person approves it, with its credit). Next time look there first, and copy its `credit` into the new video's `CREDITS.md`. An approved drawing is not replaced unless you add `--replace` after the person agreed.

**Look at the drawing before using it.** It is only as good as the photo. Throw it away and pick another photo when a part is missing (black wheels on a dark floor vanish), the body is covered in blotches (reflections, a saturated colour), or it carries text, numbers, logos or stickers. Never "fix" a missing part by drawing it in on top.

**One hand.** A drawing from a photo is more detailed than quick doodles. Put it next to the characters and the other drawings: same line weight, same amount of detail. If it stands out, use `--detail low`, or redraw the others with more care; never leave one object looking traced and the rest scribbled.

macOS 14+ only for `ink`. Elsewhere: open the photo, and draw the thing by hand in SVG with its real proportions (wheelbase, roof line, the one shape everyone knows it by).
