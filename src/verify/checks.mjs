import { join } from 'node:path';
import { detectCuts, motionEnergy } from '../refs/analyze.mjs';
import * as T from './thresholds.mjs';
import {
  checkEmptyArea, checkNumbers, checkOnBeat, checkPoster, checkStillness, checkStaticShots, checkSubjectScale, checkVariety, readShotBoundaries, shotBoundaryChange, motionBins, pickMoments, readMusicPlan, writeCriticFrames,
} from './extra.mjs';
import { makeContactSheet, run, text } from './util.mjs';

const REQUIRED = new Set(['probe', 'duration', 'first-frame', 'blank-stretch', 'frozen-stretch', 'audio-present', 'contact-sheet']);
const r2 = (n) => Math.round(n * 100) / 100;
const fmtT = (t) => `${r2(t)}s`;

/** Sample frames at SAMPLE_FPS: luma min/max/avg from signalstats. */
async function sampleFrames(mp4) {
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-v', 'error', '-i', mp4, '-an',
    '-vf', `fps=${T.SAMPLE_FPS},scale=160:-2,signalstats,metadata=print:file=-`,
    '-f', 'null', '-',
  ]);
  if (r.code !== 0 && !text(r.stdout)) return { ok: false, error: text(r.stderr).trim().split('\n').pop() };
  const frames = [];
  let cur = null;
  for (const line of text(r.stdout).split('\n')) {
    const t = /pts_time:([\d.]+)/.exec(line);
    if (t) { cur = { t: Number(t[1]) }; frames.push(cur); continue; }
    const m = /lavfi\.signalstats\.(YMIN|YMAX|YAVG)=([\d.]+)/.exec(line);
    if (m && cur) cur[m[1].toLowerCase()] = Number(m[2]);
  }
  const good = frames.filter((f) => f.ymin !== undefined && f.ymax !== undefined);
  if (!good.length) return { ok: false, error: 'signalstats produced no frames' };
  return { ok: true, frames: good };
}

