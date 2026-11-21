import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, haveFfmpeg, ffmpeg } from './helpers.mjs';
import { smoothTrack } from '../catalog/tool/subject-track/files/subject-track.mjs';

const root = new URL('../', import.meta.url).pathname;
const ST = join(root, 'catalog/tool/subject-track/files/subject-track.mjs');
const SH = join(root, 'catalog/recipe/shorts-from-long/files/shorts.mjs');
const env = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` };
const node = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
const skip = { skip: !haveFfmpeg && 'ffmpeg not installed' };

const W = 640, H = 360, AMP = 180, PERIOD = 10;
const truthCx = (t) => (W / 2 + AMP * Math.sin((2 * Math.PI * t) / PERIOD)) / W;

/** Static textured background, a person (body 180x200 + head 60x70, light grey) swinging sideways; head centre = body centre. */
function makePerson(file, { duration = 12, person = true } = {}) {
  const px = `(W-w)/2+${AMP}*sin(2*PI*t/${PERIOD})`;
  const fc = person
    ? `[0:v]drawgrid=w=40:h=40:t=1:c=0x506070@0.6[bg];[1:v]format=yuv420p[body];[2:v]format=yuv420p[head];[bg][body]overlay=x='${px}':y=150:eval=frame[a];[a][head]overlay=x='${px}':y=80:eval=frame[v]`
    : `[0:v]drawgrid=w=40:h=40:t=1:c=0x506070@0.6[v]`;
  const inputs = ['-f', 'lavfi', '-i', `color=c=0x303840:s=${W}x${H}:r=30:d=${duration}`];
  if (person) inputs.push('-f', 'lavfi', '-i', `color=c=0xd8d8d8:s=180x200:r=30:d=${duration}`, '-f', 'lavfi', '-i', `color=c=0xd0d0d0:s=60x70:r=30:d=${duration}`);
  ffmpeg([...inputs, '-filter_complex', fc, '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', file]);
}

test('subject-track follows a swinging subject within 4 % of the width, and the track is smooth', skip, () => {
  const d = tmp(); const v = join(d, 'p.mp4'); makePerson(v);
  const out = join(d, 'track.json');
  const r = node(ST, ['--video', v, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const t = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(t.fps, 10);
  assert.ok(t.frames.length >= 115);
  const errs = t.frames.filter((f) => f.t >= 1).map((f) => Math.abs(f.cx - truthCx(f.t)));
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length, max = Math.max(...errs);
  console.log(`# synthetic accuracy: mean |cx error| ${(mean * 100).toFixed(2)} % of width, max ${(max * 100).toFixed(2)} %`);
  assert.ok(mean < 0.04, `mean error ${mean}`);
  assert.ok(max < 0.08, `max error ${max}`);
  // smooth: speed within the cap, and no jitter (second difference small)
  const c = t.frames.map((f) => f.cx);
  for (let i = 1; i < c.length; i++) assert.ok(Math.abs(c[i] - c[i - 1]) <= 0.25 * 0.1 + 1e-3, `step ${i}`);
  for (let i = 2; i < c.length; i++) assert.ok(Math.abs(c[i] - 2 * c[i - 1] + c[i - 2]) < 0.01, `jitter at ${i}`);
  // head extent: the head box starts at y 80/360 and the body at 150/360; the head top is found near the head
  const ft = t.frames.filter((f) => f.t >= 1);
  const top = ft.reduce((a, f) => a + f.head_top, 0) / ft.length;
  assert.ok(Math.abs(top - 80 / H) < 0.08, `head_top ${top}`);
  for (const f of t.frames) { assert.ok(f.head_bottom > f.head_top); assert.ok(f.cx >= 0 && f.cx <= 1); }
});

test('subject-track never invents a subject: an empty scene exits 1 with a centre line', skip, () => {
  const d = tmp(); const v = join(d, 'e.mp4'); makePerson(v, { duration: 4, person: false });
  const out = join(d, 'track.json');
  const r = node(ST, ['--video', v, '--out', out]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /no frame had a detection/);
  const t = JSON.parse(readFileSync(out, 'utf8'));
  assert.ok(t.frames.every((f) => f.cx === 0.5 && f.source === 'centre' && f.confidence === 0));
});

