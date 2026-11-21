import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureLufs } from './audio.mjs';
import { STYLES, STYLE_IDS, buildMotif, deriveStyle, renderStyle } from './styles.mjs';

export const SR = 44100;
export const TARGET_LUFS = -16;
export const PALETTES = ['nylon', 'felt-piano', 'marimba', 'kalimba', 'soft-synth'];
export { STYLES, STYLE_IDS };
export const CUE_KINDS = ['cut', 'highlight', 'impact', 'confirm', 'type', 'tick', 'end'];
const TAU = 2 * Math.PI;

export function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function prng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// ---- harmony -------------------------------------------------------------------------------------------------
// A chord = [root offset from the tonic in semitones, chord-tone intervals, name suffix]. Four tones each (the pad and strums use all four).
const C = {
  I: [0, [0, 4, 7, 11], 'maj7'], iii: [4, [0, 3, 7, 10], 'm7'], IV: [5, [0, 4, 7, 11], 'maj7'], V: [7, [0, 4, 7, 9], '6'], vi: [9, [0, 3, 7, 10], 'm7'],
  i: [0, [0, 3, 7, 10], 'm7'], iv: [5, [0, 3, 7, 10], 'm7'], v: [7, [0, 3, 7, 10], 'm7'], III: [3, [0, 4, 7, 11], 'maj7'], VI: [8, [0, 4, 7, 11], 'maj7'], VII: [10, [0, 4, 7, 10], '7'],
  // colours added for variety: add9, sus2, sus4, 7sus4, borrowed chords (bVII and iv in major, bII in minor), ii-V
  Iadd9: [0, [0, 4, 7, 14], 'add9'], Isus2: [0, [0, 2, 7, 12], 'sus2'], Isus4: [0, [0, 5, 7, 12], 'sus4'], IVadd9: [5, [0, 4, 7, 14], 'add9'], IVsus2: [5, [0, 2, 7, 12], 'sus2'],
  ii: [2, [0, 3, 7, 10], 'm7'], V7: [7, [0, 4, 7, 10], '7'], Vsus4: [7, [0, 5, 7, 10], '7sus4'], bVII: [10, [0, 4, 7, 12], ''],
  iadd9: [0, [0, 3, 7, 14], 'm(add9)'], isus2: [0, [0, 2, 7, 12], 'sus2'], isus4: [0, [0, 5, 7, 12], 'sus4'], IIIadd9: [3, [0, 4, 7, 14], 'add9'], VIadd9: [8, [0, 4, 7, 14], 'add9'], bII: [1, [0, 4, 7, 11], 'maj7'],
};
// One chord per bar, four bars; the first five of each mode are the original ones (the `classic` style still picks only from those).
export const LEGACY_PROGRESSIONS = 5;
export const PROGRESSIONS = {
  major: [['I', 'vi', 'IV', 'V'], ['I', 'V', 'vi', 'IV'], ['I', 'iii', 'IV', 'V'], ['vi', 'IV', 'I', 'V'], ['I', 'IV', 'vi', 'V'],
    ['I', 'bVII', 'IV', 'I'], ['I', 'IV', 'iv', 'I'], ['Iadd9', 'V', 'vi', 'IVadd9'], ['Isus2', 'IVadd9', 'vi', 'Vsus4'], ['I', 'VI', 'bVII', 'I'], ['I', 'ii', 'V7', 'vi'], ['IVadd9', 'I', 'V', 'vi']],
  minor: [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'VII', 'III'], ['i', 'VII', 'VI', 'VII'], ['i', 'iv', 'VI', 'v'], ['VI', 'VII', 'i', 'v'],
    ['i', 'VI', 'iv', 'V7'], ['iadd9', 'VII', 'VIadd9', 'VII'], ['isus2', 'VI', 'IIIadd9', 'VII'], ['i', 'bII', 'VII', 'i'], ['VI', 'III', 'VII', 'i'], ['i', 'iv', 'VII', 'VI'], ['isus4', 'i', 'VI', 'VII']],
};
// Two chords per bar (eight chords over four bars), for the faster styles.
export const FAST_PROGRESSIONS = {
  major: [['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'], ['I', 'IV', 'vi', 'V', 'ii', 'V7', 'Iadd9', 'V7'], ['I', 'bVII', 'IV', 'I', 'vi', 'IV', 'Isus4', 'V7'], ['Iadd9', 'iii', 'IVadd9', 'V', 'vi', 'IV', 'Vsus4', 'V7']],
  minor: [['i', 'VII', 'VI', 'VII', 'i', 'iv', 'VII', 'III'], ['i', 'VI', 'III', 'VII', 'iv', 'VI', 'V7', 'i'], ['iadd9', 'VII', 'VI', 'v', 'i', 'bII', 'VII', 'V7'], ['VI', 'VII', 'i', 'III', 'iv', 'VII', 'isus4', 'V7']],
};
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_DEGREES = [1, 3, 8, 10];
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function keyPc(key) {
  const m = /^([A-G])([#b]?)$/.exec(key);
  if (!m) return null;
  return (NATURAL[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}
const fold = (m, lo, hi) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; };

// ---- mood / config ---------------------------------------------------------------------------------------------
const has = (words, list) => words.some((w) => list.some((x) => w.startsWith(x)));

function fromMood(mood, rng) {
  const words = String(mood ?? '').toLowerCase().split(/[^a-z0-9ğüşöçıİ]+/).filter(Boolean);
  const minor = has(words, ['serious', 'dark', 'sad', 'tense', 'dramatic', 'melanchol', 'moody', 'somber']);
  const energetic = has(words, ['energ', 'upbeat', 'fast', 'dynamic', 'driv', 'lively', 'bright', 'happy']);
  const playful = has(words, ['playful', 'fun', 'quirky', 'cheerful', 'whimsic']);
  const calm = has(words, ['calm', 'quiet', 'warm', 'soft', 'gentle', 'peaceful', 'relax']);
  const lo = energetic ? 100 : minor ? 80 : calm || !words.length ? 70 : 74;
  const hi = energetic ? 118 : minor ? 95 : calm || !words.length ? 85 : 88;
  const r1 = rng(); const r2 = rng(); const r3 = rng();
  return {
    mode: minor ? 'minor' : 'major',
    palette: playful ? (r1 < 0.5 ? 'marimba' : 'kalimba') : minor ? 'felt-piano' : 'nylon',
    energy: energetic ? 0.7 : minor ? 0.3 : calm ? 0.3 : 0.35,
    bpm: Math.round(lo + r2 * (hi - lo)),
    key: words.length ? ['C', 'D', 'F', 'G', 'A'][Math.floor(r3 * 5)] : 'G',
  };
}

// Validates and completes a score description. Returns { error } or { cfg } (cfg is fully resolved and still JSON-serialisable).
export function resolveConfig(input, { mood = null, duration = null, bpm = null } = {}) {
  const bad = (m) => ({ error: m });
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return bad('cues.json must be a JSON object');
  const dur = Number(input.duration ?? duration);
  if (!Number.isFinite(dur) || dur < 3 || dur > 3600) return bad('duration must be 3..3600 seconds');
  const seed = input.seed === undefined ? hash(`${mood ?? ''}|${dur}`) : Number(input.seed);
  if (!Number.isInteger(seed)) return bad('seed must be an integer');
  const rng = prng(seed);
  const m = fromMood(mood, rng);
  const pick = (name, def) => (input[name] === undefined ? def : input[name]);
  const key = pick('key', m.key);
  if (typeof key !== 'string' || keyPc(key) === null) return bad('key must be C..B with optional # or b');
  const mode = pick('mode', m.mode);
  if (mode !== 'major' && mode !== 'minor') return bad('mode must be major or minor');
  const palette = pick('palette', m.palette);
  if (!PALETTES.includes(palette)) return bad(`palette must be one of ${PALETTES.join(', ')}`);
  const energy = Number(pick('energy', m.energy));
  if (!Number.isFinite(energy) || energy < 0 || energy > 1) return bad('energy must be 0..1');
  const tempo = Number(input.bpm ?? bpm ?? m.bpm);
  if (!Number.isFinite(tempo) || tempo < 40 || tempo > 200) return bad('bpm must be 40..200');
  const beatsPerBar = Number(pick('beats_per_bar', 4));
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 2 || beatsPerBar > 12) return bad('beats_per_bar must be an integer 2..12');
  const rawCues = pick('cues', []);
  if (!Array.isArray(rawCues)) return bad('cues must be an array');
  const beat = 60 / tempo;
  const cues = [];
  for (const [i, c] of rawCues.entries()) {
    if (c === null || typeof c !== 'object') return bad(`cue ${i} must be an object`);
    if (!CUE_KINDS.includes(c.kind)) return bad(`cue ${i}: kind must be one of ${CUE_KINDS.join(', ')}`);
    if (typeof c.beat !== 'number' || !Number.isFinite(c.beat) || c.beat < 0) return bad(`cue ${i}: beat must be a number >= 0`);
    if (c.beat * beat >= dur) return bad(`cue ${i}: beat ${c.beat} is at ${(c.beat * beat).toFixed(2)} s, past the duration`);
    const cue = { beat: c.beat, kind: c.kind };
    if (c.kind === 'type') {
      const n = c.beats === undefined ? 1 : c.beats;
      if (typeof n !== 'number' || !(n > 0) || n > 64) return bad(`cue ${i}: beats must be a number in (0, 64]`);
      cue.beats = n;
    }
    cues.push(cue);
  }
  cues.sort((a, b) => a.beat - b.beat);
  const progIdx = Math.floor(rng() * LEGACY_PROGRESSIONS);
  // style: explicit, else derived from the mood words and the energy (a separate seeded stream, so the stream above is untouched)
  const words = String(mood ?? '').toLowerCase().split(/[^a-z0-9ğüşöçıİ-]+/).filter(Boolean);
  const style = pick('style', undefined) ?? deriveStyle(words, energy, prng((seed ^ hash('style')) | 0));
  if (!STYLE_IDS.includes(style)) return bad(`style must be one of ${STYLE_IDS.join(', ')}`);
  // harmony: classic keeps its original draw from the first five; the other styles choose from the full pool (and the 8-chord pool when they change chord every half bar)
  const hr = prng((seed ^ hash(`harmony|${style}`)) | 0);
  const options = STYLES[style].cpb;
  const cpb = options.length > 1 ? options[Math.floor(hr() * options.length)] : options[0];
  let progNames;
  if (style === 'classic') progNames = PROGRESSIONS[mode][progIdx];
  else { const pool = cpb === 2 ? FAST_PROGRESSIONS[mode] : PROGRESSIONS[mode]; progNames = pool[Math.floor(hr() * pool.length)]; }
  return { cfg: { duration: dur, bpm: tempo, beats_per_bar: beatsPerBar, key, mode, palette, energy, seed, style, progIdx, progNames, cpb, cues, beat } };
}

// Chords per bar (the chord sounding at the start of the bar) and per slot (a bar holds `cpb` chords), plus the resolved cue list with times and chords, for score.json.
export function planScore(cfg) {
  const { key, mode, bpm, beat, duration, beats_per_bar: bpb, progNames, cpb, cues } = cfg;
  const tonic = keyPc(key);
  const names = key.includes('b') || key === 'F' ? FLAT : SHARP;
  const barLen = beat * bpb;
  const bars = Math.ceil(duration / barLen - 1e-9);
  const endCue = cues.find((c) => c.kind === 'end');
  const endBar = endCue ? Math.floor(endCue.beat / bpb) : null;
  const tonicChord = mode === 'minor' ? 'i' : 'I';
  const spell = (off, pc) => (FLAT_DEGREES.includes(off) ? FLAT : names)[pc]; // bII, bIII, bVI, bVII are spelled with flats
  const build = (ch, bar, slot) => {
    const pc = (tonic + ch[0]) % 12;
    return { bar, slot, name: `${spell(ch[0], pc)}${ch[2]}`, root_pc: pc, root: fold(48 + pc, 48, 59), tones: ch[1].map((x) => fold(48 + pc, 48, 59) + x), t0: bar * barLen + slot * barLen / cpb, len: barLen / cpb };
  };
  const slots = [];
  for (let b = 0; b < bars; b++) {
    const ended = b === bars - 1 || (endBar !== null && b >= endBar); // the last bar, and every bar from an end cue on, is the tonic chord
    for (let k = 0; k < cpb; k++) slots.push(build(C[ended ? tonicChord : progNames[(b * cpb + k) % progNames.length]], b, k));
  }
  const chords = [];
  for (let b = 0; b < bars; b++) { const { bar, name, root_pc: rootPc, root, tones } = slots[b * cpb]; chords.push({ bar, name, root_pc: rootPc, root, tones }); }
  const slotLen = barLen / cpb;
  const chordAt = (t) => slots[Math.max(0, Math.min(slots.length - 1, Math.floor(t / slotLen + 1e-9)))];
  const resolved = cues.map((c) => ({ ...c, time: Math.round(c.beat * beat * 1e6) / 1e6, bar: Math.min(bars - 1, Math.floor(c.beat / bpb + 1e-9)), chord: chordAt(c.beat * beat).name }));
  return { chords, slots, cpb, chordAt, resolved, bars, endBar, barLen, tonic, prog: progNames.map((n) => `${spell(C[n][0], (tonic + C[n][0]) % 12)}${C[n][2]}`), endTime: endCue ? endCue.beat * beat : null, bpm };
}

// ---- voices ----------------------------------------------------------------------------------------------------
// Every voice returns a Float32Array that ends in a short ramp to zero so it never clicks.
function tail(out, ramp) { const n = out.length; for (let i = 0; i < Math.min(ramp, n); i++) out[n - 1 - i] *= i / ramp; return out; }

function pluckKS(m, dur, rng, passes = 3, loop = 0.9985) {
  const P = Math.max(2, Math.round(SR / hz(m)));
  const buf = new Float32Array(P);
  for (let i = 0; i < P; i++) buf[i] = rng() * 2 - 1;
  for (let p = 0; p < passes; p++) { let prev = buf[P - 1]; for (let i = 0; i < P; i++) { const x = buf[i]; buf[i] = (x + prev) / 2; prev = x; } }
  const n = Math.floor(dur * SR); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i % P; const nx = (buf[j] + buf[(j + 1) % P]) / 2 * loop;
    buf[j] = nx; out[i] = nx * Math.min(1, i / 200);
  }
  return tail(out, 2000);
}

function partials(m, dur, parts, attack, decay) { // parts: [ratio, gain, extraDecay]
  const f = hz(m); const n = Math.floor(dur * SR); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR; let s = 0;
    for (const [r, g, d] of parts) s += g * Math.sin(TAU * f * r * t) * Math.exp(-t * d);
    const a = t < attack ? Math.sin(t / attack * Math.PI / 2) ** 2 : 1;
    out[i] = s * a * Math.exp(-t * decay);
  }
  return tail(out, 1500);
}

