# Catalog

Vetted parts for a personal video studio. The model is the one shadcn/ui uses: **a part is copied into your studio and from then on you own it.** There is no dependency to keep up with and nothing updates under you. If you change a part, it is yours; if a newer version is published, you choose whether to take it.

Every part has a card. The card says what the part does, where it came from, under which licence, and which HyperFrames version it was last checked with. Nothing enters the catalog without a card, and `create-video-engine catalog check` fails if a card is incomplete. The binding format is `docs/PARTS-FORMAT.md`; this page is the short version.

## Layout

```
catalog/<kind>/<id>/part.json          the card
catalog/<kind>/<id>/files/             files copied into studios (+ files/LICENSE for copied code, files/README.md as docs)
catalog/lanes/<id>/lane.json           a lane: the parts a kind of video needs, and its recipe
catalog/lanes/<id>/recipe.md           the lane-specific part of the make skill
```

`kind` is one of `scene`, `motion`, `check`, `sound`, `tool`, `recipe`, `style`, `hf-block`. The folder names must match the card's `kind` and `id`.

## Card format (schema 2)

```json
{
  "schema": 2,
  "id": "silence-cut",
  "kind": "tool",
  "title": "Silence cut",
  "what_it_does": "One sentence.",
  "when_to_use": "When an agent should reach for it, and when not.",
  "lanes": ["talking-head"],
  "source": { "repo": "owner/repo", "url": "https://...", "ref": "<commit sha>", "licence": "MIT", "assets_licence": null, "how": "copied" },
  "attribution": "silence-cut: adapted from owner/repo (MIT), (c) holder",
  "builtin": false,
  "registry": null,
  "files": [ { "from": "files/silence-cut.mjs", "to": "parts/silence-cut/silence-cut.mjs" } ],
  "docs": "files/README.md",
  "requires": [],
  "needs": ["ffmpeg"],
  "paid_api": null,
  "verified_with": { "hyperframes": "0.9.67", "date": "2026-11-19" },
  "example": null,
  "requirements": ["I2"],
  "notes": "optional"
}
```

- `id`: lowercase letters, digits, hyphens. `lanes`: non-empty; each must have a `catalog/lanes/<id>/lane.json`.
- `source.how`: `own code`, `copied` (open licence; `ref`, `attribution` and `files/LICENSE` required), `link-only` (no files, never installable) or `registry` (a HyperFrames registry block named in `registry`; no files; `attribution` required).
- `source.licence`: `MIT`, `Apache-2.0`, `BSD-3-Clause`, `CC0-1.0`, `CC-BY-4.0` or `own`. A non-commercial or missing licence is allowed only for a **link-only** card, which has no files: nothing from a closed or non-commercial source is copied, not code and not text.
- `builtin: true`: the part is a command of this CLI (own code, `files` empty). `add` only records it.
- `files[].from` is relative to the card folder (no `..`, not absolute) and must exist; `files[].to` is relative to the studio and must be under `parts/<id>/`. `docs` is copied to `parts/<id>/README.md` and printed after install.
- `requires`: part ids installed first, no cycles, all in the catalog. `needs`: system tools; `add` warns when one is missing.
- `paid_api`: `null` or `{ service, env, free_fallback, sends }`; the fallback must exist and be free. A paid part installs only with `--paid` or a studio with `paid: true`, together with its fallback.
- `example`: path inside the card folder to a working example, or `null`. It is not installed.
- `requirements`: IDs from `docs/REQUIREMENTS.md` the part serves.

Schema-1 cards (`files` as a list of strings, no `schema` field) are rejected with "migrate to schema 2".

## Lane format

```json
{ "schema": 2, "id": "talking-head", "title": "...", "for": "...", "ask": "...", "parts": ["silence-cut"], "recipe": "recipe.md" }
```

Every part id must exist in the catalog and be installable (not link-only); the recipe file must exist and not be empty.

## Commands

```
npx create-video-engine catalog check [--dir <catalog-dir>] [--json]   exit 0 ok, 1 invalid cards, 2 no catalog
npx create-video-engine catalog list  [--lane <id>] [--dir <catalog-dir>] [--json]
npx create-video-engine add    <part-id>|lane:<id> [--studio <dir>] [--paid] [--dry-run] [--json]
npx create-video-engine remove <part-id>|lane:<id> [--studio <dir>] [--json]
```

`add` and `remove` read the catalog shipped in the package; `--catalog <dir>` points them at another one (tests). `add` never overwrites a file you changed (it compares with the sha256 recorded in `studio.json`) and stops with exit 1 naming it.

## Adding a part

1. Put the files under `catalog/<kind>/<id>/files/` (with the upstream `LICENSE`) and write the card.
2. Run `catalog check` until it passes.
3. Record the idea's origin and status in `docs/HARVEST.md`.
