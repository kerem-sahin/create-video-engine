// moments / audio-signals: laughter-like bursts and a loudness curve, measured from the audio with ffmpeg.
// ffmpeg only decodes (mono 16 kHz s16le on a pipe, spawned without a shell); the maths is plain JS, so the
// same file always gives the same numbers.
//
// Laughter ("ha-ha-ha") is a run of 4+ loud, deep, evenly spaced energy pulses, 0.10-0.32 s apart (3-10 Hz),
// whose valleys fall well below the peaks. Speech syllables are also ~4-6 Hz, but shallower and less even.
// So a burst needs ALL of: pulse prominence, regular spacing, level above the file's noise floor, and noisy
// (breathy) spectrum in the pulses. This is a heuristic measured on synthetic audio and cross-checked against
// the transcript; it is not a trained laughter model. Pitch is not measured.
import { spawn } from 'node:child_process';

export const SR = 16000;
export const HOP = 160; // 10 ms
const WIN = 400; // 25 ms
const NFFT = 512;

export function decodePcm(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let err = '';
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', (c) => { err += c; });
    p.on('error', (e) => reject(new Error('cannot run ffmpeg: ' + e.message)));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffmpeg failed: ' + err.trim().slice(0, 300)));
      const b = Buffer.concat(chunks);
      const n = b.length >> 1;
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = b.readInt16LE(i * 2) / 32768;
      resolve(x);
    });
  });
}

// in-place radix-2 FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

const quantile = (arr, q) => { const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

/** Frames every 10 ms: dB (25 ms RMS) and spectral flatness 500-6000 Hz (1 = white noise, 0 = tonal). */
export function frameFeatures(x) {
  const n = Math.max(0, Math.floor((x.length - WIN) / HOP) + 1);
  const db = new Float32Array(n), flat = new Float32Array(n);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  const hann = new Float64Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WIN - 1));
  const k0 = Math.round(500 / SR * NFFT), k1 = Math.round(6000 / SR * NFFT);
  for (let f = 0; f < n; f++) {
    const o = f * HOP; let s = 0;
    for (let i = 0; i < WIN; i++) { const v = x[o + i]; s += v * v; }
    db[f] = 10 * Math.log10(s / WIN + 1e-12);
    // flatness only where it can matter (loud enough frames)
    if (db[f] < -60) { flat[f] = 0; continue; }
    for (let i = 0; i < NFFT; i++) { re[i] = i < WIN ? x[o + i] * hann[i] : 0; im[i] = 0; }
    fft(re, im);
    let lg = 0, ar = 0;
    for (let k = k0; k <= k1; k++) { const p = re[k] * re[k] + im[k] * im[k] + 1e-12; lg += Math.log(p); ar += p; }
    const m = k1 - k0 + 1;
    flat[f] = Math.exp(lg / m) / (ar / m);
  }
  return { db, flat, n };
}

const smooth = (a, w) => { // centered moving average
  const out = new Float32Array(a.length), h = w >> 1; let s = 0, c = 0;
  for (let i = 0; i < a.length + h; i++) {
    if (i < a.length) { s += a[i]; c++; }
    const r = i - w; if (r >= 0) { s -= a[r]; c--; }
    const o = i - h; if (o >= 0 && o < a.length) out[o] = s / c;
  }
  return out;
};

/**
 * Laughter-like bursts. Returns { bursts:[{start,end,pulses,rate_hz,depth_db,flatness,confidence}], noise_floor_db, params }.
 */
