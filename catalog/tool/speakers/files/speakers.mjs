#!/usr/bin/env node
// speakers: who speaks when, from ONE mono recording of two or more people. Local, free, no account, no token.
// Engine: sherpa-onnx offline speaker diarization (Apache-2.0): pyannote-segmentation-3.0 (MIT, the ONNX copy that
// sherpa-onnx publishes, no Hugging Face login) + a speaker-embedding model, then clustering.
//
//   node speakers.mjs --audio <file> [--words words.json] [--speakers 2] --out speakers.json
//   node speakers.mjs --install          one-time setup (python venv + sherpa-onnx + ~40 MB of models), no root
//   node speakers.mjs --check            say whether the engine is installed
//
// Output: { schema:1, engine, speakers:["A","B"], turns:[{start,end,speaker}], words?:[{w,start,end,speaker}], summary }
// Labels are A, B, C... in order of first speech; the person maps them to names later (A -> "Kerem").
// Exit: 0 ok, 2 cannot run, 64 usage.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, createReadStream, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const HOME = process.env.CVE_SPEAKERS_HOME || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "create-video-engine", "speakers");
const REL = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
export const MODELS = {
  segmentation: { url: `${REL}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`, sha256: "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488", file: "sherpa-onnx-pyannote-segmentation-3-0/model.onnx", bytes: 6958444 },
  embedding: { url: `${REL}/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`, sha256: "53cab20ba8f2eb2f6e2d89ecc18e88ef3222169b61b4419cbc13666744a4574b", file: "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx", bytes: 28281165 },
};
export const PY = join(HOME, "venv", "bin", "python3");
const modelPath = (k) => join(HOME, "models", MODELS[k].file);
export const installed = () => existsSync(PY) && existsSync(modelPath("segmentation")) && existsSync(modelPath("embedding"));

// ---- pure functions (unit-tested without the engine) ----
const LABELS = (i) => (i < 26 ? String.fromCharCode(65 + i) : "S" + (i + 1));

/** raw engine segments [{start,end,speaker:int}] -> labelled turns; same-speaker neighbours closer than mergeGap join. */
export function toTurns(segments, { mergeGap = 0.4, minTurn = 0.3 } = {}) {
  const sorted = segments.filter((s) => s.end > s.start).map((s) => ({ ...s })).sort((a, b) => a.start - b.start || a.end - b.end);
  const order = [];
  for (const s of sorted) if (!order.includes(s.speaker)) order.push(s.speaker);
  const speakers = order.map((_, i) => LABELS(i));
  const turns = [];
  for (const s of sorted) {
    const label = LABELS(order.indexOf(s.speaker));
    const last = turns[turns.length - 1];
    if (last && last.speaker === label && s.start - last.end <= mergeGap) last.end = Math.max(last.end, s.end);
    else turns.push({ start: round(s.start), end: round(s.end), speaker: label });
  }
  const kept = turns.filter((t) => t.end - t.start >= minTurn);
  for (let i = 1; i < kept.length; i++) if (kept[i].speaker === kept[i - 1].speaker && kept[i].start - kept[i - 1].end <= mergeGap) { kept[i - 1].end = kept[i].end; kept.splice(i--, 1); }
  return { speakers: speakers.filter((l) => kept.some((t) => t.speaker === l)), turns: kept };
}
const round = (x) => Math.round(x * 1000) / 1000;

/** each word goes to the turn covering its midpoint; if none does (a pause), to the nearest turn within maxGap, else null. */
export function assignWords(words, turns, { maxGap = 1.0 } = {}) {
  let j = 0;
  return words.map((w) => {
    const mid = (w.start + w.end) / 2;
    while (j > 0 && turns[j].start > mid) j--;
    while (j < turns.length - 1 && turns[j].end < mid) j++;
    let sp = null;
    for (let k = Math.max(0, j - 1); k <= Math.min(turns.length - 1, j + 1); k++) if (turns[k].start <= mid && mid <= turns[k].end) sp = turns[k].speaker;
    if (sp === null && turns.length) {
      let best = Infinity;
      for (const t of turns) { const d = mid < t.start ? t.start - mid : mid - t.end; if (d < best) { best = d; sp = t.speaker; } }
      if (best > maxGap) sp = null;
    }
    return { ...w, speaker: sp };
  });
}

