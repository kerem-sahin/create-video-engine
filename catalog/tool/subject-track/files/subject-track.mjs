#!/usr/bin/env node
// subject-track: where is the speaker, frame by frame? No ML, no dependencies (Node >= 22, ffmpeg, ffprobe).
//
//   node subject-track.mjs --video talk.mp4 --out track.json [--start 0] [--end 20] [--fps 10] [--width 160]
//        [--thresh 20] [--bg-window 8] [--deadband 0.025] [--smooth-time 0.35] [--max-pan 0.25] [--hold 3] [--min-conf 0.45]
//
// Method: ffmpeg writes small YCbCr frames (rawvideo, ~10 fps). Per pixel a temporal median over a sliding window
// (--bg-window seconds, the whole clip when it is shorter) is the background; a frame's foreground is where gray differs from
// it by more than --thresh (after removing a global brightness shift), cleaned with a 3x3 open and close; the largest blob is the
// speaker. The head is the top band of the blob (top 30 % of its height). A skin-tone mask in YCbCr is a second witness: the
// top-most large skin region inside (or, when the background model is useless, instead of) the blob is the face and gives the
// head centre, the top and the chin. Frames where neither finds anything keep the last good value (--hold seconds), then
// fall back to the centre. The track is then smoothed offline: median filter, deadband, critically damped spring with a speed limit, run forward and backward so there is no lag.
//
// track.json: { schema, fps, start, duration, width, height, aspect, frames: [{ t, cx, head_top, head_bottom, confidence, source }] }
//   t = seconds in the SOURCE video; cx, head_top, head_bottom = fractions of the (display) width / height, 0..1;
//   confidence 0..1 of the raw measurement (0 = nothing found, the value is held or the centre); source = blob | blob+skin | skin | hold | centre.
// Known limits (stated, not hidden): a speaker who never moves is partly absorbed into the median background, then only the skin
// witness sees them; a handheld camera smears the background model; hands near the face can pull the head centre; the chin is an
// estimate from the face width, not a measurement. Exit 1 when no frame had any detection.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const r3 = (x) => Math.round(x * 1000) / 1000;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const die = (m, c = 2) => { console.error("subject-track: " + m); process.exit(c); };

// ---------- binary image helpers (W x H, Uint8Array of 0/1) ----------
function erode(m, W, H) {
  const o = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (m[i] && m[i - 1] && m[i + 1] && m[i - W] && m[i + W] && m[i - W - 1] && m[i - W + 1] && m[i + W - 1] && m[i + W + 1]) o[i] = 1;
  }
  return o;
}
function dilate(m, W, H) {
  const o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!m[y * W + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) o[yy * W + xx] = 1; }
  }
  return o;
}
const open = (m, W, H) => dilate(erode(m, W, H), W, H);
const close = (m, W, H) => erode(dilate(m, W, H), W, H);

