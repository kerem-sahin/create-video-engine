#!/usr/bin/env node
// transcribe-local: audio or video -> word-level JSON, on this machine, free.
// A thin wrapper over `hyperframes transcribe` (whisper.cpp, engine "whisper"); it writes the word file
// that silence-cut, captions and shorts-from-long read:
//   { "schema": 1, "language": "tr", "engine": "whisper:small", "duration": 47.9,
//     "words": [ { "w": "Merhaba", "start": 0.01, "end": 0.72 }, ... ] }
// "w" keeps the punctuation Whisper wrote ("arkadaşlar,") so sentence ends can be found later.
//
//   node transcribe.mjs <audio-or-video> --language tr --out talk.words.json
//        [--model small|medium|large-v3|small.en|...]  [--hf <path to the hyperframes binary>] [--unsure-below 0.5]
//
// --model is passed to whisper (default small; small.en for English). Words that may be wrong are marked "unsure": true
// in the output and listed on screen, so the agent asks the person what was said. A word is unsure when the engine gives
// a probability below --unsure-below (0.5), or, because hyperframes' transcript file may carry no probabilities, when it
// looks suspect: digits mixed with letters, 3+ letters with no vowel, a letter repeated 3 times, or a capitalised word in
// the middle of a sentence (a name, which whisper often misspells).
//
// First run downloads the whisper runtime and the model (small: ~470 MB) - several minutes. Later runs of
// "small" take roughly 1/8 of the audio length on an Apple-silicon laptop (48 s of speech: 6 s).
// Exit: 0 ok, 2 cannot run, 64 usage.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve, dirname } from "node:path";

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const nxt = argv[i + 1];
      if (nxt === undefined || nxt.startsWith("--")) a[argv[i].slice(2)] = true;
      else { a[argv[i].slice(2)] = nxt; i++; }
    } else a._.push(argv[i]);
  }
  return a;
}
let tmpDir = null;
const die = (m, c = 2) => { console.error("transcribe-local: " + m); if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); process.exit(c); };

