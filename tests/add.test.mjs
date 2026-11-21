import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp } from './helpers.mjs';
import { builtinCard, goodCard, goodLane, makeCatalog } from './catalog-fixture.mjs';

const CLI = new URL('../bin/cli.mjs', import.meta.url).pathname;
const cli = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts });
const rd = (p) => readFileSync(p, 'utf8');
const rec = (studio) => JSON.parse(rd(join(studio, 'studio.json')));

const newStudio = () => {
  const dir = join(tmp('cve-add-'), 'studio');
  const r = cli(['init', dir, '--no-install']);
  assert.equal(r.status, 0, r.stderr);
  return dir;
};
const add = (studio, cat, target, ...extra) => cli(['add', target, '--studio', studio, '--catalog', cat, ...extra]);
const remove = (studio, cat, target, ...extra) => cli(['remove', target, '--studio', studio, '--catalog', cat, ...extra]);

test('add copies files, docs, NOTICE and records the part', () => {
  const cat = makeCatalog(); const s = newStudio();
  const r = add(s, cat, 'demo-part');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /added demo-part/);
  assert.match(r.stdout, /usage note/);
  assert.ok(rd(join(s, 'parts/demo-part/demo.txt')).startsWith('content of demo-part'));
  assert.ok(existsSync(join(s, 'parts/demo-part/README.md')));
  assert.match(rd(join(s, 'NOTICE.md')), /- demo-part: adapted from owner\/demo \(MIT\)/);
  const st = rec(s);
  assert.equal(st.schema, 2);
  assert.equal(st.parts.length, 1);
  assert.equal(st.parts[0].id, 'demo-part');
  assert.equal(st.parts[0].source, 'owner/demo@abc123');
  assert.match(st.parts[0].hash, /^[0-9a-f]{64}$/);
  assert.match(st.parts[0].files['parts/demo-part/demo.txt'], /^[0-9a-f]{64}$/);
  assert.match(st.parts[0].added, /^\d{4}-\d{2}-\d{2}$/);
});

test('add is idempotent: no change, NOTICE has the line once', () => {
  const cat = makeCatalog(); const s = newStudio();
  add(s, cat, 'demo-part');
  const before = rd(join(s, 'studio.json'));
  const r = add(s, cat, 'demo-part');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /already installed/);
  assert.equal(rd(join(s, 'studio.json')), before);
  assert.equal(rd(join(s, 'NOTICE.md')).split('adapted from owner/demo').length - 1, 1);
});

test('add never overwrites a changed file (exit 1, names the file) or a foreign one', () => {
  const cat = makeCatalog(); const s = newStudio();
  add(s, cat, 'demo-part');
  writeFileSync(join(s, 'parts/demo-part/demo.txt'), 'my edit');
  const r = add(s, cat, 'demo-part');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /parts\/demo-part\/demo\.txt/);
  assert.equal(rd(join(s, 'parts/demo-part/demo.txt')), 'my edit');
  const s2 = newStudio();
  mkdirSync(join(s2, 'parts/demo-part'), { recursive: true });
  writeFileSync(join(s2, 'parts/demo-part/demo.txt'), 'foreign');
  assert.equal(add(s2, cat, 'demo-part').status, 1);
  assert.equal(rd(join(s2, 'parts/demo-part/demo.txt')), 'foreign');
  assert.deepEqual(rec(s2).parts, []);
});

