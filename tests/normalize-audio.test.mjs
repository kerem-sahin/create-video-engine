import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, haveFfmpeg } from './helpers.mjs';

const root = new URL('../', import.meta.url).pathname;
const part = (rel) => join(root, 'catalog', rel);
const env = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` };
const node = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', env }); assert.equal(r.status, 0, r.stderr); };
const probe = (f) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f], { encoding: 'utf8', env }).stdout);
const skip = { skip: !haveFfmpeg && 'ffmpeg not installed' };
const NORMALIZE = part('tool/transcribe-local/files/normalize.mjs');
const CUT = part('tool/silence-cut/files/silence-cut.mjs');
const dir = tmp('norm-audio-');

// 8 s mono 44.1 kHz: 2 s tone, 3 s silence, 3 s tone
const src = join(dir, 'pod.m4a');
let made = false;
function prepare() {
  if (made) return;
  ff(['-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100:duration=2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=44100:duration=3',
    '-filter_complex', '[1:a]atrim=duration=3[s];[0:a][s][2:a]concat=n=3:v=0:a=1', '-ac', '1', '-c:a', 'aac', src]);
  made = true;
}

test('normalize: audio-only m4a -> m4a, 48 kHz, mono stays mono, measured report', skip, () => {
  prepare();
  const out = join(dir, 'work.m4a');
  const r = node(NORMALIZE, [src, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const rep = JSON.parse(readFileSync(out + '.normalize.json', 'utf8'));
  assert.equal(rep.mode, 'audio');
  assert.deepEqual(rep.problems, []);
  assert.equal(rep.result.sample_rate, 48000);
  assert.equal(rep.result.channels, 1);
  assert.equal(rep.result.video_streams, 0);
  assert.ok(Math.abs(rep.result.start_time) < 0.02);
  assert.ok(Math.abs(rep.result.duration - 8) < 0.06);
  assert.ok(typeof rep.result.lufs === 'number' && rep.result.lufs < 0 && rep.result.lufs > -60);
  assert.equal(probe(out).streams.filter((s) => s.codec_type === 'video').length, 0);
});

test('normalize: --out .wav gives PCM, --out .mp4 gives an audio-only mp4 with no picture', skip, () => {
  prepare();
  const wav = join(dir, 'work.wav'), mp4 = join(dir, 'work.mp4');
  assert.equal(node(NORMALIZE, [src, '--out', wav]).status, 0);
  assert.equal(probe(wav).streams[0].codec_name, 'pcm_s16le');
  const r = node(NORMALIZE, [src, '--out', mp4]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no picture/);
  const p = probe(mp4);
  assert.deepEqual(p.streams.map((s) => s.codec_type), ['audio']);
  assert.equal(node(NORMALIZE, [src, '--out', join(dir, 'x.mp3')]).status, 64);
});

test('normalize: a late-starting audio track is padded so the first sample is at 0', skip, () => {
  prepare();
  const late = join(dir, 'late.m4a'), out = join(dir, 'late-work.wav');
  ff(['-itsoffset', '1', '-i', src, '-c:a', 'aac', '-t', '4', late]);
  const sstart = parseFloat(probe(late).streams[0].start_time);
  const r = node(NORMALIZE, [late, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const rep = JSON.parse(readFileSync(out + '.normalize.json', 'utf8'));
  assert.ok(Math.abs(rep.result.start_time) < 0.02);
  assert.ok(Math.abs(rep.result.duration - (sstart + parseFloat(probe(late).streams[0].duration))) < 0.06, JSON.stringify(rep));
  assert.deepEqual(rep.problems, []);
});

test('silence-cut works on audio-only input: sample-accurate wav, retimed words', skip, () => {
  prepare();
  const wav = join(dir, 'cut-in.wav');
  assert.equal(node(NORMALIZE, [src, '--out', wav]).status, 0);
  const words = join(dir, 'cut-in.words.json');
  writeFileSync(words, JSON.stringify({ language: 'en', words: [{ w: 'one', start: 0.2, end: 1.8 }, { w: 'two', start: 5.2, end: 7.8 }] }));
  const edl = join(dir, 'edl.json'), cut = join(dir, 'cut.wav');
  let r = node(CUT, ['plan', '--video', wav, '--words', words, '--out', edl]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(readFileSync(edl, 'utf8')).fps, null);
  r = node(CUT, ['apply', '--edl', edl, '--out', cut]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const info = probe(cut);
  assert.equal(info.streams[0].codec_name, 'pcm_s16le');
  assert.equal(info.streams.length, 1);
  const w = JSON.parse(readFileSync(join(dir, 'cut.words.json'), 'utf8'));
  assert.equal(w.words.length, 2);
  assert.ok(parseFloat(info.format.duration) < 7, 'the 3 s pause was shortened');
  assert.ok(w.words[1].start > w.words[0].end && w.words[1].end <= parseFloat(info.format.duration) + 0.001);
});
