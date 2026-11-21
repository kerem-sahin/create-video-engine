// A/V sync test rig: a variable-frame-rate clip with a white flash and a 1 kHz beep at the same known instants,
// and a measurement of how far audio and picture are apart in any file made from it.
import { spawnSync } from 'node:child_process';

const env = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { env, encoding: opts.raw ? 'buffer' : 'utf8', maxBuffer: 1 << 30 });

/** Events: flash + beep (0.12 s each) at these source times; silence and black in between. */
export function makeVfrClip(file, { events, duration, dropEvery = 11, size = '160x90' }) {
  const on = events.map((t) => `between(t,${t - 0.01},${t + 0.115})`).join('+');
  const amp = events.map((t) => `between(t,${t},${t + 0.12})`).join('+');
  // video: 30 fps source, every `dropEvery`-th frame dropped but timestamps kept -> variable frame rate, like a phone
  // (frames around an event are all kept, so its onset frame always exists; events sit on the 30 fps grid)
  const keep = events.map((t) => `between(t,${t - 0.1},${t + 0.2})`).join('+');
  const r = run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${size}:r=30:d=${duration}`,
    '-f', 'lavfi', '-i', `aevalsrc='sin(2*PI*1000*t)*0.8*(${amp})':s=48000:d=${duration}`,
    '-vf', `drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='${on}',select='mod(n,${dropEvery})+(${keep})',format=yuv420p`,
    '-fps_mode', 'vfr', '-video_track_timescale', '600', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-t', String(duration), file]);
  if (r.status !== 0) throw new Error('makeVfrClip: ' + r.stderr);
}

/** [{ flash, beep, offset }] in the file's own clock (seconds); offset = beep - flash (positive: sound late). */
export function measureSync(file) {
  const fr = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time,best_effort_timestamp_time', '-of', 'csv=p=0', file]);
  const pts = fr.stdout.trim().split('\n').map((l) => parseFloat(l.split(',')[0]));
  const pix = run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-an', '-vf', 'scale=4:4,format=gray', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], { raw: true });
  const buf = pix.stdout;
  const n = Math.floor(buf.length / 16);
  if (n !== pts.length) throw new Error(`measureSync: ${n} frames decoded, ${pts.length} timestamps`);
  const flashes = [];
  let prev = false;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < 16; k++) s += buf[i * 16 + k];
    const lit = s / 16 > 128;
    if (lit && !prev) flashes.push(pts[i]);
    prev = lit;
  }
  const st = run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=start_time', '-of', 'csv=p=0', file]);
  const aStart = parseFloat(st.stdout) || 0;
  const au = run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { raw: true });
  const a = au.stdout;
  const beeps = [];
  let quiet = 0;
  for (let i = 0; i + 1 < a.length; i += 2) {
    const v = Math.abs(a.readInt16LE(i));
    if (v > 6000) { if (quiet >= 4800) beeps.push(aStart + i / 2 / 48000); quiet = 0; } else quiet++;
  }
  const m = Math.min(flashes.length, beeps.length);
  return { flashes, beeps, pairs: Array.from({ length: m }, (_, i) => ({ flash: flashes[i], beep: beeps[i], offset: beeps[i] - flashes[i] })) };
}
