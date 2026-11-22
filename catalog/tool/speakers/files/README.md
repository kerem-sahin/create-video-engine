# speakers: who speaks when

One recording, two or more people, one track. Local, free, no account, no token.

```
node parts/speakers/speakers.mjs --install        # once: private venv + sherpa-onnx + 2 models (~120 MB total), no root
node parts/speakers/speakers.mjs --audio episode.m4a --words episode.words.json --speakers 2 --out speakers.json
```

- `--audio` any file ffmpeg reads; `--words` the transcribe-local word file (optional); `--speakers N` how many people (recommended; automatic mode is unreliable) (2 or more; leave out for automatic: clustering threshold 0.85, which gave exactly 2 speakers on the noisy test podcast where the sherpa default 0.5 gave 49; give N when you know it: on the clean synthetic clips 0.85 merged two voices into one).
- Output: `speakers` (A, B... in order of first speech), `turns` (`start`, `end`, `speaker`), `words` (each word gets the speaker whose turn covers its midpoint; `null` when it lies in a pause more than 1 s from any turn), `summary` (talk time per speaker, turns, speaker changes).
- Names: the person says "A is Kerem"; rename in your own step, the file only knows A/B.

## Where things go

Everything lives in `~/.cache/create-video-engine/speakers/` (override with `CVE_SPEAKERS_HOME`): `venv/` (python, sherpa-onnx, numpy) and `models/`. Downloads come only from the official sherpa-onnx GitHub releases and pip's sherpa-onnx wheel; models are checked against pinned sha-256 sums and the install stops on a mismatch. Delete the folder to remove everything.

## Honest limits

- Speed: about 1/7 of the audio length on an 8 GB M1 (28 min in ~4 min).
- Two similar voices on one phone mic in noise is the hard case; handovers can be off by a second, and short interjections ("evet", "hmm") are often missed or given to the wrong person. A person must listen to a few handovers before the labels are trusted; there is no way to prove accuracy from the file alone.
- Overlapping speech is not split into two labels beyond what the segmentation model does.
- Licences: sherpa-onnx Apache-2.0, pyannote-segmentation-3.0 MIT (the ONNX copy sherpa-onnx publishes needs no login), 3D-Speaker CAM++ Apache-2.0.
