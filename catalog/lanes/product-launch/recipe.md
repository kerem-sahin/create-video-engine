# Lane: product launch

Launch, update, feature or "how it works" videos for an app or product, built from its real screens. Read after the core `make` steps 0–1; it adds to them and overrides nothing in `STYLE.md`.

## Extra brief questions (fold into the one message)

- Which real flow shows the product in use: entry → key action → result?
- Which screenshots or screen recordings? Store screenshots (with device frame and caption) or raw captures?
- The one feature or claim the video is about, and the exact feature names as the product spells them.

## Story questions (answer in `BRIEF.md` before the three stories)

Which real flow shows it in use (entry → key action → result)? A stranger who sees the video once must know what it does, who it is for and how to get it. Example structures: problem → product → proof; one continuous walk-through; one bold claim proven three ways.

## Material rules

- Product shots are the **real product UI**, never a mock-up you invented. Sample data in screenshots must be clearly fake or the person's own; if a screenshot shows someone else's data, crop it out or ask for another.
- Store screenshots are cropped to the real UI (`npx create-video-engine crop <img> --auto --out <file>`, `--status-bar` drops the iOS status bar; `--rect x,y,w,h` by hand if it exits 1), then put in a new, thin frame of the brand's own, never shown with their marketing caption. Never stretch or redraw UI.

## Fill the frame with the product

The real UI is the hero, so it is big: in 9:16 the phone screen is at least 80 % of the frame width, in 16:9 at least 55 % of the height. When the line talks about one part of the screen (a card, a button, a story box), push in on it or crop to it rather than showing the whole phone small. The product may run under the platform's buttons; only text and the call to action keep to safe zones. Never shrink the product to make the text fit; shorten the text. verify's `subject-scale` and `empty-area` are real defects here: fix them, do not explain them.

## Show it in use

The product is shown **in use**, not as a slide: things appear one by one, a tap or swipe is simulated on the real screen, text is typed, a state changes (empty → filled, draft → published). A screenshot that only pans is the weakest shot; at most one per video, and something on it must still happen (a highlight on the beat, a card sliding in).

Actions that satisfy "something happens on every beat that matters": the signature landing on the element the headline names, a simulated tap, a card sliding in, a push-in on the named part of the screen.

## Carry across cuts

Every scene change links to the next. With `parts/cve-motion/cve-motion.js` loaded, `CVE.carry(tl, fromEl, toEl, at, duration)` moves one element (a pin, a card, the phone) across the cut. It needs both elements in the one timeline that registers `window.__timelines`, and the outgoing scene must end where the incoming one starts. `parts/cve-motion/README.md` shows the two-scene pattern. Name the carried element in the SHOTS "transition out" column. The `nested_structure_needs_subcomposition` and `timeline_track_too_dense` warnings are acceptable when scenes share one root timeline for a carried element.

## Spec rows to add

- SHOTS: which screen and which part of it is the hero in each shot; the visible action and its beat.
- At most one pan-only screenshot shot.

## Sound

The product's own sound wins: if it plays a bell or tick, the matching cue kind is `confirm` or `end`; a stamp is `impact`. Music is composed with the edit as in the core.
