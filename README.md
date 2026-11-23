# create-video-engine

**Your own video studio, set up by your coding agent.** It learns your brand, installs only the tools for the videos *you* make, checks every render before you see it, and turns your feedback into rules so the next video starts closer to what you want.

Built on [HeyGen HyperFrames](https://github.com/heygen-com/hyperframes) (HTML → MP4). Türkçe açıklama aşağıda.

![Three brands, three studios](https://raw.githubusercontent.com/kerem-sahin/create-video-engine/main/media/demo.gif)

*Three videos, each made by a fresh agent in its own studio from the brand's own material: an app launch ([SweetSpot](https://github.com/kerem-sahin/create-video-engine/blob/main/media/sweetspot.mp4)), a planner app ([Plainday](https://github.com/kerem-sahin/create-video-engine/blob/main/media/plainday.mp4)) and a café Reel from photos ([test brand](https://github.com/kerem-sahin/create-video-engine/blob/main/media/cafe.mp4), CC0 photos). Click a name for the full video with sound.*

> **Status: 0.1, early.** Works end to end with Claude Code on macOS. Read [Known limits](#known-limits) before you rely on it.

## Why another video repo

There are dozens of "make a video with AI" repos. Most give everyone the same template, and you pick and glue the ones you need by hand. This one is different in three ways:

1. **It knows you.** Setup reads your material first (repo, site, screenshots, photos), asks at most six questions in your language, and writes a taste file: colours and fonts from your code, rhythm from reference videos, a signature taken from how your product actually behaves, and a list of things your videos never do.
2. **It knows what you make.** It asks what kind of videos you make and installs only those parts from a vetted catalog, with their source and licence recorded. Add more later with `add`.
3. **It grows with you.** After each video you say what you think in plain words ("too fast", "this sound doesn't fit"); it proposes concrete rule changes, applies only what you approve, and logs why.

And it never hands you a video it hasn't measured: blank or frozen stretches, empty first frames, still shots, empty areas, cuts off the beat, numbers on screen that you never gave it, loudness. A fresh-eyes reviewer sub-agent grades the frames without seeing the code.

## What a check looks like

Every render is measured before anyone calls it done. Real output for the café video above (shortened):

```
PASS    hyperframes check: 11 warning(s)
  PASS    first-frame     frame 0 has content
  PASS    blank-stretch   no blank stretch of 0.5s or more
  PASS    loudness        -16 LUFS, true peak -3.1 dBTP
  PASS    on-beat         all 5 cut(s) within 1.5 frames of a beat (96 BPM)
  PASS    empty-area      largest empty band 8% of the height (limit 20%)
  PASS    static-shots    2 of 5 shots static (warns from 50%)
  PASS    numbers         all 4 on-screen number(s) appear in BRIEF.md
SOUND   11 cue(s) — check each against the action on screen
MOMENTS 4 moment(s) for you to watch or listen to:
       0s  hook: the first 2 s. Would this stop a scroll?
   10.63s  end card: is the last thing on screen what you want remembered?
RESULT ok (everything that ran passed)
```

A check that could not run is reported as *skipped*, never as passed. Then a reviewer sub-agent that has not seen the code grades the frames against your taste file, and you get five questions about the video; your answers become rules.

## Lanes (kinds of video)

| Lane | For | Parts it installs |
|---|---|---|
| `product-launch` | app, site or product launches and updates from real screens | screenshot crop, spring motion and shared-element carry, a recorded track found by feel |
| `social-photo` | a small brand's photos into Reels/TikTok/feed videos | photo shots that keep moving, offer cards, a recorded track found by feel |
| `talking-head` *(beta)* | YouTube talks/lessons and Shorts cut from them | local transcription, silence and filler cut (approved before it's applied), branded word-by-word captions, overlay cards, shorts with 9:16 reframe |
| `podcast` *(beta)* | a podcast or voice recordings into vertical clips that draw what is said | reads the show's feed and past episodes into a memory, clip cutting, medium-model transcription with a sync check |

`npx create-video-engine catalog list` shows lanes and parts. Every part has a card with its source repository, licence and the HyperFrames version it was checked with; non-commercial sources are link-only and never copied.

## Install

Needs Node ≥ 22, `ffmpeg`/`ffprobe` (8.x) and Chrome (used by HyperFrames to render).

```bash
npx create-video-engine init my-studio
cd my-studio
```

Open the folder in Claude Code and say: **"set up my studio"** (or in your language). Then: **"make a launch video"**, **"cut this recording into a YouTube video and a Short"**, **"make a Reel from these photos"**.

## What it costs

Measured with Claude Sonnet on an M1 MacBook Air (8 GB): first setup plus one 15–20 s video ≈ **150–225k tokens**, 40–65 tool calls, 12–16 minutes, 4–6 renders. Later videos for the same brand skip setup. No paid service is needed; optional paid parts (e.g. better transcription) always have a free fallback and are only installed if you say yes.

## Commands

```
init <dir>                      create a studio (installs the pinned HyperFrames locally)
doctor                          check Node, ffmpeg, Chrome, memory
add <part>|lane:<id>            install a part or a whole lane (copied, you own it)
remove <part>|lane:<id>         remove it (refuses if you changed its files)
upgrade                         update skills, recipes and parts; never touches your brands or edited files
catalog list|check              list lanes and parts / validate cards
verify <project> --mp4 <file>   measure a render (exit 0 ok, 1 problems, 2 could not check)
music --mood "<words>" ...      three CC0/CC BY tracks with previews; you pick (your own track comes first)
refs <video> --out <dir>        measure a reference video's grammar (cuts, rhythm, palette)
crop <image> --auto             cut a store screenshot down to the real app screen
```

No telemetry. No runtime dependencies. HyperFrames' own usage beacon is skipped.

## Known limits

Honest list, from our own tests:

- **You pick the music.** Your own track, or three open-licence candidates with 10 s previews; the agent cannot hear, so it never chooses one for you. With nobody to pick, the video is delivered silent. Composing in code is still there (`music --score`) but only on request: it sounded alike across videos.
- **Layouts look alike across brands.** Colours, fonts and signatures differ; the composition (big headline top-left, one large subject below) is still too similar. Brand-specific layouts are next.
- **Talking-head lane is beta.** Proven end to end on a synthetic recording; not yet on real footage.
- **Only tested with Claude Code on macOS.** The studio has an `AGENTS.md`, so Codex, Cursor or Antigravity should be able to follow it, but we haven't verified that. Linux should work; Windows is untested.
- **Renders need a network connection** (HyperFrames loads GSAP and Google Fonts during render). Our own commands make no network calls except optional ones you ask for.
- **8 GB machines work but are slow;** renders take about a minute per 20 s.

## Credits

[HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0) does the rendering. Ideas were studied from many open repos; copied code is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

MIT licence.

---

## Türkçe

**Kodlama ajanının kurduğu, sana ait bir video stüdyosu.** Markanı öğrenir, yalnızca senin yaptığın video türleri için gereken araçları kurar, her videoyu sana göstermeden önce ölçer ve geri bildirimini kurala çevirir; bir sonraki video istediğine daha yakın başlar.

**Kurulum:** Node 22+, ffmpeg ve Chrome gerekir.

```bash
npx create-video-engine init studyom
cd studyom
```

Klasörü Claude Code'da aç ve **"stüdyomu kur"** de. Sonra: **"bir tanıtım videosu yap"**, **"bu kaydı YouTube videosu ve Shorts'a çevir"**, **"bu fotoğraflardan Reels yap"**.

**Üç hat:** ürün/uygulama tanıtımı, fotoğraftan sosyal medya videosu, konuşma videosu (YouTube, beta). Kurulum hangisini yaptığını sorar ve yalnız onların parçalarını kurar; her parçanın kaynağı ve lisansı kayıtlıdır.

**Maliyet:** ilk kurulum + bir video yaklaşık 150–225 bin token (Sonnet), 12–16 dakika. Ücretli servis gerekmez.

**Bilinen eksikler:** müzik ya senin parçan ya açık lisanslı bir katalogdan gelir (kodla besteleme kaldırıldı); markaların görüntü düzeni benzeşiyor; konuşma videosu hattı henüz gerçek çekimle denenmedi; yalnız Claude Code + macOS'ta denendi. Ayrıntılar yukarıda, "Known limits" bölümünde.