/** Connected components (4-neighbour). Returns [{area, minx, maxx, miny, maxy, id}] and the label image. */
function components(m, W, H) {
  const lab = new Int32Array(W * H);
  const out = [];
  const stack = new Int32Array(W * H);
  let id = 0;
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || lab[s]) continue;
    id++;
    const c = { id, area: 0, minx: W, maxx: -1, miny: H, maxy: -1 };
    let sp = 0; stack[sp++] = s; lab[s] = id;
    while (sp) {
      const i = stack[--sp]; const x = i % W, y = (i - x) / W;
      c.area++; if (x < c.minx) c.minx = x; if (x > c.maxx) c.maxx = x; if (y < c.miny) c.miny = y; if (y > c.maxy) c.maxy = y;
      if (x > 0 && m[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
      if (x < W - 1 && m[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && m[i - W] && !lab[i - W]) { lab[i - W] = id; stack[sp++] = i - W; }
      if (y < H - 1 && m[i + W] && !lab[i + W]) { lab[i + W] = id; stack[sp++] = i + W; }
    }
    out.push(c);
  }
  return { comps: out, lab };
}

// ---------- background model ----------
/** Sliding temporal median of Y planes: one median per block of `block` frames, over +-win frames sampled every `step`. */
export function backgroundModels(Y, W, H, { win, block = 5, step = 2 }) {
  const n = Y.length, px = W * H;
  const models = [];
  const tmp = new Uint8Array(n);
  for (let b0 = 0; b0 < n; b0 += block) {
    const c = Math.min(n - 1, b0 + (block >> 1));
    let lo = Math.max(0, c - win), hi = Math.min(n - 1, c + win);
    // keep a full-width window at the clip's edges
    if (hi - lo < 2 * win) { if (lo === 0) hi = Math.min(n - 1, 2 * win); else lo = Math.max(0, n - 1 - 2 * win); }
    const idx = []; for (let k = lo; k <= hi; k += step) idx.push(k);
    const m = idx.length, bg = new Uint8Array(px);
    for (let p = 0; p < px; p++) {
      for (let k = 0; k < m; k++) {
        const v = Y[idx[k]][p]; let j = k - 1;
        while (j >= 0 && tmp[j] > v) { tmp[j + 1] = tmp[j]; j--; }
        tmp[j + 1] = v;
      }
      bg[p] = tmp[m >> 1];
    }
    models.push({ b0, bg });
  }
  return (i) => models[Math.min(models.length - 1, Math.floor(i / block))].bg;
}

// ---------- per-frame detection ----------
function skinMask(Y, Cb, Cr, px) {
  const m = new Uint8Array(px);
  for (let i = 0; i < px; i++) { const cb = Cb[i], cr = Cr[i]; if (Y[i] > 45 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) m[i] = 1; }
  return m;
}

export function detectFrame(fr, bg, W, H, o) {
  const px = W * H, { Y, Cb, Cr } = fr;
  // global brightness shift (auto exposure): median of Y - bg
  const hist = new Uint32Array(511);
  for (let i = 0; i < px; i++) hist[Y[i] - bg[i] + 255]++;
  let acc = 0, off = 0; for (let k = 0; k < 511; k++) { acc += hist[k]; if (acc >= px / 2) { off = k - 255; break; } }
  let fg = new Uint8Array(px);
  for (let i = 0; i < px; i++) if (Math.abs(Y[i] - bg[i] - off) > o.thresh) fg[i] = 1;
  fg = close(open(fg, W, H), W, H);
  const fgc = components(fg, W, H);
  let blob = null;
  for (const c of fgc.comps) if (!blob || c.area > blob.area) blob = c;
  const fgFrac = blob ? blob.area / px : 0;
  const blobOk = !!blob && fgFrac >= 0.012 && fgFrac <= 0.6;

  let skin = open(skinMask(Y, Cb, Cr, px), W, H);
  const sk = components(skin, W, H);
  let skinComps = sk.comps.filter((c) => c.area >= Math.max(6, px * 0.002));
  // when the blob is trustworthy the skin must overlap it (a brown door far from the speaker is not a face)
  if (blobOk) {
    const ex = 0.15, bx0 = blob.minx - ex * W, bx1 = blob.maxx + ex * W, by0 = blob.miny - ex * H, by1 = blob.maxy + ex * H;
    const inBlob = (c) => { const cx = (c.minx + c.maxx) / 2, cy = (c.miny + c.maxy) / 2; return cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1; };
    skinComps = skinComps.filter(inBlob);
  }
  let face = null;
  if (skinComps.length) {
    // a face is compact and roughly as tall as wide; forearms are long diagonal strips, fists are small
    const score = (c) => { const w = c.maxx - c.minx + 1, h = c.maxy - c.miny + 1, fill = c.area / (w * h), asp = h / w; return c.area * fill * fill * (asp >= 0.7 && asp <= 2 ? 1 : 0.3) * (1.3 - 0.6 * ((c.miny + c.maxy) / 2 / H)); };
    face = skinComps.reduce((b, c) => (!b || score(c) > score(b) ? c : b), null);
  }

  o.debug?.({ fg, blob, skin, face, skinComps, fgFrac, blobOk, sk, fgc });
  let res = null;
  const blobHead = () => {
    const h = blob.maxy - blob.miny + 1, band = Math.max(2, Math.round(0.3 * h));
    let sx = 0, n = 0; const widths = [];
    for (let y = blob.miny; y < blob.miny + band && y < H; y++) { let w = 0; for (let x = blob.minx; x <= blob.maxx; x++) if (fgc.lab[y * W + x] === blob.id) { sx += x; n++; w++; } if (w) widths.push(w); }
    widths.sort((a, b) => a - b);
    const mw = widths.length ? widths[widths.length >> 1] : band;
    return { cx: (sx / Math.max(1, n) + 0.5) / W, top: blob.miny / H, bottom: Math.min(blob.miny + clamp(1.5 * mw, 0.15 * h, 0.45 * h), H) / H };
  };
  const faceHead = () => {
    const h = face.maxy - face.miny + 1, rows = Math.max(2, Math.round(0.4 * h));
    let sx = 0, n = 0; const widths = [];
    for (let y = face.miny; y < face.miny + rows && y < H; y++) { let w = 0; for (let x = face.minx; x <= face.maxx; x++) if (sk.lab[y * W + x] === face.id) { sx += x; n++; w++; } if (w) widths.push(w); }
    widths.sort((a, b) => a - b);
    const fw = widths.length ? widths[Math.floor(widths.length * 0.75)] : 4;
    const top = face.miny - 0.3 * fw;                     // hair above the forehead
    // chin: where the skin region narrows below 70 % of the cheek width (jaw, then neck); bounded to 0.9-1.5 face widths, 1.3 when no taper is seen
    const rowW = (y) => { let w = 0; for (let x = face.minx; x <= face.maxx; x++) if (sk.lab[y * W + x] === face.id) w++; return w; };
    let chinY = face.miny + 1.3 * fw;
    for (let y = Math.ceil(face.miny + 0.9 * fw); y <= Math.min(H - 2, face.miny + 1.5 * fw); y++) if ((rowW(y) + rowW(y + 1)) / 2 < 0.7 * fw) { chinY = y; break; }
    return { cx: (sx / Math.max(1, n) + 0.5) / W, top: Math.max(0, top) / H, bottom: Math.min(H, chinY) / H };
  };
  if (blobOk && face) { const f = faceHead(); res = { ...f, confidence: 1, source: "blob+skin" }; }
  else if (blobOk) { res = { ...blobHead(), confidence: 0.6, source: "blob" }; }
  else if (face) { res = { ...faceHead(), confidence: 0.55, source: "skin" }; }
  return res;
}

// ---------- smoothing ----------
function medianOf(a) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }

/** Critically damped spring step (the SmoothDamp form): returns [pos, vel]. maxSpeed in units/second. */
function smoothDamp(x, target, v, smoothTime, maxSpeed, dt) {
  const w = 2 / Math.max(1e-4, smoothTime), e = 1 / (1 + w * dt + 0.48 * w * dt * w * dt + 0.235 * w * dt * w * dt * w * dt);
  const maxChange = maxSpeed * smoothTime;
  const change = clamp(x - target, -maxChange, maxChange);
  const tg = x - change;
  const tmp = (v + w * change) * dt;
  let nv = (v - w * tmp) * e, nx = tg + (change + tmp) * e;
  if ((target - x > 0) === (nx > target)) { nx = target; nv = 0; }
  return [nx, nv];
}

/**
 * raw: [{cx, top, bottom, confidence, source}|null] per frame. Returns smoothed frames [{cx, head_top, head_bottom, confidence, source}].
 * Low confidence (< minConf) or null: hold the last good value for `hold` seconds, then ease to the centre.
 */
export function smoothTrack(raw, fps, { deadband = 0.025, smoothTime = 0.35, maxPan = 0.25, hold = 3, minConf = 0.45, median = 5 } = {}) {
  const n = raw.length, dt = 1 / fps;
  const good = raw.map((r) => (r && r.confidence >= minConf ? r : null));
  // median over the good neighbours (outliers out)
  const med = good.map((r, i) => {
    if (!r) return null;
    const nb = []; for (let k = Math.max(0, i - (median >> 1)); k <= Math.min(n - 1, i + (median >> 1)); k++) if (good[k]) nb.push(good[k]);
    return { cx: medianOf(nb.map((q) => q.cx)), top: medianOf(nb.map((q) => q.top)), bottom: medianOf(nb.map((q) => q.bottom)) };
  });
  // fill gaps: hold, then centre
  const tgt = []; let last = null, since = 0;
  for (let i = 0; i < n; i++) {
    if (med[i]) { last = med[i]; since = 0; tgt.push({ ...med[i], source: raw[i].source }); }
    else { since += dt; tgt.push(last && since <= hold ? { ...last, source: "hold" } : { cx: 0.5, top: last ? last.top : 0.1, bottom: last ? last.bottom : 0.4, source: last && since <= hold ? "hold" : "centre" }); }
  }
  // The track is offline, so the smoothing runs forward (deadband + critically damped pan with the speed limit) and then
  // backward over its own output: the lag of a one-way filter cancels and the head stays centred while it moves.
  const spring = (xs, db) => {
    const o = []; let x = xs[0], v = 0, held = xs[0];
    for (let i = 0; i < xs.length; i++) {
      if (db) { if (xs[i] - held > db) held = xs[i] - db; else if (held - xs[i] > db) held = xs[i] + db; } else held = xs[i];
      if (i) [x, v] = smoothDamp(x, held, v, smoothTime, maxPan, dt);
      o.push(x);
    }
    return o;
  };
  const expo = (xs) => { const al = 1 - Math.exp(-dt / 0.6), o = []; let y = xs[0]; for (const x of xs) { y += (x - y) * al; o.push(y); } return o; };
  const zero = (xs, one) => one(one(xs).reverse()).reverse();
  const cxF = spring(tgt.map((q) => q.cx), deadband), cx = spring(cxF.slice().reverse(), 0).reverse();
  const top = zero(tgt.map((q) => q.top), expo), bottom = zero(tgt.map((q) => q.bottom), expo);
  const out = tgt.map((q, i) => ({ cx: cx[i], head_top: top[i], head_bottom: bottom[i], confidence: raw[i] ? raw[i].confidence : 0, source: q.source }));
  return out;
}

