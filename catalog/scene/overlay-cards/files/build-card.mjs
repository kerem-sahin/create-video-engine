#!/usr/bin/env node
// build-card: one overlay card -> a HyperFrames sub-composition (transparent, drawn over the speaker).
// Adapted from the Tier-2 label cards of nateherkai/herk-edit-kit style-library/02-kallaway (MIT + Herk Edit Kit Use
// Permission; see LICENSE and PIPELINE-USE-PERMISSION.txt next to this file). What was kept: the card anatomy
// (accent stripe + glass body, value / separator / label, pill over body) and the stagger of the entrance.
// What is ours: every colour, font and size comes from the brand's frame.md variables (CSS vars from frame-vars.mjs),
// no AIS palette, no glow, no external imports, and each card exists for 16:9 and 9:16.
//
//   node build-card.mjs --kind lower-third|takeaway|stat|quote|keyword --text "Ayşe Demir" [--detail "Fizyoterapist"]
//        --aspect 16:9|9:16 --duration 4 --out compositions/card-1.html [--id card-1] [--pos lower|upper] [--bottom px] [--top px]
//        [--face-x 0..1] [--side left|right] [--frame frame.md] [--signature] [--glass]
//
//   lower-third  --text name        --detail role / affiliation
//   takeaway     --text label (e.g. "KEY POINT")   --detail the sentence
//   stat         --text the number (e.g. "3x")      --detail what it measures
//   quote        --text the quote   --detail who said it (optional)
//   keyword      --text one term
//
// Mount (index.html): <div id="card-1" data-composition-id="card-1" data-composition-src="compositions/card-1.html"
//   data-start="<s>" data-duration="<same as --duration>" data-track-index="2" data-track-kind="graphics" data-width=".." data-height=".."></div>
// Defaults that follow the studio rules: no blur glass (backdrop-filter) unless --glass; text never below format.min_text_px
// (read from --frame or ./frame.md; else 48 at 16:9, 40 at 9:16); --signature draws the brand's underline under the name
// (lower-third) instead of the vertical stripe.
// Side (16:9): --face-x says where the speaker is (0 = left edge, 1 = right); the card goes to the other side. Without it
// the card goes bottom-left and the command says so. --side overrides.
// Placement for talking-head footage (docs overlays.md): 16:9 above the caption row on the side away from the face; 9:16 upper band
// (y >= 300 by default, clear of the platform UI and of the captions at ~600-700 px from the bottom). Cards never cover the face:
// move with --pos/--bottom/--top when the speaker sits elsewhere. Text is HTML-escaped; keep it short.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) { const n = argv[i + 1]; if (n === undefined || n.startsWith("--")) a[argv[i].slice(2)] = true; else { a[argv[i].slice(2)] = n; i++; } }
const die = (m, c = 2) => { console.error("build-card: " + m); process.exit(c); };
const KINDS = ["lower-third", "takeaway", "stat", "quote", "keyword"];
if (!KINDS.includes(a.kind) || !a.text || !a.out) die(`usage: build-card.mjs --kind ${KINDS.join("|")} --text "..." [--detail "..."] --aspect 16:9|9:16 --duration 4 --out <file>`, 64);
const aspect = a.aspect || "16:9";
if (!["16:9", "9:16"].includes(aspect)) die("--aspect must be 16:9 or 9:16", 64);
const P = aspect === "9:16";
const W = P ? 1080 : 1920, H = P ? 1920 : 1080;
const D = +(a.duration || 4);
if (!(D >= 1.5)) die("--duration must be at least 1.5 s (0.45 s in, 0.35 s out, time to read)", 64);
const id = a.id || `card-${a.kind}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = esc(a.text), detail = a.detail ? esc(a.detail) : "";
const IN = 0.45, OUT = 0.35, outAt = Math.round((D - OUT) * 100) / 100;

const pos = a.pos || (P ? "upper" : "lower");
const vert = pos === "upper" ? `top: ${+(a.top ?? (P ? 320 : 150))}px;` : `bottom: ${+(a.bottom ?? (P ? 760 : 320))}px;`;
const edge = P ? 140 : 192;                                   // 80 % title-safe box
const maxW = P ? 800 : 1000;

// floor for informational text: format.min_text_px of frame.md, else 48 (16:9) / 40 (9:16)
let minPx = P ? 40 : 48, minSrc = "default";
const frameFile = a.frame && a.frame !== true ? resolve(a.frame) : existsSync(resolve("frame.md")) ? resolve("frame.md") : null;
if (a.frame && !existsSync(frameFile)) die(`--frame ${a.frame} not found`, 64);
if (frameFile) {
  const fm = readFileSync(frameFile, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const m = fm && fm[1].match(/min_text_px:\s*(\d+)/);
  if (m) { minPx = +m[1]; minSrc = frameFile; }
}
const at = (n) => Math.max(n, minPx);
const base = P ? { big: 60, mid: 40, small: 40, stat: 168, quote: 58, kw: 96 } : { big: 56, mid: 48, small: 48, stat: 150, quote: 52, kw: 84 };
const sz = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, at(v)]));

// side: the card sits away from the face (16:9); 9:16 keeps the upper band on the left
let side = a.side, sideNote = "";
if (side && !["left", "right"].includes(side)) die("--side must be left or right", 64);
if (!side) {
  if (!P && a["face-x"] !== undefined && a["face-x"] !== true && isFinite(+a["face-x"])) side = +a["face-x"] >= 0.5 ? "left" : "right";
  else { side = "left"; if (!P) sideNote = "no --face-x given: card placed bottom-left. If the speaker is on the left, pass --face-x 0.3 (or --side right)."; }
}
const dir = side === "right" ? -1 : 1;                        // entrance direction: from the card's own edge
const left = `${side}: ${edge}px;`;

const glass = `background: color-mix(in srgb, var(--c-ground, #111) ${a.glass ? 80 : 92}%, transparent);${a.glass ? " -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);" : ""}
      border: 1px solid color-mix(in srgb, var(--c-ink, #fff) 20%, transparent); border-radius: 20px;`;

const kinds = {
  "lower-third": {
    css: `.c { position: absolute; ${left} ${vert} max-width: ${maxW}px; display: flex; ${glass} overflow: hidden; }
    .stripe { width: 8px; background: var(--c-accent, #ffb454); flex: none; }
    .sig { height: 5px; width: 160px; margin-top: 12px; background: var(--c-accent, #ffb454); transform-origin: 0 50%; }
    .in { padding: ${P ? "26px 36px" : "22px 34px"}; }
    .name { font-family: var(--f-display, "Montserrat", sans-serif); font-weight: var(--w-display, 800); letter-spacing: var(--t-display, -0.02em); font-size: ${sz.big}px; line-height: 1.1; color: var(--c-ink, #fff); }
    .role { margin-top: 6px; font-family: var(--f-body, "Inter", sans-serif); font-weight: var(--w-body, 500); font-size: ${sz.mid}px; line-height: 1.25; color: var(--c-muted, #bbb); }`,
    html: `<div class="c" id="${id}-c">${a.signature ? "" : `<div class="stripe" id="${id}-stripe"></div>`}<div class="in"><div class="name" id="${id}-a">${text}</div>${a.signature ? `<div class="sig" id="${id}-sig"></div>` : ""}${detail ? `<div class="role" id="${id}-b">${detail}</div>` : ""}</div></div>`,
    tl: `tl.fromTo("#${id}-c", { opacity: 0, x: ${-48 * dir} }, { opacity: 1, x: 0, duration: ${IN}, ease: "power3.out" }, 0);
    ${a.signature ? `tl.fromTo("#${id}-sig", { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: "power3.out" }, 0.25);` : `tl.fromTo("#${id}-stripe", { scaleY: 0 }, { scaleY: 1, duration: 0.4, ease: "power3.out" }, 0.15);`}
    ${detail ? `tl.fromTo("#${id}-b", { opacity: 0, x: ${-16 * dir} }, { opacity: 1, x: 0, duration: 0.4, ease: "power3.out" }, 0.3);` : ""}
    tl.to("#${id}-c", { opacity: 0, x: ${-24 * dir}, duration: ${OUT}, ease: "power2.in" }, ${outAt});`,
  },
  takeaway: {
    css: `.c { position: absolute; ${left} ${vert} width: ${maxW}px; max-width: ${maxW}px; }
    .pill { display: inline-block; padding: 8px 24px; border-radius: 999px; background: var(--c-accent, #ffb454); color: var(--c-ground, #111);
      font-family: var(--f-body, "Inter", sans-serif); font-weight: 700; font-size: ${sz.small}px; letter-spacing: 0.08em; margin-bottom: 14px; }
    .body { position: relative; ${glass} padding: ${P ? "30px 36px 30px 44px" : "26px 34px 26px 42px"}; }
    .rule { position: absolute; left: 0; top: 0; bottom: 0; width: 8px; background: var(--c-accent, #ffb454); border-radius: 20px 0 0 20px; }
    .txt { font-family: var(--f-body, "Inter", sans-serif); font-weight: var(--w-body, 600); font-size: ${at(sz.mid + 4)}px; line-height: 1.3; color: var(--c-ink, #fff); text-wrap: balance; }`,
    html: `<div class="c" id="${id}-c"><div class="pill" id="${id}-pill">${text}</div><div class="body" id="${id}-body"><div class="rule" id="${id}-rule"></div><div class="txt" id="${id}-txt">${detail}</div></div></div>`,
    tl: `tl.fromTo("#${id}-pill", { opacity: 0, y: -18 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, 0);
    tl.fromTo("#${id}-body", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: ${IN}, ease: "power3.out" }, 0.15);
    tl.fromTo("#${id}-rule", { scaleY: 0 }, { scaleY: 1, duration: 0.45, ease: "power3.out" }, 0.3);
    tl.fromTo("#${id}-txt", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, 0.35);
    tl.to("#${id}-c", { opacity: 0, y: 12, duration: ${OUT}, ease: "power2.in" }, ${outAt});`,
  },
  stat: {
    css: `.c { position: absolute; ${left} ${vert} min-width: ${P ? 520 : 460}px; max-width: ${maxW}px; ${glass} padding: ${P ? "30px 44px 28px" : "24px 44px 24px"}; }
    .val { font-family: var(--f-display, "Montserrat", sans-serif); font-weight: var(--w-display, 800); letter-spacing: var(--t-display, -0.02em); font-size: ${sz.stat}px; line-height: 1; color: var(--c-accent, #ffb454); }
    .sep { height: 2px; width: 100%; margin: 14px 0 12px; background: color-mix(in srgb, var(--c-ink, #fff) 35%, transparent); transform-origin: 0 50%; }
    .lab { font-family: var(--f-body, "Inter", sans-serif); font-weight: var(--w-body, 600); font-size: ${sz.mid}px; line-height: 1.25; color: var(--c-ink, #fff); }`,
    html: `<div class="c" id="${id}-c"><div class="val" id="${id}-a">${text}</div><div class="sep" id="${id}-sep"></div><div class="lab" id="${id}-b">${detail}</div></div>`,
    tl: `tl.fromTo("#${id}-c", { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: ${IN}, ease: "power3.out" }, 0);
    tl.fromTo("#${id}-a", { opacity: 0, y: -16 }, { opacity: 1, y: 0, duration: 0.45, ease: "power4.out" }, 0.2);
    tl.fromTo("#${id}-sep", { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: "power3.out" }, 0.45);
    tl.fromTo("#${id}-b", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, 0.55);
    tl.to("#${id}-c", { opacity: 0, y: 14, duration: ${OUT}, ease: "power2.in" }, ${outAt});`,
  },
  quote: {
    css: `.c { position: absolute; ${left} ${vert} width: ${maxW}px; max-width: ${maxW}px; ${glass} padding: ${P ? "34px 40px" : "30px 40px"}; }
    .mark { font-family: var(--f-display, "Montserrat", sans-serif); font-weight: 800; font-size: ${sz.quote * 1.8}px; line-height: 0.6; height: ${sz.quote * 0.7}px; color: var(--c-accent, #ffb454); }
    .q { font-family: var(--f-display, "Montserrat", sans-serif); font-weight: var(--w-display, 700); letter-spacing: var(--t-display, -0.01em); font-size: ${sz.quote}px; line-height: 1.2; color: var(--c-ink, #fff); text-wrap: balance; }
    .by { margin-top: 14px; font-family: var(--f-body, "Inter", sans-serif); font-weight: var(--w-body, 500); font-size: ${sz.small}px; color: var(--c-muted, #bbb); }`,
    html: `<div class="c" id="${id}-c"><div class="mark" id="${id}-mark">&ldquo;</div><div class="q" id="${id}-a">${text}</div>${detail ? `<div class="by" id="${id}-b">&mdash; ${detail}</div>` : ""}</div>`,
    tl: `tl.fromTo("#${id}-c", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: ${IN}, ease: "power3.out" }, 0);
    tl.fromTo("#${id}-mark", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.45, ease: "power3.out" }, 0.1);
    tl.fromTo("#${id}-a", { opacity: 0 }, { opacity: 1, duration: 0.45, ease: "power2.out" }, 0.25);
    ${detail ? `tl.fromTo("#${id}-b", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, 0.6);` : ""}
    tl.to("#${id}-c", { opacity: 0, y: 12, duration: ${OUT}, ease: "power2.in" }, ${outAt});`,
  },
  keyword: {
    css: `.c { position: absolute; ${left} ${vert} max-width: ${maxW}px; display: inline-block; padding: ${P ? "14px 40px" : "10px 36px"}; border-radius: 16px; background: var(--c-accent, #ffb454); }
    .kw { font-family: var(--f-display, "Montserrat", sans-serif); font-weight: var(--w-display, 800); letter-spacing: var(--t-display, -0.02em); font-size: ${sz.kw}px; line-height: 1.1; color: var(--c-ground, #111); text-wrap: balance; }`,
    html: `<div class="c" id="${id}-c"><div class="kw" id="${id}-a">${text}</div></div>`,
    tl: `tl.fromTo("#${id}-c", { opacity: 0, x: ${-40 * dir}, scale: 0.94 }, { opacity: 1, x: 0, scale: 1, duration: ${IN}, ease: "power3.out" }, 0);
    tl.to("#${id}-c", { opacity: 0, x: ${-20 * dir}, duration: ${OUT}, ease: "power2.in" }, ${outAt});`,
  },
};
const k = kinds[a.kind];
const out = `<template>
  <style>
    #root { position: absolute; inset: 0; }
    ${k.css}
  </style>
  <div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    ${k.html}
  </div>
  <script>
    // Generated by build-card.mjs (${a.kind}, ${aspect}, ${D} s). Edit freely: this file is yours.
    const tl = gsap.timeline({ paused: true });
    ${k.tl}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
mkdirSync(dirname(resolve(a.out)), { recursive: true });
writeFileSync(resolve(a.out), out);
console.log(`build-card: ${a.kind} (${aspect}, ${D} s) -> ${resolve(a.out)}`);
console.log(`  text floor ${minPx}px (${minSrc === "default" ? "default for " + aspect : "frame.md format.min_text_px"}), side ${side}${a.glass ? ", glass on" : ""}`);
if (sideNote) console.log("  note: " + sideNote);
console.log(`mount: <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="<s>" data-duration="${D}" data-track-index="2" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>`);
