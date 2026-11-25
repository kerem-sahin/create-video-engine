# Lane: product launch

Launch, update, feature or "how it works" videos for an app or product, built from its real screens. Read after `make` step 0; it adds what is specific to product videos.

## Extra brief questions (fold into the one message)

- Which real flow shows the product in use: entry → key action → result?
- Which screenshots or screen recordings? Store screenshots (with device frame and caption) or raw captures?
- The one feature or claim the video is about, and the exact feature names as the product spells them.

## Story questions (answer in `BRIEF.md` before the three stories)

Which real flow shows it in use (entry → key action → result)? A stranger who sees the video once must know what it does, who it is for and how to get it. Example structures: problem → product → proof; one continuous walk-through; one bold claim proven three ways.

## Material rules

- Product shots are the **real product UI**, never a mock-up you invented. Sample data in screenshots must be clearly fake or the person's own; if a screenshot shows someone else's data, crop it out or ask for another.
- Store screenshots are cropped to the real UI (`npx create-video-engine crop <img> --auto --out <file>`, `--status-bar` drops the iOS status bar; `--rect x,y,w,h` by hand if it exits 1), never shown with their marketing caption. Never stretch or redraw UI.

## Show the part the line is about

A whole phone screenshot reads as a screenshot: its small UI text is unreadable in a feed, and a screen sliced by the frame edge looks like a mistake. Each shot shows **only the part of the screen the line talks about** (the photo box, the pin and its card, the story and its button), cropped from the real screen and large: about 85–95 % of the frame width, every edge of it inside the frame, nothing cut mid-card. Show the whole screen only when its layout is the point (e.g. "everything on one screen"), and then all of it, never cut by the frame edge. How the crop sits (a card with the brand's corner radius, a device, full bleed) is a brand decision in `STYLE.md`, set with the style frame. Shorten the text rather than shrinking the product. A small product in a big empty frame was the most common failure in our tests; a screenshot running off the bottom edge was the next.

## Show it in use

The product is shown **in use**, not as a slide: things appear one by one, a tap or swipe is simulated on the real screen, text is typed, a state changes (empty → filled, draft → published). A screenshot that only pans is the weakest shot; use it rarely, and let something on it still happen. When the line names an action ("tap", "share", "get directions"), the action is seen: the press on the real control (a brief press state, a ripple or a finger), then its result. A line about a tap with no visible press is a broken promise.

## Carry across cuts

Every scene change links to the next. With `parts/cve-motion/cve-motion.js` loaded, `CVE.carry(tl, fromEl, toEl, at, duration)` moves one element (a pin, a card, the phone) across the cut. It needs both elements in the one timeline that registers `window.__timelines`, and the outgoing scene must end where the incoming one starts. `parts/cve-motion/README.md` shows the two-scene pattern. The `nested_structure_needs_subcomposition` and `timeline_track_too_dense` warnings are acceptable when scenes share one root timeline for a carried element.

## Sound

The product's own sound wins: if it plays a bell or a tick, use the closest effect at that moment, never a louder one. Music as in `make` (none unless the person gives a track).
