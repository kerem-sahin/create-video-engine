import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runVerify } from '../src/verify/index.mjs';
import { checkNumbers, checkStaticShots, checkVariety, extractNumbers, pickFrameTimes, pickMoments } from '../src/verify/extra.mjs';
import { probeMedia } from '../src/verify/util.mjs';
import { ffmpeg, haveFfmpeg, makeClip, makeProject, tmp, verifyJson } from './helpers.mjs';

const opts = { skip: !haveFfmpeg && 'ffmpeg not installed' };
const root = tmp('cve-checks-');
const check = (rep, id) => rep.layers.mp4.checks.find((c) => c.id === id);
let n = 0;
const proj = (o) => { const d = join(root, `p${n++}`); makeProject(d, o); return d; };
const run = (p, mp4) => verifyJson(runVerify, p, ['--mp4', mp4, '--no-hf-check']);
const COLORS = ['0xd04030', '0x2040c0', '0x30a050', '0xe0c030', '0x8030a0'];

/** Full-frame colour segments, a hard cut at each time in `cuts` (30 fps, 320x180, silent). */
function cutClip(file, cuts, duration) {
  const b = [0, ...cuts, duration];
  const args = [];
  b.slice(0, -1).forEach((t, i) => args.push('-f', 'lavfi', '-i', `color=c=${COLORS[i % COLORS.length]}:s=320x180:r=30:d=${(b[i + 1] - t).toFixed(4)}`));
  const ins = b.slice(0, -1).map((_, i) => `[${i}:v]`).join('');
  args.push('-filter_complex', `${ins}concat=n=${b.length - 1}:v=1:a=0,format=yuv420p`, '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', file);
  ffmpeg(args);
  return file;
}

// ---- on-beat ----
test('on-beat: skipped without cues.json', opts, async () => {
  const { report } = await run(proj(), cutClip(join(root, `c${n++}.mp4`), [2, 4], 6));
  assert.equal(check(report, 'on-beat').status, 'skipped');
  assert.equal(check(report, 'on-beat').required, false);
});

test('on-beat: cuts on beats and half-beats pass', opts, async () => {
  const p = proj();
  writeFileSync(join(p, 'cues.json'), JSON.stringify({ bpm: 120, duration: 6 })); // half-beat = 0.25 s
  const { report } = await run(p, cutClip(join(root, `c${n++}.mp4`), [2, 4.25], 6));
  const c = check(report, 'on-beat');
  assert.equal(c.status, 'pass', JSON.stringify(c));
  assert.equal(c.data.cuts.length, 2);
});

test('on-beat: a cut 3 frames off the grid warns and names its time (bpm from score.json)', opts, async () => {
  const p = proj();
  writeFileSync(join(p, 'cues.json'), JSON.stringify({ duration: 6 }));
  mkdirSync(join(p, 'assets', 'music'), { recursive: true });
  writeFileSync(join(p, 'assets', 'music', 'score.json'), JSON.stringify({ bpm: 120, cues: [] }));
  const { report } = await run(p, cutClip(join(root, `c${n++}.mp4`), [2, 3.1], 6));
  const c = check(report, 'on-beat');
  assert.equal(c.status, 'warn', JSON.stringify(c));
  assert.match(c.message, /3\.1s/);
  assert.deepEqual(c.data.offGrid, [3.1]);
  assert.ok(Math.abs(c.at - 3.1) < 0.05);
});

// ---- variety ----
function brandProject(shots, ledger) {
  const base = join(root, `brand${n++}`);
  const p = join(base, 'videos', 'new-video');
  makeProject(p);
  mkdirSync(join(base, 'taste'), { recursive: true });
  if (shots) writeFileSync(join(p, 'shots.json'), JSON.stringify(shots));
  if (ledger) writeFileSync(join(base, 'taste', 'ledger.json'), JSON.stringify(ledger));
  return p;
}
const mkShots = (tr, structure) => ({
  shots: [...tr, 'end'].map((t, i) => ({ start: i * 2, end: i * 2 + 2, transition_out: t })),
  structure,
});

test('variety: skipped without shots.json', () => {
  assert.equal(checkVariety({ project: brandProject() }).status, 'skipped');
});

test('variety: the same transition three times in a row warns', () => {
  const r = checkVariety({ project: brandProject(mkShots(['hard cut', 'hard cut', 'hard cut', 'mask wipe'], ['a'])) });
  assert.equal(r.status, 'warn');
  assert.match(r.message, /"hard cut" 3 times in a row/);
});

