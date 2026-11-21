// Finds the real app screen inside a store screenshot. Pure functions over raw RGB (3 bytes per pixel).

// A pixel counts as "not background" when any channel differs from the background by more than this (0-255).
// The background is measured per row (its left and right margin), so a smooth gradient is followed; 16 ignores
// compression noise and glow around a caption but still separates a screen from it.
export const BG_TOLERANCE = 16;
// A row or column belongs to the screen when more than this share of it is not background. Caption text and
// device-frame highlights cover far less of a row than a screen does.
export const MIN_COVERAGE = 0.5;
// The screenshot has a uniform surrounding background when, in this share of rows, the left and right margins
// have the same colour. A full-bleed screen rarely does.
export const MIN_ROW_MATCH = 0.6;
export const MARGIN_PX = 2;
// The screen must be at least this share of the image; a smaller "screen" is more likely a block of content.
export const MIN_AREA_SHARE = 0.2;
// A device bezel is trimmed only while the line is this close to the bezel colour and this uniform, and by at
// most MAX_BEZEL_SHARE of the dimension per side (a real screen edge is never thicker).
export const BEZEL_TOLERANCE = 4;
export const BEZEL_UNIFORM = 0.97;
export const MAX_BEZEL_SHARE = 0.05;
// iOS status bar: 54-59 pt on Dynamic Island iPhones (about 852 pt tall), 44-50 pt on older ones. 0.07 of the
// screen height covers the clock, battery and the island without cutting into the app's own header.
export const STATUS_BAR_SHARE = 0.07;

const px = (img, x, y) => (y * img.width + x) * 3;
const dist = (d, i, c) => Math.max(Math.abs(d[i] - c[0]), Math.abs(d[i + 1] - c[1]), Math.abs(d[i + 2] - c[2]));

/** Per-row background colour from the left and right margins; `uniform` is the share of rows where both agree. */
function rowBackground(img) {
  const { data: d, width: w, height: h } = img;
  const m = Math.min(MARGIN_PX, Math.floor(w / 4));
  const bg = []; let agree = 0; let prev = null;
  for (let y = 0; y < h; y++) {
    const side = (x0) => { const v = [0, 0, 0]; for (let k = 0; k < m; k++) { const i = px(img, x0 + k, y); v[0] += d[i]; v[1] += d[i + 1]; v[2] += d[i + 2]; } return v.map((c) => c / m); };
    const L = side(0); const R = side(w - m);
    const same = Math.max(Math.abs(L[0] - R[0]), Math.abs(L[1] - R[1]), Math.abs(L[2] - R[2])) <= BG_TOLERANCE;
    if (same) { agree++; prev = L.map((c, k) => (c + R[k]) / 2); }
    bg.push(prev ?? L);
  }
  return { bg, uniform: agree / h };
}

// Runs shorter than this share of the dimension are text lines or glints, not part of a screen.
export const MIN_RUN_SHARE = 0.05;
// Dark toolbars and tab bars inside a screen can look like background; runs separated by up to this share are one screen.
export const MAX_GAP_SHARE = 0.12;

/** The span (inclusive indices) holding the most covered indices, after dropping short runs and bridging small gaps; or null. */
function bestSpan(cov) {
  const n = cov.length;
  const runs = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && cov[i] > MIN_COVERAGE;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { if (i - start >= n * MIN_RUN_SHARE) runs.push([start, i - 1]); start = -1; }
  }
  if (!runs.length) return null;
  const spans = [];
  for (const r of runs) {
    const last = spans[spans.length - 1];
    if (last && r[0] - last.end - 1 <= n * MAX_GAP_SHARE) { last.end = r[1]; last.len += r[1] - r[0] + 1; } else spans.push({ start: r[0], end: r[1], len: r[1] - r[0] + 1 });
  }
  const best = spans.reduce((p, q) => (q.len > p.len ? q : p));
  return [best.start, best.end];
}

