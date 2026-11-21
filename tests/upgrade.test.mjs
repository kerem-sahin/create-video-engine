import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmp } from './helpers.mjs';
import { goodCard, goodLane, makeCatalog, writeCard, writeLane } from './catalog-fixture.mjs';

const CLI = new URL('../bin/cli.mjs', import.meta.url).pathname;
const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const rd = (p) => readFileSync(p, 'utf8');
const rec = (s) => JSON.parse(rd(join(s, 'studio.json')));
const save = (s, o) => writeFileSync(join(s, 'studio.json'), JSON.stringify(o, null, 2) + '\n');
const sha = (t) => createHash('sha256').update(t).digest('hex');
const newStudio = () => { const d = join(tmp('cve-up-'), 'studio'); assert.equal(cli(['init', d, '--no-install']).status, 0); return d; };
const up = (s, ...x) => cli(['upgrade', '--studio', s, ...x]);
const baks = (s, sub) => readdirSync(join(s, sub)).filter((f) => f.includes('.bak-'));
const SK = 'skills/make/SKILL.md';

test('init records skills_hash for both skill copies and the entry files', () => {
  const s = newStudio(); const h = rec(s).skills_hash;
  assert.equal(h[SK], sha(rd(join(s, SK))));
  assert.equal(h['.claude/skills/learn/SKILL.md'], sha(rd(join(s, '.claude/skills/learn/SKILL.md'))));
  assert.equal(h['AGENTS.md'], sha(rd(join(s, 'AGENTS.md'))));
});

test('upgrade on a current studio changes nothing but the engine', () => {
  const s = newStudio(); const o = rec(s); o.engine = 'create-video-engine@0.0.1'; save(s, o);
  const r = up(s);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 updated, 0 added, 0 backed up, 0 kept/);
  assert.match(rec(s).engine, /^create-video-engine@0\.1/);
  assert.equal(baks(s, 'skills/make').length, 0);
});

test('an old unedited skill (hash matches the record) is replaced without a backup', () => {
  const s = newStudio(); const o = rec(s);
  writeFileSync(join(s, SK), 'old text\n'); o.skills_hash[SK] = sha('old text\n'); save(s, o);
  const r = up(s, '--json'); const j = JSON.parse(r.stdout);
  assert.equal(r.status, 0);
  assert.ok(j.updated.includes(SK));
  assert.equal(j.backed_up.length, 0);
  assert.notEqual(rd(join(s, SK)), 'old text\n');
  assert.equal(rec(s).skills_hash[SK], sha(rd(join(s, SK))));
});

test('an edited skill is backed up next to it, then replaced; the report says so', () => {
  const s = newStudio(); const orig = rd(join(s, SK));
  writeFileSync(join(s, SK), 'my own notes\n');
  const r = up(s);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /backed up your edited copy.*skills\/make\/SKILL\.md -> skills\/make\/SKILL\.md\.bak-\d{4}-\d{2}-\d{2}/);
  const [b] = baks(s, 'skills/make');
  assert.equal(rd(join(s, 'skills/make', b)), 'my own notes\n');
  assert.equal(rd(join(s, SK)), orig);
  assert.equal(baks(s, '.claude/skills/make').length, 0);
});

test('without skills_hash: identical is current, different is backed up', () => {
  const s = newStudio(); const o = rec(s); delete o.skills_hash; save(s, o);
  writeFileSync(join(s, '.claude/skills/learn/SKILL.md'), 'changed\n');
  const r = up(s, '--json'); const j = JSON.parse(r.stdout);
  assert.deepEqual(j.backed_up.map((b) => b.file), ['.claude/skills/learn/SKILL.md']);
  assert.equal(j.updated.length, 0);
  assert.ok(rec(s).skills_hash[SK]);
});

test('--dry-run writes nothing', () => {
  const s = newStudio(); writeFileSync(join(s, SK), 'edited\n');
  const before = rd(join(s, 'studio.json'));
  const r = up(s, '--dry-run');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /would back up/);
  assert.equal(rd(join(s, SK)), 'edited\n');
  assert.equal(rd(join(s, 'studio.json')), before);
  assert.equal(baks(s, 'skills/make').length, 0);
});

