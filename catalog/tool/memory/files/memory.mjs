#!/usr/bin/env node
// memory: a show's memory, built from what it already published and growing with every episode.
//
//   node memory.mjs transcribe --show sources/show.json --memory brands/<slug>/memory [--language tr] [--model medium] [--episodes 1,4]
//      every episode with a local audio file (show-reader download, or a folder) and no transcript yet is transcribed
//      with the transcribe-local part: episodes/<nn>.words.json and a readable episodes/<nn>.txt ("[mm:ss] line").
//      Resumable: stop it any time, run it again, done episodes are skipped.
//   node memory.mjs index --memory brands/<slug>/memory [--show sources/show.json]
//      index.json + index.md: per episode facts; phrases that come back across episodes (with episode and time of
//      each use); capitalised names (people, places, things) with counts; the words the show uses about itself in
//      titles and descriptions. Writes a CHANNEL.md skeleton if there is none. Pure counting: it finds candidates,
//      the agent reads the transcripts and decides what they mean.
//   node memory.mjs status --show sources/show.json --memory brands/<slug>/memory
//
// Everything stays on this machine. Exit: 0 ok, 1 something failed its check, 2 cannot run, 64 usage.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const die = (m, c = 2) => { console.error('memory: ' + m); process.exit(c); };
const pad = (n) => String(n).padStart(2, '0');
export const mmss = (t) => { const s = Math.max(0, Math.round(t)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) { const k = t.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) a[k] = true; else { a[k] = v; i++; } }
    else a._.push(t);
  }
  return a;
}

