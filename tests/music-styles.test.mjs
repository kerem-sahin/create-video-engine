import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runMusic } from '../src/music/index.mjs';
import { measureLufs } from '../src/music/audio.mjs';
import { renderScore, PALETTES, PROGRESSIONS, FAST_PROGRESSIONS, STYLE_IDS, planScore, resolveConfig, writeScoreWav } from '../src/music/score.mjs';
import { buildMotif, melodyEvents } from '../src/music/styles.mjs';
import { features, readMono } from './music-features.mjs';
import { haveFfmpeg, tmp } from './helpers.mjs';

const skip = !haveFfmpeg && 'ffmpeg not available';
const NEW_STYLES = ['acoustic-strum', 'lofi', 'ambient', 'pop-pluck', 'piano-ballad', 'minimal-pulse', 'warm-groove'];
const CUES = [{ beat: 4, kind: 'cut' }, { beat: 5, kind: 'highlight' }, { beat: 8, kind: 'cut' }, { beat: 12, kind: 'cut' }, { beat: 13, kind: 'confirm' }, { beat: 16, kind: 'cut' }, { beat: 30, kind: 'end' }];
const BASE = { duration: 24, bpm: 84, key: 'G', mode: 'major', palette: 'nylon', energy: 0.4, seed: 11, cues: CUES };

