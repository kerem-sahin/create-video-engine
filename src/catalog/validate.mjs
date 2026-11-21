import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export const KINDS = ['scene', 'motion', 'check', 'sound', 'tool', 'recipe', 'style', 'hf-block'];
export const HOW = ['own code', 'copied', 'link-only', 'registry'];
export const OPEN_LICENCES = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'CC0-1.0', 'CC0', 'CC-BY-4.0', 'own'];
// Licences that forbid commercial use: the card may point to the source but nothing is copied.
export const NONCOMMERCIAL_LICENCES = ['PolyForm-Noncommercial', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'CC-BY-NC-ND-4.0'];
export const LANES_DIR = 'lanes';
const isNonCommercial = (l) => isStr(l) && (NONCOMMERCIAL_LICENCES.includes(l) || /^CC-BY-NC/.test(l) || /noncommercial/i.test(l));

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const relSafe = (p) => isStr(p) && !isAbsolute(p) && !p.split(/[\\/]/).includes('..');
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/**
 * Returns a list of error messages (empty = valid). `cardDir` is the card's own folder; file paths resolve there.
 * `ctx.cards` (Map id -> card) enables the cross-card checks (requires, free_fallback); without it they are skipped.
 */
export function validateCard(card, cardDir, ctx = {}) {
  const errs = [];
  if (!isObj(card)) return ['card must be a JSON object'];
  if (card.schema === undefined || card.schema === 1) return ['schema: this is a schema 1 card; migrate it to schema 2 (see catalog/README.md)'];
  if (card.schema !== 2) return [`schema: must be 2, got ${JSON.stringify(card.schema)}`];

  for (const f of ['id', 'title', 'what_it_does', 'when_to_use']) {
    if (!isStr(card[f])) errs.push(`${f}: required, non-empty string`);
  }
  const id = isStr(card.id) ? card.id : null;
  if (id && !ID_RE.test(id)) errs.push('id: lowercase letters, digits and hyphens only');
  if (!KINDS.includes(card.kind)) errs.push(`kind: must be one of ${KINDS.join(', ')}`);

  if (!Array.isArray(card.lanes) || card.lanes.length === 0 || card.lanes.some((l) => !isStr(l) || !ID_RE.test(l))) {
    errs.push('lanes: required non-empty array of lane ids');
  }
  if (typeof card.builtin !== 'boolean') errs.push('builtin: required boolean');
  const builtin = card.builtin === true;

  const s = card.source;
  let how = null;
  let licence = null;
  if (!isObj(s)) errs.push('source: required object {repo, url, licence, how}');
  else {
    for (const f of ['repo', 'url', 'how']) if (!isStr(s[f])) errs.push(`source.${f}: required, non-empty string`);
    if (isStr(s.url) && !/^https?:\/\//.test(s.url)) errs.push('source.url: must start with http:// or https://');
    how = s.how;
    licence = s.licence;
    if (isStr(how) && !HOW.includes(how)) errs.push(`source.how: must be one of ${HOW.join(', ')}`);
    if (s.ref !== undefined && s.ref !== null && !isStr(s.ref)) errs.push('source.ref: must be a commit sha string or null');
    if (s.assets_licence !== undefined && s.assets_licence !== null && !isStr(s.assets_licence)) errs.push('source.assets_licence: must be a string or null');
    if (how === 'link-only') {
      if (licence !== undefined && licence !== null && !isStr(licence)) errs.push('source.licence: if present, a string');
    } else if (!isStr(licence)) {
      errs.push('source.licence: required (a part with no licence can only be link-only)');
    } else if (isNonCommercial(licence)) {
      errs.push(`source.licence: ${licence} is non-commercial, so how must be "link-only"`);
    } else if (!OPEN_LICENCES.includes(licence)) {
      errs.push(`source.licence: must be one of ${OPEN_LICENCES.join(', ')} (or a non-commercial licence with how "link-only")`);
    }
    if (how === 'copied' && !isStr(s.ref)) errs.push('source.ref: a copied part must record the commit sha it was copied from');
  }

  if (card.attribution !== undefined && card.attribution !== null && !isStr(card.attribution)) errs.push('attribution: if present, a non-empty string');
  if ((how === 'copied' || how === 'registry') && !isStr(card.attribution)) errs.push(`attribution: required when how is "${how}"`);

  if (how === 'registry') {
    if (!isStr(card.registry)) errs.push('registry: a registry part must name its HyperFrames registry block');
  } else if (card.registry !== undefined && card.registry !== null) errs.push('registry: only for how "registry"; otherwise null');

  const v = card.verified_with;
  if (!isObj(v)) errs.push('verified_with: required object {hyperframes, date}');
  else {
    if (!isStr(v.hyperframes)) errs.push('verified_with.hyperframes: required version string');
    if (!isStr(v.date) || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || Number.isNaN(Date.parse(v.date))) errs.push('verified_with.date: required, YYYY-MM-DD');
  }

  const files = card.files;
  if (!Array.isArray(files)) errs.push('files: required array (empty for builtin, link-only and registry parts)');
  else {
    const tos = new Set();
    for (const f of files) {
      if (!isObj(f) || !isStr(f.from) || !isStr(f.to)) { errs.push('files: each entry must be {"from": "...", "to": "..."}'); continue; }
      if (!relSafe(f.from)) errs.push(`files: from "${f.from}" must be a relative path inside the card folder`);
      else if (cardDir && !isFile(join(cardDir, f.from))) errs.push(`files: from "${f.from}" does not exist in the card folder`);
      const to = f.to.replaceAll('\\', '/');
      if (!relSafe(f.to) || (id && !to.startsWith(`parts/${id}/`)) || to.endsWith('/')) errs.push(`files: to "${f.to}" must be a file path under parts/${id ?? '<id>'}/`);
      if (tos.has(to)) errs.push(`files: to "${f.to}" is listed twice`);
      tos.add(to);
    }
    if (builtin && files.length > 0) errs.push('files: a builtin part must have no files');
    if (how === 'link-only' && files.length > 0) errs.push('files: a link-only part must have no files');
    if (how === 'registry' && files.length > 0) errs.push('files: a registry part must have no files');
    if (isNonCommercial(licence) && files.length > 0) errs.push(`files: ${licence} is non-commercial, so nothing may be copied (files must be empty)`);
    if (!builtin && (how === 'own code' || how === 'copied') && files.length === 0) errs.push(`files: a part with how "${how}" must list its files (or be builtin)`);
    if (how === 'copied' && cardDir && !isFile(join(cardDir, 'files', 'LICENSE'))) errs.push('files/LICENSE: a copied part must keep the upstream LICENSE next to its files');
  }
  if (builtin && how !== undefined && how !== null && how !== 'own code') errs.push('builtin: only an "own code" part can be builtin');

  if (card.docs !== undefined && card.docs !== null) {
    if (!relSafe(card.docs)) errs.push('docs: must be null or a relative path inside the card folder');
    else if (cardDir && !isFile(join(cardDir, card.docs))) errs.push(`docs: "${card.docs}" does not exist in the card folder`);
  }

  for (const f of ['requires', 'needs']) {
    if (!Array.isArray(card[f]) || card[f].some((x) => !isStr(x))) errs.push(`${f}: required array of strings (may be empty)`);
  }
  if (Array.isArray(card.requires) && ctx.cards) {
    for (const r of card.requires) {
      if (!isStr(r)) continue;
      if (r === id) errs.push('requires: a part cannot require itself');
      else if (!ctx.cards.has(r)) errs.push(`requires: "${r}" is not in the catalog`);
      else if (ctx.cards.get(r)?.source?.how === 'link-only') errs.push(`requires: "${r}" is link-only and cannot be installed`);
    }
  }

  const p = card.paid_api;
  if (p !== undefined && p !== null) {
    if (!isObj(p)) errs.push('paid_api: must be null or {service, env, free_fallback, sends}');
    else {
      for (const f of ['service', 'env', 'free_fallback', 'sends']) if (!isStr(p[f])) errs.push(`paid_api.${f}: required, non-empty string`);
      if (isStr(p.env) && !/^[A-Z][A-Z0-9_]*$/.test(p.env)) errs.push('paid_api.env: an environment variable name like ELEVENLABS_API_KEY');
      if (isStr(p.free_fallback) && ctx.cards) {
        const fb = ctx.cards.get(p.free_fallback);
        if (p.free_fallback === id) errs.push('paid_api.free_fallback: cannot be the part itself');
        else if (!fb) errs.push(`paid_api.free_fallback: "${p.free_fallback}" is not in the catalog`);
        else if (fb.paid_api) errs.push(`paid_api.free_fallback: "${p.free_fallback}" is itself a paid part`);
        else if (fb.source?.how === 'link-only') errs.push(`paid_api.free_fallback: "${p.free_fallback}" is link-only and cannot be installed`);
      }
    }
  }

  if (card.example !== null) {
    if (!relSafe(card.example)) errs.push('example: must be null or a relative path inside the card folder');
    else if (cardDir && !existsSync(join(cardDir, card.example))) errs.push(`example: "${card.example}" does not exist in the card folder`);
  }
  if (!Array.isArray(card.requirements) || card.requirements.some((r) => !isStr(r) || !/^[A-Z]\d+$/.test(r))) {
    errs.push('requirements: required array of requirement IDs like "G1"');
  }
  if (card.notes !== undefined && card.notes !== null && !isStr(card.notes)) errs.push('notes: if present, a non-empty string');
  return errs;
}

/** Validates a lane definition. `laneDir` is catalog/lanes/<id>. `ctx.cards` is a Map id -> card. */
export function validateLane(lane, laneDir, ctx = {}) {
  const errs = [];
  if (!isObj(lane)) return ['lane must be a JSON object'];
  if (lane.schema !== 2) errs.push('schema: must be 2');
  for (const f of ['id', 'title', 'for', 'ask']) if (!isStr(lane[f])) errs.push(`${f}: required, non-empty string`);
  if (isStr(lane.id) && !ID_RE.test(lane.id)) errs.push('id: lowercase letters, digits and hyphens only');
  if (!Array.isArray(lane.parts) || lane.parts.some((x) => !isStr(x))) errs.push('parts: required array of part ids (may be empty)');
  else {
    if (new Set(lane.parts).size !== lane.parts.length) errs.push('parts: an id is listed twice');
    if (ctx.cards) {
      for (const pid of lane.parts) {
        const c = ctx.cards.get(pid);
        if (!c) errs.push(`parts: "${pid}" is not in the catalog`);
        else if (c.source?.how === 'link-only') errs.push(`parts: "${pid}" is link-only and cannot be installed`);
      }
    }
  }
  if (!isStr(lane.recipe) || !relSafe(lane.recipe)) errs.push('recipe: required relative path inside the lane folder');
  else if (laneDir) {
    const f = join(laneDir, lane.recipe);
    if (!isFile(f)) errs.push(`recipe: "${lane.recipe}" does not exist in the lane folder`);
    else if (readFileSync(f, 'utf8').trim() === '') errs.push(`recipe: "${lane.recipe}" is empty`);
  }
  return errs;
}

const dirs = (p) => readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

function readJson(file, rel, problems) {
  if (!existsSync(file)) { problems.push({ card: rel, errors: [`${rel.split('/').pop()} is missing`] }); return null; }
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) { problems.push({ card: rel, errors: [`not valid JSON: ${e.message}`] }); return null; }
}

