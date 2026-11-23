// Arrangement styles: what is played and when (rhythm, texture, form), as opposed to the palette, which is only the timbre of the notes.
// score.mjs passes the voices in through `kit`, so this file has no import cycle with it.
const SR = 44100;
const TAU = 2 * Math.PI;
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const prng = (seed) => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// cpb = chords per bar options (a style picks one by seed); room = shared reverb feedback / wet mix and an optional low-pass on the whole mix.
export const STYLES = {
  classic: { cpb: [1], room: { fb: 0.6, wet: 0.3, lp: null }, about: 'pad + eighth-note arpeggio + sparse random pentatonic melody + felt kick and brushes (the original arrangement)' },
  'acoustic-strum': { cpb: [1], room: { fb: 0.55, wet: 0.22, lp: null }, about: 'strummed chords on a syncopated down/up pattern, no arpeggio, no drums, motif melody' },
  lofi: { cpb: [1, 2], room: { fb: 0.45, wet: 0.14, lp: 3000 }, about: 'swung 16ths, dusty kick/snare/hat, short chord stabs, vinyl crackle, whole mix low-passed' },
  ambient: { cpb: [1], room: { fb: 0.9, wet: 0.5, lp: null }, about: 'slow swelling pads and a drone, no drums, sparse bell motifs, long reverb' },
  'pop-pluck': { cpb: [1, 2], room: { fb: 0.55, wet: 0.2, lp: null }, about: 'light four-on-the-floor, 3-3-2 pluck ostinato, off-beat hat, rim on 2 and 4' },
  'piano-ballad': { cpb: [1], room: { fb: 0.68, wet: 0.3, lp: null }, about: 'left-hand broken chords, right-hand motif melody that sings, no drums' },
  'minimal-pulse': { cpb: [1, 2], room: { fb: 0.5, wet: 0.18, lp: null }, about: 'steady 8th-note ostinato that adds and removes notes bar by bar, a second voice phasing against it, no drums' },
  'warm-groove': { cpb: [1, 2], room: { fb: 0.5, wet: 0.16, lp: null }, about: 'walking and syncopated bass line, rim click backbeat, shaker, off-beat chord stabs' },
};
export const STYLE_IDS = Object.keys(STYLES);

// Style when cues.json has none: mood words first, otherwise by energy; always a seeded pick so a brand's videos are not all the same style.
const hasWord = (words, list) => words.some((w) => list.some((x) => w.startsWith(x)));
export function deriveStyle(words, energy, r) {
  const rules = [
    [['lofi', 'lo-fi', 'study', 'chill', 'beat'], ['lofi']],
    [['ambient', 'dream', 'meditat', 'spa', 'sleep', 'ethereal', 'atmospher'], ['ambient']],
    [['playful', 'fun', 'quirky', 'cheerful', 'whimsic', 'happy'], ['pop-pluck', 'warm-groove']],
    [['energ', 'upbeat', 'fast', 'driv', 'dynamic', 'lively', 'bright'], ['pop-pluck', 'warm-groove']],
    [['tech', 'focus', 'minimal', 'clean', 'precis', 'data', 'modern', 'product'], ['minimal-pulse', 'pop-pluck']],
    [['sad', 'serious', 'dark', 'melanchol', 'dramatic', 'emotion', 'romantic', 'tender', 'somber'], ['piano-ballad', 'ambient']],
    [['warm', 'cafe', 'coffee', 'cozy', 'cosy', 'folk', 'organic', 'natural', 'handmade', 'artisan', 'friendly'], ['acoustic-strum', 'warm-groove', 'lofi']],
  ];
  for (const [list, styles] of rules) if (hasWord(words, list)) return styles[Math.floor(r() * styles.length)];
  const pool = energy < 0.2 ? ['ambient', 'piano-ballad'] : energy > 0.6 ? ['pop-pluck', 'warm-groove'] : ['acoustic-strum', 'lofi', 'warm-groove', 'minimal-pulse', 'piano-ballad'];
  return pool[Math.floor(r() * pool.length)];
}

