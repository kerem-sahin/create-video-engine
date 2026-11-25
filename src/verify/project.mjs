import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_FPS } from './thresholds.mjs';

const SKIP_DIRS = new Set(['node_modules', 'renders', 'out', '.cve', '.hyperframes', '.git']);

/** Binary of the nearest studio (dir with studio.json), else the nearest node_modules/.bin/hyperframes. */
export function findHyperframesBin(start) {
  let dir = resolve(start);
  let nearest = null;
  for (;;) {
    const p = join(dir, 'node_modules', '.bin', 'hyperframes');
    if (existsSync(p)) {
      if (existsSync(join(dir, 'studio.json'))) return p;
      nearest ??= p;
    }
    const up = dirname(dir);
    if (up === dir) return nearest;
    dir = up;
  }
}

/** Installed hyperframes version: nearest node_modules/hyperframes/package.json above `start`. */
export function readHyperframesVersion(start) {
  let dir = resolve(start);
  for (;;) {
    const p = join(dir, 'node_modules', 'hyperframes', 'package.json');
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8')).version ?? null; } catch { return null; }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Newest .mp4 under <project>/renders or <project>/out. */
export function findNewestMp4(project) {
  let best = null;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.mp4')) {
        const m = statSync(p).mtimeMs;
        if (!best || m > best.mtime) best = { path: p, mtime: m };
      }
    }
  };
  walk(join(project, 'renders'));
  walk(join(project, 'out'));
  return best?.path ?? null;
}

function attrs(tag) {
  const o = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[m[1]] = m[2] ?? m[3];
  return o;
}

/** Root composition info from <project>/index.html. */
export function readRoot(project) {
  const file = join(project, 'index.html');
  if (!existsSync(file)) return { found: false, reason: 'no index.html in project' };
  const html = readFileSync(file, 'utf8');
  let root = null;
  for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.id === 'root' || a['data-composition-id'] === 'main') { root = a; break; }
  }
  if (!root) return { found: false, reason: 'index.html has no #root or data-composition-id="main" element' };
  const duration = Number(root['data-duration']);
  if (!Number.isFinite(duration) || duration <= 0) {
    return { found: false, reason: 'root element has no valid data-duration' };
  }
  const f = Number(root['data-fps']);
  return { found: true, duration, fps: Number.isFinite(f) && f > 0 ? f : DEFAULT_FPS, fpsDeclared: Number.isFinite(f) && f > 0 };
}

/** Does any html file of the composition declare audio? */
export function scanAudioDeclared(project) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
      else if (e.isFile() && /\.html?$/i.test(e.name)) files.push(p);
    }
  };
  walk(project);
  if (!files.length) return { scanned: 0, declared: false, in: [] };
  const hits = [];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    if (/<audio\b/i.test(s) || /data-has-audio\s*=\s*["']true["']/i.test(s)) hits.push(f);
  }
  return { scanned: files.length, declared: hits.length > 0, in: hits };
}

// HyperFrames' bundled SFX manifest: the studio's copy first, else the nearest installed package.
export function findSfxManifest(project) {
  const rel = ['media-use', 'audio', 'assets', 'sfx', 'manifest.json'];
  let dir = project;
  for (let i = 0; i < 12; i++) {
    for (const base of [join(dir, 'skills'), join(dir, 'node_modules', 'hyperframes', 'dist', 'skills')]) {
      const p = join(base, ...rel);
      if (existsSync(p)) return p;
    }
    const up = join(dir, '..');
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// The sound cue list for the reviewer, who can see frames but cannot hear: every <audio> with its time,
// file, gain and (for HyperFrames' bundled effects) what the file is described as.
export function listSoundCues(project, manifestPath) {
  let described = {};
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const list = Array.isArray(m) ? m : (m.files || Object.values(m));
    for (const x of list) if (x && x.file) described[x.file] = x.description || '';
  } catch { /* no manifest: cues still listed without descriptions */ }
  const cues = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
      if (!e.isFile() || !/\.html?$/i.test(e.name)) continue;
      const s = readFileSync(p, 'utf8');
      for (const m of s.matchAll(/<audio\b[^>]*>/gi)) {
        const tag = m[0];
        const attr = (n) => (new RegExp(`${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag) || [])[1];
        const src = attr('src') || '';
        const file = src.split('/').pop();
        cues.push({ id: attr('id') || null, start: Number(attr('data-start') ?? NaN), duration: Number(attr('data-duration') ?? NaN),
          volume: Number(attr('data-volume') ?? 1), src, described: described[file] || null, in: p.slice(project.length + 1) || p });
      }
    }
  };
  walk(project);
  return cues.sort((a, b) => (a.start || 0) - (b.start || 0));
}