test('requires are installed first; builtin parts are only recorded', () => {
  const cat = makeCatalog({
    cards: [goodCard({ id: 'top-part', requires: ['base-part', 'cmd-part'] }), goodCard({ id: 'base-part', attribution: 'base-part: from owner/base (MIT)' }), builtinCard('cmd-part')],
    lanes: [goodLane({ parts: ['top-part'] })],
  });
  const s = newStudio();
  const r = add(s, cat, 'top-part', '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.installed, ['base-part', 'cmd-part', 'top-part']);
  assert.ok(existsSync(join(s, 'parts/base-part/demo.txt')));
  assert.equal(existsSync(join(s, 'parts/cmd-part')), false);
  const st = rec(s);
  assert.deepEqual(st.parts.map((p) => p.id), ['base-part', 'cmd-part', 'top-part']);
  assert.equal(st.parts[1].hash, null);
  assert.equal(st.parts[1].source, 'own');
});

test('link-only parts are refused with their link (exit 1)', () => {
  const link = goodCard({ id: 'link-part', source: { repo: 'x', url: 'https://example.com/x', licence: 'PolyForm-Noncommercial', how: 'link-only' }, files: [], docs: null, attribution: null });
  const cat = makeCatalog({ cards: [link], lanes: [goodLane({ parts: [] })] });
  const s = newStudio();
  const r = add(s, cat, 'link-part');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /link-only.*https:\/\/example\.com\/x/);
  assert.deepEqual(rec(s).parts, []);
});

const paidCatalog = () => makeCatalog({
  cards: [
    goodCard({ id: 'free-part' }),
    goodCard({ id: 'paid-part', paid_api: { service: 'ElevenLabs', env: 'EL_KEY', free_fallback: 'free-part', sends: 'the audio track' } }),
  ],
  lanes: [goodLane({ parts: ['paid-part'] })],
});

test('a paid part is refused without --paid and names the free fallback', () => {
  const cat = paidCatalog(); const s = newStudio();
  const r = add(s, cat, 'paid-part');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /paid service.*ElevenLabs.*free fallback: free-part/);
  assert.equal(existsSync(join(s, 'parts')), false);
  assert.equal(add(s, cat, 'lane:demo-lane').status, 1, 'a lane with a paid part is refused too');
  assert.equal(add(s, cat, 'free-part').status, 0, 'the free fallback alone installs');
});

test('--paid and studio paid:true install the paid part with its free fallback', () => {
  const cat = paidCatalog(); const s = newStudio();
  const r = add(s, cat, 'paid-part', '--paid');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(rec(s).parts.map((p) => p.id), ['free-part', 'paid-part']);
  const s2 = newStudio();
  const st = rec(s2); st.paid = true; writeFileSync(join(s2, 'studio.json'), JSON.stringify(st));
  assert.equal(add(s2, cat, 'paid-part').status, 0);
  assert.ok(existsSync(join(s2, 'parts/free-part/demo.txt')));
});

test('lane:<id> installs its parts and the recipe in both skill folders', () => {
  const cat = makeCatalog({ cards: [goodCard(), builtinCard('cmd-part')], lanes: [goodLane({ parts: ['demo-part', 'cmd-part'] })] });
  const s = newStudio();
  const r = add(s, cat, 'lane:demo-lane');
  assert.equal(r.status, 0, r.stderr);
  for (const p of ['skills/make/lanes/demo-lane.md', '.claude/skills/make/lanes/demo-lane.md']) assert.equal(rd(join(s, p)), 'recipe text\n');
  const st = rec(s);
  assert.deepEqual(st.lanes, ['demo-lane']);
  assert.deepEqual(st.parts.map((p) => p.id).sort(), ['cmd-part', 'demo-part']);
  const again = add(s, cat, 'lane:demo-lane');
  assert.equal(again.status, 0);
  assert.deepEqual(rec(s).lanes, ['demo-lane']);
  writeFileSync(join(s, 'skills/make/lanes/demo-lane.md'), 'my recipe');
  assert.equal(add(s, cat, 'lane:demo-lane').status, 1);
  assert.equal(rd(join(s, 'skills/make/lanes/demo-lane.md')), 'my recipe');
});

test('an empty lane still records the lane and recipe', () => {
  const cat = makeCatalog({ cards: [goodCard()], lanes: [goodLane({ parts: [] })] });
  const s = newStudio();
  assert.equal(add(s, cat, 'lane:demo-lane').status, 0);
  assert.deepEqual(rec(s).lanes, ['demo-lane']);
  assert.ok(existsSync(join(s, '.claude/skills/make/lanes/demo-lane.md')));
});