function softSynth(m, dur) {
  const f = hz(m); const n = Math.floor(dur * SR); const out = new Float32Array(n);
  const det = 2 ** (7 / 1200); const f1 = f / det; const f2 = f * det;
  let p1 = 0.13; let p2 = 0.61; let y = 0;
  const lp = 1 - Math.exp(-TAU * Math.min(2600, f * 3.5) / SR);
  const rel = Math.min(0.5, dur * 0.4);
  for (let i = 0; i < n; i++) {
    p1 += f1 / SR; if (p1 >= 1) p1 -= 1; p2 += f2 / SR; if (p2 >= 1) p2 -= 1;
    y += lp * ((2 * p1 - 1) + (2 * p2 - 1) - y);
    const t = i / SR;
    out[i] = y * 0.5 * Math.min(1, t / 0.07) ** 2 * Math.min(1, (dur - t) / rel);
  }
  return out;
}

function noteVoice(palette, m, dur, rng, bright) {
  switch (palette) {
    case 'felt-piano': return partials(m, dur, [[1, 1, 0], [2, 0.3, 2.5], [3, 0.1, 5]], 0.006, 2.4);
    case 'marimba': return partials(m, Math.min(dur, 0.9), [[1, 1, 0], [4, 0.3, 14]], 0.002, 5.5);
    case 'kalimba': return partials(m, Math.min(dur, 0.8), [[1, 1, 0], [5.4, 0.22, 16]], 0.002, 6.5);
    case 'soft-synth': return softSynth(m, dur);
    default: return bright ? pluckKS(m, dur, rng, 1, 0.9993) : pluckKS(m, dur, rng);
  }
}

