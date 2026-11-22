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
//   node assemble-long.mjs assemble --audio episode.m4a --scenes scenes.json --turns speakers.json --frame frame.md --out final.mp4
//        [--words episode.words.json] [--chapters chapters.json] [--captions pop|clean|none] [--podcast podcast.json] [--look ink-sketch|clean] [--aspect 16:9|9:16]
//        [--fps 30] [--loop 8] [--chunk 96] [--encoder ...] [--parts <dir>] [--work <dir>] [--keep-work]
//      AUDIO MODE (podcasts, no picture): the stage (show background with slow motion) is rendered ONCE as a short seamless loop and looped by ffmpeg;
//      the speaker plates (lit when that host talks, from the turns), the waveform (from pre-computed levels) and the captions are overlays;
//      the timed scene blocks (punchline, quote, topic, reaction, lower-third) are rendered on a transparent ground in a few HyperFrames renders.
//      See the podcast-scenes part (build-scene.mjs, levels.mjs). scenes.json: [{ "start": 12.5, "end": 15, "kind": "punchline", "text": "...", "speaker": "A" }]
//   node assemble-long.mjs chapters --chapters chapters.json (--duration <s> | --video final.mp4) [--out chapters.txt]
//   node assemble-long.mjs srt --words cut.words.json --out final.srt
//   node assemble-long.mjs slice --audio cut.m4a --from <s> --to <s> --out-dir <clip>/assets [--words words.json] [--turns speakers.json] [--scenes scenes.json]
//      one clip out of the cut episode: clip.m4a (sample-accurate, short fades) plus words/speakers/scenes moved to the clip's clock;
//      boundaries never split a word and move to the nearest sentence edge within --snap s (0 = off); slice.json records what moved. Then assemble the clip with --audio <dir>/clip.m4a --aspect 9:16.
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
import { spawnSync, spawn } from "node:child_process";
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
  if (a.audio !== undefined) return assembleAudio(a);
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

// ---- audio mode: a podcast without picture ---------------------------------------------------------------------------
// Cost model (why it is fast): Chrome renders (1) one loop of the stage, (2) a handful of plate stills, (3) the scene blocks on a
// transparent ground (only the seconds that have a block on screen), (4) caption stills. Everything that lasts the whole episode
// (the looped background, plate highlights, the waveform bars) is ffmpeg and a few lines of Node. The episode is encoded in chunks of
// whole loops (so every chunk starts at the loop's frame 0, no seeking), then the chunks are joined without re-encoding.
const hexOf = (c) => "0x" + String(c).replace("#", "").slice(0, 6);
function runAsync(cmd, args, feed) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: [feed ? "pipe" : "ignore", "ignore", "pipe"], env: process.env });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    p.on("error", (e) => res({ status: 2, stderr: e.message }));
    p.on("close", (status) => res({ status, stderr: err }));
    if (feed) { p.stdin.on("error", () => {}); feed(p.stdin).then(() => p.stdin.end(), () => p.stdin.end()); }
  });
}
const writeAll = (stream, buf) => new Promise((res) => { if (stream.write(buf)) res(); else stream.once("drain", res); });

