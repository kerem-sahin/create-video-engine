# silence-cut

Pauses and filler words out, in two steps so the person can look first.

```
node parts/silence-cut/silence-cut.mjs plan  --video talk.mp4 --words talk.words.json --out edl.json
# read edl.md (every cut with the words around it); set "approved": false in edl.json on any cut to keep
node parts/silence-cut/silence-cut.mjs apply --edl edl.json --out cut.mp4 [--words-out cut.words.json]
# prints `words-out: <path>`; without --words-out the retimed words go to <out without extension>.words.json (cut.mp4 -> cut.words.json)
```

`plan` options: `--mode tight|normal` (tight, the default: pauses of 0.5 s or more are cut down to 0.25 s; normal: pauses of 0.8 s or more down to 0.4 s), `--keep-pause 0.25` (how much of each shortened pause stays; a pause is shortened, never removed), `--min-pause 0.5` (silences at least this long are shortened), `--pad 0.12` (audio kept each side of speech; 0.10-0.15 sounds natural), `--noise -35dB` (raise to -30dB for a noisy room), `--fillers auto|tr|en|tr,en|none` (auto follows the word file's language), `--sey` (also cut Turkish "şey", a real word, so off by default), `--extra-fillers a,b`, `--word-gaps` (also trust word gaps of 1 s or more where ffmpeg heard no silence), `--no-silence-check`.

- Pauses come from the audio (ffmpeg `silencedetect`), fillers from the words. The EDL lists each cut as `{start,end,kind,text,context,approved}`; kinds: `leading`, `trailing`, `pause`, `filler`.
- `apply` cuts frame-accurately (boundaries snapped to the frame grid, 6 ms audio fades at each join, H.264 CRF 18, `--preset superfast` by default (about 1.7x faster than veryfast on a long file), a keyframe every second), and writes the retimed words (`--words-out`, default `<out>.words.json`; the path is printed): the same word JSON with times on the new timeline. Use that file, and `cut.mp4`, for everything after this step.
- Run it on the `normalize`d copy (parts/transcribe-local/normalize.mjs), the same file that was transcribed. On a variable-frame-rate file `plan` and `apply` print a warning: cuts by time drift against the sound by a few frames. The output frame rate is the input's exact nominal rate (a fraction such as 30000/1001 is kept), and on a constant-rate input the output length matches the plan to the frame, so the duration check never trips.
- A word whisper gave no length (start = end) is not dropped: it gets 0.08 s. Words are dropped only when they lie inside a cut, or inside a silence of 0.6 s or more (listed in the EDL as `dropped_words`, likely hallucinations).
- Dead air that is not digital silence (room noise louder than the threshold) is not cut unless `--noise` is raised or `--word-gaps` is on.
- An EDL belongs to one video: `apply` refuses a video whose length differs from the plan.
- `apply` uses the words embedded in the EDL. Edited the words file after `plan` (a corrected word)? Pass `--words <file>`: that file is retimed instead, and a warning says if it differs from the embedded copy. Without `--words`, apply says that edits made after plan are ignored. Words marked `"unsure": true` keep the mark.

- Audio-only input (a podcast m4a/wav, no video stream) works: `apply` cuts on the sample grid instead of the frame grid, writes `--out cut.m4a` (AAC 192k), `cut.wav` (PCM) or an audio-only `.mp4`, and retimes the words the same way. The EDL has `fps: null`. The length check allows 30 ms for AAC encoder padding (2 samples for WAV).
