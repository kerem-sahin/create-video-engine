import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = new URL('../bin/cli.mjs', import.meta.url).pathname;

test('doctor --json has the documented shape and matching exit code', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cve-doc-'));
  const r = spawnSync(process.execPath, [CLI, 'doctor', '--json'], { encoding: 'utf8', cwd });
  const j = JSON.parse(r.stdout);
  assert.equal(typeof j.ok, 'boolean');
  assert.ok(Array.isArray(j.checks) && j.checks.length >= 5);
  for (const c of j.checks) {
    assert.equal(typeof c.name, 'string');
    assert.ok(['ok', 'warn', 'fail'].includes(c.status));
    assert.equal(typeof c.detail, 'string');
    assert.equal(typeof c.hint, 'string');
  }
  assert.ok(j.checks.some((c) => c.name === 'node'));
  assert.equal(r.status, j.checks.some((c) => c.status === 'fail') ? 1 : 0);
  assert.equal(j.ok, r.status === 0);
});

test('doctor outside a studio says how to get the full check', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cve-doc-'));
  const r = spawnSync(process.execPath, [CLI, 'doctor'], { encoding: 'utf8', cwd });
  assert.match(r.stdout, /inside your studio folder/);
});
