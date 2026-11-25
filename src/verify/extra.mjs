// Layer-2 checks that read project files or need more than one pass over the MP4:
// on-beat, variety, stillness, poster, numbers, critic frames, human moments.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import * as T from './thresholds.mjs';
import { run, text } from './util.mjs';

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const fmtT = (t) => `${r2(t)}s`;

function readJson(file) {
  try { return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) }; } catch (e) { return { ok: false, error: e.message }; }
}

// ---------- on-beat ----------

/** cues.json of a project (the bpm the edit was cut to); cues is null when there is none. */
export function readMusicPlan(project) {
  const cuesFile = join(project, 'cues.json');
  const cues = existsSync(cuesFile) ? readJson(cuesFile) : null;
  return { cuesFile, cues };
}

/** Interior shot boundaries (each shot start after the first) from <project>/shots.json. */
export function readShotBoundaries(project) {
  const file = join(project, 'shots.json');
  if (!existsSync(file)) return { ok: false, missing: true, boundaries: [] };
  const j = readJson(file);
  if (!j.ok) return { ok: false, error: `shots.json is not valid JSON: ${j.error}`, boundaries: [] };
  const shots = j.value?.shots;
  if (!Array.isArray(shots)) return { ok: false, error: 'shots.json has no "shots" array', boundaries: [] };
  const boundaries = shots.slice(1).map((x) => Number(x?.start)).filter((t) => Number.isFinite(t) && t > 0);
  return { ok: true, boundaries };
}

/** Mean absolute gray difference between the frames SHOT_CHANGE_FRAMES before and after each boundary. */
export async function shotBoundaryChange(mp4, boundaries, fps) {
  const W = T.NEAR_EMPTY_W;
  const H = T.NEAR_EMPTY_H;
  const size = W * H;
  const k = T.SHOT_CHANGE_FRAMES;
  const rows = [];
  for (const t of boundaries) {
    const c = Math.round(t * fps);
    const first = Math.max(0, c - k);
    const r = await run('ffmpeg', [
      '-hide_banner', '-nostdin', '-v', 'error', '-ss', String(first / fps), '-i', mp4, '-an',
      '-vf', `scale=${W}:${H},format=gray`, '-frames:v', String(c + k - first + 1),
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
    ]);
    const buf = r.stdout;
    const n = Math.floor(buf.length / size);
    const iA = c - k - first;
    const iB = c + k - first;
    if (iB >= n) { rows.push({ t, diff: null }); continue; }
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Math.abs(buf[iA * size + i] - buf[iB * size + i]);
    rows.push({ t, diff: sum / size });
  }
  return { ok: true, rows };
}

function gridRows(times, bpm, fps) {
  const half = 30 / bpm;
  const tol = T.ON_BEAT_TOLERANCE_FRAMES / fps;
  const rows = times.map((t) => {
    const nearest = Math.round(t / half) * half;
    return { t, nearest: r3(nearest), off: Math.abs(t - nearest) };
  });
  return { half, tol, rows, bad: rows.filter((x) => x.off > tol + 1e-6).sort((a, b) => b.off - a.off) };
}

