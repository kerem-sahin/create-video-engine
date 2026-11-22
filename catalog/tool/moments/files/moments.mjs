#!/usr/bin/env node
// moments: propose clip candidates (Shorts/Reels) and chapter boundaries for a long two-host chat podcast.
//   node moments.mjs --audio ep.m4a --words ep.words.json [--speakers ep.speakers.json] [--out dir] [--top 8]
// Reads the word JSON of transcribe-local ({words:[{w,start,end,unsure?}]}) and optionally speakers.json
// ({turns:[{start,end,speaker}]}). Writes moments.json and moments.md into --out (default: next to the words file).
// Every number comes from the audio or the transcript; the person picks. Nothing here has "heard" a joke:
// the score is a transparent sum, each part is in `signals` and spelled out in `why`.
// Exit: 0 ok, 2 cannot run, 64 usage.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAudio, round } from './audio-signals.mjs';

export const WEIGHTS = { laughter: 0.35, turns: 0.15, energy: 0.15, text: 0.35 };
const MIN_DUR = 15, MAX_DUR = 45;

const lc = (s) => s.toLocaleLowerCase('tr');
const clean = (w) => lc(w).replace(/[^\p{L}\p{N}]+/gu, '');
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const mmss = (t) => { const s = Math.round(t); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const LAUGH_TOKEN = /^\(?\[?(gülüş|gülme|kahkaha|güldü|laugh|haha|hahah|ahaha|ahah|hehe|hehehe|hihi|ehehe)/u;
const REACTIONS = ['ne diyosun', 'ne diyorsun', 'yok artık', 'yok ya', 'olum', 'oğlum', 'kanka', 'ciddi misin', 'ciddi mi', 'gerçekten mi', 'şaka mı', 'bi dakika', 'bir dakika', 'inanmıyorum', 'abartma', 'öldüm', 'ölüyorum', 'yapma ya', 'imkansız', 'nasıl yani', 'ne alaka', 'saçmalama', 'rezil', 'bu ne ya', 'hadi canım', 'vay be', 'ya yok'];
const NO_OPEN = new Set(['ve', 'ama', 'fakat', 'çünkü', 'yani', 'işte', 'ki', 'de', 'da', 'o', 'bu', 'şu', 'onu', 'bunu', 'şunu', 'onun', 'bunun', 'onlar', 'bunlar', 'şunlar', 'orada', 'burada', 'öyle', 'böyle', 'ondan', 'bundan', 'hani', 'sonra', 'e', 'ee', 'eee', 'ıı', 'neyse', 'peki', 'tamam', 'evet', 'hayır', 'aynen', 'yok', 'he', 'hı', 'hmm', 'ya', 'bide', 'hem', 'ayrıca', 'mesela', 'zaten']);
const CHAPTER_CUES = ['neyse', 'konu şu', 'geçelim', 'geçiyorum', 'geçiyoruz', 'başka bir konu', 'bir sonraki', 'peki ya', 'konuya dönelim', 'konuya gelelim'];
const STOP = new Set(['yani', 'işte', 'şimdi', 'ama', 'çünkü', 'gibi', 'kadar', 'sonra', 'zaten', 'bence', 'aslında', 'değil', 'olarak', 'bile', 'daha', 'çok', 'şey', 'bunu', 'bunun', 'onun', 'onu', 'böyle', 'öyle', 'hani', 'ben', 'sen', 'biz', 'siz', 'onlar', 'bunlar', 'şunu', 'için', 'ile', 'veya', 'ancak', 'fakat', 'hem', 'her', 'hiç', 'hiçbir', 'bazı', 'bütün', 'bir', 'iki', 'evet', 'hayır', 'tamam', 'neyse', 'peki', 'diyor', 'dedi', 'diyorum', 'dedim', 'olan', 'oldu', 'olur', 'olmuş', 'oluyor', 'olsun', 'yapıyor', 'yaptı', 'geldi', 'gidiyor', 'biraz', 'tabii', 'tabi', 'galiba', 'sanki', 'mesela', 'yine', 'artık', 'bile', 'ancak', 'nasıl', 'neden', 'niye', 'kadar', 'falan', 'filan', 'herhalde', 'belki', 'sadece', 'sadece', 'bunda', 'şuna', 'buna', 'ona', 'bana', 'sana', 'bizim', 'benim', 'senin', 'ondan', 'bundan', 'içinde', 'üzerinde', 'gerçekten', 'tamamen', 'şöyle', 'burada', 'orada', 'olarak', 'diye', 'derken', 'değilim', 'değiliz', 'değildi', 'yok', 'var', 'vardı', 'varmış', 'ediyor', 'etti', 'lan', 'abi', 'kanka', 'oğlum', 'olum', 'ulan']);

// ---- transcript -> sentences ------------------------------------------------------------------------------------
export function toSentences(words) {
  const out = []; let a = 0;
  const flush = (b) => {
    if (b < a) return;
    const ws = words.slice(a, b + 1);
    out.push({ i0: a, i1: b, start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map((x) => x.w).join(' ').replace(/\s+/g, ' ').trim(), n: ws.length, q: /\?["')»”]*$/.test(ws[ws.length - 1].w), punct: /[.?!…]["')»”]*$/.test(ws[ws.length - 1].w) });
    a = b + 1;
  };
  for (let i = 0; i < words.length; i++) {
    const endsP = /[.?!…]["')»”]*$/.test(words[i].w);
    const gap = i + 1 < words.length ? words[i + 1].start - words[i].end : Infinity;
    if (endsP || gap > 0.9 || i - a >= 40) flush(i);
  }
  return out;
}

function speakerOf(s, turns) {
  if (!turns?.length) return null;
  const acc = {};
  for (const t of turns) { const o = Math.min(s.end, t.end) - Math.max(s.start, t.start); if (o > 0) acc[t.speaker] = (acc[t.speaker] || 0) + o; }
  let best = null, bv = 0; for (const [k, v] of Object.entries(acc)) if (v > bv) { best = k; bv = v; }
  return best;
}

export function laughTokens(words) {
  const r = [];
  words.forEach((w, i) => { if (LAUGH_TOKEN.test(clean(w.w))) r.push({ t: w.start, w: w.w, i }); else if (/^\(.*\)$/.test(w.w) && /gül/.test(lc(w.w))) r.push({ t: w.start, w: w.w, i }); });
  // parenthesised multi-word tags like "(gülüşmeler)" arrive as one word; "[Müzik]" is not laughter
  return r;
}

// ---- hook ---------------------------------------------------------------------------------------------------------
export function hookOf(sents, k, words, windowStart) {
  const s = sents[k];
  const first = clean(words[s.i0].w);
  const unsure = words.slice(s.i0, s.i1 + 1).filter((w) => w.unsure && w.start < windowStart + 3);
  if (s.n < 3) return { yes: false, reason: `first sentence is only ${s.n} word(s): "${s.text}"` };
  if (NO_OPEN.has(first)) return { yes: false, reason: `opens with "${words[s.i0].w}", which needs the line before it` };
  if (REACTIONS.some((r) => lc(s.text).startsWith(r))) return { yes: false, reason: 'opens with a reaction; the setup is missing' };
  if (unsure.length) return { yes: false, reason: `unsure word in the first 3 s: "${unsure[0].w}"` };
  if (s.end - s.start > 9) return { yes: false, reason: `first sentence runs ${round(s.end - s.start, 1)} s before any point lands` };
  return { yes: true, reason: s.q ? 'opens with a self-contained question' : 'opens with a self-contained sentence' };
}

// ---- clips --------------------------------------------------------------------------------------------------------
function lowerBound(arr, key, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][key] < v) lo = m + 1; else hi = m; } return lo; }

export function proposeClips({ words, sents, bursts, tokens, turns, loudness, topN = 20 }) {
  const havePunct = sents.filter((s) => s.punct).length / Math.max(1, sents.length) > 0.3;
  const haveTurns = !!turns?.length;
  const w = { ...WEIGHTS }; if (!haveTurns) { w.turns = 0; }
  const wsum = Object.values(w).reduce((s, v) => s + v, 0);
  const loud = (loudness || []).filter((v) => v !== null);
  const lm = loud.length ? loud.reduce((s, v) => s + v, 0) / loud.length : 0;
  const lsd = loud.length ? Math.sqrt(loud.reduce((s, v) => s + (v - lm) ** 2, 0) / loud.length) || 1 : 1;
  // laughter events = audio bursts + transcript tokens, tokens within 2.5 s of a burst are the same event
  const events = bursts.map((b) => ({ start: b.start, end: b.end, audio: true, token: null }));
  for (const tk of tokens) {
    const near = events.find((e) => tk.t >= e.start - 2.5 && tk.t <= e.end + 2.5);
    if (near) near.token = tk.w; else events.push({ start: tk.t, end: tk.t + 0.8, audio: false, token: tk.w });
  }
  events.sort((a, b) => a.start - b.start);
  const turnList = (turns || []).slice().sort((a, b) => a.start - b.start);
  const cands = [];
  for (let a = 0; a < sents.length; a++) {
    const S = sents[a];
    for (let b = a; b < sents.length; b++) {
      const E = sents[b]; const dur = E.end - S.start;
      if (dur > MAX_DUR) break;
      if (dur < MIN_DUR) continue;
      const start = S.start, end = E.end;
      const why = [], pen = [];
      // laughter
      const ev = events.filter((e) => e.start >= start - 0.2 && e.start < end);
      const laugh = clamp(ev.length / Math.max(1, dur / 30) / 3);
      if (ev.length) why.push(`laughter: ${ev.length} event(s) at ${ev.map((e) => mmss(e.start) + (e.audio ? '' : ' (word only)') + (e.token ? ' "' + e.token + '"' : '')).join(', ')}`);
      const late = ev.some((e) => e.start >= start + dur * 0.65);
      const lateBonus = late ? 0.15 : 0;
      if (late) why.push('laugh lands in the last third (punchline then reaction)');
      if (ev.some((e) => e.start < end && e.end > end + 0.3 && e.audio)) pen.push(['clip ends in the middle of a laugh', 10]);
      if (ev.some((e) => e.start < start + dur * 0.1)) pen.push(['opens on a laugh, the joke is before the clip', 6]);
      // turns
      let tr = null;
      if (haveTurns) {
        let ch = 0, prev = null;
        for (const t of turnList) { if (t.end <= start || t.start >= end) continue; if (prev && prev.speaker !== t.speaker && t.start - prev.end < 1.5) ch++; prev = t; }
        tr = clamp(ch / (dur / 10) / 4);
        if (ch >= 3) why.push(`turns: ${ch} quick speaker changes in ${Math.round(dur)} s`);
      }
      // energy
      const lo = Math.floor(start), hi = Math.min((loudness || []).length, Math.ceil(end));
      const seg = []; for (let s = lo; s < hi; s++) if (loudness?.[s] != null) seg.push(loudness[s]);
      let energy = 0;
      if (seg.length >= 5) {
        const mean = seg.reduce((s, v) => s + v, 0) / seg.length;
        const zmean = (mean - lm) / lsd, zpeak = (Math.max(...seg) - lm) / lsd;
        energy = 0.5 * clamp(zmean / 1.5) + 0.5 * clamp(zpeak / 2.5);
        if (energy >= 0.5) why.push(`energy: window ${round(mean - lm, 1)} dB above the episode average, peak ${round(Math.max(...seg) - lm, 1)} dB`);
      }
      // text
      let react = 0, qa = 0; const hits = [];
      for (let k = a; k <= b; k++) {
        const sk = sents[k]; const low = lc(sk.text);
        if (k > a && sk.n <= 9 && REACTIONS.some((r) => low.includes(r))) { react++; hits.push(`"${sk.text.slice(0, 40)}" ${mmss(sk.start)}`); }
        if (sk.q && k < b && sents[k + 1].start - sk.end < 2.0) qa++;
      }
      const hook = hookOf(sents, a, words, start);
      const text = 0.45 * clamp(react / 2) + 0.2 * clamp(qa / 2) + 0.35 * (hook.yes ? 1 : 0);
      if (react) why.push(`text: reaction line after a setup (${hits.slice(0, 2).join('; ')})`);
      if (qa) why.push(`text: ${qa} question(s) answered within 2 s`);
      why.push(`hook ${hook.yes ? 'ok' : 'weak'}: ${hook.reason}`);
      // penalties
      if (!hook.yes && /needs the line before|reaction; the setup/.test(hook.reason)) pen.push(['needs earlier context', 12]);
      const prev = sents[a - 1];
      if (havePunct && /^\p{Ll}/u.test(words[S.i0].w)) pen.push(['starts mid-sentence (lower-case first word)', 15]);
      else if (prev && !prev.punct && S.start - prev.end < 0.3) pen.push(['starts mid-sentence (no pause or full stop before it)', 15]);
      let longGap = 0;
      for (let i = S.i0; i < E.i1; i++) if (words[i + 1].start - words[i].end > 2.5) longGap++;
      if (longGap) pen.push([`${longGap} silence(s) longer than 2.5 s`, Math.min(20, 10 * longGap)]);
      const uns = words.slice(S.i0, S.i1 + 1).filter((x) => x.unsure && x.start < start + 3).length;
      if (uns) pen.push([`${uns} unsure word(s) in the first 3 s`, Math.min(16, 8 * uns)]);
      const base = (w.laughter * clamp(laugh + lateBonus) + w.turns * (tr ?? 0) + w.energy * energy + w.text * text) / wsum;
      const penTotal = pen.reduce((s, p) => s + p[1], 0);
      const score = Math.max(0, round(100 * base - penTotal, 1));
      for (const p of pen) why.push(`penalty -${p[1]}: ${p[0]}`);
      cands.push({ a, b, start: round(start, 2), end: round(end, 2), score, hook, signals: { laughter: round(clamp(laugh + lateBonus), 2), turns: tr === null ? null : round(tr, 2), energy: round(energy, 2), text: round(text, 2) }, penalties: pen.map((p) => ({ why: p[0], points: p[1] })), why: why.join('; ') });
    }
  }
  cands.sort((x, y) => y.score - x.score || x.start - y.start);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= topN) break;
    if (picked.some((p) => Math.min(p.end, c.end) - Math.max(p.start, c.start) > 0.2 * Math.min(p.end - p.start, c.end - c.start))) continue;
    picked.push(c);
  }
  return picked.map(({ a, b, ...rest }) => ({ ...rest, excerpt: words.slice(sents[a].i0, sents[b].i1 + 1).map((x) => x.w).join(' ') }));
}

// ---- chapters -----------------------------------------------------------------------------------------------------
function stemKey(t) { return t.length > 5 ? t.slice(0, 5) : t; }

export function proposeChapters({ words, sents, duration, minGap }) {
  // vocabulary: content words, grouped by 5-letter stem (Turkish suffixes)
  const toks = words.map((x, i) => { const c = clean(x.w); return c.length >= 4 && !STOP.has(c) && !/^\d+$/.test(c) ? { k: stemKey(c), c, t: x.start, i } : null; }).filter(Boolean);
  const BLOCK = 30;
  const nb = Math.max(1, Math.ceil(duration / BLOCK));
  const df = new Map();
  const blockSets = Array.from({ length: nb }, () => new Set());
  for (const tk of toks) blockSets[Math.min(nb - 1, Math.floor(tk.t / BLOCK))].add(tk.k);
  for (const s of blockSets) for (const k of s) df.set(k, (df.get(k) || 0) + 1);
  const idf = (k) => Math.log((nb + 1) / ((df.get(k) || 0) + 1)) + 0.1;
  const vec = (a, b) => { const v = new Map(); for (const tk of toks) { if (tk.t >= b) break; if (tk.t >= a) v.set(tk.k, (v.get(tk.k) || 0) + idf(tk.k)); } return v; };
  const cos = (x, y) => { let d = 0, nx = 0, ny = 0; for (const [k, v] of x) { nx += v * v; const o = y.get(k); if (o) d += v * o; } for (const v of y.values()) ny += v * v; return nx && ny ? d / Math.sqrt(nx * ny) : 0; };
  const W = 75;
  const cand = [];
  for (let k = 1; k < sents.length; k++) {
    const t = sents[k].start;
    if (t < 45 || t > duration - 45) continue;
    const shift = 1 - cos(vec(t - W, t), vec(t, t + W));
    const gap = t - sents[k - 1].end;
    const pause = gap >= 2.5 ? 0.2 : gap >= 1.2 ? 0.1 : 0;
    const around = lc(sents[k - 1].text + ' ' + sents[k].text);
    const cue = CHAPTER_CUES.find((c) => around.includes(c));
    cand.push({ t, shift, pause, cue: cue || null, score: shift + pause + (cue ? 0.15 : 0) });
  }
  const target = clamp(Math.round(duration / 240), 3, 10);
  const pick = (gapMin) => {
    const chosen = [{ t: sents[0]?.start ?? 0, score: 0, shift: 0, pause: 0, cue: null, first: true }];
    for (const c of cand.slice().sort((x, y) => y.score - x.score)) {
      if (chosen.length >= target) break;
      if (chosen.every((p) => Math.abs(p.t - c.t) >= gapMin)) chosen.push(c);
    }
    return chosen;
  };
  let chosen = pick(minGap);
  if (chosen.length < 3) chosen = pick(60);
  chosen.sort((x, y) => x.t - y.t);
  chosen[0] = { ...chosen[0], t: 0 };
  // keywords per chapter
  return chosen.map((c, idx) => {
    const a = c.t, b = idx + 1 < chosen.length ? chosen[idx + 1].t : duration + 1;
    const tf = new Map(), forms = new Map();
    for (const tk of toks) { if (tk.t < a) continue; if (tk.t >= b) break; tf.set(tk.k, (tf.get(tk.k) || 0) + 1); const f = forms.get(tk.k) || new Map(); f.set(tk.c, (f.get(tk.c) || 0) + 1); forms.set(tk.k, f); }
    const ranked = [...tf.entries()].map(([k, n]) => [k, n * idf(k)]).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 6)
      .map(([k]) => [...forms.get(k).entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0][0]);
    return { start: round(c.t, 2), title_hint: ranked.slice(0, 3).join(', '), keywords: ranked, topic_shift: round(c.shift, 2), pause_before_s: c.first ? null : round(c.pause ? (c.pause >= 0.2 ? 2.5 : 1.2) : 0, 1), cue: c.cue };
  });
}

// ---- assemble -------------------------------------------------------------------------------------------------------
export function buildMoments({ words, speakers, audio, duration, topN = 20 }) {
  if (!words?.length) throw new Error('the word file has no words');
  const dur = duration || audio?.duration || words[words.length - 1].end;
  const sents = toSentences(words);
  const turns = speakers?.turns?.length ? speakers.turns : null;
  const tokens = laughTokens(words);
  const clips = proposeClips({ words, sents, bursts: audio?.bursts || [], tokens, turns, loudness: audio?.loudness, topN });
  const target = clamp(Math.round(dur / 240), 3, 10);
  const chapters = proposeChapters({ words, sents, duration: dur, minGap: Math.max(60, Math.round(0.5 * dur / target)) });
  const signals = { laughter_audio: !!audio, laughter_transcript: true, speaker_turns: !!turns, energy: !!audio, pitch: false, text: true };
  return {
    schema: 1, duration: round(dur, 1), signals_available: signals,
    weights: turns ? WEIGHTS : { ...WEIGHTS, turns: 0 },
    laughter: { audio_bursts: audio?.bursts?.length ?? null, transcript_tokens: tokens.length, noise_floor_db: audio?.noise_floor_db ?? null },
    clips, chapters,
    notes: ['Not listened to: signals are measured, the choice is the person\'s.', 'Pitch is not measured; energy is loudness only.', 'Laughter from audio is a pulse-pattern heuristic (see README for measured precision/recall on synthetic audio).'],
  };
}

export function renderMd(m, top = 8) {
  const L = [];
  L.push('# Moments: clip candidates and chapters', '');
  L.push(`Episode ${mmss(m.duration)}. Signals measured: ${Object.entries(m.signals_available).map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`).join(', ')}.`);
  L.push(`Laughter: ${m.laughter.audio_bursts ?? 'n/a'} audio bursts, ${m.laughter.transcript_tokens} transcript laugh words. Nobody has listened: pick by the times below, then listen to the 5 s before and after.`, '');
  L.push(`## Top ${top} clips`, '');
  m.clips.slice(0, top).forEach((c, i) => {
    L.push(`### ${i + 1}. ${mmss(c.start)} - ${mmss(c.end)} (${Math.round(c.end - c.start)} s), score ${c.score}`, '');
    L.push(`- Signals: laughter ${c.signals.laughter}, turns ${c.signals.turns ?? 'n/a'}, energy ${c.signals.energy}, text ${c.signals.text}`);
    L.push(`- Hook: ${c.hook.yes ? 'yes' : 'no'}, ${c.hook.reason}`);
    L.push(`- Why: ${c.why}`);
    L.push('', '> ' + (c.excerpt.length > 600 ? c.excerpt.slice(0, 600) + '…' : c.excerpt), '');
  });
  L.push('## Chapters', '');
  for (const c of m.chapters) L.push(`${mmss(c.start)} ${c.title_hint}  (${c.keywords.join(', ')})${c.cue ? `  [cue: "${c.cue}"]` : ''}`);
  L.push('', 'The title_hint is the most distinctive words of the chapter, not a title: write the final titles after reading the chapter.');
  return L.join('\n') + '\n';
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const n = argv[i + 1]; if (n === undefined || n.startsWith('--')) a[argv[i].slice(2)] = true; else { a[argv[i].slice(2)] = n; i++; } } else a._.push(argv[i]);
  }
  return a;
}
const die = (m, c = 2) => { console.error('moments: ' + m); process.exit(c); };

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.words || (!a.audio && !a['no-audio'])) die('usage: moments.mjs --audio <file> --words <words.json> [--speakers <speakers.json>] [--out <dir>] [--top 8] [--no-audio]', 64);
  let words, speakers = null;
  try { words = JSON.parse(readFileSync(a.words, 'utf8')).words; } catch (e) { die('cannot read the word file: ' + e.message); }
  if (a.speakers) { try { speakers = JSON.parse(readFileSync(a.speakers, 'utf8')); } catch (e) { die('cannot read speakers.json: ' + e.message); } }
  const t0 = Date.now();
  let audio = null;
  if (a.audio && !a['no-audio']) { try { audio = await analyzeAudio(a.audio); } catch (e) { die(e.message); } }
  const tAudio = Date.now() - t0;
  let m; try { m = buildMoments({ words, speakers, audio, topN: Number(a.top) > 8 ? Number(a.top) : 20 }); } catch (e) { die(e.message); }
  m.runtime_s = round((Date.now() - t0) / 1000, 1); m.runtime_audio_s = round(tAudio / 1000, 1);
  if (audio) m.laughter.bursts = audio.bursts;
  const out = resolve(a.out || dirname(resolve(a.words)));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'moments.json'), JSON.stringify(m, null, 2) + '\n');
  writeFileSync(join(out, 'moments.md'), renderMd(m, Number(a.top) || 8));
  console.log(`moments: ${m.clips.length} clips, ${m.chapters.length} chapters, ${m.laughter.audio_bursts ?? 'n/a'} audio laugh bursts, ${m.runtime_s} s -> ${out}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
