import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reusable, stripHtml, creditLine, pickReusable, politeFetch, readLibrary, addToLibrary, parseArgs, main, isWholeImage } from '../catalog/tool/draw-from-photo/files/draw-from-photo.mjs';

test('only CC0, public domain and CC BY photos may be reused', () => {
  for (const ok of ['CC0', 'Public domain', 'PDM', 'CC BY 2.0', 'CC BY 3.0', 'CC BY 4.0', 'CC-BY-4.0', 'PD-self', 'CC BY 3.0 de', 'CC BY 2.5 ca', 'CC BY 4.0 International']) assert.ok(reusable(ok), ok);
  for (const no of ['CC BY-SA 2.0', 'CC BY-SA 4.0', 'CC BY-NC 2.0', 'CC BY-ND 2.0', 'GFDL', '', null, 'Copyrighted free use', 'All rights reserved', 'CC BY-NC-SA 3.0', 'CC BY-SA 3.0 de', 'Attribution', 'No restrictions']) assert.ok(!reusable(no), String(no));
});

const API = { query: { pages: {
  1: { index: 2, title: 'File:Car SA.jpg', imageinfo: [{ thumburl: 'https://x.test/sa.jpg', descriptionurl: 'https://c.test/sa', width: 2000, height: 900, extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
  2: { index: 1, title: 'File:Car side.jpg', imageinfo: [{ thumburl: 'https://x.test/side.jpg', descriptionurl: 'https://c.test/side', width: 2400, height: 900, extmetadata: { LicenseShortName: { value: 'CC BY 3.0' }, Artist: { value: '<a href="x">Ana &amp; Ben</a>' } } }] },
  3: { index: 3, title: 'File:Tiny.png', imageinfo: [{ thumburl: 'https://x.test/t.png', descriptionurl: 'https://c.test/t', width: 300, height: 200, extmetadata: { LicenseShortName: { value: 'CC0' } } }] },
  4: { index: 4, title: 'File:Old car.jpeg', imageinfo: [{ thumburl: 'https://x.test/old.jpg', descriptionurl: 'https://c.test/old', width: 1800, height: 1200, extmetadata: { LicenseShortName: { value: 'Public domain' } } }] },
} } };

test('search answer: reusable, big enough, in search order, with the artist as text', () => {
  const r = pickReusable(API);
  assert.deepEqual(r.map((x) => x.title), ['Car side', 'Old car']);
  assert.equal(r[0].artist, 'Ana & Ben');
  assert.equal(stripHtml('<b>a</b>&quot;b&quot;'), 'a "b"');
  assert.equal(creditLine({ title: 'Car side', artist: 'Ana & Ben', licence: 'CC BY 3.0', page: 'https://c.test/side' }), '- [image] "Car side" by Ana & Ben | licence: CC BY 3.0 | source: https://c.test/side | drawn from the photo');
});

test('politeFetch waits and retries when asked to slow down', async () => {
  const waits = []; let n = 0;
  const fetchFn = async () => (++n < 3 ? { status: 429, headers: { get: (h) => (h === 'retry-after' ? (n === 1 ? '2' : null) : null) } } : { status: 200, ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
  const r = await politeFetch('https://x.test', { fetchFn, wait: async (ms) => { waits.push(ms); } });
  assert.equal(r.status, 200);
  assert.deepEqual([...r.body], [1, 2]);
  assert.deepEqual(waits, [2000, 10000]);
  let m = 0; const flaky = async () => { if (++m === 1) throw new Error('reset'); return { status: 200, ok: true, json: async () => ({ a: 1 }) }; };
  assert.deepEqual((await politeFetch('https://x.test', { fetchFn: flaky, read: 'json', wait: async () => {} })).body, { a: 1 });
  const stall = async (u, { signal }) => ({ status: 200, ok: true, arrayBuffer: () => new Promise((_, no) => signal.addEventListener('abort', () => no(new Error('aborted')))) });
  await assert.rejects(politeFetch('https://x.test', { fetchFn: stall, tries: 1, limitMs: 20 }), /aborted/);
  n = -10; const gaveUp = await politeFetch('https://x.test', { fetchFn, tries: 2, wait: async () => {} });
  assert.equal(gaveUp.status, 429);
});

test('find writes previews and credits, skipping what may not be reused', async () => {
  const d = mkdtempSync(join(tmpdir(), 'dfp-'));
  writeFileSync(join(d, '9.jpg'), 'old'); writeFileSync(join(d, 'mine.txt'), 'keep');
  const img = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(5000, 7), Buffer.from([0xff, 0xd9])]);
  const fetchFn = async (url) => (url.includes('api.php') ? { status: 200, ok: true, json: async () => API } : { status: 200, ok: true, arrayBuffer: async () => img });
  const code = await main(['find', 'car side', '--out', d, '--fast'], { fetch: fetchFn });
  assert.equal(code, 0);
  const c = JSON.parse(readFileSync(join(d, 'candidates.json'), 'utf8'));
  assert.deepEqual(c.candidates.map((x) => [x.k, x.title, x.licence]), [[1, 'Car side', 'CC BY 3.0'], [2, 'Old car', 'Public domain']]);
  assert.ok(existsSync(join(d, '1.jpg')) && existsSync(join(d, '2.jpg')));
  assert.ok(!existsSync(join(d, '9.jpg')), 'an older search\'s photo is cleared');
  assert.ok(existsSync(join(d, 'mine.txt')));
  assert.ok(!isWholeImage(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(100)])));
});

test('find says so when nothing may be reused, and when the search fails', async () => {
  const d = mkdtempSync(join(tmpdir(), 'dfp-'));
  const none = async () => ({ status: 200, ok: true, json: async () => ({ query: { pages: { 1: API.query.pages[1] } } }) });
  assert.equal(await main(['find', 'car', '--out', d, '--fast'], { fetch: none }), 1);
  const down = async () => { throw new Error('offline'); };
  assert.equal(await main(['find', 'car', '--out', d, '--fast'], { fetch: down, wait: async () => {} }), 2);
  assert.equal(await main(['find', 'car', '--out', d, '--n', '40'], { fetch: none }), 64);
});

test('ink refuses bad options before doing anything', async () => {
  assert.equal(await main(['ink', 'x.jpg']), 64);
  assert.equal(await main(['ink', 'x.jpg', '--out', 'o.png', '--detail', 'max']), 64);
  assert.equal(await main(['ink', 'x.jpg', '--out', 'o.png', '--width', '9']), 64);
  assert.equal(await main(['ink', 'x.jpg', '--out', 'o.png', '--library', 'lib', '--name', 'Bad Name', '--what', 'a car']), 64);
  const d = mkdtempSync(join(tmpdir(), 'dfp-'));
  writeFileSync(join(d, 'candidates.json'), JSON.stringify({ candidates: [{ k: 1, file: join(d, '1.jpg') }] }));
  assert.equal(await main(['ink', join(d, 'candidates.json'), '--pick', '5', '--out', join(d, 'o.png')]), 64);
  assert.equal(await main(['ink', join(d, 'candidates.json'), '--pick', '1', '--out', join(d, 'o.png')]), 64, 'a found photo needs --credits');
  writeFileSync(join(d, 'empty.json'), '{}');
  assert.equal(await main(['ink', join(d, 'empty.json'), '--pick', '1', '--out', join(d, 'o.png')]), 2);
  assert.equal(await main(['ink', 'x.jpg', '--out', 'o.png', '--library', '--name', 'a', '--what', 'b']), 64);
  assert.deepEqual(parseArgs(['ink', 'a', '--flip', '--out', 'o']), { _: ['ink', 'a'], flip: true, out: 'o' });
});

test('library keeps one entry per name, never approved on its own, and keeps where it was used', () => {
  let lib = { items: [] };
  lib = addToLibrary(lib, { name: 'porsche-911', what: 'side' });
  lib.items[0].approved = true; lib.items[0].used_in = ['clip-1'];
  assert.throws(() => addToLibrary(lib, { name: 'porsche-911', what: 'again' }), /approved drawing/);
  lib = addToLibrary(lib, { name: 'porsche-911', what: 'side, redrawn' }, { replace: true });
  assert.equal(lib.items.length, 1);
  assert.deepEqual([lib.items[0].what, lib.items[0].approved, lib.items[0].used_in], ['side, redrawn', false, ['clip-1']]);
  const d = mkdtempSync(join(tmpdir(), 'dfp-'));
  assert.deepEqual(readLibrary(join(d, 'none.json')), { items: [] });
  writeFileSync(join(d, 'bad.json'), '{oops');
  assert.throws(() => readLibrary(join(d, 'bad.json')), /not a library list/);
});

test('ink draws a photo on macOS', { skip: process.platform !== 'darwin' && 'macOS only' }, async () => {
  // a plain grey box on white is enough for Vision to find a subject; if it finds none the tool says so with exit 1
  const d = mkdtempSync(join(tmpdir(), 'dfp-'));
  const { spawnSync } = await import('node:child_process');
  const photo = join(d, 'p.png');
  const mk = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=800x500', '-vf', 'drawbox=x=150:y=150:w=500:h=220:color=0x334455:t=fill', '-frames:v', '1', photo]);
  if (mk.status !== 0) return;
  const code = await main(['ink', photo, '--out', join(d, 'o.png'), '--width', '400']);
  assert.ok(code === 0 || code === 1, `exit ${code}`);
  if (code === 0) assert.ok(existsSync(join(d, 'o.png')));
});