function bassVoice(m, dur) {
  const f = hz(m); const n = Math.floor(dur * SR); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; out[i] = (Math.sin(TAU * f * t) + 0.15 * Math.sin(TAU * 2 * f * t)) * Math.min(1, t * 120) * Math.exp(-t * 1.6); }
  return tail(out, 1500);
}
function feltVoice() {
  const n = Math.floor(0.3 * SR); const out = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; ph += TAU * (52 + 60 * Math.exp(-t * 35)) / SR; out[i] = Math.sin(ph) * Math.exp(-t * 13) * Math.min(1, t * 400); }
  return tail(out, 600);
}
function brushVoice(rng) {
  const n = Math.floor(0.09 * SR); const out = new Float32Array(n); let prev = 0;
  for (let i = 0; i < n; i++) { const x = rng() * 2 - 1; out[i] = (x + prev) / 2 * Math.exp(-i / SR * 45) * Math.min(1, i / 120); prev = x; }
  return out;
}
function bellVoice(m, dur) {
  const f = hz(m); const n = Math.floor(dur * SR); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    out[i] = (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 2.4 * t) * Math.exp(-t * 5) + 0.2 * Math.sin(TAU * f * 3.9 * t) * Math.exp(-t * 9)) * Math.exp(-t * 2.6 * (2 / Math.max(dur, 1.5))) * Math.min(1, t * 400);
  }
  return tail(out, 3000);
}
function tickVoice(m) {
  const f = hz(m); const n = Math.floor(0.12 * SR); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; out[i] = Math.sin(TAU * f * t) * Math.exp(-t * 38) * Math.min(1, t * 600); }
  return tail(out, 200);
}
function mutedVoice(m) {
  const f = hz(m); const n = Math.floor(0.11 * SR); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; out[i] = (Math.sin(TAU * f * t) + 0.2 * Math.sin(TAU * 2 * f * t)) * Math.exp(-t * 42) * Math.min(1, t * 500); }
  return tail(out, 200);
}

