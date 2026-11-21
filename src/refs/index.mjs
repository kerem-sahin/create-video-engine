import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as C from './constants.mjs';
import { detectCuts, motionEnergy, palette, shotStats } from './analyze.mjs';
import { buildGrammar } from './grammar.mjs';
import { ffmpegVersion, makeContactSheet, probeMedia, run, text, which } from '../verify/util.mjs';

const USAGE = 'usage: refs <video-file-or-url> --out <dir> [--json]';

function parseArgs(argv) {
  const o = { input: null, out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--out') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: '--out needs a directory' };
      o.out = v;
    } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else if (o.input === null) o.input = a;
    else return { error: `unexpected argument ${a}` };
  }
  if (!o.input) return { error: 'missing <video-file-or-url>' };
  if (!o.out) return { error: 'missing --out <dir>' };
  return o;
}

export async function runRefs(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    process.stderr.write(`${args.error}\n${USAGE}\n`);
    return 64;
  }
  const err = (m) => process.stderr.write(`${m}\n`);
  if (!(await ffmpegVersion())) { err('ffmpeg not found on PATH'); return 2; }

  const out = resolve(args.out);
  let file;
  let tmp = null;
  const isUrl = /^https?:\/\//i.test(args.input);
  if (isUrl) {
    const ytdlp = which('yt-dlp');
    if (!ytdlp) { err('refs needs yt-dlp on PATH to fetch a URL. Install yt-dlp or pass a local video file.'); return 2; }
    tmp = mkdtempSync(join(tmpdir(), 'cve-refs-'));
    const d = await run(ytdlp, ['--no-playlist', '-f', 'mp4/bestvideo[ext=mp4]/best', '-o', join(tmp, 'source.%(ext)s'), args.input]);
    const got = readdirSync(tmp).find((f) => f.startsWith('source.'));
    if (d.code !== 0 || !got) {
      err(`yt-dlp could not fetch the URL: ${text(d.stderr).trim().split('\n').pop()}`);
      rmSync(tmp, { recursive: true, force: true });
      return 2;
    }
    file = join(tmp, got);
  } else {
    file = resolve(args.input);
    if (!existsSync(file)) { err(`file not found: ${file}`); return 2; }
  }

  try {
    const probe = await probeMedia(file);
    if (!probe.ok) { err(`cannot read the video: ${probe.error}`); return 2; }
    mkdirSync(join(out, 'frames'), { recursive: true });

    const [cutRes, pal, motion, frames, sheet] = await Promise.all([
      detectCuts(file),
      palette(file, probe.width, probe.height),
      motionEnergy(file, probe.width, probe.height, probe.duration),
      run('ffmpeg', [
        '-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', file, '-an',
        '-vf', `fps=${1 / C.FRAME_INTERVAL_SECONDS},scale=${C.FRAME_WIDTH}:-2`, join(out, 'frames', 'f_%04d.png'),
      ]),
      makeContactSheet(file, join(out, 'contact-sheet.png'), probe.duration),
    ]);
    for (const [name, r] of [['cut detection', cutRes], ['palette', pal], ['motion', motion]]) {
      if (!r.ok) { err(`${name} failed: ${r.error}`); return 2; }
    }
    if (frames.code !== 0) { err(`frame extraction failed: ${text(frames.stderr).trim().split('\n').pop()}`); return 2; }
    if (!sheet.ok) { err(`contact sheet failed: ${sheet.error}`); return 2; }

    const duration = Math.round(probe.duration * 1000) / 1000;
    const analysis = {
      schema: 1,
      source: isUrl ? args.input : file,
      duration,
      fps: Math.round(probe.fps * 100) / 100,
      width: probe.width,
      height: probe.height,
      cuts: cutRes.cuts,
      ...shotStats(cutRes.cuts, duration),
      palette: pal.palette,
      motion_energy: motion.energy,
      motion_energy_unit: `mean absolute luma difference (0-255) between frames sampled at ${C.MOTION_SAMPLE_FPS} fps, averaged per second`,
      params: {
        scene_threshold: C.SCENE_THRESHOLD,
        min_cut_gap_seconds: C.MIN_CUT_GAP_SECONDS,
        palette_levels_per_channel: C.PALETTE_LEVELS,
        palette_sample_fps: C.PALETTE_SAMPLE_FPS,
        frame_interval_seconds: C.FRAME_INTERVAL_SECONDS,
      },
    };
    writeFileSync(join(out, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
    writeFileSync(join(out, 'GRAMMAR.md'), buildGrammar(analysis));

    if (args.json) process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
    else {
      process.stdout.write([
        `refs ${analysis.source}`,
        `  ${duration}s ${analysis.width}x${analysis.height} ${analysis.fps}fps`,
        `  ${analysis.cuts.length} cut(s)${analysis.cuts.length ? ` at ${analysis.cuts.join(', ')}s` : ''}; median shot ${analysis.shot_length.median}s; ${analysis.cuts_per_10s} cuts per 10s`,
        `  palette ${analysis.palette.map((p) => p.hex).join(' ')}`,
        `  wrote ${out}/ (analysis.json, GRAMMAR.md, contact-sheet.png, frames/)`,
        '',
      ].join('\n'));
    }
    return 0;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}
