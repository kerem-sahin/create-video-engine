import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, ffmpeg, haveFfmpeg } from './helpers.mjs';
import { analyzeAudio } from '../catalog/tool/moments/files/audio-signals.mjs';
import { buildMoments } from '../catalog/tool/moments/files/moments.mjs';

const CLI = new URL('../catalog/tool/moments/files/moments.mjs', import.meta.url).pathname;
const SR = 16000;

// ---- synthetic audio (ffmpeg aevalsrc, deterministic) -------------------------------------------------------
// speech-like: a voiced harmonic stack with a drifting syllable envelope (3-5.5 Hz, irregular), 30% floor between
//   syllables (clear speech dips ~10 dB), word pauses.
// laughter-like: evenly spaced loud pulses (5-7 Hz) with deep valleys, breathy noise on top, decaying over the burst.
// hard negative: "rhythmic speech" - speech-like but with a perfectly even 5 Hz syllable beat.
// SET A is what the thresholds were tuned on; SET B has different rates/pitches and is what is reported.
const SETS = {
  A: { speech: [[130, 4.1, 0.31], [170, 4.7, 0.23], [210, 3.6, 0.41], [150, 5.2, 0.37]], laugh: [[5.5, 280], [6.3, 330], [7.0, 260]], rhythm: [[5.0, 160, 0.3]], hard: [], gain: [1], noise: 0.004 },
  B: { speech: [[120, 4.4, 0.27], [185, 3.9, 0.35], [140, 5.0, 0.19], [230, 4.2, 0.43], [160, 4.8, 0.29]], laugh: [[5.8, 300], [6.6, 250], [6.0, 360], [5.2, 310]], rhythm: [[4.6, 140, 0.3], [5.4, 200, 0.3]], hard: [[5.0, 150, 0.08]], gain: [1, 0.35, 0.6, 1], noise: 0.012 },
};
let NZ = 0.004; // background noise amplitude of the set being built
const speechExpr = (f0, r, wob) => {
  const ph = `2*PI*(${r}*t+0.9*sin(2*PI*${wob}*t))`;
  const env = `(0.3+0.7*pow(max(0,sin(${ph})),0.8))*(0.55+0.45*sin(2*PI*0.9*t+1))`;
  const carrier = `(sin(2*PI*${f0}*t)+0.6*sin(2*PI*${2 * f0}*t)+0.45*sin(2*PI*${3 * f0}*t)+0.3*sin(2*PI*${5 * f0}*t))`;
  return `0.12*${env}*${carrier}+${NZ}*(2*random(1)-1)`;
};
const rhythmExpr = (f0, r, floor) => `0.12*(${floor}+${1 - floor}*pow(max(0,sin(2*PI*${r}*t)),0.8))*(sin(2*PI*${f0}*t)+0.6*sin(2*PI*${2 * f0}*t)+0.45*sin(2*PI*${3 * f0}*t))+${NZ}*(2*random(1)-1)`;
const laughExpr = (r, f, gain, under) => {
  const pulse = `pow(abs(sin(PI*${r}*t)),2.5)*exp(-t/1.6)`;
  const body = `${gain}*${pulse}*(0.16*sin(2*PI*${f}*t)+0.14*(2*random(0)-1))`;
  return `${body}+${NZ}*(2*random(1)-1)${under ? '+' + under.replace('E', speechExpr(140, 4.2, 0.3)) : ''}`;
};
const silenceExpr = () => `${NZ}*(2*random(1)-1)`;

function seg(dir, name, expr, dur) {
  const f = join(dir, name + '.wav');
  ffmpeg(['-f', 'lavfi', '-i', `aevalsrc='${expr}':s=${SR}:d=${dur}`, '-ar', String(SR), '-ac', '1', f]);
  return f;
}

/** Builds a file and returns { file, truth:[{start,end}], rhythmic:[{start,end}], speech:[{start,end}], duration }. */
export function makeSynth(dir, setName) {
  const S = SETS[setName]; NZ = S.noise;
  const parts = []; let t = 0;
  const truth = [], rhythmic = [], hard = [], speech = [];
  let n = 0;
  const add = (kind, expr, dur) => {
    parts.push(seg(dir, `${setName}${n++}`, expr, dur));
    if (kind === 'laugh') truth.push({ start: t, end: t + dur });
    if (kind === 'hard') hard.push({ start: t, end: t + dur });
    if (kind === 'rhythm') rhythmic.push({ start: t, end: t + dur });
    if (kind === 'speech') speech.push({ start: t, end: t + dur });
    t += dur;
  };
  // 6 rounds: speech, speech, laugh, silence, ...; some laughs overlap a speaker; rhythmic speech twice per round
  for (let round = 0; round < 6; round++) {
    S.speech.forEach((s, i) => add('speech', speechExpr(...s), 4.5 + ((round + i) % 3)));
    const [r, f] = S.laugh[round % S.laugh.length];
    add('laugh', laughExpr(r, f, S.gain[round % S.gain.length], round % 2 ? '0.5*E' : null), 1.8 + (round % 3) * 0.6);
    add('silence', silenceExpr(), 0.8);
    S.rhythm.forEach(([f0, r2, fl]) => add('rhythm', rhythmExpr(f0, r2, fl), 2.5));
    S.hard.forEach(([f0, r2, fl]) => add('hard', rhythmExpr(f0, r2, fl), 2.5));
    add('speech', speechExpr(...S.speech[round % S.speech.length]), 3.5);
  }
  const list = join(dir, setName + '.txt');
  writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
  const file = join(dir, setName + '.wav');
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', file]);
  return { file, truth, rhythmic, hard, speech, duration: t };
}