test('CLAUDE.md that is not ours is kept; AGENTS.md edits are backed up', () => {
  const s = newStudio();
  writeFileSync(join(s, 'CLAUDE.md'), 'my own rules\n'); writeFileSync(join(s, 'AGENTS.md'), 'mine\n');
  const r = up(s);
  assert.equal(rd(join(s, 'CLAUDE.md')), 'my own rules\n');
  assert.match(r.stdout, /kept \(changed by you; not touched\): CLAUDE\.md/);
  assert.match(rd(join(s, 'AGENTS.md')), /Video studio/);
  assert.ok(readdirSync(s).some((f) => f.startsWith('AGENTS.md.bak-')));
  assert.match(rd(join(s, 'AGENTS.md')), /upgrade/);
});

test('lane recipes: updated from the catalog unless edited (then backed up)', () => {
  const cat = makeCatalog(); const s = newStudio();
  assert.equal(cli(['add', 'lane:demo-lane', '--studio', s, '--catalog', cat]).status, 0);
  const R = 'skills/make/lanes/demo-lane.md';
  writeLane(cat, goodLane(), 'recipe v2\n');
  let r = up(s, '--catalog', cat);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rd(join(s, R)), 'recipe v2\n');
  assert.equal(rd(join(s, '.claude/' + R)), 'recipe v2\n');
  assert.equal(rec(s).lane_recipes['demo-lane'], sha('recipe v2\n'));
  assert.equal(baks(s, 'skills/make/lanes').length, 0);
  writeFileSync(join(s, R), 'my tweak\n');
  writeLane(cat, goodLane(), 'recipe v3\n');
  r = up(s, '--catalog', cat);
  assert.equal(rd(join(s, R)), 'recipe v3\n');
  assert.equal(baks(s, 'skills/make/lanes').length, 1);
  assert.equal(baks(s, '.claude/skills/make/lanes').length, 0);
});

test('parts: changed catalog file updates an unchanged part; an edited part is kept and listed', () => {
  const cat = makeCatalog(); const s = newStudio();
  assert.equal(cli(['add', 'demo-part', '--studio', s, '--catalog', cat]).status, 0);
  const F = 'parts/demo-part/demo.txt';
  writeCard(cat, goodCard(), { files: { 'files/demo.txt': 'v2\n' } });
  const r = up(s, '--catalog', cat);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /updated: parts\/demo-part/);
  assert.equal(rd(join(s, F)), 'v2\n');
  assert.equal(rec(s).parts[0].files[F], sha('v2\n'));
  writeFileSync(join(s, F), 'mine\n');
  writeCard(cat, goodCard(), { files: { 'files/demo.txt': 'v3\n' } });
  const r2 = up(s, '--catalog', cat);
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /kept \(.*demo\.txt changed by you; not updated\): parts\/demo-part/);
  assert.equal(rd(join(s, F)), 'mine\n');
  assert.equal(rec(s).parts[0].files[F], sha('v2\n'));
});

test('a different HyperFrames pin is reported, never changed', () => {
  const s = newStudio();
  const p = JSON.parse(rd(join(s, 'package.json'))); p.devDependencies.hyperframes = '0.9.1';
  writeFileSync(join(s, 'package.json'), JSON.stringify(p, null, 2) + '\n');
  const before = rd(join(s, 'package.json')); const hf = rec(s).hyperframes;
  const r = up(s, '--json'); const j = JSON.parse(r.stdout);
  assert.equal(j.hyperframes.pinned, '0.9.1');
  assert.equal(rd(join(s, 'package.json')), before);
  assert.equal(rec(s).hyperframes, hf);
});

test('upgrade without a studio exits 2; bad option exits 64', () => {
  assert.equal(up(tmp('cve-empty-')).status, 2);
  assert.equal(cli(['upgrade', '--bogus']).status, 64);
});
