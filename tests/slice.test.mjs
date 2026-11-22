import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceData } from '../catalog/tool/assemble-long/files/assemble-long.mjs';

// eight words, two sentences: "Bir iki üç. Dört beş altı yedi sekiz."
const words = { schema: 1, words: [
  { w: 'Bir', start: 0.0, end: 0.4 }, { w: 'iki', start: 0.5, end: 0.9 }, { w: 'üç.', start: 1.0, end: 1.4 },
  { w: 'Dört', start: 2.0, end: 2.4 }, { w: 'beş', start: 2.5, end: 2.9 }, { w: 'altı', start: 3.0, end: 3.4 },
  { w: 'yedi', start: 3.5, end: 3.9 }, { w: 'sekiz.', start: 4.0, end: 4.4 },
] };

test('slice never splits a word and moves times to the clip clock', () => {
  const s = sliceData({ from: 2.2, to: 3.2, words, snap: 0, pad: { before: 0, after: 0 } });
  assert.equal(s.from, 2.0);
  assert.equal(s.to, 3.4);
  assert.deepEqual(s.words.words.map((w) => w.w), ['Dört', 'beş', 'altı']);
  assert.equal(s.words.words[0].start, 0);
  assert.equal(s.words.duration, 1.4);
});

test('slice snaps to the sentence start and the full stop within --snap', () => {
  const s = sliceData({ from: 2.6, to: 3.6, words, pad: { before: 0, after: 0 } });
  assert.equal(s.from, 2.0, 'back to "Dört"');
  assert.equal(s.to, 4.4, 'on to "sekiz."');
  assert.ok(s.notes.some((n) => n.includes('sentence start')));
});

test('padding stays out of the neighbouring words', () => {
  const s = sliceData({ from: 2.0, to: 4.4, words, snap: 0, duration: 10 });
  assert.ok(s.from >= 1.4 && s.from < 2.0);
  assert.ok(s.to > 4.4 && s.to <= 4.6);
});

test('turns and scenes are clipped; short leftovers dropped', () => {
  const turns = { schema: 1, turns: [{ start: 0, end: 2.2, speaker: 'A' }, { start: 2.2, end: 5, speaker: 'B' }] };
  const scenes = [{ start: 0, end: 2.3, kind: 'topic', text: 'x' }, { start: 2.5, end: 4.4, kind: 'punchline', text: 'y' }];
  const s = sliceData({ from: 2.0, to: 4.4, words, turns, scenes, snap: 0, pad: { before: 0, after: 0 } });
  assert.deepEqual(s.turns.turns.map((t) => [t.speaker, t.start, t.end]), [['A', 0, 0.2], ['B', 0.2, 2.4]]);
  assert.equal(s.scenes.length, 1);
  assert.deepEqual([s.scenes[0].start, s.scenes[0].end], [0.5, 2.4]);
});

test('a needs entry with a note is checked by its tool name', async () => {
  const { needTool } = await import('../src/add/core.mjs');
  assert.equal(needTool("hyperframes (the studio's pinned binary)"), 'hyperframes');
  assert.equal(needTool('ffmpeg'), 'ffmpeg');
});
