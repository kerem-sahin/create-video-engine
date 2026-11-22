#!/usr/bin/env node
// assemble-long: the fast final assembly for long talking-head videos (10-30 min).
// The footage is NEVER pushed through Chrome frame by frame. ffmpeg builds the video; HyperFrames renders only the few
// things that need a browser, each once, as transparent overlays:
//   - captions: every caption STATE (a group of words with the spoken word highlighted) is drawn once, as a still, in
//     one small HyperFrames render (one frame per state); ffmpeg shows each still for its time span. ~1 frame per word.
//   - cards: all cards go into ONE HyperFrames render on a transparent ground (WebM, VP9 with alpha); ffmpeg overlays
//     each card's window at its start time.
//   - audio: -16 LUFS, true peak <= -1 dBTP: gain + limiter in a short audio-only pass that is measured and corrected
//     before the video is encoded (the encode then copies that audio); the finished file is measured again.
// Input is the CUT file from silence-cut (constant frame rate, from `normalize`), and its retimed word JSON.
// Why stills and not ffmpeg's subtitles/ass filter? That filter needs libass, and the Homebrew ffmpeg 9.0.2 on the
// maker's Mac has none (no `ass`, `subtitles` or `drawtext` filter; no libfreetype). The run checks `ffmpeg -filters`
// and records `libass_available` in the report; the stills path is used either way, because it was the only one
// that could be tested here. An ASS path for ffmpeg builds with libass is not written.
//
//   node assemble-long.mjs assemble --video cut.mp4 --words cut.words.json --frame frame.md --out final.mp4
//        [--captions pop|clean|none] [--accent] [--band bottom|top|y=<px>] [--cards cards.json] [--chapters chapters.json]
//        [--aspect 16:9|9:16] [--lufs -16] [--crf 18] [--preset veryfast] [--encoder x264|videotoolbox [--bitrate 14M]] [--fonts "Family=file.ttf,..."]
//        [--hf <hyperframes binary>] [--parts <dir with captions/ and overlay-cards/>] [--work <dir>] [--keep-work]
//   node assemble-long.mjs chapters --chapters chapters.json (--duration <s> | --video final.mp4) [--out chapters.txt]
//   node assemble-long.mjs srt --words cut.words.json --out final.srt
//   node assemble-long.mjs slice --audio cut.m4a --from <s> --to <s> --out-dir <clip>/assets [--words words.json] [--turns speakers.json] [--scenes scenes.json]
//      one clip out of the cut episode: clip.m4a (sample-accurate, short fades) plus words/speakers/scenes moved to the clip's clock;
//      boundaries never split a word and move to the nearest sentence edge within --snap s (0 = off); slice.json records what moved.
//
// cards.json: [{ "kind": "lower-third|takeaway|stat|quote|keyword", "text": "...", "detail": "...", "start": 12.5, "duration": 4,
//                "side": "left|right", "face-x": 0.5, "pos": "lower|upper", "bottom": 320, "top": 150, "signature": true, "glass": true }]
//   (times are in the cut video's clock; every other field is passed to the overlay-cards part's build-card.mjs)
// chapters.json: [{ "start": 0, "title": "Intro" }, ...] in the final video's clock; checked against YouTube's rules
//   (first at 0:00, at least 3, each at least 10 s) before anything is rendered.
// --band: where the caption block sits. bottom (default): above the platform/safe zone (16:9: 130 px from the bottom, 9:16:
//   700 px); top: 100 px (16:9) / 280 px (9:16) from the top; y=<px>: the block's bottom edge at that y from the top.
// Outputs: <out> (H.264 + AAC MP4, faststart), <out without extension>.srt, chapters.txt next to <out> (with --chapters),
//   <out>.assemble.json (every measurement). Exit: 0 ok, 1 a measured check failed, 2 cannot run, 64 usage.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, copyFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cleanWords, groupWords, captionStates, toSrt, validateChapters, chaptersText, r3 } from "./text.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) { const n = argv[i + 1]; if (n === undefined || (n.startsWith("--") && !/^-\d/.test(n))) a[t.slice(2)] = true; else { a[t.slice(2)] = n; i++; } } else a._.push(t);
  }
  return a;
}
let workDir = null, keepWork = false;
const cleanup = () => { if (workDir && !keepWork) rmSync(workDir, { recursive: true, force: true }); };
const die = (m, c = 2) => { console.error("assemble-long: " + m); cleanup(); process.exit(c); };
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opts });
  if (r.error) die(`cannot run ${cmd}: ${r.error.message}`);
  return r;
};
const frac = (s) => { if (!s || s === "0/0") return null; const [n, d = 1] = String(s).split("/").map(Number); return n && d ? n / d : null; };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function probe(file) {
  const r = run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (r.status !== 0) die(`ffprobe failed on ${file}: ${r.stderr.trim()}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video"), au = j.streams.find((s) => s.codec_type === "audio");
  return { v, au, duration: parseFloat(j.format.duration), fps: frac(v?.r_frame_rate), avg: frac(v?.avg_frame_rate) };
}
function frameCount(file) {
  const r = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file]);
  return parseInt(r.stdout, 10);
}
const stepSpread = (file) => {
  const r = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file]);
  const t = r.stdout.trim().split("\n").map(parseFloat).filter(isFinite).sort((x, y) => x - y);
  let lo = Infinity, hi = 0;
  for (let i = 1; i < t.length; i++) { const d = t[i] - t[i - 1]; lo = Math.min(lo, d); hi = Math.max(hi, d); }
  return { lo, hi, n: t.length };
};

// ---- locating the other parts / hyperframes ---------------------------------------------------------
function findScript(a, part, file, catalogRel) {
  const cands = [];
  if (typeof a.parts === "string") cands.push(join(resolve(a.parts), part, file));
  cands.push(join(HERE, "..", part, file), join(HERE, "..", "..", "..", ...catalogRel, "files", file));
  return cands.find((p) => existsSync(p)) || die(`cannot find ${file} of the ${part} part (looked in: ${cands.join(", ")}). Install it (add ${part}) or pass --parts <dir>.`);
}
function findHf(a) {
  if (typeof a.hf === "string") return a.hf;
  if (process.env.HYPERFRAMES_BIN) return process.env.HYPERFRAMES_BIN;
  for (const start of [process.cwd(), HERE]) {
    let d = resolve(start);
    for (;;) {
      const p = join(d, "node_modules", ".bin", "hyperframes");
      if (existsSync(p)) return p;
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return die("hyperframes is not installed here. Run this from inside the studio (npm install), or pass --hf <path>.");
}
const hfEnv = { ...process.env, HYPERFRAMES_TELEMETRY: "0", DO_NOT_TRACK: "1" };
function hfRender(hf, project, args) {
  const r = run(hf, ["render", project, "--quiet", ...args], { env: hfEnv });
  if (r.status !== 0) die("hyperframes render failed:\n" + (r.stderr || r.stdout).slice(-1500));
}

// ---- loudness ---------------------------------------------------------------------------------------
function measureLoudness(file) {
  // ebur128 is the same BS.1770 measurement loudnorm makes first, about 5x faster (loudnorm's analysis dominated a 28 min podcast)
  const r = run("ffmpeg", ["-hide_banner", "-nostdin", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"]);
  const sum = r.stderr.slice(Math.max(0, r.stderr.lastIndexOf("Integrated loudness:")));
  const num = (re) => { const m = sum.match(re); return m ? (m[1] === "-inf" ? -120 : +m[1]) : NaN; };
  const i = num(/\bI:\s+(-?[\d.]+|-inf) LUFS/), tpk = num(/Peak:\s+(-?[\d.]+|-inf) dBFS/), lra = num(/LRA:\s+(-?[\d.]+) LU/);
  if (!isFinite(i) || !isFinite(tpk)) die("loudness measurement failed:\n" + r.stderr.slice(-600));
  return { i, tp: tpk, lra };
}

// Gain + peak limiter instead of loudnorm: a quiet phone recording needs +15 dB, which loudnorm's linear mode cannot give
// within a true-peak ceiling (it falls back to a dynamic mode and the file came out at +1.3 dBTP). Here: the gain that moves
// the measured loudness to the target, a limiter under the ceiling, AAC; the result is MEASURED and corrected (gain by the
// loudness error, limiter by the peak overshoot), at most 3 times. The video pass then copies this audio untouched.
function buildAudio(video, dir, target, before) {
  let gain = target - before.i, limit = 0.7;   // 0.7 = -3.1 dBFS; AAC and inter-sample peaks stay under -1 dBTP
  const file = join(dir, "audio.m4a");
  const tries = [];
  for (let k = 0; k < 3; k++) {
    const r = run("ffmpeg", ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y", "-i", video, "-vn", "-map", "0:a:0",
      "-af", `volume=${gain.toFixed(3)}dB,alimiter=limit=${limit.toFixed(4)}:attack=5:release=60:level=disabled,aresample=48000`, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", file]);
    if (r.status !== 0) die("audio pass failed:\n" + r.stderr.slice(-800));
    const m = measureLoudness(file);
    tries.push({ gain_db: r3(gain), limit: r3(limit), lufs: m.i, true_peak: m.tp });
    const err = target - m.i;
    if (Math.abs(err) <= 0.4 && m.tp <= -1.2) break;
    if (m.tp > -1.2) limit *= 10 ** (-(m.tp + 1.5) / 20);
    if (Math.abs(err) > 0.4) gain += err;
  }
  return { file, tries };
}

// ---- caption stills -----------------------------------------------------------------------------------
const CAP = { // sizes and boxes as in build-captions.mjs
  size: (style, portrait) => (style === "pop" ? (portrait ? 80 : 84) : portrait ? 60 : 56),
  boxW: (portrait) => (portrait ? 800 : 1536),
  bandH: (style, portrait) => (portrait ? 420 : style === "pop" ? 300 : 260),
};
function bandPlacement(band, portrait, H, bandH) {
  const b = band === undefined || band === true ? "bottom" : String(band);
  let bottomEdge;
  if (b === "bottom") bottomEdge = H - (portrait ? 700 : 130);
  else if (b === "top") bottomEdge = (portrait ? 280 : 100) + bandH;
  else if (/^y=\d+(\.\d+)?$/.test(b)) bottomEdge = +b.slice(2);
  else die("--band must be bottom, top or y=<px>", 64);
  const y0 = Math.round(bottomEdge - bandH);
  if (y0 < 0 || y0 + bandH > H) die(`--band ${b}: the ${bandH}px caption band would fall outside the ${H}px frame`, 64);
  return { y0, anchor: b === "top" ? "flex-start" : "flex-end", name: b };
}
function captionSheetHtml({ groups, states, style, portrait, W, bandH, anchor, accent, fps, fontCss, chipOpacity = 0.92 }) {
  const size = CAP.size(style, portrait), boxW = CAP.boxW(portrait);
  const chip = `color-mix(in srgb, var(--c-ground, #000) ${Math.round(chipOpacity * 100)}%, transparent)`;
  const popScale = (text) => Math.min(1.12, Math.round((1 + 0.24 / Math.max(1, text.length * 0.7)) * 1000) / 1000);
  const strip = (s) => (style === "clean" ? s : s.replace(/[.,;:]+$/u, ""));
  const css = `
    ${fontCss}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${W}px; height: ${bandH}px; overflow: hidden; background: transparent; }
    #root { position: absolute; inset: 0; }
    .st { position: absolute; left: 0; right: 0; top: 0; bottom: 0; display: flex; justify-content: center; align-items: ${anchor}; visibility: hidden; }
    .cap-box { text-align: center; max-width: ${boxW}px; overflow: visible; }
    .cap-t { display: inline; }
    .cap-w { display: inline-block; margin-right: 0.3em; color: var(--c-ink, #fff); }
    .cap-w:last-child { margin-right: 0; }
${style === "clean" ? `    .cap-t { font-family: var(--f-body, "Inter", sans-serif); font-weight: var(--w-body, 600); font-size: ${size}px; line-height: 1.5; letter-spacing: -0.01em;
      color: var(--c-ink, #fff); background: ${chip}; padding: 0.06em 0.5em; border-radius: 0.3em;
      -webkit-box-decoration-break: clone; box-decoration-break: clone; text-wrap: balance; }` : `    .cap-t { font-family: var(--f-display, "Montserrat", sans-serif); font-weight: var(--w-display, 800); font-size: ${size}px; line-height: 1.45; letter-spacing: var(--t-display, -0.02em);
      color: var(--c-ink, #fff); text-shadow: 0 0.04em 0.18em color-mix(in srgb, var(--c-ground, #000) 85%, transparent), 0 0 0.02em var(--c-ground, #000);
      background: ${chip}; padding: 0.04em 0.4em 0.06em; border-radius: 0.3em; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
    .cap-w { transform-origin: 50% 70%; }`}
    .cap-w.on { color: var(--c-accent, #ffd84d); }
`;
  let html = "", js = "";
  states.forEach((s, k) => {
    const g = groups[s.group];
    html += `      <div class="st" id="s${k}"><div class="cap-box"><span class="cap-t">`;
    html += g.map((w, wi) => {
      const on = s.word === wi;
      const text = strip(w.w);
      const sc = on && style === "pop" ? ` style="transform: scale(${popScale(text)})"` : "";
      return `<span class="cap-w${on ? " on" : ""}"${sc}>${esc(text)}</span>`;
    }).join("<wbr>");
    html += `</span></div></div>\n`;
    js += `    tl.set("#s${k}", { visibility: "visible" }, ${r3(k / fps - 0.0005)});\n    tl.set("#s${k}", { visibility: "hidden" }, ${r3((k + 1) / fps - 0.0005)});\n`;
  });
  return { css, html, js, dur: states.length / fps, accent };
}
function sheetProject(dir, { W, H, dur, css, body, js, brandCss, fontsFrom, id = "main" }) {
  mkdirSync(join(dir, "assets"), { recursive: true });
  if (fontsFrom && existsSync(fontsFrom)) for (const f of readdirSync(fontsFrom)) { mkdirSync(join(dir, "fonts"), { recursive: true }); copyFileSync(join(fontsFrom, f), join(dir, "fonts", f)); }
  writeFileSync(join(dir, "assets/brand.css"), brandCss);
  writeFileSync(join(dir, "index.html"), `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <link rel="stylesheet" href="assets/brand.css" />
    <style>${css}</style>
  </head>
  <body>
    <div id="root" data-composition-id="${id}" data-start="0" data-duration="${r3(dur)}" data-width="${W}" data-height="${H}">
${body}    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
${js}      window.__timelines["${id}"] = tl;
    </script>
  </body>
</html>
`);
}

// ---- caption stills: render the states once, then lay them on the frame grid ---------------------------------------
// Returns { entries: [{file, f0, f1}], blank, stats, placement }; writeCaptionList turns a frame range of it into an ffconcat list.
function captionPlan({ hf, workDir, words, style, portrait, W, H, duration, fps, band, accent, brandCss, fontCss }) {
  const bandH = CAP.bandH(style, portrait);
  const placement = bandPlacement(band, portrait, H, bandH);
  const highlight = style === "pop" || accent;
  const groups = groupWords(words, style, portrait);
  const states = captionStates(groups, { fps, total: duration, highlight });
  if (!states.length) die("no caption states (no words?)");
  const sheet = captionSheetHtml({ groups, states, style, portrait, W, bandH, anchor: placement.anchor, accent: highlight, fps: 30, fontCss: fontCss.replace(/\.\.\/fonts/g, "fonts") });
  const proj = join(workDir, "captions-proj");
  sheetProject(proj, { W, H: bandH, dur: sheet.dur, css: sheet.css, body: sheet.html, js: sheet.js, brandCss, fontsFrom: join(workDir, "fonts") });
  const framesDir = join(workDir, "captions-frames");
  hfRender(hf, proj, ["--format", "png-sequence", "--fps", "30", "-o", framesDir]);
  const pngs = readdirSync(framesDir).filter((f) => f.endsWith(".png")).sort();
  if (pngs.length < states.length) die(`captions: ${states.length} states but HyperFrames wrote ${pngs.length} frames`);
  const blank = join(workDir, "blank.png");
  const rb = run("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", `color=c=black@0:s=${W}x${bandH},format=rgba`, "-frames:v", "1", blank]);
  if (rb.status !== 0) die("blank still failed: " + rb.stderr);
  const entries = states.map((s, k) => ({ file: join(framesDir, pngs[k]), f0: Math.round(s.from * fps), f1: Math.round(s.to * fps) }));
  return { entries, blank, placement, stats: { style, groups: groups.length, states: states.length, band: placement.name, band_y: placement.y0, band_height: bandH, highlight } };
}
// frames [from, to) of the plan as an ffconcat list (times start at 0); a blank still wherever nothing shows
function writeCaptionList(plan, from, to, fps, listPath) {
  const lines = ["ffconcat version 1.0"];
  const put = (file, n) => { if (n > 0) lines.push(`file '${file.replace(/'/g, "'\\''")}'`, `duration ${(n / fps).toFixed(6)}`); };
  let t = from;
  for (const e of plan.entries) {
    if (e.f1 <= from || e.f0 >= to) continue;
    const f0 = Math.max(e.f0, from, t), f1 = Math.min(e.f1, to);
    if (f1 <= f0) continue;
    put(plan.blank, f0 - t);
    put(e.file, f1 - f0);
    t = f1;
  }
  put(plan.blank, to - t);
  lines.push(`file '${plan.blank}'`);
  writeFileSync(listPath, lines.join("\n") + "\n");
}

// ---- assemble ---------------------------------------------------------------------------------------
async function assemble(a) {
  const need = ["video", "words", "frame", "out"].filter((k) => typeof a[k] !== "string");
  if (need.length) die(`usage: assemble --video cut.mp4 --words cut.words.json --frame frame.md --out final.mp4 (missing --${need.join(", --")})`, 64);
  const video = resolve(a.video), out = resolve(a.out);
  for (const f of [video, resolve(a.words), resolve(a.frame)]) if (!existsSync(f)) die(`no such file: ${f}`);
  if (video === out) die("--out must differ from --video", 64);
  const captionsMode = a.captions === undefined || a.captions === true ? "pop" : String(a.captions);
  if (!["pop", "clean", "none"].includes(captionsMode)) die("--captions must be pop, clean or none", 64);
  // TP is only the ceiling handed to the loudnorm *measurement*; the real limit (<= -1 dBTP on the file) is checked on the output
  const lufs = a.lufs === undefined ? -16 : +a.lufs, TP = -2;
  if (!isFinite(lufs) || lufs > -5 || lufs < -40) die("--lufs must be a number such as -16", 64);
  const t0 = Date.now();
  const filtersList = run("ffmpeg", ["-hide_banner", "-filters"]).stdout;
  const libass = /\s(ass|subtitles)\s/.test(filtersList);
  const stages = [];
  const stage = (name, since) => { const s = r3((Date.now() - since) / 1000); stages.push({ stage: name, seconds: s }); console.log(`  ${name}: ${s}s`); };

  const src = probe(video);
  if (!src.v) die("the video has no video stream");
  if (!src.fps) die("cannot read the frame rate");
  const spread = stepSpread(video);
  const cfr = spread.hi - spread.lo < 0.0005;
  if (!cfr) console.error(`assemble-long: warning: ${video} is not constant frame rate (frame step ${r3(spread.lo * 1000)}..${r3(spread.hi * 1000)} ms). Run normalize.mjs before transcribing and cutting, or captions will not line up.`);
  const portrait = a.aspect ? a.aspect === "9:16" : src.v.height > src.v.width;
  if (a.aspect && !["16:9", "9:16"].includes(a.aspect)) die("--aspect must be 16:9 or 9:16", 64);
  const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080;
  const fpsText = src.v.r_frame_rate, fps = src.fps;
  const duration = src.duration;
  const words = cleanWords(JSON.parse(readFileSync(resolve(a.words), "utf8")));

  // chapters first: refuse before any rendering
  let chapters = null;
  if (a.chapters) {
    chapters = JSON.parse(readFileSync(resolve(a.chapters), "utf8"));
    const errs = validateChapters(chapters, duration);
    if (errs.length) die("chapters invalid:\n  " + errs.join("\n  "), 1);
  }
  let cards = [];
  if (a.cards) {
    cards = JSON.parse(readFileSync(resolve(a.cards), "utf8"));
    if (!Array.isArray(cards)) die("--cards must be a JSON array", 64);
    cards.forEach((c, i) => {
      c.duration = +(c.duration ?? 4);
      if (!(c.start >= 0) || !(c.duration >= 1.5) || c.start + c.duration > duration + 0.001) die(`card ${i}: start ${c.start} + duration ${c.duration} must lie inside the video (${r3(duration)} s), duration >= 1.5 s`, 64);
      if (!c.kind || !c.text) die(`card ${i}: needs kind and text`, 64);
    });
  }

  workDir = a.work ? resolve(a.work) : join(dirname(out), ".assemble-work-" + basename(out).replace(/\W+/g, "_"));
  keepWork = !!a["keep-work"] || !!a.work;
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  mkdirSync(dirname(out), { recursive: true });

  const frameVarsPath = findScript(a, "captions", "frame-vars.mjs", ["scene", "captions"]);
  const { parseFrame, toCss } = await import(pathToFileURL(frameVarsPath).href);
  const frameText = readFileSync(resolve(a.frame), "utf8");
  let brandCss = toCss(parseFrame(frameText));
  let fontCss = "";
  if (typeof a.fonts === "string") {
    mkdirSync(join(workDir, "fonts"), { recursive: true });
    for (const pair of a.fonts.split(",")) {
      const [fam, file] = pair.split("=");
      if (!fam || !file || !existsSync(resolve(file))) die(`--fonts: "${pair}" must be Family=path/to/font.ttf and the file must exist`, 64);
      const name = basename(file);
      copyFileSync(resolve(file), join(workDir, "fonts", name));
      fontCss += `@font-face { font-family: "${fam}"; src: url("../fonts/${name}"); }\n`;
    }
  }
  const hf = (captionsMode !== "none" || cards.length) ? findHf(a) : null;

  // ---- 1. caption stills ----
  let capInputs = null, capPlacement = null, capStats = null;
  if (captionsMode !== "none") {
    const s0 = Date.now();
    const plan = captionPlan({ hf, workDir, words, style: captionsMode, portrait, W, H, duration, fps, band: a.band, accent: !!a.accent, brandCss, fontCss });
    capPlacement = plan.placement; capStats = plan.stats;
    capInputs = join(workDir, "captions.ffconcat");
    writeCaptionList(plan, 0, Math.round(duration * fps), fps, capInputs);
    stage(`captions (${plan.stats.states} stills)`, s0);
  }

  // ---- 2. cards (one transparent render) ----
  let cardsWebm = null;
  if (cards.length) {
    const s0 = Date.now();
    const buildCard = findScript(a, "overlay-cards", "build-card.mjs", ["scene", "overlay-cards"]);
    const proj = join(workDir, "cards-proj");
    mkdirSync(join(proj, "compositions"), { recursive: true });
    let body = "", off = 0;
    const slots = cards.map((c, i) => {
      const id = `card-${i}`;
      const args = ["--aspect", portrait ? "9:16" : "16:9", "--frame", resolve(a.frame), "--out", join(proj, "compositions", id + ".html"), "--id", id];
      for (const [k, v] of Object.entries(c)) {
        if (["start", "id", "out", "frame", "aspect"].includes(k)) continue;
        args.push("--" + k, ...(v === true ? [] : [String(v)]));
      }
      const r = run(process.execPath, [buildCard, ...args]);
      if (r.status !== 0) die(`card ${i}: build-card failed: ${(r.stderr || r.stdout).trim()}`);
      body += `      <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${r3(off)}" data-duration="${c.duration}" data-track-index="2" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>\n`;
      const slot = { offset: off, duration: c.duration, start: c.start };
      off += c.duration;
      return slot;
    });
    sheetProject(proj, { W, H, dur: off, css: `* { margin: 0; padding: 0; box-sizing: border-box; } html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: transparent; }`, body, js: "", brandCss: brandCss + fontCss, fontsFrom: join(workDir, "fonts") });
    cardsWebm = join(workDir, "cards.webm");
    hfRender(hf, proj, ["--format", "webm", "--fps", String(Math.round(fps)), "-o", cardsWebm]);
    if (!existsSync(cardsWebm)) die("cards: HyperFrames wrote no file");
    cards.forEach((c, i) => Object.assign(c, { _slot: slots[i] }));
    stage(`cards (${cards.length} in one transparent render)`, s0);
  }

  // ---- 3. loudness measurement ----
  let s0 = Date.now();
  const before = src.au ? measureLoudness(video) : null;
  const audioMade = src.au ? buildAudio(video, workDir, lufs, before) : null;
  stage(`audio: measure, gain + limiter, re-measure (${audioMade ? audioMade.tries.length : 0} pass(es))`, s0);

  // ---- 4. ffmpeg assembly ----
  s0 = Date.now();
  const inputs = ["-i", video];
  const f = [];
  // overlays are drawn on a 1920x1080 / 1080x1920 canvas; a video with nothing overlaid keeps its own size
  const needScale = (capInputs || cards.length) && (src.v.width !== W || src.v.height !== H);
  f.push(needScale ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[b0]` : `[0:v]setsar=1[b0]`);
  let cur = "b0", n = 1;
  if (capInputs) {
    inputs.push("-f", "concat", "-safe", "0", "-i", capInputs);
    f.push(`[${n}:v]format=rgba[cap]`);
    f.push(`[${cur}][cap]overlay=x=0:y=${capPlacement.y0}:eof_action=pass:format=auto[b1]`);
    cur = "b1"; n++;
  }
  cards.forEach((c, i) => {
    const s = c._slot;
    inputs.push("-ss", s.offset.toFixed(3), "-t", s.duration.toFixed(3), "-c:v", "libvpx-vp9", "-i", cardsWebm);
    f.push(`[${n}:v]setpts=PTS-STARTPTS+${c.start.toFixed(3)}/TB[c${i}]`);
    f.push(`[${cur}][c${i}]overlay=x=0:y=0:eof_action=pass:format=auto:enable='between(t,${c.start.toFixed(3)},${(c.start + c.duration).toFixed(3)})'[k${i}]`);
    cur = `k${i}`; n++;
  });
  f.push(`[${cur}]format=yuv420p[vout]`);
  if (audioMade) inputs.push("-i", audioMade.file);
  const args = ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y", ...inputs, "-filter_complex", f.join(";"), "-map", "[vout]"];
  if (src.au) {
    args.push("-map", `${n}:a:0`, "-c:a", "copy");
  }
  const enc = a.encoder === undefined ? "x264" : String(a.encoder);
  if (!["x264", "videotoolbox"].includes(enc)) die("--encoder must be x264 (default, deterministic) or videotoolbox (Mac media engine, ~3x faster)", 64);
  args.push(...(enc === "x264" ? ["-c:v", "libx264", "-preset", String(a.preset ?? "veryfast"), "-crf", String(a.crf ?? 18)] : ["-c:v", "h264_videotoolbox", "-b:v", String(a.bitrate ?? "14M"), "-profile:v", "high"]), "-r", fpsText, "-g", String(Math.round(fps)), "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-t", duration.toFixed(6), "-movflags", "+faststart", out);
  const r = run("ffmpeg", args);
  if (r.status !== 0) die("ffmpeg assembly failed:\n" + r.stderr.slice(-2000));
  stage("ffmpeg assembly (overlays + encode)", s0);

  // ---- 5. text outputs ----
  const srtPath = out.replace(/\.[^.]+$/, "") + ".srt";
  writeFileSync(srtPath, toSrt(words));
  let chaptersPath = null;
  const outInfo = probe(out);
  if (chapters) { chaptersPath = join(dirname(out), "chapters.txt"); writeFileSync(chaptersPath, chaptersText(chapters, outInfo.duration)); }

  // ---- 6. measure what was made ----
  const problems = [];
  const after = src.au ? measureLoudness(out) : null;
  if (after) {
    if (Math.abs(after.i - lufs) > 1.0) problems.push(`integrated loudness ${after.i} LUFS, target ${lufs} (+-1)`);
    if (after.tp > -1.0) problems.push(`true peak ${after.tp} dBTP is above -1`);
  }
  const inFrames = frameCount(video), outFrames = frameCount(out);
  if (inFrames !== outFrames) problems.push(`frame count changed: ${inFrames} in, ${outFrames} out`);
  const vDur = parseFloat(outInfo.v.duration), aDur = outInfo.au ? parseFloat(outInfo.au.duration) : null;
  if (aDur !== null && Math.abs(vDur - aDur) > 1 / fps) problems.push(`picture ${r3(vDur)} s and sound ${r3(aDur)} s differ by more than one frame`);
  if (Math.abs(outInfo.duration - duration) > 2 / fps) problems.push(`duration ${r3(outInfo.duration)} s, input ${r3(duration)} s`);
  const o = spread; // input spread, kept in the report
  const report = {
    schema: 1, out, srt: srtPath, chapters: chaptersPath, seconds_total: r3((Date.now() - t0) / 1000), stages,
    video: { seconds: r3(outInfo.duration), width: outInfo.v.width, height: outInfo.v.height, fps: fpsText, frames_in: inFrames, frames_out: outFrames, codec: outInfo.v.codec_name, input_constant_frame_rate: cfr, input_frame_step_ms: [r3(o.lo * 1000), r3(o.hi * 1000)] },
    audio: after ? { codec: outInfo.au.codec_name, sample_rate: outInfo.au.sample_rate, before: { lufs: before.i, true_peak: before.tp }, after: { lufs: after.i, true_peak: after.tp }, target_lufs: lufs, true_peak_limit: -1, passes: audioMade.tries } : null,
    captions: capStats, libass_available: libass, cards: cards.map((c) => ({ kind: c.kind, start: c.start, duration: c.duration })),
    overlay_path: cards.length ? "transparent WebM (VP9 alpha) rendered once by HyperFrames, overlaid by ffmpeg" : null,
    problems,
  };
  writeFileSync(out + ".assemble.json", JSON.stringify(report, null, 2) + "\n");
  console.log(`assemble-long: ${r3(outInfo.duration)}s ${outInfo.v.width}x${outInfo.v.height} in ${report.seconds_total}s -> ${out}`);
  if (after) console.log(`  loudness ${before.i} -> ${after.i} LUFS (target ${lufs}), true peak ${before.tp} -> ${after.tp} dBTP`);
  console.log(`  frames ${inFrames} -> ${outFrames}; srt ${srtPath}${chaptersPath ? `; chapters ${chaptersPath}` : ""}`);
  cleanup();
  if (problems.length) { console.error("assemble-long: measured checks FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
}

// ---- slice: one clip out of a cut episode, every timed file moved to the clip's clock ----
// Pure part (tested): boundaries never split a word; words wholly inside are kept, turns and scene blocks are clipped
// to the window and dropped when less than `minScene` s is left.
export function sliceData({ from, to, words, turns, scenes, pad = { before: 0.08, after: 0.2 }, minScene = 1.0, duration = Infinity, snap = 4 }) {
  const notes = [];
  let a = from, b = to;
  const ws = words ? words.words : [];
  const inside = (t) => ws.find((w) => w.start < t && t < w.end);
  const wa = inside(a); if (wa) { notes.push(`start ${r3(a)} was inside "${wa.w}": moved to ${r3(wa.start)}`); a = wa.start; }
  const wb = inside(b); if (wb) { notes.push(`end ${r3(b)} was inside "${wb.w}": moved to ${r3(wb.end)}`); b = wb.end; }
  // sentence edges (the punctuated words.json): a clip starts on a sentence and ends on its full stop when one is near
  const ends = (w) => /[.?!…]["'”»)]*$/.test(w.w);
  if (snap > 0 && ws.some(ends)) {
    const i0 = ws.findIndex((w) => w.start >= a - 1e-6);
    let j = i0; while (j > 0 && !ends(ws[j - 1]) && a - ws[j - 1].start <= snap) j--;
    if (i0 >= 0 && j !== i0 && (j === 0 || ends(ws[j - 1]))) { notes.push(`start moved back to the sentence start "${ws[j].w}" at ${r3(ws[j].start)}`); a = ws[j].start; }
    let k = ws.findLastIndex((w) => w.end <= b + 1e-6);
    let m = k; while (m >= 0 && m < ws.length - 1 && !ends(ws[m]) && ws[m + 1].end - b <= snap) m++;
    if (k >= 0 && m !== k && ends(ws[m])) { notes.push(`end moved to the full stop after "${ws[m].w}" at ${r3(ws[m].end)}`); b = ws[m].end; }
  }
  // breathing room, but never into the neighbouring word
  const prev = ws.filter((w) => w.end <= a).pop(), next = ws.find((w) => w.start >= b);
  a = Math.max(0, a - pad.before, prev ? prev.end : 0);
  b = Math.min(duration, b + pad.after, next ? next.start : Infinity);
  const shift = (t) => r3(t - a), len = r3(b - a);
  const out = { from: r3(a), to: r3(b), seconds: len, notes };
  if (words) {
    const kept = ws.filter((w) => w.start >= a - 1e-6 && w.end <= b + 1e-6).map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) }));
    out.words = { ...words, duration: len, sliced_from: { from: r3(a), to: r3(b) }, words: kept };
  }
  if (turns) {
    const kept = turns.turns.filter((t) => t.end > a && t.start < b).map((t) => ({ ...t, start: shift(Math.max(t.start, a)), end: shift(Math.min(t.end, b)) })).filter((t) => t.end - t.start > 0.05);
    out.turns = { ...turns, sliced_from: { from: r3(a), to: r3(b) }, turns: kept };
  }
  if (scenes) {
    let dropped = 0;
    out.scenes = scenes.filter((sc) => sc.end > a && sc.start < b).map((sc) => ({ ...sc, start: shift(Math.max(sc.start, a)), end: shift(Math.min(sc.end, b)) }))
      .filter((sc) => { const ok = sc.end - sc.start >= minScene; if (!ok) dropped++; return ok; });
    if (dropped) notes.push(`${dropped} scene block(s) had less than ${minScene} s inside the clip and were dropped`);
  }
  return out;
}

function sliceCmd(a) {
  const need = ["audio", "from", "to", "out-dir"].filter((k) => a[k] === undefined || a[k] === true);
  if (need.length) die(`usage: slice --audio cut.m4a --from <s> --to <s> --out-dir <dir> [--words words.json] [--turns speakers.json] [--scenes scenes.json] [--snap 4] (missing --${need.join(", --")})`, 64);
  const from = +a.from, to = +a.to;
  if (!isFinite(from) || !isFinite(to) || from < 0 || to - from < 3) die("--from/--to must be seconds with at least 3 s between them", 64);
  const audio = resolve(a.audio), dir = resolve(a["out-dir"]);
  if (!existsSync(audio)) die(`no such file: ${audio}`);
  const src = probe(audio);
  if (!src.au) die(`${audio} has no audio stream`);
  if (to > src.duration + 0.01) die(`--to ${to} is past the end of the audio (${r3(src.duration)} s)`, 64);
  const read = (k) => { if (typeof a[k] !== "string") return null; const f = resolve(a[k]); if (!existsSync(f)) die(`no such file: ${f}`); return JSON.parse(readFileSync(f, "utf8")); };
  const words = read("words"), turns = read("turns"), scenes = read("scenes");
  if (words && !Array.isArray(words.words)) die("--words must be a transcript JSON with a words array", 64);
  if (turns && !Array.isArray(turns.turns)) die("--turns must be a speakers JSON with a turns array", 64);
  if (scenes && !Array.isArray(scenes)) die("--scenes must be a JSON array", 64);
  const sl = sliceData({ from, to, words, turns, scenes, duration: src.duration, snap: a.snap === undefined ? 4 : +a.snap });
  mkdirSync(dir, { recursive: true });
  const clip = join(dir, "clip.m4a");
  if (clip === audio) die("--out-dir must not hold the input audio", 64);
  // cut on the sample inside the filter graph (atrim, then the clock restarts at 0), so the fades run on the clip's own clock
  // and the cut never clicks. (An output -ss would trim AFTER the filters: the fade-out would silence everything.)
  const fadeOut = Math.max(0, sl.seconds - 0.03).toFixed(3);
  const r = run("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", audio, "-vn",
    "-af", `atrim=start=${sl.from.toFixed(3)}:end=${sl.to.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${fadeOut}:d=0.03`,
    "-c:a", "aac", "-b:a", "192k", "-ar", String(src.au.sample_rate || 48000), clip]);
  if (r.status !== 0) die("ffmpeg could not cut the audio:\n" + (r.stderr || "").slice(-800));
  const got = probe(clip).duration;
  const problems = [];
  if (Math.abs(got - sl.seconds) > 0.03) problems.push(`clip lasts ${r3(got)} s, expected ${sl.seconds} s`);
  const vd = run("ffmpeg", ["-hide_banner", "-nostdin", "-i", clip, "-af", "volumedetect", "-f", "null", "-"]);
  const mean = parseFloat((/mean_volume:\s*(-?[\d.]+|-inf)/.exec(vd.stderr || "") || [])[1]);
  if (!(mean > -50)) problems.push(`clip is silent or nearly so (mean ${isFinite(mean) ? mean : "-inf"} dB): the cut missed the talk`);
  const files = { audio: clip };
  if (sl.words) { files.words = join(dir, "words.json"); writeFileSync(files.words, JSON.stringify(sl.words, null, 1) + "\n"); if (!sl.words.words.length) problems.push("no words inside the clip"); }
  if (sl.turns) { files.turns = join(dir, "speakers.json"); writeFileSync(files.turns, JSON.stringify(sl.turns, null, 1) + "\n"); }
  if (sl.scenes) { files.scenes = join(dir, "scenes.json"); writeFileSync(files.scenes, JSON.stringify(sl.scenes, null, 1) + "\n"); }
  const report = { schema: 1, source: audio, from: sl.from, to: sl.to, seconds: r3(got), files, words: sl.words ? sl.words.words.length : null, turns: sl.turns ? sl.turns.turns.length : null, scenes: sl.scenes ? sl.scenes.length : null, notes: sl.notes, problems };
  writeFileSync(join(dir, "slice.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`slice: ${sl.from}-${sl.to} s (${r3(got)} s) -> ${dir}`);
  for (const n of sl.notes) console.log("  " + n);
  if (sl.scenes && !sl.scenes.length) console.log("  no scene blocks fall inside the clip: write the clip's own scenes.json (portrait blocks, punchline in the first 2 s)");
  if (problems.length) { console.error("slice: measured checks FAILED:\n  " + problems.join("\n  ")); process.exit(1); }
}

function chaptersCmd(a) {
  if (typeof a.chapters !== "string") die("usage: chapters --chapters chapters.json (--duration <s> | --video final.mp4) [--out chapters.txt]", 64);
  const list = JSON.parse(readFileSync(resolve(a.chapters), "utf8"));
  const duration = a.video ? probe(resolve(a.video)).duration : +a.duration;
  if (!isFinite(duration)) die("give --duration <seconds> or --video <file>", 64);
  const errs = validateChapters(list, duration);
  if (errs.length) die("chapters invalid:\n  " + errs.join("\n  "), 1);
  const txt = chaptersText(list, duration);
  if (typeof a.out === "string") { writeFileSync(resolve(a.out), txt); console.log(`chapters: ${list.length} ok -> ${resolve(a.out)}`); } else process.stdout.write(txt);
}
function srtCmd(a) {
  if (typeof a.words !== "string" || typeof a.out !== "string") die("usage: srt --words cut.words.json --out final.srt", 64);
  const words = cleanWords(JSON.parse(readFileSync(resolve(a.words), "utf8")));
  writeFileSync(resolve(a.out), toSrt(words));
  console.log(`srt: -> ${resolve(a.out)}`);
}

if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  if (cmd === "assemble") await assemble(a);
  else if (cmd === "chapters") chaptersCmd(a);
  else if (cmd === "srt") srtCmd(a);
  else if (cmd === "slice") sliceCmd(a);
  else { console.error("usage: assemble-long.mjs assemble|slice|chapters|srt ... (see the header of this file or README.md)"); process.exit(64); }
}
