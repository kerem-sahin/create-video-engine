import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runRefs } from '../src/refs/index.mjs';
import { ffmpeg, haveFfmpeg, tmp } from './helpers.mjs';

const opts = { skip: !haveFfmpeg && 'ffmpeg not installed' };

test('usage errors exit 64', async () => {
  assert.equal(await runRefs([]), 64);
  assert.equal(await runRefs(['x.mp4']), 64);
});

test('URL without yt-dlp exits 2', opts, async () => {
  const saved = process.env.PATH;
  process.env.PATH = '/nonexistent-dir';
  try {
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    let code;
    try { code = await runRefs(['https://example.com/v', '--out', tmp()]); } finally { process.stderr.write = orig; }
    // toolEnv appends homebrew paths; only assert when yt-dlp is genuinely absent
    const { which } = await import('../src/verify/util.mjs');
    if (!which('yt-dlp')) assert.equal(code, 2);
  } finally { process.env.PATH = saved; }
});

test('three hard cuts are found within 0.1 s; outputs exist', opts, async () => {
  const d = tmp();
  const src = join(d, 'cuts.mp4');
  // 4 segments x 2 s: different colours and patterns -> cuts at 2, 4, 6
  const inp = (spec) => ['-f', 'lavfi', '-t', '2', '-i', spec];
  ffmpeg([
    ...inp('color=c=red:size=320x180:rate=30'),
    ...inp('testsrc2=size=320x180:rate=30'),
    ...inp('color=c=blue:size=320x180:rate=30'),
    ...inp('mandelbrot=size=320x180:rate=30'),
    '-filter_complex', '[0][1][2][3]concat=n=4:v=1:a=0,format=yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', src,
  ]);
  const out = join(d, 'out');
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c, ...r) => (typeof c === 'string' ? true : orig(c, ...r));
  let code;
  try { code = await runRefs([src, '--out', out, '--json']); } finally { process.stdout.write = orig; }
  assert.equal(code, 0);
  const a = JSON.parse(readFileSync(join(out, 'analysis.json'), 'utf8'));
  assert.equal(a.cuts.length, 3, JSON.stringify(a.cuts));
  [2, 4, 6].forEach((t, i) => assert.ok(Math.abs(a.cuts[i] - t) <= 0.1, `cut ${i}: ${a.cuts[i]}`));
  assert.equal(a.shots.length, 4);
  assert.equal(a.params.scene_threshold > 0, true);
  assert.equal(a.palette.length, 6);
  assert.equal(a.motion_energy.length, 8);
  assert.ok(existsSync(join(out, 'contact-sheet.png')));
  assert.equal(readdirSync(join(out, 'frames')).length, 16);
  const g = readFileSync(join(out, 'GRAMMAR.md'), 'utf8');
  assert.match(g, /Not measured \(needs a human eye\)/);
  assert.match(g, /3 at 2s, 4s, 6s|Cuts found: 3/);
});
