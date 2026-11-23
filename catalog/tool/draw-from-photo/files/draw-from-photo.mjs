#!/usr/bin/env node
// draw-from-photo: a real thing that is mentioned (a Porsche 911, a building, a guitar) drawn in the brand's ink, from a
// real, openly licensed photo, so it looks like that thing and not like "a car".
//   find "<what>" --out <dir> [--n 6] [--json]
//       searches Wikimedia Commons for photos of <what> that may be reused (CC0, public domain, CC BY; never SA/NC/ND),
//       downloads up to n previews to <dir>/<k>.jpg and writes <dir>/candidates.json with each one's credit.
//       Look at them and pick one: the whole thing, from the side you need, on a plain background, no people.
//   ink <photo | candidates.json> [--pick <k>] --out <file.png> [--width 1000] [--detail low|mid|high] [--flip]
//       [--ink #rrggbb] [--paper #rrggbb] [--credits <video>/CREDITS.md]
//       [--library brands/<brand>/library --name <slug> --what "<words>"]
//       cuts the main subject out and draws it as ink lines on the brand's paper (transparent PNG). macOS 14+ only
//       (Apple Vision + Core Image, local, free). With --library the drawing is kept for the next videos (approved: false
//       until the person approves it). The credit line goes to --credits.
// Exit: 0 ok, 1 nothing found / no subject in the photo, 2 cannot run, 64 usage.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UA = 'create-video-engine-draw-from-photo/0.1';
const HERE = dirname(fileURLToPath(import.meta.url));
export const DETAIL = {
  low: { noise: 0.6, edge: 0.8, threshold: 0.25, line: 1.8, speck: 150 },
  mid: { noise: 0.5, edge: 0.8, threshold: 0.2, line: 1.5, speck: 80 },
  high: { noise: 0.2, edge: 1.0, threshold: 0.12, line: 1.0, speck: 40 },
};

// licence check: reuse needs CC0, public domain or CC BY (any version). ShareAlike would bind the whole video.
export function reusable(licence) {
  const l = String(licence ?? '').trim();
  if (!l || /\b(SA|NC|ND)\b|share.?alike|non.?commercial|no.?deriv|GFDL|fair use|copyright/i.test(l)) return false;
  return /^(CC0|CC[- ]?Zero|Public domain|PDM|PD\b|PD-|CC[- ]BY([- ]\d(\.\d)?)?(\s+(International|[a-z]{2,3}))?$)/i.test(l);
}
export const stripHtml = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
export function creditLine(c) {
  if (c.licence === 'own') return `- [image] ${c.title} | the person's own photo`;
  return `- [image] "${c.title}" by ${c.artist || 'unknown'} | licence: ${c.licence} | source: ${c.page} | drawn from the photo`;
}

// a JPEG ends with FF D9, a PNG with IEND: a cut-off download is not offered
export function isWholeImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return buf.subarray(-16).includes(Buffer.from([0xff, 0xd9]));
  if (buf[0] === 0x89 && buf[1] === 0x50) return buf.subarray(-16).includes(Buffer.from('IEND'));
  return true;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wikimedia answers 429 when asked too fast: wait as told (or 5, 10, 20 s) and try again
// read: 'json' | 'buffer'. The time limit (60 s) covers the body too, so a stalled download cannot hang the search.
// Returns { status, ok, body }; network errors are retried like 429.
export async function politeFetch(url, { fetchFn = globalThis.fetch, tries = 4, wait = sleep, read = 'buffer', limitMs = 60000 } = {}) {
  for (let t = 0; ; t++) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), limitMs);
    let r, body = null, err = null;
    try {
      r = await fetchFn(url, { headers: { 'user-agent': UA }, signal: ctl.signal });
      if (r.ok) body = read === 'json' ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { err = e; } finally { clearTimeout(timer); }
    const busy = err || r.status === 429 || r.status === 503;
    if (!busy || t + 1 >= tries) {
      if (err) throw err;
      return { status: r.status, ok: r.ok, body };
    }
    const after = err ? NaN : Number(r.headers?.get?.('retry-after'));
    await wait(Number.isFinite(after) && after > 0 ? Math.min(after, 60) * 1000 : 5000 * 2 ** t);
  }
}

export function commonsUrl(what, limit = 40) {
  const q = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: `${what} filetype:bitmap`, gsrlimit: String(limit), prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1600' });
  return `https://commons.wikimedia.org/w/api.php?${q}`;
}
// the search answer -> reusable photos, best first (search order, then larger)
export function pickReusable(json) {
  const pages = Object.values(json?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0]; const m = ii?.extmetadata ?? {};
    const licence = stripHtml(m.LicenseShortName?.value);
    if (!ii?.thumburl || !reusable(licence)) continue;
    if ((ii.width ?? 0) < 600) continue;
    out.push({ title: String(p.title ?? '').replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), licence, artist: stripHtml(m.Artist?.value).slice(0, 120), page: ii.descriptionurl, url: ii.thumburl, width: ii.width, height: ii.height });
  }
  return out;
}

