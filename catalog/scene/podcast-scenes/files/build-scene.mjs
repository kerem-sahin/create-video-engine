#!/usr/bin/env node
// build-scene: one podcast scene block -> a HyperFrames sub-composition (a <template>, like overlay-cards' build-card.mjs).
// Own code. Every colour and font comes from the brand's frame.md (+ its `podcast:` block); the show's `look` switches the
// styling through CSS classes on the root (look-ink-sketch / look-clean), not through separate code. 16:9 and 9:16.
//
//   node build-scene.mjs --kind stage|waveform|punchline|quote|topic|reaction|lower-third
//        --aspect 16:9|9:16 --duration <s> --frame frame.md --out <project>/compositions/<id>.html [--id <id>]
//        [--text "..."] [--detail "..."] [--speaker A] [--look ink-sketch|clean] [--podcast podcast.json] [--parts <dir>]
//   stage:     [--mode full|bg|plates] [--turns turns.json] [--loop 8] [--background cover.png] [--bg-invert auto|yes|no]
//              full  = background + both speaker plates driven by the turns (for short pieces and previews);
//              bg    = only the background, one seamless --loop seconds long (assemble-long renders it once and loops it);
//              plates= a sheet, frame 2i = host i dim, frame 2i+1 = host i lit (assemble-long turns them into overlays).
//   waveform:  --levels levels.json (from levels.mjs) [--from <s>]   bars drawn from the pre-computed levels, no audio at render time
//   punchline: --text "Bir *dakika* yani"  (*word* is highlighted; the last word if none)  1-3.5 s
//   quote:     --text the line --speaker A (attributed to that host)
//   topic:     --text the chapter title [--detail "BOLUM 2"]
//   reaction:  --text exclaim,question,laugh,stars,shock (or ! ? !? ha) --speaker A (drawn beside that host's plate)
//   lower-third: --speaker A [--text name] [--detail role]   (name and role default to the host in podcast.hosts)
// The background image is copied to <project>/assets/. Mount: <div id=".." data-composition-id=".." data-composition-src="compositions/<id>.html"
//   data-start=".." data-duration="<same as --duration>" data-track-index="2" data-track-kind="graphics" data-width=".." data-height=".."></div>
import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve, basename, join } from "node:path";
import { KINDS, LOOKS, esc, r3, layout, fitText, barHeights, checkPodcast, podcastFromFrame, normalizeTurns, loadFrameVars, brandVars } from "./podcast.mjs";

const argv = process.argv.slice(2);
const a = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) { const n = argv[i + 1]; if (n === undefined || (n.startsWith("--") && !/^-\d/.test(n))) a[argv[i].slice(2)] = true; else { a[argv[i].slice(2)] = n; i++; } }
const die = (m, c = 2) => { console.error("build-scene: " + m); process.exit(c); };
if (!KINDS.includes(a.kind) || typeof a.out !== "string" || typeof a.frame !== "string") die(`usage: build-scene.mjs --kind ${KINDS.join("|")} --aspect 16:9|9:16 --duration <s> --frame frame.md --out <file> [--text ..] [--speaker A] (see the header of this file)`, 64);
const aspect = a.aspect || "16:9";
if (!["16:9", "9:16"].includes(aspect)) die("--aspect must be 16:9 or 9:16", 64);
const P = aspect === "9:16";
const L = layout(P), W = L.W, H = L.H;
const kind = a.kind;
const mode = a.mode || "full";
if (kind === "stage" && !["full", "bg", "plates"].includes(mode)) die("--mode must be full, bg or plates", 64);
const loopSec = +(a.loop || 8);
let D = +(a.duration ?? (kind === "stage" && mode === "bg" ? loopSec : NaN));
if (kind === "stage" && mode === "bg") D = loopSec;
const minDur = { punchline: 1, quote: 2, topic: 2, reaction: 1, "lower-third": 2, waveform: 1, stage: 0.1 }[kind];
if (kind !== "stage" || mode !== "plates") if (!(D >= minDur)) die(`--duration must be a number of at least ${minDur} s for a ${kind}`, 64);
if (kind === "stage" && !(loopSec >= 2)) die("--loop must be at least 2 s", 64);
const id = typeof a.id === "string" ? a.id : `${kind}-scene`;
if (!/^[\w-]+$/.test(id)) die("--id may contain letters, digits, - and _ only", 64);
const outFile = resolve(a.out);
if (!existsSync(resolve(a.frame))) die(`--frame ${a.frame} not found`, 64);

