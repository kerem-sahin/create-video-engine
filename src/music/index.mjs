import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { which } from '../lib/exec.mjs';
import { finalize, probeAudio } from './audio.mjs';
import { creditFor, download, findCandidates } from './openverse.mjs';
import { resolveConfig, scoreJson, writeScoreWav } from './score.mjs';

const USAGE = 'usage: music --score <cues.json> --out <video-project-dir> [--json]\n       music --mood "<words>" --duration <seconds> --out <video-project-dir> [--bpm <n>] [--source openverse] [--offline] [--json]';
const SCORED_CREDIT = {
  title: 'Scored music bed', creator: 'create-video-engine', licence: 'none (generated)', source: 'n/a',
  attribution: 'scored by create-video-engine, no licence restrictions',
};

function parseArgs(argv) {
  const o = { mood: null, duration: null, out: null, bpm: null, score: null, source: null, offline: false, json: false };
  const val = (i, name) => { const v = argv[i]; return v === undefined || v.startsWith('--') ? { error: `${name} needs a value` } : v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--offline') o.offline = true;
    else if (['--mood', '--duration', '--out', '--bpm', '--score', '--source'].includes(a)) {
      const v = val(++i, a);
      if (v.error) return v;
      o[a.slice(2)] = v;
    } else return { error: a.startsWith('--') ? `unknown option ${a}` : `unexpected argument ${a}` };
  }
  if (!o.out) return { error: 'missing --out <video-project-dir>' };
  if (o.source !== null && o.source !== 'openverse') return { error: '--source must be openverse' };
  if (o.score !== null && o.source !== null) return { error: '--score and --source openverse cannot be combined' };
  if (o.score === null && !o.mood?.trim()) return { error: 'missing --mood (or --score <cues.json>)' };
  if (o.score === null || o.duration !== null) {
    o.duration = Number(o.duration);
    if (!Number.isFinite(o.duration) || o.duration < 3 || o.duration > 3600) return { error: '--duration must be 3..3600 seconds' };
  }
  if (o.bpm !== null) {
    o.bpm = Number(o.bpm);
    if (!Number.isFinite(o.bpm) || o.bpm < 40 || o.bpm > 200) return { error: '--bpm must be 40..200' };
  }
  return o;
}

function appendCredit(dir, credit) {
  const line = `- "${credit.title}" by ${credit.creator} | licence: ${credit.licence} | source: ${credit.source} | ${credit.attribution.replace(/\s+/g, ' ')}\n`;
  const credits = join(dir, 'CREDITS.md');
  if (!existsSync(credits)) writeFileSync(credits, '# Credits\n\n');
  appendFileSync(credits, line);
}

async function tryOpenverse(fetchFn, args, tmp, dest) {
  let found;
  try { found = await findCandidates(fetchFn, args.mood, args.duration); } catch { return { considered: 0 }; }
  for (const r of found.ranked.slice(0, 3)) {
    const raw = join(tmp, 'download.bin'); // untrusted: only ever read by ffprobe/ffmpeg
    try {
      await download(fetchFn, r, raw);
      if (!(await probeAudio(raw))) continue;
      if (await finalize(raw, dest, args.duration)) continue;
      return { considered: found.considered, credit: creditFor(r) };
    } catch { /* try the next candidate */ }
  }
  return { considered: found.considered };
}

export async function runMusic(argv, { fetch: fetchFn = globalThis.fetch } = {}) {
  const args = parseArgs(argv);
  if (args.error) { process.stderr.write(`${args.error}\n${USAGE}\n`); return 64; }
  if (!which('ffmpeg') || !which('ffprobe')) { process.stderr.write('music needs ffmpeg and ffprobe on PATH\n'); return 2; }

  const dir = resolve(args.out);
  const outDir = join(dir, 'assets', 'music');
  const dest = join(outDir, 'track.wav');
  const tmp = mkdtempSync(join(tmpdir(), 'cve-music-'));
  try {
    mkdirSync(outDir, { recursive: true });
    let route = 'generated';
    let credit;
    let bpm = null;
    let considered = 0;
    if (args.score) {
      let cuesInput;
      try { cuesInput = JSON.parse(readFileSync(resolve(args.score), 'utf8')); } catch (e) { process.stderr.write(`cannot read --score ${args.score}: ${e.message}\n${USAGE}\n`); return 64; }
      const r = resolveConfig(cuesInput, { mood: args.mood, duration: args.duration, bpm: args.bpm });
      if (r.error) { process.stderr.write(`bad cues.json: ${r.error}\n${USAGE}\n`); return 64; }
      const plan = await writeScoreWav(dest, r.cfg);
      const sj = scoreJson(r.cfg, plan);
      writeFileSync(join(outDir, 'score.json'), `${JSON.stringify(sj, null, 2)}\n`);
      appendCredit(dir, SCORED_CREDIT);
      const result = { ok: true, route: 'scored', file: dest, duration: sj.duration, bpm: sj.bpm, key: sj.key, mode: sj.mode, palette: sj.palette, style: sj.style, fingerprint: sj.fingerprint, cues: sj.cues.length };
      if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else process.stdout.write(`music (scored): ${dest}\n${join(outDir, 'score.json')}\n${SCORED_CREDIT.attribution}\n`);
      return 0;
    }
    if (args.source === 'openverse' && !args.offline) {
      const r = await tryOpenverse(fetchFn, args, tmp, dest);
      considered = r.considered;
      if (r.credit) { route = 'openverse'; credit = r.credit; }
    }
    if (route === 'generated') {
      const r = resolveConfig({}, { mood: args.mood, duration: args.duration, bpm: args.bpm });
      if (r.error) { process.stderr.write(`${r.error}\n${USAGE}\n`); return 64; }
      const plan = await writeScoreWav(dest, r.cfg);
      const sj = scoreJson(r.cfg, plan);
      writeFileSync(join(outDir, 'score.json'), `${JSON.stringify(sj, null, 2)}\n`);
      bpm = sj.bpm;
      credit = SCORED_CREDIT;
    }
    appendCredit(dir, credit);
    const result = { ok: true, route, file: dest, duration: args.duration, bpm, credit, candidates_considered: considered };
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`music (${route}): ${dest}\n${credit.attribution}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`music: ${e?.message ?? e}\n`);
    return 2;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
