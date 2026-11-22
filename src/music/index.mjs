// music: find a real recorded track (CC0 / CC BY on Openverse) by feel and length. Nothing is composed in code:
// nobody can hear whether generated music is good, and every generated bed sounded alike. The person's own track
// always comes first; this is the fallback. Tracks already used by the brand are skipped (--used).
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { which } from '../lib/exec.mjs';
import { finalize, probeAudio } from './audio.mjs';
import { creditFor, download, findCandidates } from './openverse.mjs';

const USAGE = 'usage: music --mood "<words>" --duration <seconds> --out <video-project-dir> [--used brands/<slug>/music-used.json] [--json]';

function parseArgs(argv) {
  const o = { mood: null, duration: null, out: null, used: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { o.json = true; continue; }
    if (!['--mood', '--duration', '--out', '--used'].includes(a)) return { error: a.startsWith('--') ? `unknown option ${a}` : `unexpected argument ${a}` };
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    o[a.slice(2)] = v;
  }
  if (!o.out) return { error: 'missing --out <video-project-dir>' };
  if (!o.mood?.trim()) return { error: 'missing --mood "<words>"' };
  o.duration = Number(o.duration);
  if (!Number.isFinite(o.duration) || o.duration < 3 || o.duration > 3600) return { error: '--duration must be 3..3600 seconds' };
  return o;
}

const readUsed = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { tracks: [] }; } };

export async function runMusic(argv, { fetch: fetchFn = globalThis.fetch } = {}) {
  const args = parseArgs(argv);
  if (args.error) { process.stderr.write(`${args.error}\n${USAGE}\n`); return 64; }
  if (!which('ffmpeg') || !which('ffprobe')) { process.stderr.write('music needs ffmpeg and ffprobe on PATH\n'); return 2; }
  const dir = resolve(args.out);
  const outDir = join(dir, 'assets', 'music');
  const dest = join(outDir, 'track.wav');
  const usedPath = args.used ? resolve(args.used) : null;
  const used = usedPath ? readUsed(usedPath) : { tracks: [] };
  const usedIds = new Set((used.tracks ?? []).map((t) => t.id));
  const tmp = mkdtempSync(join(tmpdir(), 'cve-music-'));
  try {
    let found;
    try { found = await findCandidates(fetchFn, args.mood, args.duration); } catch (e) { process.stderr.write(`music: Openverse could not be reached (${e?.message ?? e}). Deliver without music or ask the person for a track.\n`); return 1; }
    const fresh = found.ranked.filter((r) => !usedIds.has(r.id ?? r.url));
    for (const r of fresh.slice(0, 4)) {
      const raw = join(tmp, 'download.bin'); // untrusted: only ever read by ffprobe/ffmpeg
      try {
        await download(fetchFn, r, raw);
        if (!(await probeAudio(raw))) continue;
        mkdirSync(outDir, { recursive: true });
        if (await finalize(raw, dest, args.duration)) continue;
        const credit = creditFor(r);
        const credits = join(dir, 'CREDITS.md');
        if (!existsSync(credits)) writeFileSync(credits, '# Credits\n\n');
        appendFileSync(credits, `- "${credit.title}" by ${credit.creator} | licence: ${credit.licence} | source: ${credit.source} | ${credit.attribution.replace(/\s+/g, ' ')}\n`);
        if (usedPath) {
          used.tracks = [...(used.tracks ?? []), { id: r.id ?? r.url, title: credit.title, date: new Date().toISOString().slice(0, 10), video: dir }];
          mkdirSync(dirname(usedPath), { recursive: true });
          writeFileSync(usedPath, `${JSON.stringify(used, null, 2)}\n`);
        }
        const result = { ok: true, file: dest, duration: args.duration, credit, candidates_considered: found.considered, skipped_as_used: found.ranked.length - fresh.length };
        if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        else process.stdout.write(`music: ${dest}\n"${credit.title}" by ${credit.creator} (${credit.licence})\n${credit.attribution}\n`);
        return 0;
      } catch { /* try the next candidate */ }
    }
    process.stderr.write(`music: no usable track for "${args.mood}" (${found.considered} considered, ${found.ranked.length - fresh.length} already used). Deliver without music or ask the person for a track.\n`);
    return 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
