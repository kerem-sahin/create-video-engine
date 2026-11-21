import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EXIT, PACKAGE_ROOT } from '../lib/constants.mjs';
import { err, out, printJson } from '../lib/log.mjs';
import { loadCatalog, validateCard, validateLane } from '../catalog/validate.mjs';
import {
  appendNotice, closure, combinedHash, copyInto, deps, fileHash, findStudio, hashIfFile, notFileProblem, pathProblem, installOrder, listFiles, missingNeeds,
  partFiles, readStudio, removeNotice, removeTree, sha256, sourceLabel, writeStudio,
} from './core.mjs';

const ADD_USAGE = 'usage: create-video-engine add <part-id>|lane:<lane-id> [--studio <dir>] [--paid] [--dry-run] [--json]';
const REMOVE_USAGE = 'usage: create-video-engine remove <part-id>|lane:<lane-id> [--studio <dir>] [--json]';
const recipePaths = (id) => [join('skills', 'make', 'lanes', `${id}.md`), join('.claude', 'skills', 'make', 'lanes', `${id}.md`)];

function parse(argv, allowed, usage) {
  const o = { target: null, studio: null, paid: false, dryRun: false, json: false, catalog: join(PACKAGE_ROOT, 'catalog') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--paid' && allowed.paid) o.paid = true;
    else if (a === '--dry-run' && allowed.dryRun) o.dryRun = true;
    else if (a === '--studio' || a === '--catalog') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) { err(`${a} needs a directory`); err(usage); return null; }
      o[a.slice(2)] = resolve(v);
    } else if (a.startsWith('-')) { err(`unknown option ${a}`); err(usage); return null; }
    else if (o.target === null) o.target = a;
    else { err(`unexpected argument ${a}`); err(usage); return null; }
  }
  if (!o.target) { err('missing part id or lane:<id>'); err(usage); return null; }
  if (o.target === 'lane:' || !/^(lane:)?[a-z0-9]+(-[a-z0-9]+)*$/.test(o.target)) { err(`"${o.target}" is not a part id or lane:<lane-id>`); err(usage); return null; }
  return o;
}

function report(o, code, res) {
  if (o.json) printJson({ ok: code === 0, ...res });
  else {
    for (const l of res.lines ?? []) out(l);
    for (const l of res.errors ?? []) err(l);
  }
  return code;
}

function load(o, res) {
  const dir = findStudio(o.studio);
  if (!dir) { res.errors.push(o.studio ? `no studio.json in ${o.studio}` : 'no studio found: run inside a studio folder or pass --studio <dir>'); return null; }
  let studio;
  try { studio = readStudio(dir); } catch (e) { res.errors.push(`cannot read ${join(dir, 'studio.json')}: ${e.message}`); return null; }
  const cat = loadCatalog(o.catalog);
  if (typeof cat.problems[0] === 'string') { res.errors.push(cat.problems[0]); return null; }
  const cards = new Map(cat.parts.filter((p) => p.card && typeof p.card.id === 'string').map((p) => [p.card.id, p]));
  return { dir, studio, cat, cards, lanes: new Map(cat.lanes.map((l) => [l.id, l])) };
}

const cardMap = (cards) => new Map([...cards].map(([id, p]) => [id, p.card]));

