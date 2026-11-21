import { join, resolve, dirname } from 'node:path';
import { PACKAGE_ROOT } from '../lib/constants.mjs';
import { err, out, printJson } from '../lib/log.mjs';
import { checkCatalog, loadCatalog } from './validate.mjs';

const USAGE = 'usage: catalog check [--dir <catalog-dir>] [--json] | catalog list [--lane <id>] [--dir <catalog-dir>] [--json]';

export async function runCatalog(argv) {
  const [sub, ...rest] = argv;
  if (sub !== 'check' && sub !== 'list') { err(sub ? `unknown catalog command ${sub}` : 'missing catalog command'); err(USAGE); return 64; }
  let dir = join(PACKAGE_ROOT, 'catalog');
  let json = false;
  let lane = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--json') json = true;
    else if (a === '--dir') {
      const v = rest[++i];
      if (!v || v.startsWith('--')) { err('--dir needs a directory'); err(USAGE); return 64; }
      dir = resolve(v);
    } else if (a === '--lane' && sub === 'list') {
      const v = rest[++i];
      if (!v || v.startsWith('--')) { err('--lane needs a lane id'); err(USAGE); return 64; }
      lane = v;
    } else { err(`unexpected argument ${a}`); err(USAGE); return 64; }
  }
  const root = dirname(dir);

  if (sub === 'list') {
    const { parts: all, lanes, problems } = loadCatalog(dir);
    if (typeof problems[0] === 'string') { err(problems[0]); return 2; }
    let parts = all;
    if (lane) {
      const def = lanes.find((l) => l.id === lane);
      if (!def) { err(`unknown lane ${lane} (${lanes.map((l) => l.id).join(', ') || 'none'})`); return 1; }
      const inLane = new Set(Array.isArray(def.lane?.parts) ? def.lane.parts : []);
      parts = all.filter(({ card }) => inLane.has(card?.id) || (Array.isArray(card?.lanes) && card.lanes.includes(lane)));
    }
    const laneRows = (lane ? lanes.filter((l) => l.id === lane) : lanes).map(({ id, lane: d }) => ({ id, title: d?.title ?? null, for: d?.for ?? null, ask: d?.ask ?? null, parts: Array.isArray(d?.parts) ? d.parts : [] }));
    if (json) printJson({ lanes: laneRows, parts: parts.map(({ card }) => ({ id: card.id, kind: card.kind, title: card.title, lanes: card.lanes ?? [], builtin: card.builtin === true, how: card.source?.how ?? null, paid: !!card.paid_api })) });
    else {
      if (laneRows.length) {
        out('lanes:');
        for (const l of laneRows) { out(`  ${l.id}: ${l.title ?? ''}`); if (l.ask) out(`    ask: ${l.ask}`); }
        out('');
      }
      for (const { card } of parts) out(`${String(card.id).padEnd(28)} ${String(card.kind).padEnd(7)} ${card.title}`);
    }
    return 0;
  }

  const res = checkCatalog(dir, root);
  if (res.results.length === 1 && res.results[0].card === '.') { err(res.results[0].errors[0]); return 2; }
  if (json) printJson(res);
  else {
    for (const r of res.results) {
      if (r.ok) out(`✓ ${r.card}`);
      else { out(`✗ ${r.card}`); for (const e of r.errors) out(`    ${e}`); }
    }
    out(res.ok ? `catalog ok: ${res.results.length} part(s)` : 'catalog has invalid cards');
  }
  return res.ok ? 0 : 1;
}
