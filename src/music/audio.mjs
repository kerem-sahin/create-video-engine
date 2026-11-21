import { run } from '../lib/exec.mjs';

export const FADE_IN = 0.4;
export const FADE_OUT = 1.5;

// Integrated loudness (LUFS) via ffmpeg ebur128; null if it could not be measured.
export async function measureLufs(file) {
  const r = await run('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { timeout: 120000 });
  const m = [...r.stderr.matchAll(/^\s*I:\s*(-?[\d.]+)\s*LUFS/gm)].pop();
  return m ? Number(m[1]) : null;
}

// Duration in seconds, only if ffprobe decodes the file as audio; null otherwise.
export async function probeAudio(file) {
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], { timeout: 30000 });
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    const d = Number(j.format?.duration);
    return j.streams?.length && d > 0 ? d : null;
  } catch { return null; }
}

// Loops/trims `input` to exactly `duration` seconds, 44.1 kHz 16-bit stereo WAV, with fades. The input is only ever read by ffmpeg.
export async function finalize(input, output, duration) {
  const fo = Math.min(FADE_OUT, duration / 2);
  const fi = Math.min(FADE_IN, duration / 4);
  const af = `aresample=44100,aformat=sample_fmts=s16:channel_layouts=stereo,apad=whole_dur=${duration},atrim=0:${duration},afade=t=in:st=0:d=${fi},afade=t=out:st=${(duration - fo).toFixed(3)}:d=${fo}`;
  const r = await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-stream_loop', '-1', '-i', input, '-vn', '-af', af, '-t', String(duration), '-c:a', 'pcm_s16le', output], { timeout: 300000 });
  return r.code === 0 ? null : r.stderr.trim().split('\n').pop() || 'ffmpeg failed';
}
