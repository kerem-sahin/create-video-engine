# moments

Clip candidates and chapter boundaries for a long chat podcast. Needs the word JSON from `transcribe-local`; `speakers.json` is optional.

```
node parts/moments/moments.mjs --audio ep.m4a --words ep.words.json [--speakers ep.speakers.json] [--out dir] [--top 8] [--no-audio]
```

`speakers.json` is `{ "turns": [ { "start": 12.0, "end": 14.5, "speaker": "A" } ] }`. Output in `--out` (default next to the words file): `moments.json` (`clips`, `chapters`, `laughter.bursts`, `weights`, `signals_available`) and `moments.md` for the person. Exit 0 ok, 2 cannot run (bad file, no ffmpeg), 64 usage.

## What it measures

| Signal | From | How |
|---|---|---|
| laughter | audio | ffmpeg decodes to 16 kHz mono; a burst is 4+ loud energy pulses 0.10-0.32 s apart (even spacing, CV <= 0.30), valleys at least 9 dB under the peaks, 14 dB over the file's noise floor, with a noisy spectrum (flatness >= 0.04). |
| laughter | transcript | words such as `(gülüşmeler)`, `haha`, `ahaha`, `hehe`; one within 2.5 s of an audio burst counts as the same event. |
| turns | speakers.json | speaker changes under 1.5 s apart per 10 s of clip (4 per 10 s = full marks). Absent: weight is dropped, not guessed. |
| energy | audio | mean and peak loudness of the clip against the episode average. Loudness only; pitch is not measured. |
| text | transcript | a short reaction line (`yok artık`, `ne diyosun`, `olum`, `kanka`, `ciddi misin`, ...) after a setup; a question answered within 2 s; the hook. |

Clip score = 100 x weighted mean (laughter .35, text .35, turns .15, energy .15) minus penalties (needs earlier context -12, starts mid-sentence -15, each silence over 2.5 s -10, unsure word in the first 3 s -8, clip ends inside a laugh -10, opens on a laugh -6). Windows are 15-45 s and start and end on sentence boundaries (a full stop, or a pause over 0.9 s: whisper.cpp output often has no punctuation at all, as on the test episode). Overlapping candidates are dropped. `hook` is `yes` when the first sentence has 3+ words, does not open with a connective or pronoun that needs the line before ("ve", "ama", "bu", "o", "yani", ...), is not a bare reaction, has no unsure word in the first 3 s and lands inside 9 s.

Chapters: tf-idf word vectors of the 75 s before and after every sentence start (words grouped by 5-letter stem for Turkish suffixes); boundary strength = vocabulary shift + 0.1/0.2 for a pause over 1.2/2.5 s + 0.15 for a cue ("neyse", "konu şu", "geçelim", "geçiyorum", ...). Strongest first, at least half the average chapter length apart (never under 60 s), about one per 4 minutes (3 to 10), first at 0:00. `title_hint` and `keywords` are the chapter's most distinctive words, not titles: the agent writes the final titles after reading the chapter.

## How good is it (measured)

Synthetic audio made with ffmpeg (`tests/moments.test.mjs`): speech-like harmonic tones with a drifting 3-5.5 Hz syllable envelope vs laughter-like decaying 5-7 Hz noisy pulse trains, some laughs overlapped by speech, some quiet (35% and 60% level) over 0.012 background noise, plus evenly rhythmic "speech" and a deliberately hard negative (5 Hz, 8% floor). Thresholds were set on set A; set B has other pitches, rates, gains and noise and is the number to quote.

- Set B (held out, 6 laughs, 4 bursts reported): precision 4/4 = 1.00, recall 4/6 = 0.67. Both misses were quiet laughs (35% level) under overlapping speech.
- Set A (tuned): 6/6 and 6/6. No false bursts on rhythmic or hard negatives.

This is synthetic: it shows the detector separates pulse trains from syllable trains in clean conditions, not that it finds real laughs on a phone mic. On the 28-minute test episode there is no ground truth (the transcript contains no laugh tokens), so real precision is unmeasured; the bursts are listed with times in `moments.json` for the person to spot-check. The score is a ranking aid, not a prediction that a clip will perform.

Run time: the 28-minute episode takes about 6 s (decode, framing, FFT, scoring).