// ---------- ffmpeg ----------
const run = (c, args, opts = {}) => { const r = spawnSync(c, args, { maxBuffer: 1536 * 1024 * 1024, ...opts }); if (r.error) die(`cannot run ${c}: ${r.error.message}`); return r; };

export function readFrames(video, { start = 0, dur = null, fps = 10, width = 160 } = {}) {
  const common = ["-hide_banner", "-nostdin", "-loglevel", "error", ...(start ? ["-ss", String(start)] : []), "-i", video, ...(dur ? ["-t", String(dur)] : [])];
  const vf = `fps=${fps},scale=${width}:-2:flags=area:out_color_matrix=bt601,format=yuv444p`;
  // the frame height follows from the bytes of one frame (ffmpeg has applied the rotation tag)
  const one = run("ffmpeg", [...common, "-vf", vf, "-frames:v", "1", "-f", "rawvideo", "-"]);
  if (one.status !== 0 || !one.stdout.length) die("cannot decode " + video + ": " + String(one.stderr).slice(-400));
  const H = one.stdout.length / (width * 3);
  if (!Number.isInteger(H)) die("unexpected frame size");
  const all = run("ffmpeg", [...common, "-vf", vf, "-f", "rawvideo", "-"]);
  if (all.status !== 0) die("ffmpeg failed: " + String(all.stderr).slice(-400));
  const buf = all.stdout, fsz = width * H * 3, n = Math.floor(buf.length / fsz), px = width * H;
  const frames = [];
  for (let i = 0; i < n; i++) { const o = i * fsz; frames.push({ Y: buf.subarray(o, o + px), Cb: buf.subarray(o + px, o + 2 * px), Cr: buf.subarray(o + 2 * px, o + 3 * px) }); }
  return { W: width, H, frames };
}

