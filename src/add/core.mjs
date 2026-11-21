import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { findUp } from '../lib/fsx.mjs';
import { which } from '../lib/exec.mjs';

export const NOTICE_HEADER = '# Notices\n\nParts copied into this studio, with the attribution their licences ask for.\n\n';
const INSTALL_HINT = {
  ffmpeg: 'brew install ffmpeg (or your package manager)',
  ffprobe: 'it ships with ffmpeg: brew install ffmpeg',
  python3: 'install Python 3 (brew install python)',
  'whisper-cli': 'brew install whisper-cpp',
  node: 'install Node 22 or newer',
};

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const fileHash = (p) => sha256(readFileSync(p));
export const combinedHash = (files) => sha256(Object.keys(files).sort().map((k) => `${k}\0${files[k]}\n`).join(''));

export function findStudio(explicit, cwd = process.cwd()) {
  if (explicit) return existsSync(join(explicit, 'studio.json')) ? explicit : null;
  const f = findUp(cwd, 'studio.json');
  return f ? dirname(f) : null;
}

/** Reads studio.json and upgrades a schema-1 record in memory. Throws on unreadable JSON. */
export function readStudio(dir) {
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('studio.json must be a JSON object');
  s.schema = 2;
  if (!Array.isArray(s.lanes)) s.lanes = [];
  if (typeof s.paid !== 'boolean') s.paid = false;
  if (!Array.isArray(s.parts)) s.parts = [];
  if (!s.lane_recipes || typeof s.lane_recipes !== 'object') s.lane_recipes = {};
  return s;
}

export function writeStudio(dir, s) {
  const o = { ...s };
  if (Object.keys(o.lane_recipes).length === 0) delete o.lane_recipes;
  const target = join(dir, 'studio.json');
  const tmpFile = `${target}.${process.pid}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(o, null, 2) + '\n');
  renameSync(tmpFile, target);
}

const inStudioBin = (studio, n) => {
  if (!studio) return false;
  try { const p = join(studio, 'node_modules', '.bin', n); return statSync(p).isFile(); } catch { return false; }
};
/** Tools a part needs that are on neither PATH nor <studio>/node_modules/.bin. */
export const missingNeeds = (card, studio = null) => (card.needs ?? []).filter((n) => !which(n) && !inStudioBin(studio, n)).map((n) => ({ tool: n, hint: INSTALL_HINT[n] ?? `install ${n} and put it on PATH` }));

export const sourceLabel = (card) => {
  const s = card.source;
  if (s.how === 'own code') return 'own';
  return s.ref ? `${s.repo}@${s.ref}` : s.repo;
};

/** Edge ids of a card: what must be installed with it. */
export const deps = (card) => [...(card.requires ?? []), ...(card.paid_api ? [card.paid_api.free_fallback] : [])];

/** Closure of `ids` over requires and free fallbacks (ids included). Unknown ids are kept but not expanded. */
export function closure(ids, cards) {
  const seen = new Set();
  const walk = (id) => { if (seen.has(id)) return; seen.add(id); const c = cards.get(id); if (c) deps(c).forEach(walk); };
  ids.forEach(walk);
  return seen;
}

/** Install order: dependencies first. */
export function installOrder(ids, cards) {
  const order = [];
  const seen = new Set();
  const walk = (id) => { if (seen.has(id)) return; seen.add(id); const c = cards.get(id); if (c) deps(c).forEach(walk); order.push(id); };
  ids.forEach(walk);
  return order;
}

export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** What a part would put in the studio: [{ to, from(abs) | content }]. */
export function partFiles(card, cardDir) {
  const list = (card.files ?? []).map((f) => ({ to: f.to.replaceAll('\\', '/'), from: join(cardDir, f.from) }));
  if (list.length > 0 && card.docs) list.push({ to: `parts/${card.id}/README.md`, from: join(cardDir, card.docs) });
  return list;
}

/** Why `rel` (studio-relative, '/'-separated) may not be written or deleted, or null. Refuses symlinks and directories-as-files. */
export function pathProblem(studio, rel) {
  const parts = rel.split('/').filter(Boolean);
  let cur = studio;
  for (let i = 0; i < parts.length; i++) {
    cur = join(cur, parts[i]);
    let st;
    try { st = lstatSync(cur); } catch { break; }
    if (st.isSymbolicLink()) return `${relative(studio, cur).split(sep).join('/')} is a symlink; not writing or deleting through it`;
  }
  const dest = join(studio, ...parts);
  let anc = dirname(dest);
  while (!existsSync(anc) && anc !== dirname(anc)) anc = dirname(anc);
  const inside = (real, root) => real === root || real.startsWith(root + sep);
  const real = realpathSync(anc);
  const bounds = [realpathSync(studio)];
  if (parts[0] === 'parts' && parts.length > 2 && existsSync(join(studio, 'parts', parts[1]))) bounds.push(realpathSync(join(studio, 'parts', parts[1])));
  if (!bounds.every((b) => inside(real, b))) return `${rel} would be written outside the studio (${real})`;
  return null;
}

/** Why the existing file at rel cannot be treated as a file, or null. */
export const notFileProblem = (studio, rel) => { try { return lstatSync(join(studio, rel)).isDirectory() ? `${rel} is a directory where a file should be` : null; } catch { return null; } };

/** sha256 of a regular file; null if missing or not a regular file. */
export const hashIfFile = (p) => { try { return statSync(p).isFile() ? fileHash(p) : null; } catch { return null; } };

export function copyInto(studio, files) {
  const hashes = {};
  for (const f of files) {
    const bad = pathProblem(studio, f.to) ?? notFileProblem(studio, f.to);
    if (bad) throw new Error(bad);
    const dest = join(studio, f.to);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(f.from, dest);
    hashes[f.to] = fileHash(dest);
  }
  return hashes;
}

export function appendNotice(studio, line) {
  const p = join(studio, 'NOTICE.md');
  const cur = existsSync(p) ? readFileSync(p, 'utf8') : NOTICE_HEADER;
  const entry = `- ${line}`;
  if (cur.split('\n').includes(entry)) return false;
  writeFileSync(p, cur + (cur.endsWith('\n') ? '' : '\n') + entry + '\n');
  return true;
}

export function removeNotice(studio, line) {
  const p = join(studio, 'NOTICE.md');
  if (!existsSync(p)) return;
  const entry = `- ${line}`;
  const lines = readFileSync(p, 'utf8').split('\n');
  if (!lines.includes(entry)) return;
  writeFileSync(p, lines.filter((l) => l !== entry).join('\n'));
}

/** Deletes a directory tree's files, then empty parent dirs up to (not including) `stop`. */
export function removeTree(studio, rel) {
  rmSync(join(studio, rel), { recursive: true, force: true });
  let d = dirname(join(studio, rel));
  while (d !== studio && d.startsWith(studio)) {
    try { if (readdirSync(d).length === 0) rmdirSync(d); else break; } catch { break; }
    d = dirname(d);
  }
}

export const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
