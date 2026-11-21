import * as C from './constants.mjs';
import { run, text } from '../verify/util.mjs';

/** Shot cuts from ffmpeg's scene score. */
export async function detectCuts(file) {
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', file, '-an',
    '-vf', `select='gt(scene,${C.SCENE_THRESHOLD})',showinfo`, '-f', 'null', '-',
  ]);
  if (r.code !== 0) return { ok: false, error: text(r.stderr).trim().split('\n').pop() };
  const raw = [];
  for (const m of text(r.stderr).matchAll(/\[Parsed_showinfo[^\]]*\].*?pts_time:\s*([\d.]+)/g)) raw.push(Number(m[1]));
  const cuts = [];
  for (const t of raw.sort((a, b) => a - b)) {
    if (t < 0.05) continue; // first frame is not a cut
    if (cuts.length && t - cuts[cuts.length - 1] < C.MIN_CUT_GAP_SECONDS) continue;
    cuts.push(Math.round(t * 1000) / 1000);
  }
  return { ok: true, cuts };
}

async function rawFrames(file, fps, width, pixFmt, channels) {
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-an',
    '-vf', `fps=${fps},scale=${width}:-2`, '-f', 'rawvideo', '-pix_fmt', pixFmt, '-',
  ]);
  if (r.code !== 0) return { ok: false, error: text(r.stderr).trim().split('\n').pop() };
  return { ok: true, buf: r.stdout, channels };
}

/** Dominant colours: tiny frames, coarse RGB grid, count, top N. */
export async function palette(file, width, height) {
  const w = C.PALETTE_THUMB_WIDTH;
  const h = Math.max(2, Math.round((w * height) / width / 2) * 2);
  const r = await rawFrames(file, C.PALETTE_SAMPLE_FPS, w, 'rgb24', 3);
  if (!r.ok) return r;
  const step = 256 / C.PALETTE_LEVELS;
  const counts = new Map();
  let total = 0;
  const buf = r.buf;
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const k = Math.floor(buf[i] / step) * 10000 + Math.floor(buf[i + 1] / step) * 100 + Math.floor(buf[i + 2] / step);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    total++;
  }
  if (!total) return { ok: false, error: 'no pixels decoded' };
  const hex = (q) => Math.min(255, Math.round(q * step + step / 2)).toString(16).padStart(2, '0');
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, C.PALETTE_SIZE).map(([k, n]) => ({
    hex: `#${hex(Math.floor(k / 10000))}${hex(Math.floor(k / 100) % 100)}${hex(k % 100)}`.toUpperCase(),
    share: Math.round((n / total) * 1000) / 1000,
  }));
  return { ok: true, palette: top, thumb: { w, h } };
}

/** Mean absolute luma difference between consecutive sampled frames, averaged per second. */
export async function motionEnergy(file, width, height, duration) {
  const w = C.MOTION_THUMB_WIDTH;
  const h = Math.max(2, Math.round((w * height) / width / 2) * 2);
  const r = await rawFrames(file, C.MOTION_SAMPLE_FPS, w, 'gray', 1);
  if (!r.ok) return r;
  const size = w * h;
  const n = Math.floor(r.buf.length / size);
  const seconds = Math.max(1, Math.ceil(duration));
  const sum = new Array(seconds).fill(0);
  const cnt = new Array(seconds).fill(0);
  for (let f = 1; f < n; f++) {
    let d = 0;
    const a = f * size;
    const b = (f - 1) * size;
    for (let i = 0; i < size; i++) d += Math.abs(r.buf[a + i] - r.buf[b + i]);
    const sec = Math.min(seconds - 1, Math.floor(f / C.MOTION_SAMPLE_FPS));
    sum[sec] += d / size;
    cnt[sec]++;
  }
  return { ok: true, energy: sum.map((s, i) => (cnt[i] ? Math.round((s / cnt[i]) * 100) / 100 : 0)) };
}

export function shotStats(cuts, duration) {
  const bounds = [0, ...cuts, duration];
  const shots = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end - start <= 0) continue;
    shots.push({ start: round(start), end: round(end), len: round(end - start) });
  }
  const lens = shots.map((s) => s.len).sort((a, b) => a - b);
  const mid = Math.floor(lens.length / 2);
  const median = lens.length ? (lens.length % 2 ? lens[mid] : (lens[mid - 1] + lens[mid]) / 2) : null;
  return {
    shots,
    shot_length: { min: lens[0] ?? null, median: median === null ? null : round(median), max: lens[lens.length - 1] ?? null },
    cuts_per_10s: duration > 0 ? round((cuts.length / duration) * 10) : null,
  };
}

const round = (n) => Math.round(n * 100) / 100;
