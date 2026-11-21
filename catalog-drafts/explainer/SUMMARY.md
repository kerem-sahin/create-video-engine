# Explainer / motion graphics: harvest summary (2026-11-19, HyperFrames 0.9.67)

48 draft cards in this folder. Licences read from the LICENSE files. Four repos show NOASSERTION or a guess in the API but the file is plain MIT (extra font/icon notes only).

| Repo | Licence (verified) | Stars | Last push | Parts | Decision |
|---|---|---|---|---|---|
| heygen-com/hyperframes (registry) | Apache-2.0 (a few items MIT / OFL-1.1) | 86.8k | 11-19 | 14 | install (13), idea (1) |
| heygen-com/hyperframes-community-skills | Apache-2.0 | 282 | 11-17 | 6 | install (5), skip (1) |
| Cele-san/vox-style-animation | MIT | 5 | 07-14 | 5 | install (3), idea (2) |
| Barty-Bart/motion-graphics | MIT; sfx CC0; Geist OFL | 1.4k | 10-13 | 5 | install (1), idea (2), skip (2) |
| echris6/motion-video-kit | MIT | 1.4k | 10-14 | 5 | install (3), idea (2) |
| AbubakrChan/product-launch-motion | MIT (NOTICE excludes sample films and logos) | 501 | 10-21 | 4 | install (1), idea (2), link-only (1) |
| tugrawork-creator/saas-motion-kit | MIT; fonts OFL | 276 | 10-04 | 6 | install (4), idea (1), skip (1) |
| howseen-ai/claude-motion-design | MIT | 856 | 10-04 | 3 | idea (1), skip (2) |

The registry list worked over the network: 210 blocks, 238 components. Installed with `hyperframes add <name>`. Map blocks fetch d3 and map data from jsDelivr at render time. Only the Vox starter and the saas-motion-kit example were linted (0 errors); seam-gate.mjs pins HyperFrames 0.8.14 and was not run.

## Registry blocks to offer, by lane
- **Explainer:** bar-chart-race, data-chart, chart-story, flowchart (+vertical), world-map / us-map family / spain-map, count-up, number-wheel, vox-annotate, marker-highlight, hw-arrow / hw-callout-circle / hw-underline, whiteboard-ink, kinetic-center-build, headline-slam, per-word-rise, push-in, pull-back-reveal, match-cut family, transitions-*.
- **Product-launch:** the stat kit (mk-*, week-in-merges), camera moves, code-* blocks, UI mock blocks (other agent).
- **Social:** kinetic type, caption-* styles, hw-title (talking-head agent).
- **Tutorial:** hw annotation kit, cursor-* components, flowchart.

## Minimum set for an explainer person
Exists:
1. Charts and diagrams: hf-bar-chart-race, hf-chart-story, hf-flowchart, hf-map-blocks, hf-count-up-number.
2. Type and annotation: hf-kinetic-type, hf-annotation-kit.
3. Motion between scenes: hf-camera-moves, hf-transitions-matchcuts, hfc-velocity-matched-transitions.
4. Workflow and look: hfc-vox-explainer, vox-paper-collage-style.
5. Sound: bart-cc0-sfx-library (CC0, 136 files), launch-v1-master-and-verify, echris6-backtime-music.
6. Checks: echris6-gauntlet-critics, echris6-measure-scripts, hfc-seam-gate (after version bump), tugra-variety-audit, tugra-transition-atlas.

We would write ourselves:
- A Turkey map block (none exists) and a vendored map-data option so renders work offline.
- A timeline / process-steps scene and a simple comparison-table scene (nothing in the registry).
- A voiceover-to-scene timing step using `hyperframes transcribe` and `tts`.
- A short sound note replacing bart-sound-pass: licence check plus measure the exported MP4.
- Our own spring/carry helper stays; no repo had a better one (hfc velocity rules add the overlap rule).

Skipped: howseen remake mode (copies other films), niche community templates (session-story and day-in-my-life read local Claude history), fal and OpenAI image scripts (paid).
