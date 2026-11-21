#!/usr/bin/env node
// Proof assembly: writes a HyperFrames project (index.html + captions + one card) around cut.mp4.
//   node assemble.mjs <project-dir> <cut.mp4> <cut.words.json> <frame.md> <parts-dir> [16:9|9:16]
// <parts-dir> holds the part files (catalog/scene/captions/files, catalog/scene/overlay-cards/files).
import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
const [proj, video, words, frame, caps, cards, aspect = "16:9"] = process.argv.slice(2).map((x, i) => (i < 6 ? resolve(x) : x));
const P = aspect === "9:16", W = P ? 1080 : 1920, H = P ? 1920 : 1080;
const sh = (f, args) => { const r = spawnSync("node", [f, ...args], { encoding: "utf8" }); if (r.status) { console.error(r.stderr); process.exit(1); } return r.stdout; };
mkdirSync(join(proj, "assets"), { recursive: true });
mkdirSync(join(proj, "compositions"), { recursive: true });
copyFileSync(video, join(proj, "assets/cut.mp4"));
copyFileSync(frame, join(proj, "frame.md"));
sh(join(caps, "frame-vars.mjs"), [frame, "--out", join(proj, "assets/brand.css")]);
const dur = JSON.parse(readFileSync(words, "utf8")).duration;
sh(join(caps, "build-captions.mjs"), ["--words", words, "--style", process.env.CAPTION_STYLE || "pop", "--aspect", aspect, "--duration", String(dur), "--out", join(proj, "compositions/captions.html")]);
sh(join(cards, "build-card.mjs"), ["--kind", "lower-third", "--text", "Ayşe Demir", "--detail", "Eğitmen, örnek marka", "--aspect", aspect, "--frame", frame, "--face-x", process.env.FACE_X || "0.5", "--duration", "4", "--id", "card-name", "--out", join(proj, "compositions/card-name.html")]);
const video_style = P ? `object-fit: cover;` : `object-fit: cover;`;
writeFileSync(join(proj, "index.html"), `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <link rel="stylesheet" href="assets/brand.css" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: var(--c-ground, #000); }
      #talk { position: absolute; inset: 0; width: ${W}px; height: ${H}px; ${video_style} }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${dur}" data-width="${W}" data-height="${H}">
      <video id="talk" class="clip" src="assets/cut.mp4" data-start="0" data-duration="${dur}" data-has-audio="true" data-track-index="0"></video>
      <div id="card-name" data-composition-id="card-name" data-composition-src="compositions/card-name.html" data-start="1.2" data-duration="4" data-track-index="2" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>
      <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${dur}" data-track-index="3" data-track-kind="captions" data-width="${W}" data-height="${H}"></div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`);
console.log("assembled " + proj);