function peakOf(a) { let p = 0; for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; }

// ---- reverb (one shared network) ----------------------------------------------------------------------------------
function reverb(ch, delays, fb, wet) {
  const N = ch.length;
  const bufs = delays.map((d) => new Float32Array(Math.round(d * SR)));
  const idx = new Int32Array(delays.length); const lp = new Float32Array(delays.length);
  const ap = [556, 441].map((d) => new Float32Array(d)); const api = [0, 0];
  const out = new Float32Array(N);
  const nc = bufs.length;
  for (let i = 0; i < N; i++) {
    const x = ch[i]; let acc = 0;
    for (let c = 0; c < nc; c++) {
      const b = bufs[c]; const k = idx[c]; const y = b[k];
      lp[c] += 0.45 * (y - lp[c]);
      b[k] = x + fb * lp[c];
      idx[c] = k + 1 === b.length ? 0 : k + 1;
      acc += y;
    }
    let v = acc / nc;
    for (let a = 0; a < 2; a++) { // allpass diffusion
      const b = ap[a]; const k = api[a]; const z = b[k];
      const w = v + 0.5 * z; b[k] = w; v = z - 0.5 * w;
      api[a] = k + 1 === b.length ? 0 : k + 1;
    }
    out[i] = x * (1 - wet) + v * wet * 0.9;
  }
  return out;
}

