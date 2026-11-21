# captions

```
node parts/captions/frame-vars.mjs frame.md --out assets/brand.css            # once per project; link it in index.html
node parts/captions/build-captions.mjs --words cut.words.json --style pop --aspect 16:9 --out compositions/captions.html
```

`<link rel="stylesheet" href="assets/brand.css">` in `index.html`, then mount the file (the command prints the exact line): a host with `data-composition-src="compositions/captions.html"`, `data-track-kind="captions"`, the video's length as `data-duration`.

- Styles: `clean` (sentence lines on a chip of `--c-ground`, up to 9 words landscape / 6 portrait, two lines; `--accent` turns the spoken word `--c-accent`, colour only) and `pop` (2-4 words, the spoken word turns `--c-accent` and grows up to 12 %, less on long words so it never swallows the gap; `--no-scrim` removes the chip behind the text).
- Chip: `--chip-opacity` (default 0.92) of `--c-ground`; line-height 1.5 (clean) / 1.45 (pop), so two-line chips do not touch. Words are inline-blocks with an explicit `margin-right`; no space characters are relied on (a long word that is scaled used to cover its neighbours' spaces: "Merhabaarkadaşlar").
- Variables, all with fallbacks: `--c-ink --c-ground --c-accent`, `--f-display --w-display --t-display`, `--f-body --w-body`. `frame-vars.mjs` writes them from `frame.md` (colours, typography, `spacing.safe`). A font HyperFrames does not bundle needs an `@font-face` to a file in `assets/fonts/`; check Turkish glyphs (ç ğ ı ö ş ü İ).
- Placement: 16:9 text bottom 130 px from the frame bottom, 1536 px wide (the 80 % title-safe box); 9:16 text bottom 700 px from the bottom, 800 px wide, inside the platform band (`--bottom` to move it). Keep the face clear.
- Groups break at a sentence end, a pause (0.15 s pop, 0.4 s clean) or the word limit; the first group never opens before 0.1 s; every group ends with a fade and a hard kill.
- Expected `check` warnings on long videos: `composition_file_too_large`, `timeline_track_too_dense`. They are about file size; split the captions by chapter into several files if they bother you.
- The HTML is generated once and then yours: edit a word, a time or a colour in the file; rebuild only to start over.
