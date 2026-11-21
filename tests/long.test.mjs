import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, haveFfmpeg, makeClip } from './helpers.mjs';
import { makeVfrClip, measureSync } from './sync-helpers.mjs';
import { runVerify } from '../src/verify/index.mjs';
import { verifyJson } from './helpers.mjs';
import { chapterStamp, chaptersText, captionStates, cleanWords, groupWords, srtCues, toSrt, validateChapters } from '../catalog/tool/assemble-long/files/text.mjs';

const root = new URL('../', import.meta.url).pathname;
const part = (rel) => join(root, 'catalog', rel);
const env = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` };
const node = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
const skip = { skip: !haveFfmpeg && 'ffmpeg not installed' };
const NORMALIZE = part('tool/transcribe-local/files/normalize.mjs');
const CUT = part('tool/silence-cut/files/silence-cut.mjs');
const ASSEMBLE = part('tool/assemble-long/files/assemble-long.mjs');

// one VFR clip (about 9 % of the frames dropped, timestamps kept), events on the 30 fps grid
const events = [];
for (let t = 2; t < 58; t += 4.3) events.push(Math.round(t * 30) / 30);
const dir = tmp('long-');
const vfr = join(dir, 'vfr.mp4');
const wordsFile = join(dir, 'vfr.words.json');
let prepared = false;
function prepare() {
  if (prepared) return;
  makeVfrClip(vfr, { events, duration: 60 });
  // w3 has no length at all, the way whisper sometimes gives it
  writeFileSync(wordsFile, JSON.stringify({ language: 'en', words: events.map((t, i) => ({ w: 'w' + i, start: t, end: i === 3 ? t : t + 0.12 })) }));
  prepared = true;
}

test('normalize: a variable-frame-rate clip becomes constant, and says it measured that', skip, () => {
  prepare();
  const out = join(dir, 'norm.mp4');
  const r = node(NORMALIZE, [vfr, '--out', out]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const rep = JSON.parse(readFileSync(out + '.normalize.json', 'utf8'));
  assert.equal(rep.source_info.variable_frame_rate, true);
  assert.ok(rep.source_info.frame_step_ms.max - rep.source_info.frame_step_ms.min > 4, 'the source really jitters');
  assert.deepEqual(rep.problems, []);
  assert.ok(Math.abs(rep.result.frame_step_ms.max - rep.result.frame_step_ms.min) < 0.5);
  assert.ok(Math.abs(rep.result.video_seconds - rep.result.audio_seconds) <= 1 / 30);
  assert.equal(rep.result.rotation, 0);
});

test('normalize refuses to overwrite its input and a missing file', skip, () => {
  prepare();
  assert.equal(node(NORMALIZE, [vfr, '--out', vfr]).status, 64);
  assert.equal(node(NORMALIZE, [join(dir, 'nope.mp4'), '--out', join(dir, 'x.mp4')]).status, 2);
  assert.equal(node(NORMALIZE, [vfr]).status, 64);
});

test('normalize -> cut: sound and picture stay within one frame at every event, a zero-length word is kept', skip, () => {
  prepare();
  const norm = join(dir, 'norm2.mp4');
  assert.equal(node(NORMALIZE, [vfr, '--out', norm]).status, 0);
  const edl = join(dir, 'edl.json'), cut = join(dir, 'cut.mp4');
  const p = node(CUT, ['plan', '--video', norm, '--words', wordsFile, '--out', edl, '--fillers', 'none']);
  assert.equal(p.status, 0, p.stderr);
  assert.doesNotMatch(p.stderr, /variable frame rate/);
  const a = node(CUT, ['apply', '--edl', edl, '--out', cut]);
  assert.equal(a.status, 0, a.stderr);
  assert.doesNotMatch(a.stderr, /variable frame rate|differs from expected/);
  assert.match(a.stdout, new RegExp(`retimed words: ${events.length} of ${events.length} kept`), 'no word lost');
  const m = measureSync(cut);
  assert.equal(m.pairs.length, events.length);
  for (const { offset } of m.pairs) assert.ok(Math.abs(offset) < 1 / 30, `offset ${offset}`);
  const cw = JSON.parse(readFileSync(join(dir, 'cut.words.json'), 'utf8'));
  const w3 = cw.words.find((w) => w.w === 'w3');
  assert.ok(w3 && w3.end - w3.start >= 0.08 - 1e-9, 'zero-length word got a minimal length');
  // ... and the assembled file keeps that: audio is re-made (gain + limiter, AAC) and muxed, picture re-encoded
  const final = join(dir, 'final-sync.mp4');
  const as = node(ASSEMBLE, ['assemble', '--video', cut, '--words', join(dir, 'cut.words.json'), '--frame', part('lanes/talking-head/example/frame.md'), '--out', final, '--captions', 'none']);
  assert.equal(as.status, 0, as.stderr + as.stdout);
  const fm = measureSync(final);
  assert.equal(fm.pairs.length, events.length);
  for (const { offset } of fm.pairs) assert.ok(Math.abs(offset) < 1 / 30, `assembled offset ${offset}`);
  // the retimed word times land on the beep they belong to
  cw.words.forEach((w, i) => assert.ok(Math.abs(w.start - m.beeps[i]) < 0.1, `word ${i} ${w.start} vs beep ${m.beeps[i]}`));
});

test('silence-cut warns about a variable-frame-rate input', skip, () => {
  prepare();
  const p = node(CUT, ['plan', '--video', vfr, '--words', wordsFile, '--out', join(dir, 'edl-vfr.json'), '--fillers', 'none']);
  assert.match(p.stderr, /variable frame rate/);
});

test('transcribe-local warns about a variable-frame-rate input before doing the long work', skip, () => {
  prepare();
  const r = node(part('tool/transcribe-local/files/transcribe.mjs'), [vfr, '--language', 'en', '--out', join(dir, 'x.words.json'), '--hf', join(dir, 'no-such-hyperframes')]);
  assert.match(r.stderr, /variable frame rate/);
  assert.match(r.stderr, /normalize\.mjs/);
});

// ---- text: captions, SRT, chapters ------------------------------------------------------------------
test('chapters follow YouTube rules and format as M:SS or H:MM:SS', () => {
  const ok = [{ start: 0, title: 'Intro' }, { start: 75, title: 'Main' }, { start: 3700, title: 'End' }];
  assert.deepEqual(validateChapters(ok, 3800), []);
  assert.equal(chaptersText(ok, 3800), '0:00:00 Intro\n0:01:15 Main\n1:01:40 End\n');
  assert.equal(chaptersText(ok.slice(0, 2).concat({ start: 300, title: 'C' }), 600), '0:00 Intro\n1:15 Main\n5:00 C\n');
  assert.equal(chapterStamp(59.9, false), '0:59');
  const bad = (list, d, re) => assert.ok(validateChapters(list, d).some((e) => re.test(e)), JSON.stringify(validateChapters(list, d)));
  bad([{ start: 0, title: 'a' }, { start: 20, title: 'b' }], 100, /at least 3/);
  bad([{ start: 1, title: 'a' }, { start: 20, title: 'b' }, { start: 40, title: 'c' }], 100, /0:00/);
  bad([{ start: 0, title: 'a' }, { start: 9, title: 'b' }, { start: 40, title: 'c' }], 100, /only 9 s/);
  bad([{ start: 0, title: 'a' }, { start: 20, title: 'b' }, { start: 20, title: 'c' }], 100, /not after/);
  bad([{ start: 0, title: 'a' }, { start: 20, title: '' }, { start: 40, title: 'c' }], 100, /title is empty/);
  bad([{ start: 0, title: 'a' }, { start: 20, title: 'b' }, { start: 95, title: 'c' }], 100, /last chapter/);
  bad([{ start: 0, title: 'a' }, { start: 20, title: 'b' }, { start: 120, title: 'c' }], 100, /video is/);
  assert.throws(() => chaptersText([{ start: 0, title: 'a' }], 100), /at least 3/);
});

test('SRT is sentence-level and caption states are sequential on the frame grid', () => {
  const words = cleanWords({ words: [
    { w: 'Merhaba', start: 0.1, end: 0.5 }, { w: 'dünya.', start: 0.5, end: 0.9 },
    { w: 'Bugün', start: 1.0, end: 1.3 }, { w: 'hava', start: 1.3, end: 1.6 }, { w: 'güzel!', start: 1.6, end: 2.0 },
    { text: 'x', start: 5, end: 5.2 }, { start: 6, end: 7 },
  ] });
  assert.equal(words.length, 6);
  const cues = srtCues(words);
  assert.deepEqual(cues.map((c) => c.text), ['Merhaba dünya.', 'Bugün hava güzel!', 'x']);
  assert.match(toSrt(words), /^1\n00:00:00,100 --> 00:00:01,000\nMerhaba dünya\./);
  const groups = groupWords(words, 'pop', false);
  const states = captionStates(groups, { fps: 30, total: 6, highlight: true });
  let prev = 0;
  for (const s of states) {
    assert.ok(s.from >= prev - 1e-9 && s.to > s.from, JSON.stringify(s));
    assert.ok(Math.abs(s.from * 30 - Math.round(s.from * 30)) < 0.02, 'on the frame grid');
    prev = s.to;
  }
  assert.equal(captionStates(groups, { fps: 30, total: 6, highlight: false }).length, groups.length);
});

test('assemble-long: chapters are refused before anything renders; srt and chapters commands work', skip, () => {
  const c = join(dir, 'ch.json');
  writeFileSync(c, JSON.stringify([{ start: 0, title: 'a' }, { start: 5, title: 'b' }]));
  const r = node(ASSEMBLE, ['chapters', '--chapters', c, '--duration', '100']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /at least 3/);
  writeFileSync(c, JSON.stringify([{ start: 0, title: 'a' }, { start: 15, title: 'b' }, { start: 40, title: 'c' }]));
  const out = join(dir, 'chapters.txt');
  assert.equal(node(ASSEMBLE, ['chapters', '--chapters', c, '--duration', '100', '--out', out]).status, 0);
  assert.equal(readFileSync(out, 'utf8'), '0:00 a\n0:15 b\n0:40 c\n');
  const w = join(dir, 'w.json'), srt = join(dir, 'x.srt');
  writeFileSync(w, JSON.stringify({ words: [{ w: 'a', start: 0, end: 1 }, { w: 'b.', start: 1, end: 2 }] }));
  assert.equal(node(ASSEMBLE, ['srt', '--words', w, '--out', srt]).status, 0);
  assert.match(readFileSync(srt, 'utf8'), /a b\./);
  assert.equal(node(ASSEMBLE, ['assemble']).status, 64);
  assert.equal(node(ASSEMBLE, []).status, 64);
});

// ---- assembly without a browser (no captions, no cards): loudness, timing, outputs -----------------------------
test('assemble-long (ffmpeg only): -16 LUFS, true peak <= -1, same frames, srt and chapters written, verify --no-composition', skip, async () => {
  const d = tmp('asm-');
  const clip = join(d, 'cut.mp4');
  makeClip(clip, { duration: 40 });
  const wf = join(d, 'cut.words.json');
  writeFileSync(wf, JSON.stringify({ words: [{ w: 'Bir', start: 1, end: 1.4 }, { w: 'iki.', start: 1.4, end: 2 }, { w: 'Üç', start: 20, end: 20.5 }] }));
  const ch = join(d, 'ch.json');
  writeFileSync(ch, JSON.stringify([{ start: 0, title: 'Giriş' }, { start: 12, title: 'Orta' }, { start: 30, title: 'Son' }]));
  const out = join(d, 'out', 'final.mp4');
  const r = node(ASSEMBLE, ['assemble', '--video', clip, '--words', wf, '--frame', part('lanes/talking-head/example/frame.md'), '--out', out, '--captions', 'none', '--chapters', ch]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const rep = JSON.parse(readFileSync(out + '.assemble.json', 'utf8'));
  assert.deepEqual(rep.problems, []);
  assert.ok(Math.abs(rep.audio.after.lufs - -16) <= 1, `lufs ${rep.audio.after.lufs}`);
  assert.ok(rep.audio.after.true_peak <= -1, `tp ${rep.audio.after.true_peak}`);
  assert.equal(rep.video.frames_in, rep.video.frames_out);
  assert.equal(typeof rep.libass_available, 'boolean');
  assert.ok(rep.stages.every((s) => typeof s.seconds === 'number'));
  assert.equal(readFileSync(join(d, 'out', 'chapters.txt'), 'utf8'), '0:00 Giriş\n0:12 Orta\n0:30 Son\n');
  assert.match(readFileSync(join(d, 'out', 'final.srt'), 'utf8'), /Bir iki\./);
  assert.ok(existsSync(out));
  assert.ok(!existsSync(join(d, 'out', '.assemble-work-final_mp4')), 'scratch removed');

  // verify of an ffmpeg-assembled video: no composition
  const proj = join(d, 'vproj');
  mkdirSync(proj);
  const bare = await verifyJson(runVerify, proj, ['--mp4', out, '--no-composition']);
  assert.equal(bare.code, 2, 'duration and audio could not be checked: not a pass');
  const get = (rep2, id) => rep2.layers.mp4.checks.find((c) => c.id === id);
  assert.equal(get(bare.report, 'duration').status, 'skipped');
  assert.equal(get(bare.report, 'audio-present').status, 'skipped');
  assert.equal(bare.report.layers.hfCheck.status, 'skipped');
  const full = await verifyJson(runVerify, proj, ['--mp4', out, '--no-composition', '--expect-duration', String(rep.video.seconds), '--expect-audio']);
  assert.equal(full.code, 0, JSON.stringify(full.report.layers.mp4.checks.filter((c) => c.status !== 'pass')));
  assert.equal(get(full.report, 'duration').status, 'pass');
  const wrong = await verifyJson(runVerify, proj, ['--mp4', out, '--no-composition', '--expect-duration', '99', '--expect-audio']);
  assert.equal(wrong.code, 1);
  assert.equal(await runVerify([proj, '--expect-duration', '5']), 64, 'the expect flags need --no-composition');
});