test('variety: two in a row and a different ledger video pass', () => {
  const ledger = { videos: [{ slug: 'old', structure: ['x'], transitions: ['mask wipe', 'hard cut'] }] };
  const r = checkVariety({ project: brandProject(mkShots(['hard cut', 'hard cut', 'mask wipe'], ['a', 'b']), ledger) });
  assert.equal(r.status, 'pass', r.message);
  assert.equal(r.data.previous, 'old');
});

test('variety: same transition list or structure as the previous ledger video warns', () => {
  const ledger = { videos: [
    { slug: 'older', structure: ['zzz'], transitions: ['fade'] },
    { slug: 'prev', structure: ['Hook: A', 'End'], transitions: ['hard cut', 'Mask Wipe'] },
  ] };
  const r = checkVariety({ project: brandProject(mkShots(['hard cut', 'mask wipe'], ['hook: a', 'end']), ledger) });
  assert.equal(r.status, 'warn');
  assert.match(r.message, /same transition list as prev/);
  assert.match(r.message, /same structure as prev/);
});

test('variety: the video itself in the ledger is not its own predecessor', () => {
  const ledger = { videos: [{ slug: 'new-video', structure: ['a'], transitions: ['hard cut'] }] };
  const r = checkVariety({ project: brandProject(mkShots(['hard cut'], ['a']), ledger) });
  assert.equal(r.status, 'pass');
});

test('variety: bad shots.json is an error', () => {
  const p = brandProject({ nope: 1 });
  assert.equal(checkVariety({ project: p }).status, 'error');
});

test('variety runs in the report', opts, async () => {
  const p = brandProject(mkShots(['hard cut', 'hard cut', 'hard cut'], ['a']));
  const { report } = await run(p, clip6());
  assert.equal(check(report, 'variety').status, 'warn');
});
// music
const withScore = (p, score) => { mkdirSync(join(p, 'assets', 'music'), { recursive: true }); writeFileSync(join(p, 'assets', 'music', 'score.json'), JSON.stringify(score)); return p; };
const musicLedger = (...ms) => ({ videos: ms.map((m, i) => ({ slug: `v${i}`, structure: [`s${i}`], transitions: [`t${i}`], music: m })) });
const sh = mkShots(['hard cut', 'mask wipe'], ['a']);

test('variety music: same style and progression as the previous video warns', () => {
  const p = withScore(brandProject(sh, musicLedger({ style: 'Lo-Fi', progression: ['I', 'V', 'vi', 'IV'], palette: 'nylon' })), { style: 'lo-fi', progression: ['I', 'V', 'vi', 'IV'], palette: 'felt-piano', fingerprint: 'zzz' });
  const r = checkVariety({ project: p });
  assert.equal(r.status, 'warn');
  assert.match(r.message, /same style and progression as v0/);
});

test('variety music: same style but another progression passes', () => {
  const p = withScore(brandProject(sh, musicLedger({ style: 'lofi', progression: 'I V' })), { style: 'lofi', progression: 'ii V I', fingerprint: 'new' });
  assert.equal(checkVariety({ project: p }).status, 'pass');
});

test('variety music: the same fingerprint in any of the last 3 videos warns, the 4th back does not', () => {
  const ms = [{ fingerprint: 'abc', style: 'a', progression: 'x' }, { fingerprint: 'b' }, { fingerprint: 'c' }, { fingerprint: 'd' }];
  const warn = checkVariety({ project: withScore(brandProject(sh, musicLedger(...ms)), { fingerprint: 'b', style: 'q', progression: 'z' }) });
  assert.equal(warn.status, 'warn');
  assert.match(warn.message, /same fingerprint as v1/);
  const ok = checkVariety({ project: withScore(brandProject(sh, musicLedger(...ms)), { fingerprint: 'abc', style: 'q', progression: 'z' }) });
  assert.equal(ok.status, 'pass', ok.message);
});

test('variety music: an older score compares palette and progression only and says so', () => {
  const p = withScore(brandProject(sh, musicLedger({ palette: 'nylon', progression: 'I V', style: 'other' })), { palette: 'nylon', progression: 'I V' });
  const r = checkVariety({ project: p });
  assert.equal(r.status, 'warn');
  assert.match(r.message, /same palette and progression as v0/);
  assert.match(r.message, /older score/);
});

