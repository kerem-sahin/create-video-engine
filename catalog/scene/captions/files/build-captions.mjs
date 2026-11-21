#!/usr/bin/env node
// build-captions: word JSON -> a HyperFrames caption sub-composition (static HTML + one paused GSAP timeline).
// Own code, zero dependencies. The HTML is written out, not made at runtime, so Studio can edit every group.
//
//   node build-captions.mjs --words cut.words.json --style clean|pop --aspect 16:9|9:16 --out compositions/captions.html
//        [--id captions] [--duration <s>] [--bottom <px>] [--max-words n] [--keep-punct] [--no-scrim]
//        [--accent] [--chip-opacity 0.92]
//
// Colours and fonts come from CSS variables (see frame-vars.mjs, which writes assets/brand.css from frame.md):
//   --c-ink --c-ground --c-accent   --f-display --w-display --t-display   --f-body --w-body
// Each has a plain fallback so the scene still renders without a brand file.
//
// Styles
//   clean  sentence lines: the whole group fades in on a chip of --c-ground (92 % opaque), two lines at most.
//          --accent turns the word being spoken --c-accent (colour only, no size change).
//   pop    word by word: 2-4 words per group, the word being spoken turns accent and grows (up to 12 %, less on long words).
// Spacing: words are inline-blocks with an explicit margin-right, the last one has none; the text nodes between them are
// <wbr> (a line-break chance, no width). A scaled word grows around its centre and would eat a fixed gap, so the pop
// scale is limited per word so the growth never exceeds 0.12em on a side.
// Rules followed (HyperFrames captions.md): one group visible at a time; a group opens at or just before its first
// word and closes after its last; never at exactly 0 s; hard kill after each exit; groups break at a sentence end,
// a pause or the word limit; captions sit inside the 80 % title-safe box (16:9) and the platform band (9:16).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) { const n = argv[i + 1]; if (n === undefined || n.startsWith("--")) a[argv[i].slice(2)] = true; else { a[argv[i].slice(2)] = n; i++; } }
const die = (m, c = 2) => { console.error("build-captions: " + m); process.exit(c); };
if (!a.words || !a.out) die("usage: build-captions.mjs --words <words.json> --style clean|pop --aspect 16:9|9:16 --out <compositions/captions.html>", 64);

const style = a.style || "clean";
const aspect = a.aspect || "16:9";
if (!["clean", "pop"].includes(style)) die("--style must be clean or pop", 64);
if (!["16:9", "9:16"].includes(aspect)) die("--aspect must be 16:9 or 9:16", 64);
const portrait = aspect === "9:16";
const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080;
const id = a.id || "captions";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r2 = (x) => Math.round(x * 100) / 100;

const j = JSON.parse(readFileSync(resolve(a.words), "utf8"));
const words = (j.words || j).map((x) => ({ w: x.w ?? x.text ?? x.word, start: +x.start, end: +x.end })).filter((x) => typeof x.w === "string").filter((x) => x.w.trim() && isFinite(x.start) && isFinite(x.end));
if (!words.length) die("no words");
words.sort((x, y) => x.start - y.start);

// ---- grouping --------------------------------------------------------------------------------
const cfg = style === "pop"
  ? { maxWords: +(a["max-words"] || (portrait ? 3 : 4)), maxChars: portrait ? 18 : 26, pause: 0.15 }
  : { maxWords: +(a["max-words"] || (portrait ? 6 : 9)), maxChars: portrait ? 40 : 80, pause: 0.4 };