// ---- motif -----------------------------------------------------------------------------------------------------
const SCALE = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] };
const degMidi = (mode, tonicPc, d, oct = 0) => 60 + tonicPc + SCALE[mode][((d % 5) + 5) % 5] + 12 * Math.floor(d / 5) + oct;

// 3-5 scale degrees (pentatonic, 0..7) with onsets and lengths in beats inside one bar; fully determined by the seed.
export function buildMotif(seed, mode, bpb) {
  const r = prng((seed ^ hash('motif')) | 0);
  const n = 3 + Math.floor(r() * 3);
  const degrees = [Math.floor(r() * 3)];
  const steps = [-2, -1, -1, 1, 1, 2, 3];
  for (let i = 1; i < n; i++) degrees.push(Math.max(0, Math.min(7, degrees[i - 1] + steps[Math.floor(r() * steps.length)])));
  const lens = [0.5, 1, 1, 1, 1.5, 2];
  let durs = degrees.map(() => lens[Math.floor(r() * lens.length)]);
  const start = r() < 0.3 ? 0.5 : 0;
  for (let guard = 0; guard < 4 && start + durs.reduce((x, y) => x + y, 0) > bpb - 0.5; guard++) durs = durs.map((d) => Math.max(0.5, d / 2));
  while (durs.length > 3 && start + durs.reduce((x, y) => x + y, 0) > bpb - 0.5) { degrees.pop(); durs.pop(); }
  const onsets = []; let t = start;
  for (const d of durs) { onsets.push(t); t += d; }
  return { scale: mode === 'minor' ? 'minor-pentatonic' : 'major-pentatonic', degrees, onsets, durs };
}

// Melody events from the motif: bar 1 of every four states it (first note moved to a chord tone), bar 2 displaces it by half a beat,
// bar 3 varies it (inversion, sequence up, or a step down), bar 4 is a fragment that lands on a chord tone; the end of bar 8 holds the chord root.
export function melodyEvents(c, o) {
  const { cfg, plan, motif } = c;
  const { mode } = cfg; const bpb = cfg.beats_per_bar; const beat = cfg.beat;
  const mr = prng((cfg.seed ^ hash(`melody|${cfg.style}`)) | 0);
  const out = [];
  const pcsOf = (ch) => ch.tones.map((x) => x % 12);
  const inRange = (m) => { while (m > o.hi) m -= 12; while (m < o.lo) m += 12; return m; };
  const centre = degMidi(mode, plan.tonic, Math.round(motif.degrees.reduce((a, b) => a + b, 0) / motif.degrees.length));
  const oct = Math.round(((o.lo + o.hi) / 2 - centre) / 12) * 12;
  const midi = (d) => degMidi(mode, plan.tonic, d, oct);
  const fit = (degs, ch) => { const pcs = pcsOf(ch); for (const sh of [0, 1, -1, 2, -2, 3, -3, 4, -4]) if (pcs.includes(midi(degs[0] + sh) % 12)) return sh; return 0; };
  const nearestTone = (m, ch) => { let best = null; for (const t of ch.tones) for (const k of [-24, -12, 0, 12, 24]) { const x = t + k; if (x >= o.lo && x <= o.hi && (best === null || Math.abs(x - m) < Math.abs(best - m))) best = x; } return best ?? m; };
  for (let b = o.from; b < plan.bars; b++) {
    const p = b % 4; const phrase = Math.floor(b / 4);
    const pv = prng((cfg.seed ^ hash(`pv|${phrase}`)) | 0);
    const variant = ['invert', 'up', 'down'][Math.floor(pv() * 3)];
    const roll = mr();
    const last = b === plan.bars - 1;
    if (!last && !(roll < (p === 3 ? Math.min(1, o.density + 0.3) : p === 0 ? Math.min(1, o.density + 0.15) : o.density))) continue;
    const barT = b * plan.barLen; const ch0 = plan.chordAt(barT + 1e-6);
    let degs = motif.degrees; let ons = motif.onsets; let durs = motif.durs;
    if (p === 1) ons = ons.map((x) => x + 0.5);
    else if (p === 2) degs = variant === 'invert' ? degs.map((d) => degs[0] - (d - degs[0])) : degs.map((d) => d + (variant === 'up' ? 2 : -1));
    else if (p === 3) { const k = Math.max(2, degs.length - 2); degs = degs.slice(0, k); ons = ons.slice(0, k); durs = durs.slice(0, k); }
    const sh = fit(degs, ch0);
    const events = [];
    degs.forEach((d, i) => { if (ons[i] <= bpb - 0.25) events.push({ on: ons[i], m: inRange(midi(d + sh)), dur: Math.min(durs[i], bpb - ons[i]) }); });
    if (p === 3 || last) { // phrase end: the last note is a chord tone of the chord sounding there, held
      const on = Math.max(events.length ? events.at(-1).on + 0.5 : 0, bpb - 2);
      const ch = plan.chordAt(barT + on * beat);
      const prev = events.length ? events.at(-1).m : (o.lo + o.hi) / 2;
      let m = nearestTone(prev, ch);
      if (b % 8 === 7 || last) { const rootNear = [-24, -12, 0, 12, 24].map((k) => ch.root + k).filter((x) => x >= o.lo && x <= o.hi).sort((x, y) => Math.abs(x - prev) - Math.abs(y - prev))[0]; if (rootNear !== undefined) m = rootNear; }
      if (events.length && events.at(-1).on >= on) events.pop();
      events.push({ on, m, dur: bpb - on, end: true });
    }
    for (const e of events) { const t = barT + e.on * beat; if (t < cfg.duration - 0.05) out.push({ t, m: e.m, dur: e.dur, end: !!e.end }); }
  }
  return out;
}