export function summarize(speakers, turns) {
  const talk = Object.fromEntries(speakers.map((s) => [s, 0]));
  for (const t of turns) talk[t.speaker] += t.end - t.start;
  const total = Object.values(talk).reduce((a, b) => a + b, 0) || 1;
  let changes = 0;
  for (let i = 1; i < turns.length; i++) if (turns[i].speaker !== turns[i - 1].speaker) changes++;
  return { turns: turns.length, speaker_changes: changes, talk_seconds: Object.fromEntries(Object.entries(talk).map(([k, v]) => [k, Math.round(v)])), talk_share: Object.fromEntries(Object.entries(talk).map(([k, v]) => [k, Math.round((v / total) * 100) / 100])) };
}
export function summaryText(s) {
  const mm = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, "0")}`;
  return Object.keys(s.talk_seconds).map((k) => `${k}: ${mm(s.talk_seconds[k])} (${Math.round(s.talk_share[k] * 100)}%)`).join(", ") + `; ${s.turns} turns, ${s.speaker_changes} speaker changes`;
}

/** words.json from transcribe-local ({words:[...]}) or a bare array. */
export function parseWords(json) {
  const arr = Array.isArray(json) ? json : json && json.words;
  if (!Array.isArray(arr)) throw new Error("words file has no words array");
  for (const w of arr) if (typeof w.start !== "number" || typeof w.end !== "number") throw new Error("a word has no start/end numbers");
  return arr;
}

// ---- install and run ----
const sha256 = (f) => new Promise((ok, no) => { const h = createHash("sha256"); createReadStream(f).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", no); });
const sh = (cmd, args, opt = {}) => spawnSync(cmd, args, { encoding: "utf8", stdio: opt.inherit ? "inherit" : "pipe", maxBuffer: 256 * 1024 * 1024 });

async function install() {
  mkdirSync(join(HOME, "models"), { recursive: true });
  console.log(`speakers: installing into ${HOME} (no root, nothing outside this folder)`);
  if (!existsSync(PY)) {
    if (sh("python3", ["-m", "venv", join(HOME, "venv")]).status !== 0) throw new Error("python3 -m venv failed (python3 3.9+ needed)");
    const p = sh(PY, ["-m", "pip", "install", "--quiet", "sherpa-onnx", "numpy"], { inherit: true });
    if (p.status !== 0) throw new Error("pip install sherpa-onnx numpy failed");
  }
  for (const k of Object.keys(MODELS)) {
    const m = MODELS[k];
    if (existsSync(modelPath(k))) continue;
    const dl = join(HOME, "models", "dl-" + k);
    rmSync(dl, { recursive: true, force: true });
    mkdirSync(dl, { recursive: true });
    const f = join(dl, m.url.split("/").pop());
    console.log(`speakers: downloading ${m.url.split("/").pop()} (${(m.bytes / 1e6).toFixed(0)} MB)`);
    if (sh("curl", ["-fL", "--silent", "--show-error", "-o", f, m.url]).status !== 0) throw new Error("download failed: " + m.url);
    const got = await sha256(f);
    if (got !== m.sha256) { rmSync(dl, { recursive: true, force: true }); throw new Error(`checksum mismatch for ${m.url}: ${got}`); }
    if (f.endsWith(".tar.bz2")) { if (sh("tar", ["-xjf", f, "-C", join(HOME, "models")]).status !== 0) throw new Error("untar failed"); }
    else renameSync(f, modelPath(k));
    rmSync(dl, { recursive: true, force: true });
  }
  console.log("speakers: installed");
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { const n = argv[i + 1]; if (n === undefined || n.startsWith("--")) a[argv[i].slice(2)] = true; else { a[argv[i].slice(2)] = n; i++; } }
    else a._.push(argv[i]);
  }
  return a;
}

export async function main(argv) {
  const a = parseArgs(argv);
  const die = (m, c = 2) => { console.error("speakers: " + m); process.exit(c); };
  if (a.install) { try { await install(); } catch (e) { die(e.message); } return; }
  if (a.check) { console.log(installed() ? `speakers: engine installed in ${HOME}` : `speakers: engine NOT installed (run: node speakers.mjs --install)`); process.exit(installed() ? 0 : 2); }
  if (!a.audio || typeof a.audio !== "string" || !a.out || typeof a.out !== "string") die("usage: node speakers.mjs --audio <file> [--words words.json] [--speakers N] --out speakers.json   (or --install / --check)", 64);
  const n = a.speakers === undefined ? 0 : Number(a.speakers);
  if (!Number.isInteger(n) || n < 0 || n === 1) die("--speakers must be 2 or more (or left out for automatic)", 64);
  if (!existsSync(a.audio)) die("no such file: " + a.audio);
  if (!installed()) die(`the engine is not installed. One-time setup, no account, no root: node ${join(HERE, "speakers.mjs")} --install   (about 40 MB of models plus the sherpa-onnx wheel, into ${HOME})`);
  let words = null;
  if (a.words) { try { words = parseWords(JSON.parse(readFileSync(a.words, "utf8"))); } catch (e) { die("--words: " + e.message); } }
  const tmp = mkdtempSync(join(tmpdir(), "cve-speakers-"));
  try {
    const wav = join(tmp, "a.wav");
    const f = sh("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", "-i", resolve(a.audio), "-vn", "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", wav]);
    if (f.status !== 0) die("ffmpeg could not read the audio: " + f.stderr.trim().split("\n").pop());
    const t0 = Date.now();
    const args = [join(HERE, "diarize.py"), wav, modelPath("segmentation"), modelPath("embedding"), String(n)];
    if (a.threshold) args.push(String(a.threshold));
    const r = sh(PY, ["-I", ...args]);
    if (r.status !== 0) die("diarization failed: " + (r.stderr || "").trim().split("\n").slice(-3).join(" | "));
    const raw = JSON.parse(r.stdout.trim().split("\n").pop()).segments;
    const { speakers, turns } = toTurns(raw);
    if (!turns.length) die("no speech found in the audio");
    const out = { schema: 1, engine: "sherpa-onnx:pyannote-seg-3.0+campplus", requested_speakers: n || "auto", speakers, turns };
    if (words) out.words = assignWords(words, turns);
    out.summary = summarize(speakers, turns);
    writeFileSync(a.out, JSON.stringify(out, null, 1));
    console.log(`speakers: ${speakers.length} found (${((Date.now() - t0) / 1000).toFixed(0)} s). ${summaryText(out.summary)}`);
    if (words) console.log(`speakers: ${out.words.filter((w) => w.speaker === null).length} of ${words.length} words had no speaker (silence far from any turn)`);
    if (!n && speakers.length !== 2) console.log(`speakers: WARNING: automatic mode found ${speakers.length} speaker(s); it can split one person into many or merge two voices. Re-run with --speakers N (the real number of people).`);
    console.log("speakers: labels are A, B, ...; map them to names yourself. A listen is needed to confirm them.");
    console.log("speakers: wrote " + a.out);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