// ---- brand + show ----
const frameText = readFileSync(resolve(a.frame), "utf8");
let fv;
try { fv = await loadFrameVars(typeof a.parts === "string" ? resolve(a.parts) : null); } catch (e) { die(e.message); }
const frame = fv.parseFrame(frameText);
let podcast;
try {
  const raw = typeof a.podcast === "string" ? JSON.parse(readFileSync(resolve(a.podcast), "utf8")) : podcastFromFrame(frameText);
  if (!raw) die("frame.md has no `podcast:` block (and no --podcast file). Example: podcast: { look: \"ink-sketch\", background: \"assets/cover.png\", accent_alt: \"#fc3c44\", hosts: [{id: \"A\", name: \"Ali\", tag: \"Sunucu\"}, {id: \"B\", name: \"Veli\", tag: \"Sunucu\"}] }", 64);
  podcast = checkPodcast(raw, { lookOverride: typeof a.look === "string" ? a.look : null });
} catch (e) { die(e.message, 64); }
if (!LOOKS.includes(podcast.look)) die(`--look must be ${LOOKS.join(" or ")}`, 64);
const hosts = podcast.hosts;
const hostIdx = (sp) => { const i = hosts.findIndex((h) => h.id === String(sp)); return i; };
let minPx = P ? 40 : 48;
{ const fm = frameText.match(/^---\r?\n([\s\S]*?)\r?\n---/); const m = fm && fm[1].match(/min_text_px:\s*(\d+)/); if (m) minPx = +m[1]; }
const at = (n) => Math.max(n, minPx);
const text = typeof a.text === "string" ? a.text : "";
const detail = typeof a.detail === "string" ? a.detail : "";
const speaker = typeof a.speaker === "string" ? a.speaker : "";
if (speaker && hostIdx(speaker) < 0) die(`--speaker "${speaker}" is not one of the hosts (${hosts.map((h) => h.id).join(", ")})`, 64);
const notes = [];

// seeded random, so the doodles are the same on every run
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---- styling shared by every block: the two looks are CSS classes of the root ----
const rough = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="${id}-rough" x="-4%" y="-4%" width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="4"/></filter></svg>`;
const baseCss = `
    #root { position: absolute; inset: 0; overflow: hidden; ${brandVars(frame, podcast)} }
    #root * { box-sizing: border-box; margin: 0; padding: 0; }
    #root.look-ink-sketch { --bd: 3px solid var(--c-ink); --rad: 12px 5px 10px 6px / 5px 10px 6px 12px; --sh: 7px 7px 0 var(--c-accent);
      --fill: var(--c-ground); --rough: url(#${id}-rough); --stroke: var(--c-ink); --tsh: 0.05em 0.05em 0 var(--c-accent); --sw: 7px; }
    #root.look-clean { --bd: 0 solid transparent; --rad: 26px; --sh: 0 18px 50px rgba(0,0,0,0.45), inset 6px 0 0 var(--c-accent);
      --fill: color-mix(in srgb, var(--c-surface) 94%, transparent); --rough: none; --stroke: var(--c-accent); --tsh: 0 0.04em 0.28em rgba(0,0,0,0.55); --sw: 8px; }
    .box { position: relative; isolation: isolate; }
    .box::before { content: ""; position: absolute; inset: 0; z-index: -1; border: var(--bd); border-radius: var(--rad); background: var(--fill); box-shadow: var(--sh); filter: var(--rough); }
    .disp { font-family: var(--f-display); font-weight: var(--w-display); letter-spacing: var(--t-display); text-transform: uppercase; }
    .body { font-family: var(--f-body); font-weight: var(--w-body); }
    .scrim { position: absolute; background: radial-gradient(ellipse at center, color-mix(in srgb, var(--c-ground) 82%, transparent) 0%, color-mix(in srgb, var(--c-ground) 62%, transparent) 55%, transparent 78%); }
