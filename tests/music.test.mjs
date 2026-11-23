import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runMusic } from '../src/music/index.mjs';
import { measureLufs, probeAudio } from '../src/music/audio.mjs';
import { resolveConfig, PALETTES } from '../src/music/score.mjs';
import { ffmpeg, haveFfmpeg, tmp } from './helpers.mjs';

async function quiet(fn) {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  let out = '';
  process.stdout.write = (c, ...r) => { if (typeof c === 'string') { out += c; return true; } return o(c, ...r); };
  process.stderr.write = () => true;
  try { return { code: await fn(), out }; } finally { process.stdout.write = o; process.stderr.write = e; }
}

const skip = !haveFfmpeg && 'ffmpeg not available';

test('bad usage exits 64', async () => {
  for (const argv of [[], ['--mood', 'calm'], ['--mood', 'calm', '--duration', 'x', '--out', 'a'], ['--mood', 'calm', '--duration', '10', '--out', 'a', '--nope'], ['--mood', 'calm', '--duration', '10', '--out', 'a', '--candidates', '9']]) {
    assert.equal((await quiet(() => runMusic(argv))).code, 64, argv.join(' '));
  }
});

// ---- Openverse route with an injected fetch (no network) ----
const mp3 = tmp('cve-music-mp3-') + '/t.mp3';
if (haveFfmpeg) ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=40', '-c:a', 'libmp3lame', mp3]);
const track = (over) => ({
  id: over.id, title: over.title ?? 'Song', creator: 'Someone', license: 'by', license_version: '4.0', filetype: 'mp3', duration: 40000,
  url: `https://prod-1.storage.jamendo.com/?trackid=${over.id}`, foreign_landing_url: `https://www.jamendo.com/track/${over.id}`,
  attribution: `"${over.title ?? 'Song'}" by Someone is licensed under CC BY 4.0.`, tags: [], ...over,
});

function stub(results, { failApi = false } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(String(url));
    if (String(url).startsWith('https://api.openverse.org/')) {
      if (failApi) throw new Error('offline');
      assert.equal(init.headers['User-Agent'], 'create-video-engine');
      return Response.json({ results });
    }
    return new Response(readFileSync(mp3));
  };
  fn.calls = calls;
  return fn;
}

test('candidates: licensed tracks only, fitted to length, previews, nothing chosen yet', { skip, timeout: 120000 }, async () => {
  const dir = tmp('cve-music-');
  const f = stub([
    track({ id: 'nc', license: 'by-nc', title: 'NC song' }),
    track({ id: 'http', url: 'http://prod-1.storage.jamendo.com/x', title: 'Plain http' }),
    track({ id: 'evil', url: 'https://evil.example.com/x.mp3', title: 'Bad host' }),
    track({ id: 'by1', license: 'by', title: 'By song' }),
    track({ id: 'zero', license: 'cc0', title: 'Zero song', attribution: '"Zero song" by Someone, CC0 1.0' }),
  ]);
  const { code, out } = await quiet(() => runMusic(['--mood', 'calm', '--duration', '10', '--out', dir, '--json'], { fetch: f }));
  assert.equal(code, 0);
  const j = JSON.parse(out);
  assert.deepEqual(j.candidates.map((c) => c.credit.title), ['Zero song', 'By song']);
  assert.ok(!f.calls.some((u) => u.includes('trackid=nc') || u.includes('evil') || u.startsWith('http://')));
  for (const c of j.candidates) { assert.ok(Math.abs(await probeAudio(c.file) - 10) <= 0.05); assert.ok(c.preview && existsSync(c.preview)); }
  assert.equal(existsSync(join(dir, 'assets/music/track.wav')), false, 'nothing is chosen for the person');
});

test('pick makes a candidate the track, writes its credit and records it as used; used tracks are skipped next time', { skip, timeout: 120000 }, async () => {
  const dir = tmp('cve-music-'); const used = join(tmp('cve-used-'), 'music-used.json');
  const f = stub([track({ id: 'a', title: 'First' }), track({ id: 'b', title: 'Second' })]);
  assert.equal((await quiet(() => runMusic(['--mood', 'calm', '--duration', '8', '--out', dir, '--used', used], { fetch: f }))).code, 0);
  const p = await quiet(() => runMusic(['--pick', '2', '--out', dir, '--used', used, '--json']));
  assert.equal(p.code, 0);
  assert.ok(existsSync(join(dir, 'assets/music/track.wav')));
  const picked = JSON.parse(p.out).credit.title;
  assert.match(readFileSync(join(dir, 'CREDITS.md'), 'utf8'), new RegExp(picked));
  const again = await quiet(() => runMusic(['--mood', 'calm', '--duration', '8', '--out', tmp('cve-music-'), '--used', used, '--json'], { fetch: f }));
  assert.ok(!JSON.parse(again.out).candidates.some((c) => c.credit.title === picked));
  assert.equal((await quiet(() => runMusic(['--pick', '9', '--out', dir]))).code, 64);
});