export function trackVideo(video, o = {}) {
  const opt = { start: 0, dur: null, fps: 10, width: 160, thresh: 20, bgWindow: 8, deadband: 0.025, smoothTime: 0.35, maxPan: 0.25, hold: 3, minConf: 0.45, ...o };
  const { W, H, frames } = readFrames(video, { start: opt.start, dur: opt.dur, fps: opt.fps, width: opt.width });
  if (frames.length < 2) die("fewer than 2 frames decoded");
  const bgAt = backgroundModels(frames.map((f) => f.Y), W, H, { win: Math.max(1, Math.round((opt.bgWindow * opt.fps) / 2)), block: Math.max(1, Math.round(opt.fps / 2)), step: Math.max(1, Math.round(opt.fps / 5)) });
  const raw = frames.map((f, i) => detectFrame(f, bgAt(i), W, H, opt));
  const sm = smoothTrack(raw, opt.fps, opt);
  const found = raw.filter((r) => r && r.confidence >= opt.minConf).length;
  return {
    track: {
      schema: 1, fps: opt.fps, start: opt.start, duration: r3(frames.length / opt.fps), width: W, height: H, aspect: r3(W / H), thresholds: { thresh: opt.thresh, min_conf: opt.minConf },
      frames: sm.map((s, i) => ({ t: r3(opt.start + i / opt.fps), cx: Math.round(s.cx * 10000) / 10000, head_top: r3(s.head_top), head_bottom: r3(s.head_bottom), confidence: r3(s.confidence), source: s.source })),
    },
    found, total: frames.length,
  };
}

function main() {
  const a = {};
  const rest = process.argv.slice(2);
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith("--")) { const nx = rest[i + 1]; if (nx === undefined || nx.startsWith("--")) a[rest[i].slice(2)] = true; else { a[rest[i].slice(2)] = nx; i++; } }
  if (!a.video || !a.out) die("usage: --video <file> --out <track.json> [--start s --end s] [--fps 10] [--width 160] (see the header of this file)", 64);
  const video = resolve(a.video);
  if (!existsSync(video)) die("no such video: " + video);
  const num = (k, d) => (a[k] === undefined ? d : +a[k]);
  const start = num("start", 0), end = a.end === undefined ? null : +a.end;
  if (end !== null && !(end > start)) die("--end must be after --start", 64);
  const t0 = Date.now();
  const { track, found, total } = trackVideo(video, { start, dur: end === null ? null : end - start, fps: num("fps", 10), width: num("width", 160), thresh: num("thresh", 20), bgWindow: num("bg-window", 8), deadband: num("deadband", 0.025), smoothTime: num("smooth-time", 0.35), maxPan: num("max-pan", 0.25), hold: num("hold", 3), minConf: num("min-conf", 0.45) });
  writeFileSync(resolve(a.out), JSON.stringify(track) + "\n");
  const pct = Math.round((100 * found) / total);
  const src = {}; for (const f of track.frames) src[f.source] = (src[f.source] || 0) + 1;
  console.log(`subject-track: ${total} frames at ${track.fps} fps, speaker found in ${found} (${pct} %), ${Object.entries(src).map(([k, v]) => k + " " + v).join(", ")}; ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${resolve(a.out)}`);
  if (!found) { console.error("subject-track: no frame had a detection; the track is the centre line. Use --face-x instead."); process.exit(1); }
  if (pct < 50) console.log("  warning: under half of the frames had a detection; check the crop by eye before trusting this track");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
