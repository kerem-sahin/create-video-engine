#!/usr/bin/env node
// normalize: any phone/camera recording -> one constant-frame-rate, upright working copy, so that transcription,
// cutting, captions and the final assembly all read the SAME clock.
//
//   node normalize.mjs <video> --out work.mp4 [--fps 30] [--max-side 1920 | --keep-size] [--crf 16] [--preset superfast] [--no-hwaccel]
//
// Why: phones write variable-frame-rate video (timestamps jitter, frames are skipped, `avg_frame_rate` is e.g. 29.67)
// with the rotation stored as a flag. Cutting by time on such a file and counting frames at an average rate drifts the
// picture against the sound (0.2 s in a 64 s clip). A working copy with a fixed frame grid cannot drift.
// What it does (one ffmpeg pass, no shell):
//   - rotation baked in (ffmpeg autorotate; the output has no rotation flag), long side capped at --max-side (1920)
//   - `fps` filter: constant 30 fps (or --fps; fractions like 30000/1001 are kept exact), timestamps from the source
//   - audio: 48 kHz, first sample at 0 (a late-starting track is padded with silence), padded/cut to the picture length
//   - decoding on the Mac's media engine (videotoolbox; --no-hwaccel to turn off); x264 `superfast` (a 30 min phone clip
//     takes ~10 min on an 8 GB M1; `veryfast` is 1.7x slower for a smaller file)
//   - H.264 yuv420p, CRF 16, a keyframe every second (regular GOP, no scene-cut keyframes), AAC 192k, +faststart
//   - HDR (HLG/PQ) is converted to 8-bit BT.709 WITHOUT tone mapping (this ffmpeg has no zscale): colours are a little
//     flat; the report says `hdr: true`. Look at one frame.
// It then MEASURES the result and refuses (exit 1) if it is not what it claims: constant timestamp step, no rotation
// flag, audio and picture the same length (within one frame), frame count = duration x fps. The numbers go to
// <out>.normalize.json and the screen, including the source's own jitter, so the claim "it was VFR" is a measurement.
// Audio-only input (a podcast m4a): no picture is invented. The working file is audio: `.m4a` (AAC 192k, default),
// `.wav` (16-bit PCM) when --out says so, or an audio-only `.mp4`/`.mov` (AAC, no video track) when --out says that.
// 48 kHz, channels kept (mono stays mono), first sample at 0 (a late start is padded with silence). Measured and
// reported: duration, sample rate, channels, start time, integrated loudness (LUFS), true peak; `problems` lists any miss.
// Exit: 0 ok, 1 result failed its own check, 2 cannot run, 64 usage.
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const r3 = (x) => Math.round(x * 1000) / 1000;
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) { const n = argv[i + 1]; if (n === undefined || (n.startsWith("--") && !/^-\d/.test(n))) a[t.slice(2)] = true; else { a[t.slice(2)] = n; i++; } } else a._.push(t);
  }
  return a;
}
const die = (m, c = 2) => { console.error("normalize: " + m); process.exit(c); };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.error) die(`cannot run ${cmd}: ${r.error.message} (brew install ffmpeg)`);
  return r;
};
const frac = (s) => { if (!s || s === "0/0") return null; const [n, d = 1] = String(s).split("/").map(Number); return n && d ? n / d : null; };