test('no network or nothing usable: exit 1, no music is invented', { skip, timeout: 120000 }, async () => {
  assert.equal((await quiet(() => runMusic(['--mood', 'calm', '--duration', '5', '--out', tmp('cve-music-')], { fetch: stub([], { failApi: true }) }))).code, 1);
  assert.equal((await quiet(() => runMusic(['--mood', 'calm', '--duration', '5', '--out', tmp('cve-music-')], { fetch: stub([track({ id: 'nd', license: 'by-nd' })]) }))).code, 1);
});

// ---- scorer ----
function scoreIn(obj) { const f = tmp('cve-cues-') + '/cues.json'; writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; }
async function score(obj, dir = tmp('cve-score-'), extra = []) {
  const r = await quiet(() => runMusic(['--score', scoreIn(obj), '--out', dir, '--json', ...extra]));
  return { ...r, dir, wav: join(dir, 'assets/music/track.wav') };
}
function readWav(file) {
  const b = readFileSync(file); const n = (b.length - 44) / 4; const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = b.readInt16LE(44 + i * 4) / 32768;
  return { L, n };
}
function truePeak(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` } });
  return Number([...r.stderr.matchAll(/Peak:\s*(-?[\d.]+)\s*dBFS/g)].pop()[1]);
}
const THREE = { style: 'classic', duration: 12, bpm: 90, key: 'C', mode: 'major', palette: 'nylon', energy: 0.4, seed: 3, cues: [{ beat: 6, kind: 'cut' }, { beat: 9.5, kind: 'highlight' }, { beat: 13, kind: 'impact' }] };

test('score: exact length, -16 LUFS, true peak <= -1, score.json, credit, stdout shape', { skip, timeout: 120000 }, async () => {
  const { code, out, dir, wav } = await score(THREE);
  assert.equal(code, 0);
  const j = JSON.parse(out);
  assert.deepEqual({ ok: j.ok, route: j.route, duration: j.duration, bpm: j.bpm, key: j.key, mode: j.mode, palette: j.palette, cues: j.cues }, { ok: true, route: 'scored', duration: 12, bpm: 90, key: 'C', mode: 'major', palette: 'nylon', cues: 3 });
  const { n } = readWav(wav);
  assert.ok(Math.abs(n - 12 * 44100) <= 1, `samples ${n}`);
  const lufs = await measureLufs(wav);
  assert.ok(lufs > -18 && lufs < -14, `lufs ${lufs}`);
  assert.ok(truePeak(wav) <= -1, `true peak ${truePeak(wav)}`);
  const sj = JSON.parse(readFileSync(join(dir, 'assets/music/score.json'), 'utf8'));
  assert.equal(sj.cues.length, 3);
  assert.ok(Math.abs(sj.cues[0].time - 6 * 60 / 90) < 1e-6);
  assert.equal(sj.beat_seconds, Math.round(60 / 90 * 1e6) / 1e6);
  assert.ok(sj.progression.length === 4 && sj.bars.length === Math.ceil(12 / (4 * 60 / 90)));
  assert.match(readFileSync(join(dir, 'CREDITS.md'), 'utf8'), /scored by create-video-engine, no licence restrictions/);
});

test('score: every cue starts within 15 ms of its time (bed at energy 0)', { skip, timeout: 120000 }, async () => {
  const cues = [{ beat: 6, kind: 'cut' }, { beat: 9.5, kind: 'highlight' }, { beat: 13, kind: 'impact' }, { beat: 17.5, kind: 'tick' }];
  const { wav } = await score({ ...THREE, bpm: 120, duration: 12, energy: 0, cues });
  const { L, n } = readWav(wav);
  const W = 220; // 5 ms energy windows, once on the signal (low cues) and once on its first difference (high cues, pad removed)
  const energies = [0, 1].map((diff) => {
    const e = new Float64Array(Math.floor(n / W));
    for (let k = 0; k < e.length; k++) { let s = 0; for (let i = k * W + 1; i < (k + 1) * W; i++) s += (diff ? L[i] - L[i - 1] : L[i]) ** 2; e[k] = s; }
    return e;
  });
  const onsetOf = (e, t) => {
    const k0 = Math.floor((t - 0.025) * 44100 / W); const k1 = Math.floor((t + 0.08) * 44100 / W);
    let m = 0; for (let k = k0; k <= k1; k++) m = Math.max(m, e[k]);
    for (let k = k0; k <= k1; k++) {
      const prev = (e[k - 1] + e[k - 2] + e[k - 3] + e[k - 4] + e[k - 5]) / 5;
      if (e[k] > 3 * prev && e[k] > 0.1 * m) return k * W / 44100;
    }
    return null;
  };
  for (const c of cues) {
    const t = c.beat * 60 / 120;
    const ons = energies.map((e) => onsetOf(e, t)).filter((x) => x !== null);
    assert.ok(ons.some((o) => Math.abs(o - t) <= 0.015), `${c.kind}: onsets ${ons} vs ${t}`);
  }
});

test('score: deterministic; another seed gives another progression and other bytes', { skip, timeout: 120000 }, async () => {
  const prog = (seed) => resolveConfig({ ...THREE, seed }).cfg.progIdx;
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const other = seeds.find((s) => prog(s) !== prog(3));
  assert.ok(other, 'seeds never change the progression');
  const a = await score(THREE); const b = await score(THREE); const c = await score({ ...THREE, seed: other });
  assert.deepEqual(readFileSync(a.wav), readFileSync(b.wav));
  assert.notDeepEqual(readFileSync(a.wav), readFileSync(c.wav));
  const p = (d) => JSON.parse(readFileSync(join(d, 'assets/music/score.json'), 'utf8')).progression.join();
  assert.notEqual(p(a.dir), p(c.dir));
});

test('score: every palette is audible; minor differs from major; energy changes the bed', { skip, timeout: 240000 }, async () => {
  const rms = (f) => { const { L } = readWav(f); let s = 0; for (const v of L) s += v * v; return Math.sqrt(s / L.length); };
  for (const palette of PALETTES) {
    const r = await score({ ...THREE, palette, duration: 6, cues: [] });
    assert.equal(r.code, 0, palette);
    assert.ok(rms(r.wav) > 0.02, `${palette} rms ${rms(r.wav)}`);
  }
  const maj = await score({ ...THREE, duration: 6, cues: [] }); const min = await score({ ...THREE, mode: 'minor', duration: 6, cues: [] });
  assert.notDeepEqual(readFileSync(maj.wav), readFileSync(min.wav));
  assert.match(JSON.parse(readFileSync(join(min.dir, 'assets/music/score.json'), 'utf8')).bars[0], /^Cm7$/);
  const hi = await score({ ...THREE, energy: 0.9, duration: 6, cues: [] }); const lo = await score({ ...THREE, energy: 0.1, duration: 6, cues: [] });
  assert.notDeepEqual(readFileSync(hi.wav), readFileSync(lo.wav));
});

test('score: end cue resolves to the tonic; a 30 s score renders in under 20 s', { skip, timeout: 120000 }, async () => {
  const t0 = Date.now();
  const r = await score({ ...THREE, duration: 30, energy: 0.8, cues: [{ beat: 40, kind: 'end' }] });
  assert.ok(Date.now() - t0 < 20000, `took ${Date.now() - t0} ms`);
  const sj = JSON.parse(readFileSync(join(r.dir, 'assets/music/score.json'), 'utf8'));
  assert.equal(sj.bars.at(-1), 'Cmaj7');
  assert.equal(sj.bars[Math.floor(40 / 4)], 'Cmaj7');
});

test('score: bad cues.json exits 64', async () => {
  const bads = ['not json', '[]', { ...THREE, key: 'H' }, { ...THREE, mode: 'dorian' }, { ...THREE, palette: 'banjo' }, { ...THREE, energy: 2 },
    { ...THREE, cues: [{ beat: 1, kind: 'boom' }] }, { ...THREE, cues: [{ beat: -1, kind: 'cut' }] }, { ...THREE, cues: [{ beat: 500, kind: 'cut' }] },
    { ...THREE, duration: 1 }, { ...THREE, bpm: 10 }];
  for (const b of bads) assert.equal((await score(b)).code, 64, JSON.stringify(b));
  assert.equal((await quiet(() => runMusic(['--score', '/nonexistent/cues.json', '--out', tmp()]))).code, 64);
});