/** Reads every catalog/<kind>/<id>/part.json and catalog/lanes/<id>/lane.json under `catalogDir`. */
export function loadCatalog(catalogDir) {
  const parts = [];
  const lanes = [];
  const problems = [];
  if (!existsSync(catalogDir) || !statSync(catalogDir).isDirectory()) return { parts, lanes, problems: [`catalog directory not found: ${catalogDir}`] };
  for (const kind of dirs(catalogDir)) {
    if (kind === LANES_DIR) {
      for (const id of dirs(join(catalogDir, kind))) {
        const rel = `${kind}/${id}/lane.json`;
        const lane = readJson(join(catalogDir, kind, id, 'lane.json'), rel, problems);
        if (lane !== null) lanes.push({ rel, id, dir: join(catalogDir, kind, id), lane });
      }
      continue;
    }
    for (const id of dirs(join(catalogDir, kind))) {
      const rel = `${kind}/${id}/part.json`;
      const card = readJson(join(catalogDir, kind, id, 'part.json'), rel, problems);
      if (card !== null) parts.push({ rel, kind, id, dir: join(catalogDir, kind, id), card });
    }
  }
  return { parts, lanes, problems };
}

/** Detects a cycle in `requires`. Returns the cycle as an id path or null. */
function findCycle(cards) {
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1); stack.push(id);
    for (const r of cards.get(id)?.requires ?? []) {
      if (!cards.has(r)) continue;
      const c = visit(r);
      if (c) return c;
    }
    stack.pop(); state.set(id, 2);
    return null;
  };
  for (const id of cards.keys()) { const c = visit(id); if (c) return c; }
  return null;
}