export function checkOnBeat({ plan, cuts, fps, shots = null, change = null }) {
  const haveShots = Boolean(shots?.ok && shots.boundaries.length);
  const haveCuts = Boolean(cuts?.ok && cuts.cuts.length);
  if (!plan.cues && !haveShots) return { status: 'skipped', message: 'no cues.json in the project (no music plan to compare the cuts with)' };
  if (plan.cues && !plan.cues.ok) return { status: 'error', message: `cues.json is not valid JSON: ${plan.cues.error}` };
  if (!haveCuts && !haveShots) {
    if (shots?.error) return { status: 'error', message: `no cuts detected and ${shots.error}` };
    if (cuts && !cuts.ok) return { status: 'error', message: `cut detection failed: ${cuts.error}` };
    return { status: 'skipped', message: 'no cuts detected in the video and no shots.json boundaries, nothing to compare with the beat grid' };
  }
  const bpm = plan.cues ? Number(plan.cues.value?.bpm) : NaN;
  const gridOk = bpm >= 20 && bpm <= 400;
  const issues = [];
  const passes = [];
  const data = {};
  let at = null;

  if (gridOk) {
    const source = haveCuts ? 'detected cut' : 'declared shot boundary (shots.json; scene detection found no cuts)';
    const { half, tol, rows, bad } = gridRows(haveCuts ? cuts.cuts : shots.boundaries, bpm, fps);
    Object.assign(data, {
      bpm, gridSeconds: r3(half), toleranceFrames: T.ON_BEAT_TOLERANCE_FRAMES, toleranceSeconds: r3(tol), source: haveCuts ? 'detected' : 'shots.json',
      cuts: rows.map((x) => ({ t: x.t, nearestBeat: x.nearest, offMs: Math.round(x.off * 1000) })),
      offGrid: bad.map((x) => x.t),
    });
    if (!bad.length) {
      passes.push(`all ${rows.length} ${haveCuts ? 'cut(s)' : 'declared boundary(ies)'} within ${T.ON_BEAT_TOLERANCE_FRAMES} frames of a beat or half-beat (${bpm} BPM)`);
    } else {
      const list = bad.slice(0, T.ON_BEAT_LIST_MAX)
        .map((x) => `${fmtT(x.t)} (${Math.round(x.off * 1000)} ms from ${fmtT(x.nearest)})`).join(', ');
      const more = bad.length > T.ON_BEAT_LIST_MAX ? `, +${bad.length - T.ON_BEAT_LIST_MAX} more` : '';
      issues.push(`${bad.length} of ${rows.length} ${source}(s) more than ${T.ON_BEAT_TOLERANCE_FRAMES} frames (${Math.round(tol * 1000)} ms) off the ${bpm} BPM grid: ${list}${more}`);
      at = r2(bad[0].t);
    }
  } else if (plan.cues) {
    passes.push('cues.json has no usable bpm, beat grid not checked');
  }

  if (haveShots) {
    if (!change) {
      passes.push('visual change at declared boundaries not measured');
    } else if (!change.ok) {
      return { status: 'error', message: `could not compare frames at the declared shot boundaries: ${change.error}`, data };
    } else {
      const still = change.rows.filter((x) => x.diff === null || x.diff < T.SHOT_CHANGE_MIN_DIFF);
      data.shotChange = change.rows.map((x) => ({ t: x.t, diff: x.diff === null ? null : r2(x.diff) }));
      data.shotChangeMinDiff = T.SHOT_CHANGE_MIN_DIFF;
      if (still.length) {
        issues.push(`${still.length} of ${change.rows.length} declared shot boundary(ies) show no visual change (frames ${T.SHOT_CHANGE_FRAMES} before and after differ by under ${T.SHOT_CHANGE_MIN_DIFF}): ${still.map((x) => fmtT(x.t)).join(', ')}`);
        at ??= r2(still[0].t);
      } else {
        passes.push(`a visual change at all ${change.rows.length} declared boundary(ies) (smallest difference ${r2(Math.min(...change.rows.map((x) => x.diff)))})`);
      }
    }
  }
  if (!gridOk && !data.shotChange) return { status: 'skipped', message: 'cues.json has no usable bpm' };
  if (issues.length) return { status: 'warn', message: issues.join('; '), at: at ?? undefined, data };
  return { status: 'pass', message: passes.join('; '), data };
}

// ---------- empty-area / subject-scale ----------

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function bodyFrames(cover, duration) {
  const limit = duration - T.EMPTY_AREA_IGNORE_TAIL_SECONDS;
  const idx = [];
  for (let k = 0; k < cover.coverage.length; k++) if (k / T.SAMPLE_FPS < limit) idx.push(k);
  return idx;
}

const SIDE = { rows: { start: 'top', end: 'bottom' }, cols: { start: 'left', end: 'right' } };