`;
const IN = 0.4, OUT = 0.3;
const C = L.center;
const lastAt = r3(D - OUT);

// ---- kinds ----
const k = {};

k.punchline = () => {
  // tokens: *word* is highlighted; the last word if none is marked
  const toks = []; let hl = false;
  for (const part of text.split(/(\*)/)) { if (part === "*") { hl = !hl; continue; } for (const w of part.split(/\s+/).filter(Boolean)) toks.push({ w, hl }); }
  if (!toks.length) die("--text is empty", 64);
  if (!toks.some((t) => t.hl)) toks[toks.length - 1].hl = true;
  const plain = toks.map((t) => t.w).join(" ");
  const fit = fitText(plain, { boxW: C.w * 0.92, boxH: C.h, maxPx: P ? 150 : 210, minPx: minPx, charW: 0.64, lineH: 1.02, maxLines: 3 });
  if (!fit.fits) notes.push(`text may not fit at ${fit.px}px (${plain.length} characters): shorten it`);
  const n = toks.length, step = Math.min(0.09, (D * 0.3) / n), t0 = 0.05;
  const rnd = rng(plain.length * 31 + n);
  let tl = `tl.fromTo("#${id}-scrim", { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" }, 0);\n`;
  toks.forEach((t, i) => {
    const s = r3(t0 + i * step), rot = r3((rnd() - 0.5) * 14);
    tl += `    tl.fromTo("#${id}-w${i}", { opacity: 0, scale: 0.15, y: 40, rotation: ${rot} }, { opacity: 1, scale: 1, y: 0, rotation: ${r3(rot / 5)}, duration: 0.34, ease: "back.out(2.6)" }, ${s});\n`;
    if (t.hl) tl += `    tl.fromTo("#${id}-u${i}", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.3, ease: "power2.out" }, ${r3(s + 0.18)});
    tl.to("#${id}-w${i}", { scale: 1.12, duration: 0.12, ease: "power2.out", yoyo: true, repeat: 1 }, ${r3(s + 0.34)});\n`;
  });
  const shakeAt = r3(Math.min(t0 + (n - 1) * step + 0.3, D - 0.8));
  tl += `    tl.to("#${id}-g", { keyframes: { x: [0, -16, 14, -10, 8, -4, 0], y: [0, 5, -4, 3, -2, 1, 0], rotation: [0, -1.6, 1.4, -0.9, 0.6, -0.3, 0] }, duration: 0.55, ease: "none" }, ${shakeAt});
    tl.to("#${id}-c", { opacity: 0, scale: 1.05, duration: ${OUT}, ease: "power2.in" }, ${lastAt});`;
  return {
    css: `.pl-c { position: absolute; left: ${C.x}px; top: ${C.y}px; width: ${C.w}px; height: ${C.h}px; display: flex; align-items: center; justify-content: center; }
    .pl-scrim { left: ${-C.x * 0.6}px; right: ${-C.x * 0.6}px; top: -10%; bottom: -10%; }
    .pl-g { position: relative; text-align: center; max-width: ${C.w * 0.94}px; font-size: ${fit.px}px; line-height: 1.02; text-wrap: balance; color: var(--c-ink); text-shadow: var(--tsh); }
    .pl-w { position: relative; display: inline-block; }
    .pl-w.hl { color: var(--c-accent); }
    .pl-u { position: absolute; left: -2%; width: 104%; bottom: -0.12em; height: 0.2em; overflow: visible; }
    .pl-u path { fill: none; stroke: var(--c-alt); stroke-width: 9; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; }`,
    html: `<div class="pl-c" id="${id}-c"><div class="scrim pl-scrim" id="${id}-scrim"></div><div class="pl-g disp" id="${id}-g">${toks.map((t, i) => `<span class="pl-w${t.hl ? " hl" : ""}" id="${id}-w${i}">${esc(t.w)}${t.hl ? `<svg class="pl-u" viewBox="0 0 200 16" preserveAspectRatio="none"><path id="${id}-u${i}" pathLength="1" d="M3 10 C 40 3, 80 14, 120 7 S 180 9, 197 5"/></svg>` : ""}</span>`).join(" ")}</div></div>`,
    tl,
  };
};

k.quote = () => {
  const host = hosts[Math.max(0, hostIdx(speaker))];
  const maxW = P ? 880 : 1360;
  const fit = fitText(text, { boxW: maxW - 150, boxH: C.h - 190, maxPx: P ? 72 : 96, minPx: Math.max(minPx, 44), charW: 0.56, lineH: 1.16, maxLines: 6 });
  if (!fit.fits) notes.push(`quote may not fit at ${fit.px}px (${text.length} characters): shorten it`);
  const words = text.trim().split(/\s+/);
  const step = Math.min(0.05, (D * 0.25) / words.length);
  return {
    css: `.qt-c { position: absolute; left: ${C.x}px; top: ${C.y}px; width: ${C.w}px; height: ${C.h}px; display: flex; align-items: center; justify-content: center; }
    .qt-box { width: ${maxW}px; padding: ${P ? "70px 48px 40px" : "70px 76px 44px"}; }
    .qt-mark { position: absolute; left: ${P ? 34 : 50}px; top: -54px; font-family: var(--f-display); font-weight: 800; font-size: 260px; line-height: 1; color: var(--c-alt); text-shadow: var(--tsh); }
    .qt-t { font-size: ${fit.px}px; line-height: 1.16; color: var(--c-ink); text-wrap: balance; font-family: var(--f-display); font-weight: var(--w-display); letter-spacing: var(--t-display); }
    .qt-w { display: inline-block; }
    .qt-by { margin-top: 26px; display: flex; align-items: center; gap: 16px; font-size: ${at(P ? 40 : 48)}px; color: var(--c-muted); }
    .qt-dot { width: 28px; height: 28px; border-radius: 50%; background: var(--c-accent); border: 3px solid var(--c-ink); flex: none; }
    .qt-by b { color: var(--c-ink); font-weight: 800; }`,
    html: `<div class="qt-c" id="${id}-c"><div class="box qt-box" id="${id}-box"><div class="qt-mark" id="${id}-mark">&ldquo;</div><div class="qt-t" id="${id}-t">${words.map((w, i) => `<span class="qt-w" id="${id}-w${i}">${esc(w)}</span>`).join(" ")}</div><div class="qt-by body" id="${id}-by"><span class="qt-dot"></span><span>${esc(host.name)}</span></div></div></div>`,
    tl: `tl.fromTo("#${id}-box", { opacity: 0, y: 44, rotation: -1.6 }, { opacity: 1, y: 0, rotation: 0, duration: ${IN}, ease: "back.out(1.6)" }, 0);
    tl.fromTo("#${id}-mark", { opacity: 0, scale: 0.3, rotation: -14 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.45, ease: "back.out(2.2)" }, 0.1);
    tl.fromTo(${JSON.stringify(words.map((_, i) => `#${id}-w${i}`))}, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: ${r3(step)} }, 0.25);
    tl.fromTo("#${id}-by", { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.35, ease: "power3.out" }, ${r3(Math.min(0.25 + words.length * step + 0.2, D - 0.9))});
    tl.to("#${id}-box", { opacity: 0, y: 16, duration: ${OUT}, ease: "power2.in" }, ${lastAt});`,
  };
};

k.topic = () => {
  const fit = fitText(text, { boxW: C.w * 0.86, boxH: C.h * 0.66, maxPx: P ? 100 : 130, minPx: Math.max(minPx, 56), charW: 0.64, lineH: 1.02, maxLines: 3 });
  if (!fit.fits) notes.push(`title may not fit at ${fit.px}px (${text.length} characters): shorten it`);
  const words = text.trim().split(/\s+/);
  return {
    css: `.tp-c { position: absolute; left: 0; top: ${C.y}px; width: ${W}px; height: ${C.h}px; display: flex; align-items: center; }
    .tp-band { position: absolute; left: 0; right: 0; top: 0; bottom: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--c-ground) 90%, transparent) 0%, color-mix(in srgb, var(--c-ground) 80%, transparent) 70%, transparent 100%); }
    .tp-in { position: relative; margin-left: ${C.x}px; max-width: ${C.w * 0.88}px; }
    .tp-chip { display: inline-block; font-size: ${at(P ? 36 : 40)}px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--c-ground); background: var(--c-accent); padding: 8px 26px; margin-bottom: 22px; border-radius: var(--rad); }
    .tp-t { font-size: ${fit.px}px; line-height: 1.02; color: var(--c-ink); text-wrap: balance; text-shadow: var(--tsh); }
    .tp-w { display: inline-block; }
    .tp-line { display: block; width: 100%; height: 28px; margin-top: 20px; overflow: visible; }
    .tp-line path { fill: none; stroke: var(--c-alt); stroke-width: 9; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; }`,
    html: `<div class="tp-c" id="${id}-c"><div class="tp-band" id="${id}-band"></div><div class="tp-in">${detail ? `<div class="tp-chip body" id="${id}-chip">${esc(detail)}</div>` : ""}<div class="tp-t disp" id="${id}-t">${words.map((w, i) => `<span class="tp-w" id="${id}-w${i}">${esc(w)}</span>`).join(" ")}</div><svg class="tp-line" viewBox="0 0 800 28" preserveAspectRatio="none"><path id="${id}-line" pathLength="1" d="M4 16 C 120 4, 240 24, 380 12 S 640 20, 796 8"/></svg></div></div>`,
    tl: `tl.fromTo("#${id}-band", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.45, ease: "power3.out" }, 0);
    ${detail ? `tl.fromTo("#${id}-chip", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.35, ease: "power3.out" }, 0.15);` : ""}
    tl.fromTo(${JSON.stringify(words.map((_, i) => `#${id}-w${i}`))}, { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out", stagger: ${r3(Math.min(0.08, (D * 0.2) / words.length))} }, 0.25);
    tl.fromTo("#${id}-line", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, 0.5);
    tl.to("#${id}-c", { opacity: 0, x: -40, duration: ${OUT}, ease: "power2.in" }, ${lastAt});`,
  };
};

// reaction marks, SVG strokes in a 200x200 box. Every path is a stroke (no fills, no emoji font, no images).
const dot = (cx, cy) => `M${cx} ${cy} L${cx + 0.1} ${cy}`;
const ray = (cx, cy, r0, r1, deg) => { const t = (deg * Math.PI) / 180; return `M${r3(cx + r0 * Math.cos(t))} ${r3(cy + r0 * Math.sin(t))} L${r3(cx + r1 * Math.cos(t))} ${r3(cy + r1 * Math.sin(t))}`; };
const star = (cx, cy, r) => { const p = []; for (let i = 0; i < 10; i++) { const t = ((i * 36 - 90) * Math.PI) / 180, rr = i % 2 ? r * 0.42 : r; p.push(`${r3(cx + rr * Math.cos(t))} ${r3(cy + rr * Math.sin(t))}`); } return `M${p.join(" L")} Z`; };
const MARKS = {
  exclaim: [{ d: "M100 24 C 97 58, 105 92, 100 128" }, { d: dot(100, 164), acc: 1 }],
  question: [{ d: "M58 76 C 54 26, 146 22, 144 72 C 142 110, 100 108, 100 138" }, { d: dot(100, 172), acc: 1 }],
  laugh: [{ d: "M44 112 Q100 196 156 112 Z" }, { d: ray(100, 100, 74, 100, -150), acc: 1 }, { d: ray(100, 100, 74, 100, -120), acc: 1 }, { d: ray(100, 100, 74, 100, -90), acc: 1 }, { d: ray(100, 100, 74, 100, -60), acc: 1 }, { d: ray(100, 100, 74, 100, -30), acc: 1 }],
  stars: [{ d: star(70, 118, 44) }, { d: star(144, 66, 28), acc: 1 }, { d: star(150, 150, 22), acc: 1 }],
  shock: [{ d: "M70 34 C 70 34, 40 82, 70 106 C 100 82, 70 34, 70 34 Z" }, { d: ray(134, 120, 20, 60, -70), acc: 1 }, { d: ray(134, 120, 20, 66, -20), acc: 1 }, { d: ray(134, 120, 20, 58, 30), acc: 1 }, { d: ray(134, 120, 20, 52, 80), acc: 1 }],
};
const ALIAS = { "!": ["exclaim"], "?": ["question"], "!?": ["exclaim", "question"], "?!": ["question", "exclaim"], "!!": ["exclaim", "exclaim"], ha: ["laugh"], haha: ["laugh"], star: ["stars"], wow: ["shock"] };
k.reaction = () => {
  const names = text.split(/[,\s]+/).filter(Boolean).flatMap((t) => ALIAS[t.toLowerCase()] || [t.toLowerCase()]).slice(0, 3);
  const bad = names.filter((n) => !MARKS[n]);
  if (bad.length || !names.length) die(`--text names the marks: ${Object.keys(MARKS).join(", ")} (or ! ? !? ha); unknown: ${bad.join(", ") || "none given"}`, 64);
  const hi = Math.max(0, hostIdx(speaker)), R = L.react;
  const size = P ? 190 : 220, gap = 10;
  const rowW = names.length * size + (names.length - 1) * gap;
  const left = hi === 0 ? L.plate.xs[0] + 10 : L.plate.xs[1] + L.plate.w - rowW - 10;
  let tl = "";
  names.forEach((nm, i) => {
    const s = r3(i * 0.14);
    MARKS[nm].forEach((_, j) => { tl += `tl.fromTo("#${id}-m${i}-${j}", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.3, ease: "power2.out" }, ${r3(s + j * 0.07)});\n    `; });
    tl += `tl.fromTo("#${id}-g${i}", { scale: 0.6, rotation: ${hi === 0 ? -12 : 12} }, { scale: 1, rotation: 0, duration: 0.45, ease: "back.out(2.4)", transformOrigin: "50% 50%" }, ${s});
    tl.to("#${id}-g${i}", { keyframes: { rotation: [0, -7, 6, -4, 3, 0] }, duration: 0.7, ease: "none", transformOrigin: "50% 50%" }, ${r3(Math.min(s + 0.5, D - 1))});\n    `;
  });
  tl += `tl.to("#${id}-c", { opacity: 0, y: -12, duration: ${OUT}, ease: "power2.in" }, ${lastAt});`;
  return {
    css: `.rc-c { position: absolute; left: ${left}px; top: ${R.y}px; width: ${rowW}px; height: ${size}px; display: flex; gap: ${gap}px; }
    .rc-g { width: ${size}px; height: ${size}px; overflow: visible; }
    .rc-g path { fill: none; stroke: var(--c-ink); stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; }
    .rc-g { filter: var(--rough); }
    #root.look-clean .rc-g path { stroke: var(--c-accent); stroke-width: 10; }
    .rc-g path.acc { stroke: var(--c-accent); }
    #root.look-clean .rc-g path.acc { stroke: var(--c-alt); }`,
    html: `<div class="rc-c" id="${id}-c">${names.map((nm, i) => `<svg class="rc-g" id="${id}-g${i}" viewBox="0 0 200 200">${MARKS[nm].map((p, j) => `<path id="${id}-m${i}-${j}" class="${p.acc ? "acc" : ""}" pathLength="1" d="${p.d}"/>`).join("")}</svg>`).join("")}</div>`,
    tl,
  };
};

