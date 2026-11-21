import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../bin/cli.mjs', import.meta.url).pathname;
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
const tmp = () => mkdtempSync(join(tmpdir(), 'cve-init-'));

test('init --no-install creates the studio tree', () => {
  const dir = join(tmp(), 'studio');
  const r = cli('init', dir, '--no-install', '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.installed, false);
  assert.ok(Array.isArray(j.skills) && Array.isArray(j.warnings));

  for (const f of ['studio.json', 'package.json', 'AGENTS.md', 'CLAUDE.md', '.gitignore']) assert.ok(existsSync(join(dir, f)), f);
  for (const d of ['brands', 'skills', '.claude/skills']) assert.ok(existsSync(join(dir, d)), d);
  assert.equal(existsSync(join(dir, 'gitignore')), false);

  const studio = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  assert.equal(studio.schema, 2);
  assert.deepEqual(studio.lanes, []);
  assert.equal(studio.paid, false);
  assert.deepEqual(studio.parts, []);
  assert.equal(studio.hyperframes, '0.9.67');
  assert.deepEqual(studio.brands, []);
  assert.match(studio.engine, /^create-video-engine@\d/);

  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.devDependencies.hyperframes, '0.9.67');
  assert.ok(pkg.devDependencies['create-video-engine']);
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['doctor', 'hf', 'verify']);
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md');
  assert.deepEqual(readdirSync(join(dir, 'brands')), []);
});

test('a fresh studio installs nothing from the catalog', () => {
  const dir = join(tmp(), 'studio');
  assert.equal(cli('init', dir, '--no-install').status, 0);
  assert.equal(existsSync(join(dir, 'parts')), false);
  assert.equal(existsSync(join(dir, 'NOTICE.md')), false);
});

test('init refuses a non-empty directory with exit 64', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'x.txt'), 'x');
  const r = cli('init', dir, '--no-install');
  assert.equal(r.status, 64);
  assert.match(r.stderr, /not empty/);
});

test('init accepts an existing empty directory', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'empty'));
  assert.equal(cli('init', join(dir, 'empty'), '--no-install').status, 0);
});

test('init with install (network)', { skip: process.env.CVE_NETWORK_TESTS !== '1' }, () => {
  const dir = join(tmp(), 'studio');
  const r = spawnSync(process.execPath, [CLI, 'init', dir, '--json'], { encoding: 'utf8', timeout: 600000 });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.installed, true);
  assert.ok(existsSync(join(dir, 'node_modules', '.bin', 'hyperframes')));
  assert.ok(existsSync(join(dir, 'skills', 'hyperframes')));
  assert.ok(existsSync(join(dir, '.claude', 'skills', 'hyperframes')));
});