// ---- render ----------------------------------------------------------------------------------------------------------
function createBus(N) { return { L: new Float32Array(N), R: new Float32Array(N) }; }
function put(bus, t, s, g, pan = 0) {
  const i0 = Math.round(t * SR); const N = bus.L.length;
  const gl = g * (1 - Math.max(pan, 0)); const gr = g * (1 + Math.min(pan, 0));
  const n = Math.min(s.length, N - i0);
  for (let k = 0; k < n; k++) { bus.L[i0 + k] += s[k] * gl; bus.R[i0 + k] += s[k] * gr; }
}

function renderPad(bus, chord, t0, barLen, N) {
  const att = Math.min(0.9, barLen * 0.4); const rel = Math.min(0.9, barLen * 0.3);
  const i0 = Math.round(t0 * SR); const i1 = Math.min(N, Math.round((t0 + barLen + rel) * SR));
  const det = 2 ** (4 / 1200);
  const voices = chord.tones.map((m) => [hz(m + 12), 0.16 / chord.tones.length * 4]);
  for (let i = i0; i < i1; i++) {
    const t = i / SR - t0;
    const a = t < att ? Math.sin(t / att * Math.PI / 2) ** 2 : 1;
    const r = t > barLen ? Math.max(0, 1 - (t - barLen) / rel) ** 2 : 1;
    const env = a * r; let l = 0; let rr = 0;
    for (const [f, g] of voices) {
      const pl = TAU * f / det * (i / SR); const pr = TAU * f * det * (i / SR);
      l += g * (Math.sin(pl) + 0.2 * Math.sin(2 * pl)); rr += g * (Math.sin(pr) + 0.2 * Math.sin(2 * pr));
    }
    bus.L[i] += l * env * 1.4; bus.R[i] += rr * env * 1.4;
  }
}

