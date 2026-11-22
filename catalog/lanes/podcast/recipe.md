# Lane: podcast (audio to video)

An audio-only (or audio-first) show turned into a full-episode video for YouTube, short clips for Shorts/Reels/TikTok, and the publishing extras. The picture follows the talk and speaks the **show's own visual language**. Read after the core `make` steps 0–1; requirements: `docs/lanes/PODCAST.md` in the package.

## Setup extras (once per show)

Learn the show before anything else; never ask what its material already says:

- Read the show's description (Spotify/Apple/YouTube page or the person's text), its website if it has one (`hyperframes capture <url>`: colours, fonts, words it uses about itself), its cover art, and the transcript of one episode.
- **Tone decides the look.** Write down three words for the tone from that material (e.g. *unfiltered, friends, absurd* vs. *calm, expert, practical*). A comedic chat show gets big playful type, punchline pops, reaction marks and host plates that light up; an informative show gets topic titles, quotes, numbers and steps. The cover's drawing style is the strongest clue: a black-and-white ink sketch means line-art shapes and hand-drawn borders, not glossy gradients.
- Write the `podcast` block into `STYLE.md`:
  ```yaml
  podcast:
    look: ink-sketch          # ink-sketch | clean | <another look the scene part supports>
    background: capture/cover.png
    accent_alt: "#fc3c44"
    hosts: [ { id: A, name: "<as the show presents them>", tag: "<short role or nickname>" } ]
    tone: [unfiltered, friends, absurd]
  ```
- Host names: use them only as the show itself presents them publicly (site, episode titles), or as the person says. Ask once if unsure. A guest's name only if the person gives it.
- Never copy another show's look, and never use meme images, stickers or emoji fonts you didn't draw; reactions are drawn shapes in the show's line style.

## Extra brief questions

- Which episode (file) and which parts to skip (pre-show, mistakes, private talk).
- Clips: how many, and for which platform.
- Anything that must not be published (names of third persons, a joke about someone). When in doubt, leave it out and say so.

## Flow

All commands from the studio root; `<dir>` is `brands/<show>/videos/<episode>`. Make step 3 first (init, `frame.md`).

1. **Normalize and transcribe**: `normalize.mjs <audio> --out <dir>/assets/work.mp4` (audio-only input gives an audio working file), then `transcribe.mjs … --language <code> --out <dir>/words.raw.json`. Ask about the words it marks unsure; never put an unsure word on screen.
2. **Who speaks when**: `node parts/speakers/speakers.mjs --audio <dir>/assets/work.mp4 --words <dir>/words.raw.json --speakers <n> --out <dir>/speakers.json`. Map A/B to the hosts in `STYLE.md`; play two short checks to the person (or list two timestamps) before trusting it.
3. **Clean**: `silence-cut plan` (mode `normal` for a chat show: keep the rhythm of conversation; cut dead air, false starts and long pauses, not laughter or overlaps), the person approves `edl.md`, then `apply`.
4. **Moments and chapters**: `node parts/moments/moments.mjs …` proposes clips and chapter boundaries with reasons. The person picks the clips; you write the chapter titles in the show's voice (short, funny if the show is funny, never clickbait that the episode doesn't deliver).
5. **Visual plan** (`<dir>/scenes.json`): walk the transcript and give every idea a visual: `topic` at each chapter, `punchline` on the line that lands (the laugh comes right after it), `quote` for a line worth reading, `reaction` marks on laughs, host `lower-third` at their first word, the `stage` underneath all the time. Something on screen changes at least every 4–8 s; nothing invented: every word on screen was said, every number was said.
6. **Assemble**: `node parts/assemble-long/assemble-long.mjs assemble --audio <dir>/assets/cut.m4a --words <dir>/words.json --turns <dir>/speakers.json --scenes <dir>/scenes.json --frame <dir>/frame.md --chapters <dir>/chapters.json --out <dir>/renders/<episode>.mp4`. Check the parts' README for the exact flags of the installed version.
7. **Verify**: `npx create-video-engine verify <dir> --mp4 <file> --no-composition --expect-duration <cut length> --expect-audio`; then the fresh-eyes critic on the frames, with the transcript excerpt for each frame so it can judge whether the visual matches what was said.
8. **Clips**: for each chosen moment, a 9:16 version: the same scene blocks in portrait, captions in `pop` style, the punchline in the first 2 s if possible, the host plate of whoever speaks. Each clip is its own project with its own verify, ledger entry and `share-copy.txt`.
9. **Hand-over**: the episode MP4, clips, `chapters.txt` (for the description), `.srt`, a description draft (3–5 lines in the show's voice + chapters), and a thumbnail suggestion (a frame with the punchline of the episode). List what you were unsure of.

## Do not

- Do not cut laughter, overlaps or the hosts' running jokes; that is the show.
- Do not show third persons' full names or private details said in passing; leave them out of text and say so.
- Do not let the picture stand still for more than 8 s or repeat the same block back-to-back.
- Do not make every episode look the same: vary which blocks lead and the background motion, keep the show's look.