test('--dry-run writes nothing; --json is parseable', () => {
  const cat = makeCatalog(); const s = newStudio();
  const before = rd(join(s, 'studio.json'));
  const r = add(s, cat, 'lane:demo-lane', '--dry-run', '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true); assert.equal(j.dryRun, true); assert.deepEqual(j.installed, ['demo-part']);
  assert.equal(existsSync(join(s, 'parts')), false);
  assert.equal(existsSync(join(s, 'NOTICE.md')), false);
  assert.equal(rd(join(s, 'studio.json')), before);
});

test('--studio defaults to the nearest parent with studio.json', () => {
  const cat = makeCatalog(); const s = newStudio();
  mkdirSync(join(s, 'brands/x'), { recursive: true });
  const r = cli(['add', 'demo-part', '--catalog', cat], { cwd: join(s, 'brands/x') });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(s, 'parts/demo-part/demo.txt')));
  const none = cli(['add', 'demo-part', '--catalog', cat], { cwd: tmp() });
  assert.equal(none.status, 2);
});

test('exit codes: unknown part 1, bad usage 64', () => {
  const cat = makeCatalog(); const s = newStudio();
  assert.equal(add(s, cat, 'ghost').status, 1);
  assert.equal(add(s, cat, 'lane:ghost').status, 1);
  assert.equal(cli(['add']).status, 64);
  assert.equal(cli(['add', 'x', '--bogus']).status, 64);
  assert.equal(cli(['add', 'Bad_Id']).status, 64);
  assert.equal(cli(['remove']).status, 64);
  assert.equal(cli(['remove', 'x', '--paid']).status, 64);
});

test('a schema 1 studio.json is upgraded on the first add', () => {
  const cat = makeCatalog(); const s = newStudio();
  writeFileSync(join(s, 'studio.json'), JSON.stringify({ schema: 1, engine: 'x', hyperframes: '0.9.67', brands: [] }));
  assert.equal(add(s, cat, 'demo-part').status, 0);
  const st = rec(s);
  assert.equal(st.schema, 2); assert.deepEqual(st.brands, []); assert.equal(st.paid, false);
});

test('a missing system tool is a warning, not a failure', () => {
  const cat = makeCatalog({ cards: [goodCard({ needs: ['definitely-not-a-tool'] })] });
  const s = newStudio();
  const r = add(s, cat, 'demo-part');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /needs definitely-not-a-tool/);
});

test('a needed tool in <studio>/node_modules/.bin is found', () => {
  const cat = makeCatalog({ cards: [goodCard({ needs: ['cve-local-tool'] })] });
  const s = newStudio();
  assert.match(add(s, cat, 'demo-part', '--dry-run').stdout, /needs cve-local-tool/);
  mkdirSync(join(s, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(s, 'node_modules', '.bin', 'cve-local-tool'), '#!/bin/sh\n', { mode: 0o755 });
  assert.doesNotMatch(add(s, cat, 'demo-part').stdout, /needs cve-local-tool/);
});

test('remove deletes unchanged files, the record and the NOTICE line', () => {
  const cat = makeCatalog(); const s = newStudio();
  add(s, cat, 'demo-part');
  const r = remove(s, cat, 'demo-part');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(s, 'parts/demo-part')), false);
  assert.deepEqual(rec(s).parts, []);
  assert.doesNotMatch(rd(join(s, 'NOTICE.md')), /demo-part/);
  assert.equal(remove(s, cat, 'demo-part').status, 1, 'not installed');
});