export function checkEmptyArea({ cover, duration, landscape = false }) {
  if (!cover.ok) return { status: 'error', message: `could not measure empty areas: ${cover.error}` };
  const idx = bodyFrames(cover, duration);
  if (!idx.length) return { status: 'skipped', message: `video is not longer than the ${T.EMPTY_AREA_IGNORE_TAIL_SECONDS}s end card, nothing left to measure` };
  const out = {};
  for (const axis of ['rows', 'cols']) {
    const list = idx.map((k) => cover.bands[k][axis]).sort((a, b) => a.share - b.share);
    const mid = list[Math.floor(list.length / 2)];
    out[axis] = { share: r3(mid.share), where: mid.at === 'all' ? 'all over' : mid.at === 'middle' ? 'in the middle' : `at the ${SIDE[axis][mid.at]}` };
  }
  const data = { limit: T.EMPTY_AREA_MAX_SHARE, frames: idx.length, height: out.rows, width: out.cols, columnsJudged: !landscape };
  const bad = [];
  if (out.rows.share > T.EMPTY_AREA_MAX_SHARE) bad.push(`${Math.round(out.rows.share * 100)}% of the height is an empty band ${out.rows.where}`);
  // In 16:9 a portrait phone leaves side columns by nature; only empty rows count there (not calibrated on landscape yet).
  if (!landscape && out.cols.share > T.EMPTY_AREA_MAX_SHARE) bad.push(`${Math.round(out.cols.share * 100)}% of the width is an empty band ${out.cols.where}`);
  const scope = `median of ${idx.length} frames, last ${T.EMPTY_AREA_IGNORE_TAIL_SECONDS}s ignored`;
  if (bad.length) {
    return { status: 'warn', message: `${bad.join('; ')} (${scope}; limit ${Math.round(T.EMPTY_AREA_MAX_SHARE * 100)}%). The product is too small: make it fill the frame.`, data };
  }
  return { status: 'pass', message: `largest empty band ${Math.round(out.rows.share * 100)}% of the height, ${Math.round(out.cols.share * 100)}% of the width (${scope}; limit ${Math.round(T.EMPTY_AREA_MAX_SHARE * 100)}%)`, data };
}

export function checkSubjectScale({ cover, duration }) {
  if (!cover.ok) return { status: 'error', message: `could not measure subject scale: ${cover.error}` };
  const idx = bodyFrames(cover, duration);
  if (!idx.length) return { status: 'skipped', message: `video is not longer than the ${T.EMPTY_AREA_IGNORE_TAIL_SECONDS}s end card, nothing left to measure` };
  const m = median(idx.map((k) => cover.coverage[k]));
  const data = { limit: T.SUBJECT_SCALE_MIN_COVERAGE, medianCoverage: r3(m), frames: idx.length };
  const scope = `median of ${idx.length} frames, last ${T.EMPTY_AREA_IGNORE_TAIL_SECONDS}s ignored`;
  if (m < T.SUBJECT_SCALE_MIN_COVERAGE) {
    return { status: 'warn', message: `non-background content covers ${Math.round(m * 100)}% of the frame (${scope}; minimum ${Math.round(T.SUBJECT_SCALE_MIN_COVERAGE * 100)}%). The product is too small: make it fill the frame.`, data };
  }
  return { status: 'pass', message: `non-background content covers ${Math.round(m * 100)}% of the frame (${scope}; minimum ${Math.round(T.SUBJECT_SCALE_MIN_COVERAGE * 100)}%)`, data };
}

// ---------- variety ----------

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const sameList = (a, b) => a.length > 0 && a.length === b.length && a.every((x, i) => x === b[i]);

