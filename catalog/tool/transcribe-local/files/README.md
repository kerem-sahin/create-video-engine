# transcribe-local

Recording in, word-timed JSON out, on this machine, free.

```
node parts/transcribe-local/transcribe.mjs talk.mp4 --language tr --out talk.words.json
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
