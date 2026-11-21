# Parts, lanes and the studio record — format v2

*19 November 2026. Binding for `catalog/`, the `add`/`remove` commands, `setup` and `make`. Derived from `PRODUCT.md` (pillar 2: "knows what you make") and the shadcn/snapcn registry model.*

## 1. Part card `catalog/<kind>/<id>/part.json` (schema 2)

```json
{
  "schema": 2,
  "id": "silence-cut",
  "kind": "tool",
  "title": "Silence cut",
  "what_it_does": "One sentence.",
  "when_to_use": "When an agent should reach for it, and when not.",
  "lanes": ["talking-head"],
  "source": {
    "repo": "kajisho5/ffmpeg-skill",
    "url": "https://github.com/kajisho5/ffmpeg-skill",
    "ref": "<commit sha the files were copied from, or null for own code>",
    "licence": "MIT",
    "assets_licence": null,
    "how": "copied"
  },
  "attribution": "silence-cut: adapted from kajisho5/ffmpeg-skill (MIT), © <holder>",
  "builtin": false,
  "registry": null,
  "files": [ { "from": "files/silence-cut.mjs", "to": "parts/silence-cut/silence-cut.mjs" } ],
  "docs": "files/README.md",
  "requires": ["transcribe-local"],
  "needs": ["ffmpeg"],
  "paid_api": null,
  "verified_with": { "hyperframes": "0.9.67", "date": "2026-11-19" },
  "example": null,
  "requirements": ["I2"],
  "notes": null
}
```

- `kind`: `scene` | `motion` | `check` | `sound` | `tool` | `recipe` | `style` | `hf-block`.
- `lanes`: ids from §2; a part may serve several.
- `source.how`: `own code` | `copied` (open licence, notice kept, `ref` required) | `link-only` (no files, never installable) | `registry` (a HyperFrames registry block; `registry` names it, no files).
- `source.licence` / `assets_licence`: SPDX as written in the upstream LICENSE (`MIT`, `Apache-2.0`, `BSD-3-Clause`, `CC0-1.0`, `CC-BY-4.0`) or `own`. Non-commercial or missing licence → only `link-only`. `assets_licence` when media/fonts/brand files differ from the code licence (e.g. "brand assets excluded").
- `attribution`: the line appended to the studio's `NOTICE.md` on install; required for `copied` and `registry`.
- `builtin: true`: the part is a command of this CLI (verify checks, music scorer, crop, refs). It has a card for transparency; `add` only records it. `files` empty.
- `files[].from`: relative to the card's folder (copied upstream files live in `catalog/<kind>/<id>/files/`, with the upstream `LICENSE` copied next to them as `files/LICENSE`). `files[].to`: relative to the studio root, always under `parts/<id>/`.
- `docs`: path (relative to the card folder) to a short usage note copied to `parts/<id>/README.md`; printed after install.
- `requires`: part ids, installed first (recursively, no cycles).
- `needs`: system tools the part calls (`ffmpeg`, `python3`, `whisper-cli`, …). `add` warns when one is missing and says how to install it; it never installs system tools itself.
- `paid_api`: `null` or `{ "service": "ElevenLabs Scribe", "env": "ELEVENLABS_API_KEY", "free_fallback": "<part id>", "sends": "the audio track" }`. A paid part is installed only with `--paid` or when the studio's `paid` setting is true, and always together with its free fallback.

Schema-1 cards (`files` as a list of strings) are migrated: own-code CLI parts become `builtin: true`.

## 2. Lane `catalog/lanes/<id>/lane.json`

```json
{
  "schema": 2,
  "id": "talking-head",
  "title": "Talking-head videos (YouTube, Reels clips)",
  "for": "Ayşe: records herself talking; wants cuts, captions, cards and short clips.",
  "ask": "Do you record yourself talking to the camera (YouTube, podcasts, lessons)?",
  "parts": ["transcribe-local", "silence-cut", "captions", "overlay-cards", "shorts-from-long"],
  "recipe": "recipe.md"
}
```

Lanes in the first release: `product-launch` (Kerem), `talking-head` (Ayşe), `social-photo` (Mert). Later: `explainer`, `tutorial`. The recipe is the lane-specific part of the `make` skill: how a video of this kind is planned, built and checked. It is written in the same voice as `skills/make/SKILL.md` and assumes the core steps there.

## 3. Studio record

`studio.json` gains:

```json
{ "schema": 2, "lanes": ["talking-head"], "paid": false,
  "skills_hash": { "skills/make/SKILL.md": "<sha256>" },
  "parts": [ { "id": "silence-cut", "source": "kajisho5/ffmpeg-skill@<ref>", "hash": "<sha256 of installed files>", "added": "2026-11-19" } ] }
```

Installed files: `parts/<id>/…`; lane recipes: `skills/make/lanes/<id>.md` and `.claude/skills/make/lanes/<id>.md`; `NOTICE.md` at the studio root lists every attribution line once.

## 4. Commands

```
npx create-video-engine add <part-id>|lane:<lane-id> [--studio <dir>] [--paid] [--dry-run] [--json]
npx create-video-engine remove <part-id>|lane:<lane-id> [--studio <dir>] [--json]
npx create-video-engine catalog list [--lane <id>] [--json]
npx create-video-engine catalog check
```

- `add`: resolves `requires`; refuses `link-only` (exit 1, prints the link); refuses a paid part without `--paid`/`paid: true` (exit 1, says the free fallback); copies files (never overwrites a file the person changed: compares with the recorded hash and stops with exit 1 naming the file); appends attribution to `NOTICE.md`; records in `studio.json`; prints the part's docs and missing `needs`. `lane:<id>` adds every part of the lane plus the recipe. Idempotent: adding an installed, unchanged part is a no-op. `--studio` defaults to the nearest parent with `studio.json`. Exit 0 ok, 1 refused/conflict, 2 cannot run, 64 usage.
- `remove`: deletes `parts/<id>/` only if unchanged (else exit 1 naming changed files), removes its record; refuses if another installed part requires it. `lane:<id>` removes the recipe and the parts no other lane needs.
- `init` installs nothing from the catalog by default; `setup` asks and calls `add`.