export function detectLaughter(feat, opts = {}) {
  const P = { minPulses: 4, minProminence: 9, minGap: 0.10, maxGap: 0.32, maxCv: 0.30, aboveFloor: 14, minFlat: 0.04, ...opts };
  const { db, flat, n } = feat;
  const sm = smooth(db, 3);
  const floor = quantile(sm, 0.10);
  const peaks = [];
  const R = 4; // local maximum over +-40 ms
  for (let i = R; i < n - R; i++) {
    let isMax = true;
    for (let k = -R; k <= R; k++) if (k && sm[i + k] > sm[i] || (k < 0 && sm[i + k] === sm[i])) { isMax = false; break; }
    if (!isMax) continue;
    const V = 15; // valleys within +-150 ms
    let lmin = sm[i], rmin = sm[i];
    for (let k = 1; k <= V && i - k >= 0; k++) lmin = Math.min(lmin, sm[i - k]);
    for (let k = 1; k <= V && i + k < n; k++) rmin = Math.min(rmin, sm[i + k]);
    const prom = sm[i] - Math.max(lmin, rmin);
    if (prom >= P.minProminence && sm[i] >= floor + P.aboveFloor) peaks.push({ i, t: i * HOP / SR + WIN / 2 / SR, prom, level: sm[i] });
  }
  // chain peaks into runs
  const runs = []; let cur = [];
  const flush = () => { if (cur.length >= P.minPulses) runs.push(cur); cur = []; };
  for (const pk of peaks) {
    if (!cur.length) { cur = [pk]; continue; }
    const gap = pk.t - cur[cur.length - 1].t;
    if (gap >= P.minGap && gap <= P.maxGap) cur.push(pk);
    else { flush(); cur = [pk]; }
  }
  flush();
  const bursts = [];
  for (const run of runs) {
    // trim from the ends while the spacing is irregular: use the longest sub-run with CV <= maxCv
    let best = null;
    for (let a = 0; a < run.length; a++) {
      for (let b = a + P.minPulses - 1; b < run.length; b++) {
        const gaps = []; for (let k = a + 1; k <= b; k++) gaps.push(run[k].t - run[k - 1].t);
        const mean = gaps.reduce((s, v) => s + v, 0) / gaps.length;
        const sd = Math.sqrt(gaps.reduce((s, v) => s + (v - mean) ** 2, 0) / gaps.length);
        const cv = sd / mean;
        if (cv <= P.maxCv && (!best || b - a > best.b - best.a)) best = { a, b, mean, cv };
      }
    }
    if (!best) continue;
    const seg = run.slice(best.a, best.b + 1);
    const fl = seg.reduce((s, p) => s + flat[p.i], 0) / seg.length;
    if (fl < P.minFlat) continue;
    const depth = seg.reduce((s, p) => s + p.prom, 0) / seg.length;
    const conf = Math.min(1, 0.4 + 0.1 * (seg.length - P.minPulses) + 0.2 * Math.min(1, (depth - P.minProminence) / 10) + 0.2 * (1 - best.cv / P.maxCv));
    bursts.push({ start: round(seg[0].t - 0.12), end: round(seg[seg.length - 1].t + 0.2), pulses: seg.length, rate_hz: round(1 / best.mean, 2), depth_db: round(depth, 1), flatness: round(fl, 3), confidence: round(conf, 2) });
  }
  // merge bursts closer than 0.6 s (one laugh, several breaths)
  const merged = [];
  for (const b of bursts) {
    const l = merged[merged.length - 1];
    if (l && b.start - l.end < 0.6) { l.end = b.end; l.pulses += b.pulses; l.confidence = Math.max(l.confidence, b.confidence); l.depth_db = Math.max(l.depth_db, b.depth_db); }
    else merged.push({ ...b });
  }
  return { bursts: merged, noise_floor_db: round(floor, 1), params: P };
}

/** Loudness curve: dB per second (mean of loud frames) for the energy signal. */
export function loudnessPerSecond(feat) {
  const secs = Math.ceil(feat.n * HOP / SR);
  const sum = new Float64Array(secs), cnt = new Float64Array(secs);
  const floor = quantile(feat.db, 0.10);
  for (let f = 0; f < feat.n; f++) {
    if (feat.db[f] < floor + 8) continue; // voiced / loud frames only
    const s = Math.min(secs - 1, Math.floor((f * HOP + WIN / 2) / SR));
    sum[s] += feat.db[f]; cnt[s]++;
  }
  return Array.from(sum, (v, i) => (cnt[i] >= 10 ? v / cnt[i] : null));
}

export const round = (v, d = 2) => { const m = 10 ** d; return Math.round(v * m) / m; };

export async function analyzeAudio(file, opts) {
  const x = await decodePcm(file);
  const feat = frameFeatures(x);
  const laugh = detectLaughter(feat, opts);
  return { duration: round(x.length / SR, 2), ...laugh, loudness: loudnessPerSecond(feat) };
}
