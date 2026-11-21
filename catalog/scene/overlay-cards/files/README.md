# overlay-cards

Five card templates for the speaker's video, each for 16:9 and 9:16. Needs `assets/brand.css` from the captions part (`frame-vars.mjs`).

```
node parts/overlay-cards/build-card.mjs --kind lower-third --text "Ayşe Demir" --detail "Eğitmen" --aspect 16:9 --duration 4 --id card-name --out compositions/card-name.html
```

Kinds: `lower-third` (`--text` name, `--detail` role), `takeaway` (`--text` label, `--detail` the sentence), `stat` (`--text` the number, `--detail` what it measures), `quote` (`--text` quote, `--detail` who), `keyword` (`--text` one term). The command prints the host line to paste into `index.html`; give the host the card's `--duration` and `data-start` at the moment in the speech (use the word JSON's times).

- Colours and fonts are frame.md variables (`--c-ground --c-ink --c-accent --c-muted --f-display --f-body ...`), with plain fallbacks. No glow, no gradient, no external fonts.
- Placement: 16:9 lower-left above the caption row (`--bottom 320`), or `--pos upper`; 9:16 the upper band (`--top 320`), clear of the captions at the bottom and the platform UI. Never over the face.
- Timing follows HyperFrames' overlays.md: 0.45 s in, 0.35 s out. A card must be readable: about 0.3 s per word, at least 1.5 s on screen. About one card per 6-8 s, never two at once.
- Short text only; the stat card does not wrap.
- Origin: adapted from the Tier-2 label cards of nateherkai/herk-edit-kit (`style-library/02-kallaway`), MIT. `LICENSE` and the Herk Edit Kit `PIPELINE-USE-PERMISSION.txt` must stay next to these files. The upstream AI Automation Society brand assets are not licensed and are not part of this part.
