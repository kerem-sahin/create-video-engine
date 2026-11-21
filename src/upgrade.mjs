import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { EXIT, HYPERFRAMES_VERSION, PACKAGE_ROOT, PACKAGE_VERSION } from './lib/constants.mjs';
import { listDirs } from './lib/fsx.mjs';
import { err, out, printJson } from './lib/log.mjs';
import { loadCatalog, validateCard } from './catalog/validate.mjs';
import {
  appendNotice, combinedHash, copyInto, deps, fileHash, findStudio, hashIfFile, listFiles, notFileProblem, partFiles, pathProblem,
  readStudio, removeNotice, removeTree, sha256, sourceLabel, writeStudio,
} from './add/core.mjs';

const USAGE = 'usage: create-video-engine upgrade [--studio <dir>] [--dry-run] [--json] [--catalog <dir>]';
const BASES = ['skills', '.claude/skills'];
const recipePaths = (id) => BASES.map((b) => `${b}/make/lanes/${id}.md`);

/** Our skill files as [{ rel (studio-relative), from (abs) }], both copies. */
export function skillFiles(root = join(PACKAGE_ROOT, 'skills')) {
  const list = [];
  for (const name of listDirs(root)) {
    for (const f of listFiles(join(root, name))) for (const b of BASES) list.push({ rel: `${b}/${name}/${f}`, from: join(root, name, f) });
  }
  return list;
}

/** Hashes of the managed skill files and entry files as they sit in `studio` now (what init records as `skills_hash`). */
export function installedHashes(studio) {
  const h = {};
  for (const rel of [...skillFiles().map((f) => f.rel), 'AGENTS.md', 'CLAUDE.md']) {
    const x = hashIfFile(join(studio, rel));
    if (x) h[rel] = x;
  }
  return h;
}

function parse(argv) {
  const o = { studio: null, dryRun: false, json: false, catalog: join(PACKAGE_ROOT, 'catalog') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--studio' || a === '--catalog') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) { err(`${a} needs a directory`); err(USAGE); return null; }
      o[a.slice(2)] = resolve(v);
    } else { err(a.startsWith('-') ? `unknown option ${a}` : `unexpected argument ${a}`); err(USAGE); return null; }
  }
  return o;
}

function backupName(dir, rel, today) {
  let n = `${rel}.bak-${today}`;
  for (let i = 2; existsSync(join(dir, n)); i++) n = `${rel}.bak-${today}-${i}`;
  return n;
}