async function quiet(fn) {
  const o = process.stdout.write.bind(process.stdout); const e = process.stderr.write.bind(process.stderr);
  let out = '';
  process.stdout.write = (c, ...r) => { if (typeof c === 'string') { out += c; return true; } return o(c, ...r); };
  process.stderr.write = () => true;
  try { return { code: await fn(), out }; } finally { process.stdout.write = o; process.stderr.write = e; }
}
function truePeak(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` } });
  return Number([...r.stderr.matchAll(/Peak:\s*(-?[\d.]+)\s*dBFS/g)].pop()[1]);
}
const cache = new Map(); // style -> rendered once and shared by the tests below
function rendered(style) {
  if (!cache.has(style)) {
    cache.set(style, (async () => {
      const r = resolveConfig({ ...BASE, style }); assert.ok(!r.error, r.error);
      const file = join(tmp('cve-style-'), `${style}.wav`);
      const plan = await writeScoreWav(file, r.cfg);
      return { file, plan, cfg: r.cfg };
    })());
  }
  return cache.get(style);
}

test('styles: classic plus seven arrangements, each described', () => {
  assert.deepEqual([...STYLE_IDS].sort(), ['classic', ...NEW_STYLES].sort());
});

test('harmony: at least 10 progressions per mode, with borrowed chords, sus/add9 colours and two-chords-per-bar sets', () => {
  for (const mode of ['major', 'minor']) {
    assert.ok(PROGRESSIONS[mode].length >= 10, `${mode} has ${PROGRESSIONS[mode].length}`);
    assert.ok(FAST_PROGRESSIONS[mode].length >= 3 && FAST_PROGRESSIONS[mode].every((p) => p.length === 8));
    assert.equal(new Set(PROGRESSIONS[mode].map((p) => p.join())).size, PROGRESSIONS[mode].length, 'duplicate progression');
    const all = [...PROGRESSIONS[mode], ...FAST_PROGRESSIONS[mode]].flat().join(' ');
    assert.match(all, /sus2|sus4|Vsus4/); assert.match(all, /add9/);
  }
  assert.match(PROGRESSIONS.major.flat().join(' '), /bVII/);
  assert.ok(PROGRESSIONS.major.some((p) => p.includes('iv') && p.includes('I')), 'iv borrowed into major');
  assert.match(PROGRESSIONS.minor.flat().join(' '), /bII|V7/);
});

test('harmony: the seed picks the progression per style; fast styles use the 8-chord sets', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) { const { cfg } = resolveConfig({ ...BASE, style: 'acoustic-strum', seed }); seen.add(cfg.progNames.join()); assert.equal(cfg.cpb, 1); }
  assert.ok(seen.size >= 6, `only ${seen.size} different progressions over 40 seeds`);
  const cpbs = new Set();
  for (let seed = 1; seed <= 40; seed++) { const { cfg } = resolveConfig({ ...BASE, style: 'warm-groove', seed }); cpbs.add(cfg.cpb); assert.equal(cfg.progNames.length, cfg.cpb === 2 ? 8 : 4); }
  assert.deepEqual([...cpbs].sort(), [1, 2]);
  const { cfg } = resolveConfig({ ...BASE, style: 'pop-pluck', seed: 4 }); const plan = planScore(cfg);
  assert.equal(plan.slots.length, plan.bars * cfg.cpb);
  if (cfg.cpb === 2) assert.ok(plan.slots.some((s, i) => i % 2 === 0 && s.name !== plan.slots[i + 1]?.name), 'a bar with two chords');
});

test('melody: a seeded 3-5 note motif, stated then varied; phrases end on a chord tone', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const m = buildMotif(seed, 'major', 4);
    assert.ok(m.degrees.length >= 3 && m.degrees.length <= 5 && m.onsets.length === m.degrees.length && m.durs.length === m.degrees.length);
    assert.ok(m.onsets.at(-1) < 4 && m.degrees.every((d) => d >= 0 && d <= 7));
    assert.deepEqual(m, buildMotif(seed, 'major', 4));
    seen.add(JSON.stringify(m));
  }
  assert.ok(seen.size >= 15, `only ${seen.size} motifs over 30 seeds`);
  const { cfg } = resolveConfig({ ...BASE, style: 'piano-ballad', cues: [] }); const plan = planScore(cfg); const motif = buildMotif(cfg.seed, cfg.mode, 4);
  const ev = melodyEvents({ cfg, plan, motif }, { from: 0, lo: 64, hi: 82, density: 1 });
  assert.ok(ev.length > 8);
  const pcs = (t) => plan.chordAt(t).tones.map((x) => x % 12);
  const ends = ev.filter((e) => e.end);
  assert.ok(ends.length >= 2);
  for (const e of ends) assert.ok(pcs(e.t + 1e-6).includes(e.m % 12), `phrase end ${e.m} not in chord at ${e.t}`);
  const bar = (e) => Math.floor(e.t / plan.barLen + 1e-6);
  const first = ev.filter((e) => bar(e) === 0); const second = ev.filter((e) => bar(e) === 1);
  assert.ok(first.length >= 3 && second.length >= 3);
  assert.notDeepEqual(first.map((e) => (e.t % plan.barLen).toFixed(3)), second.map((e) => (e.t % plan.barLen).toFixed(3)), 'bar 2 should be displaced, not a copy');
});

test('styles: every style renders deterministically (same cues and seed give identical bytes)', { skip, timeout: 240000 }, async () => {
  for (const style of STYLE_IDS) {
    const a = await rendered(style);
    const r = resolveConfig({ ...BASE, style }); const f = join(tmp('cve-style-'), 'again.wav'); await writeScoreWav(f, r.cfg);
    assert.deepEqual(readFileSync(a.file), readFileSync(f), style);
  }
});

test('styles: they differ measurably (onsets, drums, bass share, brightness), not just in timbre', { skip, timeout: 240000 }, async () => {
  const ft = {};
  for (const style of STYLE_IDS) { const r = await rendered(style); ft[style] = features(r.file, { duration: BASE.duration, barSeconds: r.plan.barLen }); }
  // drums: noise-like high-frequency attacks are there with percussion, absent without it
  for (const s of ['classic', 'lofi', 'pop-pluck', 'warm-groove']) assert.ok(ft[s].noiseHitsPerBar >= 2, `${s} should have drum transients: ${ft[s].noiseHitsPerBar}`);
  for (const s of ['acoustic-strum', 'ambient', 'piano-ballad', 'minimal-pulse']) assert.ok(ft[s].noiseHitsPerBar <= 0.6, `${s} should have none: ${ft[s].noiseHitsPerBar}`);
  // texture: ambient is the sparsest, lofi and pop-pluck the busiest; piano-ballad has no bass-register hits to speak of, warm-groove the most low end
  for (const s of STYLE_IDS) if (s !== 'ambient') assert.ok(ft.ambient.onsetsPerBar < ft[s].onsetsPerBar, `ambient ${ft.ambient.onsetsPerBar} vs ${s} ${ft[s].onsetsPerBar}`);
  assert.ok(ft.lofi.onsetsPerBar > 1.5 * ft['acoustic-strum'].onsetsPerBar && ft['pop-pluck'].onsetsPerBar > 1.4 * ft.classic.onsetsPerBar);
  assert.ok(ft['piano-ballad'].lowShare < 0.02 && ft['warm-groove'].lowShare > 0.1, `low share ${ft['piano-ballad'].lowShare} / ${ft['warm-groove'].lowShare}`);
  assert.ok(ft.lofi.centroidHz < 0.92 * ft['acoustic-strum'].centroidHz, 'lofi is low-passed, so darker');
  // every pair of styles is far apart in a normalised feature space (distance 1 = clearly different on at least one axis)
  const dist = (a, b) => Math.abs(Math.log(a.onsetsPerBar / b.onsetsPerBar)) / 0.25 + Math.abs(a.noiseHitsPerBar - b.noiseHitsPerBar) / 1.5
    + Math.abs(a.lowShare - b.lowShare) / 0.04 + Math.abs(Math.log(a.centroidHz / b.centroidHz)) / 0.1 + Math.abs(Math.log((a.hfHitsPerBar + 1) / (b.hfHitsPerBar + 1))) / 0.3;
  let min = Infinity; let worst = '';
  for (const a of STYLE_IDS) for (const b of STYLE_IDS) if (a < b) { const d = dist(ft[a], ft[b]); if (d < min) { min = d; worst = `${a} vs ${b}`; } }
  assert.ok(min >= 1, `closest pair ${worst}: distance ${min.toFixed(2)}\n${JSON.stringify(ft, null, 1)}`);
});

test('styles: -16 LUFS and true peak <= -1 dBTP for every style', { skip, timeout: 240000 }, async () => {
  for (const style of STYLE_IDS) {
    const { file } = await rendered(style);
    const lufs = await measureLufs(file); const tp = truePeak(file);
    assert.ok(Math.abs(lufs + 16) <= 0.5, `${style}: ${lufs} LUFS`);
    assert.ok(tp <= -1, `${style}: true peak ${tp}`);
  }
});

test('styles: every style works with every palette (audible, exact length)', { skip, timeout: 400000 }, async () => {
  for (const style of STYLE_IDS) for (const palette of PALETTES) {
    const r = resolveConfig({ ...BASE, duration: 7, style, palette, cues: [{ beat: 3, kind: 'cut' }, { beat: 9, kind: 'end' }] }); assert.ok(!r.error);
    const f = join(tmp('cve-combo-'), 'x.wav'); await writeScoreWav(f, r.cfg);
    const x = readMono(f); let s = 0; for (const v of x) s += v * v;
    assert.ok(Math.abs(x.length - 7 * 44100) <= 1, `${style}/${palette} length`);
    assert.ok(Math.sqrt(s / x.length) > 0.02, `${style}/${palette} rms ${Math.sqrt(s / x.length)}`);
  }
});

test('styles: no NaN or runaway samples for any style over many seeds, bar lengths and tempos', { skip, timeout: 240000 }, () => {
  let n = 0;
  for (const style of STYLE_IDS) for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const bpb = [2, 3, 4, 5, 6, 4, 7, 4][seed - 1]; const bpm = [200, 84, 40, 120, 84, 150, 84, 60][seed - 1];
    const r = resolveConfig({ duration: 5, bpm, beats_per_bar: bpb, key: ['C', 'F#', 'Bb', 'G'][seed % 4], mode: seed % 2 ? 'major' : 'minor', palette: PALETTES[seed % 5], energy: [0, 0.4, 0.9][seed % 3], seed, style, cues: [{ beat: 1, kind: 'cut' }, { beat: Math.floor(5 * bpm / 60 * 0.6), kind: 'end' }] });
    assert.ok(!r.error, r.error);
    const { L, R } = renderScore(r.cfg); let pk = 0;
    for (let i = 0; i < L.length; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); assert.ok(v < 100, `${style} seed ${seed}: sample ${i} = ${L[i]}`); if (v > pk) pk = v; n++; }
    assert.ok(pk > 1e-3, `${style} seed ${seed} is silent`);
  }
  assert.ok(n > 0);
});

function cuesFile(obj) { const f = join(tmp('cve-cues-'), 'cues.json'); writeFileSync(f, JSON.stringify(obj)); return f; }

test('style field: validated, written to score.json with motif, fingerprint and ledger shape; missing style is derived', { skip, timeout: 120000 }, async () => {
  assert.equal((await quiet(() => runMusic(['--score', cuesFile({ ...BASE, style: 'polka' }), '--out', tmp()]))).code, 64);
  const dir = tmp('cve-score-');
  const { code, out } = await quiet(() => runMusic(['--score', cuesFile({ ...BASE, duration: 8, cues: [], style: 'lofi', palette: 'felt-piano' }), '--out', dir, '--json']));
  assert.equal(code, 0);
  const j = JSON.parse(out); assert.equal(j.style, 'lofi'); assert.match(j.fingerprint, /^lofi\|felt-piano\|/);
  const sj = JSON.parse(readFileSync(join(dir, 'assets/music/score.json'), 'utf8'));
  assert.equal(sj.style, 'lofi');
  assert.ok(sj.motif.degrees.length >= 3 && sj.motif.degrees.length <= 5);
  assert.equal(sj.fingerprint, [sj.style, sj.palette, sj.progression.join('-'), sj.bpm, sj.key, sj.mode].join('|'));
  assert.deepEqual(Object.keys(sj.music), ['style', 'palette', 'progression', 'bpm', 'key', 'mode', 'fingerprint']);
  assert.equal(sj.music.fingerprint, sj.fingerprint);
  // no style in cues.json: derived, from the energy and the mood words, and still a valid style
  const { style: _s, ...noStyle } = BASE;
  const a = resolveConfig({ ...noStyle, energy: 0.1 }).cfg.style; const b = resolveConfig({ ...noStyle, energy: 0.9 }).cfg.style;
  assert.ok(['ambient', 'piano-ballad'].includes(a), a); assert.ok(['pop-pluck', 'warm-groove'].includes(b), b);
  assert.equal(resolveConfig({ ...noStyle }, { mood: 'study chill' }).cfg.style, 'lofi');
  assert.equal(resolveConfig({ ...noStyle }, { mood: 'dreamy ambient' }).cfg.style, 'ambient');
  const seen = new Set(); for (let seed = 1; seed <= 40; seed++) seen.add(resolveConfig({ ...noStyle, seed }).cfg.style);
  assert.ok(seen.size >= 3, `derived style varies with the seed: ${[...seen]}`);
});

test('classic reproduces the earlier output byte for byte', { skip, timeout: 120000 }, async () => {
  const r = resolveConfig({ style: 'classic', duration: 12, bpm: 90, key: 'C', mode: 'major', palette: 'nylon', energy: 0.4, seed: 3,
    cues: [{ beat: 6, kind: 'cut' }, { beat: 9.5, kind: 'highlight' }, { beat: 13, kind: 'impact' }, { beat: 4, kind: 'type', beats: 2 }, { beat: 10, kind: 'confirm' }, { beat: 16, kind: 'tick' }, { beat: 17, kind: 'tick' }] });
  const f = join(tmp('cve-classic-'), 'c.wav'); await writeScoreWav(f, r.cfg);
  // md5 of the file the engine wrote before styles existed, for this exact input
  assert.equal(createHash('md5').update(readFileSync(f)).digest('hex'), 'c013adbdd81df6d26c382ccdfb5c1002');
});
