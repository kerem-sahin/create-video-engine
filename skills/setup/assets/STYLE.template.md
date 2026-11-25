---
version: 1
name: "<Brand> — taste"
brand: <brand-slug>
updated: <YYYY-MM-DD>

# Normative (HyperFrames reads these from frame.md). Hex only. Real brand values only.
colors:
  ground: "#000000"      # source: <file / capture / sampled from …>
  ink: "#000000"         # source:
  accent: "#000000"      # source:
  # add roles the brand really has: muted, surface, accent-2 …

typography:
  display: { fontFamily: "<family>", weight: 700, tracking: "-0.02em" }   # source:
  body:    { fontFamily: "<family>", weight: 400 }                          # source:
  mono:    { fontFamily: "<family>", weight: 500 }                          # optional

spacing: { safe: "8%" }

# Ours. Starting points for the first video; the notebook and the person's notes override them.
motion:
  ease: { enter: "power3.out", exit: "power2.in" }
  durations: { enter: [0.4, 0.7], hold_min: 1.2 }   # seconds
  camera: { push_in_max: 1.12 }
  spring: { preset: settle, stiffness: 180, damping: 16 }   # preset: snappy | soft | settle (CVE.ease in parts/cve-motion/cve-motion.js, installed with `add cve-motion`); stiffness/damping are that preset's values
  continuity: carry           # carry = a shared element crosses each cut | colour = a shared colour/shape position only

rhythm:
  shot_length: [1.5, 3.5]     # seconds, min–max
  cuts_per_10s: [3, 5]
  source: default             # measured | interview | default

format: { aspect: "16:9", length: [20, 35], fps: 30, min_text_px: 48 }   # min_text_px: 48 for 16:9 social, 40 for 9:16, 32 for a README/website hero

never:
  - "Inter, Space Grotesk, Instrument Serif, Geist or JetBrains Mono as the display face"
  - "centered white headline on a dark gradient"
  - "purple-blue gradients, glassmorphism cards, sparkle motifs"

signature: "<the one recurring element, from the brand's own world — ideally something the product itself does>"

sound:
  track: null            # the person's own track (a file they own the rights to); without one the video has no music and they add a sound when posting
  product_sound: null    # the product's own sound if it has one ("a soft bell on save"), exactly as found
---

## What this brand is

<Two or three plain sentences: what it does, for whom, where it lives. Describe; don't sell.>

## Voice

<Language(s). Sentence length. Words it uses. Words it never uses. Example headline in its voice.>

## Do

- <concrete, checkable>

## Don't

- <concrete, checkable — the prose version of `never`, with reasons>

What this person liked, disliked and banned lives in `NOTEBOOK.md` next to this file.