function coverage(img, bg, rect, axis) {
  const { data: d } = img;
  const [x0, y0, x1, y1] = rect; // inclusive
  const out = [];
  if (axis === 'row') {
    for (let y = y0; y <= y1; y++) { let c = 0; for (let x = x0; x <= x1; x++) if (dist(d, px(img, x, y), bg[y]) > BG_TOLERANCE) c++; out.push(c / (x1 - x0 + 1)); }
  } else {
    for (let x = x0; x <= x1; x++) { let c = 0; for (let y = y0; y <= y1; y++) if (dist(d, px(img, x, y), bg[y]) > BG_TOLERANCE) c++; out.push(c / (y1 - y0 + 1)); }
  }
  return out;
}

// Share of the middle 60% of a line (away from rounded corners) within `tol` of colour `c`.
function lineMatches(img, c, tol, axis, at, [x0, y0, x1, y1]) {
  const { data: d } = img;
  let n = 0; let ok = 0;
  if (axis === 'row') {
    const a = x0 + Math.round((x1 - x0) * 0.2); const b = x1 - Math.round((x1 - x0) * 0.2);
    for (let x = a; x <= b; x++) { n++; if (dist(d, px(img, x, at), c) <= tol) ok++; }
  } else {
    const a = y0 + Math.round((y1 - y0) * 0.2); const b = y1 - Math.round((y1 - y0) * 0.2);
    for (let y = a; y <= b; y++) { n++; if (dist(d, px(img, at, y), c) <= tol) ok++; }
  }
  return ok / n;
}

function lineIsBackground(img, bg, axis, at, [x0, y0, x1, y1]) {
  const { data: d } = img;
  let n = 0; let ok = 0;
  if (axis === 'row') for (let x = x0; x <= x1; x++) { n++; if (dist(d, px(img, x, at), bg[at]) <= BG_TOLERANCE) ok++; }
  else for (let y = y0; y <= y1; y++) { n++; if (dist(d, px(img, at, y), bg[y]) <= BG_TOLERANCE) ok++; }
  return ok / n;
}

function median(a) { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; }

// Median colour of the middle 60% of a line.
function midOf(img, axis, at, [x0, y0, x1, y1]) {
  const v = [[], [], []];
  const a = axis === 'row' ? x0 + Math.round((x1 - x0) * 0.2) : y0 + Math.round((y1 - y0) * 0.2);
  const b = axis === 'row' ? x1 - Math.round((x1 - x0) * 0.2) : y1 - Math.round((y1 - y0) * 0.2);
  for (let k = a; k <= b; k++) {
    const i = axis === 'row' ? px(img, k, at) : px(img, at, k);
    for (let c = 0; c < 3; c++) v[c].push(img.data[i + c]);
  }
  return v.map(median);
}

/** Trims a uniform device bezel just inside `r` (inclusive [x0,y0,x1,y1]). Returns the new rect and px trimmed per side. */
function trimBezel(img, r) {
  const [x0, y0, x1, y1] = r;
  const edges = [midOf(img, 'row', y0, r), midOf(img, 'row', y1, r), midOf(img, 'col', x0, r), midOf(img, 'col', x1, r)];
  const ref = edges[0];
  if (!edges.every((e) => Math.max(Math.abs(e[0] - ref[0]), Math.abs(e[1] - ref[1]), Math.abs(e[2] - ref[2])) <= BEZEL_TOLERANCE * 2)) return { rect: r, trimmed: [0, 0, 0, 0] };
  const w = x1 - x0 + 1; const h = y1 - y0 + 1;
  const cur = [x0, y0, x1, y1];
  const trimmed = [0, 0, 0, 0];
  const caps = [h, h, w, w].map((s) => Math.floor(s * MAX_BEZEL_SHARE));
  // order: top, bottom, left, right; each side is trimmed against its own edge colour
  const spec = [['row', 1, 1], ['row', 3, -1], ['col', 0, 1], ['col', 2, -1]];
  // A frame can be two layers (a thin metal outline, then the black bezel): one change of colour is allowed, and only to a darker layer.
  const lineColour = (axis, at) => midOf(img, axis, at, cur);
  spec.forEach(([axis, key, step], s) => {
    let colour = edges[s]; let layers = 0;
    while (trimmed[s] < caps[s]) {
      if (lineMatches(img, colour, BEZEL_TOLERANCE, axis, cur[key], cur) < BEZEL_UNIFORM) {
        if (layers >= 1 || trimmed[s] === 0) break;
        const next = lineColour(axis, cur[key]);
        if (next[0] + next[1] + next[2] > colour[0] + colour[1] + colour[2] - 60) break; // only a lighter outline over a darker bezel
        if (lineMatches(img, next, BEZEL_TOLERANCE, axis, cur[key], cur) < BEZEL_UNIFORM) break;
        colour = next; layers++;
      }
      cur[key] += step; trimmed[s]++;
    }
  });
  // a trim that would swallow the whole screen is not a bezel
  if (cur[2] - cur[0] < w * 0.5 || cur[3] - cur[1] < h * 0.5) return { rect: r, trimmed: [0, 0, 0, 0] };
  return { rect: cur, trimmed };
}