async function findCmd(a, fetchFn, wait = sleep) {
  const what = a._[1];
  if (!what || typeof a.out !== 'string') return usage();
  const n = a.n === undefined ? 6 : Number(a.n);
  if (!Number.isInteger(n) || n < 1 || n > 12) return usage('--n must be 1..12');
  const dir = resolve(a.out);
  let found;
  try {
    const r = await politeFetch(commonsUrl(what), { fetchFn, read: 'json', wait });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    found = pickReusable(r.body);
  } catch (e) { console.error(`draw-from-photo: Wikimedia Commons could not be searched (${e.message}). Ask the person for a photo they own, or draw it by hand.`); return 2; }
  mkdirSync(dir, { recursive: true });
  // never leave an older search's photos or list to be picked by mistake
  for (const f of readdirSync(dir)) if (/^\d+\.jpg$/.test(f) || f === 'candidates.json') rmSync(join(dir, f), { force: true });
  const list = [];
  for (const c of found) {
    if (list.length >= n) break;
    try {
      const r = await politeFetch(c.url, { fetchFn, wait });
      if (!r.ok) continue;
      const buf = r.body;
      if (buf.length < 2000 || !isWholeImage(buf)) continue;
      const k = list.length + 1; const file = join(dir, `${k}.jpg`);
      writeFileSync(file, buf);
      list.push({ k, file, title: c.title, licence: c.licence, artist: c.artist, page: c.page, width: c.width, height: c.height });
      await sleep(a.fast ? 0 : 600);
    } catch { /* next */ }
  }
  if (!list.length) { console.error(`draw-from-photo: no reusable photo of "${what}" (CC0, public domain or CC BY). Try other words (the model name, "side view"), ask the person for a photo, or draw it by hand.`); return 1; }
  writeFileSync(join(dir, 'candidates.json'), JSON.stringify({ what, candidates: list }, null, 2) + '\n');
  if (a.json) console.log(JSON.stringify({ what, candidates: list }, null, 2));
  else console.log(`draw-from-photo: ${list.length} photo(s) of "${what}" in ${dir}. Look at them and pick one (the whole thing, the side you need, plain background, no people):\n` + list.map((c) => `  ${c.k}: ${c.title} (${c.licence})`).join('\n'));
  return 0;
}

// the Swift tool is compiled once per version into a cache next to this file
function inkBinary() {
  if (process.platform !== 'darwin') return { error: 'ink needs macOS 14+ (Apple Vision cuts the subject out). On other systems: use the photo as a reference and draw the thing by hand in the brand\'s line style, keeping its real proportions.' };
  const src = join(HERE, 'ink.swift');
  if (!existsSync(src)) return { error: `missing ${src}` };
  const hash = createHash('sha256').update(readFileSync(src)).digest('hex').slice(0, 12);
  const bin = join(HERE, '.bin', `ink-${hash}`);
  if (existsSync(bin)) return { bin };
  mkdirSync(dirname(bin), { recursive: true });
  const tmp = `${bin}.${process.pid}.tmp`;
  const r = spawnSync('swiftc', ['-O', src, '-o', tmp], { encoding: 'utf8' });
  if (!r.error && r.status === 0) { renameSync(tmp, bin); return { bin }; }
  rmSync(tmp, { force: true });
  if (r.error || r.status !== 0) return { error: `could not build the ink tool (${r.error ? 'swiftc not found: run xcode-select --install' : (r.stderr || '').trim().split('\n').filter((l) => l.includes('error')).slice(0, 2).join(' | ')})` };
  return { bin };
}

export function readLibrary(p) {
  if (!existsSync(p)) return { items: [] };
  let j; try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { j = null; }
  if (!j || !Array.isArray(j.items)) throw new Error(`${p} exists but is not a library list; fix or move it`);
  return j;
}
export function addToLibrary(lib, item, { replace = false } = {}) {
  const prev = lib.items.find((x) => x.name === item.name);
  if (prev?.approved && !replace) throw new Error(`"${item.name}" is an approved drawing in the library; reuse it, or redraw it with --replace after the person agreed`);
  const items = lib.items.filter((x) => x.name !== item.name);
  const old = lib.items.find((x) => x.name === item.name);
  return { ...lib, items: [...items, { ...item, approved: false, used_in: old?.used_in ?? [] }] };
}