// ---- percussion and extra voices --------------------------------------------------------------------------------
function drumKit() {
  const r = prng(0xd1a5);
  const mk = (sec, f) => { const n = Math.floor(sec * SR); const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = f(i / SR, i); return o; };
  const noise = () => r() * 2 - 1;
  let hp = 0; let lp = 0;
  const hat = () => { hp = 0; return mk(0.06, (t, i) => { const x = noise(); const y = x - hp; hp = x; return y * Math.exp(-t * 75) * Math.min(1, i / 40); }); };
  const hatOpen = () => { hp = 0; return mk(0.16, (t, i) => { const x = noise(); const y = x - hp; hp = x; return y * Math.exp(-t * 22) * Math.min(1, i / 40); }); };
  const snare = (dusty) => { lp = 0; return mk(0.2, (t, i) => { const x = noise(); lp += (dusty ? 0.3 : 0.6) * (x - lp); return (lp * 0.9 + Math.sin(TAU * 188 * t) * 0.45) * Math.exp(-t * (dusty ? 24 : 20)) * Math.min(1, i / 60); }); };
  const rim = () => mk(0.045, (t, i) => (Math.sin(TAU * 1750 * t) * 0.7 + Math.sin(TAU * 2680 * t) * 0.4 + noise() * 0.25) * Math.exp(-t * 150) * Math.min(1, i / 20));
  const kickDusty = () => mk(0.24, (t, i) => { const ph = TAU * (46 * t + 60 * (1 - Math.exp(-t * 40)) / 40); return (Math.sin(ph) * Math.exp(-t * 15) + noise() * 0.05 * Math.exp(-t * 300)) * Math.min(1, i / 30); });
  const kickPop = () => mk(0.2, (t, i) => { const ph = TAU * (50 * t + 95 * (1 - Math.exp(-t * 45)) / 45); return Math.sin(ph) * Math.exp(-t * 17) * Math.min(1, i / 25); });
  const crackle = () => mk(0.012, (t) => noise() * Math.exp(-t * 500));
  const shaker = () => { lp = 0; return mk(0.07, (t, i) => { const x = noise(); const y = x - lp; lp = x; return y * Math.exp(-t * 55) * Math.min(1, i / 700); }); };
  return { hat: [hat(), hat(), hat()], hatOpen: hatOpen(), snare: snare(true), snareHard: snare(false), rim: rim(), kickDusty: kickDusty(), kickPop: kickPop(), crackle: [crackle(), crackle()], shaker: [shaker(), shaker()] };
}

