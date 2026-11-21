# Lane: social photo

A small brand's own photos (products, collection, place, people who agreed) turned into Reels, TikTok and feed videos. Read after the core `make` steps 0–1.

## Extra brief questions (fold into the one message)

- The campaign or occasion (new drop, sale, opening, restock) and the one thing the viewer should do.
- The collection or product names, exactly as the brand writes them.
- Prices, discounts, dates, sizes: **only from the person**. Never invent, round or "improve" a price or an offer; if none is given, show none.
- Which photos (a folder), and which is the best one (it opens the video).
- Where it goes: Reel/TikTok (9:16), feed post (4:5 or 1:1), story (9:16 with the top and bottom ~250 px kept clear of text).

## Material rules (J4)

- **Only the person's own photos.** No stock found by you, no photos from the web, no AI-generated images. The one exception: openly licensed photos (CC0, or CC BY with the credit line in the share copy) that **the person supplies themselves** with a source list (e.g. a `KAYNAKLAR.md`/`SOURCES.md` next to them); use them, never claim they are the brand's own, and carry any required credit. If a photo shows a person who is not the brand's owner or model, ask before using it.
- Use photos at native resolution: never scale a photo above 1.5 × its pixel width at 1080 px output (it goes soft). A photo too small to fill the frame is not a reason to stack photos as static panels; use one of the **small-photo shots** below (7–9).
- Do not edit a product's colour. If the brand's blue is on the garment, it stays that blue.
- Fewer than 5 usable photos: say so and make a shorter video (6–10 s) rather than repeating one photo more than twice.

## Aspect and length defaults

| Destination | aspect | length (s) | photos | shot length (s) |
|---|---|---|---|---|
| Reel / TikTok | 9:16 | 8–20 | 5–12 | 1.0–2.5 |
| Feed post | 4:5 or 1:1 | 6–15 | 4–8 | 1.5–3 |
| Story | 9:16 | 5–15 | 3–6 | 2–3 |

The person's `STYLE.md` `rhythm` wins over this table when it is measured.

## Shot types

1. **Push-in with purpose**: a slow scale from 1.00 to 1.08–1.15 over the shot, toward the thing the line names (the print, the cup, the label). A push-in with no target is decoration; pick the target in SPEC.
2. **Pan with purpose**: a photo wider than the frame moves along its long side, ending on the detail. Speed under 12 % of the photo width per second.
3. **Product reveal**: the product enters on a beat (scale from 0.92, or a mask wipe in the brand's direction) over a background the brand uses; the name lands on the same beat.
4. **Detail crop**: a tight crop (fabric, stitching, foam, label) cut to straight after a wide shot; crop from the original, never a re-cropped crop.
5. **Lookbook rhythm**: a run of 3–6 photos cut on consecutive beats (or half-beats), each held ≥ 0.6 s; alternate wide / detail / wide, and keep the same visual centre of gravity between neighbours so the cut reads. Vary shot length by at most ±30 % inside a run; end the run on the best photo.
7. **Cut-out on the brand ground** (small photo): the photo sits as a large rounded or shaped card (≥ 80 % of the frame width) on the brand's ground colour or a soft blur of the same photo, with a slow push (1.00 → 1.06) and a 2–4 px parallax drift against the headline. Never a static box.
8. **Collage on the beat** (several small photos): 2–3 photos enter one by one on consecutive beats at slight angles (±2–4°), overlapping like prints on a table, the last one on top with the line; each keeps a drift. One collage per video at most.
9. **Detail-to-whole** (small photo): start inside a sharp detail crop at native size, pull back to the whole photo card on the beat.

6. **Price / offer card**: the last 1.5–3 s: the product photo stays, one card with the offer and the call to action in the brand's accent, with the price/offer settled ≥ 2 s and any other line ≥ 0.3 s per word (core rule). Contents only what the person gave. The end card's lines follow the same size rule as headlines (brand name ≥ 2 × `format.min_text_px`, details such as hours ≥ `format.min_text_px`); split into two lines rather than shrink.

Something happens on every beat that matters: a cut, a push-in landing, the name or price arriving, the signature element. **Every photo keeps moving for its whole shot** (push, pan, drift or parallax), not only during its entrance; a photo held still for more than 1 s is a defect, and verify's `static-shots` warns when half the shots are still. Two photos stacked as fixed panels is a slideshow, not a shot.

## Text on photos

- Text must stay readable on any photo: put a scrim under it taken **from the brand's colours** (`ground` at 55–70 % opacity, or a gradient from `ground` 80 % to 0 over the text's height), never a generic black box or drop shadow unless `STYLE.md` uses one.
- Measure it: text-to-background contrast ≥ 4.5:1 on the darkest and lightest point under the text. If the scrim cannot do it, move the text, not the opacity above 80 %.
- Text size: headlines ≥ 3 × `format.min_text_px` in this lane (≥ 120 px at 9:16; a feed is watched small), two to four words; prices as large as the headline. Keep text inside the platform safe zones (9:16: the top 14 % and bottom 22 % free for Reels and TikTok).
- One headline per photo, at most two lines. Never text over a face.

## Spec rows to add

- SHOTS: per shot, the photo file, shot type (1–6), the target of a push-in or pan, and the scrim if text sits on it.
- Every price and offer string, with where the person gave it.

## What verify warnings mean here

- `empty-area` and `subject-scale`: a full-bleed photo naturally passes both; a warning means a photo letterboxed or a card covering the frame. Fix it by filling the frame, not by enlarging the card.
- `stillness`: a photo with no push, pan or on-screen change for > 3 s. Add the push-in or cut earlier.
- `numbers`: every price, date and percentage must be in `BRIEF.md`; the warning means you wrote one the person did not give.
- `poster`: frame 0 is the best photo with the hook line already on it.
- `on-beat`: lookbook runs make this strict; move the cut, not the music.

## Sound

Music is composed with the edit as in the core; lookbook cuts are `cut` cues, the price card landing is `confirm` or `end`. No trailer sounds.