export function checkVariety({ project }) {
  const file = join(project, 'shots.json');
  if (!existsSync(file)) return { status: 'skipped', message: 'no shots.json in the project (the make skill writes it)' };
  const j = readJson(file);
  if (!j.ok) return { status: 'error', message: `shots.json is not valid JSON: ${j.error}` };
  const shots = j.value?.shots;
  if (!Array.isArray(shots) || !shots.length) return { status: 'error', message: 'shots.json has no "shots" array' };
  // the last shot has no transition out; whatever it says there is ignored
  const transitions = shots.slice(0, -1).map((s) => norm(s?.transition_out)).filter(Boolean);
  const structure = Array.isArray(j.value.structure) ? j.value.structure.map(norm).filter(Boolean) : [];
  const issues = [];
  const data = { shots: shots.length, transitions, structure };

  let runLen = 0;
  let worst = { len: 0, name: '', index: 0 };
  transitions.forEach((t, i) => {
    runLen = i > 0 && transitions[i - 1] === t ? runLen + 1 : 1;
    if (runLen > worst.len) worst = { len: runLen, name: t, index: i - runLen + 1 };
  });
  if (worst.len >= T.VARIETY_MAX_REPEAT) {
    issues.push(`"${worst.name}" ${worst.len} times in a row (from shot ${worst.index + 1})`);
  }

  const ledgerFile = resolve(project, '..', '..', 'taste', 'ledger.json');
  let ledgerNote = 'no brand ledger found, so no comparison with earlier videos';
  if (existsSync(ledgerFile)) {
    const l = readJson(ledgerFile);
    const vids = l.ok && Array.isArray(l.value?.videos) ? l.value.videos.filter((v) => v && v.slug !== basename(project)) : null;
    if (!vids) ledgerNote = 'ledger.json could not be read, so no comparison with earlier videos';
    else if (!vids.length) ledgerNote = 'ledger has no earlier video to compare with';
    else {
      const prev = vids[vids.length - 1];
      data.previous = prev.slug ?? null;
      ledgerNote = `compared with ${prev.slug ?? 'the previous video'}`;
      const pt = Array.isArray(prev.transitions) ? prev.transitions.map(norm).filter(Boolean) : [];
      const ps = Array.isArray(prev.structure) ? prev.structure.map(norm).filter(Boolean) : [];
      if (sameList(transitions, pt)) issues.push(`same transition list as ${prev.slug} (${transitions.join(', ')})`);
      if (sameList(structure, ps)) issues.push(`same structure as ${prev.slug}`);
    }
  }
  if (issues.length) return { status: 'warn', message: `${issues.join('; ')} (${ledgerNote})`, data };
  return { status: 'pass', message: `${transitions.length} transition(s), none repeated ${T.VARIETY_MAX_REPEAT}+ times in a row; ${ledgerNote}`, data };
}

// ---------- stillness ----------