function droneVoice(m, dur, hz) {
  const f = hz(m); const n = Math.floor(dur * SR); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; out[i] = (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t + 0.4)) * Math.min(1, t / 1.2) ** 2 * Math.min(1, (dur - t) / 1.5); }
  return out;
}

// ---- the renderers ---------------------------------------------------------------------------------------------
function setup(c) {
  const { cfg, plan, kit } = c;
  const beat = cfg.beat; const bpb = cfg.beats_per_bar; const barLen = plan.barLen;
  const rng = prng((cfg.seed ^ hash(`arrange|${cfg.style}`)) | 0);
  const live = (t) => plan.endTime === null || t < plan.endTime - 1e-6; // everything but the pad stops at the end cue
  const energy = cfg.energy; const high = energy > 0.6; const low = energy < 0.2;
  const grid = bpb * 4; const step = beat / 4; // 16th-note grid of a bar
  const note = (t, m, dur, g, pan = 0, bright = false) => { if (t < cfg.duration - 0.02 && live(t)) kit.put(c.bed, t, kit.noteVoice(cfg.palette, m, dur, rng, bright), g, pan); };
  const hit = (t, buf, g, pan = 0) => { if (t < cfg.duration - 0.02 && live(t)) kit.put(c.bed, t, buf, g, pan); };
  const bass = (t, m, beats, g) => { if (t < cfg.duration - 0.02 && live(t)) kit.put(c.bed, t, kit.bassVoice(m, beats * beat), g); };
  const endBar = plan.endBar ?? plan.bars;
  return { ...c, beat, bpb, barLen, rng, live, energy, high, low, grid, step, note, hit, bass, endBar, drums: drumKit(), felt: kit.feltVoice(), tones: (ch) => ch.tones, pad: (ch, o) => kit.renderPad(c.bed, ch, ch.t0, ch.len, c.N, o) };
}
const lowRoot = (kit, ch, lo = 36, hi = 47) => kit.fold(ch.root_pc + 36, lo, hi);
const playMelody = (s, o, voice) => { for (const e of melodyEvents(s, o)) if (s.live(e.t)) voice(e); };

function acousticStrum(c) {
  const s = setup(c); const { kit } = s;
  const STRUM = [[0, 'D', 1], [4, 'D', 0.6], [6, 'U', 0.7], [10, 'U', 0.62], [12, 'D', 0.82], [14, 'U', 0.55]];
  for (const ch of c.plan.slots) {
    s.pad(ch, { gain: 0.5 });
    const t0 = ch.t0; const intro = ch.bar === 0; const fill = ch.bar === s.endBar - 1 && ch.bar > 1;
    if (!intro) { s.bass(t0, lowRoot(kit, ch), 2, 0.2); if (s.bpb >= 4) s.bass(t0 + 2 * s.beat, lowRoot(kit, ch) + (ch.bar % 2 ? 7 : 0), 2, 0.15); }
    const steps = intro ? STRUM.filter(([k]) => k === 0 || k === 6) : fill ? [...STRUM, [15, 'D', 0.7]] : STRUM;
    for (const [k, dir, acc] of steps) {
      if (k >= s.grid) continue;
      const order = dir === 'D' ? ch.tones : [...ch.tones].reverse();
      order.forEach((m, j) => s.note(t0 + k * s.step + j * 0.011, m, 1.0, (dir === 'D' ? 0.15 : 0.1) * acc * (s.high ? 1.1 : 1), (j - 1.5) * 0.18));
    }
  }
  playMelody(s, { from: 1, lo: 74, hi: 88, density: 0.55 }, (e) => s.note(e.t, e.m, Math.max(0.7, e.dur * s.beat * 1.4), 0.14, 0.25));
}

