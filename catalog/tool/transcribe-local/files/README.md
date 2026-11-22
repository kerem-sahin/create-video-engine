# transcribe-local

Recording in, word-timed JSON out, on this machine, free. Two files: `normalize.mjs` first, then `transcribe.mjs`.

## normalize (do this first, always for anything over a minute)

```
node parts/transcribe-local/normalize.mjs raw.mov --out work.mp4 [--fps 30] [--max-side 1920 | --keep-size] [--no-hwaccel]
```

A phone writes variable-frame-rate video (timestamps jitter, frames are skipped, the average rate is e.g. 29.67 fps) with the rotation as a flag. Cutting such a file by time drifts the picture against the sound (0.2 s in a 64 s clip). `normalize` makes one working copy with a fixed frame grid: constant 30 fps (or `--fps`, fractions like `30000/1001` stay exact), rotation baked in, long side at most 1920, audio 48 kHz starting at 0 and as long as the picture, H.264 with a keyframe every second. **Transcribe, cut and assemble this copy, never the raw file**: then every time (words, cuts, captions, cards, chapters) is on one clock.

It measures its own result and exits 1 if it is not steady: constant frame step, no rotation flag left, picture and sound within one frame, frame count = duration x fps. The numbers (including the source's own frame-step jitter, so "it was VFR" is a measurement) go to `work.mp4.normalize.json` and the screen. HDR (HLG/PQ) sources are converted to 8-bit BT.709 without tone mapping (no zscale in this ffmpeg): colours come out a little flat, the report says `hdr: true`, look at one frame. Speed: decoding on the Mac's media engine, x264 `superfast`; a 64 s HEVC phone clip took 24 s on an 8 GB M1 (a 30 minute clip: roughly 10 minutes).

### audio-only input (a podcast m4a)

No video stream: `normalize` does not invent a picture. It writes an audio working file: `--out work.m4a` (AAC 192k, the default), `--out work.wav` (16-bit PCM), or `--out work.mp4`/`.mov` (audio-only MP4, no video track; it says "no picture"). 48 kHz, channels kept (mono stays mono), first sample at 0 (a late-starting track is padded with silence). `work.m4a.normalize.json` has `mode: "audio"` and the measured duration, sample rate, channels, start time, integrated loudness (LUFS) and peak; `problems` lists anything that missed (duration within 50 ms of the source, start at 0, 48 kHz, same channel count, no video track), and the exit code is then 1. Loudness is only measured, never changed here. Then `transcribe.mjs work.m4a`, `silence-cut` (cuts on the sample grid, out `.m4a`/`.wav`/`.mp4`) and `assemble-long assemble --audio cut.m4a` take that file as it is.

## transcribe

```
node parts/transcribe-local/transcribe.mjs work.mp4 --language tr --out work.words.json
```

Output: `{ "schema":1, "language":"tr", "engine":"whisper:small", "aligned":true, "duration":49.06, "words":[{"w":"Merhaba","start":0.01,"end":0.72}, ...] }`. `w` keeps Whisper's punctuation (`arkadaşlar,`) so later steps can find sentence ends.

- Engine: the studio's pinned `hyperframes transcribe --engine whisper` (whisper.cpp). `--language` is required: whisper translates to English if it guesses wrong. Models: `small` (default for any language other than English; Turkish works), `small.en` (English default), `medium` or `large-v3` for speech over music or a hard accent, slower.
- First run downloads the whisper runtime and the model (small is about 470 MB): several minutes once, then cached in `~/.cache/hyperframes/whisper`. Speed afterwards on an M1: about 1/5 of the audio length with `small`.
- `--hf <path>` or `$HYPERFRAMES_BIN` if the binary is not in `node_modules/.bin` above the current folder.
- Whisper times words loosely around pauses (it stretches a word over a pause, or places a word inside one). Unless `--no-align` is given, words timed in a silence ffmpeg can hear are moved to the next stretch of sound, and words in a silent tail are dropped. Exact to a few tenths of a second, not forced alignment: captions look right, but do not use these times to cut inside a word.
- `--model` goes straight to whisper (`small` default, `small.en` for English, `medium` or `large-v3` when `small` mishears).
- Words that may be wrong are marked `"unsure": true` in the output and printed as a list (time, word, why, the words around it). The engine's probability is used when `hyperframes transcribe` passes one on (`--unsure-below`, default 0.5); otherwise a heuristic marks digits mixed with letters, 3+ letters with no vowel, a letter repeated 3 times, and a capitalised word in mid-sentence (names, which whisper often misspells). It is a heuristic, not a guarantee. The agent asks the person about every marked word; `silence-cut` keeps the mark through the cut.
- No paid API. If the person later wants a paid engine, it would be a separate part with this one as its free fallback.
- Not installed here: whisper-cli (brew install whisper-cpp). Not needed; HyperFrames brings its own build.