/** Local-peak and frame-mean difference between consecutive samples; bins of STILL_BIN_SECONDS. */
export async function motionBins(mp4, width, height) {
  const W = T.STILL_W;
  const H = Math.max(2, Math.round((W * height) / width / 2) * 2);
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-v', 'error', '-i', mp4, '-an',
    '-vf', `fps=${T.SAMPLE_FPS},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ]);
  const buf = r.stdout;
  const size = W * H;
  const n = Math.floor(buf.length / size);
  if (n < 2) return { ok: false, error: text(r.stderr).trim().split('\n').pop() || 'too few frames decoded' };
  const C = T.STILL_CELL;
  const cols = Math.ceil(W / C);
  const rows = Math.ceil(H / C);
  const perBin = Math.max(1, Math.round(T.STILL_BIN_SECONDS * T.SAMPLE_FPS));
  const bins = [];
  const cell = new Float64Array(cols * rows);
  const cnt = new Float64Array(cols * rows);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cnt[Math.floor(y / C) * cols + Math.floor(x / C)]++;
  for (let k = 1; k < n; k++) {
    cell.fill(0);
    let tot = 0;
    const a = k * size;
    const b = (k - 1) * size;
    for (let y = 0; y < H; y++) {
      const rowBase = Math.floor(y / C) * cols;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const d = Math.abs(buf[a + i] - buf[b + i]);
        tot += d;
        cell[rowBase + Math.floor(x / C)] += d;
      }
    }
    let peak = 0;
    let active = 0;
    for (let c = 0; c < cell.length; c++) {
      const v = cell[c] / cnt[c];
      if (v > peak) peak = v;
      if (v > T.STILL_CELL_ACTIVE) active++;
    }
    const share = active / cell.length;
    const bi = Math.floor(k / perBin);
    const bin = (bins[bi] ??= { t: bi * T.STILL_BIN_SECONDS, sum: 0, n: 0, local: false });
    bin.sum += tot / size;
    bin.n++;
    if (peak >= T.STILL_LOCAL_PEAK && share <= T.STILL_LOCAL_MAX_SHARE) bin.local = true;
  }
  return {
    ok: true,
    bins: bins.map((b) => ({ t: b.t, mean: b.sum / b.n, moving: b.local || b.sum / b.n >= T.STILL_GLOBAL_MAX })),
  };
}

export function checkStillness({ motion, duration }) {
  const limit = duration - T.FREEZE_END_HOLD_FAIL_SECONDS;
  if (limit <= T.STILL_MIN_SECONDS) {
    return { status: 'skipped', message: `video too short to judge: the last ${T.FREEZE_END_HOLD_FAIL_SECONDS}s are excluded (end card) and ${T.STILL_MIN_SECONDS}s must remain` };
  }
  if (!motion.ok) return { status: 'error', message: `could not measure motion: ${motion.error}` };
  const stretches = [];
  let s = null;
  for (const b of motion.bins) {
    if (!b.moving) { if (s === null) s = b.t; } else if (s !== null) { stretches.push({ start: s, end: b.t }); s = null; }
  }
  if (s !== null) stretches.push({ start: s, end: motion.bins.length * T.STILL_BIN_SECONDS });
  const found = stretches
    .map((x) => ({ start: x.start, end: Math.min(x.end, limit) }))
    .filter((x) => x.end - x.start > T.STILL_MIN_SECONDS + 1e-6);
  const data = { stretches: found.map((x) => ({ start: r2(x.start), end: r2(x.end), length: r2(x.end - x.start) })) };
  if (!found.length) {
    return { status: 'pass', message: `no stretch longer than ${T.STILL_MIN_SECONDS}s without movement (last ${T.FREEZE_END_HOLD_FAIL_SECONDS}s excluded)`, data };
  }
  const f = found[0];
  return {
    status: 'warn',
    message: `${found.length} stretch(es) longer than ${T.STILL_MIN_SECONDS}s with no movement beyond a slow drift; first ${fmtT(f.start)}-${fmtT(f.end)} (${r2(f.end - f.start)}s). Give it something to do or cut it shorter.`,
    at: r2(f.start), data,
  };
}

// ---------- static shots ----------

/** Shot spans [start, end] from shots.json, else detected cuts; the last shot (end card) is dropped. */
export function shotSpans({ shots, cuts, duration }) {
  let b = null;
  let source = null;
  if (shots?.ok && shots.boundaries.length) { b = shots.boundaries; source = 'shots.json'; }
  else if (cuts?.ok && cuts.cuts.length) { b = cuts.cuts; source = 'detected cuts'; }
  if (!b) return { spans: [], source };
  const edges = [0, ...b.filter((t) => t > 0 && t < duration), duration];
  const spans = edges.slice(0, -1).map((t, i) => ({ start: t, end: edges[i + 1] }));
  return { spans: spans.slice(0, -1), source };
}

export function checkStaticShots({ motion, shots, cuts, duration }) {
  const { spans, source } = shotSpans({ shots, cuts, duration });
  if (!spans.length) return { status: 'skipped', message: 'no shot boundaries (no shots.json and no cuts detected), or only the end card' };
  if (!motion.ok) return { status: 'error', message: `could not measure motion: ${motion.error}` };
  const eps = 1e-6;
  const judged = [];
  for (const sp of spans) {
    // whole bins after the entrance and before the next shot's first frame (a bin across a cut would count the cut)
    const bins = motion.bins.filter((x) => x.t >= sp.start + T.STATIC_ENTRANCE_SECONDS - eps && x.t + T.STILL_BIN_SECONDS <= sp.end + eps);
    if (!bins.length) continue;
    const still = bins.filter((x) => !x.moving).length / bins.length;
    judged.push({ start: r2(sp.start), end: r2(sp.end), stillShare: r2(still), static: still >= T.STATIC_SHOT_STILL_SHARE });
  }
  if (!judged.length) return { status: 'skipped', message: `no shot is long enough to measure after the ${T.STATIC_ENTRANCE_SECONDS}s entrance` };
  const stat = judged.filter((x) => x.static);
  const share = stat.length / judged.length;
  const data = { source, shots: judged, staticShots: stat.length, share: r2(share), limit: T.STATIC_SHOTS_WARN_SHARE };
  const scope = `${judged.length} shot(s) from ${source}, end card excluded, first ${T.STATIC_ENTRANCE_SECONDS}s of each ignored`;
  if (share >= T.STATIC_SHOTS_WARN_SHARE) {
    const list = stat.map((x) => `${fmtT(x.start)}-${fmtT(x.end)}`).join(', ');
    return {
      status: 'warn',
      message: `${stat.length} of ${judged.length} shots are static (no movement beyond a slow drift for ${Math.round(T.STATIC_SHOT_STILL_SHARE * 100)}%+ of the time after the entrance): ${list} (${scope}). The subject should keep moving: a push-in, a pan, parallax or a UI action.`,
      at: stat[0].start, data,
    };
  }
  return { status: 'pass', message: `${stat.length} of ${judged.length} shots static (warns from ${Math.round(T.STATIC_SHOTS_WARN_SHARE * 100)}%; ${scope})`, data };
}

// ---------- poster ----------

export async function checkPoster({ mp4, project }) {
  const out = join(project, '.cve', 'poster.png');
  const save = await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', mp4, '-an', '-frames:v', '1', out]);
  if (save.code !== 0 || !existsSync(out)) return { status: 'error', message: `could not write the poster frame: ${text(save.stderr).trim().split('\n').pop()}` };
  const W = T.POSTER_W;
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-v', 'error', '-i', mp4, '-an', '-frames:v', '1',
    '-vf', `scale=${W}:-2,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ]);
  const b = r.stdout;
  const n = b.length;
  if (n < W * 2) return { status: 'error', message: 'could not decode frame 0 for measuring' };
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) hist[b[i]]++;
  let bg = 0;
  for (let v = 1; v < 256; v++) if (hist[v] > hist[bg]) bg = v;
  let cov = 0;
  let edge = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(b[i] - bg) > T.NEAR_EMPTY_LUMA_DELTA) cov++;
    if (i % W < W - 1 && i + W < n && Math.abs(b[i] - b[i + 1]) + Math.abs(b[i] - b[i + W]) > T.POSTER_EDGE_DELTA) edge++;
  }
  const coverage = cov / n;
  const edges = edge / n;
  const data = { file: out, coverage: r3(coverage), edgeShare: r3(edges), minCoverage: T.POSTER_MIN_COVERAGE, minEdgeShare: T.POSTER_MIN_EDGE };
  const weak = [];
  if (coverage < T.POSTER_MIN_COVERAGE) weak.push(`content covers ${r2(coverage * 100)}% of the frame (want ${T.POSTER_MIN_COVERAGE * 100}%+)`);
  if (edges < T.POSTER_MIN_EDGE) weak.push(`little detail (edge share ${r2(edges * 100)}%, want ${T.POSTER_MIN_EDGE * 100}%+)`);
  if (weak.length) {
    return { status: 'warn', message: `frame 0 is a weak thumbnail: ${weak.join('; ')}. Saved to ${out}`, at: 0, data };
  }
  return { status: 'pass', message: `frame 0 has content (${r2(coverage * 100)}% coverage, edge share ${r2(edges * 100)}%); saved to ${out}`, at: 0, data };
}

