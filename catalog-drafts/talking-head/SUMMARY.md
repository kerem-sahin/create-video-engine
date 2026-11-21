# Talking-head / footage editing: harvest summary (2026-11-19, HyperFrames 0.9.67)

| Repo | Licence (from file) | Stars | Last push | Parts found | Decision |
|---|---|---|---|---|---|
| nateherkai/herk-edit-kit | MIT + "Use Permission" for pipeline files (keep notice); AIS brand assets not licensed | 2963 | 2026-10-14 | 12 | 9 install, 1 idea, 2 skip |
| kajisho5/ffmpeg-skill | MIT | 8128 | 2026-11-19 | 6 | 5 install, 1 skip |
| digitalsamba/claude-code-video-toolkit | MIT | 2660 | 2026-11-17 | 6 | 3 install, 2 idea, 1 skip |
| veedstudio/open-edit | Apache-2.0 (+NOTICE) | 1838 | 2026-11-11 | 7 | 3 install, 3 idea, 1 skip (paid VEED) |
| talsiach/take-one | MIT (anidoodle files Apache-2.0) | 375 | 2026-11-09 | 4 | 1 install (SFX), 1 idea, 2 skip |
| tuzhechen2005/opus-video-skills | MIT (+Heibel MIT) | 538 | 2026-11-16 | 1 | skip (generative, no footage) |
| JuneYaooo/rea-video | Apache-2.0 | 10877 | 2026-11-19 | 1 | skip (analysis tool) |
| yusufferdogan/Personal-Brand-Video-Skill | none: no LICENSE file | 0 | 2026-01-25 | 1 | link-only (Remotion, unlicensed) |

38 cards are in this folder.

## Minimum set for a "YouTube talking-head" person

| Need | Part | Exists upstream? |
|---|---|---|
| Local transcript with word times | transcribe-captions-ffmpeg (ffmpeg-skill) | Yes (whisper.cpp / faster-whisper / parakeet). We still write a thin wrapper that outputs the word JSON the other parts read. |
| Cut silence | silence-cut-ffmpeg; cut-silences-transcript (herk, writes EDL and retimed transcript) | Yes |
| Cut mistakes and fillers | cut-mistakes-review (herk); filler words in silence.py | Yes |
| Approve the cuts | edl-review-page (herk) | Yes |
| Captions as HyperFrames HTML | caption-cue-shaping-js (open-edit) | Partly: needs an adapter to the GSAP timeline. Caption styles (karaoke, pop) as HyperFrames HTML we must write. |
| Cards and lower-thirds over footage | kallaway-overlay-cards, left-glass-popout-template, video-beats-planner (herk) | Yes, after replacing AIS tokens and localising GSAP. 9:16 variants: write. |
| B-roll | broll-cutaway-ffmpeg | Yes (plain cutaway only; animated B-roll layers we write) |
| Overlay sync check | beat-sync-validator (herk) | Yes |
| Shorts from a long video | highlights-from-transcript, reframe-vertical-ffmpeg, cutdown-reframe-toolkit, platform-safe-zones | Yes |
| Loudness and delivery check | loudness-and-delivery-check-ffmpeg | Yes |
| Titles, description, chapters | copy-lint-titles (yes); chapters and SRT (publish-kit, idea): write | Half |
| Whole-flow recipe | edit-video-pipeline, short-form-edit-recipe (herk) | Yes |

## What we would have to write
- Local-whisper transcription wrapper that normalises to word JSON.
- Caption style set as HyperFrames HTML (karaoke, pop, bold) with safe zone.
- 9:16 versions of the overlay cards.
- Render QC for HyperFrames output (dead picture, empty first frame, black gaps).
- YouTube chapters and SRT from our scenes.
- Face-aware caption row (simple version).

## Notes
- herk-edit-kit is the only repo built on HyperFrames and is the strongest source. Its default transcription (ElevenLabs) is paid, so those parts are marked and a local path is needed.
- Paid or login-gated: ElevenLabs Scribe (herk), VEED hosted services (open-edit), Kie.ai (herk, optional B-roll).
- Nothing was run or installed from these repos; Personal-Brand-Video-Skill must not be copied.
