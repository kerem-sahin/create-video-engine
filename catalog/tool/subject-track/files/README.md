# subject-track

Where is the speaker, frame by frame. No model, no Python; ffmpeg and Node only.

```
node parts/subject-track/subject-track.mjs --video talk.mp4 --out track.json [--start 0 --end 20] [--fps 10]
node parts/shorts-from-long/shorts.mjs cut --video talk.mp4 --words talk.words.json --start 12 --end 41 --track track.json --out short-1.mp4
```

Run it over the whole video once; every Short cut from it reuses the track (`t` is source time). A 64 s phone clip takes about 15 s on an idle machine.

- `track.json`: `{fps, start, duration, width, height, aspect, frames:[{t, cx, head_top, head_bottom, confidence, source}]}`. `cx`, `head_top`, `head_bottom` are fractions (0..1) of the display width/height. `source`: `blob+skin`, `blob`, `skin`, `hold` (last good value kept), `centre`.
- The head is the face region (skin tone, compact shape) inside the person blob; without skin it is the top 30 % of the blob. The chin is estimated where the face narrows to the neck, so it can be wrong when hands touch the face.
- Options: `--thresh 20` (foreground difference, raise in noisy footage), `--bg-window 8` (seconds of the sliding median), `--deadband 0.025`, `--smooth-time 0.35`, `--max-pan 0.25` (fraction of the width per second), `--hold 3` (seconds a lost speaker keeps the last position before easing to the centre), `--min-conf 0.45`.
- It prints how many frames had a detection and exits 1 when none did (the track is then the centre line: use `--face-x`). Under 50 % it warns. Look at the Short before trusting it.
- Limits: a speaker who never moves is partly absorbed into the background median (the skin witness still sees the face); a moving handheld camera smears the background; a hand over the lens loses the face.
- `shorts.mjs cut --track` also writes `<short>.safe-text.json` and prints `--band y=<px>`: pass it to captions and cards so text stays off the face. When the speaker fills the frame there is no clear band and it says so.