function limit(x) { const a = Math.abs(x); return a <= 0.6 ? x : Math.sign(x) * (0.6 + 0.2 * Math.tanh((a - 0.6) / 0.2)); }

// The original arrangement, kept as it was so `style: "classic"` reproduces earlier output byte for byte.
function renderClassic(cfg, plan, bed, N) {
  const { palette, energy, duration, beat, beats_per_bar: bpb } = cfg;
  const rng = prng(cfg.seed ^ 0x5bd1e995);
  const { chords, barLen, endTime } = plan;
  const mid = energy >= 0.2; const high = energy > 0.6;
  const bright = high;
  const live = (t) => endTime === null || t < endTime - 1e-6; // drums and arpeggios stop at the end cue
  const penta = (cfg.mode === 'minor' ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9]).map((x) => (plan.tonic + x) % 12);

  for (const ch of chords) {
    const t0 = ch.bar * barLen;
    renderPad(bed, ch, t0, barLen, N);
    const tones = ch.tones.map((m) => m + 12);
    const eighths = bpb * 2;
    if (!mid) { // sparse plucks only
      for (let k = 0; k < bpb; k++) {
        if (rng() > (k === 0 ? 0.7 : k === Math.floor(bpb / 2) ? 0.3 : 0)) continue;
        const m = tones[Math.floor(rng() * tones.length)] + 12; const pan = 0.3 + rng() * 0.4;
        put(bed, t0 + k * beat, noteVoice(palette, m, 1.1, rng, false), 0.13, pan - 0.5);
      }
      continue;
    }
    // bass on 1 (and 3)
    const bassM = fold(ch.root_pc + 36, 36, 47);
    if (live(t0)) put(bed, t0, bassVoice(bassM, 2 * beat), 0.3);
    if (bpb >= 4 && live(t0 + 2 * beat)) put(bed, t0 + 2 * beat, bassVoice(bassM + (ch.bar % 2 === 0 ? 7 : 0), 2 * beat), 0.2);
    // arpeggio / plucks
    const pat = [0, 2, 1, 3, 2, 1, 3, 2];
    for (let e = 0; e < eighths; e++) {
      const t = t0 + e * beat / 2;
      if (!live(t) || t >= duration) continue;
      const strong = e % 2 === 0;
      if (!high && !strong && rng() > 0.45) continue;
      if (ch.bar === 0 && e % 8 === 1 && !high) continue;
      const m = tones[pat[e % 8] % tones.length] + 12;
      put(bed, t, noteVoice(palette, m, 1.1, rng, bright), (strong ? 0.16 : 0.11) * (high ? 1.15 : 1), ((e % 4) - 1.5) * 0.12);
    }
    // sparse pentatonic melody
    if (ch.bar >= 1) {
      for (let k = 0; k < 2; k++) {
        if (rng() > 0.55) continue;
        const t = t0 + (k === 0 ? Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2)) * beat;
        if (!live(t) || t >= duration) continue;
        const m = fold(60 + penta[Math.floor(rng() * penta.length)], 74, 88);
        put(bed, t, noteVoice(palette, m, 1.6, rng, bright), 0.12, 0.25);
      }
    }
    // felt kick and brushes
    if (ch.bar >= 1) {
      for (let k = 0; k < bpb; k++) {
        const t = t0 + k * beat;
        if (!live(t)) continue;
        if (high ? true : k % 2 === 0) put(bed, t, feltVoice(), high && k % 2 ? 0.2 : 0.3);
      }
      for (let e = 0; e < eighths; e++) {
        const t = t0 + e * beat / 2;
        if (e % 2 === 1 || (high && e % 2 === 0 && e % 4 === 2)) { if (live(t) && t < duration) put(bed, t, brushVoice(rng), e % 2 ? 0.045 : 0.03, 0.35); }
      }
    }
  }
}