export async function runUpgrade(argv = []) {
  const o = parse(argv);
  if (!o) return EXIT.USAGE;
  const res = { command: 'upgrade', dryRun: o.dryRun, updated: [], added: [], backed_up: [], kept: [], up_to_date: 0, warnings: [], lines: [], errors: [] };
  const finish = (code) => {
    if (o.json) { const { lines, ...rest } = res; printJson({ ok: code === 0, ...rest }); } else { for (const l of res.lines) out(l); for (const l of res.errors) err(l); }
    return code;
  };
  const dir = findStudio(o.studio);
  if (!dir) { res.errors.push(o.studio ? `no studio.json in ${o.studio}` : 'no studio found: run inside a studio folder or pass --studio <dir>'); return finish(EXIT.CANNOT_RUN); }
  let studio;
  try { studio = readStudio(dir); } catch (e) { res.errors.push(`cannot read ${join(dir, 'studio.json')}: ${e.message}`); return finish(EXIT.CANNOT_RUN); }
  const cat = loadCatalog(o.catalog);
  if (typeof cat.problems[0] === 'string') { res.errors.push(cat.problems[0]); return finish(EXIT.CANNOT_RUN); }
  res.studio = dir;
  const today = new Date().toISOString().slice(0, 10);
  const hashes = (studio.skills_hash && typeof studio.skills_hash === 'object' && !Array.isArray(studio.skills_hash)) ? { ...studio.skills_hash } : {};
  const verb = (past, future) => (o.dryRun ? future : past);

  /** Decides and (unless --dry-run) does one file. `ours`: a changed copy is backed up and replaced; otherwise it is kept. Returns the outcome. */
  const sync = (rel, content, known, ours) => {
    const bad = pathProblem(dir, rel) ?? notFileProblem(dir, rel);
    if (bad) { res.kept.push({ file: rel, why: bad }); return 'keep'; }
    const dest = join(dir, rel);
    const n = sha256(content);
    const cur = hashIfFile(dest);
    let act;
    if (cur === null) act = 'add';
    else if (cur === n) act = 'same';
    else if (known && cur === known) act = 'update';
    else act = ours ? 'backup' : 'keep';
    if (act === 'same') { res.up_to_date++; return act; }
    if (act === 'keep') { res.kept.push({ file: rel, why: 'changed by you; not touched' }); return act; }
    if (act === 'backup') {
      const b = backupName(dir, rel, today);
      res.backed_up.push({ file: rel, backup: b });
      if (!o.dryRun) copyFileSync(dest, join(dir, b));
    } else (act === 'add' ? res.added : res.updated).push(rel);
    if (!o.dryRun) { mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, content); }
    return act;
  };

  // 1. Our skills, both copies.
  for (const f of skillFiles()) {
    if (sync(f.rel, readFileSync(f.from), hashes[f.rel], true) !== 'keep') hashes[f.rel] = sha256(readFileSync(f.from));
  }

  // 2. Entry files. AGENTS.md is ours; CLAUDE.md only while it is still ours (the person may have their own).
  const tpl = join(PACKAGE_ROOT, 'templates', 'studio');
  for (const [rel, ours] of [['AGENTS.md', true], ['CLAUDE.md', false]]) {
    const src = join(tpl, rel);
    if (!existsSync(src)) continue;
    const content = readFileSync(src);
    if (sync(rel, content, hashes[rel], ours) !== 'keep') hashes[rel] = sha256(content);
  }

  // 3. Installed lane recipes.
  const lanes = new Map(cat.lanes.map((l) => [l.id, l]));
  for (const id of studio.lanes) {
    const lane = lanes.get(id);
    if (!lane) { res.warnings.push(`lane ${id} is not in this package's catalog; its recipe was not updated`); continue; }
    let content;
    try { content = readFileSync(join(lane.dir, lane.lane.recipe)); } catch (e) { res.warnings.push(`lane ${id}: cannot read the catalog recipe (${e.message})`); continue; }
    const known = studio.lane_recipes[id];
    const outcomes = recipePaths(id).map((rel) => sync(rel, content, known, true));
    if (!outcomes.includes('keep')) studio.lane_recipes[id] = sha256(content);
  }

  // 4. Installed parts. Changed by the person: listed, never touched.
  const cardList = cat.parts.filter((p) => p.card && typeof p.card.id === 'string');
  const cards = new Map(cardList.map((p) => [p.card.id, p]));
  const cardMap = new Map(cardList.map((p) => [p.card.id, p.card]));
  const have = new Set(studio.parts.map((r) => r.id));
  for (const rec of studio.parts) {
    const p = cards.get(rec.id);
    if (!p) { res.warnings.push(`part ${rec.id} is not in this package's catalog; not updated`); continue; }
    const bad = validateCard(p.card, p.dir, { cards: cardMap });
    if (bad.length) { res.warnings.push(`part ${rec.id}: the catalog card is invalid (${bad[0]}); not updated`); continue; }
    const files = partFiles(p.card, p.dir);
    const next = Object.fromEntries(files.map((f) => [f.to, fileHash(f.from)]));
    const old = rec.files ?? {};
    const same = Object.keys(next).length === Object.keys(old).length && Object.entries(next).every(([k, v]) => old[k] === v);
    if (same) { res.up_to_date++; continue; }
    const problems = [...new Set([...Object.keys(old), ...Object.keys(next)])].map((to) => pathProblem(dir, to) ?? notFileProblem(dir, to)).filter(Boolean);
    const changed = Object.entries(old).filter(([to, h]) => hashIfFile(join(dir, to)) !== h).map(([to]) => to);
    if (problems.length) { res.kept.push({ file: `parts/${rec.id}`, why: `${problems[0]}; not updated` }); continue; }
    if (changed.length) { res.kept.push({ file: `parts/${rec.id}`, why: `${changed.join(', ')} changed by you; not updated` }); continue; }
    res.updated.push(`parts/${rec.id}`);
    for (const d of deps(p.card)) if (!have.has(d)) res.warnings.push(`part ${rec.id} now needs ${d}: run \`add ${d}\``);
    if (o.dryRun) continue;
    const written = copyInto(dir, files);
    for (const to of Object.keys(old)) if (!(to in next)) removeTree(dir, to);
    if (rec.attribution !== (p.card.attribution ?? undefined)) {
      if (rec.attribution) removeNotice(dir, rec.attribution);
      if (p.card.attribution) appendNotice(dir, p.card.attribution);
      if (p.card.attribution) rec.attribution = p.card.attribution; else delete rec.attribution;
    }
    rec.files = written;
    rec.hash = files.length ? combinedHash(written) : null;
    rec.source = sourceLabel(p.card);
    rec.requires = deps(p.card);
  }

  // 5. HyperFrames pin: reported, never changed.
  let pinned = studio.hyperframes;
  try { pinned = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).devDependencies?.hyperframes ?? pinned; } catch { /* no package.json */ }
  const hfNote = pinned && pinned !== HYPERFRAMES_VERSION
    ? `this studio pins hyperframes ${pinned}; this package was made for ${HYPERFRAMES_VERSION}. Not changed. To move: set "hyperframes" in package.json and studio.json to ${HYPERFRAMES_VERSION}, run npm install, then re-run the checks. Staying on ${pinned} is your call.`
    : null;
  if (hfNote) res.hyperframes = { pinned, expected: HYPERFRAMES_VERSION };

  // 6. Record.
  const engine = `create-video-engine@${PACKAGE_VERSION}`;
  res.engine = { from: studio.engine ?? null, to: engine };
  if (!o.dryRun) {
    studio.engine = engine;
    studio.skills_hash = hashes;
    writeStudio(dir, studio);
  }

  // 7. Summary.
  const L = res.lines;
  L.push(`${o.dryRun ? 'Dry run: nothing was changed. ' : ''}Upgrade ${res.engine.from ?? '(unknown)'} -> ${engine}`);
  for (const f of res.updated) L.push(`${verb('updated', 'would update')}: ${f}`);
  for (const f of res.added) L.push(`${verb('added', 'would add')}: ${f}`);
  for (const b of res.backed_up) L.push(`${verb('backed up', 'would back up')} your edited copy, then replaced: ${b.file} -> ${b.backup}`);
  for (const k of res.kept) L.push(`kept (${k.why}): ${k.file}`);
  for (const w of res.warnings) L.push(`! ${w}`);
  if (hfNote) L.push(`! ${hfNote}`);
  L.push(`${res.updated.length} updated, ${res.added.length} added, ${res.backed_up.length} backed up, ${res.kept.length} kept, ${res.up_to_date} already current.`);
  return finish(EXIT.OK);
}