const SENT = /[.!?…]["”')]*$/u;
const groups = [];
let cur = [];
const flush = () => { if (cur.length) groups.push(cur); cur = []; };
for (let i = 0; i < words.length; i++) {
  const w = words[i];
  const chars = cur.reduce((s, x) => s + x.w.length + 1, 0) + w.w.length;
  if (cur.length && (cur.length >= cfg.maxWords || chars > cfg.maxChars)) flush();
  cur.push(w);
  const next = words[i + 1];
  if (SENT.test(w.w) || (next && next.start - w.end >= cfg.pause) || (style === "clean" && /[,;:]$/.test(w.w) && cur.length >= 4)) flush();
}
flush();

// ---- timing ----------------------------------------------------------------------------------
const total = a.duration ? +a.duration : r2(words[words.length - 1].end + 0.5);
const gs = groups.map((g, i) => {
  let start = Math.max(0.1, g[0].start - 0.04);
  const nextStart = groups[i + 1] ? Math.max(0.1, groups[i + 1][0].start - 0.04) : total;
  let end = Math.min(g[g.length - 1].end + 0.25, nextStart, total);
  if (end - start < 0.3) end = Math.min(total, start + 0.3);
  return { g, start: r2(start), end: r2(end) };
});
for (let i = 0; i < gs.length - 1; i++) if (gs[i].end > gs[i + 1].start) gs[i].end = gs[i + 1].start;

// ---- html ------------------------------------------------------------------------------------
const bottom = +(a.bottom ?? (portrait ? 700 : 130));       // px from the frame bottom: 9:16 text stays above the platform's caption zone
const boxW = portrait ? 800 : 1536;                          // 80 % title-safe width
const sizeBase = style === "pop" ? (portrait ? 80 : 84) : (portrait ? 60 : 56);
const chipOpacity = a["chip-opacity"] && a["chip-opacity"] !== true ? Math.min(1, Math.max(0, +a["chip-opacity"])) : 0.92;
if (!isFinite(chipOpacity)) die("--chip-opacity must be a number between 0 and 1", 64);
const chip = `color-mix(in srgb, var(--c-ground, #000) ${Math.round(chipOpacity * 100)}%, transparent)`;
const popScale = (text) => Math.min(1.12, Math.round((1 + 0.24 / Math.max(1, text.length * 0.7)) * 1000) / 1000);   // 0.7em per glyph: wide-face upper estimate
const strip = (s) => (a["keep-punct"] || style === "clean" ? s : s.replace(/[.,;:]+$/u, ""));

const css = `
    #root { position: absolute; inset: 0; }
    #${id}-stage { position: absolute; left: 50%; bottom: ${bottom}px; width: ${boxW}px; margin-left: -${boxW / 2}px; height: 0; }
    .cap-g { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; }
    .cap-box { text-align: center; max-width: ${boxW}px; overflow: visible; }
    .cap-t { display: inline; }
    .cap-w { display: inline-block; margin-right: 0.3em; }
    .cap-w:last-child { margin-right: 0; }
${style === "clean" ? `    .cap-box { padding: 0; }
    .cap-t { font-family: var(--f-body, "Inter", sans-serif); font-weight: var(--w-body, 600); font-size: ${sizeBase}px; line-height: 1.5; letter-spacing: -0.01em;
      color: var(--c-ink, #fff); background: ${chip}; padding: 0.06em 0.5em; border-radius: 0.3em;
      -webkit-box-decoration-break: clone; box-decoration-break: clone; text-wrap: balance; }` : `    .cap-t { font-family: var(--f-display, "Montserrat", sans-serif); font-weight: var(--w-display, 800); font-size: ${sizeBase}px; line-height: 1.45; letter-spacing: var(--t-display, -0.02em);
      color: var(--c-ink, #fff); text-shadow: 0 0.04em 0.18em color-mix(in srgb, var(--c-ground, #000) 85%, transparent), 0 0 0.02em var(--c-ground, #000);${a["no-scrim"] ? "" : `
      background: ${chip}; padding: 0.04em 0.4em 0.06em; border-radius: 0.3em; -webkit-box-decoration-break: clone; box-decoration-break: clone;`} }
    .cap-w { transform-origin: 50% 70%; }`}
`;

let html = "";
let js = "";
gs.forEach(({ g, start, end }, gi) => {
  const gid = `${id}-g${gi}`;
  const dur = r2(end - start);
  html += `      <div class="clip cap-g" id="${gid}" data-start="${start}" data-duration="${dur}">\n        <div class="cap-box" id="${gid}-box"><span class="cap-t">`;
  html += g.map((w, wi) => `<span class="cap-w" id="${gid}-w${wi}">${esc(strip(w.w))}</span>`).join("<wbr>");
  html += `</span></div>\n      </div>\n`;
  // times inside the scene are absolute (the host starts at 0 of the video)
  js += `    tl.fromTo("#${gid}-box", { opacity: 0, y: ${portrait ? 14 : 10} }, { opacity: 1, y: 0, duration: 0.14, ease: "power2.out" }, ${start});\n`;
  if (style === "clean" && a.accent) {
    g.forEach((w, wi) => {
      const ws = r2(Math.max(start + 0.02, w.start)), we = r2(Math.max(ws + 0.12, Math.min(w.end, end - 0.05)));
      js += `    tl.fromTo("#${gid}-w${wi}", { color: "var(--c-ink, #fff)" }, { color: "var(--c-accent, #ffd84d)", duration: 0.09, ease: "power2.out", immediateRender: false }, ${ws});\n`;
      js += `    tl.to("#${gid}-w${wi}", { color: "var(--c-ink, #fff)", duration: 0.1, ease: "power2.in" }, ${r2(we)});\n`;
    });
  }
  if (style === "pop") {
    g.forEach((w, wi) => {
      const ws = r2(Math.max(start + 0.02, w.start)), we = r2(Math.max(ws + 0.12, Math.min(w.end, end - 0.05)));
      js += `    tl.fromTo("#${gid}-w${wi}", { color: "var(--c-ink, #fff)", scale: 1 }, { color: "var(--c-accent, #ffd84d)", scale: ${popScale(strip(w.w))}, duration: 0.09, ease: "power2.out", immediateRender: false }, ${ws});\n`;
      js += `    tl.to("#${gid}-w${wi}", { color: "var(--c-ink, #fff)", scale: 1, duration: 0.1, ease: "power2.in" }, ${r2(we)});\n`;
    });
  }
  const exitDur = Math.min(0.12, r2(dur - 0.14 - 0.06));      // exit fits between the entrance and the hard kill
  if (exitDur >= 0.04) js += `    tl.to("#${gid}-box", { opacity: 0, duration: ${exitDur}, ease: "power2.in" }, ${r2(end - 0.02 - exitDur)});\n`;
  js += `    tl.set("#${gid}-box", { opacity: 0, visibility: "hidden" }, ${end});\n`;
});

const out = `<template>
  <style>${css}  </style>
  <div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    <div id="${id}-stage">
${html}    </div>
  </div>
  <script>
    // Generated by build-captions.mjs (style ${style}, ${aspect}, ${gs.length} groups). Edit freely: this file is yours.
    const tl = gsap.timeline({ paused: true });
${js}    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
mkdirSync(dirname(resolve(a.out)), { recursive: true });
writeFileSync(resolve(a.out), out);
console.log(`build-captions: ${gs.length} groups (${style}, ${aspect}) -> ${resolve(a.out)}`);
console.log(`mount it in index.html:\n  <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="0" data-duration="${r2(total)}" data-track-index="3" data-track-kind="captions" data-width="${W}" data-height="${H}"></div>`);