// Renders the score to float stereo (length exactly round(duration * SR)), un-normalised.
export function renderScore(cfg) {
  const plan = planScore(cfg);
  const { duration, beat, beats_per_bar: bpb } = cfg;
  const N = Math.round(duration * SR);
  const bed = createBus(N); const cue = createBus(N);
  const kit = { SR, hz, fold, put, renderPad, noteVoice, bassVoice, feltVoice, brushVoice, bellVoice, mutedVoice };
  let motif = null;
  if (cfg.style === 'classic') renderClassic(cfg, plan, bed, N);
  else { motif = buildMotif(cfg.seed, cfg.mode, bpb); renderStyle({ cfg, plan, bed, N, motif, kit }); }
  plan.motif = motif;

  // cues: pitched to the chord that is sounding, on the beat grid
  const bedPeak = Math.max(peakOf(bed.L), peakOf(bed.R), 1e-6);
  const base = bedPeak * 10 ** (4 / 20); // cues sit about 4 dB above the bed
  const barAt = (b) => plan.chordAt(b * beat);
  let tickRun = 0; let prevTick = -99; let ci = 0;
  for (const c of cfg.cues) {
    const t = c.beat * beat; const ch = barAt(c.beat); ci++;
    const tones = [...ch.tones].sort((a, b) => a - b);
    const tone = (k, lo, hi) => fold(tones[((k % tones.length) + tones.length) % tones.length], lo, hi);
    switch (c.kind) {
      case 'cut': put(cue, t, bellVoice(tone(ci * 2 + 1, 74, 88), 2.0), base * 0.55, 0.05); break;
      case 'highlight': put(cue, t, tickVoice(tone(ci, 80, 92)), base * 0.5, -0.2); break;
      case 'impact': put(cue, t, feltVoice(), base * 0.45); put(cue, t, bellVoice(fold(ch.root, 55, 67), 2.6), base * 0.5); break;
      case 'confirm': {
        const a = tone(0, 74, 84); put(cue, t, bellVoice(a, 1.0), base * 0.5, -0.1);
        const b = tones.map((m) => fold(m, 74, 96)).filter((m) => m > a).sort((x, y) => x - y)[1] ?? a + 7;
        if ((c.beat + 0.5) * beat < duration) put(cue, (c.beat + 0.5) * beat, bellVoice(b, 1.4), base * 0.55, 0.1);
        break;
      }
      case 'type': {
        const n = Math.round(c.beats * 4);
        for (let k = 0; k < n; k++) {
          const tt = (c.beat + k / 4) * beat; if (tt >= duration) break;
          put(cue, tt, mutedVoice(fold(tones[(k * 2 + 1) % tones.length], 72, 84)), base * 0.22 * (k % 4 === 0 ? 1 : 0.8), 0.15);
        }
        break;
      }
      case 'tick': {
        tickRun = c.beat - prevTick <= 2 ? tickRun + 1 : 0; prevTick = c.beat;
        const lo = fold(tones[0], 78, 89); const seq = tones.map((m) => fold(m, lo, lo + 11)).sort((x, y) => x - y);
        const m = seq[tickRun % seq.length] + 12 * Math.floor(tickRun / seq.length % 2);
        put(cue, t, tickVoice(Math.min(m, 100)), base * 0.5, -0.2 + 0.1 * Math.min(tickRun, 4));
        break;
      }
      case 'end': put(cue, t, bellVoice(fold(plan.tonic + 60, 67, 78), Math.min(4.5, duration - t + 0.5)), base * 0.6); break;
    }
  }

  // one shared reverb for music and cues
  const L = new Float32Array(N); const R = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = bed.L[i] + cue.L[i]; R[i] = bed.R[i] + cue.R[i]; }
  const room = cfg.style === 'classic' ? { fb: 0.6, wet: 0.3, lp: null } : STYLES[cfg.style].room;
  const wl = reverb(L, [0.0297, 0.0371, 0.0411, 0.0437], room.fb, room.wet);
  const wr = reverb(R, [0.0313, 0.0353, 0.0427, 0.0451], room.fb, room.wet);
  if (room.lp) { // dull the whole mix (cues included): two one-pole low-pass stages
    const a = 1 - Math.exp(-TAU * room.lp / SR);
    for (const w of [wl, wr]) { let y1 = 0; let y2 = 0; for (let i = 0; i < N; i++) { y1 += a * (w[i] - y1); y2 += a * (y1 - y2); w[i] = y2; } }
  }
  // fades: 30 ms in, 1.2 s out
  const fi = Math.round(0.03 * SR); const fo = Math.min(Math.round(1.2 * SR), Math.floor(N / 2));
  for (let i = 0; i < fi && i < N; i++) { const g = i / fi; wl[i] *= g; wr[i] *= g; }
  for (let i = 0; i < fo; i++) { const g = (i / fo) ** 1.5; wl[N - 1 - i] *= g; wr[N - 1 - i] *= g; }
  return { L: wl, R: wr, plan };
}

