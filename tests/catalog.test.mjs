import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCatalog, validateCard, validateLane } from '../src/catalog/validate.mjs';
import { builtinCard, goodCard, goodLane, makeCatalog, writeCard } from './catalog-fixture.mjs';

const CLI = new URL('../bin/cli.mjs', import.meta.url).pathname;
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });

function dirOf(card, opts) {
  const cat = makeCatalog({ cards: [], lanes: [] });
  return { cat, dir: writeCard(cat, card, opts) };
}
const errsOf = (card, opts, ctx) => { const { dir } = dirOf(card, opts); return validateCard(card, dir, ctx); };
const cardsMap = (...cs) => new Map(cs.map((c) => [c.id, c]));

test('a complete schema 2 card is valid, and so is the catalog around it', () => {
  assert.deepEqual(errsOf(goodCard()), []);
  const cat = makeCatalog();
  assert.equal(checkCatalog(cat).ok, true);
});

test('a schema 1 card is reported as needing migration', () => {
  const old = goodCard(); delete old.schema; old.files = ['part.txt'];
  assert.deepEqual(errsOf(old), ['schema: this is a schema 1 card; migrate it to schema 2 (see catalog/README.md)']);
});

test('missing fields are reported by name', () => {
  const c = goodCard(); delete c.when_to_use; delete c.verified_with; delete c.builtin; c.lanes = [];
  const errs = errsOf(c);
  for (const f of ['when_to_use', 'verified_with', 'builtin', 'lanes']) assert.ok(errs.some((e) => e.startsWith(f)), f);
});

test('kind enum includes recipe, style and hf-block; unknown kinds fail', () => {
  for (const k of ['scene', 'motion', 'check', 'sound', 'tool', 'recipe', 'style']) assert.deepEqual(errsOf(goodCard({ kind: k }), { kind: 'tool' }), [], k);
  assert.ok(errsOf(goodCard({ kind: 'widget' }), { kind: 'tool' }).some((e) => e.startsWith('kind')));
  const hf = goodCard({ kind: 'hf-block', source: { repo: 'heygen/hyperframes', url: 'https://example.com', ref: null, licence: 'Apache-2.0', how: 'registry' }, registry: '@hyperframes/flowchart', files: [], docs: null });
  assert.deepEqual(errsOf(hf, { kind: 'hf-block' }), []);
});

test('licence rules: non-commercial or missing licence is link-only with no files', () => {
  for (const licence of ['PolyForm-Noncommercial', 'CC-BY-NC-4.0']) {
    assert.ok(errsOf(goodCard({ source: { ...goodCard().source, licence } })).some((e) => /non-commercial/.test(e)), licence);
    const link = goodCard({ source: { repo: 'x', url: 'https://example.com', licence, how: 'link-only' }, files: [], docs: null, attribution: null });
    assert.deepEqual(errsOf(link), [], licence);
    const withFiles = goodCard({ source: { repo: 'x', url: 'https://example.com', licence, how: 'link-only' } });
    assert.ok(errsOf(withFiles).some((e) => /link-only part must have no files/.test(e)));
  }
  const noLicence = goodCard(); delete noLicence.source.licence;
  assert.ok(errsOf(noLicence).some((e) => /source.licence: required/.test(e)));
  const gpl = goodCard(); gpl.source.licence = 'GPL-3.0';
  assert.ok(errsOf(gpl).some((e) => e.startsWith('source.licence')));
  const noLicLink = goodCard({ source: { repo: 'x', url: 'https://example.com', how: 'link-only' }, files: [], docs: null, attribution: null });
  assert.deepEqual(errsOf(noLicLink), []);
});

test('copied needs ref, attribution and files/LICENSE; registry needs a name, no files', () => {
  const c = goodCard(); c.source.ref = null; c.attribution = null;
  const errs = errsOf(c);
  assert.ok(errs.some((e) => e.startsWith('source.ref')));
  assert.ok(errs.some((e) => e.startsWith('attribution')));
  assert.ok(errsOf(goodCard(), { license: false }).some((e) => e.startsWith('files/LICENSE')));
  const reg = goodCard({ source: { repo: 'h', url: 'https://example.com', licence: 'Apache-2.0', how: 'registry' }, registry: null });
  const e2 = errsOf(reg);
  assert.ok(e2.some((e) => e.startsWith('registry')));
  assert.ok(e2.some((e) => /registry part must have no files/.test(e)));
});