test('remove refuses a changed or extended part, and a part another part requires', () => {
  const cat = makeCatalog({
    cards: [goodCard({ id: 'top-part', requires: ['base-part'] }), goodCard({ id: 'base-part' })],
    lanes: [goodLane({ parts: ['top-part'] })],
  });
  const s = newStudio();
  add(s, cat, 'top-part');
  const r = remove(s, cat, 'base-part');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /required by top-part/);
  writeFileSync(join(s, 'parts/top-part/demo.txt'), 'mine');
  const c = remove(s, cat, 'top-part');
  assert.equal(c.status, 1);
  assert.match(c.stderr, /parts\/top-part\/demo\.txt was changed/);
  assert.ok(existsSync(join(s, 'parts/top-part/demo.txt')));
  writeFileSync(join(s, 'parts/top-part/demo.txt'), 'content of top-part/files/demo.txt\n');
  writeFileSync(join(s, 'parts/top-part/extra.txt'), 'new');
  const e = remove(s, cat, 'top-part');
  assert.equal(e.status, 1);
  assert.match(e.stderr, /extra\.txt was added/);
  assert.equal(rec(s).parts.length, 2);
});

test('remove lane deletes the recipe and only parts no other lane or part needs', () => {
  const cat = makeCatalog({
    cards: [goodCard({ id: 'solo-part', lanes: ['lane-a'] }), goodCard({ id: 'shared-part', lanes: ['lane-a', 'lane-b'] }), goodCard({ id: 'other-part', lanes: ['lane-b'] })],
    lanes: [goodLane({ id: 'lane-a', parts: ['solo-part', 'shared-part'] }), goodLane({ id: 'lane-b', parts: ['shared-part', 'other-part'] })],
  });
  const s = newStudio();
  assert.equal(add(s, cat, 'lane:lane-a').status, 0);
  assert.equal(add(s, cat, 'lane:lane-b').status, 0);
  const r = remove(s, cat, 'lane:lane-a');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(s, 'parts/solo-part')), false);
  assert.ok(existsSync(join(s, 'parts/shared-part/demo.txt')));
  assert.equal(existsSync(join(s, 'skills/make/lanes/lane-a.md')), false);
  assert.equal(existsSync(join(s, '.claude/skills/make/lanes/lane-a.md')), false);
  assert.ok(existsSync(join(s, 'skills/make/lanes/lane-b.md')));
  const st = rec(s);
  assert.deepEqual(st.lanes, ['lane-b']);
  assert.deepEqual(st.parts.map((p) => p.id).sort(), ['other-part', 'shared-part']);
  assert.equal(remove(s, cat, 'lane:lane-b').status, 0);
  assert.deepEqual(rec(s).parts, []);
  assert.equal(remove(s, cat, 'lane:lane-b').status, 1);
});

test('remove lane keeps a part that a standalone installed part requires, and refuses an edited recipe', () => {
  const cat = makeCatalog({
    cards: [goodCard({ id: 'base-part' }), goodCard({ id: 'user-part', requires: ['base-part'], lanes: ['lane-b'] })],
    lanes: [goodLane({ id: 'demo-lane', parts: ['base-part'] }), goodLane({ id: 'lane-b', parts: [] })],
  });
  const s = newStudio();
  add(s, cat, 'user-part'); add(s, cat, 'lane:demo-lane');
  writeFileSync(join(s, 'skills/make/lanes/demo-lane.md'), 'edited');
  assert.equal(remove(s, cat, 'lane:demo-lane').status, 1);
  writeFileSync(join(s, 'skills/make/lanes/demo-lane.md'), 'recipe text\n');
  const r = remove(s, cat, 'lane:demo-lane');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(s, 'parts/base-part/demo.txt')));
  assert.match(r.stdout, /kept base-part/);
});

test('registry parts are recorded with a next step; no files, attribution noted', () => {
  const reg = goodCard({ id: 'flow-block', kind: 'hf-block', source: { repo: 'heygen/hyperframes', url: 'https://example.com', licence: 'Apache-2.0', how: 'registry' }, registry: '@hyperframes/flowchart', files: [], docs: null, attribution: 'flow-block: HyperFrames registry block (Apache-2.0)' });
  const cat = makeCatalog({ cards: [reg], lanes: [goodLane({ parts: [] })] });
  const s = newStudio();
  const r = add(s, cat, 'flow-block');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /npx hyperframes add @hyperframes\/flowchart/);
  assert.match(rd(join(s, 'NOTICE.md')), /flow-block/);
});

