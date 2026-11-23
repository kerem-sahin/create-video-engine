import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncStats, matchWords } from '../catalog/tool/transcribe-local/files/sync-check.mjs';

const W = (text, t0 = 0, step = 0.4) => text.split(' ').map((w, i) => ({ w, start: t0 + i * step, end: t0 + i * step + 0.3 }));

test('words heard where they are shown: in step', () => {
  const shown = W('arkadaki rüzgarlık yapılmaz sedan olsa neyse');
  const s = syncStats(shown, W('arkadaki rüzgarlık yapılmaz sedan olsa neyse', 0.05));
  assert.equal(s.problems.length, 0);
  assert.ok(Math.abs(s.median_shift - 0.05) < 1e-6);
});

test('a skipped sentence puts every later word early: out of step', () => {
  const shown = W('modifiye bilgin aklıma direkt geldi arkadaki rüzgarlık');
  const heard = [...W('bunu bilmiyorum sordum'), ...W('modifiye bilgin aklıma direkt geldi arkadaki rüzgarlık', 2.5)];
  const s = syncStats(shown, heard);
  assert.ok(s.median_shift > 2);
  assert.ok(s.problems.some((p) => /early/.test(p)));
});

test('matching is in order and ignores punctuation and case', () => {
  assert.deepEqual(matchWords(W('Porsche? Kendime.'), W('porsche kendime')), [[0, 0], [1, 1]]);
});
