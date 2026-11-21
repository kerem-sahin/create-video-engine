import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp } from './helpers.mjs';
import { run } from '../src/lib/exec.mjs';
import { run as vrun } from '../src/verify/util.mjs';

const CLI = new URL('../bin/cli.mjs', import.meta.url).pathname;
const cli = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' });
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;

test('--version prints package version', () => {
  const r = cli('--version');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), version);
});

test('--help lists commands', () => {
  const r = cli('--help');
  assert.equal(r.status, 0);
  for (const c of ['doctor', 'init', 'verify', 'refs']) assert.match(r.stdout, new RegExp(c));
});

test('no command and unknown command exit 64', () => {
  assert.equal(cli().status, 64);
  assert.equal(cli('bogus').status, 64);
});

test('bad usage exits 64', () => {
  assert.equal(cli('init').status, 64);
  assert.equal(cli('doctor', '--nope').status, 64);
});

test('verify and refs dispatch (or report unavailable with exit 2)', () => {
  for (const c of ['verify', 'refs']) {
    const r = cli(c);
    if (r.stderr.includes('not available in this build')) assert.equal(r.status, 2);
    else assert.ok([1, 2, 64].includes(r.status), `${c} exit ${r.status}`);
  }
});

test('unexpected exception in a command exits 2 with a message', () => {
  const d = tmp();
  writeFileSync(join(d, '.cve'), 'not a directory');
  const r = cli('verify', d, '--no-hf-check');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /verify: unexpected error:/);
});

test('timeout kills the process tree and resolves promptly', async () => {
  for (const [fn, opt] of [[run, { timeout: 1000 }], [vrun, { timeoutMs: 1000 }]]) {
    const t0 = Date.now();
    const r = await fn('sh', ['-c', 'sleep 8 & sleep 8'], opt);
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
    assert.ok(r.code === -1 || r.timedOut === true);
  }
});