const overlap = (a, b, pad = 0.3) => a.start < b.end + pad && b.start < a.end + pad;
export function score(bursts, truth, neg, hard = []) {
  const tp = truth.filter((tr) => bursts.some((b) => overlap(b, tr))).length;
  const goodBursts = bursts.filter((b) => truth.some((tr) => overlap(b, tr))).length;
  const fp = bursts.length - goodBursts;
  const fpRhythm = bursts.filter((b) => !truth.some((tr) => overlap(b, tr)) && neg.some((r) => overlap(b, r, 0))).length;
  const fpHard = bursts.filter((b) => !truth.some((tr) => overlap(b, tr)) && hard.some((r) => overlap(b, r, 0))).length;
  return { fpHard, truth: truth.length, found: tp, bursts: bursts.length, fp, fpRhythm, recall: tp / truth.length, precision: bursts.length ? goodBursts / bursts.length : 1 };
}

test('laughter detector on synthetic audio: reports precision and recall (set A tuned, set B held out)', { skip: !haveFfmpeg }, async () => {
  const dir = tmp('cve-moments-');
  const res = {};
  for (const name of ['A', 'B']) {
    const s = makeSynth(dir, name);
    const a = await analyzeAudio(s.file);
    res[name] = score(a.bursts, s.truth, s.rhythmic, s.hard);
    if (process.env.MOMENTS_DIAG) console.log(name, JSON.stringify(res[name]), '\n', a.bursts.map((b) => `${b.start}-${b.end} p${b.pulses} ${b.rate_hz}Hz d${b.depth_db} f${b.flatness}`).join('\n'), '\ntruth', s.truth.map((x) => x.start.toFixed(1) + '-' + x.end.toFixed(1)).join(' '));
  }
  console.log('# synthetic laughter (held-out set B): ' + JSON.stringify(res.B) + ' | tuned set A: ' + JSON.stringify(res.A));
  assert.ok(res.B.recall >= 0.6, 'recall ' + res.B.recall);
  assert.ok(res.B.precision >= 0.9, 'precision ' + res.B.precision);
});

// ---- transcript logic on a built transcript -------------------------------------------------------------------
// 640 s, four topics of 160 s with their own vocabulary, sentences of 8 words with a 1.1 s pause after each; at ~300 s a
// setup then "yok artık" + "(gülüşmeler)", and a plain stretch elsewhere. Two speakers alternating every sentence at 300-330 s.
const TOPICS = [
  ['araba', 'tamponu', 'taksi', 'kaza', 'direksiyon', 'trafik', 'çıkışı', 'sigorta'],
  ['yemek', 'tarifi', 'mutfak', 'tencere', 'makarna', 'baharat', 'fırında', 'sofraya'],
  ['futbol', 'maçında', 'takımın', 'kalecisi', 'penaltı', 'stadyum', 'hakemin', 'transfer'],
  ['telefon', 'ekranı', 'kamera', 'şarjım', 'uygulama', 'güncelleme', 'bildirim', 'hafıza'],
];
function makeWords() {
  const words = []; let t = 0, s = 0;
  while (t < 640) {
    const topic = TOPICS[Math.min(3, Math.floor(t / 160))];
    const n = 8;
    for (let k = 0; k < n; k++) {
      let w = topic[(s * 3 + k * 5) % topic.length];
      if (k === 0) w = ['bugün', 'şimdi', 'dün', 'geçen'][s % 4] === 'şimdi' ? 'sonunda' : ['bugün', 'dün', 'geçen', 'sonunda'][s % 4];
      if (k === n - 1) w += s % 5 === 0 ? '?' : '.';
      words.push({ w: s === 41 && k === 0 ? 'ya' : w, start: +(t + k * 0.35).toFixed(2), end: +(t + k * 0.35 + 0.3).toFixed(2) });
    }
    t += n * 0.35 + 1.1; s++;
  }
  // reaction + laughter token near 300 s
  const i = words.findIndex((x) => x.start > 300);
  words.splice(i, 0, { w: 'Yok', start: words[i].start - 0.9, end: words[i].start - 0.6 }, { w: 'artık.', start: words[i].start - 0.6, end: words[i].start - 0.3 }, { w: '(gülüşmeler)', start: words[i].start - 0.3, end: words[i].start - 0.05 });
  return words;
}
const speakersFor = (words) => ({ turns: Array.from({ length: 60 }, (_, k) => ({ start: 290 + k * 0.7, end: 290 + k * 0.7 + 0.6, speaker: k % 2 ? 'B' : 'A' })) });

