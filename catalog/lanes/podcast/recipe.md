# Lane: podcast (audio to video)

An audio-only (or audio-first) show turned into a full-episode video for YouTube, short clips for Shorts/Reels/TikTok, and the publishing extras. The picture follows the talk and speaks the **show's own visual language**. Read after the core `make` steps 0–1; requirements: `docs/lanes/PODCAST.md` in the package.

## Setup extras (once per show)

**What the person already has is the best teacher.** Before any question, collect it and read it (design: `docs/VOICE-TO-VIDEO.md` in the package).

1. **Ask for whatever exists**, in one short message: the show's link (Spotify, Apple, YouTube) or RSS feed, a folder of past recordings, the website, earlier videos. None is required.
2. **Read the show**: `node parts/show-reader/show-reader.mjs read <link|feed|folder> --out brands/<show>/sources/show.json`. Read its output: episodes, titles, descriptions. On exit 1 (`name-only` or `none` match, or no episode list) say what is missing and ask for the RSS link (every hosting dashboard shows it) or the recordings; never treat an unconfirmed feed as the show's. A folder gives no titles: ask for them, never take a file name as a title.
3. **Past episodes' audio**: tell the person how many episodes and minutes the feed offers and ask before downloading (`download --show … --dir brands/<show>/sources/episodes`, all or `--latest N`). It is their own show, but the files are large.
4. **Memory**: `node parts/memory/memory.mjs transcribe --show … --memory brands/<show>/memory` (resumable; it can run while you do the rest), then `memory.mjs index --memory … --show …`. Read `memory/index.md`, then the transcript lines around each candidate, and fill `memory/CHANNEL.md` (the people who talk, running jokes and phrases, subjects, places, how an episode goes, how titles are written, never), **every line with a citation** (`[b4 12:30]`, `[title b2]`, `[person]`). Write `memory/episodes/<nn>.md` (3–6 lines: what happens, best moments with times) for each transcribed episode. Without audio, write what titles and descriptions show and say the memory is thin.
5. Show the person a short summary of `CHANNEL.md` ("this is how I understood your show") and correct it with their answers; their words are cited `[person]` and win.

Then learn the look; never ask what the material already says:

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
- Host names: use them only as the show itself presents them publicly (site, episode titles), or as the person says. Ask once if unsure. A guest's name only if the person gives it. A name in `memory/` is not permission to show it.
- Never copy another show's look, and never use meme images, stickers or emoji fonts you didn't draw; reactions are drawn shapes in the show's line style.

## Extra brief questions

- Which episode (file) and which parts to skip (pre-show, mistakes, private talk).
- Clips: how many, and for which platform.
- Anything that must not be published (names of third persons, a joke about someone). When in doubt, leave it out and say so.

## Flow

All commands from the studio root; `<dir>` is `brands/<show>/videos/<episode>`. Make step 3 first (init, `frame.md`).

1. **Normalize and transcribe**: `normalize.mjs <audio> --out <dir>/assets/work.mp4` (audio-only input gives an audio working file), then `transcribe.mjs … --language <code> --out <dir>/words.raw.json`. Ask about the words it marks unsure; never put an unsure word on screen. The transcript has **no punctuation and no capitals**; before anything goes on screen, make a punctuated copy: read `words.raw.json`, add sentence ends, commas, question marks and proper capitals (Turkish İ/ı) to the word texts **without changing any timing**, fix obvious mishearings you are sure of from context, and save it as `words.json`. Captions, quotes and punchlines read that file. Sentence ends also drive the clip and chapter boundaries.
2. **Who speaks when**: `node parts/speakers/speakers.mjs --audio <dir>/assets/work.mp4 --words <dir>/words.raw.json --speakers <n> --out <dir>/speakers.json`. Map A/B to the hosts in `STYLE.md`; play two short checks to the person (or list two timestamps) before trusting it.
3. **Clean**: `silence-cut plan` (mode `normal` for a chat show: keep the rhythm of conversation; cut dead air, false starts and long pauses, not laughter or overlaps), the person approves `edl.md`, then `apply`.
4. **Moments and chapters**: `node parts/moments/moments.mjs …` proposes clips and chapter boundaries with reasons. The person picks the clips; you write the chapter titles in the show's voice (short, funny if the show is funny, never clickbait that the episode doesn't deliver).
5. **Visual plan** (`<dir>/scenes.json`): walk the transcript and give every idea a visual: `topic` at each chapter, `punchline` on the line that lands (the laugh comes right after it), `quote` for a line worth reading, `reaction` marks on laughs, host `lower-third` at their first word, the `stage` underneath all the time. Something on screen changes at least every 4–8 s; nothing invented: every word on screen was said, every number was said.
6. **Assemble**: `node parts/assemble-long/assemble-long.mjs assemble --audio <dir>/assets/cut.m4a --words <dir>/words.json --turns <dir>/speakers.json --scenes <dir>/scenes.json --frame <dir>/frame.md --chapters <dir>/chapters.json --out <dir>/renders/<episode>.mp4`. Check the parts' README for the exact flags of the installed version. Read the **exit code** (0 ok, 1 a measured check failed): never pipe the run through `tail`/`head` without keeping it (`; echo exit=$?`), and never call a run with exit 1 done; the reasons are in `<out>.assemble.json` → `problems`. With `--chapters` it writes `chapters.txt` next to the MP4.
7. **Verify**: `npx create-video-engine verify <dir> --mp4 <file> --no-composition --expect-duration <cut length> --expect-audio`; then the fresh-eyes critic on the frames, with the transcript excerpt for each frame so it can judge whether the visual matches what was said.
8. **Clips**: cut each chosen moment with `node parts/assemble-long/assemble-long.mjs slice --audio <dir>/assets/cut.m4a --from <s> --to <s> --words <dir>/words.json --turns <dir>/speakers.json --out-dir brands/<show>/videos/<clip>/assets` (it never splits a word, moves the edges to the nearest sentence start and full stop within 4 s, and writes `clip.m4a`, `words.json`, `speakers.json` on the clip's clock; read its notes), then assemble it with `--audio …/clip.m4a --aspect 9:16 --captions pop` and the clip's own `scenes.json`. Each clip is a 9:16 version: the same scene blocks in portrait, captions in `pop` style, the punchline in the first 2 s if possible, the host plate of whoever speaks. Each clip is its own project with its own verify, ledger entry and `share-copy.txt`.
9. **Hand-over**: the episode MP4, clips, `chapters.txt` (for the description), `.srt`, a description draft (3–5 lines in the show's voice + chapters), and a thumbnail suggestion (a frame with the punchline of the episode). List what you were unsure of.

10. **Grow the memory**: copy the episode's final transcript to `memory/episodes/<nn>.words.json` (or let `show-reader read` + `memory transcribe` pick it up once it is published), run `memory.mjs index`, and add to `CHANNEL.md` what this episode showed (new running joke, a callback, the person's feedback), with citations.

## Do not

- Do not cut laughter, overlaps or the hosts' running jokes; that is the show.
- Do not show third persons' full names or private details said in passing; leave them out of text and say so.
- Do not let the picture stand still for more than 8 s or repeat the same block back-to-back.
- Do not make every episode look the same: vary which blocks lead and the background motion, keep the show's look.