function probe(file) {
  const r = run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (r.status !== 0) die(`ffprobe failed on ${file}: ${r.stderr.trim()}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video");
  const au = j.streams.find((s) => s.codec_type === "audio");
  const rot = (v?.side_data_list || []).find((x) => x.rotation !== undefined)?.rotation ?? (v?.tags?.rotate !== undefined ? -Number(v.tags.rotate) : 0);
  return { v, au, rotation: Number(rot) || 0, format: j.format, rFps: frac(v?.r_frame_rate), avgFps: frac(v?.avg_frame_rate) };
}

// timestamps of the video packets (presentation order): { n, minStep, maxStep, maxDev } in seconds
function timestampStats(file) {
  const r = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file]);
  const t = r.stdout.trim().split("\n").map(parseFloat).filter(isFinite).sort((x, y) => x - y);
  if (t.length < 2) return { n: t.length, minStep: 0, maxStep: 0, median: 0 };
  const steps = [];
  for (let i = 1; i < t.length; i++) steps.push(t[i] - t[i - 1]);
  const sorted = [...steps].sort((x, y) => x - y);
  return { n: t.length, minStep: sorted[0], maxStep: sorted[sorted.length - 1], median: sorted[Math.floor(sorted.length / 2)], first: t[0], last: t[t.length - 1] };
}

function measureLoudness(file) {
  const r = run("ffmpeg", ["-hide_banner", "-nostdin", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"]);
  const sum = r.stderr.slice(Math.max(0, r.stderr.lastIndexOf("Integrated loudness:")));
  const num = (re) => { const m = sum.match(re); return m ? (m[1] === "-inf" ? -120 : +m[1]) : NaN; };
  const i = num(/\bI:\s+(-?[\d.]+|-inf) LUFS/), tp = num(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
  return { lufs: isFinite(i) ? i : null, true_peak_db: isFinite(tp) ? tp : null };
}

function normalizeAudio(a, p, src, out) {
  const ext = extname(out).toLowerCase();
  if (![".m4a", ".wav", ".mp4", ".mov"].includes(ext)) die(`audio-only input: --out must end in .m4a, .wav, .mp4 or .mov (got "${ext}")`, 64);
  const wav = ext === ".wav", asVideoContainer = ext === ".mp4" || ext === ".mov";
  const channels = Number(p.au.channels) || 0;
  if (!(channels >= 1)) die("cannot read the channel count");
  const sstart = parseFloat(p.au.start_time) || 0;
  const sdur = parseFloat(p.au.duration) || (parseFloat(p.format.duration) - sstart);
  if (!(sdur > 0)) die("cannot read the audio duration");
  const expected = sstart + sdur;   // a late start is padded, so the file keeps the source's end time
  const args = ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y", "-i", src, "-map", "0:a:0", "-vn", "-map_metadata", "-1",
    "-af", (sstart > 0.001 ? `adelay=${Math.round(sstart * 1000)}:all=1,` : "") + "aresample=48000:first_pts=0", "-ar", "48000", "-ac", String(channels)];
  if (wav) args.push("-c:a", "pcm_s16le"); else args.push("-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart");
  args.push(out);
  mkdirSync(dirname(out), { recursive: true });
  const t0 = Date.now();
  const r = run("ffmpeg", args);
  if (r.status !== 0) die("ffmpeg failed:\n" + r.stderr.slice(-1500));
  const secs = (Date.now() - t0) / 1000;

  const q = probe(out);
  const problems = [];
  if (!q.au) problems.push("output has no audio stream");
  if (q.v) problems.push("output has a video stream");
  const od = q.au ? (parseFloat(q.au.duration) || parseFloat(q.format.duration)) : NaN;
  const ostart = q.au ? parseFloat(q.au.start_time || 0) : NaN;
  const loud = q.au ? measureLoudness(out) : { lufs: null, true_peak_db: null };
  if (q.au) {
    if (!isFinite(od) || Math.abs(od - expected) > 0.05) problems.push(`duration ${r3(od)} s, expected ${r3(expected)} s`);
    if (Math.abs(ostart) > 0.02) problems.push(`audio starts at ${r3(ostart)} s`);
    if (Number(q.au.sample_rate) !== 48000) problems.push(`sample rate ${q.au.sample_rate}`);
    if (Number(q.au.channels) !== channels) problems.push(`${q.au.channels} channels, source has ${channels}`);
    if (loud.lufs === null) problems.push("loudness could not be measured");
  }
  const report = {
    schema: 1, mode: "audio", source: src, out, container: wav ? "wav" : asVideoContainer ? "audio-only " + ext.slice(1) : "m4a", seconds_to_make: r3(secs),
    source_info: { codec: p.au.codec_name, sample_rate: Number(p.au.sample_rate), channels, start_time: r3(sstart), duration: r3(sdur) },
    result: { codec: q.au?.codec_name ?? null, sample_rate: q.au ? Number(q.au.sample_rate) : null, channels: q.au ? Number(q.au.channels) : null, start_time: isFinite(ostart) ? r3(ostart) : null, duration: isFinite(od) ? r3(od) : null, lufs: loud.lufs, true_peak_db: loud.true_peak_db, video_streams: q.v ? 1 : 0 },
    problems,
  };
  writeFileSync(out + ".normalize.json", JSON.stringify(report, null, 2) + "\n");
  console.log(`normalize: audio-only source (${p.au.codec_name}, ${p.au.sample_rate} Hz, ${channels} ch, starts at ${report.source_info.start_time} s)`);
  console.log(`  -> ${report.container}${asVideoContainer ? " (no picture)" : ""}, ${report.result.sample_rate} Hz, ${report.result.channels} ch, ${report.result.duration} s, start ${report.result.start_time} s, ${report.result.lufs} LUFS (peak ${report.result.true_peak_db} dBFS), ${r3(secs)}s to make -> ${out}`);
  if (problems.length) { console.error("normalize: the result failed its own check:\n  " + problems.join("\n  ")); process.exit(1); }
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const input = a._[0];
  if (!input || typeof a.out !== "string") die("usage: normalize.mjs <video> --out <work.mp4> [--fps 30] [--max-side 1920 | --keep-size]", 64);
  const src = resolve(input), out = resolve(a.out);
  if (!existsSync(src)) die(`no such file: ${src}`);
  if (src === out) die("--out must be a different file from the input", 64);
  const fpsStr = a.fps === undefined || a.fps === true ? "30" : String(a.fps);
  const fps = frac(/\//.test(fpsStr) ? fpsStr : fpsStr + "/1");
  if (!fps || fps < 1 || fps > 120) die("--fps must be a number or a fraction such as 30000/1001", 64);
  const maxSide = a["keep-size"] ? 0 : +(a["max-side"] ?? 1920);
  if (!isFinite(maxSide) || maxSide < 0) die("--max-side must be a number", 64);

  const p = probe(src);
  if (!p.v) {
    if (!p.au) die("the file has neither a video nor an audio stream");
    return normalizeAudio(a, p, src, out);
  }
  const vdur = parseFloat(p.v.duration) || parseFloat(p.format.duration);
  if (!(vdur > 0)) die("cannot read the video duration");
  const srcJitter = timestampStats(src);
  const vfr = !!(p.rFps && p.avgFps && Math.abs(p.rFps - p.avgFps) / p.rFps > 0.005) || (srcJitter.n > 2 && srcJitter.maxStep - srcJitter.minStep > 0.004);
  const hdr = /smpte2084|arib-std-b67/.test(p.v.color_transfer || "");

  const vf = [];
  if (maxSide) vf.push(`scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))':flags=lanczos` + (hdr ? ":out_color_matrix=bt709:in_color_matrix=bt2020" : ""));
  else if (hdr) vf.push("scale=out_color_matrix=bt709:in_color_matrix=bt2020");
  vf.push(`fps=${fpsStr}:start_time=0`, "format=yuv420p");
  const gop = Math.round(fps);
  const args = ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error", "-y", ...(process.platform === "darwin" && !a["no-hwaccel"] ? ["-hwaccel", "videotoolbox"] : []), "-i", src, "-map", "0:v:0"];
  if (p.au) args.push("-map", "0:a:0");
  args.push("-map_metadata", "-1", "-vf", vf.join(","), "-fps_mode", "cfr", "-r", fpsStr,
    "-c:v", "libx264", "-preset", String(a.preset ?? "superfast"), "-crf", String(a.crf ?? 16), "-profile:v", "high", "-g", String(gop), "-keyint_min", String(gop), "-sc_threshold", "0",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709");
  if (p.au) args.push("-af", `aresample=48000:first_pts=0,apad=whole_dur=${vdur.toFixed(6)}`, "-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  args.push("-t", vdur.toFixed(6), "-movflags", "+faststart", out);
  mkdirSync(dirname(out), { recursive: true });
  const t0 = Date.now();
  const r = run("ffmpeg", args);
  if (r.status !== 0) die("ffmpeg failed:\n" + r.stderr.slice(-1500));
  const secs = (Date.now() - t0) / 1000;

  // ---- measure the result -------------------------------------------------------------------------
  const q = probe(out);
  const ts = timestampStats(out);
  const step = 1 / fps;
  const vd = parseFloat(q.v.duration) || parseFloat(q.format.duration);
  const ad = q.au ? parseFloat(q.au.duration) : null;
  const problems = [];
  if (ts.maxStep - ts.minStep > 0.0005) problems.push(`frame step not constant (${r3(ts.minStep * 1000)}..${r3(ts.maxStep * 1000)} ms)`);
  if (Math.abs(ts.median - step) > 0.0005) problems.push(`frame step ${r3(ts.median * 1000)} ms, expected ${r3(step * 1000)} ms`);
  if (q.rotation) problems.push(`output still carries rotation ${q.rotation}`);
  if (q.au && Math.abs(vd - ad) > step) problems.push(`audio ${r3(ad)} s and picture ${r3(vd)} s differ by more than one frame`);
  if (q.au && Math.abs(parseFloat(q.au.start_time || 0)) > 0.02) problems.push(`audio starts at ${q.au.start_time} s`);
  if (q.au && Number(q.au.sample_rate) !== 48000) problems.push(`audio sample rate ${q.au.sample_rate}`);
  if (Math.abs(ts.n - Math.round(vd * fps)) > 1) problems.push(`${ts.n} frames for ${r3(vd)} s at ${r3(fps)} fps`);
  const report = {
    schema: 1, source: src, out, fps: fpsStr, width: q.v.width, height: q.v.height, seconds_to_make: r3(secs),
    source_info: { r_frame_rate: p.v.r_frame_rate, avg_frame_rate: p.v.avg_frame_rate, rotation: p.rotation, variable_frame_rate: vfr, frame_step_ms: { min: r3(srcJitter.minStep * 1000), max: r3(srcJitter.maxStep * 1000) }, hdr, codec: p.v.codec_name, width: p.v.width, height: p.v.height },
    result: { frames: ts.n, frame_step_ms: { min: r3(ts.minStep * 1000), max: r3(ts.maxStep * 1000) }, video_seconds: r3(vd), audio_seconds: ad === null ? null : r3(ad), keyframe_every_s: r3(gop / fps), rotation: q.rotation },
    problems,
  };
  writeFileSync(out + ".normalize.json", JSON.stringify(report, null, 2) + "\n");
  console.log(`normalize: ${vfr ? "VARIABLE" : "constant"} frame rate source (${p.v.r_frame_rate} / avg ${p.v.avg_frame_rate}, step ${report.source_info.frame_step_ms.min}..${report.source_info.frame_step_ms.max} ms, rotation ${p.rotation}${hdr ? ", HDR" : ""})`);
  console.log(`  -> ${q.v.width}x${q.v.height} ${fpsStr} fps CFR, ${ts.n} frames, step ${report.result.frame_step_ms.min}..${report.result.frame_step_ms.max} ms, video ${report.result.video_seconds}s / audio ${report.result.audio_seconds}s, ${r3(secs)}s to make -> ${out}`);
  if (hdr) console.log("  note: HDR source converted to SDR BT.709 without tone mapping; look at one frame before trusting the colours");
  if (problems.length) { console.error("normalize: the result failed its own check:\n  " + problems.join("\n  ")); process.exit(1); }
}
main();