test('chapters: first at 0, at least 3, 60 s apart, one boundary per topic change', () => {
  const words = makeWords();
  const m = buildMoments({ words, speakers: null, audio: null, duration: 640 });
  assert.equal(m.chapters[0].start, 0);
  assert.ok(m.chapters.length >= 3, 'got ' + m.chapters.length);
  for (let i = 1; i < m.chapters.length; i++) assert.ok(m.chapters[i].start - m.chapters[i - 1].start >= 60);
  const edges = [160, 320, 480];
  const hit = edges.filter((e) => m.chapters.some((c) => Math.abs(c.start - e) < 12));
  assert.ok(hit.length >= 2, `boundaries ${m.chapters.map((c) => c.start)} miss the topic changes`);
  for (const c of m.chapters.slice(1)) assert.ok(edges.some((e) => Math.abs(c.start - e) < 12), `boundary ${c.start} is not at a topic change`);
  assert.ok(m.chapters.find((c) => Math.abs(c.start - 160) < 12).keywords.some((k) => TOPICS[1].some((w) => w.startsWith(k.slice(0, 5)))));
});

test('clips: 15-45 s on sentence boundaries, laugh plus reaction wins, no pronoun hook', () => {
  const words = makeWords();
  const starts = new Set(); const ends = new Set();
  for (let i = 0; i < words.length; i++) { const brk = (a, b) => /[.?!…]$/.test(a.w) || b.start - a.end > 0.9; if (i === 0 || brk(words[i - 1], words[i])) starts.add(words[i].start); if (i === words.length - 1 || brk(words[i], words[i + 1])) ends.add(words[i].end); }
  const m = buildMoments({ words, speakers: speakersFor(words), audio: null, duration: 640 });
  assert.ok(m.clips.length >= 5);
  for (const c of m.clips) {
    assert.ok(c.end - c.start >= 15 && c.end - c.start <= 45, `dur ${c.end - c.start}`);
    assert.ok(starts.has(c.start) && ends.has(c.end), 'not on a sentence boundary');
    assert.ok(c.signals && 'laughter' in c.signals && 'turns' in c.signals && 'energy' in c.signals && 'text' in c.signals);
    assert.equal(typeof c.hook.yes, 'boolean'); assert.ok(c.hook.reason); assert.ok(c.why);
  }
  const top = m.clips[0];
  assert.ok(top.start < 305 && top.end > 300, `top clip ${top.start}-${top.end}`);
  assert.ok(top.signals.laughter > 0 && top.signals.turns > 0);
  assert.match(top.why, /gülüşmeler/);
  for (let i = 1; i < m.clips.length; i++) assert.ok(m.clips[i].score <= m.clips[i - 1].score);
  // a sentence opening with "ya" fails the hook and is penalised for needing context
  const ya = words.find((x) => x.w === 'ya');
  const withYa = buildMoments({ words, speakers: null, audio: null, duration: 640, topN: 200 }).clips.find((c) => c.start === ya.start);
  if (withYa) { assert.equal(withYa.hook.yes, false); assert.match(withYa.why, /needs earlier context/); }
});

test('CLI writes moments.json and moments.md from words + audio', { skip: !haveFfmpeg }, () => {
  const dir = tmp('cve-moments-cli-');
  const wav = join(dir, 'a.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=200:duration=640', '-ar', '16000', wav]);
  const words = makeWords();
  writeFileSync(join(dir, 'w.json'), JSON.stringify({ words }));
  writeFileSync(join(dir, 's.json'), JSON.stringify(speakersFor(words)));
  const r = spawnSync(process.execPath, [CLI, '--audio', wav, '--words', join(dir, 'w.json'), '--speakers', join(dir, 's.json'), '--out', join(dir, 'out')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(join(dir, 'out/moments.json'), 'utf8'));
  assert.ok(j.clips.length && j.chapters.length >= 3);
  assert.equal(j.signals_available.speaker_turns, true);
  const md = readFileSync(join(dir, 'out/moments.md'), 'utf8');
  assert.match(md, /## Top 8 clips/); assert.match(md, /## Chapters/);
  assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 64);
  assert.equal(spawnSync(process.execPath, [CLI, '--audio', join(dir, 'nope.wav'), '--words', join(dir, 'w.json')], { encoding: 'utf8' }).status, 2);
});

test('same input gives identical output', () => {
  const words = makeWords();
  const a = JSON.stringify(buildMoments({ words, speakers: null, audio: null, duration: 640 }));
  assert.equal(a, JSON.stringify(buildMoments({ words, speakers: null, audio: null, duration: 640 })));
});