async function assembleAudio(a) {
  const need = ["audio", "frame", "out"].filter((k) => typeof a[k] !== "string");
  if (need.length) die(`usage: assemble --audio episode.m4a --scenes scenes.json --turns speakers.json --frame frame.md --out final.mp4 (missing --${need.join(", --")})`, 64);
  if (a.video !== undefined) die("give --audio or --video, not both", 64);
  const audio = resolve(a.audio), out = resolve(a.out);
  for (const f of [audio, resolve(a.frame)]) if (!existsSync(f)) die(`no such file: ${f}`);
  for (const k of ["scenes", "turns", "words", "podcast"]) if (typeof a[k] === "string" && !existsSync(resolve(a[k]))) die(`no such file: ${a[k]}`);
  if (audio === out) die("--out must differ from --audio", 64);
  if (a.aspect && !["16:9", "9:16"].includes(a.aspect)) die("--aspect must be 16:9 or 9:16", 64);
  const fps = a.fps === undefined ? 30 : +a.fps;
  if (![24, 25, 30].includes(fps)) die("--fps must be 24, 25 or 30", 64);
  const loopSec = a.loop === undefined ? 8 : +a.loop;
  if (!(loopSec >= 2) || !Number.isInteger(loopSec * fps)) die("--loop must be at least 2 s and a whole number of frames", 64);
  const loopFrames = Math.round(loopSec * fps);
  const chunkFrames = loopFrames * Math.max(1, Math.round((a.chunk === undefined ? 96 : +a.chunk) / loopSec));
  const lufs = a.lufs === undefined ? -16 : +a.lufs, TP = -2;
  if (!isFinite(lufs) || lufs > -5 || lufs < -40) die("--lufs must be a number such as -16", 64);
  const t0 = Date.now(), stages = [];
  const stage = (name, since) => { const s = r3((Date.now() - since) / 1000); stages.push({ stage: name, seconds: s }); console.log(`  ${name}: ${s}s`); };

  const src = probe(audio);
  if (!src.au) die(`${audio} has no audio stream`);
  const duration = src.duration;
  const N = Math.ceil(duration * fps - 1e-6);
  const portrait = a.aspect === "9:16";
  const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080;

  const podPath = findScript(a, "podcast-scenes", "podcast.mjs", ["scene", "podcast-scenes"]);
  const buildScene = join(dirname(podPath), "build-scene.mjs"), levelsPath = join(dirname(podPath), "levels.mjs");
  const pod = await import(pathToFileURL(podPath).href), lev = await import(pathToFileURL(levelsPath).href);
  const frameText = readFileSync(resolve(a.frame), "utf8");
  let podcast;
  try {
    const raw = typeof a.podcast === "string" ? JSON.parse(readFileSync(resolve(a.podcast), "utf8")) : pod.podcastFromFrame(frameText);
    if (!raw) die("frame.md has no `podcast:` block and no --podcast file was given (look, background, accent_alt, hosts)", 64);
    podcast = pod.checkPodcast(raw, { lookOverride: typeof a.look === "string" ? a.look : null });
  } catch (e) { die(e.message, 64); }
  const hostIds = podcast.hosts.map((h) => h.id);
  let turnsInfo = { turns: [], merged: 0, dropped: 0 };
  if (typeof a.turns === "string") { try { turnsInfo = pod.normalizeTurns(JSON.parse(readFileSync(resolve(a.turns), "utf8")), { hostIds }); } catch (e) { die(e.message, 64); } }
  else console.error("assemble-long: no --turns: the speaker plates stay dim");
  let scenes = [];
  if (typeof a.scenes === "string") {
    const v = pod.validateScenes(JSON.parse(readFileSync(resolve(a.scenes), "utf8")), { duration, fps, hostIds });
    if (v.errors.length) die("scenes.json invalid:\n  " + v.errors.join("\n  "), 64);
    scenes = v.scenes.sort((x, y) => x.f0 - y.f0);
  }
  // chapters first: refuse before any rendering
  let chapters = null;
  if (typeof a.chapters === "string") {
    if (!existsSync(resolve(a.chapters))) die(`no such file: ${a.chapters}`);
    chapters = JSON.parse(readFileSync(resolve(a.chapters), "utf8"));
    const errs = validateChapters(chapters, duration);
    if (errs.length) die("chapters invalid:\n  " + errs.join("\n  "), 1);
  }
  const words = typeof a.words === "string" ? cleanWords(JSON.parse(readFileSync(resolve(a.words), "utf8"))) : null;
  const captionsMode = a.captions === undefined || a.captions === true ? (words ? "clean" : "none") : String(a.captions);
  if (!["pop", "clean", "none"].includes(captionsMode)) die("--captions must be pop, clean or none", 64);
  if (captionsMode !== "none" && !words) die("captions need --words (a word-timed transcript); or pass --captions none", 64);

  workDir = a.work ? resolve(a.work) : join(dirname(out), ".assemble-work-" + basename(out).replace(/\W+/g, "_"));
  keepWork = !!a["keep-work"] || !!a.work;
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  mkdirSync(dirname(out), { recursive: true });
  const hf = findHf(a);
  const { parseFrame, toCss } = await import(pathToFileURL(findScript(a, "captions", "frame-vars.mjs", ["scene", "captions"])).href);
  const frame = parseFrame(frameText);
  const brandCss = toCss(frame);
  const accent = frame.colors.accent || "#39ff14";
  const problems = [];
  const podFile = join(workDir, "podcast.json");
  writeFileSync(podFile, JSON.stringify(podcast));
  const sceneArgs = (kind, extra) => ["--kind", kind, "--aspect", portrait ? "9:16" : "16:9", "--frame", resolve(a.frame), "--podcast", podFile, ...(typeof a.parts === "string" ? ["--parts", resolve(a.parts)] : []), ...extra];
  const build = (args) => { const r = run(process.execPath, [buildScene, ...args]); if (r.status !== 0) die("build-scene failed: " + (r.stderr || r.stdout).trim()); return r.stdout; };
  // HyperFrames renders ceil(duration * fps) frames; a duration rounded to ms (88.3667 -> 88.367) can gain a frame, so the
  // root duration is set half a frame short of the wanted count, which ceil() maps back to exactly that count.
  const hfProject = (dir, { dur, mounts, bg = "transparent", rate = fps }) => sheetProject(dir, { W, H, dur: (Math.round(dur * rate) - 0.5) / rate, css: `* { margin: 0; padding: 0; box-sizing: border-box; } html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${bg}; }`, body: mounts, js: "", brandCss, fontsFrom: null });
  const mount = (cid, start, dur) => `      <div id="${cid}" data-composition-id="${cid}" data-composition-src="compositions/${cid}.html" data-start="${r3(start)}" data-duration="${r3(dur)}" data-track-index="2" data-track-kind="graphics" data-width="${W}" data-height="${H}"></div>\n`;
  console.log(`audio mode: ${r3(duration)} s -> ${N} frames at ${fps} fps, ${W}x${H}, look ${podcast.look}, ${scenes.length} scene block(s), ${turnsInfo.turns.length} turn(s)`);

  // ---- 1. levels (waveform data) ----
  let s0 = Date.now();
  const lv = lev.computeLevels(audio, fps);
  const levelsFile = join(workDir, "levels.json");
  writeFileSync(levelsFile, JSON.stringify(lv));
  stage(`levels (${lv.frames} frames of RMS from ffmpeg)`, s0);

  // ---- 2. stage loop: ONE short render of the background motion, looped by ffmpeg ----
  s0 = Date.now();
  const stageProj = join(workDir, "stage-proj");
  build(sceneArgs("stage", ["--mode", "bg", "--loop", String(loopSec), "--id", "stage-bg", "--out", join(stageProj, "compositions", "stage-bg.html")]));
  hfProject(stageProj, { dur: loopSec, mounts: mount("stage-bg", 0, loopSec), bg: "#000" });
  const loopFile = join(workDir, "stage-loop.mp4");
  hfRender(hf, stageProj, ["--format", "mp4", "--fps", String(fps), "-o", loopFile]);
  const loopFramesGot = frameCount(loopFile);
  if (loopFramesGot !== loopFrames) problems.push(`stage loop has ${loopFramesGot} frames, expected ${loopFrames}`);
  // seam check: the step from the last frame to the first should look like any other step
  const seam = (() => {
    const r = run("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-i", loopFile, "-vf", "scale=160:90,format=gray", "-f", "rawvideo", "-"], { encoding: "buffer" });
    const fr = 160 * 90, n = Math.floor(r.stdout.length / fr);
    if (n < 3) return null;
    const d = (i, j) => { let s = 0; for (let k = 0; k < fr; k++) s += Math.abs(r.stdout[i * fr + k] - r.stdout[j * fr + k]); return s / fr; };
    let typ = 0; for (let i = 0; i + 1 < n; i++) typ += d(i, i + 1); typ /= n - 1;
    return { frames: n, step: r3(typ), wrap: r3(d(n - 1, 0)) };
  })();
  if (seam && seam.wrap > seam.step * 2 + 0.05) problems.push(`stage loop seam: last-to-first step ${seam.wrap} vs ${seam.step} typical (mean grey levels)`);
  stage(`stage loop (${loopSec} s, ${loopFramesGot} frames, rendered once)`, s0);

  // ---- 3. plates: dim and lit stills per host, cropped to their box ----
  s0 = Date.now();
  const lay = pod.layout(portrait);
  const plateProj = join(workDir, "plates-proj");
  const nStates = podcast.hosts.length * 2;
  build(sceneArgs("stage", ["--mode", "plates", "--id", "plates", "--out", join(plateProj, "compositions", "plates.html")]));
  hfProject(plateProj, { dur: nStates / 30, rate: 30, mounts: mount("plates", 0, nStates / 30) });
  const plateFrames = join(workDir, "plates-frames");
  hfRender(hf, plateProj, ["--format", "png-sequence", "--fps", "30", "-o", plateFrames]);
  const platePngs = readdirSync(plateFrames).filter((f) => f.endsWith(".png")).sort();
  if (platePngs.length < nStates) die(`plates: expected ${nStates} frames, HyperFrames wrote ${platePngs.length}`);
  const pBox = (i) => { const x = Math.max(0, lay.plate.xs[Math.min(i, lay.plate.xs.length - 1)] - 10), y = Math.max(0, lay.plate.y - 10); return { x, y, w: Math.min(W - x, lay.plate.w + 36), h: Math.min(H - y, lay.plate.h + 36) }; };
  const plates = podcast.hosts.map((h, i) => {
    const b = pBox(i), file = (st, k) => join(workDir, `plate-${i}-${st}.png`);
    [["dim", 2 * i], ["lit", 2 * i + 1]].forEach(([st, k]) => {
      const r = run("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", join(plateFrames, platePngs[k]), "-vf", `crop=${b.w}:${b.h}:${b.x}:${b.y}`, "-frames:v", "1", file(st)]);
      if (r.status !== 0) die("plate crop failed: " + r.stderr);
    });
    return { id: h.id, box: b, dim: file("dim"), lit: file("lit") };
  });
  stage(`speaker plates (${nStates} stills, rendered once)`, s0);

  // ---- 4. scene blocks: transparent WebM renders, a few blocks per render ----
  s0 = Date.now();
  const batches = [];
  let cur = null;
  for (const sc of scenes) {
    if (!cur || cur.frames + sc.n > 90 * fps || cur.items.length >= 30) { cur = { items: [], frames: 0, k: batches.length }; batches.push(cur); }
    sc.batch = cur; sc.off = cur.frames; cur.frames += sc.n; cur.items.push(sc);
  }
  for (const b of batches) {
    const proj = join(workDir, `scenes-proj-${b.k}`);
    let mounts = "";
    for (const sc of b.items) {
      const extra = ["--id", sc.id, "--duration", String(r3(sc.n / fps)), "--out", join(proj, "compositions", sc.id + ".html")];
      if (sc.text !== undefined && sc.kind !== "waveform") extra.push("--text", String(sc.text));
      if (sc.detail !== undefined) extra.push("--detail", String(sc.detail));
      if (sc.speaker !== undefined) extra.push("--speaker", sc.speaker);
      if (sc.kind === "waveform") extra.push("--levels", levelsFile, "--from", String(r3(sc.f0 / fps)));
      build(sceneArgs(sc.kind, extra));
      mounts += mount(sc.id, sc.off / fps, sc.n / fps);
    }
    hfProject(proj, { dur: b.frames / fps, mounts });
    b.file = join(workDir, `scenes-${b.k}.webm`);
    hfRender(hf, proj, ["--format", "webm", "--fps", String(fps), "-o", b.file]);
    const got = frameCount(b.file);
    if (got !== b.frames) problems.push(`scene render ${b.k}: ${got} frames, expected ${b.frames}`);
  }
  if (scenes.length) stage(`scene blocks (${scenes.length} in ${batches.length} transparent render(s), ${r3(batches.reduce((x, b) => x + b.frames, 0) / fps)} s of picture)`, s0);

  // ---- 5. captions ----
  let capPlan = null;
  if (captionsMode !== "none") {
    s0 = Date.now();
    let fontCss = "";
    if (typeof a.fonts === "string") {
      mkdirSync(join(workDir, "fonts"), { recursive: true });
      for (const pair of a.fonts.split(",")) {
        const [fam, file] = pair.split("=");
        if (!fam || !file || !existsSync(resolve(file))) die(`--fonts: "${pair}" must be Family=path/to/font.ttf and the file must exist`, 64);
        copyFileSync(resolve(file), join(workDir, "fonts", basename(file)));
        fontCss += `@font-face { font-family: "${fam}"; src: url("../fonts/${basename(file)}"); }\n`;
      }
    }
    capPlan = captionPlan({ hf, workDir, words, style: captionsMode, portrait, W, H, duration, fps, band: a.band, accent: !!a.accent, brandCss, fontCss });
    stage(`captions (${capPlan.stats.states} stills)`, s0);
  }

  // ---- 6. loudness ----
  s0 = Date.now();
  const before = measureLoudness(audio);
  const audioMade = buildAudio(audio, workDir, lufs, before);
  stage(`audio: measure, gain + limiter, re-measure (${audioMade.tries.length} pass(es))`, s0);

  // ---- 7. chunks: loop + plates + waveform + captions + scenes, encoded; then joined without re-encoding ----
  s0 = Date.now();
  const enc = a.encoder === undefined ? "x264" : String(a.encoder);
  if (!["x264", "videotoolbox"].includes(enc)) die("--encoder must be x264 (default, deterministic) or videotoolbox (Mac media engine, faster)", 64);
  const encArgs = enc === "x264" ? ["-c:v", "libx264", "-preset", String(a.preset ?? "veryfast"), "-crf", String(a.crf ?? 22)] : ["-c:v", "h264_videotoolbox", "-b:v", String(a.bitrate ?? "6M"), "-profile:v", "high"];
  const wv = lay.wave, nBars = portrait ? 30 : 40, pitch = wv.w / nBars, barW = Math.max(3, Math.round(pitch * (podcast.look === "clean" ? 0.62 : 0.4)));
  const segs = [];
  const turnTerms = (id, c0, c1) => podcast.hosts.length && turnsInfo.turns.filter((t) => t.speaker === id && Math.round(t.end * fps) > c0 && Math.round(t.start * fps) < c1)
    .map((t) => `between(t,${((Math.max(Math.round(t.start * fps), c0) - c0) / fps).toFixed(4)},${((Math.min(Math.round(t.end * fps), c1) - c0) / fps - 0.0001).toFixed(4)})`);
  for (let c0 = 0, ci = 0; c0 < N; c0 += chunkFrames, ci++) {
    const c1 = Math.min(N, c0 + chunkFrames), n = c1 - c0;
    const inputs = ["-stream_loop", "-1", "-i", loopFile];
    const f = ["[0:v]setsar=1,format=yuv420p[b0]"];
    let cur = "b0", k = 1, oc = 0;
    const ov = (name, x, y, enable) => { const nxt = `o${++oc}`; f.push(`[${cur}][${name}]overlay=x=${x}:y=${y}:format=auto${enable ? `:enable='${enable}'` : ""}[${nxt}]`); cur = nxt; };
    plates.forEach((p) => {
      const terms = turnTerms(p.id, c0, c1);
      inputs.push("-loop", "1", "-framerate", String(fps), "-i", p.dim);
      const dn = k; k++;
      f.push(`[${dn}:v]format=rgba[d${dn}]`);
      if (terms.length) {
        inputs.push("-loop", "1", "-framerate", String(fps), "-i", p.lit);
        const ln = k; k++;
        f.push(`[${ln}:v]format=rgba[l${ln}]`);
        const lit = terms.join("+");
        ov(`d${dn}`, p.box.x, p.box.y, `eq(${lit},0)`);
        ov(`l${ln}`, p.box.x, p.box.y, `gt(${lit},0)`);
      } else ov(`d${dn}`, p.box.x, p.box.y);
    });
    // waveform: raw grey frames from Node (bars from the pre-computed levels), tinted with the accent
    inputs.push("-f", "rawvideo", "-pixel_format", "gray", "-video_size", `${wv.h}x${wv.w}`, "-framerate", String(fps), "-i", "pipe:0");
    const wn = k; k++;
    f.push(`[${wn}:v]transpose=0,format=gray[wm]`, `color=c=${hexOf(accent)}:s=${wv.w}x${wv.h}:r=${fps},format=rgba[wc]`, `[wc][wm]alphamerge[wa]`);
    ov("wa", wv.x, wv.y);
    if (capPlan) {
      const list = join(workDir, `captions-${ci}.ffconcat`);
      writeCaptionList(capPlan, c0, c1, fps, list);
      inputs.push("-f", "concat", "-safe", "0", "-i", list);
      const cn = k; k++;
      f.push(`[${cn}:v]format=rgba[cap]`);
      ov("cap", 0, capPlan.placement.y0);
    }
    for (const sc of scenes) {
      const v0 = Math.max(sc.f0, c0), v1 = Math.min(sc.f0 + sc.n, c1);
      if (v1 <= v0) continue;
      inputs.push("-ss", ((sc.off + (v0 - sc.f0)) / fps).toFixed(4), "-t", ((v1 - v0) / fps).toFixed(4), "-c:v", "libvpx-vp9", "-i", sc.batch.file);
      const sn = k; k++;
      f.push(`[${sn}:v]setpts=PTS-STARTPTS+${((v0 - c0) / fps).toFixed(4)}/TB[s${sn}]`);
      ov(`s${sn}`, 0, 0, `between(t,${((v0 - c0) / fps - 0.0001).toFixed(4)},${((v1 - c0) / fps - 0.0001).toFixed(4)})`);
    }
    f.push(`[${cur}]format=yuv420p[vout]`);
    const script = join(workDir, `graph-${ci}.txt`);
    writeFileSync(script, f.join(";\n"));
    const seg = join(workDir, `seg-${String(ci).padStart(3, "0")}.mp4`);
    const args = ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y", ...inputs, "-/filter_complex", script, "-map", "[vout]", "-an", ...encArgs, "-r", String(fps), "-g", String(fps), "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-frames:v", String(n), seg];
    // the waveform input is the pipe: its index is wn, so it must be the only pipe input
    const feed = async (stdin) => {
      for (let i = 0; i < n; i++) {
        const hs = pod.barHeights(lv.levels, c0 + i, nBars), buf = Buffer.alloc(wv.w * wv.h);
        for (let b = 0; b < nBars; b++) {
          const x0 = Math.round(b * pitch + (pitch - barW) / 2), half = Math.max(2, Math.round((hs[b] * wv.h) / 2)), y0 = Math.round(wv.h / 2) - half, y1 = Math.round(wv.h / 2) + half;
          buf.fill(255, x0 * wv.h + y0, x0 * wv.h + y1);
          for (let x = 1; x < barW; x++) buf.copyWithin((x0 + x) * wv.h + y0, x0 * wv.h + y0, x0 * wv.h + y1);
        }
        await writeAll(stdin, buf);
      }
    };
    const r = await runAsync("ffmpeg", args, feed);
    if (r.status !== 0) die(`ffmpeg chunk ${ci} failed:\n${r.stderr.slice(-1500)}`);
    segs.push(seg);
    process.stdout.write(`\r  chunk ${ci + 1}/${Math.ceil(N / chunkFrames)}`);
  }
  process.stdout.write("\n");
  stage(`chunks (${segs.length} x up to ${r3(chunkFrames / fps)} s: overlays + encode)`, s0);

  s0 = Date.now();
  const listFile = join(workDir, "segments.txt");
  writeFileSync(listFile, segs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const rj = run("ffmpeg", ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-i", audioMade.file, "-map", "0:v", "-map", "1:a", "-c", "copy", "-movflags", "+faststart", out]);
  if (rj.status !== 0) die("joining the chunks failed:\n" + rj.stderr.slice(-1500));
  stage("join chunks + audio (stream copy)", s0);

  // ---- 8. text outputs and measurements ----
  const srtPath = out.replace(/\.[^.]+$/, "") + ".srt";
  if (words) writeFileSync(srtPath, toSrt(words));
  const outInfo = probe(out);
  let chaptersPath = null;
  if (chapters) { chaptersPath = join(dirname(out), "chapters.txt"); writeFileSync(chaptersPath, chaptersText(chapters, outInfo.duration)); }
  const after = measureLoudness(out);
  if (Math.abs(after.i - lufs) > 1.0) problems.push(`integrated loudness ${after.i} LUFS, target ${lufs} (+-1)`);
  if (after.tp > -1.0) problems.push(`true peak ${after.tp} dBTP is above -1`);
  const outFrames = frameCount(out);
  if (outFrames !== N) problems.push(`frame count ${outFrames}, expected ${N}`);
  const vDur = parseFloat(outInfo.v.duration), aDur = parseFloat(outInfo.au.duration);
  if (Math.abs(vDur - aDur) > 2 / fps) problems.push(`picture ${r3(vDur)} s and sound ${r3(aDur)} s differ by more than two frames`);
  if (Math.abs(aDur - duration) > 0.05) problems.push(`sound lasts ${r3(aDur)} s, the input ${r3(duration)} s`);
  const spread = stepSpread(out);
  if (spread.hi - spread.lo > 0.0005) problems.push(`frame step is not constant (${r3(spread.lo * 1000)}..${r3(spread.hi * 1000)} ms): a chunk joint is off`);
  const starts = scenes.map((s) => s.f0 / fps);
  let maxGap = starts.length ? Math.max(starts[0], ...starts.slice(1).map((x, i) => x - starts[i]), duration - starts[starts.length - 1]) : duration;
  const report = {
    schema: 1, mode: "audio", out, srt: words ? srtPath : null, chapters: chaptersPath, seconds_total: r3((Date.now() - t0) / 1000), stages,
    video: { seconds: r3(outInfo.duration), width: outInfo.v.width, height: outInfo.v.height, fps, frames_expected: N, frames_out: outFrames, codec: outInfo.v.codec_name, frame_step_ms: [r3(spread.lo * 1000), r3(spread.hi * 1000)] },
    audio: { codec: outInfo.au.codec_name, sample_rate: outInfo.au.sample_rate, before: { lufs: before.i, true_peak: before.tp }, after: { lufs: after.i, true_peak: after.tp }, target_lufs: lufs, true_peak_limit: -1, passes: audioMade.tries },
    stage: { look: podcast.look, loop_seconds: loopSec, loop_frames: loopFramesGot, loop_seam: seam, chunks: segs.length, chunk_seconds: r3(chunkFrames / fps), encoder: enc },
    turns: { kept: turnsInfo.turns.length, merged: turnsInfo.merged, dropped_short: turnsInfo.dropped },
    scenes: scenes.map((s) => ({ kind: s.kind, start: r3(s.f0 / fps), seconds: r3(s.n / fps) })),
    scene_renders: batches.map((b) => ({ blocks: b.items.length, seconds: r3(b.frames / fps) })),
    captions: capPlan ? capPlan.stats : null,
    longest_gap_between_scene_block_starts_s: r3(maxGap),
    note_stillness: "the background moves and the plates change with the turns all the time; scene blocks add the content beats",
    problems,
  };
  writeFileSync(out + ".assemble.json", JSON.stringify(report, null, 2) + "\n");
  console.log(`assemble-long: ${r3(outInfo.duration)}s ${outInfo.v.width}x${outInfo.v.height} in ${report.seconds_total}s -> ${out}`);
  console.log(`  loudness ${before.i} -> ${after.i} LUFS (target ${lufs}), true peak ${before.tp} -> ${after.tp} dBTP; frames ${outFrames} (expected ${N})${seam ? `; loop seam ${seam.wrap} vs step ${seam.step}` : ""}${chaptersPath ? `; chapters ${chaptersPath}` : ""}`);
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