function lofi(c) {
  const s = setup(c); const { kit, plan } = s; const D = s.drums;
  const sw = (k) => (k % 2 ? 0.3 * s.step : 0); // odd 16ths land late: swing
  const hr = prng((c.cfg.seed ^ hash('lofi-ghost')) | 0);
  for (const ch of plan.slots) {
    s.pad(ch, { gain: 0.42 });
    const t0 = ch.t0; const half = c.plan.cpb === 2; const base = ch.slot * (s.grid / plan.cpb);
    const intro = ch.bar === 0;
    // short chord stabs on 16ths 0, 6, 10 of the bar (or of the half bar)
    const span = s.grid / plan.cpb;
    for (const k of (intro ? [0] : half ? [0, 6] : [0, 6, 10])) { if (k >= span) continue; const t = t0 + k * s.step + sw(base + k); ch.tones.slice(1).forEach((m, j) => s.note(t + j * 0.006, m + 12, 0.5, k === 0 ? 0.1 : 0.085, (j - 1) * 0.2)); }
    if (intro) continue;
    const rootM = lowRoot(kit, ch, 33, 44);
    s.bass(t0, rootM, 1.4, 0.3);
    if (!half || ch.slot === 1) s.bass(t0 + 7 * s.step + sw(7), rootM + (ch.bar % 2 ? 7 : 0), 0.9, 0.2);
    if (!half) s.bass(t0 + 10 * s.step, rootM, 1, 0.22);
    if (s.low) continue;
    for (let k = 0; k < span; k++) {
      const t = t0 + k * s.step + sw(base + k); const gk = base + k;
      if ([0, 7, 10].includes(gk % 16)) s.hit(t, D.kickDusty, gk % 16 === 0 ? 0.34 : 0.24);
      if ([4, 12].includes(gk % 16)) s.hit(t, D.snare, 0.2, 0.1);
      else if (gk % 16 === 15 && hr() < 0.4) s.hit(t, D.snare, 0.06, 0.1);
      if (k % 2 === 0) s.hit(t, D.hat[(gk >> 1) % 3], gk % 8 === 4 ? 0.05 : 0.036, 0.35);
      else if (hr() < (s.high ? 0.55 : 0.3)) s.hit(t, D.hat[gk % 3], 0.018, 0.35);
    }
  }
  const cr = prng((c.cfg.seed ^ hash('crackle')) | 0); // vinyl crackle, a few clicks per bar
  for (let b = 0; b < plan.bars; b++) for (let k = 0; k < 7; k++) { const t = b * s.barLen + cr() * s.barLen; s.hit(t, D.crackle[k % 2], 0.02 + 0.03 * cr(), cr() - 0.5); }
  playMelody(s, { from: 2, lo: 67, hi: 81, density: 0.35 }, (e) => s.note(e.t, e.m, Math.max(0.6, e.dur * s.beat * 1.2), 0.12, -0.2));
}

function ambient(c) {
  const s = setup(c); const { kit, plan } = s;
  const mr = prng((c.cfg.seed ^ hash('ambient-shimmer')) | 0);
  for (const ch of plan.slots) {
    s.pad(ch, { gain: 1.7, att: Math.min(2.2, ch.len * 0.6), rel: Math.min(2.5, ch.len * 0.9) });
    const t0 = ch.t0;
    if (t0 < c.cfg.duration - 0.5) kit.put(c.bed, t0, droneVoice(lowRoot(kit, ch, 36, 47), Math.min(ch.len + 2.5, c.cfg.duration - t0), kit.hz), 0.13);
    if (ch.bar > 0 && mr() < 0.5) { const m = ch.tones[Math.floor(mr() * ch.tones.length)] + 24; const t = t0 + mr() * s.barLen * 0.5; if (s.live(t) && t < c.cfg.duration - 0.5) kit.put(c.bed, t, kit.bellVoice(m, 3.2), 0.05, mr() - 0.5); }
  }
  playMelody(s, { from: 1, lo: 72, hi: 91, density: 0.5 }, (e) => { if (e.t < c.cfg.duration - 0.5) kit.put(c.bed, e.t, kit.bellVoice(e.m, 3.4), 0.1, ((e.t * 7) % 1) - 0.5); });
}