export async function runAdd(argv = []) {
  const o = parse(argv, { paid: true, dryRun: true }, ADD_USAGE);
  if (!o) return EXIT.USAGE;
  const res = { command: 'add', target: o.target, dryRun: o.dryRun, installed: [], present: [], lines: [], errors: [], warnings: [], docs: {}, next: [] };
  const ctx = load(o, res);
  if (!ctx) return report(o, EXIT.CANNOT_RUN, res);
  const { dir, studio, cards, lanes } = ctx;
  res.studio = dir;
  const cmap = cardMap(cards);

  // 1. What was asked for.
  const isLane = o.target.startsWith('lane:');
  const laneId = isLane ? o.target.slice(5) : null;
  let requested;
  let lane = null;
  if (isLane) {
    lane = lanes.get(laneId);
    if (!lane) { res.errors.push(`lane "${laneId}" is not in the catalog (${[...lanes.keys()].join(', ') || 'none'})`); return report(o, EXIT.FAIL, res); }
    const le = validateLane(lane.lane, lane.dir, { cards: cmap });
    if (le.length) { res.errors.push(`lane ${laneId} is invalid:`, ...le.map((e) => `  ${e}`)); return report(o, EXIT.CANNOT_RUN, res); }
    requested = lane.lane.parts;
  } else {
    if (!cards.has(o.target)) { res.errors.push(`"${o.target}" is not in the catalog`); return report(o, EXIT.FAIL, res); }
    requested = [o.target];
  }

  // 2. Refusals, before anything is written.
  const paidOk = o.paid || studio.paid === true;
  const order = installOrder(requested, cmap);
  const refused = [];
  for (const id of order) {
    const p = cards.get(id);
    if (!p) { refused.push(`"${id}" is not in the catalog`); continue; }
    const bad = validateCard(p.card, p.dir, { cards: cmap });
    if (bad.length) { res.errors.push(`card ${id} is invalid:`, ...bad.map((e) => `  ${e}`)); return report(o, EXIT.CANNOT_RUN, res); }
    if (p.card.source.how === 'link-only') refused.push(`${id} is link-only: it cannot be installed. Read it here: ${p.card.source.url}`);
    else if (p.card.paid_api && !paidOk) {
      const a = p.card.paid_api;
      refused.push(`${id} uses a paid service (${a.service}, sends ${a.sends}; key in ${a.env}). Add it with --paid, or use its free fallback: ${a.free_fallback}`);
    }
  }
  if (refused.length) { res.errors.push(...refused); res.refused = refused; return report(o, EXIT.FAIL, res); }

  // 3. Plan each part; look for changed or foreign files.
  const recorded = new Map(studio.parts.map((r) => [r.id, r]));
  const plan = [];
  const conflicts = [];
  for (const id of order) {
    const { card, dir: cardDir } = cards.get(id);
    const rec = recorded.get(id);
    const files = partFiles(card, cardDir);
    if (rec) {
      for (const to of Object.keys(rec.files ?? {})) { const b = pathProblem(dir, to) ?? notFileProblem(dir, to); if (b) conflicts.push(`${b} (part ${id})`); }
      const changed = Object.entries(rec.files ?? {}).filter(([to, h]) => hashIfFile(join(dir, to)) !== h).map(([to]) => to);
      if (changed.length) conflicts.push(...changed.map((to) => `${to} was changed after install (part ${id}); not overwritten`));
      else plan.push({ id, card, files, present: true });
      continue;
    }
    for (const f of files) {
      const dest = join(dir, f.to);
      const bad = pathProblem(dir, f.to) ?? notFileProblem(dir, f.to);
      if (bad) { conflicts.push(`${bad}; not overwritten`); continue; }
      if (existsSync(dest) && fileHash(dest) !== fileHash(f.from)) conflicts.push(`${f.to} already exists and differs from the catalog copy; not overwritten`);
    }
    plan.push({ id, card, files, present: false });
  }
  let recipe = null;
  if (lane) {
    const src = join(lane.dir, lane.lane.recipe);
    const content = readFileSync(src);
    const h = sha256(content);
    const known = studio.lane_recipes[laneId];
    for (const rel of recipePaths(laneId)) {
      const dest = join(dir, rel);
      const bad = pathProblem(dir, rel) ?? notFileProblem(dir, rel);
      if (bad) { conflicts.push(`${bad}; not overwritten`); continue; }
      if (existsSync(dest) && fileHash(dest) !== h && fileHash(dest) !== known) conflicts.push(`${rel} was changed (or is not from this catalog); not overwritten`);
    }
    recipe = { content, hash: h };
  }
  if (conflicts.length) { res.errors.push(...conflicts); res.conflicts = conflicts; return report(o, EXIT.FAIL, res); }

  // 4. Do it (or describe it).
  const today = new Date().toISOString().slice(0, 10);
  for (const item of plan) {
    const { id, card, files, present } = item;
    if (present) { res.present.push(id); continue; }
    res.installed.push(id);
    res.lines.push(`${o.dryRun ? 'would add' : 'added'} ${id}${card.builtin ? ' (builtin: a command of this CLI)' : ''}${files.length ? `: ${files.map((f) => f.to).join(', ')}` : ''}`);
    for (const n of missingNeeds(card, dir)) res.warnings.push(`${id} needs ${n.tool}, which was not found. Install it: ${n.hint}`);
    if (card.source.how === 'registry') res.next.push(`${id} is a HyperFrames registry block: run \`npx hyperframes add ${card.registry}\` in the studio to fetch it`);
    if (o.dryRun) continue;
    const hashes = copyInto(dir, files);
    if (card.attribution) appendNotice(dir, card.attribution);
    const rec = { id, source: sourceLabel(card), hash: files.length ? combinedHash(hashes) : null, added: today, files: hashes, requires: deps(card) };
    if (card.attribution) rec.attribution = card.attribution;
    studio.parts.push(rec);
    if (files.length && card.docs) res.docs[id] = readFileSync(join(cards.get(id).dir, card.docs), 'utf8').trim();
  }
  for (const id of res.present) res.lines.push(`${id}: already installed, unchanged`);
  if (lane) {
    const had = studio.lanes.includes(laneId);
    res.lane = laneId;
    res.lines.push(`${o.dryRun ? 'would add' : had ? 'refreshed' : 'added'} lane ${laneId}: recipe in ${recipePaths(laneId).join(' and ')}`);
    if (!o.dryRun) {
      for (const rel of recipePaths(laneId)) { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), recipe.content); }
      if (!had) studio.lanes.push(laneId);
      studio.lane_recipes[laneId] = recipe.hash;
    }
  }
  if (!o.dryRun && (res.installed.length || lane)) writeStudio(dir, studio);
  if (res.installed.length === 0 && !lane && res.present.length) res.lines.push('nothing to do');
  for (const [id, text] of Object.entries(res.docs)) res.lines.push('', `--- ${id} ---`, text);
  for (const w of res.warnings) res.lines.push(`! ${w}`);
  for (const n of res.next) res.lines.push(`> ${n}`);
  return report(o, EXIT.OK, res);
}

