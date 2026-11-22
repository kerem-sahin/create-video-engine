#!/usr/bin/env node
// levels: audio file -> JSON with one loudness value (0..1) per video frame, for the waveform block.
//   node levels.mjs <audio> [--fps 30] [--out levels.json]
// ffmpeg decodes to 8 kHz mono PCM; the RMS of each frame's window is taken in dB, mapped from (peak - 40 dB .. peak) to 0..1
// (peak = the 98th percentile of the non-silent frames), and smoothed with a fast attack and a slow release. Deterministic.
// The waveform block and the audio-mode assembly both read this file; no Web Audio at render time.
import { spawnSync } from "node:child_process";
import { writeFileSync, realpathSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 8000;
export function levelsFromPcm(pcm, fps) {
  const per = RATE / fps, n = Math.round(pcm.length / 2 / per), db = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const a = Math.floor(f * per), b = Math.min(pcm.length / 2, Math.floor((f + 1) * per));
    let s = 0;
    for (let i = a; i < b; i++) { const x = pcm.readInt16LE(i * 2) / 32768; s += x * x; }
    db[f] = b > a ? 10 * Math.log10(Math.max(s / (b - a), 1e-10)) : -100;
  }
  const loud = [...db].filter((x) => x > -60).sort((x, y) => x - y);
  const peak = loud.length ? loud[Math.min(loud.length - 1, Math.floor(loud.length * 0.98))] : -20;
  const floor = peak - 40;
  const lv = new Array(n);
  let prev = 0;
  for (let f = 0; f < n; f++) {
    const v = Math.max(0, Math.min(1, (db[f] - floor) / 40));
    prev = Math.max(v, prev * 0.8);
    lv[f] = Math.round(prev * 1000) / 1000;
  }
  return { levels: lv, peak_db: Math.round(peak * 10) / 10, floor_db: Math.round(floor * 10) / 10 };
}

export function computeLevels(audio, fps = 30) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-i", audio, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"], { maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error("ffmpeg could not decode the audio: " + (r.error?.message || String(r.stderr).slice(-400)));
  const { levels, peak_db, floor_db } = levelsFromPcm(r.stdout, fps);
  return { schema: 1, fps, frames: levels.length, seconds: Math.round(levels.length / fps * 1000) / 1000, peak_db, floor_db, levels };
}

if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const argv = process.argv.slice(2);
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith("--")) { a[argv[i].slice(2)] = argv[i + 1]; i++; } else a._.push(argv[i]); }
  if (!a._[0]) { console.error("usage: levels.mjs <audio> [--fps 30] [--out levels.json]"); process.exit(64); }
  if (!existsSync(resolve(a._[0]))) { console.error("levels: no such file: " + a._[0]); process.exit(2); }
  try {
    const j = computeLevels(resolve(a._[0]), a.fps ? +a.fps : 30);
    if (a.out) { writeFileSync(resolve(a.out), JSON.stringify(j) + "\n"); console.log(`levels: ${j.frames} frames (${j.seconds} s), peak ${j.peak_db} dB -> ${resolve(a.out)}`); }
    else console.log(JSON.stringify(j));
  } catch (e) { console.error("levels: " + e.message); process.exit(2); }
}
