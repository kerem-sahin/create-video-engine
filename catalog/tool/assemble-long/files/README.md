# assemble-long

The final video for a long recording (10-30 minutes), built by ffmpeg. Chrome draws only what needs a browser, once.

```
# 0. once per recording, in this order (every later time is on one clock)
node parts/transcribe-local/normalize.mjs raw.mov --out work.mp4
node parts/transcribe-local/transcribe.mjs work.mp4 --language tr --out work.words.json
node parts/silence-cut/silence-cut.mjs plan --video work.mp4 --words work.words.json --out edl.json   # read edl.md, then:
node parts/silence-cut/silence-cut.mjs apply --edl edl.json --out cut.mp4                              # -> cut.words.json

# 1. the agent writes cards.json and chapters.json (below), then
node parts/assemble-long/assemble-long.mjs assemble --video cut.mp4 --words cut.words.json \
     --frame brands/<brand>/taste/STYLE.md --out final.mp4 --cards cards.json --chapters chapters.json
```

Outputs: `final.mp4` (H.264 + AAC, faststart, ready for YouTube), `final.srt` (sentence-level), `chapters.txt` (YouTube format, next to the MP4), `final.mp4.assemble.json` (every measurement). The time of each stage is printed.

## What it does

- **Captions** (`--captions pop|clean|none`, default pop; `--accent` for the spoken word in `clean`). Same grouping, colours, fonts, chip and safe zones as the `captions` part, read from `frame.md` (`--fonts "Family=file.ttf"` loads a font file). Each caption *state* (a group with the spoken word in the accent colour) is drawn once, as a transparent still, by one small HyperFrames render (one frame per state, about one per word); ffmpeg shows each still for its time span, on the video's frame grid. Difference from the scene part: no fade/pop animation; the spoken word is accent-coloured and (pop) slightly enlarged, statically.
- **`--band bottom|top|y=<px>`**: where the block sits. `bottom` (default) keeps it above the platform/safe zone (16:9: 130 px from the bottom; 9:16: 700 px); `top`: 100 px (16:9) / 280 px (9:16) from the top; `y=<px>`: the block's bottom edge at that y. Aspect comes from the video (`--aspect` overrides); other sizes are scaled and cropped to 1920x1080 or 1080x1920.
- **Cards** (`--cards cards.json`): `[{ "kind": "lower-third|takeaway|stat|quote|keyword", "text": "...", "detail": "...", "start": 12.5, "duration": 4, "face-x": 0.6 }]`; times in the cut video's clock; every other field goes to `build-card.mjs` (`side`, `pos`, `bottom`, `top`, `signature`, `glass`). All cards are rendered in ONE HyperFrames render on a transparent ground (`--format webm`, VP9 with alpha) and overlaid by ffmpeg in their windows. No splice is needed because HyperFrames does write alpha.
- **Audio**: -16 LUFS (`--lufs`), true peak at most -1 dBTP. A gain moves the measured loudness to the target, a limiter holds the peaks (a quiet phone recording needs about +15 dB; ffmpeg's `loudnorm` could not do that within a peak ceiling and produced +1.3 dBTP on a 4.7 min test). The audio is made in a short audio-only pass, measured, corrected (gain by the loudness error, limiter by the peak overshoot; at most 3 passes), and only then muxed untouched into the video pass. The finished MP4 is measured again; outside +-1 LU or above -1 dBTP the command exits 1.
- **Chapters**: `chapters.json` is `[{ "start": 0, "title": "Intro" }, ...]` in the final video's clock. YouTube's rules are checked *before* anything renders: first chapter at 0:00, at least 3 chapters, each at least 10 s (the last one too), strictly increasing, titles non-empty. `assemble-long.mjs chapters --chapters c.json --duration 612.4 [--out chapters.txt]` validates and formats on its own; `srt --words w.json --out x.srt` makes the SRT on its own.
- **Measured, not claimed**: input frame count equals output frame count, picture and sound end within one frame, duration equals the input's, loudness and true peak of the file. A failed check exits 1 (the file is still written, the report says what failed). A non-constant-frame-rate input prints a warning (run `normalize` first).
- `--encoder videotoolbox` uses the Mac's media engine for the encode (about 3x faster, not bit-for-bit repeatable); default is x264 (`--preset veryfast`, `--crf 18`). `--keep-work` / `--work <dir>` keep the intermediate stills and cards.

## ffmpeg's ass/subtitles filter

Not used: it needs libass and the ffmpeg built by Homebrew on this Mac has none (no `ass`, `subtitles` or `drawtext` filter). The report says `libass_available`. Captions are stills instead. An ASS path for ffmpeg builds that have libass is not written.

## Check the result

`node bin/cli.mjs verify <any folder> --mp4 final.mp4 --no-composition --expect-duration <seconds> --expect-audio`: skips the HyperFrames composition check and reads the expected duration from the flag. Without `--expect-duration` / `--expect-audio` those two required checks are reported as skipped (exit 2), never as passed.

Needs: ffmpeg with libvpx (decodes the card WebM) and libx264, the studio's `hyperframes`, and the `captions` and `overlay-cards` parts (their `frame-vars.mjs` and `build-card.mjs` are called; `--parts <dir>` says where they are).

## Slice (a clip out of the cut episode)

```
node parts/assemble-long/assemble-long.mjs slice --audio cut.m4a --from 412.3 --to 455 --out-dir brands/<show>/videos/<clip>/assets \
     [--words words.json] [--turns speakers.json] [--scenes scenes.json] [--snap 4]
```

Writes `clip.m4a` (cut on the sample inside the filter graph, 20/30 ms fades), and `words.json`, `speakers.json`, `scenes.json` moved to the clip's clock. The edges never split a word; with a punctuated transcript they move to the nearest sentence start and full stop within `--snap` seconds (0 = off), plus a little breathing room that never reaches the next word. Turns and blocks are clipped to the window; a block with under 1 s left is dropped. `slice.json` lists what moved. Measured, exit 1 on failure: the clip's length, words inside it, and that it is not silent.