function popPluck(c) {
  const s = setup(c); const { kit, plan } = s; const D = s.drums;
  const OST = [[0, 0, 12], [6, 2, 12], [12, 1, 24]]; // 3-3-2: hits on 16ths 0, 6, 12
  for (const ch of plan.slots) {
    s.pad(ch, { gain: 0.4 });
    const t0 = ch.t0; const span = s.grid / plan.cpb; const base = ch.slot * span;
    const intro = ch.bar === 0; const fill = ch.bar === s.endBar - 1 && ch.bar > 1;
    for (const [k, idx, up] of OST) { if (k >= span) continue; s.note(t0 + k * s.step, ch.tones[idx] + up, 0.9, 0.17, (idx - 1) * 0.25, true); }
    if (ch.bar % 2 === 1 && span > 14) s.note(t0 + 14 * s.step, ch.tones[0] + 24, 0.7, 0.1, 0.3, true);
    s.bass(t0, lowRoot(kit, ch), 1.2, 0.26);
    if (span > 6) s.bass(t0 + 6 * s.step, lowRoot(kit, ch), 0.8, 0.2);
    if (span > 12) s.bass(t0 + 12 * s.step, lowRoot(kit, ch) + 7, 0.8, 0.18);
    if (intro || s.low) continue;
    for (let k = 0; k < span; k += 1) {
      const gk = base + k; const t = t0 + k * s.step;
      if (gk % 4 === 0) s.hit(t, D.kickPop, 0.26);
      if (gk % 4 === 2) s.hit(t, D.hat[(gk >> 2) % 3], 0.06, 0.3);
      if (ch.bar >= 2 && (gk === 4 || gk === 12)) s.hit(t, D.rim, 0.07, -0.2);
      if (fill && gk % 2 === 1 && gk >= 8) s.hit(t, D.hat[gk % 3], 0.035, 0.3);
    }
  }
  playMelody(s, { from: 2, lo: 74, hi: 90, density: 0.7 }, (e) => s.note(e.t, e.m, Math.max(0.6, e.dur * s.beat * 1.2), 0.14, 0.3, true));
}

function pianoBallad(c) {
  const s = setup(c); const { kit, plan } = s;
  const LH = [0, 7, 12, 16, 19, 16, 12, 7]; // interval stack above the root: root, 5th, octave, 10th ...
  for (const ch of plan.slots) {
    s.pad(ch, { gain: 0.32, att: Math.min(1.2, ch.len * 0.5) });
    const t0 = ch.t0; const rootM = lowRoot(kit, ch, 40, 51); const third = ch.tones[1] - ch.root;
    for (let e = 0; e < s.bpb * 2; e++) {
      const iv = LH[e % 8]; const m = rootM + (iv === 16 ? 12 + third : iv);
      s.note(t0 + e * s.beat / 2, m, 1.5, e % 4 === 0 ? 0.2 : 0.13, -0.25);
    }
  }
  playMelody(s, { from: 1, lo: 64, hi: 82, density: 0.9 }, (e) => s.note(e.t, e.m, Math.max(1, e.dur * s.beat * 1.8), e.end ? 0.18 : 0.16, 0.2));
}

