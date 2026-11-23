#!/usr/bin/env node
// sync-check: are the words on screen where they are heard?
//   node sync-check.mjs <audio-or-video> --words words.json --language tr [--model medium] [--offset 0] [--json]
// Transcribes the file again (transcribe.mjs next to this file, default model medium), matches the words in order with
// the words.json the video was built from, and measures how far each matched word moved. A transcript that skipped a
// sentence puts every later caption and picture early; nothing else catches that, because nobody here can hear.
// --offset: where words.json's time 0 sits in the file (e.g. 1.5 when the speech starts after a 1.5 s intro).
// Exit: 0 in step, 1 out of step (median shift > 0.25 s, 10% of words off by > 0.5 s, or under 60% of words heard), 2 cannot run, 64 usage.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const norm = (w) => String(w).toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]+/gu, "");

// longest common subsequence of word texts; returns index pairs [i in a, j in b]
export function matchWords(a, b) {
  const A = a.map((x) => norm(x.w)), B = b.map((x) => norm(x.w));
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] && A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] && A[i] === B[j]) { pairs.push([i, j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return pairs;
}

export function syncStats(expected, heard, offset = 0) {
  const pairs = matchWords(expected, heard).filter(([i]) => norm(expected[i].w).length >= 3);
  const d = pairs.map(([i, j]) => ({ w: expected[i].w, at: expected[i].start, shift: heard[j].start - offset - expected[i].start }));
  const abs = d.map((x) => Math.abs(x.shift)).sort((x, y) => x - y);
  const q = (p) => (abs.length ? abs[Math.min(abs.length - 1, Math.floor(p * abs.length))] : NaN);
  const sorted = d.map((x) => x.shift).sort((x, y) => x - y);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
  const counted = expected.filter((x) => norm(x.w).length >= 3).length;
  const worst = [...d].sort((x, y) => Math.abs(y.shift) - Math.abs(x.shift)).slice(0, 5);
  const problems = [];
  const heardShare = counted ? d.length / counted : 0;
  if (heardShare < 0.6) problems.push(`only ${Math.round(heardShare * 100)}% of the words on screen were heard again: the transcript and the audio differ (wrong file, or the transcript skipped or invented speech)`);
  if (Math.abs(median) > 0.25) problems.push(`words on screen are ${median > 0 ? "early" : "late"} by ${Math.abs(median).toFixed(2)} s on average`);
  if (d.length && d.filter((x) => Math.abs(x.shift) > 0.5).length / d.length > 0.1) problems.push(`${d.filter((x) => Math.abs(x.shift) > 0.5).length} of ${d.length} words are off by more than 0.5 s (e.g. "${worst[0].w}" at ${worst[0].at.toFixed(2)} s is heard ${worst[0].shift > 0 ? "later" : "earlier"} by ${Math.abs(worst[0].shift).toFixed(2)} s)`);
  return { matched: d.length, counted, heard_share: +heardShare.toFixed(2), median_shift: +median.toFixed(3), p90_abs_shift: +q(0.9).toFixed(3), worst: worst.map((x) => ({ w: x.w, at: +x.at.toFixed(2), shift: +x.shift.toFixed(2) })), problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const argv = process.argv.slice(2), a = { _: [] };
  for (let i = 0; i < argv.length; i++) { const t = argv[i]; if (t.startsWith("--")) { const v = argv[i + 1]; if (v === undefined || v.startsWith("--")) a[t.slice(2)] = true; else { a[t.slice(2)] = v; i++; } } else a._.push(t); }
  const die = (m, c = 2) => { console.error("sync-check: " + m); process.exit(c); };
  if (!a._[0] || typeof a.words !== "string" || typeof a.language !== "string") die("usage: sync-check.mjs <audio-or-video> --words words.json --language <code> [--model medium] [--offset 0] [--json]", 64);
  const media = resolve(a._[0]), wordsPath = resolve(a.words);
  for (const f of [media, wordsPath]) if (!existsSync(f)) die(`no such file: ${f}`);
  const expected = (JSON.parse(readFileSync(wordsPath, "utf8")).words ?? []).filter((x) => x && typeof x.w === "string" && Number.isFinite(x.start));
  if (!expected.length) die("words.json has no words", 64);
  const tmp = mkdtempSync(join(tmpdir(), "sync-check-"));
  try {
    const out = join(tmp, "heard.json");
    const model = typeof a.model === "string" ? a.model : "medium";
    const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "transcribe.mjs"), media, "--language", a.language, "--model", model, "--out", out, ...(typeof a.hf === "string" ? ["--hf", a.hf] : [])], { encoding: "utf8" });
    if (r.status !== 0 || !existsSync(out)) die("could not transcribe the file again: " + (r.stderr || r.stdout || "").trim().split("\n").slice(-2).join(" | "));
    const heard = JSON.parse(readFileSync(out, "utf8")).words;
    const s = syncStats(expected, heard, Number(a.offset ?? 0) || 0);
    if (a.json) console.log(JSON.stringify(s, null, 2));
    else {
      console.log(`sync-check: ${s.matched} of ${s.counted} words matched; median shift ${s.median_shift} s, 90% within ${s.p90_abs_shift} s (heard again with ${model})`);
      for (const w of s.worst) console.log(`  "${w.w}" at ${w.at} s: heard ${w.shift > 0 ? "+" : ""}${w.shift} s`);
    }
    if (s.problems.length) { console.error("sync-check: OUT OF STEP:\n  " + s.problems.join("\n  ") + "\n  Transcribe the clip itself with --model medium (or larger) and rebuild captions and picture timings from that file."); process.exit(1); }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