test('variety music: no ledger skips the comparison with the usual note', () => {
  const r = checkVariety({ project: withScore(brandProject(sh), { style: 'a', progression: 'x', fingerprint: 'f' }) });
  assert.equal(r.status, 'pass');
  assert.match(r.message, /no brand ledger/);
});

// ---- static-shots ----
const bins = (flags) => ({ ok: true, bins: flags.map((m, i) => ({ t: i * 0.5, mean: m ? 5 : 0.5, moving: m })) });
const mkShotsB = (b) => ({ ok: true, boundaries: b });

test('static-shots: unit: 2 of 3 static shots warn, the end card is not counted', () => {
  // shots 0-3, 3-6, 6-9, end 9-12; bins of 0.5 s: shot 3 moving
  const flags = [...Array(6).fill(false), ...Array(6).fill(false), ...Array(6).fill(true), ...Array(6).fill(true)];
  const r = checkStaticShots({ motion: bins(flags), shots: mkShotsB([3, 6, 9]), cuts: { ok: false }, duration: 12 });
  assert.equal(r.status, 'warn');
  assert.equal(r.data.staticShots, 2);
  assert.equal(r.data.shots.length, 3);
});

test('static-shots: 1 of 3 static passes; the entrance (first 0.6 s) is ignored', () => {
  const f = (a) => a;
  // shot 1 moves only in its first 0.5 s bin (entrance) then still: static. shots 2, 3 move.
  const flags = [true, ...Array(5).fill(false), ...Array(6).fill(true), ...Array(6).fill(true), ...Array(6).fill(false)];
  const r = checkStaticShots({ motion: bins(f(flags)), shots: mkShotsB([3, 6, 9]), cuts: { ok: false }, duration: 12 });
  assert.equal(r.status, 'pass', r.message);
  assert.equal(r.data.staticShots, 1);
});

test('static-shots: skipped without boundaries; detected cuts are the fallback', () => {
  assert.equal(checkStaticShots({ motion: bins([false]), shots: { ok: false, boundaries: [] }, cuts: { ok: true, cuts: [] }, duration: 6 }).status, 'skipped');
  const r = checkStaticShots({ motion: bins(Array(24).fill(false)), shots: { ok: false, boundaries: [] }, cuts: { ok: true, cuts: [6] }, duration: 12 });
  assert.equal(r.status, 'warn');
  assert.equal(r.data.source, 'detected cuts');
});

const shotsProj = () => { const p = proj({ duration: 12 }); writeFileSync(join(p, 'shots.json'), JSON.stringify({ shots: [0, 3, 6, 9].map((t) => ({ start: t, end: t + 3 })) })); return p; };

test('static-shots: a video of still shots warns in the report', opts, async () => {
  const { report } = await run(shotsProj(), stillClip(''));
  const c = check(report, 'static-shots');
  assert.equal(c.status, 'warn', JSON.stringify(c));
  assert.equal(c.required, false);
  assert.equal(c.data.staticShots, 3);
});

test('static-shots: a panning video passes in the report', opts, async () => {
  const { report } = await run(shotsProj(), stillClip('', { drift: 12 }));
  assert.equal(check(report, 'static-shots').status, 'pass', JSON.stringify(check(report, 'static-shots')));
});

function clip6() { const f = join(root, `c${n++}.mp4`); makeClip(f); return f; }