export function wavBuffer(L, R, gain) {
  const N = L.length;
  const buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  const q = (x) => Math.max(-32768, Math.min(32767, Math.round(limit(x * gain) * 32767)));
  for (let i = 0; i < N; i++) { buf.writeInt16LE(q(L[i]), 44 + i * 4); buf.writeInt16LE(q(R[i]), 46 + i * 4); }
  return buf;
}

// Normalises to TARGET_LUFS with one gain (measured with ffmpeg ebur128, corrected once more if the soft clip moved it) and writes the WAV.
export async function writeScoreWav(file, cfg) {
  const { L, R, plan } = renderScore(cfg);
  const peak = Math.max(peakOf(L), peakOf(R), 1e-9);
  let gain = 0.3 / peak;
  const tmpDir = mkdtempSync(join(tmpdir(), 'cve-score-'));
  try {
    const probe = join(tmpDir, 'probe.wav');
    for (let pass = 0; pass < 2; pass++) {
      writeFileSync(probe, wavBuffer(L, R, gain));
      const lufs = await measureLufs(probe);
      if (lufs === null || !Number.isFinite(lufs)) break;
      const err = TARGET_LUFS - lufs;
      if (Math.abs(err) < 0.3) break;
      gain *= 10 ** (err / 20);
    }
  } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  writeFileSync(file, wavBuffer(L, R, gain));
  return plan;
}

// style|palette|progression|bpm|key|mode: what the ledger and the verify `variety` check compare between videos.
export function fingerprintOf(cfg, plan) { return [cfg.style, cfg.palette, plan.prog.join('-'), cfg.bpm, cfg.key, cfg.mode].join('|'); }

export function scoreJson(cfg, plan) {
  return {
    duration: cfg.duration, bpm: cfg.bpm, beat_seconds: Math.round(cfg.beat * 1e6) / 1e6, beats_per_bar: cfg.beats_per_bar,
    bar_seconds: Math.round(plan.barLen * 1e6) / 1e6, key: cfg.key, mode: cfg.mode, palette: cfg.palette, energy: cfg.energy, seed: cfg.seed,
    style: cfg.style, chords_per_bar: cfg.cpb, progression: plan.prog, motif: plan.motif, fingerprint: fingerprintOf(cfg, plan),
    music: { style: cfg.style, palette: cfg.palette, progression: plan.prog.join('-'), bpm: cfg.bpm, key: cfg.key, mode: cfg.mode, fingerprint: fingerprintOf(cfg, plan) },
    bars: plan.chords.map((c) => c.name), cues: plan.resolved,
  };
}
