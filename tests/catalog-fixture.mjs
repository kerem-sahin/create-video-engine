import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmp } from './helpers.mjs';

export const goodCard = (over = {}) => ({
  schema: 2, id: 'demo-part', kind: 'tool', title: 'Demo', what_it_does: 'Does one thing.', when_to_use: 'When needed.',
  lanes: ['demo-lane'],
  source: { repo: 'owner/demo', url: 'https://example.com/demo', ref: 'abc123', licence: 'MIT', assets_licence: null, how: 'copied' },
  attribution: 'demo-part: adapted from owner/demo (MIT), (c) Owner',
  builtin: false, registry: null,
  files: [{ from: 'files/demo.txt', to: 'parts/demo-part/demo.txt' }],
  docs: 'files/README.md', requires: [], needs: [], paid_api: null,
  verified_with: { hyperframes: '0.9.67', date: '2026-11-19' },
  example: null, requirements: ['G1'], ...over,
  ...(over.id && !over.files ? { files: [{ from: 'files/demo.txt', to: `parts/${over.id}/demo.txt` }] } : {}),
});

export const builtinCard = (id, over = {}) => ({
  ...goodCard({ id, lanes: ['demo-lane'], source: { repo: 'cve', url: 'https://example.com/cve', ref: null, licence: 'own', assets_licence: null, how: 'own code' }, attribution: null, builtin: true, files: [], docs: null, ...over }),
});

/** Writes catalog/<kind>/<id>/part.json plus the files a card needs. Returns the card dir. */
export function writeCard(catalog, card, { kind = card.kind, files = {}, license = true, bare = false } = {}) {
  const dir = join(catalog, kind, card.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'part.json'), JSON.stringify(card));
  const all = { ...files };
  if (!bare && !builtinOrLink(card)) {
    for (const f of card.files ?? []) if (!(f.from in all)) all[f.from] = `content of ${card.id}/${f.from}\n`;
    if (card.docs && !(card.docs in all)) all[card.docs] = `# ${card.id}\nusage note\n`;
    if (card.source?.how === 'copied' && license) all['files/LICENSE'] = 'MIT License\n';
  }
  for (const [p, c] of Object.entries(all)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
  return dir;
}
const builtinOrLink = (c) => c.builtin === true || c.source?.how === 'link-only' || c.source?.how === 'registry';

export function writeLane(catalog, lane, recipe = 'recipe text\n') {
  const dir = join(catalog, 'lanes', lane.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'lane.json'), JSON.stringify(lane));
  if (recipe !== null) writeFileSync(join(dir, lane.recipe ?? 'recipe.md'), recipe);
  return dir;
}

export const goodLane = (over = {}) => ({ schema: 2, id: 'demo-lane', title: 'Demo lane', for: 'Someone.', ask: 'Do you?', parts: ['demo-part'], recipe: 'recipe.md', ...over });

/** A temp catalog with the given cards and lanes (defaults: demo-part in demo-lane). Returns its path. */
export function makeCatalog({ cards = [goodCard()], lanes = [goodLane()] } = {}) {
  const root = tmp('cve-cat-');
  const catalog = join(root, 'catalog');
  mkdirSync(catalog, { recursive: true });
  for (const c of cards) writeCard(catalog, c);
  for (const l of lanes) writeLane(catalog, l);
  return catalog;
}