test('files: from must exist inside the card, to must be under parts/<id>/', () => {
  const bad = (files) => errsOf(goodCard({ files }), { bare: true, files: { 'files/a.txt': 'a', 'files/LICENSE': 'x', 'files/README.md': 'x' } });
  assert.ok(bad([{ from: 'files/missing.txt', to: 'parts/demo-part/a.txt' }]).some((e) => /does not exist/.test(e)));
  assert.ok(bad([{ from: '../outside.txt', to: 'parts/demo-part/a.txt' }]).some((e) => /inside the card folder/.test(e)));
  assert.ok(bad([{ from: '/etc/passwd', to: 'parts/demo-part/a.txt' }]).some((e) => /inside the card folder/.test(e)));
  assert.ok(bad([{ from: 'files/a.txt', to: 'other/a.txt' }]).some((e) => /under parts\/demo-part\//.test(e)));
  assert.ok(bad([{ from: 'files/a.txt', to: 'parts/demo-part/../evil.txt' }]).some((e) => /under parts/.test(e)));
  assert.ok(bad(['files/a.txt']).some((e) => /\{"from"/.test(e)));
  assert.ok(bad([]).some((e) => /must list its files/.test(e)));
  assert.deepEqual(bad([{ from: 'files/a.txt', to: 'parts/demo-part/a.txt' }]), []);
});

test('builtin parts have no files and must be own code', () => {
  assert.deepEqual(errsOf(builtinCard('own-cmd')), []);
  assert.ok(errsOf(builtinCard('own-cmd', { files: [{ from: 'files/x', to: 'parts/own-cmd/x' }] })).some((e) => /builtin part must have no files/.test(e)));
  const copied = builtinCard('own-cmd'); copied.source.how = 'copied';
  assert.ok(errsOf(copied).some((e) => /only an "own code" part can be builtin/.test(e)));
});

test('requires must exist; paid_api shape and free fallback are checked', () => {
  const a = goodCard({ id: 'a-part', requires: ['ghost'] });
  assert.ok(errsOf(a, {}, { cards: cardsMap(a) }).some((e) => /"ghost" is not in the catalog/.test(e)));
  const free = goodCard({ id: 'free-part' });
  const paid = goodCard({ id: 'paid-part', paid_api: { service: 'X', env: 'X_KEY', free_fallback: 'free-part', sends: 'audio' } });
  assert.deepEqual(errsOf(paid, {}, { cards: cardsMap(paid, free) }), []);
  assert.ok(errsOf(paid, {}, { cards: cardsMap(paid) }).some((e) => /free_fallback.*not in the catalog/.test(e)));
  const shape = goodCard({ paid_api: { service: 'X', env: 'lower' } });
  const se = errsOf(shape);
  assert.ok(se.some((e) => e.startsWith('paid_api.free_fallback')));
  assert.ok(se.some((e) => e.startsWith('paid_api.env')));
  const paid2 = goodCard({ id: 'paid2', paid_api: { service: 'X', env: 'X_KEY', free_fallback: 'paid-part', sends: 'audio' } });
  assert.ok(errsOf(paid2, {}, { cards: cardsMap(paid2, paid) }).some((e) => /itself a paid part/.test(e)));
});

test('require cycles and folder mismatches are caught by checkCatalog', () => {
  const cat = makeCatalog({ cards: [goodCard({ id: 'a-part', requires: ['b-part'] }), goodCard({ id: 'b-part', requires: ['a-part'] })], lanes: [goodLane({ parts: ['a-part'] })] });
  const r = checkCatalog(cat);
  assert.equal(r.ok, false);
  assert.ok(r.results.some((x) => x.errors.some((e) => /cycle/.test(e))));
  const cat2 = makeCatalog({ cards: [], lanes: [goodLane({ parts: [] })] });
  writeCard(cat2, goodCard(), { kind: 'sound' });
  const r2 = checkCatalog(cat2);
  assert.ok(r2.results[0].errors.some((e) => e.startsWith('kind')));
});

test('a card naming a lane with no lane folder is invalid', () => {
  const cat = makeCatalog({ cards: [goodCard({ lanes: ['nowhere'] })], lanes: [] });
  assert.ok(checkCatalog(cat).results[0].errors.some((e) => /no catalog\/lanes\/nowhere/.test(e)));
});

test('lane validation: parts exist, recipe file exists', () => {
  const cards = cardsMap(goodCard());
  const cat = makeCatalog({ cards: [goodCard()], lanes: [] });
  const dir = join(cat, 'lanes', 'demo-lane');
  mkdirSync(dir, { recursive: true });
  assert.deepEqual(validateLane(goodLane(), dir, {}).filter((e) => !e.startsWith('recipe')), []);
  assert.ok(validateLane(goodLane(), dir, { cards }).some((e) => /recipe.*does not exist/.test(e)));
  writeFileSync(join(dir, 'recipe.md'), 'recipe pending\n');
  assert.deepEqual(validateLane(goodLane(), dir, { cards }), []);
  assert.ok(validateLane(goodLane({ parts: ['ghost'] }), dir, { cards }).some((e) => /"ghost" is not in the catalog/.test(e)));
  assert.ok(validateLane(goodLane({ recipe: '../x.md' }), dir, { cards }).some((e) => e.startsWith('recipe')));
  assert.deepEqual(validateLane(goodLane({ parts: [] }), dir, { cards }), []);
  rmSync(join(dir, 'recipe.md'));
  assert.ok(validateLane(goodLane(), dir, { cards }).some((e) => /recipe/.test(e)));
});

test('shipped catalog is valid, lanes exist, and list shows the parts', () => {
  const c = cli('catalog', 'check');
  assert.equal(c.status, 0, c.stdout + c.stderr);
  const l = cli('catalog', 'list');
  assert.equal(l.status, 0);
  for (const id of ['music-scorer', 'openverse-source', 'refs-analyzer', 'mp4-checks', 'onetake-continuity', 'cve-motion']) assert.match(l.stdout, new RegExp(id));
  const pl = JSON.parse(cli('catalog', 'list', '--lane', 'product-launch', '--json').stdout).parts.map((p) => p.id);
  for (const id of ['screenshot-crop', 'cve-motion', 'music-scorer', 'mp4-checks']) assert.ok(pl.includes(id), id);
  const th = JSON.parse(cli('catalog', 'list', '--lane', 'social-photo', '--json').stdout).parts.map((p) => p.id);
  assert.ok(th.includes('cve-motion') && !th.includes('screenshot-crop'));
  const all = JSON.parse(cli('catalog', 'list', '--json').stdout);
  const tl = all.lanes.find((x) => x.id === 'talking-head');
  assert.ok(tl && tl.ask && tl.title && tl.for && Array.isArray(tl.parts) && tl.parts.includes('captions'));
  assert.match(l.stdout, /ask: Do you record yourself/);
  assert.ok(l.stdout.indexOf('talking-head') < l.stdout.indexOf('music-scorer'));
  assert.equal(cli('catalog', 'list', '--lane', 'nope').status, 1);
  assert.equal(cli('catalog', 'list', '--lane').status, 64);
});

test('catalog check exits 1 on invalid cards, 64 on bad usage, 2 on a missing dir', () => {
  const c = goodCard(); c.source.licence = 'CC-BY-NC-4.0';
  const cat = makeCatalog({ cards: [c] });
  const r = cli('catalog', 'check', '--dir', cat);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /non-commercial/);
  assert.equal(cli('catalog').status, 64);
  assert.equal(cli('catalog', 'bogus').status, 64);
  assert.equal(cli('catalog', 'check', '--dir', join(cat, 'missing')).status, 2);
});
