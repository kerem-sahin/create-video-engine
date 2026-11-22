# Harvest — every researched idea and what happened to it

*Started 19 November 2026 (requirement G6). Answers "did we take it?" for every idea found while researching other video repos. A new idea is added here first, before any code.*

Status: **taken** (in the system and tested) · **building** (stage 1 work in progress) · **planned** (later stage, with requirement ID) · **link-only** (licence forbids copying; idea reimplemented or just linked) · **rejected** (with reason).

Rule for all rows: from MIT/Apache repos we take ideas and write our own code unless a row says "copied" (none do so far). From non-commercial repos (onetake PolyForm NC, lemo-opuscar style texts CC BY-NC) nothing is copied, not code and not text.

| # | Idea | Source | Licence | Status | Where in our system | Req |
|---|---|---|---|---|---|---|
| 1 | Music composed with the edit: BPM first, cuts on beats, chord progression, in-key cue sounds, one reverb | brag-slim `audio.py` | MIT | taken | `music --score`, make skill "Sound" | D2, D3, C7 |
| 2 | Brand instrument palette | brag-slim (one instrument per video) | MIT | taken | `STYLE.md` `sound.palette`; scorer palettes | D4 |
| 3 | Poster frame baked into frame 0 (platform thumbnail is a designed still) | brag | MIT | taken | verify `poster` check + make skill rule | C12 |
| 4 | Measure that cuts really land on beats | follows from 1 | — | taken | verify `on-beat` check | C7 |
| 5 | Don't repeat the theme/structure of the last videos | saas-motion-kit (last 5 videos) | MIT | taken | `ledger.json` + verify `variety` check | C8, F6 |
| 6 | Spring motion and settle instead of linear eases | product-launch-motion | MIT | taken | motion helper copied into each video project | C9 |
| 7 | Continuity: one element carries across a cut, so scenes aren't separate slides | onetake | PolyForm NC | taken (idea only, own code) | motion helper `carry()` + make skill rule | C10 |
| 8 | Continuity checks can pass a slideshow (onetake issue #6) — measure stillness, not just identical frames | onetake issue | — | taken | verify `stillness` (motion energy) | C11, E7 |
| 9 | Every number on screen must appear in the brief | open-edit | MIT | taken | verify `numbers` check | C13, E9 |
| 10 | Give the human 5 exact moments to watch/listen to | Barty-Bart | MIT | taken | verify output `MOMENTS` list | E10 |
| 11 | Fresh-eyes critic that sees only frames + brief + style ("Gauntlet") | motion-video-kit | MIT | taken (per-shot frames added) | verify skill step 2; per-shot frames | E6 |
| 12 | Text reading time (chars/15 + 1.5 s) | open-edit, motion-video-kit | MIT | planned | verify | E8 |
| 13 | Loudness target in LUFS | lemo-opuscar, motion-video-kit | MIT code | taken (short-term cap added) | verify `loudness` | D6 |
| 14 | Inventory before questions (read the repo/site before asking) | herk-edit-kit | MIT | taken | setup skill §1 | B1 |
| 15 | UI colour sampling from screenshots | claude-motion-design | MIT | taken | setup skill | B3 |
| 16 | Style kept and switchable per brand | lemo-opuscar | MIT code / CC BY-NC texts | link-only (idea is common; no texts copied) | `brands/<b>/taste/STYLE.md` | B, F |
| 17 | Learning taste from feedback | none found — our own | — | taken | learn skill | F1–F5 |
| 18 | Crop store screenshots to the real UI | own need (SweetSpot test) | — | taken | `crop` command | B7 |
| 19 | Parts catalog: vetted pieces the person copies and owns (shadcn model) | shadcn/ui pattern; HyperFrames registry | MIT / Apache | taken (card format + validator); planned (selection, stage 3) | `catalog/` | G1–G5, B11 |
| 20 | Brand-owned templates (approved scenes become variable blocks) to cut tokens | own idea; HyperFrames `--variables` | Apache | planned | stage 3+ | H2 |
| 21 | Run in other agents (Codex, Cursor, Antigravity) | brag issues #1 #4 #14 #33 #38 | — | planned | AGENTS.md, stage 6 | A4 |
| 22 | Token cost shown before the first video | brag issue #35 | — | planned | `estimate` | A5 |
| 23 | Text-to-music models (MusicGen) | — | CC-BY-NC weights | rejected (licence) | — | D1 |
| 24 | Stock music search as default | Openverse | CC0 / CC BY tracks | rejected as default (can't follow cuts; Kerem rejected the result); kept as `--source openverse` | `music` | D2 |
| 25 | Trailer sounds (boom, whoosh, riser) | many repos | — | rejected (Kerem: irrelevant sounds) | `never` rule | D5 |
| 26 | Talking-head lane: transcript, silence cut, branded captions, cards | user requests; opus-video-skills | MIT | planned | stage 5 | I2 |
| 27 | No personal data / other users' photos in videos | SweetSpot test instruction | — | taken | setup + make skills | J4 |
| 28 | "Make it alive": product shown in use (taps, swipes, typing, state changes), not panned screenshots | brag-slim SKILL.md (creative laws) | MIT | taken (rule) | make skill §5 | C4, C15 |
| 29 | Reading time: 0.3 s per word after the line has settled | brag-slim | MIT | taken (rule); measurement planned | make skill §5; verify later | E8 |
| 30 | Stills mid-transition; no muddy crossfade between busy layouts | brag-slim | MIT | taken (rule) | make skill §5 snapshots | C6 |
| 31 | Questions before the plan: what, for whom, why different, hook, share caption; "clear to a stranger" | brag-slim | MIT | taken (rule) | make skill §2 | C2 |
| 32 | Share copy delivered with the video | brag-slim | MIT | taken | make skill §8 `share-copy.txt` | E11 |
| 33 | Calibrate our checks on a video the person approved (it must not be flagged) | own (found 2 bugs on brag's SweetSpot video) | — | taken once; planned as a test fixture | verify | E1–E10 |

## Real part harvest (19 November, requirement G7)

22 repos + the HyperFrames registry (210 blocks, 238 components) inspected; licences read from LICENSE files. 106 draft cards in `catalog-drafts/` (talking-head 38, explainer 48, launch 20), each with a decision; summaries in each folder's `SUMMARY.md`. Decisions: install 59, idea 23, link-only 6, skip 18. Key sources: herk-edit-kit (MIT, the only talking-head kit built on HyperFrames; its AIS brand assets are excluded), ffmpeg-skill (MIT, local transcription and silence cut), HyperFrames registry (Apache-2.0), hyperframes-launches (Apache-2.0, logos/media excluded by NOTICE), Barty-Bart sound effects (CC0). Drafts are not yet in `catalog/`: each install card still needs a test on 0.9.67 before it becomes a part.

## Aday: yerel Türkçe sentetik ses (22 Kasım, Kerem'in önerisi)

`alexturkey/voxcpm2-turkce-ses-tasarimi`, Apache-2.0, ~490 yıldız, aktif. VoxCPM2 + yamalı audio.cpp. Tariften ses tasarlar, metni o sesle okur (30 dil). Türkçe telaffuz sözlüğü var. **Kelime zamanlarını kendisi verir** (`kelimeler.json`, CTC'ye göre %90), aynı seed aynı sesi üretir. Klonlama yalnız izinle. Mac'te Metal ile çalışır: 2,8 GB model, ~5,3 GB RAM, M4'te 1 sn ses için ~2 sn işlem. 8 GB M1'de resmi olarak denenmemiş, yalnız bir kullanıcı raporu var.

Bizdeki yeri: "sentetik ses" için ücretsiz ve yerel parça (`voice-design`), ücretli seslendirmenin ücretsiz yedeği. Üç kullanım: ürün ve fotoğraf videolarına anlatıcı; kaydı olmayan biri için metinden sesli video; altyazı zamanı whisper'sız ve hatasız (metin zaten biliniyor). Kendi kurulumu var (Python + cmake + model). Kart `how: "installer"` olur, kodu kopyalanmaz. Sesten video çekirdeği bitince ele alınacak. 8 GB Mac'te önce ölçülecek.