// ---------- numbers ----------

function stripMarkup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ')
    .replace(/<(script|style|title|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[a-zA-Z!/](?:"[^"]*"|'[^']*'|[^>"'])*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)));
}

function numberKey(tok) {
  let s = tok;
  if (/^0[.,]\d+$/.test(s)) s = s.replace(',', '.'); // 0.500 is a decimal, never a thousands group
  else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else if (/^\d{1,3}(?:[.,]\d{3})+[.,]\d+$/.test(s)) {
    const i = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    s = `${s.slice(0, i).replace(/[.,]/g, '')}.${s.slice(i + 1)}`;
  } else s = s.replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? String(v) : null;
}

/** Numbers in a text as [{raw, key}]. "1.200" = "1,200" = 1200; "4,8" = "4.8"; "%" is dropped; dates and times split into their parts. */
export function extractNumbers(textIn) {
  const out = [];
  const add = (raw) => { const key = numberKey(raw); if (key !== null) out.push({ raw, key }); };
  let s = textIn.replace(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g, (m) => { for (const p of m.split(/[./]/)) add(p); return ' '; });
  s = s.replace(/\d+(?:[.,]\d{3})+(?:[.,]\d+)?(?!\d)|\d+(?:[.,]\d+)?/g, (m) => { add(m); return ' '; });
  return out;
}

export function checkNumbers({ project }) {
  const briefFile = join(project, 'BRIEF.md');
  if (!existsSync(briefFile)) return { status: 'skipped', message: 'no BRIEF.md in the project (nothing to compare on-screen numbers with)' };
  const files = [];
  if (existsSync(join(project, 'index.html'))) files.push('index.html');
  try {
    for (const f of readdirSync(join(project, 'compositions')).sort()) if (/\.html?$/i.test(f)) files.push(`compositions/${f}`);
  } catch { /* no compositions folder */ }
  if (!files.length) return { status: 'skipped', message: 'no index.html or compositions/*.html to read numbers from' };
  const brief = readFileSync(briefFile, 'utf8')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^[ \t]*(?:[-*][ \t]+)?\d+[.)][ \t]+/gm, '');
  const inBrief = new Set(extractNumbers(brief).map((x) => x.key));
  const screen = new Map();
  for (const f of files) {
    for (const x of extractNumbers(stripMarkup(readFileSync(join(project, f), 'utf8')))) {
      const e = screen.get(x.key) ?? { raws: new Set(), files: new Set() };
      e.raws.add(x.raw);
      e.files.add(f);
      screen.set(x.key, e);
    }
  }
  // Text written by scripts (textContent/innerHTML/innerText) isn't visible to this reader: never call it checked.
  const scripted = files.filter((f) => /<script\b[\s\S]*?(?:textContent|innerHTML|innerText)\s*[+]?=/i.test(readFileSync(join(project, f), 'utf8')));
  const missing = [...screen.entries()].filter(([k]) => !inBrief.has(k))
    .map(([k, e]) => ({ number: [...e.raws].join(' / '), key: k, files: [...e.files] }));
  const data = { files, onScreen: screen.size, inBrief: inBrief.size, notInBrief: missing, scripted };
  const scriptNote = scripted.length ? ` Text set by scripts in ${scripted.join(', ')} was not read; check those numbers against BRIEF.md by hand.` : '';
  if (scripted.length && !missing.length) return { status: 'warn', message: `${screen.size} number(s) in static text match BRIEF.md.${scriptNote}`, data };
  if (!screen.size) return { status: 'pass', message: `no numbers in the visible text of ${files.length} file(s)`, data };
  if (!missing.length) return { status: 'pass', message: `all ${screen.size} on-screen number(s) appear in BRIEF.md`, data };
  const list = missing.slice(0, 12).map((m) => `${m.number} (${m.files.join(', ')})`).join('; ');
  return {
    status: 'warn',
    message: `${missing.length} on-screen number(s) not found in BRIEF.md: ${list}${missing.length > 12 ? `; +${missing.length - 12} more` : ''}. Every number shown must come from the brief.${scriptNote}`,
    data,
  };
}