// ffmpeg silencedetect -> [[start, end], ...]
function detectSilences(file, noise, minDur) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=noise=${noise}:d=${minDur}`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = [];
  let cur = null;
  for (const line of (r.stderr || "").split("\n")) {
    let m = line.match(/silence_start: (-?[\d.]+)/);
    if (m) cur = Math.max(0, parseFloat(m[1]));
    m = line.match(/silence_end: (-?[\d.]+)/);
    if (m && cur !== null) { out.push([cur, parseFloat(m[1])]); cur = null; }
  }
  if (cur !== null) out.push([cur, Infinity]);
  return out;
}

// whisper.cpp stretches words over the pauses around them and sometimes times a word inside a pause.
// Speech cannot happen in digital silence, so: a word whose middle lies in a silence is re-placed at the start of
// the next stretch of sound and the other words of that stretch are squeezed into what is left of it.
// Words in a silence that runs to the end of the file are hallucinations over a silent tail and are removed.
// Edits `words` in place; returns how many words were re-placed or removed.
function alignToSilences(words, silences, duration) {
  if (!silences.length) return 0;
  const inSil = (t) => silences.findIndex(([s, e]) => t > s && t < Math.min(e, duration + 1));
  const W = (w) => Math.max(1, w.w.replace(/[^\p{L}\p{N}]/gu, "").length);
  const secPerChar = 0.065; // ~15 letters per second, typical conversational speech
  let touched = 0;
  // islands: [start,end] stretches between silences
  const islands = [];
  let t = 0;
  for (const [s, e] of silences) { if (s > t + 0.02) islands.push([t, s]); t = Math.min(e, duration); }
  if (t < duration - 0.02) islands.push([t, duration]);
  const group = islands.map(() => ({ orph: [], own: [] }));
  const drop = new Set();
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    const si = inSil(mid);
    if (si >= 0) {
      const [, e] = silences[si];
      if (!isFinite(e) || e >= duration - 0.05) { drop.add(w); continue; }
      const k = islands.findIndex(([a]) => a >= e - 0.02);
      if (k >= 0) { group[k].orph.push(w); touched++; } else drop.add(w);
    } else {
      const k = islands.findIndex(([a, b]) => mid >= a && mid <= b);
      if (k >= 0) group[k].own.push(w);
    }
  }
  islands.forEach(([a, b], k) => {
    const { orph, own } = group[k];
    if (!orph.length) return;
    let cur = a;
    for (const w of orph) { const d = W(w) * secPerChar; w.start = cur; w.end = Math.min(b, cur + d); cur = w.end; }
    if (own.length) {
      const o0 = own[0].start, o1 = Math.max(...own.map((w) => w.end));
      const span = Math.max(0.05, o1 - o0), room = Math.max(0.2, b - cur);
      for (const w of own) { w.start = cur + ((w.start - o0) / span) * room; w.end = cur + ((w.end - o0) / span) * room; }
    }
  });
  for (const w of drop) { words.splice(words.indexOf(w), 1); touched++; }
  words.sort((x, y) => x.start - y.start);
  for (const w of words) { w.start = Math.round(w.start * 1000) / 1000; w.end = Math.round(w.end * 1000) / 1000; }
  return touched;
}

// Marks suspect words in `reasons` (Map word-object -> why). Probability if the engine gave one, else simple heuristics.
function markUnsure(words, reasons, below) {
  const SENT = /[.!?…]["”')]*$/u;
  words.forEach((x, i) => {
    const core = x.w.replace(/[^\p{L}\p{N}]/gu, "");
    let why = null;
    if (typeof x.p === "number" && x.p < below) why = `low confidence ${x.p.toFixed(2)}`;
    else if (/\d/.test(core) && /\p{L}/u.test(core)) why = "digits mixed with letters";
    else if (core.length >= 3 && !/[aeıioöuüâîû]/iu.test(core) && /^\p{L}+$/u.test(core) && !/^(hm+|mm+|shh+|psst|brr+)$/iu.test(core)) why = "no vowel";
    else if (/(\p{L})\1\1/iu.test(core)) why = "a letter repeated 3 times";
    else if (core.length >= 3 && /^\p{Lu}\p{Ll}+$/u.test(core) && i > 0 && !SENT.test(words[i - 1].w)) why = "capitalised mid-sentence: a name? check the spelling";
    if (why) reasons.set(x, why);
  });
}

const a = parseArgs(process.argv.slice(2));
const input = a._[0];
if (!input || !a.out || typeof a.language !== "string") {
  die("usage: transcribe.mjs <audio-or-video> --language <code, e.g. tr|en> --out <words.json> [--model small]", 64);
}
const src = resolve(input);
if (!existsSync(src)) die(`no such file: ${src}`);

// Find the hyperframes binary: --hf, $HYPERFRAMES_BIN, node_modules/.bin walking up from here and from the cwd.
function findHf() {
  if (typeof a.hf === "string") return a.hf;
  if (process.env.HYPERFRAMES_BIN) return process.env.HYPERFRAMES_BIN;
  for (const start of [process.cwd(), dirname(fileURLToPath(import.meta.url))]) {
    let d = resolve(start);
    for (;;) {
      const p = join(d, "node_modules", ".bin", "hyperframes");
      if (existsSync(p)) return p;
      const up = dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  return null;
}
const hf = findHf();
if (!hf) die("hyperframes is not installed here. Run this from inside the studio (npm install), or pass --hf <path>.");

const lang = a.language.toLowerCase();
const model = typeof a.model === "string" ? a.model : lang === "en" ? "small.en" : "small";
const env = { ...process.env, HYPERFRAMES_TELEMETRY: "0", DO_NOT_TRACK: "1" };

const tmp = mkdtempSync(join(tmpdir(), "transcribe-"));
tmpDir = tmp;
try {
  // 16 kHz mono wav: what whisper wants, and it keeps the tool independent of the container/codec.
  const wav = join(tmp, "audio.wav");
  const ff = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", wav], { encoding: "utf8" });
  if (ff.error) die("ffmpeg not found (brew install ffmpeg)");
  if (ff.status !== 0) die("ffmpeg could not read the audio: " + ff.stderr.slice(-400));

  const t0 = Date.now();
  const r = spawnSync(hf, ["transcribe", wav, "--engine", "whisper", "--model", model, "--language", lang, "--json", "--dir", tmp], {
    encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) die("cannot run hyperframes: " + r.error.message);
  const lines = r.stdout.trim().split("\n").filter(Boolean);
  let res = null;
  for (const l of lines) { try { const j = JSON.parse(l); if (j.ok !== undefined) res = j; } catch {} }
  if (r.status !== 0 || !res?.ok) die("hyperframes transcribe failed: " + (res?.error?.message || r.stderr.slice(-500) || r.stdout.slice(-500)));

  const raw = JSON.parse(readFileSync(res.transcriptPath, "utf8"));
  const words = raw
    .map((x) => ({ w: String(x.text ?? "").trim(), start: +x.start, end: +x.end, p: [x.p, x.probability, x.confidence, x.prob].find((v) => typeof v === "number") }))
    .filter((x) => x.w && !/^[♪�\s]+$/u.test(x.w) && isFinite(x.start) && isFinite(x.end) && x.end > x.start)
    .map((x) => ({ w: x.w, start: Math.round(x.start * 1000) / 1000, end: Math.round(x.end * 1000) / 1000, p: x.p }));
  const reasons = new Map();
  markUnsure(words, reasons, typeof a["unsure-below"] === "string" ? +a["unsure-below"] : 0.5);
  const bad = raw.filter((x) => /[♪�]/u.test(x.text)).length;
  if (!words.length) die("no speech found (silent file, or the wrong --language)", 2);
  if (bad / raw.length > 0.2) console.error("transcribe-local: warning: over 20% of tokens are non-words; try --model medium");

  const dur = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav], { encoding: "utf8" });
  const duration = Math.round(parseFloat(dur.stdout) * 1000) / 1000;
  let aligned = false;
  if (!a["no-align"]) {
    const sil = detectSilences(wav, typeof a.noise === "string" ? a.noise : "-35dB", 0.3);
    const moved = alignToSilences(words, sil, duration);
    aligned = sil.length > 0;
    if (moved) console.error(`transcribe-local: re-placed ${moved} word(s) that whisper had timed inside a pause`);
  }
  const outWords = words.map((x) => ({ w: x.w, start: x.start, end: x.end, ...(reasons.has(x) ? { unsure: true } : {}) }));
  const out = { schema: 1, language: lang, engine: `whisper:${model}`, aligned, duration, words: outWords };
  writeFileSync(resolve(a.out), JSON.stringify(out, null, 2) + "\n");
  const secs = (Date.now() - t0) / 1000;
  console.log(`transcribe-local: ${words.length} words, ${duration}s of audio, ${secs.toFixed(1)}s (${model}) -> ${resolve(a.out)}`);
  if (reasons.size) {
    console.log(`unsure: ${reasons.size} word(s) marked "unsure": true. Ask the person what was said (they are never put on cards unchecked):`);
    words.forEach((x, i) => { if (reasons.has(x)) console.log(`  ${x.start.toFixed(2)}s  "${x.w}"  (${reasons.get(x)})  ...${words.slice(Math.max(0, i - 3), i + 4).map((y) => y.w).join(" ")}...`); });
  } else console.log("unsure: none marked (this is a heuristic, not a guarantee: read the text once)");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