// ---- text helpers (pure, tested) ---------------------------------------------------------------------------------
const lc = (s) => String(s).toLocaleLowerCase('tr');
export const norm = (w) => lc(w).replace(/[’‘`´]/g, "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '').replace(/'$/, '');
const SENT_END = /[.?!…]["'”»)]*$/;

// words -> readable lines: a new line at a sentence end or a pause of 0.8 s, at most 24 words
export function toLines(words, { pause = 0.8, max = 24 } = {}) {
  const lines = []; let cur = [];
  const flush = () => { if (cur.length) lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.w).join(' ') }); cur = []; };
  words.forEach((w, i) => {
    if (cur.length && (w.start - cur[cur.length - 1].end >= pause || cur.length >= max)) flush();
    cur.push(w);
    if (SENT_END.test(w.w)) flush();
    if (i === words.length - 1) flush();
  });
  return lines;
}

const STOP = new Set(('ve veya ile ama fakat çünkü ki de da mi mı mu mü ne bu şu o bir iki üç ben sen biz siz onlar bunu şunu onu bunun onun şunun ' +
  'bana sana ona bize size benim senin bizim sizin için gibi kadar daha çok az en hiç her bazı tüm bütün şey şeyi şeyler yani işte şimdi zaten aslında ' +
  'bence sonra önce hani diye dedi dedim diyor diyorum demek olarak olan oldu olur olmuş oluyor olsun ol var yok vardı yoktu değil evet hayır tamam ' +
  'peki neyse ya yaa e ee eee ıı hı he aynen öyle böyle şöyle orada burada oraya buraya nasıl neden niye nerede mesela bile artık yine falan filan gerçekten ' +
  'tabii tabi sadece belki biraz baya bayağı abi kanka oğlum olum lan be ha hadi gel git geldi gitti yaptı yapıyor yapıyorum etti ediyor edildi ' +
  'the a an and or but of to in on at for with is are was were be it this that you i we they he she my your our not no yes so just like really').split(/\s+/));

export const isStop = (w) => STOP.has(w) || w.length < 2 || /^\d+$/.test(w);

// phrases (2..4 words) that come back in at least `minEpisodes` episodes; not made of filler only
export function recurringPhrases(episodes, { minN = 2, maxN = 4, minEpisodes = 2, minTotal = 3, top = 60 } = {}) {
  const seen = new Map();
  for (const ep of episodes) {
    const toks = ep.words.map((w) => ({ t: norm(w.w), at: w.start })).filter((x) => x.t);
    for (let n = minN; n <= maxN; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const g = toks.slice(i, i + n);
        const content = g.filter((x) => !isStop(x.t)).length;
        if (content === 0 || isStop(g[0].t) && isStop(g[n - 1].t) && content < 2) continue;
        const key = g.map((x) => x.t).join(' ');
        let s = seen.get(key); if (!s) { s = { phrase: key, n, total: 0, episodes: new Set(), refs: [] }; seen.set(key, s); }
        s.total++; s.episodes.add(ep.n); if (s.refs.length < 6) s.refs.push([ep.n, Math.round(g[0].at)]);
      }
    }
  }
  let list = [...seen.values()].filter((s) => s.episodes.size >= minEpisodes && s.total >= minTotal);
  // a shorter phrase that only ever appears inside one longer phrase adds nothing
  list.sort((a, b) => b.n - a.n);
  const kept = [];
  for (const s of list) { if (!kept.some((k) => k.n > s.n && k.total >= s.total * 0.8 && (' ' + k.phrase + ' ').includes(' ' + s.phrase + ' '))) kept.push(s); }
  return kept.sort((a, b) => b.episodes.size - a.episodes.size || b.total - a.total || b.n - a.n).slice(0, top)
    .map((s) => ({ phrase: s.phrase, episodes: [...s.episodes].sort((x, y) => x - y), total: s.total, refs: s.refs }));
}

// capitalised words that are not at the start of a sentence: names of people, places, things (candidates only)
export function names(episodes, extraTexts = [], { top = 60 } = {}) {
  const m = new Map();
  const add = (raw, ep, at, from) => {
    const base = raw.replace(/[’‘`´]/g, "'").replace(/^[^\p{L}]+|[^\p{L}']+$/gu, '').split("'")[0];
    if (base.length < 2 || !/^\p{Lu}/u.test(base) || /^\p{Lu}+$/u.test(base) && base.length > 4) return;
    const k = base; let s = m.get(k); if (!s) { s = { name: k, total: 0, episodes: new Set(), refs: [], in_titles: 0 }; m.set(k, s); }
    if (from === 'text') s.in_titles++; else { s.total++; s.episodes.add(ep); if (s.refs.length < 4) s.refs.push([ep, Math.round(at)]); }
  };
  for (const ep of episodes) ep.words.forEach((w, i) => { if (i > 0 && !SENT_END.test(ep.words[i - 1].w)) add(w.w, ep.n, w.start, 'speech'); });
  // titles and descriptions: skip each sentence's first word; a Title Cased Line only confirms names found elsewhere
  const toks = (t) => String(t).split(/\s+/).filter(Boolean);
  const titleCase = (t) => { const w = toks(t).filter((x) => /^\p{L}/u.test(x)); return w.length >= 3 && w.filter((x) => /^\p{Lu}/u.test(x)).length / w.length >= 0.6; };
  const plain = extraTexts.filter((t) => !titleCase(t)), titled = extraTexts.filter(titleCase);
  for (const t of plain) toks(t).forEach((tok, i, arr) => { if (i > 0 && !SENT_END.test(arr[i - 1])) add(tok, null, 0, 'text'); });
  for (const t of titled) toks(t).forEach((tok) => { const k = tok.replace(/[’‘`´]/g, "'").replace(/^[^\p{L}]+|[^\p{L}']+$/gu, '').split("'")[0]; if (m.has(k)) add(tok, null, 0, 'text'); });
  return [...m.values()].filter((s) => s.total >= 2 || s.in_titles >= 1)
    .filter((s) => !isStop(norm(s.name)))
    .sort((a, b) => (b.in_titles > 0) - (a.in_titles > 0) || b.episodes.size - a.episodes.size || b.total - a.total)
    .slice(0, top).map((s) => ({ name: s.name, total: s.total, episodes: [...s.episodes].sort((x, y) => x - y), in_titles_or_descriptions: s.in_titles, refs: s.refs }));
}

// ---- files -------------------------------------------------------------------------------------------------------
const epBase = (mem, n) => join(mem, 'episodes', pad(n));
const readShow = (p) => { if (!existsSync(p)) die(`no such file: ${p} (run show-reader read first)`); return JSON.parse(readFileSync(p, 'utf8')); };

function findTranscribe(a) {
  if (typeof a.transcribe === 'string') return resolve(a.transcribe);
  for (const c of [join(here, '..', 'transcribe-local', 'transcribe.mjs'), join(here, '..', '..', 'transcribe-local', 'files', 'transcribe.mjs')]) if (existsSync(c)) return c;
  return die('the transcribe-local part is not installed (npx create-video-engine add transcribe-local)');
}

function transcribeCmd(a) {
  if (typeof a.show !== 'string' || typeof a.memory !== 'string') die('usage: transcribe --show show.json --memory <dir> [--language tr] [--model medium] [--episodes 1,4]', 64);
  const show = readShow(resolve(a.show)), mem = resolve(a.memory);
  const lang = typeof a.language === 'string' ? a.language : (show.show?.language || 'tr').slice(0, 2);
  const model = typeof a.model === 'string' ? a.model : 'medium';
  const script = findTranscribe(a);
  mkdirSync(join(mem, 'episodes'), { recursive: true });
  let eps = show.episodes;
  if (typeof a.episodes === 'string') { const want = new Set(a.episodes.split(',').map(Number)); eps = eps.filter((e) => want.has(e.n)); }
  const todo = eps.filter((e) => e.local && existsSync(e.local) && !existsSync(epBase(mem, e.n) + '.words.json'));
  const noAudio = eps.filter((e) => !e.local || !existsSync(e.local));
  console.log(`memory: ${todo.length} episode(s) to transcribe (${model}, ${lang}); ${eps.length - todo.length - noAudio.length} done; ${noAudio.length} without a local audio file`);
  const problems = [];
  for (const e of todo) {
    const t0 = Date.now(), out = epBase(mem, e.n) + '.words.json';
    console.log(`  ${e.n}: ${e.title ?? '(no title)'} ...`);
    const r = spawnSync(process.execPath, [script, e.local, '--language', lang, '--model', model, '--out', out], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (r.status !== 0 || !existsSync(out)) { problems.push(`${e.n}: transcribe-local failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`); continue; }
    writeEpisodeText(mem, e);
    console.log(`     done in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  for (const e of eps) if (existsSync(epBase(mem, e.n) + '.words.json') && !existsSync(epBase(mem, e.n) + '.txt')) writeEpisodeText(mem, e);
  if (problems.length) { console.error('memory: FAILED:\n  ' + problems.join('\n  ')); process.exit(1); }
}

function writeEpisodeText(mem, e) {
  const w = JSON.parse(readFileSync(epBase(mem, e.n) + '.words.json', 'utf8'));
  const head = [`# ${e.n}. ${e.title ?? '(title to ask)'}`, '', `${e.date ?? ''}${e.duration_s ? ` · ${mmss(e.duration_s)}` : ''} · transcript: ${w.engine ?? 'unknown'}${w.edited ? ', edited' : ''}. Words marked (?) are unsure.`, ''];
  if (e.description) head.push('> ' + e.description.replace(/\n+/g, '\n> '), '');
  const lines = toLines(w.words.map((x) => ({ ...x, w: x.unsure ? x.w + '(?)' : x.w })));
  writeFileSync(epBase(mem, e.n) + '.txt', head.concat(lines.map((l) => `[${mmss(l.start)}] ${l.text}`)).join('\n') + '\n');
}

function loadTranscripts(mem) {
  const dir = join(mem, 'episodes');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d+\.words\.json$/.test(f)).map((f) => {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    return { n: parseInt(f, 10), words: (j.words ?? []).filter((w) => w && typeof w.w === 'string'), duration: j.duration ?? null, engine: j.engine ?? null };
  }).sort((a, b) => a.n - b.n);
}

function indexCmd(a) {
  if (typeof a.memory !== 'string') die('usage: index --memory <dir> [--show show.json]', 64);
  const mem = resolve(a.memory);
  const show = typeof a.show === 'string' ? readShow(resolve(a.show)) : null;
  const eps = loadTranscripts(mem);
  const texts = show ? [show.show?.title, show.show?.description, ...show.episodes.flatMap((e) => [e.title, e.description])].filter(Boolean) : [];
  if (!eps.length && !texts.length) die('nothing to index: no transcripts in episodes/ and no --show', 1);
  const meta = new Map((show?.episodes ?? []).map((e) => [e.n, e]));
  const idx = {
    schema: 1, built_at: new Date().toISOString().slice(0, 10),
    show: show ? { title: show.show?.title ?? null, episodes_published: show.episodes.length, minutes_published: Math.round(show.episodes.reduce((s, e) => s + (e.duration_s ?? 0), 0) / 60) } : null,
    episodes: (show?.episodes ?? eps.map((e) => ({ n: e.n }))).map((e) => {
      const t = eps.find((x) => x.n === e.n);
      return { n: e.n, title: e.title ?? null, date: e.date ?? null, minutes: e.duration_s ? Math.round(e.duration_s / 60) : null, transcribed: !!t, words: t ? t.words.length : 0, unsure: t ? t.words.filter((w) => w.unsure).length : 0, engine: t?.engine ?? null };
    }),
    phrases: recurringPhrases(eps),
    names: names(eps, texts),
  };
  writeFileSync(join(mem, 'index.json'), JSON.stringify(idx, null, 1) + '\n');
  const ref = (r) => r.map(([n, t]) => `b${n} ${mmss(t)}`).join(', ');
  const md = [`# Memory index (${idx.built_at})`, '', 'Candidates found by counting. Read the transcripts before you call anything a running joke, a nickname or a theme; cite it as [b<n> mm:ss].', '',
    '## Episodes', '', '| # | date | min | title | transcript |', '|---|---|---|---|---|',
    ...idx.episodes.map((e) => `| ${e.n} | ${e.date ?? ''} | ${e.minutes ?? ''} | ${e.title ?? '(title to ask)'} | ${e.transcribed ? `${e.words} words${e.unsure ? `, ${e.unsure} unsure` : ''}` : 'no'} |`), '',
    '## Phrases that come back', '', ...(idx.phrases.length ? idx.phrases.map((p) => `- "${p.phrase}": ${p.total}x in ${p.episodes.length} episodes (${ref(p.refs)})`) : ['(none yet: needs two or more transcribed episodes)']), '',
    '## Names (people, places, things)', '', 'Third persons never go on screen; the person decides how the hosts are named.', '',
    ...(idx.names.length ? idx.names.map((x) => `- ${x.name}: ${x.total}x in ${x.episodes.length} episode(s)${x.in_titles_or_descriptions ? `, ${x.in_titles_or_descriptions}x in titles/descriptions` : ''}${x.refs.length ? ` (${ref(x.refs)})` : ''}`) : ['(none)']), ''];
  writeFileSync(join(mem, 'index.md'), md.join('\n'));
  const ch = join(mem, 'CHANNEL.md');
  if (!existsSync(ch)) writeFileSync(ch, readFileSync(join(here, 'CHANNEL.template.md'), 'utf8'));
  console.log(`memory: ${eps.length} transcript(s), ${idx.phrases.length} recurring phrase(s), ${idx.names.length} name(s) -> ${join(mem, 'index.md')}`);
}

function statusCmd(a) {
  if (typeof a.show !== 'string' || typeof a.memory !== 'string') die('usage: status --show show.json --memory <dir>', 64);
  const show = readShow(resolve(a.show)), mem = resolve(a.memory);
  for (const e of show.episodes) {
    const has = (x) => existsSync(epBase(mem, e.n) + x);
    console.log(`  ${pad(e.n)}  audio:${e.local && existsSync(e.local) ? 'yes' : e.audio?.url ? 'online' : 'no '}  transcript:${has('.words.json') ? 'yes' : 'no '}  notes:${has('.md') ? 'yes' : 'no '}  ${e.title ?? ''}`);
  }
  console.log(`  CHANNEL.md: ${existsSync(join(mem, 'CHANNEL.md')) ? 'yes' : 'no'}; index: ${existsSync(join(mem, 'index.json')) ? 'yes' : 'no'}`);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const a = parseArgs(process.argv.slice(2));
  if (a._[0] === 'transcribe') transcribeCmd(a);
  else if (a._[0] === 'index') indexCmd(a);
  else if (a._[0] === 'status') statusCmd(a);
  else die('usage: memory.mjs transcribe|index|status ... (see the header of this file)', 64);
}
