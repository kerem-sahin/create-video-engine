import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpeg, haveFfmpeg, tmp } from './helpers.mjs';
import { probeMedia } from '../src/verify/util.mjs';

const CLI = new URL('../bin/cli.mjs', import.meta.url).pathname;
const env = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` };
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', env });
const skip = haveFfmpeg ? false : 'ffmpeg not installed';

// 400x800 canvas: solid background, caption "text" bars on top, a noisy "app screen" at (50,200) 300x560.
// `frame` wraps the screen in a black device slab with a light outline.
function makeStore(file, { bg = '0x203040', frame = false, withScreen = true } = {}) {
  const parts = ['[0][1]overlay=50:200[a]'];
  let last = 'a';
  if (frame) {
    parts.unshift('[0]drawbox=x=34:y=184:w=332:h=592:color=0xC8C8C8:t=fill,drawbox=x=36:y=186:w=328:h=588:color=black:t=fill[s]', '[s][1]overlay=50:200[a]');
    parts.splice(2, 1);
  }
  parts.push(`[${last}]drawbox=x=60:y=50:w=280:h=14:color=white:t=fill,drawbox=x=90:y=90:w=220:h=14:color=white:t=fill[o]`);
  ffmpeg(['-f', 'lavfi', '-i', `color=c=${bg}:s=400x800:d=1`, '-f', 'lavfi', '-i', 'color=c=gray:s=300x560:d=1,noise=alls=70:allf=t+u',
    '-filter_complex', withScreen ? parts.join(';') : `[0]drawbox=x=60:y=50:w=280:h=14:color=white:t=fill[o]`, '-map', '[o]', '-frames:v', '1', file]);
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const jsonRun = (...a) => { const r = cli(...a, '--json'); return { ...r, j: r.stdout ? JSON.parse(r.stdout) : null }; };

test('crop --auto finds a flat screen under a caption band', { skip }, () => {
  const d = tmp(); const img = join(d, 's.png'); makeStore(img);
  const r = jsonRun('crop', img, '--auto', '--out', join(d, 'o.png'));
  assert.equal(r.status, 0, r.stderr);
  const { x, y, w, h } = r.j.rect;
  near(x, 50, 3, 'x'); near(y, 200, 3, 'y'); near(w, 300, 4, 'w'); near(h, 560, 4, 'h');
  assert.ok(existsSync(join(d, 'o.png')));
});

test('crop --auto works on a light background too', { skip }, () => {
  const d = tmp(); const img = join(d, 's.png'); makeStore(img, { bg: '0xF2EFE8' });
  const r = jsonRun('crop', img, '--auto', '--out', join(d, 'o.png'));
  assert.equal(r.status, 0, r.stderr);
  near(r.j.rect.x, 50, 3, 'x'); near(r.j.rect.y, 200, 3, 'y'); near(r.j.rect.w, 300, 4, 'w'); near(r.j.rect.h, 560, 4, 'h');
});

test('crop --auto removes a device frame as well', { skip }, async () => {
  const d = tmp(); const img = join(d, 's.png'); makeStore(img, { frame: true });
  const out = join(d, 'o.png');
  const r = jsonRun('crop', img, '--auto', '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const { x, y, w, h } = r.j.rect;
  near(x, 50, 5, 'x'); near(y, 200, 5, 'y'); near(w, 300, 10, 'w'); near(h, 560, 10, 'h');
  const p = await probeMedia(out);
  assert.equal(p.width, w); assert.equal(p.height, h);
});

test('crop --auto leaves full-bleed UI unchanged and says so', { skip }, async () => {
  const d = tmp(); const img = join(d, 'full.png');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=gray:s=400x800:d=1,noise=alls=70:allf=t+u', '-frames:v', '1', img]);
  const out = join(d, 'o.png');
  const r = cli('crop', img, '--auto', '--out', out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /unchanged/);
  const p = await probeMedia(out);
  assert.equal(p.width, 400); assert.equal(p.height, 800);
});

test('crop --auto exits 1 when it finds nothing confident', { skip }, () => {
  const d = tmp(); const img = join(d, 'blank.png');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x203040:s=400x800:d=1', '-frames:v', '1', img]);
  const r = cli('crop', img, '--auto', '--out', join(d, 'o.png'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no confident/);
  assert.ok(!existsSync(join(d, 'o.png')));
});

test('crop --rect and --status-bar', { skip }, async () => {
  const d = tmp(); const img = join(d, 's.png'); makeStore(img);
  let r = jsonRun('crop', img, '--rect', '50,200,300,560', '--out', join(d, 'a.png'));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.j.rect, { x: 50, y: 200, w: 300, h: 560 });
  r = jsonRun('crop', img, '--rect', '50,200,300,560', '--status-bar', '--out', join(d, 'b.png'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.j.rect.y, 239); // 7% of 560 = 39 px
  assert.equal(r.j.rect.h, 521);
  const p = await probeMedia(join(d, 'b.png'));
  assert.equal(p.height, 521);
});

test('crop usage and input errors', { skip }, () => {
  const d = tmp(); const img = join(d, 's.png'); makeStore(img);
  assert.equal(cli('crop').status, 64);
  assert.equal(cli('crop', img, '--out', join(d, 'o.png')).status, 64); // nothing to do
  assert.equal(cli('crop', img, '--auto', '--rect', '0,0,10,10', '--out', join(d, 'o.png')).status, 64);
  assert.equal(cli('crop', img, '--rect', '0,0,999,10', '--out', join(d, 'o.png')).status, 64); // outside the image
  assert.equal(cli('crop', img, '--rect', 'a,b', '--out', join(d, 'o.png')).status, 64);
  assert.equal(cli('crop', join(d, 'missing.png'), '--auto', '--out', join(d, 'o.png')).status, 2);
});