/** Validates the whole catalog. Returns { results: [{card, ok, errors}], ok }. `_repoRoot` is unused (kept for callers). */
export function checkCatalog(catalogDir, _repoRoot) {
  const { parts, lanes, problems } = loadCatalog(catalogDir);
  const results = [];
  if (typeof problems[0] === 'string') return { ok: false, results: [{ card: '.', ok: false, errors: problems }] };
  for (const p of problems) results.push({ card: p.card, ok: false, errors: p.errors });
  const cards = new Map();
  for (const { card } of parts) if (isObj(card) && isStr(card.id)) cards.set(card.id, card);
  const cycle = findCycle(new Map([...cards].filter(([, c]) => Array.isArray(c.requires))));
  const seen = new Set();
  for (const { rel, kind, id, dir, card } of parts) {
    const errors = validateCard(card, dir, { cards });
    if (isObj(card) && card.kind !== kind) errors.push(`kind: "${card.kind}" does not match its folder "${kind}"`);
    if (isObj(card) && card.id !== id) errors.push(`id: "${card.id}" does not match its folder "${id}"`);
    if (isObj(card) && isStr(card.id)) {
      if (seen.has(card.id)) errors.push(`id: "${card.id}" is used by more than one card`);
      seen.add(card.id);
      if (cycle && cycle.includes(card.id)) errors.push(`requires: cycle ${cycle.join(' -> ')}`);
    }
    results.push({ card: rel, ok: errors.length === 0, errors });
  }
  for (const { rel, id, dir, lane } of lanes) {
    const errors = validateLane(lane, dir, { cards });
    if (isObj(lane) && lane.id !== id) errors.push(`id: "${lane.id}" does not match its folder "${id}"`);
    results.push({ card: rel, ok: errors.length === 0, errors });
  }
  // Every lane a card names should exist as a lane folder.
  const laneIds = new Set(lanes.map((l) => l.id));
  for (const r of results) {
    const part = parts.find((p) => p.rel === r.card);
    if (!part || !Array.isArray(part.card?.lanes)) continue;
    for (const l of part.card.lanes) if (isStr(l) && !laneIds.has(l)) { r.errors.push(`lanes: "${l}" has no catalog/lanes/${l}/lane.json`); r.ok = false; }
  }
  return { ok: results.every((r) => r.ok), results };
}