function detectByCoverage(img, bg) {
  const { width: w, height: h } = img;
  let r = [0, 0, w - 1, h - 1];
  for (let pass = 0; pass < 2; pass++) {
    const rows = bestSpan(coverage(img, bg, r, 'row'));
    if (!rows) return { status: 'not-confident', reason: 'no rows differ from the background' };
    r = [r[0], r[1] + rows[0], r[2], r[1] + rows[1]];
    const cols = bestSpan(coverage(img, bg, r, 'col'));
    if (!cols) return { status: 'not-confident', reason: 'no columns differ from the background' };
    r = [r[0] + cols[0], r[1], r[0] + cols[1], r[3]];
  }
  const rw = r[2] - r[0] + 1; const rh = r[3] - r[1] + 1;
  if (rw * rh < MIN_AREA_SHARE * w * h) return { status: 'not-confident', reason: `candidate screen is only ${Math.round((100 * rw * rh) / (w * h))}% of the image` };
  const inside = coverage(img, bg, r, 'row');
  const filled = inside.reduce((a, b) => a + b, 0) / inside.length;
  if (filled < 0.6) return { status: 'not-confident', reason: `candidate is mostly background colour inside (${Math.round(filled * 100)}% content)` };
  // a screen edge is sharp: the line just outside must be background and the line just inside must be content
  const edgeOk = (axis, outside, span) => {
    if (outside < 0 || (axis === 'row' ? outside >= h : outside >= w)) return true; // touches the image edge
    return lineIsBackground(img, bg, axis, outside, span) >= 0.9;
  };
  if (!edgeOk('row', r[1] - 1, r) || !edgeOk('row', r[3] + 1, r) || !edgeOk('col', r[0] - 1, r) || !edgeOk('col', r[2] + 1, r)) {
    return { status: 'not-confident', reason: 'the candidate edge does not separate cleanly from the background' };
  }
  return { status: 'ok', rect: r };
}

// A dark screen on a dark background has no coverage of its own, but the device's metal outline is a thin line
// that crosses most of the phone's height and width. Use the outermost such lines, then trim the bezel inside.
export const OUTLINE_COVERAGE = 0.6;
export const OUTLINE_ROW_COVERAGE = 0.95;
// Thickness skipped inside the outline before the bezel is measured.
export const OUTLINE_PX = 5;

