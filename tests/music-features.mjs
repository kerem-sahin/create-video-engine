// Measurements on a rendered WAV, used by music-styles.test.mjs to show that styles differ without listening.
import { readFileSync } from 'node:fs';

export function readMono(file) {
  const b = readFileSync(file); const n = (b.length - 44) / 4; const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = (b.readInt16LE(44 + i * 4) + b.readInt16LE(46 + i * 4)) / 65536;
  return x;
}

function fft(re, im) { // in place radix-2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len; const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k; const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci; const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function powerFrames(x, size, hop) { // per frame power spectrum (bins 0..size/2)
  const win = new Float64Array(size); for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size);
  const frames = [];
  for (let s = 0; s + size <= x.length; s += hop) {
    const re = new Float64Array(size); const im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = x[s + i] * win[i];
    fft(re, im);
    const p = new Float64Array(size / 2 + 1); for (let k = 0; k <= size / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    frames.push(p);
  }
  return frames;
}

// Onsets: local maxima of a flux curve that rise clearly above their own surroundings (median of +-0.5 s) and above an absolute floor
// (the files are all normalised to the same loudness, so one floor serves every style), at least 40 ms apart.
function onsetFrames(e, frameSec, ratio, floor) {
  const half = Math.round(0.5 / frameSec); const found = []; let last = -1e9;
  for (let i = 3; i < e.length - 3; i++) {
    if (e[i] < floor) continue;
    let top = true; for (let j = -3; j <= 3; j++) if (e[i + j] > e[i]) top = false;
    if (!top) continue;
    const win = []; for (let j = Math.max(0, i - half); j <= Math.min(e.length - 1, i + half); j++) win.push(e[j]);
    win.sort((x, y) => x - y);
    if (e[i] > ratio * win[win.length >> 1] && (i - last) * frameSec > 0.04) { found.push(i); last = i; }
  }
  return found;
}
const countOnsets = (...a) => onsetFrames(...a).length;

export const FLAT_MIN = 0.3;
// spectral flatness (geometric / arithmetic mean of the power) between 3 and 12 kHz: about 0.56 for noise, near 0 for harmonic notes
function flatness(p, hz) {
  let g = 0; let a = 0; let n = 0;
  for (let k = 1; k < p.length; k++) { const f = hz(k); if (f < 3000 || f > 12000) continue; g += Math.log(p[k] + 1e-18); a += p[k]; n++; }
  return Math.exp(g / n) / (a / n + 1e-30);
}
export const FLOOR = { flux: [1.8, 25], hf: [2, 6], lf: [2, 3] };
export function features(file, { duration, barSeconds }) {
  const x = readMono(file); const sr = 44100; const bars = duration / barSeconds;
  const size = 1024; const hop = 512; const fs = hop / sr;
  const fr = powerFrames(x, size, hop); const hz = (k) => k * sr / size;
  const flux = new Float64Array(fr.length); const hf = new Float64Array(fr.length); const lf = new Float64Array(fr.length);
  let tot = 0; let cen = 0; let low = 0;
  fr.forEach((p, f) => {
    for (let k = 1; k < p.length; k++) {
      const mag = Math.log1p(50 * Math.sqrt(p[k]));
      if (f > 0) flux[f] += Math.max(0, mag - Math.log1p(50 * Math.sqrt(fr[f - 1][k])));
      tot += p[k]; cen += p[k] * hz(k);
      if (hz(k) < 150) { low += p[k]; lf[f] += Math.max(0, mag - (f > 0 ? Math.log1p(50 * Math.sqrt(fr[f - 1][k])) : 0)); }
      else if (hz(k) > 6000 && hz(k) < 16000) hf[f] += Math.max(0, mag - (f > 0 ? Math.log1p(50 * Math.sqrt(fr[f - 1][k])) : 0));
    }
  });
  return {
    onsetsPerBar: countOnsets(flux, fs, FLOOR.flux[0], FLOOR.flux[1]) / bars, // note and drum attacks of any kind
    centroidHz: cen / tot,
    lowShare: low / tot, // share of spectral energy below 150 Hz
    hfHitsPerBar: countOnsets(hf, fs, FLOOR.hf[0], FLOOR.hf[1]) / bars, // noise-like attacks above 6 kHz: hats, snares, rim clicks
    noiseHitsPerBar: onsetFrames(hf, fs, FLOOR.hf[0], FLOOR.hf[1]).filter((i) => flatness(fr[Math.min(fr.length - 1, i + 1)], hz) > FLAT_MIN).length / bars, // of those, the ones that are noise (flat spectrum) rather than a pitched pluck: percussion
    lowHitsPerBar: countOnsets(lf, fs, FLOOR.lf[0], FLOOR.lf[1]) / bars, // attacks below 150 Hz: kicks and bass notes
  };
}