// ---- stillness ----
const still = join(root, 'still.png');
const stillClip = (extraVf, { drift = 0, duration = 12 } = {}) => {
  if (!existsSync(still)) ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=360x180:rate=30', '-frames:v', '1', still]);
  const f = join(root, `s${n++}.mp4`);
  // drift: 4x supersampled crop so a slow pan moves in sub-pixel steps, like a CSS transform does
  const pan = drift ? `scale=2400:720:flags=bicubic,crop=1280:720:x='t*${drift * 4}':y=0,scale=320:180:flags=area,` : 'crop=320:180:0:0,';
  ffmpeg(['-loop', '1', '-framerate', '30', '-t', String(duration), '-i', still, '-vf', `${pan}format=yuv420p${extraVf ? `,${extraVf}` : ''}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', f]);
  return f;
};

test('stillness: a frame that never changes warns with its stretch', opts, async () => {
  const { report } = await run(proj({ duration: 12 }), stillClip(''));
  const c = check(report, 'stillness');
  assert.equal(c.status, 'warn', JSON.stringify(c));
  assert.equal(c.required, false);
  assert.ok(c.at <= 0.6);
  assert.ok(c.data.stretches[0].length > 3);
});

test('stillness: a slow drift (about 3 px/s at 1080 wide) still counts as still', opts, async () => {
  const { report } = await run(proj({ duration: 12 }), stillClip('', { drift: 1 }));
  const c = check(report, 'stillness');
  assert.equal(c.status, 'warn', JSON.stringify(c));
});

test('stillness: a fast pan (about 40 px/s at 1080 wide) is movement', opts, async () => {
  const { report } = await run(proj({ duration: 12 }), stillClip('', { drift: 12 }));
  assert.equal(check(report, 'stillness').status, 'pass', JSON.stringify(check(report, 'stillness')));
});

test('stillness: a blinking cursor is not still', opts, async () => {
  const f = stillClip("drawbox=x=150:y=90:w=3:h=16:color=white:t=fill:enable='lt(mod(t,1),0.5)'");
  const { report } = await run(proj({ duration: 12 }), f);
  assert.equal(check(report, 'stillness').status, 'pass', JSON.stringify(check(report, 'stillness')));
});

test('stillness: typing (a character every 0.3 s) is not still while it types', opts, async () => {
  let vf = '';
  for (let i = 1; i <= 36; i++) vf += `${vf ? ',' : ''}drawbox=x=${20 + i * 8}:y=120:w=6:h=12:color=black:t=fill:enable='gte(t,${(i * 0.3).toFixed(1)})'`;
  const { report } = await run(proj({ duration: 12 }), stillClip(vf));
  const c = check(report, 'stillness');
  // typing runs 0.3-10.8 s; only the part after the last character (before the excluded end) could be still
  assert.equal(c.status, 'pass', JSON.stringify(c));
});

test('stillness: a still end card in the last 5 s is not flagged', opts, async () => {
  const f = join(root, `s${n++}.mp4`);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=12', '-vf',
    'format=yuv420p,trim=duration=7,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', f]);
  const { report } = await run(proj({ duration: 12 }), f);
  assert.equal(check(report, 'stillness').status, 'pass', JSON.stringify(check(report, 'stillness')));
});

test('stillness: skipped when too short to judge', opts, async () => {
  const { report } = await run(proj(), clip6());
  assert.equal(check(report, 'stillness').status, 'skipped');
});

// ---- poster ----
test('poster: a detailed frame 0 passes and is saved', opts, async () => {
  const p = proj();
  const { report } = await run(p, clip6());
  assert.equal(check(report, 'poster').status, 'pass', JSON.stringify(check(report, 'poster')));
  assert.ok(existsSync(join(p, '.cve', 'poster.png')));
});

test('poster: a dark frame with one tiny mark warns', opts, async () => {
  const f = join(root, `po${n++}.mp4`);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x202020:s=320x180:r=30:d=3', '-vf', 'drawbox=x=150:y=85:w=8:h=8:color=white:t=fill,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', f]);
  const p = proj({ duration: 3 });
  const { report } = await run(p, f);
  const c = check(report, 'poster');
  assert.equal(c.status, 'warn', JSON.stringify(c));
  assert.match(c.message, /weak thumbnail/);
  assert.ok(existsSync(join(p, '.cve', 'poster.png')));
});

// ---- numbers ----
test('extractNumbers normalises separators, percent, dates and times', () => {
  const keys = (s) => extractNumbers(s).map((x) => x.key);
  assert.deepEqual(keys('1.200 / 1,200 / 1200'), ['1200', '1200', '1200']);
  assert.deepEqual(keys('4.8 ve 4,8 ve %50 ve 50%'), ['4.8', '4.8', '50', '50']);
  assert.deepEqual(keys('1.234,56 and 1,234.56'), ['1234.56', '1234.56']);
  assert.deepEqual(keys('YAYINDA 07.10.2026'), ['7', '10', '2026']);
  assert.deepEqual(keys("18:00 40°58'N"), ['18', '0', '40', '58']);
});

function numbersProject(html, brief, composition) {
  const p = join(root, `n${n++}`);
  mkdirSync(join(p, 'compositions'), { recursive: true });
  writeFileSync(join(p, 'index.html'), html);
  if (composition) writeFileSync(join(p, 'compositions', 's1.html'), composition);
  if (brief !== null) writeFileSync(join(p, 'BRIEF.md'), brief);
  return p;
}

test('numbers: skipped without BRIEF.md', () => {
  assert.equal(checkNumbers({ project: numbersProject('<p>5</p>', null) }).status, 'skipped');
});

test('numbers: only visible text counts; scripts, styles, attributes and data-* are ignored', () => {
  const html = '<head><title>v9</title><style>.a{width:100px}</style></head><body><script>var x = 999;</script>'
    + '<div data-start="77" style="top:12px" class="w3"><span>4,8</span> puan <b>%50</b> 1.200 kullanıcı <!-- 555 --></div></body>';
  const p = numbersProject(html, '# Brief\n1. Puan 4.8, yüzde 50, 1200 kullanıcı.\n');
  const r = checkNumbers({ project: p });
  assert.equal(r.status, 'pass', r.message);
  assert.equal(r.data.onScreen, 3);
});

test('numbers: an on-screen number missing from the brief warns, with its file; years are not ignored', () => {
  const p = numbersProject('<p>4,8 puan</p>', 'Puan 4.8.\n', '<template><div>Since 2019, 12 000 users and 75%</div></template>');
  const r = checkNumbers({ project: p });
  assert.equal(r.status, 'warn');
  assert.match(r.message, /2019 \(compositions\/s1\.html\)/);
  assert.match(r.message, /75/);
  assert.equal(r.data.notInBrief.length, 4); // 2019, 12, 0 (from "000"), 75
});

test('numbers: a year that is in the brief is accepted', () => {
  const p = numbersProject('<p>Since 2019</p>', 'Founded in 2019.\n');
  assert.equal(checkNumbers({ project: p }).status, 'pass');
});

test('numbers runs in the report', opts, async () => {
  const p = numbersProject('<div id="root" data-composition-id="main" data-duration="6">Fiyat 99</div>', 'Fiyat yok.\n');
  const { report } = await run(p, clip6());
  assert.equal(check(report, 'numbers').status, 'warn');
});

// ---- loudness short-term cap ----
test('sparse loud tone breaches the short-term cap', opts, async () => {
  const f = join(root, `l${n++}.mov`);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=10', '-f', 'lavfi',
    '-i', `aevalsrc='${10 ** (-3 / 20)}*sin(2*PI*880*t)*between(t,4,6.4)':s=48000:d=10`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-shortest', f]);
  const { report } = await run(proj({ duration: 10 }), f);
  const c = check(report, 'loudness');
  assert.equal(c.status, 'warn', JSON.stringify(c));
  assert.match(c.message, /short-term/);
  assert.equal(c.data.rule, 'sparse-true-peak');
  assert.ok(c.data.shortTermMax > -9);
});

// ---- critic frames ----
test('critic frames: one PNG per shot start, named NN-<time>s.png, listed in the report', opts, async () => {
  const p = proj();
  const f = join(root, `fr${n++}.mp4`);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', f]);
  const { report } = await run(p, f);
  const names = readdirSync(join(p, '.cve', 'frames')).sort();
  assert.ok(names.length >= 2 && names.length <= 16);
  assert.ok(names.every((x) => /^\d\d-[\d.]+s\.png$/.test(x)), names.join());
  assert.equal(report.frames.length, names.length);
  assert.equal((await probeMedia(report.frames[0])).width, 960);
  assert.equal(check(report, 'critic-frames').status, 'pass');
  assert.ok(existsSync(report.contactSheet));
});

test('critic frames: cuts become frames at their shot start', opts, async () => {
  const p = proj();
  const { report } = await run(p, cutClip(join(root, `c${n++}.mp4`), [1.5, 3, 4.5], 6));
  const times = report.layers.mp4.checks.find((c) => c.id === 'critic-frames').data.times;
  for (const t of [0.2, 1.6, 3.1, 4.6, 5]) assert.ok(times.some((x) => Math.abs(x - t) < 0.06), `${t} in ${times}`);
});

test('pickFrameTimes caps at 16, keeps the first and last, fills in when there are few cuts', () => {
  const many = pickFrameTimes(Array.from({ length: 40 }, (_, i) => 1 + i), 60);
  assert.equal(many.length, 16);
  assert.equal(many[0], 0.2);
  assert.equal(many[15], 59);
  const few = pickFrameTimes([], 24);
  assert.ok(few.length >= 6);
  assert.equal(few[0], 0.2);
});

// ---- moments ----
test('pickMoments: at most 5, hook first, loudest cue, most change, flagged cut, end card', () => {
  const m = pickMoments({
    duration: 24, cuts: [5, 10, 15, 20], energy: [0, 1, 9, 2, 0], endHoldStart: 21,
    soundCues: [{ start: 3, volume: 0.5, src: 'a.mp3' }, { start: 7, volume: 1.5, src: 'b.mp3' }],
    score: null, offGrid: [15, 10], loudAt: null,
  });
  assert.ok(m.length <= 5);
  assert.deepEqual(m.map((x) => x.t), [0, 2, 7, 15, 21]);
  assert.match(m[0].why, /hook/);
  assert.match(m[2].why, /loudest sound cue \(b\.mp3/);
  assert.match(m[3].why, /off the beat/);
  assert.match(m[4].why, /end card/);
});

test('pickMoments: falls back to score.json, then to the loudest passage; merges moments within 1 s', () => {
  const base = { duration: 20, cuts: [], energy: null, soundCues: [], endHoldStart: null, offGrid: [] };
  const a = pickMoments({ ...base, score: { cues: [{ kind: 'tick', time: 2 }, { kind: 'impact', time: 8 }] }, loudAt: 5 });
  assert.ok(a.some((x) => x.t === 8 && /impact/.test(x.why)));
  const b = pickMoments({ ...base, score: null, loudAt: 5 });
  assert.ok(b.some((x) => x.t === 5 && /loudest passage/.test(x.why)));
  const c = pickMoments({ ...base, score: null, loudAt: 0.4 });
  assert.equal(c.filter((x) => x.t < 1).length, 1);
  assert.equal(c.at(-1).t, 18); // no cuts, no hold: end card is the last 2 s
});

test('report carries moments and the human output has a MOMENTS block', opts, async () => {
  const p = proj();
  const orig = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = (c, ...r) => { if (typeof c === 'string') { out += c; return true; } return orig(c, ...r); };
  try { await runVerify([p, '--mp4', clip6(), '--no-hf-check']); } finally { process.stdout.write = orig; }
  assert.match(out, /^MOMENTS /m);
  assert.match(out, /hook: the first 2 s/);
  const { report } = await run(p, clip6());
  assert.ok(report.moments.length >= 2 && report.moments.length <= 5);
  assert.equal(report.moments[0].t, 0);
  assert.ok(report.moments.every((x) => typeof x.why === 'string' && x.why));
});

test('numbers: 0.500 is a decimal, not 500', async () => {
  const { extractNumbers } = await import('../src/verify/extra.mjs');
  assert.deepEqual(extractNumbers('0.500 1.200 4,8').map((x) => x.key), ['0.5', '1200', '4.8']);
});

test('numbers: script-written text is not reported as checked', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');
  const { checkNumbers } = await import('../src/verify/extra.mjs');
  const d = mkdtempSync(j(tmpdir(), 'cve-num-'));
  writeFileSync(j(d, 'BRIEF.md'), 'Rating 4.8');
  writeFileSync(j(d, 'index.html'), '<div>4,8</div><script>document.querySelector("#n").textContent = "99";</script>');
  const r = checkNumbers({ project: d });
  assert.equal(r.status, 'warn');
  assert.match(r.message, /scripts/);
});

// ---- empty-area / subject-scale ----
test('empty-area and subject-scale: a small box on a flat background warns, a full-frame picture passes', opts, async () => {
  const small = join(root, `s${n++}.mp4`);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x203040:s=320x180:r=30:d=8', '-vf', 'drawbox=x=100:y=10:w=100:h=70:color=white:t=fill,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', small]);
  const a = check((await run(proj({ duration: 8 }), small)).report, 'empty-area');
  assert.equal(a.status, 'warn', JSON.stringify(a));
  assert.match(a.message, /% of the height is an empty band at the bottom/);
  assert.ok(a.data.height.share > 0.5);
  const sc = check((await run(proj({ duration: 8 }), small)).report, 'subject-scale');
  assert.equal(sc.status, 'warn', JSON.stringify(sc));
  assert.ok(sc.data.medianCoverage < 0.2);

  const full = join(root, `f${n++}.mp4`);
  makeClip(full, { duration: 8, audio: false });
  const rep = (await run(proj({ duration: 8 }), full)).report;
  assert.equal(check(rep, 'empty-area').status, 'pass', JSON.stringify(check(rep, 'empty-area')));
  assert.equal(check(rep, 'subject-scale').status, 'pass', JSON.stringify(check(rep, 'subject-scale')));
});

test('empty-area: the last 5 s (end card) are not measured', opts, async () => {
  const file = join(root, `e${n++}.mp4`);
  const a = ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'color=c=0x203040:s=320x180:r=30:d=6'];
  ffmpeg([...a, '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', file]);
  const c = check((await run(proj({ duration: 10 }), file)).report, 'empty-area');
  assert.equal(c.status, 'pass', JSON.stringify(c));
  assert.equal(c.data.frames, 50);
});

// ---- on-beat from shots.json ----
/** Flat background, a white box that jumps to a new place at each time in `jumps` (a phone-sized change). */
function boxClip(file, jumps, duration) {
  const b = [0, ...jumps, duration];
  const draws = b.slice(0, -1).map((t, i) => `drawbox=x=${20 + i * 80}:y=40:w=70:h=70:color=white:t=fill:enable='between(t,${t},${b[i + 1] - 0.0001})'`);
  ffmpeg(['-f', 'lavfi', '-i', `color=c=0x203040:s=320x180:r=30:d=${duration}`, '-vf', `${draws.join(',')},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'ultrafast', file]);
  return file;
}
const shotsJson = (starts) => JSON.stringify({ shots: starts.map((start) => ({ start })) });

