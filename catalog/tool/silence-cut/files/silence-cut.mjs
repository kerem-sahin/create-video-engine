#!/usr/bin/env node
// silence-cut: word JSON + ffmpeg silencedetect -> EDL (for the person to approve) -> cut.mp4 + retimed word JSON.
// Zero dependencies: Node >= 22, ffmpeg, ffprobe.  Own code, informed by the EDL idea in herk-edit-kit and
// the silence/filler options in ffmpeg-skill (both MIT); no upstream code is copied.
//
//   node silence-cut.mjs plan  --video talk.mp4 --words talk.words.json --out edl.json [options]
//   node silence-cut.mjs apply --edl edl.json --out cut.mp4 [--words <words.json>] [--words-out cut.words.json]
//        words: the copy embedded in the EDL unless --words is given (then that file is used, and a warning says if it
//        differs from the embedded copy: edits made to the words file after `plan` are NOT seen otherwise).
//        words-out: where the retimed words go (default: <out without extension>.words.json); the path is printed.
//
// plan options
//   --mode tight|normal tight (default): pauses of 0.5 s or more are cut down to 0.25 s; normal: pauses of 0.8 s or more
//                       are cut down to 0.4 s. A pause is shortened, never removed.
//   --keep-pause 0.25   how much of each shortened pause stays (seconds; overrides the mode)
//   --min-pause 0.5     pauses (no speech) at least this long are shortened (seconds; overrides the mode)
//   --pad 0.12          audio kept on each side of speech (0.1-0.15 s sounds natural)
//   --noise -35dB       silencedetect threshold; --no-silence-check skips ffmpeg silencedetect (then word gaps decide)
//   --word-gaps         also cut word gaps >= 1 s that ffmpeg did not hear as silence (noisy room)
//   --fillers auto      auto = by the word file's language | tr | en | tr,en | none
//   --sey               also cut Turkish "sey" (it is a real word, so off by default)
//   --extra-fillers a,b more filler words to cut
// apply options
//   --crf 18  --preset veryfast  --fps <n> (default: the source's)
//
// Exit: 0 ok, 1 refused (bad EDL), 2 cannot run (missing ffmpeg/input), 64 usage.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const r3 = (x) => Math.round(x * 1000) / 1000;

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const nxt = argv[i + 1];
      if (nxt === undefined || (nxt.startsWith("--") && !/^-\d/.test(nxt))) a[k] = true;
      else { a[k] = nxt; i++; }
    } else a._.push(t);
  }
  return a;
}
const DURATION_TOLERANCE_FRAMES = 2;
function die(msg, code = 2) { console.error("silence-cut: " + msg); process.exit(code); }
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.error) die(`cannot run ${cmd}: ${r.error.message} (is it installed? brew install ffmpeg)`);
  return r;
}
function probe(file) {
  const r = run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (r.status !== 0) die(`ffprobe failed on ${file}: ${r.stderr.trim()}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video");
  const au = j.streams.find((s) => s.codec_type === "audio");
  let fps = 30;
  if (v?.avg_frame_rate && v.avg_frame_rate !== "0/0") { const [n, d] = v.avg_frame_rate.split("/").map(Number); if (n && d) fps = n / d; }
  return { duration: parseFloat(j.format.duration), fps, hasVideo: !!v, hasAudio: !!au, width: v?.width, height: v?.height };
}
function norm(w) {
  return String(w).toLocaleLowerCase("tr").replace(/[\p{P}\p{S}\s]+/gu, "");
}
function readWords(file) {
  const j = JSON.parse(readFileSync(file, "utf8"));
  const words = (j.words || j).map((x) => ({ w: x.w ?? x.text ?? x.word, start: +x.start, end: +x.end, ...(x.unsure === true ? { unsure: true } : {}) }));
  if (!words.every((x) => typeof x.w === "string" && isFinite(x.start) && isFinite(x.end))) die("word file is not {words:[{w,start,end}]}", 1);
  return { words, language: j.language || null, engine: j.engine || null };
}

// ---- fillers -------------------------------------------------------------------------------
const TR_FILLER = /^(ı{1,}h*|e{2,}h*|ee+m*|ıh+m*|hm+|mm+|öö+|aa+h*|ıımm*|eem+)$/u;
const EN_FILLER = /^(u+m+|u+h+|uh+m+|e+r+m*|hm+|mm+|ah+|er)$/u;
let warnedLang = false;
function fillerTest(opt, lang, sey, extra) {
  const set = new Set(extra.map(norm));
  let tr = false, en = false;
  const o = opt === true || opt === undefined ? "auto" : String(opt);
  if (o === "auto") { const l = (lang || "").slice(0, 2); tr = l === "tr"; en = l === "en"; }
  else if (o !== "none") { tr = /tr/.test(o); en = /en/.test(o); }
  if (o === "auto" && !tr && !en && !warnedLang) { warnedLang = true; console.error(`silence-cut: no filler list for language "${lang || "unknown"}"; not cutting fillers (use --fillers tr|en|tr,en or --extra-fillers)`); }
  return (w) => {
    const n = norm(w);
    if (!n) return false;
    if (set.has(n)) return true;
    if (tr && (TR_FILLER.test(n) || (sey && n === "şey"))) return true;
    if (en && EN_FILLER.test(n)) return true;
    return false;
  };
}

// ---- silencedetect ---------------------------------------------------------------------------
function detectSilences(video, noise, minDur) {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vn", "-af", `silencedetect=noise=${noise}:d=${minDur}`, "-f", "null", "-"]);
  const out = [];
  let cur = null;
  for (const line of r.stderr.split("\n")) {
    let m = line.match(/silence_start: (-?[\d.]+)/);
    if (m) cur = Math.max(0, parseFloat(m[1]));
    m = line.match(/silence_end: (-?[\d.]+)/);
    if (m && cur !== null) { out.push([cur, parseFloat(m[1])]); cur = null; }
  }
  return out;
}

// ---- plan ------------------------------------------------------------------------------------
const pad0 = (a) => +(a.pad ?? 0.12);
function plan(a) {
  if (!a.video || !a.words || !a.out) die("usage: plan --video <file> --words <words.json> --out <edl.json>", 64);
  const video = resolve(a.video);
  if (!existsSync(video)) die(`no such video: ${video}`);
  const info = probe(video);
  const mode = a.mode === undefined || a.mode === true ? "tight" : String(a.mode);
  if (!["tight", "normal"].includes(mode)) die("--mode must be tight or normal", 64);
  const minPause = +(a["min-pause"] ?? (mode === "tight" ? 0.5 : 0.8));
  const keepPause = +(a["keep-pause"] ?? (mode === "tight" ? 0.25 : 0.4));
  if (!isFinite(minPause) || !isFinite(keepPause) || keepPause < 0) die("--min-pause and --keep-pause must be numbers (seconds)", 64);
  const half = Math.max(pad0(a), keepPause / 2);   // audio kept on each side of a cut gap: pad, or half the pause to keep
  const pad = +(a.pad ?? 0.12);
  const noise = a.noise ?? "-35dB";
  const { words: all, language, engine } = readWords(resolve(a.words));
  const extra = typeof a["extra-fillers"] === "string" ? a["extra-fillers"].split(",") : [];
  const isFiller = fillerTest(a.fillers, language, !!a.sey, extra);
  const silences = a["no-silence-check"] ? null : info.hasAudio ? detectSilences(video, noise, Math.max(0.15, minPause - 0.05)) : [];

  // Whisper invents words over a silent tail: drop words that sit wholly inside a detected silence >= 0.6 s.
  const dropped = [];
  const words = [];
  for (const w of all.sort((x, y) => x.start - y.start)) {
    const inSil = silences?.some(([s, e]) => e - s >= 0.6 && w.start >= s - 0.02 && w.end <= e + 0.02);
    if (inSil) dropped.push({ w: w.w, start: r3(w.start), end: r3(Math.min(w.end, info.duration)), why: "inside silence (likely hallucination)" });
    else words.push({ ...w, end: Math.min(w.end, info.duration) });
  }
  if (!words.length) die("no usable words in the word file", 1);

  const speech = words.filter((w) => !isFiller(w.w));
  const fillers = words.filter((w) => isFiller(w.w));
  if (!speech.length) die("every word is a filler; nothing to keep", 1);

  const cuts = [];
  const textAround = (t0, t1) => {
    const before = words.filter((w) => w.end <= t0 + 0.01).slice(-3).map((w) => w.w).join(" ");
    const after = words.filter((w) => w.start >= t1 - 0.01).slice(0, 3).map((w) => w.w).join(" ");
    return `${before} | ${after}`;
  };
  const addCut = (start, end, kind, extraProps = {}) => {
    start = Math.max(0, start); end = Math.min(info.duration, end);
    if (end - start < 0.08) return;
    cuts.push({ start: r3(start), end: r3(end), kind, ...extraProps, context: textAround(start, end), approved: true });
  };

  // leading / trailing dead air
  addCut(0, speech[0].start - pad, "leading", { reason: "dead air before the first word" });
  addCut(speech[speech.length - 1].end + pad, info.duration, "trailing", { reason: "dead air after the last word" });

  // pauses: what ffmpeg hears as silence for at least --min-pause; --keep-pause of it stays (half on each side).
  // (Whisper times words loosely around pauses; the audio is the better witness.)
  if (silences) {
    for (const [s, e] of silences) {
      if (e - s < minPause - 1e-6) continue;
      addCut(s + keepPause / 2, Math.min(e, info.duration) - keepPause / 2, "pause", { reason: `silence ${r3(e - s)} s, ${r3(keepPause)} s kept` });
    }
  }
  // fillers: cut each one (and the pause around it) between the neighbouring speech words
  for (let i = 0; i < speech.length - 1; i++) {
    const A = speech[i], B = speech[i + 1];
    const inside = fillers.filter((f) => f.start >= A.end - 0.02 && f.end <= B.start + 0.02);
    if (inside.length) addCut(A.end + half, B.start - half, "filler", { text: inside.map((f) => f.w).join(" "), reason: `filler word(s)` });
    else if (a["word-gaps"] || !silences) {
      // no usable silence detection (noisy room): trust word gaps, but only from 1 s up
      const gap = B.start - A.end;
      if (gap >= Math.max(minPause, silences ? 1.0 : minPause)) addCut(A.end + half, B.start - half, "pause", { reason: `word gap ${r3(gap)} s, ${r3(keepPause)} s kept` });
    }
  }
  cuts.sort((x, y) => x.start - y.start);
  // merge overlaps (silence pieces can touch filler cuts)
  const merged = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end + 0.001) { last.end = Math.max(last.end, c.end); if (c.text) last.text = [last.text, c.text].filter(Boolean).join(" "); if (c.kind === "filler") last.kind = "filler"; }
    else merged.push({ ...c });
  }

  const edl = {
    schema: 1,
    note: "Review the cuts. Set \"approved\": false on any cut you want to keep, then run apply. Times are seconds in the source file.",
    source: video,
    source_duration: r3(info.duration),
    fps: r3(info.fps),
    params: { mode, min_pause: minPause, keep_pause: keepPause, pad, noise, fillers: a.fillers === undefined || a.fillers === true ? "auto" : String(a.fillers), sey: !!a.sey, language, engine },
    cuts: merged,
    dropped_words: dropped,
    words: words.map((w) => ({ w: w.w, start: r3(w.start), end: r3(w.end), ...(w.unsure ? { unsure: true } : {}) })),
  };
  edl.stats = stats(edl);
  writeFileSync(resolve(a.out), JSON.stringify(edl, null, 2) + "\n");
  const md = resolve(a.out).replace(/\.json$/, "") + ".md";
  writeFileSync(md, review(edl));
  console.log(`EDL: ${merged.length} cuts, ${edl.stats.removed}s of ${edl.stats.before}s (${edl.stats.after}s kept)`);
  console.log(`  ${resolve(a.out)}\n  ${md}  (read this, then edit approved flags and run apply)`);
}

function keepFromCuts(edl) {
  const cuts = edl.cuts.filter((c) => c.approved !== false).sort((x, y) => x.start - y.start);
  const keep = [];
  let t = 0;
  for (const c of cuts) {
    if (c.start > t + 0.001) keep.push([t, c.start]);
    t = Math.max(t, c.end);
  }
  if (edl.source_duration > t + 0.001) keep.push([t, edl.source_duration]);
  return keep;
}
function stats(edl) {
  const keep = keepFromCuts(edl);
  const after = keep.reduce((s, [a, b]) => s + b - a, 0);
  return { before: r3(edl.source_duration), after: r3(after), removed: r3(edl.source_duration - after), cuts: edl.cuts.filter((c) => c.approved !== false).length };
}
function review(edl) {
  const rows = edl.cuts.map((c, i) => `| ${i} | ${c.kind} | ${c.start.toFixed(2)} - ${c.end.toFixed(2)} | ${(c.end - c.start).toFixed(2)} | ${c.text ?? ""} | ${c.context} |`);
  return `# Cuts to approve\n\nSource ${edl.source} (${edl.source_duration} s). ${edl.stats.cuts} cuts remove ${edl.stats.removed} s; ${edl.stats.after} s stay.\nTo keep a cut, set "approved": false in the .json next to this file.\n\n| # | kind | from - to (s) | length | text | around |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`;
}

// ---- apply -----------------------------------------------------------------------------------
function apply(a) {
  if (!a.edl || !a.out) die("usage: apply --edl <edl.json> --out <cut.mp4> [--video <file>] [--words-out <file>]", 64);
  const edl = JSON.parse(readFileSync(resolve(a.edl), "utf8"));
  if (edl.schema !== 1 || !Array.isArray(edl.cuts)) die("not an EDL written by silence-cut plan", 1);
  const video = resolve(a.video || edl.source);
  if (!existsSync(video)) die(`no such video: ${video}`);
  const info = probe(video);
  if (Math.abs(info.duration - edl.source_duration) > 0.25) die(`video is ${info.duration}s but the EDL was made for ${edl.source_duration}s; plan again`, 1);
  const fps = +(a.fps || info.fps);
  const snap = (t) => Math.round(t * fps) / fps;
  let keep = keepFromCuts(edl).map(([s, e]) => [snap(s), snap(e)]).filter(([s, e]) => e - s >= 1 / fps - 1e-6);
  if (!keep.length) die("the EDL keeps nothing", 1);
  keep[keep.length - 1][1] = Math.min(keep[keep.length - 1][1], info.duration);

  const f = [];
  const FADE = 0.006;
  keep.forEach(([s, e], i) => {
    const d = e - s;
    if (info.hasVideo) f.push(`[0:v]trim=start=${s.toFixed(5)}:end=${e.toFixed(5)},setpts=PTS-STARTPTS[v${i}]`);
    if (info.hasAudio) f.push(`[0:a]atrim=start=${s.toFixed(5)}:end=${e.toFixed(5)},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE},afade=t=out:st=${Math.max(0, d - FADE).toFixed(5)}:d=${FADE}[a${i}]`);
  });
  const inputs = keep.map((_, i) => (info.hasVideo ? `[v${i}]` : "") + (info.hasAudio ? `[a${i}]` : "")).join("");
  f.push(`${inputs}concat=n=${keep.length}:v=${info.hasVideo ? 1 : 0}:a=${info.hasAudio ? 1 : 0}${info.hasVideo ? "[v]" : ""}${info.hasAudio ? "[a]" : ""}`);
  const args = ["-hide_banner", "-nostats", "-loglevel", "error", "-y", "-i", video, "-filter_complex", f.join(";")];
  if (info.hasVideo) args.push("-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(a.crf ?? 18), "-preset", String(a.preset ?? "veryfast"), "-r", String(r3(fps)), "-g", String(Math.round(fps)));
  if (info.hasAudio) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  args.push("-movflags", "+faststart", resolve(a.out));
  const r = run("ffmpeg", args);
  if (r.status !== 0) die("ffmpeg failed:\n" + r.stderr.slice(-1500));
  const outInfo = probe(resolve(a.out));

  // retime words: new time = offset of the keep segment + position inside it
  const offsets = [];
  let acc = 0;
  for (const [s, e] of keep) { offsets.push(acc); acc += e - s; }
  const total = acc;
  let srcWords = edl.words;
  if (a.words) {
    srcWords = readWords(resolve(a.words)).words;
    const key = (l) => JSON.stringify((l || []).map((w) => [w.w, r3(w.start), r3(w.end)]));
    if (Array.isArray(edl.words) && key(edl.words) !== key(srcWords)) console.error(`silence-cut: warning: ${resolve(a.words)} differs from the words embedded in the EDL; using the file (cuts were planned on the embedded copy, so check the joins if you changed times)`);
  } else if (Array.isArray(edl.words)) console.error("silence-cut: words come from the copy embedded in the EDL; edits made to the words file after plan are ignored (pass --words <file> to use them)");
  const out = [];
  for (const w of srcWords || []) {
    const mid = (w.start + w.end) / 2;
    const seg = keep.findIndex(([s, e]) => mid >= s && mid <= e);
    if (seg < 0) continue; // inside a cut: a cut filler or a hallucination
    const [s, e] = keep[seg];
    const ns = offsets[seg] + Math.max(w.start, s) - s;
    const ne = offsets[seg] + Math.min(w.end, e) - s;
    if (ne - ns < 0.02) continue;
    out.push({ w: w.w, start: r3(ns), end: r3(ne), ...(w.unsure ? { unsure: true } : {}) });
  }
  const wp = resolve(a["words-out"] || String(a.out).replace(/\.[^.]+$/, "") + ".words.json");
  writeFileSync(wp, JSON.stringify({ schema: 1, language: edl.params?.language ?? null, engine: edl.params?.engine ?? null, edited: true, duration: r3(outInfo.duration), words: out }, null, 2) + "\n");
  console.log(`  retimed words: ${out.length} of ${srcWords?.length ?? 0} kept\n  words-out: ${wp}`);
  console.log(`cut: ${edl.source_duration}s -> ${r3(outInfo.duration)}s (expected ${r3(total)}s), ${keep.length} segments -> ${resolve(a.out)}`);
  if (Math.abs(outInfo.duration - total) > DURATION_TOLERANCE_FRAMES / fps) die(`output duration ${r3(outInfo.duration)}s differs from expected ${r3(total)}s by more than ${DURATION_TOLERANCE_FRAMES} frames (${r3(DURATION_TOLERANCE_FRAMES / fps)}s)`, 1);
}

const [cmd, ...rest] = process.argv.slice(2);
const a = parseArgs(rest);
if (cmd === "plan") plan(a);
else if (cmd === "apply") apply(a);
else {
  console.error("usage: silence-cut.mjs plan|apply ... (see the header of this file or README.md)");
  process.exit(64);
}