test('the shipped catalog installs into a fresh studio: cve-motion lands in parts/cve-motion', () => {
  const s = newStudio();
  const r = cli(['add', 'lane:product-launch', '--studio', s]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(s, 'parts/cve-motion/cve-motion.js')));
  assert.ok(existsSync(join(s, 'parts/cve-motion/README.md')));
  assert.deepEqual(rec(s).lanes, ['product-launch']);
  assert.equal(cli(['add', 'onetake-continuity', '--studio', s]).status, 1);
  assert.equal(cli(['remove', 'lane:product-launch', '--studio', s]).status, 0);
  assert.equal(existsSync(join(s, 'parts/cve-motion')), false);
});

test('add refuses to write through a symlinked parts/<id> and leaves the target untouched', () => {
  const cat = makeCatalog(); const s = newStudio();
  const outside = join(tmp('cve-out-'), 'out'); mkdirSync(outside);
  mkdirSync(join(s, 'parts'), { recursive: true });
  symlinkSync(outside, join(s, 'parts/demo-part'));
  const r = add(s, cat, 'demo-part');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /symlink/);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(rec(s).parts.length, 0);
});

test('add refuses a symlinked parts/ and a symlinked destination file', () => {
  const cat = makeCatalog(); const s = newStudio();
  const outside = tmp('cve-out-');
  symlinkSync(outside, join(s, 'parts'));
  let r = add(s, cat, 'demo-part');
  assert.equal(r.status, 1); assert.match(r.stderr, /symlink/);
  assert.deepEqual(readdirSync(outside), []);
  const s2 = newStudio();
  mkdirSync(join(s2, 'parts/demo-part'), { recursive: true });
  const target = join(outside, 'victim.txt'); writeFileSync(target, 'keep');
  symlinkSync(target, join(s2, 'parts/demo-part/demo.txt'));
  r = add(s2, cat, 'demo-part');
  assert.equal(r.status, 1); assert.match(r.stderr, /symlink/);
  assert.equal(rd(target), 'keep');
});

test('remove refuses to delete through a symlinked parts/<id>', () => {
  const cat = makeCatalog(); const s = newStudio();
  add(s, cat, 'demo-part');
  const outside = tmp('cve-out-'); writeFileSync(join(outside, 'demo.txt'), 'x');
  const real = join(s, 'parts/demo-part');
  const moved = join(tmp('cve-mv-'), 'm');
  spawnSync('mv', [real, moved]);
  symlinkSync(outside, real);
  const r = remove(s, cat, 'demo-part');
  assert.equal(r.status, 1); assert.match(r.stderr, /symlink/);
  assert.ok(existsSync(join(outside, 'demo.txt')));
});

test('a directory where a file should be is a conflict (exit 1), not a crash', () => {
  const cat = makeCatalog(); const s = newStudio();
  mkdirSync(join(s, 'parts/demo-part/demo.txt'), { recursive: true });
  let r = add(s, cat, 'demo-part');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /parts\/demo-part\/demo\.txt/);
  assert.doesNotMatch(r.stderr, /EISDIR/);
  const cat2 = makeCatalog({ lanes: [goodLane()] }); const s2 = newStudio();
  mkdirSync(join(s2, 'skills/make/lanes/demo-lane.md'), { recursive: true });
  r = add(s2, cat2, 'lane:demo-lane');
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stderr, /EISDIR/);
});

test('studio.json is written atomically: no temp file is left behind', () => {
  const cat = makeCatalog(); const s = newStudio();
  add(s, cat, 'demo-part');
  assert.deepEqual(readdirSync(s).filter((f) => f.includes('.tmp')), []);
});