function minimalPulse(c) {
  const s = setup(c); const { kit, plan } = s;
  const CELL = [0, 1, 2, 1, 3, 2]; const RANK = [0, 4, 2, 6, 1, 5, 3, 7]; // pitch cell of 6 against a bar of 8; add/remove order of the 8th positions
  const tri = (b) => { const m = b % 10; return m <= 5 ? m : 10 - m; };
  const per = s.bpb * 2;
  for (const ch of plan.slots) {
    s.pad(ch, { gain: 0.45 });
    const t0 = ch.t0; const b = ch.bar; const n8 = per / plan.cpb; const e0 = ch.slot * n8;
    if (ch.slot === 0) s.bass(t0, lowRoot(kit, ch), s.bpb, 0.22);
    const nActive = Math.min(per, 2 + tri(b) + (b >= 2 ? 1 : 0));
    for (let e = e0; e < e0 + n8; e++) {
      if ((RANK[e % 8] % per) >= nActive) continue;
      const m = ch.tones[CELL[(b * per + e) % CELL.length]] + 12;
      const strong = RANK[e % 8] < 2;
      s.note(t0 + (e - e0) * s.beat / 2, m, 0.9, strong ? 0.17 : 0.125, ((e % 4) - 1.5) * 0.15);
      if (b >= 2 && (b * per + e) % 5 < 2) s.note(t0 + (e - e0) * s.beat / 2 + 0.003, ch.tones[(b * per + e) % ch.tones.length] + 24, 0.6, 0.075, 0.45);
    }
  }
  playMelody(s, { from: 4, lo: 76, hi: 90, density: 0.25 }, (e) => s.note(e.t, e.m, Math.max(0.6, e.dur * s.beat), 0.12, -0.3));
}

function warmGroove(c) {
  const s = setup(c); const { kit, plan } = s; const D = s.drums;
  const gr = prng((c.cfg.seed ^ hash('groove')) | 0);
  const nearRoot = (m, target) => { let best = target; for (const k of [-12, 0, 12]) if (Math.abs(target + k - m) < Math.abs(best - m)) best = target + k; return best; };
  for (let i = 0; i < plan.slots.length; i++) {
    const ch = plan.slots[i]; const next = plan.slots[i + 1] ?? ch;
    s.pad(ch, { gain: 0.42 });
    const t0 = ch.t0; const span = s.grid / plan.cpb; const intro = ch.bar === 0; const fill = ch.bar === s.endBar - 1 && ch.bar > 1;
    const r = lowRoot(kit, ch, 36, 47); const approach = nearRoot(r, lowRoot(kit, next, 36, 47)) + (gr() < 0.5 ? -1 : 1);
    const third = ch.tones[1] - ch.root; const fifth = ch.tones[2] - ch.root;
    if (!intro) {
      const walking = ch.bar % 2 === 1 || plan.cpb === 2;
      const line = walking ? [[0, r], [4, r + third], [8, r + fifth], [12, approach]] : [[0, r], [3, r], [6, r + fifth], [8, r], [11, r + 12], [14, approach]];
      for (const [k, m] of line) if (k < span) s.bass(t0 + k * s.step, kit.fold(m, 33, 50), walking ? 0.9 : 0.55, 0.27);
      for (let k = 0; k < span; k++) {
        const gk = ch.slot * span + k; const t = t0 + k * s.step;
        if (!s.low && (gk === 0 || gk === 10)) s.hit(t, s.felt, 0.22);
        if (gk === 4 || gk === 12) s.hit(t, D.rim, 0.085, -0.15);
        else if (gk === 15 && gr() < 0.35) s.hit(t, D.rim, 0.03, -0.15);
        if (!s.low && gk % 4 === 2) s.hit(t, D.shaker[(gk >> 2) % 2], s.high ? 0.06 : 0.045, 0.35);
        if (fill && gk >= 12 && gk % 2 === 1) s.hit(t, D.snareHard, 0.05, 0.1);
      }
      for (const k of (plan.cpb === 2 ? [6] : [6, 14])) if (k < span) ch.tones.slice(1).forEach((m, j) => s.note(t0 + k * s.step + j * 0.007, m + 12, 0.45, 0.095, (j - 1) * 0.2));
    }
  }
  playMelody(s, { from: 2, lo: 70, hi: 84, density: 0.5 }, (e) => s.note(e.t, e.m, Math.max(0.6, e.dur * s.beat * 1.3), 0.13, 0.25));
}

const RENDERERS = { 'acoustic-strum': acousticStrum, lofi, ambient, 'pop-pluck': popPluck, 'piano-ballad': pianoBallad, 'minimal-pulse': minimalPulse, 'warm-groove': warmGroove };
export function renderStyle(c) { RENDERERS[c.cfg.style](c); }
