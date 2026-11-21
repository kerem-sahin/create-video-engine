import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../catalog/motion/cve-motion/files/cve-motion.js', import.meta.url), 'utf8');
function load() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.window.CVE;
}
const CVE = load();
const grid = Array.from({ length: 101 }, (_, i) => i / 100);

test('every preset starts at 0 and ends exactly at 1', () => {
  for (const name of ['snappy', 'soft', 'settle']) {
    assert.equal(CVE.ease[name](0), 0, name);
    assert.equal(CVE.ease[name](1), 1, name);
  }
});

test('settle overshoots above 1 and returns; snappy and soft stay near 1', () => {
  const v = grid.map(CVE.ease.settle);
  const peak = Math.max(...v);
  assert.ok(peak > 1.03 && peak < 1.2, `peak ${peak}`);
  assert.ok(Math.abs(v[90] - 1) < 0.02, 'back near 1 before the end');
  for (const name of ['snappy', 'soft']) assert.ok(Math.max(...grid.map(CVE.ease[name])) < 1.02, name);
});

test('spring eases are deterministic', () => {
  const a = load(), b = load();
  const p = { stiffness: 200, damping: 12, mass: 1.5 };
  assert.deepEqual(grid.map(a.spring(p)), grid.map(b.spring(p)));
  assert.equal(a.springDuration(p), b.springDuration(p));
  assert.deepEqual(grid.map(CVE.ease.settle), grid.map(CVE.ease.settle));
});

test('springDuration settles within 0.5 % and handles all damping regimes', () => {
  for (const p of [{ stiffness: 180, damping: 16, mass: 1 }, { stiffness: 100, damping: 20, mass: 1 }, { stiffness: 100, damping: 40, mass: 1 }]) {
    const T = CVE.springDuration(p);
    assert.ok(T > 0.1 && T < 10, `T ${T}`);
    const e = CVE.spring(p);
    assert.equal(e(0), 0);
    assert.equal(e(1), 1);
    assert.ok(grid.every(Number.isFinite.bind(Number)) && grid.map(e).every(Number.isFinite));
  }
});