test('smoothTrack: speed limit, deadband, hold then centre', () => {
  const mk = (cx) => ({ cx, top: 0.2, bottom: 0.4, confidence: 1, source: 'blob' });
  // a jump of 0.4 is crossed no faster than max-pan
  const jump = smoothTrack([...Array(10).fill(0.3), ...Array(40).fill(0.7)].map(mk), 10, { maxPan: 0.25 });
  for (let i = 1; i < jump.length; i++) assert.ok(Math.abs(jump[i].cx - jump[i - 1].cx) <= 0.25 * 0.1 + 1e-9);
  assert.ok(Math.abs(jump.at(-1).cx - 0.7) < 0.05);
  // jitter inside the deadband does not move the track
  const still = smoothTrack(Array.from({ length: 40 }, (_, i) => mk(0.5 + (i % 2 ? 0.01 : -0.01))), 10, { deadband: 0.025 });
  assert.ok(Math.max(...still.map((s) => s.cx)) - Math.min(...still.map((s) => s.cx)) < 1e-6);
  // detection lost: hold the last good value for `hold` s, then ease to the centre
  const raw = [...Array(10).fill(0.8).map(mk), ...Array(80).fill(null)];
  const lost = smoothTrack(raw, 10, { hold: 3 });
  assert.equal(lost[20].source, 'hold');
  assert.ok(Math.abs(lost[20].cx - 0.8) < 0.02);
  assert.equal(lost[85].source, 'centre');
  assert.ok(Math.abs(lost[89].cx - 0.5) < 0.08, `ended at ${lost[89].cx}`);
  // low-confidence frames are not trusted
  const weak = smoothTrack([...Array(10).fill(0.8).map(mk), ...Array(10).fill(0.1).map((c) => ({ ...mk(c), confidence: 0.2 }))], 10);
  assert.ok(weak[15].cx > 0.7);
});

/** x centre (0..1) of the bright pixels in a frame of the Short at time t. */
function brightCx(file, t) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=108:192,format=gray', '-f', 'rawvideo', '-'], { env, maxBuffer: 1 << 24 });
  assert.equal(r.status, 0);
  const b = r.stdout; let sx = 0, n = 0;
  for (let i = 0; i < b.length; i++) if (b[i] > 150) { sx += i % 108; n++; }
  return n > 20 ? sx / n / 108 : null;
}

test('shorts cut --track keeps the moving subject in the middle of the 9:16 crop; --face-x loses it; safe-text.json is written', skip, () => {
  const d = tmp(); const v = join(d, 'p.mp4'); makePerson(v, { duration: 10 });
  const wf = join(d, 'w.json'); writeFileSync(wf, JSON.stringify({ words: [] }));
  const tr = join(d, 'track.json');
  assert.equal(node(ST, ['--video', v, '--out', tr]).status, 0);
  const fixed = join(d, 'fix.mp4'), trk = join(d, 'trk.mp4');
  assert.equal(node(SH, ['cut', '--video', v, '--words', wf, '--start', '0', '--end', '9', '--face-x', '0.5', '--out', fixed]).status, 0);
  const r = node(SH, ['cut', '--video', v, '--words', wf, '--start', '0', '--end', '9', '--track', tr, '--out', trk]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /tracked/);
  const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', trk], { encoding: 'utf8', env }).stdout).streams[0];
  assert.deepEqual([probe.width, probe.height], [1080, 1920]);
  let worstTracked = 0, worstFixed = 0;
  for (const t of [1, 2.5, 4, 5.5, 7, 8.5]) {
    const a = brightCx(trk, t), f = brightCx(fixed, t);
    assert.ok(a !== null, `no subject in the tracked frame at ${t}`);
    worstTracked = Math.max(worstTracked, Math.abs(a - 0.5)); if (f !== null) worstFixed = Math.max(worstFixed, Math.abs(f - 0.5)); else worstFixed = 0.5;
  }
  console.log(`# worst offset of the subject from the window centre: tracked ${(worstTracked * 100).toFixed(1)} %, fixed ${(worstFixed * 100).toFixed(1)} % of the window width`);
  assert.ok(worstTracked < 0.12, `tracked off by ${worstTracked}`);
  assert.ok(worstFixed > 0.3, 'the fixed crop was expected to lose the subject');
  const sf = join(d, 'trk.safe-text.json');
  assert.ok(existsSync(sf));
  const s = JSON.parse(readFileSync(sf, 'utf8'));
  assert.ok(s.band === 'bottom' || s.band === 'top');
  assert.ok(s.y_min < s.y_max && s.y_max <= 1920 - 420 && s.x_max === 1080 - 130 && s.y_min >= 270 - 1);
  assert.match(r.stdout, /--band y=\d+/);
  assert.ok(!existsSync(join(d, 'fix.safe-text.json')));
});

test('shorts cut --track refuses a track that does not cover the segment', skip, () => {
  const d = tmp(); const v = join(d, 'p.mp4'); makePerson(v, { duration: 6 });
  const wf = join(d, 'w.json'); writeFileSync(wf, JSON.stringify({ words: [] }));
  const tr = join(d, 'track.json');
  assert.equal(node(ST, ['--video', v, '--out', tr, '--end', '3']).status, 0);
  const r = node(SH, ['cut', '--video', v, '--words', wf, '--start', '0', '--end', '5', '--track', tr, '--out', join(d, 'o.mp4')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /track covers/);
});
