import { writeFileSync } from 'node:fs';

export const API = 'https://api.openverse.org/v1/audio/';
const HOSTS = ['jamendo.com', 'freesound.org', 'wikimedia.org']; // what Openverse's audio providers serve from
const TYPES = new Set(['mp3', 'mp32', 'ogg', 'oga', 'wav', 'flac']);
const MAX_BYTES = 25 * 1024 * 1024;

export function allowedUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && HOSTS.some((h) => x.hostname === h || x.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

const words = (mood) => mood.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);

async function search(fetchFn, q) {
  const url = `${API}?${new URLSearchParams({ q, license: 'cc0,by', category: 'music', page_size: '20' })}`;
  const res = await fetchFn(url, { headers: { 'User-Agent': 'create-video-engine', Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`openverse ${res.status}`);
  const j = await res.json();
  return Array.isArray(j.results) ? j.results : [];
}

export function usable(r, duration) {
  const lic = String(r.license ?? '').toLowerCase();
  const secs = Number(r.duration) / 1000;
  return (lic === 'cc0' || lic === 'by') && TYPES.has(String(r.filetype ?? '').toLowerCase())
    && allowedUrl(r.url) && secs >= Math.min(duration, 30)
    && !(Number(r.filesize) > MAX_BYTES);
}

export function rank(cands, mood, duration) {
  const w = words(mood);
  const score = (r) => {
    const text = `${r.title ?? ''} ${(r.tags ?? []).map((t) => t.name ?? t).join(' ')}`.toLowerCase();
    const hits = w.filter((x) => text.includes(x)).length;
    const secs = Number(r.duration) / 1000;
    const lenGap = Math.abs(Math.min(secs, duration * 2) - duration) / duration; // longer is fine, trimmed; shorter loops
    return (String(r.license).toLowerCase() === 'cc0' ? 100 : 0) + hits * 10 - Math.min(lenGap, 5);
  };
  return [...cands].sort((a, b) => score(b) - score(a));
}

// Returns { ranked, considered }; throws on network failure (caller falls back).
export async function findCandidates(fetchFn, mood, duration) {
  const w = words(mood);
  const queries = [w.join(' '), ...(w.length > 1 ? w.filter((x) => x.length > 2).slice(0, 3) : [])];
  const seen = new Map();
  let considered = 0;
  for (const q of queries) {
    const results = await search(fetchFn, q);
    considered += results.length;
    for (const r of results) if (usable(r, duration) && !seen.has(r.id ?? r.url)) seen.set(r.id ?? r.url, r);
    if (seen.size >= 3) break; // the full phrase often matches nothing; single words are the fallback
  }
  return { ranked: rank([...seen.values()], mood, duration), considered };
}

export async function download(fetchFn, r, file) {
  const res = await fetchFn(r.url, { headers: { 'User-Agent': 'create-video-engine' }, signal: AbortSignal.timeout(90000) });
  if (!res.ok || (res.url && !allowedUrl(res.url))) throw new Error('download refused');
  if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('too large');
  const chunks = [];
  let size = 0;
  for await (const c of res.body) {
    size += c.length;
    if (size > MAX_BYTES) throw new Error('too large');
    chunks.push(c);
  }
  writeFileSync(file, Buffer.concat(chunks));
}

export function creditFor(r) {
  const lic = String(r.license).toLowerCase();
  const licence = lic === 'cc0' ? 'CC0 1.0' : `CC BY ${r.license_version ?? ''}`.trim();
  const attribution = (r.attribution && String(r.attribution).trim())
    || `"${r.title}" by ${r.creator ?? 'unknown'}, ${licence}`;
  return {
    title: r.title ?? 'untitled', creator: r.creator ?? 'unknown', licence,
    source: r.foreign_landing_url || r.detail_url || r.url, attribution,
  };
}