k["lower-third"] = () => {
  const hi = Math.max(0, hostIdx(speaker)), host = hosts[hi];
  const name = text || host.name, role = detail || host.tag;
  const LT = L.lower, right = hi === 1;
  const dir = right ? 1 : -1;
  return {
    css: `.lt-c { position: absolute; ${right ? "right" : "left"}: ${LT.edge}px; bottom: ${H - LT.bottom}px; max-width: ${LT.maxW}px; }
    .lt-box { padding: ${P ? "24px 40px 24px 48px" : "22px 44px 22px 52px"}; }
    .lt-name { font-size: ${at(P ? 56 : 64)}px; line-height: 1.08; color: var(--c-ink); }
    .lt-role { margin-top: 6px; font-size: ${at(P ? 40 : 46)}px; line-height: 1.2; color: var(--c-muted); }
    .lt-bar { position: absolute; ${right ? "right" : "left"}: 0; top: 14px; bottom: 14px; width: 12px; background: var(--c-accent); transform-origin: 50% 0; }`,
    html: `<div class="lt-c" id="${id}-c"><div class="box lt-box" id="${id}-box"><div class="lt-bar" id="${id}-bar"></div><div class="lt-name disp" id="${id}-a">${esc(name)}</div>${role ? `<div class="lt-role body" id="${id}-b">${esc(role)}</div>` : ""}</div></div>`,
    tl: `tl.fromTo("#${id}-box", { opacity: 0, x: ${60 * dir} }, { opacity: 1, x: 0, duration: ${IN}, ease: "power3.out" }, 0);
    tl.fromTo("#${id}-bar", { scaleY: 0 }, { scaleY: 1, duration: 0.4, ease: "power3.out" }, 0.15);
    ${role ? `tl.fromTo("#${id}-b", { opacity: 0, x: ${24 * dir} }, { opacity: 1, x: 0, duration: 0.4, ease: "power3.out" }, 0.3);` : ""}
    tl.to("#${id}-box", { opacity: 0, x: ${30 * dir}, duration: ${OUT}, ease: "power2.in" }, ${lastAt});`,
  };
};

