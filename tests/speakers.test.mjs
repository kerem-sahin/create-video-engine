import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assignWords, installed, parseWords, summarize, summaryText, toTurns } from '../catalog/tool/speakers/files/speakers.mjs';
import { haveFfmpeg, ffmpeg, tmp } from './helpers.mjs';

const CLI = new URL('../catalog/tool/speakers/files/speakers.mjs', import.meta.url).pathname;

test('toTurns labels by first appearance, merges close same-speaker segments, drops blips', () => {
  const { speakers, turns } = toTurns([
    { start: 5, end: 8, speaker: 1 }, { start: 8.2, end: 9, speaker: 1 },
    { start: 0, end: 4.9, speaker: 0 }, { start: 20, end: 20.1, speaker: 0 }, { start: 10, end: 12, speaker: 0 },
  ]);
  // speaker 0 speaks first -> A
  assert.deepEqual(speakers, ['A', 'B']);
  assert.deepEqual(turns, [
    { start: 0, end: 4.9, speaker: 'A' }, { start: 5, end: 9, speaker: 'B' }, { start: 10, end: 12, speaker: 'A' },
  ]);
});

test('toTurns joins same-speaker turns left next to each other after a blip is removed', () => {
  const { turns } = toTurns([{ start: 0, end: 3, speaker: 0 }, { start: 3.1, end: 3.2, speaker: 1 }, { start: 3.3, end: 6, speaker: 0 }]);
  assert.deepEqual(turns, [{ start: 0, end: 6, speaker: 'A' }]);
});

test('assignWords uses the midpoint, falls back to the nearest turn in a pause, null when far', () => {
  const turns = [{ start: 0, end: 4, speaker: 'A' }, { start: 5, end: 9, speaker: 'B' }];
  const w = assignWords([
    { w: 'one', start: 3.5, end: 4.3 },   // midpoint 3.9 -> A
    { w: 'two', start: 4.6, end: 5.4 },   // midpoint 5.0 -> B (turn start)
    { w: 'gap', start: 4.1, end: 4.3 },   // pause, nearer A
    { w: 'late', start: 30, end: 30.5 },  // far from any turn
  ], turns);
  assert.deepEqual(w.map((x) => x.speaker), ['A', 'B', 'A', null]);
  assert.equal(w[0].w, 'one');
});

test('assignWords works for unsorted-looking input and empty turns', () => {
  assert.deepEqual(assignWords([{ w: 'x', start: 0, end: 1 }], []).map((x) => x.speaker), [null]);
});

test('summarize counts talk time, turns and speaker changes', () => {
  const turns = [{ start: 0, end: 60, speaker: 'A' }, { start: 60, end: 90, speaker: 'B' }, { start: 90, end: 120, speaker: 'A' }];
  const s = summarize(['A', 'B'], turns);
  assert.equal(s.turns, 3); assert.equal(s.speaker_changes, 2);
  assert.deepEqual(s.talk_seconds, { A: 90, B: 30 });
  assert.deepEqual(s.talk_share, { A: 0.75, B: 0.25 });
  assert.match(summaryText(s), /A: 1:30 \(75%\), B: 0:30 \(25%\); 3 turns, 2 speaker changes/);
});

test('parseWords accepts the transcribe-local shape or a bare array and rejects bad input', () => {
  assert.equal(parseWords({ words: [{ w: 'a', start: 0, end: 1 }] }).length, 1);
  assert.equal(parseWords([{ w: 'a', start: 0, end: 1 }]).length, 1);
  assert.throws(() => parseWords({}), /no words/);
  assert.throws(() => parseWords({ words: [{ w: 'a' }] }), /start\/end/);
});

test('the CLI reports usage and a missing engine without crashing', () => {
  let r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(r.status, 64);
  r = spawnSync(process.execPath, [CLI, '--audio', 'x.wav', '--out', 'o.json', '--speakers', '1'], { encoding: 'utf8' });
  assert.equal(r.status, 64);
  if (!installed()) {
    const d = tmp();
    const a = join(d, 'a.wav');
    writeFileSync(a, 'x');
    r = spawnSync(process.execPath, [CLI, '--audio', a, '--out', join(d, 'o.json')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--install/);
  }
});

test('integration: two different `say` voices alternating are labelled as two speakers', { skip: !installed() || !haveFfmpeg ? 'sherpa-onnx engine not installed (node speakers.mjs --install)' : false }, () => {
  const d = tmp();
  const parts = [];
  const lines = ['Hello everyone, today we talk about the new episode.', 'So what do you think about it, will it actually work?', 'I think it will, but we should run a small test first.', 'You are right, let us start tomorrow morning together.'];
  for (let i = 0; i < 8; i++) {
    const f = join(d, `s${i}`);
    const say = spawnSync('say', ['-v', i % 2 ? 'Fred' : 'Daniel', '-o', f + '.aiff', lines[i % 4]]);
    if (say.status !== 0) return; // no `say` (not macOS): nothing to test with
    ffmpeg(['-i', f + '.aiff', '-ac', '1', '-ar', '16000', f + '.wav']);
    parts.push(f + '.wav');
  }
  writeFileSync(join(d, 'l.txt'), parts.map((p) => `file '${p}'\n`).join(''));
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(d, 'l.txt'), '-c', 'copy', join(d, 'all.wav')]);
  const out = join(d, 'o.json');
  const r = spawnSync(process.execPath, [CLI, '--audio', join(d, 'all.wav'), '--speakers', '2', '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(j.speakers, ['A', 'B']);
  assert.ok(j.summary.speaker_changes >= 5);
});
