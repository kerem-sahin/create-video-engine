# podcast-scenes

Scene blocks for an audio-only podcast, in the show's own visual language. HyperFrames sub-compositions (deterministic GSAP, 16:9 and 9:16), written by one script.

```
node parts/podcast-scenes/build-scene.mjs --kind punchline --text "Dört sandalye parası, *tek* sandalye" \
     --aspect 16:9 --duration 3 --frame brands/<brand>/taste/STYLE.md --out compositions/pl-1.html --id pl-1
node parts/podcast-scenes/levels.mjs episode.m4a --out levels.json          # RMS per frame, for the waveform block
```

## The show: `podcast:` block in frame.md

Written by setup, flow style (one or several lines) in the frontmatter:

```
podcast: { look: "ink-sketch", background: "assets/cover.png", accent_alt: "#fc3c44", lang: "tr",
  hosts: [ {id: "A", name: "Ali", tag: "Sunucu"}, {id: "B", name: "Veli", tag: "Sunucu"} ] }
```

`look` is `ink-sketch` or `clean`; `--look` overrides it. `hosts`: one to three, `id` is what scenes and turns call them. `accent_alt` is the second colour (underlines, quote marks); `lang` (default `tr`) makes `text-transform: uppercase` Turkish (i -> İ). Colours and fonts come from the rest of frame.md (`colors.ground/surface/ink/muted/accent`, `typography.display/body`, `format.min_text_px`). `--podcast file.json` replaces the block.

## Blocks (`--kind`)

| kind | what | text | length |
|---|---|---|---|
| `stage` | the base layer: cover/ground with slow motion (zoom 1.00-1.04, drift, parallax doodles or blobs) and one speaker plate per host | `--mode full` (+`--turns`), `bg` (one seamless `--loop`, default 8 s), `plates` (dim/lit stills) | any |
| `waveform` | bars from `--levels levels.json` `--from <s>`; no audio at render time | | >= 1 s |
| `punchline` | big words pop in, shake, `*word*` highlighted (last word if none) | the line | 1-3.5 s |
| `quote` | what a host said, large, attributed (`--speaker`) | the quote | >= 2 s |
| `topic` | chapter title card (`--detail "BÖLÜM 2"` chip) | the title | >= 2 s |
| `reaction` | hand-drawn SVG marks beside the host's plate: `exclaim question laugh stars shock` or `! ? !? ha` | marks, comma separated | >= 1 s |
| `lower-third` | host name and role (defaults from `podcast.hosts`) | optional | >= 2 s |

## The two looks

One template, two CSS classes on the root: `look-ink-sketch` (white line on black, hand-drawn "sketch borders": 3 px ink border, uneven radius, hard accent shadow, wobble from an SVG displacement filter, cover inverted, drifting doodles, underline scribbles) and `look-clean` (rounded surface cards with a soft shadow and an accent edge, blurred cover, drifting colour blobs, solid accent strokes). Same sizes, same timing.

## With assemble-long

`assemble-long.mjs assemble --audio episode.m4a --scenes scenes.json --turns speakers.json --frame frame.md [--words episode.words.json] --out final.mp4` builds all of it (see that part's README). `scenes.json`: `[{ "start": 105.5, "end": 108.5, "kind": "punchline", "text": "..." , "speaker": "A" }]`, times in the audio's clock; punchline, quote and topic may not overlap each other. `turns` is the `speakers` part's `{ speakers, turns: [{start, end, speaker}] }`; turns shorter than 0.6 s are dropped and a host's turns closer than 0.8 s are merged.

Notes: text is estimated to fit (`fitText`) and the script says when it may not; names in the plates are corner labels and may go below `min_text_px` when long. The cover is copied to `<project>/assets/`.