export async function runRemove(argv = []) {
  const o = parse(argv, {}, REMOVE_USAGE);
  if (!o) return EXIT.USAGE;
  const res = { command: 'remove', target: o.target, removed: [], kept: [], lines: [], errors: [] };
  const ctx = load(o, res);
  if (!ctx) return report(o, EXIT.CANNOT_RUN, res);
  const { dir, studio, lanes } = ctx;
  res.studio = dir;
  const recs = new Map(studio.parts.map((r) => [r.id, r]));
  const recMap = new Map(studio.parts.map((r) => [r.id, { requires: r.requires ?? [] }]));

  const isLane = o.target.startsWith('lane:');
  const laneId = isLane ? o.target.slice(5) : null;
  let toRemove;
  const problems = [];
  if (isLane) {
    if (!studio.lanes.includes(laneId)) { res.errors.push(`lane "${laneId}" is not installed in this studio`); return report(o, EXIT.FAIL, res); }
    const lane = lanes.get(laneId);
    if (!lane) { res.errors.push(`lane "${laneId}" is not in the catalog, so its parts cannot be worked out`); return report(o, EXIT.CANNOT_RUN, res); }
    const candidates = closure(lane.lane.parts.filter((p) => recs.has(p)), recMap);
    const keepRoots = new Set([...recs.keys()].filter((id) => !candidates.has(id)));
    for (const l of studio.lanes) if (l !== laneId) for (const p of lanes.get(l)?.lane.parts ?? []) keepRoots.add(p);
    const keep = closure([...keepRoots].filter((id) => recs.has(id)), recMap);
    toRemove = [...candidates].filter((id) => recs.has(id) && !keep.has(id));
    res.kept = [...candidates].filter((id) => recs.has(id) && keep.has(id));
    const known = studio.lane_recipes[laneId];
    for (const rel of recipePaths(laneId)) {
      const bad = pathProblem(dir, rel) ?? notFileProblem(dir, rel);
      if (bad) { problems.push(`${bad}; not deleted`); continue; }
      if (existsSync(join(dir, rel)) && fileHash(join(dir, rel)) !== known) problems.push(`${rel} was changed after install; not deleted`);
    }
  } else {
    if (!recs.has(o.target)) { res.errors.push(`"${o.target}" is not installed in this studio`); return report(o, EXIT.FAIL, res); }
    const users = studio.parts.filter((r) => r.id !== o.target && (r.requires ?? []).includes(o.target)).map((r) => r.id);
    if (users.length) { res.errors.push(`${o.target} is required by ${users.join(', ')}; remove those first`); return report(o, EXIT.FAIL, res); }
    toRemove = [o.target];
  }
  for (const id of toRemove) {
    const rec = recs.get(id);
    const own = Object.keys(rec.files ?? {});
    if (own.length === 0) continue;
    const root = `parts/${id}`;
    const rootBad = pathProblem(dir, `${root}/x`) ?? pathProblem(dir, root);
    if (rootBad) { problems.push(`${rootBad}; not deleted`); continue; }
    for (const [to, h] of Object.entries(rec.files)) {
      const bad = pathProblem(dir, to) ?? notFileProblem(dir, to);
      if (bad) problems.push(`${bad}; not deleted`);
      else if (existsSync(join(dir, to)) && fileHash(join(dir, to)) !== h) problems.push(`${to} was changed after install; not deleted`);
    }
    for (const f of listFiles(join(dir, root))) if (!(`${root}/${f}` in rec.files)) problems.push(`${root}/${f} was added after install; not deleted`);
  }
  if (problems.length) { res.errors.push(...problems); res.conflicts = problems; return report(o, EXIT.FAIL, res); }

  for (const id of toRemove) {
    const rec = recs.get(id);
    if (Object.keys(rec.files ?? {}).length) removeTree(dir, `parts/${id}`);
    if (rec.attribution) removeNotice(dir, rec.attribution);
    studio.parts = studio.parts.filter((r) => r.id !== id);
    res.removed.push(id);
    res.lines.push(`removed ${id}`);
  }
  if (isLane) {
    for (const rel of recipePaths(laneId)) rmSync(join(dir, rel), { force: true });
    studio.lanes = studio.lanes.filter((l) => l !== laneId);
    delete studio.lane_recipes[laneId];
    res.lane = laneId;
    res.lines.push(`removed lane ${laneId} (recipe deleted)`);
    for (const id of res.kept) res.lines.push(`kept ${id}: still needed by another installed lane or part`);
  }
  writeStudio(dir, studio);
  return report(o, EXIT.OK, res);
}
