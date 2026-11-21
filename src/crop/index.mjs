import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { EXIT } from '../lib/constants.mjs';
import { err, out, printJson } from '../lib/log.mjs';
import { ffmpegVersion, probeMedia, run, text } from '../verify/util.mjs';
import { detectScreen, STATUS_BAR_SHARE } from './detect.mjs';

const USAGE = 'usage: crop <image> --out <file.png> [--auto] [--rect x,y,w,h] [--status-bar] [--json]';
// Images above this many pixels are analysed at reduced size (the crop itself always uses the original).
const MAX_ANALYSIS_PIXELS = 4_000_000;

function parseArgs(argv) {
  const o = { input: null, out: null, auto: false, rect: null, statusBar: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--auto') o.auto = true;
    else if (a === '--status-bar') o.statusBar = true;
    else if (a === '--json') o.json = true;
    else if (a === '--out' || a === '--rect') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--out') o.out = v;
      else {
        const m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(v);
        if (!m || Number(m[3]) < 1 || Number(m[4]) < 1) return { error: '--rect must be x,y,w,h in whole pixels (w and h at least 1)' };
        o.rect = { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
      }
    } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else if (o.input === null) o.input = a;
    else return { error: `unexpected argument ${a}` };
  }
  if (!o.input) return { error: 'missing <image>' };
  if (!o.out) return { error: 'missing --out <file.png>' };
  if (!/\.png$/i.test(o.out)) return { error: '--out must end in .png' };
  if (o.auto && o.rect) return { error: 'use --auto or --rect, not both' };
  if (!o.auto && !o.rect && !o.statusBar) return { error: 'nothing to do: give --auto, --rect or --status-bar' };
  return o;
}

async function decode(file, width, height) {
  const scale = width * height > MAX_ANALYSIS_PIXELS ? Math.sqrt(MAX_ANALYSIS_PIXELS / (width * height)) : 1;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const r = await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area,format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  if (r.code !== 0 || r.stdout.length !== w * h * 3) return null;
  return { data: new Uint8Array(r.stdout), width: w, height: h, scale: w / width };
}

export async function runCrop(argv) {
  const args = parseArgs(argv);
  if (args.error) { err(args.error); err(USAGE); return EXIT.USAGE; }
  if (!(await ffmpegVersion())) { err('ffmpeg not found on PATH'); return EXIT.CANNOT_RUN; }
  const input = resolve(args.input);
  const output = resolve(args.out);
  if (!existsSync(input)) { err(`file not found: ${input}`); return EXIT.CANNOT_RUN; }
  const probe = await probeMedia(input);
  if (!probe.ok) { err(`cannot read the image: ${probe.error}`); return EXIT.CANNOT_RUN; }
  const W = probe.width; const H = probe.height;

  let rect = { x: 0, y: 0, w: W, h: H };
  const notes = [];
  let unchanged = false;
  if (args.rect) {
    const r = args.rect;
    if (r.x + r.w > W || r.y + r.h > H) { err(`--rect ${r.x},${r.y},${r.w},${r.h} is outside the ${W}x${H} image`); return EXIT.USAGE; }
    rect = r;
    notes.push('manual rectangle');
  } else if (args.auto) {
    const img = await decode(input, W, H);
    if (!img) { err('could not decode the image'); return EXIT.CANNOT_RUN; }
    const d = detectScreen(img);
    if (d.status === 'not-confident') {
      err(`crop --auto found no confident screen rectangle in ${input} (${W}x${H}): ${d.reason}. Look at the image: if it is already the bare app screen, use it as it is; otherwise crop by hand with --rect x,y,w,h.`);
      return EXIT.FAIL;
    }
    if (d.status === 'cropped') {
      const s = 1 / img.scale;
      const x0 = Math.round(d.rect.x * s); const y0 = Math.round(d.rect.y * s);
      const x1 = Math.min(W, Math.round((d.rect.x + d.rect.w) * s)); const y1 = Math.min(H, Math.round((d.rect.y + d.rect.h) * s));
      rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const t = d.bezel.reduce((a, b) => a + b, 0);
      notes.push(t > 0 ? `screen found, device bezel trimmed (${d.bezel.join('/')} px at analysis size, top/bottom/left/right)` : 'screen found');
    } else {
      unchanged = true;
      notes.push(`left unchanged: ${d.reason}`);
    }
  }
  if (args.statusBar) {
    const cut = Math.round(rect.h * STATUS_BAR_SHARE);
    rect = { x: rect.x, y: rect.y + cut, w: rect.w, h: rect.h - cut };
    unchanged = false;
    notes.push(`status bar trimmed (${cut} px = ${Math.round(STATUS_BAR_SHARE * 100)}% of the height)`);
  }

  mkdirSync(dirname(output), { recursive: true });
  if (rect.x === 0 && rect.y === 0 && rect.w === W && rect.h === H) {
    const ok = await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', input, '-frames:v', '1', output]);
    if (ok.code !== 0) { err(`ffmpeg failed: ${text(ok.stderr).trim().split('\n').pop()}`); return EXIT.CANNOT_RUN; }
    unchanged = true;
  } else {
    const r = await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', input, '-frames:v', '1', '-vf', `crop=${rect.w}:${rect.h}:${rect.x}:${rect.y}`, output]);
    if (r.code !== 0) { err(`ffmpeg failed: ${text(r.stderr).trim().split('\n').pop()}`); return EXIT.CANNOT_RUN; }
  }
  const result = { input, output, input_size: { width: W, height: H }, rect, unchanged, notes };
  if (args.json) printJson(result);
  else out(`crop ${input} ${W}x${H} -> ${unchanged ? 'unchanged' : `x=${rect.x} y=${rect.y} ${rect.w}x${rect.h}`} (${notes.join('; ')})\n  wrote ${output}`);
  return EXIT.OK;
}
