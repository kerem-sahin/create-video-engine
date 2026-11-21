import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { killTree, track } from '../lib/exec.mjs';
import { SHEET_MAX_COLS, SHEET_MAX_FRAMES, SHEET_MAX_WIDTH } from './thresholds.mjs';

export function toolEnv(extra = {}) {
  const extraPath = ['/opt/homebrew/bin', '/usr/local/bin'];
  const cur = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const path = [...cur, ...extraPath.filter((p) => !cur.includes(p))].join(delimiter);
  return { ...process.env, PATH: path, ...extra };
}

export function which(name) {
  for (const dir of toolEnv().PATH.split(delimiter)) {
    const p = join(dir, name);
    try {
      if (existsSync(p) && statSync(p).isFile()) return p;
    } catch { /* ignore */ }
  }
  return null;
}

/** Run a command, collect output as Buffers. Never throws. */
export function run(cmd, args, { cwd, env, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    let child;
    const out = [];
    const err = [];
    let timedOut = false;
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      child = spawn(cmd, args, { cwd, env: env ?? toolEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      track(child);
    } catch (e) {
      return done({ code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: e.message, timedOut: false });
    }
    const timer = timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        killTree(child);
        child.stdout.destroy();
        child.stderr.destroy();
        done({ code: null, stdout: Buffer.concat(out), stderr: Buffer.concat(err), error: null, timedOut: true });
      }, timeoutMs)
      : null;
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      done({ code: null, stdout: Buffer.concat(out), stderr: Buffer.concat(err), error: e.message, timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      done({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err), error: null, timedOut });
    });
  });
}

export const text = (buf) => buf.toString('utf8');

export function parseRate(s) {
  if (!s) return null;
  const [a, b] = String(s).split('/').map(Number);
  if (!Number.isFinite(a)) return null;
  if (b === undefined) return a;
  return b ? a / b : null;
}

export async function ffmpegVersion() {
  const r = await run('ffmpeg', ['-version']);
  const m = /ffmpeg version (\S+)/.exec(text(r.stdout));
  return m ? m[1] : null;
}

/** ffprobe summary. Returns { ok, error?, width, height, fps, duration, frames, hasAudio, ... } */
export async function probeMedia(file) {
  const r = await run('ffprobe', [
    '-v', 'error', '-count_packets', '-print_format', 'json', '-show_streams', '-show_format', file,
  ]);
  if (r.error) return { ok: false, error: `ffprobe could not start: ${r.error}` };
  let j;
  try { j = JSON.parse(text(r.stdout)); } catch { j = null; }
  if (r.code !== 0 || !j) {
    return { ok: false, error: text(r.stderr).trim().split('\n').pop() || `ffprobe exit ${r.code}` };
  }
  const v = (j.streams ?? []).find((s) => s.codec_type === 'video');
  const a = (j.streams ?? []).find((s) => s.codec_type === 'audio');
  if (!v) return { ok: false, error: 'no video stream' };
  const fps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate);
  const vDur = Number(v.duration);
  const fDur = Number(j.format?.duration);
  const duration = Number.isFinite(vDur) && vDur > 0 ? vDur : fDur;
  const nb = Number(v.nb_frames ?? v.nb_read_packets);
  return {
    ok: true,
    width: v.width,
    height: v.height,
    fps,
    duration,
    frames: Number.isFinite(nb) ? nb : null,
    hasAudio: Boolean(a),
    videoCodec: v.codec_name,
    audioCodec: a?.codec_name ?? null,
  };
}

/** Tile one frame per second (fewer for long videos) into a PNG <= SHEET_MAX_WIDTH wide. */
export async function makeContactSheet(video, outPng, duration) {
  const single = !(duration >= 1);
  const wanted = Math.max(1, Math.ceil(duration));
  const frames = single ? 1 : Math.min(wanted, SHEET_MAX_FRAMES);
  const fps = single ? 1 : frames / duration >= 1 ? 1 : frames / duration;
  const cols = Math.min(frames, SHEET_MAX_COLS);
  const rows = Math.ceil(frames / cols);
  const thumbW = Math.floor(SHEET_MAX_WIDTH / cols / 2) * 2;
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-y', '-i', video,
    '-vf', `${single ? '' : `fps=${fps},`}scale=${thumbW}:-2,tile=${cols}x${rows}`,
    '-frames:v', '1', '-update', '1', outPng,
  ]);
  const ok = r.code === 0 && existsSync(outPng);
  return {
    ok,
    error: ok ? null : text(r.stderr).trim().split('\n').pop(),
    cols, rows, frames, fps, thumbWidth: thumbW,
  };
}