function inkCmd(a) {
  const input = a._[1];
  if (!input || typeof a.out !== 'string') return usage();
  const det = DETAIL[a.detail ?? 'mid'];
  if (!det) return usage('--detail must be low, mid or high');
  const width = a.width === undefined ? 1000 : Number(a.width);
  if (!Number.isFinite(width) || width < 200 || width > 3000) return usage('--width must be 200..3000');
  if (a.library !== undefined && (typeof a.library !== 'string' || typeof a.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(a.name) || typeof a.what !== 'string')) return usage('--library needs --name <lowercase-slug> and --what "<words>"');
  let photo, credit;
  if (input.endsWith('.json')) {
    let c; try { c = JSON.parse(readFileSync(resolve(input), 'utf8')); } catch (e) { console.error(`draw-from-photo: cannot read ${input}: ${e.message}`); return 2; }
    const hit = c.candidates?.find((x) => String(x.k) === String(a.pick));
    if (!Array.isArray(c.candidates) || !c.candidates.length) { console.error(`draw-from-photo: ${input} lists no candidates; run find again`); return 2; }
    if (!hit) { console.error(`draw-from-photo: pick one of ${c.candidates.map((x) => x.k).join(', ')} with --pick`); return 64; }
    photo = hit.file; credit = { title: hit.title, artist: hit.artist, licence: hit.licence, page: hit.page };
    if (typeof a.credits !== 'string') return usage('a photo from find needs --credits <video>/CREDITS.md (its licence asks for the credit)');
  } else {
    photo = resolve(input); credit = { title: 'photo', licence: 'own' };
  }
  if (!existsSync(photo)) { console.error(`draw-from-photo: no such file ${photo}`); return 2; }
  // the library is checked before drawing: an approved drawing is never replaced without --replace
  let lib, libFile;
  if (a.library !== undefined) {
    libFile = join(resolve(a.library), 'library.json');
    try { lib = readLibrary(libFile); addToLibrary(lib, { name: a.name }, { replace: !!a.replace }); } catch (e) { console.error('draw-from-photo: ' + e.message); return 2; }
  }
  const b = inkBinary();
  if (b.error) { console.error('draw-from-photo: ' + b.error); return 2; }
  const out = resolve(a.out);
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync(b.bin, [photo, out, String(width), String(det.noise), String(det.edge), String(det.threshold), String(det.line), String(det.speck), a.flip ? '1' : '0', a.ink ?? '#0a0c0a', a.paper ?? '#f9f9f9'], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('draw-from-photo: ' + ((r.stderr || '').trim() || 'ink failed')); return r.status === 1 ? 1 : r.status === 64 ? 64 : 2; }
  const size = r.stdout.trim();
  const line = creditLine(credit);
  if (typeof a.credits === 'string' && credit.licence !== 'own') {
    const f = resolve(a.credits);
    mkdirSync(dirname(f), { recursive: true });
    const text = existsSync(f) ? readFileSync(f, 'utf8') : '# Credits\n\n';
    if (!text.includes(line)) writeFileSync(f, (text.endsWith('\n') ? text : text + '\n') + line + '\n');
  }
  if (a.library !== undefined) {
    const libDir = dirname(libFile);
    mkdirSync(libDir, { recursive: true });
    const keep = join(libDir, `${a.name}.png`);
    copyFileSync(out, keep);
    lib = addToLibrary(lib, { name: a.name, what: a.what, file: `${a.name}.png`, size, faces: a.flip ? 'flipped from the photo' : 'as in the photo', detail: a.detail ?? 'mid', credit: credit.licence === 'own' ? 'own photo' : line.slice(2), made: new Date().toISOString().slice(0, 10) }, { replace: !!a.replace });
    writeFileSync(libFile, JSON.stringify(lib, null, 2) + '\n');
  }
  console.log(`draw-from-photo: ${out} (${size})${credit.licence !== 'own' ? `\n${line}` : ''}${a.library !== undefined ? `\nkept in ${a.library} as "${a.name}" (not approved yet)` : ''}`);
  return 0;
}

function usage(m) {
  console.error((m ? m + '\n' : '') + 'usage: draw-from-photo.mjs find "<what>" --out <dir> [--n 6] [--json]\n       draw-from-photo.mjs ink <photo|candidates.json> [--pick <k>] --out <file.png> [--width 1000] [--detail low|mid|high] [--flip] [--ink #rrggbb] [--paper #rrggbb] [--credits CREDITS.md] [--library <dir> --name <slug> --what "<words>" [--replace]]');
  return 64;
}

export function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (['--flip', '--json', '--fast', '--replace'].includes(t)) a[t.slice(2)] = true;
    else if (t.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) a[t.slice(2)] = true; else { a[t.slice(2)] = v; i++; } }
    else a._.push(t);
  }
  return a;
}

export async function main(argv, { fetch: fetchFn = globalThis.fetch, wait = sleep } = {}) {
  const a = parseArgs(argv);
  try {
    if (a._[0] === 'find') return await findCmd(a, fetchFn, wait);
    if (a._[0] === 'ink') return inkCmd(a);
  } catch (e) { console.error(`draw-from-photo: ${e?.message ?? e}`); return 2; }
  return usage();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