test('on-beat: without detected cuts the shots.json boundaries are checked on the grid and for a visual change', opts, async () => {
  const p = proj();
  writeFileSync(join(p, 'cues.json'), JSON.stringify({ bpm: 120, duration: 6 }));
  writeFileSync(join(p, 'shots.json'), shotsJson([0, 2, 4]));
  const flat = join(root, `fl${n++}.mp4`);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x203040:s=320x180:r=30:d=6', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', flat]);
  const still = check((await run(p, flat)).report, 'on-beat');
  assert.equal(still.status, 'warn', JSON.stringify(still));
  assert.match(still.message, /2 of 2 declared shot boundary\(ies\) show no visual change.*: 2s, 4s/);
  assert.deepEqual(still.data.offGrid, []);

  const moving = check((await run(p, boxClip(join(root, `bx${n++}.mp4`), [2, 4], 6))).report, 'on-beat');
  assert.equal(moving.status, 'pass', JSON.stringify(moving));
  assert.ok(moving.data.shotChange.every((x) => x.diff >= 1));
});

test('on-beat: a declared boundary 3 frames off the grid warns; no cues, no cuts and no shots still skips', opts, async () => {
  const p = proj();
  writeFileSync(join(p, 'cues.json'), JSON.stringify({ bpm: 120, duration: 6 }));
  writeFileSync(join(p, 'shots.json'), shotsJson([0, 2.1]));
  const c = check((await run(p, boxClip(join(root, `bx${n++}.mp4`), [2.1], 6))).report, 'on-beat');
  assert.equal(c.status, 'warn', JSON.stringify(c));
  assert.match(c.message, /2\.1s/);
  assert.deepEqual(c.data.offGrid, [2.1]);

  const q = proj();
  writeFileSync(join(q, 'cues.json'), JSON.stringify({ bpm: 120, duration: 6 }));
  const flat = join(root, `fl${n++}.mp4`);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x203040:s=320x180:r=30:d=6', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', flat]);
  assert.equal(check((await run(q, flat)).report, 'on-beat').status, 'skipped');
});

// ---- SOUND list ----
test('soundCues: a scored project lists each scored cue instead of the track', async () => {
  const { listSoundCues } = await import('../src/verify/project.mjs');
  const d = proj();
  writeFileSync(join(d, 'index.html'), '<audio id="music" src="assets/music/track.wav" data-start="0" data-duration="6"></audio><audio src="assets/sfx/pop.wav" data-start="1" data-volume="0.5"></audio>');
  mkdirSync(join(d, 'assets', 'music'), { recursive: true });
  writeFileSync(join(d, 'assets', 'music', 'score.json'), JSON.stringify({ bpm: 120, cues: [{ kind: 'cut', beat: 4, time: 2 }, { kind: 'end', beat: 8, time: 4 }] }));
  const cues = listSoundCues(d, null);
  assert.deepEqual(cues.map((c) => [c.start, c.kind ?? null, c.beat ?? null]), [[1, null, null], [2, 'cut', 4], [4, 'end', 8]]);
  assert.ok(!cues.some((c) => c.src.endsWith('track.wav')));
});