/** Per-frame content coverage on 10 fps 160x90 gray frames. */
async function contentCoverage(mp4) {
  const W = T.NEAR_EMPTY_W;
  const H = T.NEAR_EMPTY_H;
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-v', 'error', '-i', mp4, '-an',
    '-vf', `fps=${T.SAMPLE_FPS},scale=${W}:${H},format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ]);
  const buf = r.stdout;
  const size = W * H;
  const n = Math.floor(buf.length / size);
  if (!n) return { ok: false, error: text(r.stderr).trim().split('\n').pop() || 'no frames decoded' };
  const cov = [];
  const bands = [];
  for (let k = 0; k < n; k++) {
    const hist = new Array(256).fill(0);
    const off = k * size;
    for (let i = 0; i < size; i++) hist[buf[off + i]]++;
    let bg = 0;
    for (let v = 1; v < 256; v++) if (hist[v] > hist[bg]) bg = v;
    let diff = 0;
    for (let v = 0; v < 256; v++) if (Math.abs(v - bg) > T.NEAR_EMPTY_LUMA_DELTA) diff += hist[v];
    cov.push(diff / size);
    // empty bands: full-width rows / full-height columns that are almost all background
    const colNear = new Array(W).fill(0);
    const rowEmpty = [];
    for (let y = 0; y < H; y++) {
      let c = 0;
      for (let x = 0; x < W; x++) {
        if (Math.abs(buf[off + y * W + x] - bg) <= T.NEAR_EMPTY_LUMA_DELTA) { c++; colNear[x]++; }
      }
      rowEmpty.push(c / W >= T.EMPTY_AREA_LINE_SHARE);
    }
    bands.push({ rows: largestRun(rowEmpty), cols: largestRun(colNear.map((c) => c / H >= T.EMPTY_AREA_LINE_SHARE)) });
  }
  return { ok: true, coverage: cov, bands };
}

/** Longest run of true values: share of the line count and where it sits (start/end edge or the middle). */
export function largestRun(flags) {
  let best = { len: 0, start: 0 };
  let start = 0;
  let len = 0;
  flags.forEach((f, i) => {
    if (!f) { len = 0; return; }
    if (len === 0) start = i;
    len++;
    if (len > best.len) best = { len, start };
  });
  const atStart = best.len > 0 && best.start === 0;
  const atEnd = best.len > 0 && best.start + best.len === flags.length;
  return { share: best.len / flags.length, at: atStart && atEnd ? 'all' : atStart ? 'start' : atEnd ? 'end' : 'middle' };
}

const isBlank = (f) => f.ymax - f.ymin <= T.UNIFORM_LUMA_RANGE || f.ymax <= T.NEAR_BLACK_YMAX;

async function blackIntervals(mp4) {
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', mp4, '-an',
    '-vf', `blackdetect=d=${T.BLANK_MIN_SECONDS}:pix_th=${T.BLACKDETECT_PIX_TH}:pic_th=${T.BLACKDETECT_PIC_TH}`,
    '-f', 'null', '-',
  ]);
  if (r.code !== 0) return { ok: false, error: text(r.stderr).trim().split('\n').pop() };
  const out = [];
  for (const m of text(r.stderr).matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) {
    out.push({ start: Number(m[1]), end: Number(m[2]), source: 'blackdetect' });
  }
  return { ok: true, intervals: out };
}

async function freezeIntervals(mp4, duration) {
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-i', mp4, '-an',
    '-vf', `freezedetect=n=${T.FREEZE_NOISE_DB}dB:d=${T.FREEZE_WARN_SECONDS}`,
    '-f', 'null', '-',
  ]);
  if (r.code !== 0) return { ok: false, error: text(r.stderr).trim().split('\n').pop() };
  const out = [];
  let start = null;
  for (const line of text(r.stderr).split('\n')) {
    let m = /freeze_start:\s*([\d.]+)/.exec(line);
    if (m) { start = Number(m[1]); continue; }
    m = /freeze_end:\s*([\d.]+)/.exec(line);
    if (m && start !== null) { out.push({ start, end: Number(m[1]) }); start = null; }
  }
  if (start !== null) out.push({ start, end: duration });
  return { ok: true, intervals: out };
}

async function loudness(mp4) {
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-nostats', '-i', mp4, '-vn',
    '-af', `ebur128=peak=true:framelog=info,silencedetect=n=${T.SPARSE_SILENCE_DB}dB:d=0.05`, '-f', 'null', '-',
  ]);
  if (r.code !== 0) return { ok: false, error: text(r.stderr).trim().split('\n').pop() };
  const s = text(r.stderr);
  let shortTermMax = null;
  let shortTermAt = null;
  for (const m of s.matchAll(/ebur128[^\]]*\]\s*t:\s*([\d.]+)\s.*?\bS:\s*(-?[\d.]+|-inf)/g)) {
    const v = m[2] === '-inf' ? -Infinity : Number(m[2]);
    if (Number.isFinite(v) && (shortTermMax === null || v > shortTermMax)) { shortTermMax = v; shortTermAt = Number(m[1]); }
  }
  const sum = s.slice(s.lastIndexOf('Summary:'));
  const i = /\bI:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(sum);
  const p = /True peak:\s*Peak:\s+(-?[\d.]+|-inf)\s+dBFS/.exec(sum);
  if (!i) return { ok: false, error: 'could not parse ebur128 summary' };
  const num = (s) => (s === '-inf' ? -Infinity : Number(s));
  const lra = /\bLRA:\s+(-?[\d.]+)\s+LU/.exec(sum);
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(s);
  const audioDur = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null;
  let silent = 0;
  let open = null;
  for (const line of s.split('\n')) {
    let m = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (m) { open = Math.max(0, Number(m[1])); continue; }
    m = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (m && open !== null) { silent += Number(m[1]) - open; open = null; }
  }
  if (open !== null && audioDur) silent += audioDur - open;
  const nonSilentShare = audioDur ? Math.min(1, Math.max(0, 1 - silent / audioDur)) : NaN;
  return { ok: true, lufs: num(i[1]), truePeak: p ? num(p[1]) : NaN, lra: lra ? Number(lra[1]) : NaN, nonSilentShare, shortTermMax, shortTermAt };
}

function mergeIntervals(list) {
  const s = [...list].sort((a, b) => a.start - b.start);
  const out = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end + 1e-6) last.end = Math.max(last.end, iv.end);
    else out.push({ start: iv.start, end: iv.end });
  }
  return out;
}

/** Run all layer-2 checks. Returns array of check objects. */
export async function runMp4Checks({ mp4, project, probe, root, audio, ffmpegVersion, soundCues = [] }) {
  const checks = [];
  const add = (id, status, message, extra = {}) => checks.push({ id, status, required: REQUIRED.has(id), message, ...extra });
  const dur = probe.duration;

  add('probe', 'pass',
    `${probe.width}x${probe.height} ${r2(probe.fps)}fps ${fmtT(dur)}, ${probe.hasAudio ? `audio ${probe.audioCodec}` : 'no audio'}`,
    { data: { width: probe.width, height: probe.height, fps: probe.fps, duration: dur, frames: probe.frames, hasAudio: probe.hasAudio } });

  // duration
  if (!root.found && root.skippedByRequest) {
    add('duration', 'skipped', root.reason);
  } else if (!root.found) {
    add('duration', 'error', `cannot verify duration: ${root.reason === 'no index.html in project' ? 'no root data-duration in index.html (no index.html in project)' : `no root data-duration in index.html (${root.reason})`}`);
  } else {
    const frame = 1 / root.fps;
    const diff = Math.abs(dur - root.duration);
    const expectedFrames = Math.round(root.duration * root.fps);
    const frameDiff = probe.frames === null ? null : Math.abs(probe.frames - expectedFrames);
    const data = { expected: root.duration, actual: dur, expectedFrames, actualFrames: probe.frames, fps: root.fps, fpsDeclared: root.fpsDeclared };
    if (diff > frame + 1e-3) {
      add('duration', 'fail', `video is ${fmtT(dur)} but ${root.fromFlag ? '--expect-duration' : 'index.html says data-duration'}=${root.duration}s (off by ${fmtT(diff)}, limit one frame = ${fmtT(frame)})`, { data });
    } else if (frameDiff === null) {
      add('duration', 'warn', `duration matches (${fmtT(dur)}) but the frame count could not be read`, { data });
    } else if (frameDiff > T.FRAME_COUNT_TOLERANCE) {
      add('duration', 'fail', `frame count ${probe.frames}, expected ${expectedFrames} (${root.duration}s x ${root.fps}fps)`, { data });
    } else {
      add('duration', 'pass', `${fmtT(dur)}, ${probe.frames} frames (expected ${root.duration}s, ${expectedFrames} frames${root.fromFlag ? ', from --expect-duration' : ''})`, { data });
    }
  }

  // parallel ffmpeg passes
  const [samples, black, freeze, loud, cover, cuts, energy, motion] = await Promise.all([
    sampleFrames(mp4),
    blackIntervals(mp4),
    freezeIntervals(mp4, dur),
    probe.hasAudio ? loudness(mp4) : Promise.resolve(null),
    contentCoverage(mp4),
    detectCuts(mp4),
    motionEnergy(mp4, probe.width, probe.height, dur),
    motionBins(mp4, probe.width, probe.height),
  ]);

  // first-frame
  if (!samples.ok) {
    add('first-frame', 'error', `could not decode frames: ${samples.error}`);
  } else {
    const f0 = samples.frames[0];
    const data = { ymin: f0.ymin, ymax: f0.ymax, yavg: f0.yavg };
    if (isBlank(f0)) {
      add('first-frame', 'fail', `frame 0 is blank or near-black (luma ${f0.ymin}-${f0.ymax}, avg ${r2(f0.yavg)}); platforms use it as the thumbnail`, { at: 0, data });
    } else {
      add('first-frame', 'pass', `frame 0 has content (luma ${f0.ymin}-${f0.ymax}, avg ${r2(f0.yavg)})`, { at: 0, data });
    }
  }

  // blank-stretch
  if (!samples.ok && !black.ok) {
    add('blank-stretch', 'error', `could not analyse frames: ${samples.error}`);
  } else {
    const limit = dur - T.BLANK_IGNORE_TAIL_SECONDS;
    const raw = [];
    if (samples.ok) {
      const step = 1 / T.SAMPLE_FPS;
      let run0 = null;
      const flush = (endT) => { if (run0 !== null) raw.push({ start: run0, end: endT }); run0 = null; };
      let prev = null;
      for (const f of samples.frames) {
        if (isBlank(f)) { if (run0 === null) run0 = f.t; } else flush(f.t);
        prev = f;
      }
      if (run0 !== null && prev) flush(prev.t + step);
    }
    if (black.ok) raw.push(...black.intervals);
    const found = mergeIntervals(raw)
      .map((iv) => ({ start: iv.start, end: Math.min(iv.end, limit) }))
      .filter((iv) => iv.end - iv.start >= T.BLANK_MIN_SECONDS - 0.01);
    const partial = !samples.ok || !black.ok;
    if (found.length) {
      // A short dip to an empty frame can be an intentional beat; a long one is dead air.
      const failing = found.filter((iv) => iv.end - iv.start >= T.BLANK_FAIL_SECONDS - 0.01);
      const first = failing[0] ?? found[0];
      add('blank-stretch', failing.length ? 'fail' : 'warn',
        failing.length
          ? `${failing.length} blank/near-black stretch(es) of at least ${T.BLANK_FAIL_SECONDS}s; first at ${fmtT(first.start)}-${fmtT(first.end)}`
          : `${found.length} short blank stretch(es) (${T.BLANK_MIN_SECONDS}-${T.BLANK_FAIL_SECONDS}s); first at ${fmtT(first.start)}-${fmtT(first.end)}. Fine if it is an intended beat.`,
        { at: r2(first.start), data: { stretches: found.map((s) => ({ start: r2(s.start), end: r2(s.end) })) } });
    } else if (partial) {
      add('blank-stretch', 'error', `only part of the analysis ran (${samples.ok ? black.error : samples.error}); no blank stretch seen in that part`);
    } else {
      add('blank-stretch', 'pass', `no blank stretch of ${T.BLANK_MIN_SECONDS}s or more (last ${T.BLANK_IGNORE_TAIL_SECONDS}s ignored)`);
    }
  }

  // near-empty (warn only): background plus at most a tiny label
  if (!cover.ok) {
    add('near-empty', 'error', `could not measure content coverage: ${cover.error}`);
  } else {
    const step = 1 / T.SAMPLE_FPS;
    const cov = cover.coverage;
    const raw = [];
    let s0 = null;
    cov.forEach((c, k) => {
      if (c < T.NEAR_EMPTY_COVERAGE) { if (s0 === null) s0 = k; } else if (s0 !== null) { raw.push({ start: s0 * step, end: k * step }); s0 = null; }
    });
    if (s0 !== null) raw.push({ start: s0 * step, end: cov.length * step });
    const tailLimit = dur - T.NEAR_EMPTY_IGNORE_TAIL_SECONDS;
    const found = raw
      .map((iv) => ({ start: Math.max(iv.start, T.NEAR_EMPTY_IGNORE_HEAD_SECONDS), end: Math.min(iv.end, tailLimit) }))
      .filter((iv) => iv.end - iv.start >= T.NEAR_EMPTY_MIN_SECONDS - 0.01);
    const minCov = Math.min(...cov);
    const data = { threshold: T.NEAR_EMPTY_COVERAGE, minCoverage: Math.round(minCov * 100000) / 100000, stretches: found.map((x) => ({ start: r2(x.start), end: r2(x.end) })) };
    if (found.length) {
      add('near-empty', 'warn', `${found.length} near-empty stretch(es) (content under ${T.NEAR_EMPTY_COVERAGE * 100}% of the frame for ${T.NEAR_EMPTY_MIN_SECONDS}s or more); first at ${fmtT(found[0].start)}-${fmtT(found[0].end)}. Fine if it is an intended beat.`, { at: r2(found[0].start), data });
    } else {
      add('near-empty', 'pass', `no near-empty stretch of ${T.NEAR_EMPTY_MIN_SECONDS}s or more (first ${T.NEAR_EMPTY_IGNORE_HEAD_SECONDS}s and last ${T.NEAR_EMPTY_IGNORE_TAIL_SECONDS}s ignored)`, { data });
    }
  }

  // frozen-stretch
  if (!freeze.ok) {
    add('frozen-stretch', 'error', `freezedetect failed: ${freeze.error}`);
  } else {
    const ivs = freeze.intervals.map((s) => ({ start: r2(s.start), end: r2(s.end), length: r2(s.end - s.start) }));
    // A still end card is normal; it gets a longer allowance than a freeze mid-video.
    const isEndHold = (s) => dur - s.end <= T.FREEZE_END_TOLERANCE_SECONDS;
    const limitFor = (s) => (isEndHold(s) ? T.FREEZE_END_HOLD_FAIL_SECONDS : T.FREEZE_FAIL_SECONDS);
    const failing = ivs.filter((s) => s.length >= limitFor(s));
    const warning = ivs.filter((s) => s.length < limitFor(s));
    if (failing.length) {
      add('frozen-stretch', 'fail', `frozen for ${failing[0].length}s at ${fmtT(failing[0].start)}-${fmtT(failing[0].end)} (limit ${limitFor(failing[0])}s${isEndHold(failing[0]) ? ' for an end card' : ''})`, { at: failing[0].start, data: { stretches: ivs } });
    } else if (warning.length) {
      add('frozen-stretch', 'warn', `frozen for ${warning[0].length}s at ${fmtT(warning[0].start)} (warn from ${T.FREEZE_WARN_SECONDS}s)`, { at: warning[0].start, data: { stretches: ivs } });
    } else {
      add('frozen-stretch', 'pass', `no frozen stretch of ${T.FREEZE_WARN_SECONDS}s or more`);
    }
  }

  // audio-present
  if (audio.scanned === 0) {
    add('audio-present', 'skipped', audio.skippedByRequest ? '--no-composition: nothing declares whether audio is expected (give --expect-audio)' : 'no html files found in the project to tell whether audio is expected');
  } else if (audio.declared) {
    if (probe.hasAudio) add('audio-present', 'pass', audio.in?.[0] === '--expect-audio' ? '--expect-audio given and the MP4 has an audio stream' : 'composition declares audio and the MP4 has an audio stream');
    else add('audio-present', 'fail', audio.in?.[0] === '--expect-audio' ? '--expect-audio given but the MP4 has no audio stream' : 'composition declares audio (<audio> or data-has-audio="true") but the MP4 has no audio stream');
  } else {
    add('audio-present', 'pass', `composition declares no audio (${audio.scanned} html file(s) scanned); MP4 ${probe.hasAudio ? 'has' : 'has no'} audio stream`);
  }

  // loudness
  const caveat = `measured with ffmpeg ${ffmpegVersion ?? 'unknown'}; ebur128 results are only comparable on ffmpeg 8.0.1`;
  if (!probe.hasAudio) {
    add('loudness', 'skipped', 'no audio stream');
  } else if (!loud.ok) {
    add('loudness', 'error', `ebur128 failed: ${loud.error}`);
  } else if (Number.isNaN(loud.lufs) || Number.isNaN(loud.truePeak)) {
    add('loudness', 'skipped', `ebur128 summary had no usable ${Number.isNaN(loud.lufs) ? 'integrated loudness' : 'true peak'} value`);
  } else {
    const fmtN = (n) => (n === -Infinity ? '-inf' : n);
    const sparse = loud.nonSilentShare < T.SPARSE_AUDIO_SHARE;
    const issues = [];
    if (sparse) {
      if (loud.truePeak < T.SPARSE_TRUE_PEAK_MIN_DBTP) issues.push(`effects too quiet: true peak ${fmtN(loud.truePeak)} dBTP below ${T.SPARSE_TRUE_PEAK_MIN_DBTP}`);
      else if (loud.truePeak > T.SPARSE_TRUE_PEAK_MAX_DBTP) issues.push(`may clip: true peak ${fmtN(loud.truePeak)} dBTP above ${T.SPARSE_TRUE_PEAK_MAX_DBTP}`);
      if (loud.shortTermMax === null) issues.push('short-term loudness could not be read from ffmpeg output, so the sparse loudness cap was not checked');
      else if (loud.shortTermMax > T.SPARSE_SHORT_TERM_MAX_LUFS) {
        issues.push(`too loud for sparse effects: short-term loudness reaches ${loud.shortTermMax} LUFS at ${fmtT(loud.shortTermAt)}, above ${T.SPARSE_SHORT_TERM_MAX_LUFS}`);
      }
    } else {
      if (!(loud.lufs >= T.LOUDNESS_MIN_LUFS && loud.lufs <= T.LOUDNESS_MAX_LUFS)) {
        issues.push(`integrated ${fmtN(loud.lufs)} LUFS outside ${T.LOUDNESS_MIN_LUFS}..${T.LOUDNESS_MAX_LUFS}`);
      }
      if (loud.truePeak > T.TRUE_PEAK_MAX_DBTP) {
        issues.push(`true peak ${fmtN(loud.truePeak)} dBTP above ${T.TRUE_PEAK_MAX_DBTP}`);
      }
    }
    const share = Number.isNaN(loud.nonSilentShare) ? null : r2(loud.nonSilentShare);
    const rule = sparse ? 'sparse-true-peak' : 'integrated';
    const data = { rule, lufs: loud.lufs, lra: Number.isNaN(loud.lra) ? null : loud.lra, truePeak: loud.truePeak, nonSilentShare: share, shortTermMax: loud.shortTermMax, shortTermAt: loud.shortTermAt, ffmpeg: ffmpegVersion };
    const desc = `${fmtN(loud.lufs)} LUFS, LRA ${fmtN(data.lra)}, true peak ${fmtN(loud.truePeak)} dBTP, ${share === null ? '?' : Math.round(share * 100)}% non-silent, ${loud.shortTermMax === null ? 'short-term max unreadable' : `short-term max ${loud.shortTermMax} LUFS`}, ${rule} rule`;
    if (issues.length) add('loudness', 'warn', `${issues.join('; ')} (${desc}; ${caveat})`, { data });
    else add('loudness', 'pass', `${desc} (${caveat})`, { data });
  }

  // on-beat, variety, stillness, poster, numbers: not required, a missing input is a skip
  const plan = readMusicPlan(project);
  const addResult = (id, res) => {
    const { status, message, ...extra } = res;
    add(id, status, message, extra);
  };
  const fps = probe.fps || T.DEFAULT_FPS;
  const shots = readShotBoundaries(project);
  const change = shots.ok && shots.boundaries.length ? await shotBoundaryChange(mp4, shots.boundaries, fps) : null;
  const onBeat = checkOnBeat({ plan, cuts, fps, shots, change });
  addResult('on-beat', onBeat);
  addResult('empty-area', checkEmptyArea({ cover, duration: dur, landscape: probe.width > probe.height }));
  addResult('subject-scale', checkSubjectScale({ cover, duration: dur }));
  addResult('variety', checkVariety({ project }));
  addResult('stillness', checkStillness({ motion, duration: dur }));
  addResult('static-shots', checkStaticShots({ motion, shots, cuts, duration: dur }));
  addResult('poster', await checkPoster({ mp4, project }));
  addResult('numbers', checkNumbers({ project }));

  // critic frames
  let frames = [];
  const fr = await writeCriticFrames({ mp4, project, cuts: cuts.ok ? cuts.cuts : [], duration: dur });
  if (fr.ok) {
    frames = fr.files;
    add('critic-frames', 'pass', `wrote ${fr.files.length} frame(s) at ${T.CRITIC_FRAME_WIDTH}px to .cve/frames/ (${fr.times.map((t) => `${t}s`).join(', ')})`, { data: { times: fr.times } });
  } else {
    frames = fr.files;
    add('critic-frames', 'error', `wrote ${fr.files.length} of ${fr.wanted} critic frame(s)`);
  }

  // human moments
  const holdIv = freeze.ok ? freeze.intervals.find((s) => dur - s.end <= T.FREEZE_END_TOLERANCE_SECONDS) : null;
  const moments = pickMoments({
    duration: dur,
    cuts: cuts.ok ? cuts.cuts : [],
    energy: energy.ok ? energy.energy : null,
    soundCues,
    score: plan.score,
    offGrid: onBeat.data?.offGrid ?? [],
    endHoldStart: holdIv ? holdIv.start : null,
    loudAt: loud?.ok ? loud.shortTermAt : null,
  });

  // contact-sheet
  let contactSheet = null;
  const sheetPath = join(project, '.cve', 'contact-sheet.png');
  const sheet = await makeContactSheet(mp4, sheetPath, dur);
  if (sheet.ok) {
    contactSheet = sheetPath;
    add('contact-sheet', 'pass', `wrote ${sheet.frames} frames (${sheet.cols}x${sheet.rows} tiles)`, { data: sheet });
  } else {
    add('contact-sheet', 'error', `could not write contact sheet: ${sheet.error}`);
  }

  return { checks, contactSheet, frames, moments };
}
