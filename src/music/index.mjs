// music: the person picks the music, because only they can hear it.
//   music --mood "<words>" --duration <s> --out <dir> [--candidates 3] [--used <file>] [--json]
//       finds recorded CC0/CC BY tracks on Openverse (skipping ones the brand already used), writes each one fitted to the
//       video's length (assets/music/candidates/<n>.wav) and a 10 s preview (<n>-preview.mp3) for the person to listen to.
//   music --pick <n> --out <dir> [--used <file>] [--json]
//       makes candidate n the video's track (assets/music/track.wav), writes its credit and records it as used.
//   music --score <cues.json> --out <dir> [--json]
//       composes a bed and cue sounds in code on the edit's beat grid: a fallback only when the person asks for it
//       (it sounded alike across videos).
// Exit: 0 ok, 1 nothing usable found (deliver without music or ask for a track), 2 cannot run, 64 usage.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { which, run } from '../lib/exec.mjs';
import { finalize, probeAudio } from './audio.mjs';
import { creditFor, download, findCandidates } from './openverse.mjs';
import { resolveConfig, scoreJson, writeScoreWav } from './score.mjs';

const USAGE = 'usage: music --mood "<words>" --duration <s> --out <dir> [--candidates 3] [--used <file>] [--json]\n       music --pick <n> --out <dir> [--used <file>] [--json]\n       music --score <cues.json> --out <dir> [--json]';
const SCORED_CREDIT = { title: 'Scored music bed', creator: 'create-video-engine', licence: 'none (generated)', source: 'n/a', attribution: 'scored by create-video-engine, no licence restrictions' };

function parseArgs(argv) {
  const o = { mood: null, duration: null, out: null, used: null, candidates: 3, pick: null, score: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { o.json = true; continue; }
    if (!['--mood', '--duration', '--out', '--used', '--candidates', '--pick', '--score'].includes(a)) return { error: a.startsWith('--') ? `unknown option ${a}` : `unexpected argument ${a}` };
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    o[a.slice(2)] = v;
  }
  if (!o.out) return { error: 'missing --out <video-project-dir>' };
  if (o.score !== null || o.pick !== null) return o;
  if (!o.mood?.trim()) return { error: 'missing --mood "<words>" (or --pick <n>, or --score <cues.json>)' };
  o.duration = Number(o.duration);
  if (!Number.isFinite(o.duration) || o.duration < 3 || o.duration > 3600) return { error: '--duration must be 3..3600 seconds' };
  o.candidates = Number(o.candidates);
  if (!Number.isInteger(o.candidates) || o.candidates < 1 || o.candidates > 5) return { error: '--candidates must be 1..5' };
  return o;
}

const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
// a used list that exists but cannot be read must not be silently replaced (the brand's history would be lost)
function readUsed(p) {
  if (!existsSync(p)) return { tracks: [] };
  const j = readJson(p, null);
  if (!j || !Array.isArray(j.tracks ?? [])) throw new Error(`${p} exists but is not a used-tracks list; fix or move it`);
  return { ...j, tracks: j.tracks ?? [] };
}
const creditLine = (c) => `- "${c.title}" by ${c.creator} | licence: ${c.licence} | source: ${c.source} | ${c.attribution.replace(/\s+/g, ' ')}\n`;
// one music credit per video: a new pick replaces the old music line instead of piling up
function appendCredit(dir, credit) {
  const f = join(dir, 'CREDITS.md');
  const line = creditLine(credit);
  let text = existsSync(f) ? readFileSync(f, 'utf8') : '# Credits\n\n';
  text = text.split('\n').filter((l) => !l.startsWith('- [music] ')).join('\n');
  if (!text.endsWith('\n')) text += '\n';
  writeFileSync(f, text + '- [music] ' + line.slice(2));
}
const say = (args, obj, text) => process.stdout.write(args.json ? `${JSON.stringify(obj, null, 2)}\n` : text);