// ---------- critic frames ----------

export function pickFrameTimes(cuts, duration) {
  const raw = [T.CRITIC_FRAME_EARLY_SECONDS, ...cuts.map((c) => c + T.CRITIC_FRAME_AFTER_CUT_SECONDS), duration - T.CRITIC_FRAME_TAIL_SECONDS];
  const times = [];
  for (const t of raw.filter((x) => x >= 0 && x < duration - 0.04).sort((a, b) => a - b)) {
    if (!times.length || t - times[times.length - 1] >= 0.15) times.push(r2(t));
  }
  if (times.length < T.CRITIC_FRAME_MIN) {
    const gap = duration / (T.CRITIC_FRAME_MIN * 2);
    for (let i = 1; i <= T.CRITIC_FRAME_MIN; i++) {
      const t = r2((duration * i) / (T.CRITIC_FRAME_MIN + 1));
      if (!times.some((x) => Math.abs(x - t) < gap)) times.push(t);
    }
    times.sort((a, b) => a - b);
  }
  if (times.length <= T.CRITIC_FRAME_MAX) return times;
  // too many: keep the first and the last, spread the rest evenly
  const keep = new Set([0, times.length - 1]);
  const slots = T.CRITIC_FRAME_MAX - 2;
  for (let i = 1; i <= slots; i++) keep.add(Math.round((i * (times.length - 1)) / (slots + 1)));
  return times.filter((_, i) => keep.has(i));
}