k.waveform = () => {
  if (typeof a.levels !== "string" || !existsSync(resolve(a.levels))) die("--levels levels.json is required (made by levels.mjs)", 64);
  const lv = JSON.parse(readFileSync(resolve(a.levels), "utf8"));
  const fps = lv.fps || 30, from = Math.round((+(a.from || 0)) * fps), nF = Math.round(D * fps), nBars = P ? 30 : 44;
  const frames = [];
  for (let f = 0; f < nF; f++) frames.push(barHeights(lv.levels, from + f, nBars).map((v) => Math.round(v * 100)));
  const w = P ? 880 : 1240, h = P ? 220 : 240;
  return {
    css: `.wf-c { position: absolute; left: ${(W - w) / 2}px; top: ${C.y + (C.h - h) / 2}px; width: ${w}px; height: ${h}px; display: flex; align-items: center; justify-content: space-between; padding: 0 30px; }
    .wf-c .wf-b { width: ${P ? 14 : 18}px; height: 100%; background: var(--c-accent); transform: scaleY(0.04); transform-origin: 50% 50%; border-radius: ${podcast.look === "clean" ? "9px" : "2px"}; }
    #root.look-ink-sketch .wf-b { background: var(--c-ink); filter: var(--rough); }
    #root.look-ink-sketch .wf-b:nth-child(4n+1) { background: var(--c-accent); }`,
    html: `<div class="box wf-c" id="${id}-c">${Array.from({ length: nBars }, (_, i) => `<div class="wf-b" id="${id}-b${i}"></div>`).join("")}</div>`,
    tl: `const FR = ${JSON.stringify(frames)};
    const bars = ${JSON.stringify(Array.from({ length: nBars }, (_, i) => `#${id}-b${i}`))};
    FR.forEach((row, f) => { row.forEach((v, i) => tl.set(bars[i], { scaleY: v / 100 }, f / ${fps} + 0.0005)); });
    tl.fromTo("#${id}-c", { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0);
    tl.to("#${id}-c", { opacity: 0, duration: ${OUT} }, ${lastAt});`,
  };
};

// ---- stage: background + speaker plates ----
const FACE = [
  // hair / hat for each host design (drawn above the head, head circle is centred at 60,66 r 40)
  `<path class="hair" d="M24 52 L30 22 L42 40 L52 14 L62 38 L74 12 L80 38 L94 22 L96 54"/>`,
  `<path class="hair" d="M22 56 C 22 20, 98 20, 98 56 Z"/><path class="hair" d="M96 52 L118 58"/>`,
  `<path class="hair" d="M26 46 C 30 16, 90 16, 94 46"/><circle class="hair" cx="46" cy="66" r="13"/><circle class="hair" cx="76" cy="66" r="13"/><path class="hair" d="M59 66 L63 66"/>`,
];
const plateHtml = (h, i, state) => {
  const x = L.plate.xs[Math.min(i, L.plate.xs.length - 1)];
  const avail = L.plate.w - 40 - (P ? 100 : 112) - 22;
  const px = Math.max(26, Math.min(P ? 44 : 52, Math.floor(avail / (Math.max(3, h.name.length) * 0.62))));
  if (px < minPx && !notes.some((n) => n.startsWith("plate name"))) notes.push(`plate name "${h.name}" is set at ${px}px, below the ${minPx}px text floor: it is a corner label; use a shorter name if it must reach the floor`);
  return `<div class="st-plate ${state}" id="${id}-p${i}" style="left:${x}px;top:${L.plate.y}px;width:${L.plate.w}px;height:${L.plate.h}px"><div class="box st-card"><svg class="st-av" viewBox="0 0 120 120"><circle class="head" cx="60" cy="66" r="40"/>${FACE[i % FACE.length]}<circle class="eye" cx="46" cy="62" r="4.5"/><circle class="eye" cx="74" cy="62" r="4.5"/><path class="m-shut" d="M46 82 Q60 90 74 82"/><path class="m-open" d="M46 80 Q60 104 74 80 Z"/></svg><div class="st-name disp" style="font-size:${px}px">${esc(h.name)}</div></div></div>`;
};
const plateCss = () => `
    .st-plate { position: absolute; opacity: 0.55; transform-origin: 50% 50%; }
    .st-card { width: 100%; height: 100%; display: flex; align-items: center; gap: 22px; padding: 0 24px 0 20px; }
    .st-av { width: ${P ? 100 : 112}px; height: ${P ? 100 : 112}px; flex: none; overflow: visible; }
    .st-av { filter: var(--rough); }
    .st-av .head { fill: var(--c-ground); stroke: var(--c-ink); stroke-width: 4.5; }
    .st-av .hair { fill: none; stroke: var(--c-ink); stroke-width: 4.5; stroke-linecap: round; stroke-linejoin: round; }
    .st-av .eye { fill: var(--c-ink); }
    .st-av .m-shut { fill: none; stroke: var(--c-ink); stroke-width: 4.5; stroke-linecap: round; }
    .st-av .m-open { fill: var(--c-ground); stroke: var(--c-ink); stroke-width: 4.5; stroke-linejoin: round; display: none; }
    .st-name { color: var(--c-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.05; }
    #root.look-ink-sketch .st-plate.dim { --bd: 3px solid color-mix(in srgb, var(--c-ink) 55%, transparent); --sh: none; }
    #root.look-clean .st-plate.dim { --sh: 0 10px 30px rgba(0,0,0,0.35); }
    .st-plate.lit { opacity: 1; }
    .st-plate.lit .m-shut { display: none; }
    .st-plate.lit .m-open { display: block; }
    #root.look-ink-sketch .st-plate.lit .head { fill: color-mix(in srgb, var(--c-accent) 30%, var(--c-ground)); }
    #root.look-clean .st-plate.lit { --sh: 0 14px 40px rgba(0,0,0,0.5), 0 0 0 4px var(--c-accent), inset 6px 0 0 var(--c-accent); }
    #root.look-clean .st-av .head { fill: var(--c-surface); stroke: var(--c-accent); }
    #root.look-clean .st-av .hair, #root.look-clean .st-av .m-shut, #root.look-clean .st-av .m-open { stroke: var(--c-accent); }
    #root.look-clean .st-av .eye { fill: var(--c-accent); }`;

function bgPieces() {
  const rnd = rng(11);
  let artSrc = "", invert = false;
  const bgPath = typeof a.background === "string" ? a.background : (podcast.background || "");
  if (bgPath) {
    const base = [resolve(bgPath), resolve(dirname(resolve(a.frame)), bgPath)].find((p) => existsSync(p));
    if (!base) die(`background image not found: ${bgPath} (looked next to the cwd and next to frame.md)`, 64);
    const assets = join(dirname(dirname(outFile)), "assets");
    mkdirSync(assets, { recursive: true });
    const mode = a["bg-invert"] === undefined ? "auto" : String(a["bg-invert"]);
    if (mode === "yes") invert = true;
    else if (mode === "auto" && podcast.look === "ink-sketch") {
      const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-i", base, "-vf", "scale=1:1,format=gray", "-f", "rawvideo", "-"], { encoding: "buffer" });
      const luma = r.status === 0 && r.stdout.length ? r.stdout[0] / 255 : 0;
      invert = luma > 0.6;
      notes.push(`background luma ${luma.toFixed(2)}: ${invert ? "inverted (white paper becomes the dark ground)" : "used as is"}`);
    }
    // the cover is baked once (inverted, soft-edged, blurred for the clean look) so Chrome only moves a plain image
    const name = `stage-art-${podcast.look}.png`;
    const fade = "255*clip((1-hypot((X-W/2)/(W/2)\\,(Y-H/2)/(H/2)))/0.4\\,0\\,1)";
    const vf = ["scale=1280:1280:force_original_aspect_ratio=decrease", ...(invert ? ["negate"] : []), ...(podcast.look === "clean" ? ["gblur=sigma=14"] : []), "format=rgba", `geq=r=r(X\\,Y):g=g(X\\,Y):b=b(X\\,Y):a=${fade}`].join(",");
    const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", base, "-vf", vf, "-frames:v", "1", join(assets, name)], { encoding: "utf8" });
    if (r.status !== 0) die("ffmpeg could not prepare the background image: " + (r.stderr || "").slice(-400));
    artSrc = "assets/" + name;
  }
  const side = Math.round((P ? W : H) * 1.08);
  const doodles = [];
  if (podcast.look === "ink-sketch") {
    const shapes = [
      `<path d="M0 -14 L0 14 M-12 -7 L12 7 M-12 7 L12 -7"/>`, `<path d="M-12 0 L12 0 M0 -12 L0 12"/>`, `<circle r="11"/>`,
      `<path d="M-16 4 C -10 -10, -4 10, 2 -4 S 12 8, 16 -2"/>`, `<path d="M0 -14 L4 -4 L15 -4 L6 3 L10 14 L0 7 L-10 14 L-6 3 L-15 -4 L-4 -4 Z"/>`,
    ];
    for (let i = 0; i < 16; i++) {
      const x = 40 + rnd() * (W - 80), y = 40 + rnd() * (H - 80);
      doodles.push({ x: r3(x), y: r3(y), s: r3(0.9 + rnd() * 1.1), k: 1 + (i % 2), ph: r3(rnd() * 6.283), amp: r3(26 + rnd() * 40), shape: shapes[i % shapes.length], rot: r3((rnd() - 0.5) * 60) });
    }
  }
  const css = `
    .st-bg { position: absolute; inset: 0; background: var(--c-ground); overflow: hidden; }
    .st-art { position: absolute; width: ${side}px; height: ${side}px; left: ${(W - side) / 2}px; top: ${(H - side) / 2}px; object-fit: contain; transform-origin: 50% 50%; opacity: ${podcast.look === "clean" ? 0.34 : 0.55}; }
    .st-blob { position: absolute; border-radius: 50%; filter: blur(110px); }
    .st-doodle { position: absolute; left: -30px; top: -30px; width: 60px; height: 60px; overflow: visible; }
    .st-doodle * { fill: none; stroke: color-mix(in srgb, var(--c-ink) 48%, transparent); stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; }
    .st-vig { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 46%, transparent 42%, color-mix(in srgb, var(--c-ground) 92%, transparent) 100%); }`;
  const blobs = podcast.look === "clean" ? [{ x: W * 0.25, y: H * 0.3, d: W * 0.5, c: "var(--c-accent)", o: 0.1 }, { x: W * 0.75, y: H * 0.7, d: W * 0.45, c: "var(--c-alt)", o: 0.08 }] : [];
  const html = `<div class="st-bg" id="${id}-bg"><svg width="0" height="0" style="position:absolute"></svg>${artSrc ? `<img class="st-art" id="${id}-art" src="${artSrc}" alt="">` : ""}${blobs.map((b, i) => `<div class="st-blob" id="${id}-blob${i}" style="left:${r3(b.x - b.d / 2)}px;top:${r3(b.y - b.d / 2)}px;width:${r3(b.d)}px;height:${r3(b.d)}px;background:${b.c};opacity:${b.o}"></div>`).join("")}${doodles.map((d, i) => `<svg class="st-doodle" viewBox="-30 -30 60 60" id="${id}-d${i}" style="transform:translate(${d.x}px,${d.y}px) scale(${d.s}) rotate(${d.rot}deg)">${d.shape}</svg>`).join("")}<div class="st-vig"></div></div>`;
  // every motion is a sum of sines whose period divides the loop: frame 0 and frame loop*fps are the same picture
  const tl = `const LOOP = ${loopSec}, TAU = Math.PI * 2;
    const art = document.getElementById("${id}-art");
    const blobs = ${JSON.stringify(blobs.map((_, i) => `${id}-blob${i}`))}.map((s) => document.getElementById(s));
    const dd = ${JSON.stringify(doodles.map((d) => ({ i: `${id}-d${doodles.indexOf(d)}`, x: d.x, y: d.y, s: d.s, k: d.k, ph: d.ph, amp: d.amp, rot: d.rot })))}.map((d) => ({ ...d, el: document.getElementById(d.i) }));
    const motion = (p) => {
      const t = p * TAU;
      if (art) gsap.set(art, { scale: 1.02 + 0.02 * Math.sin(t), x: 30 * Math.sin(t + 0.6), y: 18 * Math.cos(t) });
      blobs.forEach((b, i) => gsap.set(b, { x: 150 * Math.sin(t + i * 2.1), y: 90 * Math.cos(t + i * 1.3), scale: 1 + 0.12 * Math.sin(t * 2 + i) }));
      dd.forEach((d) => gsap.set(d.el, { x: d.x + d.amp * Math.sin(t * d.k + d.ph), y: d.y + d.amp * 0.6 * Math.cos(t * d.k + d.ph), rotation: d.rot + 14 * Math.sin(t * d.k + d.ph) }));
    };
    const prog = { p: 0 };
    motion(0);
    tl.to(prog, { p: 1, duration: LOOP, ease: "none", repeat: ${Math.max(0, Math.ceil(D / loopSec) - 1)}, onUpdate: () => motion(prog.p) }, 0);`;
  return { css, html, tl };
}

k.stage = () => {
  if (mode === "plates") {
    const states = hosts.flatMap((h, i) => [{ h, i, st: "dim" }, { h, i, st: "lit" }]);
    return {
      dur: states.length / 30,
      css: plateCss() + `\n    .st-frame { position: absolute; inset: 0; visibility: hidden; } .st-plate { opacity: 1; } .st-plate.dim { opacity: 0.55; }`,
      html: states.map((s, f) => `<div id="${id}-f${f}" class="st-frame">${plateHtml(s.h, s.i, s.st)}</div>`).join("\n      "),
      tl: states.map((_, f) => `tl.set("#${id}-f${f}", { visibility: "visible" }, ${r3(Math.max(0, (f - 0.5) / 30))});\n    tl.set("#${id}-f${f}", { visibility: "hidden" }, ${r3((f + 0.5) / 30)});`).join("\n    "),
    };
  }
  const bg = bgPieces();
  if (mode === "bg") return bg;
  let turns = [];
  if (typeof a.turns === "string") {
    try { turns = normalizeTurns(JSON.parse(readFileSync(resolve(a.turns), "utf8")), { hostIds: hosts.map((h) => h.id) }).turns; } catch (e) { die(e.message, 64); }
  }
  let tl = bg.tl + "\n";
  for (const t of turns) {
    const i = hostIdx(t.speaker);
    if (t.start >= D) continue;
    const e = Math.min(t.end, D);
    tl += `    tl.set("#${id}-p${i}", { className: "st-plate lit" }, ${r3(t.start)});
    tl.to("#${id}-p${i}", { opacity: 1, scale: 1.05, duration: 0.18, ease: "power2.out" }, ${r3(t.start)});
    tl.set("#${id}-p${i}", { className: "st-plate dim" }, ${r3(e)});
    tl.to("#${id}-p${i}", { opacity: 0.55, scale: 1, duration: 0.25, ease: "power2.in" }, ${r3(e)});\n`;
  }
  return { css: bg.css + plateCss(), html: bg.html + hosts.map((h, i) => plateHtml(h, i, "dim")).join(""), tl };
};

const body = k[kind]();
const dur = body.dur ?? D;
const out = `<template>
  <style>
${baseCss}
    ${body.css}
  </style>
  <div id="root" class="look-${podcast.look}" lang="${podcast.lang || "tr"}" data-composition-id="${id}" data-width="${W}" data-height="${H}">
    ${rough}
    ${body.html}
  </div>
  <script>
    // Generated by build-scene.mjs (${kind}${kind === "stage" ? " " + mode : ""}, ${aspect}, ${r3(dur)} s, look ${podcast.look}). Edit freely: this file is yours.
    const tl = gsap.timeline({ paused: true });
    ${body.tl}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`;
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out);
console.log(`build-scene: ${kind}${kind === "stage" ? " (" + mode + ")" : ""} (${aspect}, ${r3(dur)} s, ${podcast.look}) -> ${outFile}`);
for (const n of notes) console.log("  note: " + n);
console.log(`mount: <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="<s>" data-duration="${r3(dur)}" data-track-index="2" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>`);