function detectByOutline(img, bg) {
  const { width: w, height: h } = img;
  const band = [0, Math.round(h * 0.25), w - 1, Math.round(h * 0.9)];
  const cols = coverage(img, bg, band, 'col');
  const xs = cols.map((c, i) => (c > OUTLINE_COVERAGE ? i : -1)).filter((i) => i >= 0);
  if (xs.length < 2) return { status: 'not-confident', reason: 'no device outline found' };
  const x0 = xs[0]; const x1 = xs[xs.length - 1];
  if (x1 - x0 < w * 0.3) return { status: 'not-confident', reason: 'no device outline found' };
  // The vertical outline lines tell where the device is; its top and bottom edges are continuous horizontal lines
  // near the ends of those verticals (caption bars further away are ignored).
  let cy0 = -1; let cy1 = -1; let runStart = -1; let bestLen = 0;
  const { data: d } = img;
  for (let y = 0; y <= h; y++) {
    let on = false;
    if (y < h) for (let k = 0; k < 3 && !on; k++) on = dist(d, px(img, x0 + k, y), bg[y]) > BG_TOLERANCE;
    if (on && runStart < 0) runStart = y;
    if (!on && runStart >= 0) { if (y - runStart > bestLen) { bestLen = y - runStart; cy0 = runStart; cy1 = y - 1; } runStart = -1; }
  }
  if (bestLen < h * 0.3) return { status: 'not-confident', reason: 'no device outline found' };
  const mx0 = x0 + Math.round((x1 - x0) * 0.2); const mx1 = x1 - Math.round((x1 - x0) * 0.2);
  const reach = Math.round(h * 0.08);
  const rowCov = coverage(img, bg, [mx0, 0, mx1, h - 1], 'row');
  let y0 = cy0; let y1 = cy1;
  for (let y = Math.max(0, cy0 - reach); y <= cy0 + reach; y++) if (rowCov[y] > OUTLINE_ROW_COVERAGE) { y0 = y; break; }
  for (let y = Math.min(h - 1, cy1 + reach); y >= cy1 - reach; y--) if (rowCov[y] > OUTLINE_ROW_COVERAGE) { y1 = y; break; }
  if ((x1 - x0 + 1) * (y1 - y0 + 1) < MIN_AREA_SHARE * w * h) return { status: 'not-confident', reason: 'device outline is too small' };
  // A solid edge (a flat screen, or a bright frame) is not an outline: nothing to skip.
  const rr = [x0, y0, x1, y1];
  const solid = lineIsBackground(img, bg, 'col', x0 + 4, rr) < 0.1 && lineIsBackground(img, bg, 'col', x1 - 4, rr) < 0.1 && lineIsBackground(img, bg, 'row', y0 + 4, rr) < 0.1 && lineIsBackground(img, bg, 'row', y1 - 4, rr) < 0.1;
  return { status: 'ok', rect: rr, outline: !solid };
}

/**
 * img: { data: Uint8Array RGB, width, height }.
 * Returns { status: 'cropped' | 'full-bleed' | 'not-confident', rect?: {x,y,w,h}, reason, bezel? }.
 */
export function detectScreen(img) {
  const { width: w, height: h } = img;
  const { bg, uniform } = rowBackground(img);
  if (uniform < MIN_ROW_MATCH) {
    return { status: 'full-bleed', reason: 'no uniform background at the left and right edge; the image looks like full-bleed UI' };
  }
  let found = detectByOutline(img, bg);
  const firstReason = found.reason;
  if (found.status !== 'ok') found = detectByCoverage(img, bg);
  if (found.status !== 'ok') return { status: 'not-confident', reason: `${firstReason}; ${found.reason}` };
  const r = found.outline ? found.rect.map((v, i) => v + (i < 2 ? OUTLINE_PX : -OUTLINE_PX)) : found.rect;
  const rw = r[2] - r[0] + 1; const rh = r[3] - r[1] + 1;
  const outer = r;
  const { rect, trimmed } = trimBezel(img, r);
  const final = { x: rect[0], y: rect[1], w: rect[2] - rect[0] + 1, h: rect[3] - rect[1] + 1 };
  if (final.x === 0 && final.y === 0 && final.w === w && final.h === h) {
    return { status: 'full-bleed', reason: 'nothing to remove; the whole image is the screen' };
  }
  return { status: 'cropped', rect: final, outer: { x: outer[0], y: outer[1], w: rw, h: rh }, bezel: trimmed, reason: found.outline ? 'device outline found; bezel trimmed' : 'screen found inside a uniform background' };
}