export async function writeCriticFrames({ mp4, project, cuts, duration }) {
  const dir = join(project, '.cve', 'frames');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const times = pickFrameTimes(cuts, duration);
  const files = times.map((t, i) => join(dir, `${String(i + 1).padStart(2, '0')}-${t}s.png`));
  const results = [];
  for (let i = 0; i < times.length; i += 4) {
    results.push(...await Promise.all(times.slice(i, i + 4).map((t, j) => run('ffmpeg', [
      '-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', String(t), '-i', mp4, '-an', '-frames:v', '1',
      '-vf', `scale='min(${T.CRITIC_FRAME_WIDTH},iw)':-2`, files[i + j],
    ]))));
  }
  const ok = files.filter((f, i) => results[i].code === 0 && existsSync(f));
  return { ok: ok.length === files.length && ok.length > 0, files: ok, times, wanted: files.length };
}

// ---------- human moments ----------

export function pickMoments({ duration, cuts, energy, soundCues, offGrid, endHoldStart, loudAt }) {
  const cands = [];
  cands.push({ t: 0, why: `hook: the first ${T.HOOK_SECONDS} s. Would this stop a scroll?` });

  let end = endHoldStart;
  if (end === null || end === undefined) {
    // The last detected cut is the end card only if it is near the end; soft transitions often go undetected.
    const last = cuts.length ? cuts[cuts.length - 1] : null;
    end = last !== null && last >= duration * 0.6 ? last : Math.max(0, duration - 2);
  }
  cands.push({ t: end, why: 'end card: is the last thing on screen what you want remembered?' });

  const cues = (soundCues ?? []).filter((c) => Number.isFinite(c.start));
  if (cues.length) {
    const loud = [...cues].sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
    cands.push({ t: loud.start, why: `loudest sound cue (${String(loud.src).split('/').pop()}, gain ${loud.volume}): does it fit what is on screen?` });
  } else if (Number.isFinite(loudAt)) {
    cands.push({ t: loudAt, why: 'loudest passage of the soundtrack: is it too much?' });
  }

  if (energy?.length && Math.max(...energy) > 0) {
    const i = energy.indexOf(Math.max(...energy));
    cands.push({ t: i, why: `most on-screen change (second ${i}): can the eye follow it?` });
  }
  for (const t of offGrid ?? []) cands.push({ t, why: 'cut flagged off the beat: does it feel late or early?' });

  const picked = [];
  for (const c of cands) {
    const t = r2(Math.max(0, Math.min(c.t, duration - 0.05)));
    if (picked.length >= T.MOMENTS_MAX) break;
    if (picked.some((p) => Math.abs(p.t - t) < T.MOMENT_MIN_GAP_SECONDS)) continue;
    picked.push({ t, why: c.why });
  }
  return picked.sort((a, b) => a.t - b.t);
}