async function findCmd(args, fetchFn, dir) {
  const candDir = join(dir, 'assets', 'music', 'candidates');
  const used = args.used ? readUsed(resolve(args.used)) : { tracks: [] };
  const usedIds = new Set((used.tracks ?? []).map((t) => t.id));
  rmSync(candDir, { recursive: true, force: true });  // never leave an older search's candidates to be picked
  let found;
  try { found = await findCandidates(fetchFn, args.mood, args.duration); } catch (e) { process.stderr.write(`music: Openverse could not be reached (${e?.message ?? e}). Deliver without music or ask the person for a track.\n`); return 1; }
  const fresh = found.ranked.filter((r) => !usedIds.has(r.id ?? r.url));
  const tmp = mkdtempSync(join(tmpdir(), 'cve-music-'));
  const list = [];
  try {
    mkdirSync(candDir, { recursive: true });
    for (const r of fresh) {
      if (list.length >= args.candidates) break;
      const raw = join(tmp, `dl-${list.length}.bin`); // untrusted: only ever read by ffprobe/ffmpeg
      try {
        await download(fetchFn, r, raw);
        if (!(await probeAudio(raw))) continue;
        const n = list.length + 1;
        const wav = join(candDir, `${n}.wav`);
        if (await finalize(raw, wav, args.duration)) continue;
        const preview = join(candDir, `${n}-preview.mp3`);
        const pr = await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', wav, '-t', String(Math.min(10, args.duration)), '-af', 'afade=t=out:st=9:d=1', '-c:a', 'libmp3lame', '-q:a', '4', preview], { timeout: 60000 });
        const previewOk = pr.code === 0 && existsSync(preview);
        if (!previewOk) { rmSync(preview, { force: true }); process.stderr.write(`music: no preview for candidate ${n} (ffmpeg: ${(pr.stderr || '').trim().split('\n').pop() || 'failed'}); let the person listen to ${wav}\n`); }
        list.push({ n, id: r.id ?? r.url, file: wav, preview: previewOk ? preview : null, credit: creditFor(r) });
      } catch { /* next */ }
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (!list.length) {
    process.stderr.write(`music: no usable track for "${args.mood}" (${found.considered} considered, ${found.ranked.length - fresh.length} already used). Deliver without music or ask the person for a track.\n`);
    return 1;
  }
  writeFileSync(join(candDir, 'candidates.json'), `${JSON.stringify({ mood: args.mood, duration: args.duration, candidates: list }, null, 2)}\n`);
  say(args, { ok: true, candidates: list, considered: found.considered, skipped_as_used: found.ranked.length - fresh.length },
    `music: ${list.length} candidate(s) for "${args.mood}". Let the person listen and pick one; then: music --pick <n> --out ${dir}\n${list.map((c) => `  ${c.n}: "${c.credit.title}" by ${c.credit.creator} (${c.credit.licence})  ${c.preview ?? c.file}`).join('\n')}\n`);
  return 0;
}

function pickCmd(args, dir) {
  const candDir = join(dir, 'assets', 'music', 'candidates');
  const meta = readJson(join(candDir, 'candidates.json'), null);
  if (!meta) { process.stderr.write(`music: no candidates in ${candDir}; run music --mood ... first\n`); return 64; }
  const c = meta.candidates.find((x) => String(x.n) === String(args.pick));
  if (!c || !existsSync(c.file)) { process.stderr.write(`music: no candidate ${args.pick} (have ${meta.candidates.map((x) => x.n).join(', ')})\n`); return 64; }
  const dest = join(dir, 'assets', 'music', 'track.wav');
  copyFileSync(c.file, dest);
  appendCredit(dir, c.credit);
  if (args.used) {
    const p = resolve(args.used); const used = readUsed(p);
    used.tracks = [...(used.tracks ?? []), { id: c.id, title: c.credit.title, date: new Date().toISOString().slice(0, 10), video: dir }];
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${JSON.stringify(used, null, 2)}\n`);
  }
  say(args, { ok: true, file: dest, credit: c.credit }, `music: ${dest}\n"${c.credit.title}" by ${c.credit.creator} (${c.credit.licence})\n${c.credit.attribution}\n`);
  return 0;
}

async function scoreCmd(args, dir) {
  let cuesInput;
  try { cuesInput = JSON.parse(readFileSync(resolve(args.score), 'utf8')); } catch (e) { process.stderr.write(`cannot read --score ${args.score}: ${e.message}\n${USAGE}\n`); return 64; }
  const r = resolveConfig(cuesInput, {});
  if (r.error) { process.stderr.write(`bad cues.json: ${r.error}\n${USAGE}\n`); return 64; }
  const outDir = join(dir, 'assets', 'music');
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, 'track.wav');
  const plan = await writeScoreWav(dest, r.cfg);
  const sj = scoreJson(r.cfg, plan);
  writeFileSync(join(outDir, 'score.json'), `${JSON.stringify(sj, null, 2)}\n`);
  appendCredit(dir, SCORED_CREDIT);
  say(args, { ok: true, route: 'scored', file: dest, duration: sj.duration, bpm: sj.bpm, key: sj.key, mode: sj.mode, palette: sj.palette, style: sj.style, fingerprint: sj.fingerprint, cues: sj.cues.length },
    `music (scored): ${dest}\n${join(outDir, 'score.json')}\n${SCORED_CREDIT.attribution}\n`);
  return 0;
}

export async function runMusic(argv, { fetch: fetchFn = globalThis.fetch } = {}) {
  const args = parseArgs(argv);
  if (args.error) { process.stderr.write(`${args.error}\n${USAGE}\n`); return 64; }
  if (!which('ffmpeg') || !which('ffprobe')) { process.stderr.write('music needs ffmpeg and ffprobe on PATH\n'); return 2; }
  const dir = resolve(args.out);
  try {
    if (args.score !== null) return await scoreCmd(args, dir);
    if (args.pick !== null) return pickCmd(args, dir);
    return await findCmd(args, fetchFn, dir);
  } catch (e) {
    process.stderr.write(`music: ${e?.message ?? e}\n`);
    return 2;
  }
}
