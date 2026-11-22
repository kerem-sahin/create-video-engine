#!/usr/bin/env node
// show-reader: learn what a show already has published: its episode list, titles, dates, descriptions, durations
// and (when the feed gives them) the audio files. The material a person already has is the best teacher.
//
//   node show-reader.mjs read <source> --out brands/<slug>/sources/show.json [--rss <feed url>]
//      <source>: a podcast RSS feed URL, a Spotify show/episode link, an Apple Podcasts link, a local folder of
//      recordings, or a saved feed file (.xml/.rss). Network: only the requests needed to read that source.
//   node show-reader.mjs download --show show.json --dir brands/<slug>/sources/episodes [--latest 3] [--episodes 1,4]
//      fetches the episodes' audio files named "<nn>-<title-slug>.<ext>" (never the original file name), checks each
//      file's duration against the feed, and records the local path in show.json. Run only after the person agreed.
//
// Spotify gives no feed. The show name and its newest episode title come from Spotify's public embed page; the feed
// is looked up in the Apple Podcasts directory by name and accepted only when its newest episode has the same title
// (`match: "confirmed"`). A name match without that check is `match: "name-only"` and the agent must ask.
// Exit: 0 ok, 1 read but incomplete (no episode list, unconfirmed match, a download failed its check), 2 cannot run, 64 usage.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, createWriteStream, renameSync, rmSync } from 'node:fs';
import { resolve, join, extname, basename, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseFeed, sameName, slug, decode } from './rss.mjs';

const UA = 'create-video-engine-show-reader/0.1';
const AUDIO_EXT = new Set(['.m4a', '.mp3', '.wav', '.flac', '.aac', '.ogg', '.opus', '.mp4', '.mov', '.webm']);
const die = (m, c = 2) => { console.error('show-reader: ' + m); process.exit(c); };

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) { const k = t.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) a[k] = true; else { a[k] = v; i++; } }
    else a._.push(t);
  }
  return a;
}

async function get(url, { as = 'text', timeout = 20000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return as === 'json' ? await r.json() : await r.text();
  } finally { clearTimeout(t); }
}

const probeDuration = (file) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  const d = parseFloat(r.stdout); return Number.isFinite(d) ? Math.round(d * 10) / 10 : null;
};

// ---- sources -----------------------------------------------------------------------------------------------------
async function fromFeed(url, how) {
  const { show, episodes } = parseFeed(await get(url));
  return { source: { kind: 'rss', url, how }, show: { ...show, feed: url }, episodes };
}

async function spotifyEmbed(url) {
  const m = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(show|episode)\/([A-Za-z0-9]+)/.exec(url);
  if (!m) throw new Error('not a Spotify show or episode link');
  const html = await get(`https://open.spotify.com/embed/${m[1]}/${m[2]}`);
  const j = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!j) throw new Error('the Spotify embed page has no data block (the page format changed)');
  const e = JSON.parse(j[1])?.props?.pageProps?.state?.data?.entity;
  if (!e) throw new Error('the Spotify embed page has no show data');
  // a show embed describes its newest episode: title = episode, subtitle = show
  const showName = e.type === 'show' ? e.name : (e.subtitle || e.name);
  const latest = e.type === 'episode' || e.title !== showName ? { title: e.title, date: e.releaseDate?.isoString?.slice(0, 10) ?? null, duration_s: e.duration ? Math.round(e.duration / 1000) : null } : null;
  return { kind: m[1], id: m[2], showName, latest };
}

async function appleSearch(term) {
  const j = await get(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&term=${encodeURIComponent(term)}`, { as: 'json' });
  return (j.results ?? []).filter((r) => r.feedUrl);
}

async function fromSpotify(url, notes) {
  const sp = await spotifyEmbed(url);
  if (!sp.showName) throw new Error('could not read the show name from Spotify');
  notes.push(`Spotify: show "${sp.showName}"${sp.latest ? `, newest episode "${sp.latest.title}"` : ''}`);
  const cands = (await appleSearch(sp.showName)).filter((r) => sameName(r.collectionName, sp.showName));
  for (const c of cands) {
    let feed; try { feed = await fromFeed(c.feedUrl, 'Apple Podcasts directory, matched on the show name'); } catch (err) { notes.push(`candidate feed ${c.feedUrl} unreadable: ${err.message}`); continue; }
    const newest = feed.episodes[feed.episodes.length - 1];
    if (sp.latest && newest && decode(newest.title) === decode(sp.latest.title)) {
      feed.source = { kind: 'rss', url: c.feedUrl, how: 'found in the Apple Podcasts directory by the Spotify show name; its newest episode title matches Spotify', from: url };
      feed.match = 'confirmed';
      return feed;
    }
    if (cands.length === 1 && !sp.latest) { feed.match = 'name-only'; feed.source.from = url; notes.push('one directory entry with this name; Spotify gave no episode to compare: ask the person'); return feed; }
    notes.push(`candidate ${c.feedUrl}: newest episode "${newest?.title}" differs from Spotify's`);
  }
  // no feed: what Spotify itself shows
  notes.push('no feed found: only the show name and its newest episode are known. Ask the person for the RSS link (their hosting dashboard shows it) or the recordings.');
  return { source: { kind: 'spotify-embed', url, how: 'Spotify embed page (newest episode only)' }, match: 'none', show: { title: sp.showName }, episodes: sp.latest ? [{ n: 1, ...sp.latest, description: null, audio: null }] : [] };
}

async function fromApple(url) {
  const id = /\/id(\d+)/.exec(url)?.[1];
  if (!id) throw new Error('no podcast id (…/id123456) in the Apple Podcasts link');
  const j = await get(`https://itunes.apple.com/lookup?id=${id}`, { as: 'json' });
  const feedUrl = j.results?.[0]?.feedUrl;
  if (!feedUrl) throw new Error('Apple Podcasts lists no feed for this show');
  const f = await fromFeed(feedUrl, 'Apple Podcasts lookup by id'); f.source.from = url; return f;
}

function fromFolder(dir) {
  const files = readdirSync(dir).filter((f) => AUDIO_EXT.has(extname(f).toLowerCase())).map((f) => ({ f, p: join(dir, f), t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t);
  // file names are not titles (they can hold private things: an address, a person): titles stay empty until the person gives them
  const episodes = files.map((x, i) => ({ n: i + 1, title: null, date: new Date(x.t).toISOString().slice(0, 10), duration_s: probeDuration(x.p), description: null, audio: null, local: x.p }));
  return { source: { kind: 'folder', url: dir, how: 'local recordings, ordered by file date; titles to be given by the person' }, show: { title: null }, episodes };
}

// ---- commands ----------------------------------------------------------------------------------------------------
async function readCmd(a) {
  const src = a._[1];
  if (!src || typeof a.out !== 'string') die('usage: read <rss url | spotify link | apple link | folder | feed.xml> --out show.json [--rss <feed url>]', 64);
  const notes = [];
  let r;
  try {
    if (typeof a.rss === 'string') r = await fromFeed(a.rss, 'feed given by the person');
    else if (/^https?:\/\/(open\.)?spotify\.com\//.test(src) || /open\.spotify\.com/.test(src)) r = await fromSpotify(src, notes);
    else if (/podcasts\.apple\.com/.test(src)) r = await fromApple(src);
    else if (/^https?:\/\//.test(src)) r = await fromFeed(src, 'feed URL');
    else if (existsSync(src) && statSync(src).isDirectory()) r = fromFolder(resolve(src));
    else if (existsSync(src)) { const { show, episodes } = parseFeed(readFileSync(src, 'utf8')); r = { source: { kind: 'rss-file', url: resolve(src), how: 'saved feed file' }, show, episodes }; }
    else die(`cannot read "${src}": not a link, a folder or a file`, 64);
  } catch (e) { die(e.message); }
  const out = resolve(a.out);
  // keep what an earlier run downloaded or the person wrote (local files, titles they gave)
  if (existsSync(out)) {
    try {
      const old = JSON.parse(readFileSync(out, 'utf8'));
      const key = (e) => e.guid || e.audio?.url || e.local || `${e.date}|${e.title}`;
      const prev = new Map((old.episodes ?? []).map((e) => [key(e), e]));
      for (const e of r.episodes) { const o = prev.get(key(e)); if (o) { if (o.local && !e.local) e.local = o.local; if (!e.title && o.title) e.title = o.title; } }
    } catch { notes.push('the existing show.json could not be read; it was replaced'); }
  }
  const doc = { schema: 1, read_at: new Date().toISOString().slice(0, 10), match: r.match ?? 'direct', ...r, notes };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  const withAudio = r.episodes.filter((e) => e.audio?.url || e.local).length;
  const total = r.episodes.reduce((s, e) => s + (e.duration_s ?? 0), 0);
  console.log(`show-reader: "${r.show.title ?? '(no title)'}": ${r.episodes.length} episode(s), ${Math.round(total / 60)} min, ${withAudio} with audio (${doc.match}) -> ${out}`);
  for (const e of r.episodes) console.log(`  ${String(e.n).padStart(2)}  ${e.date ?? '          '}  ${e.duration_s ? `${Math.floor(e.duration_s / 60)}:${String(Math.round(e.duration_s % 60)).padStart(2, '0')}` : '   ?'}  ${e.title ?? '(title to ask)'}`);
  for (const n of notes) console.log('  note: ' + n);
  if (!r.episodes.length || doc.match === 'name-only' || doc.match === 'none') process.exit(1);
}

async function downloadCmd(a) {
  if (typeof a.show !== 'string' || typeof a.dir !== 'string') die('usage: download --show show.json --dir <dir> [--latest N] [--episodes 1,4]', 64);
  const showPath = resolve(a.show), dir = resolve(a.dir);
  const doc = JSON.parse(readFileSync(showPath, 'utf8'));
  let eps = doc.episodes.filter((e) => e.audio?.url);
  if (typeof a.episodes === 'string') { const want = new Set(a.episodes.split(',').map(Number)); eps = eps.filter((e) => want.has(e.n)); }
  if (a.latest !== undefined) eps = eps.slice(-Math.max(1, +a.latest));
  if (!eps.length) die('no episode with an audio link to download (see show.json)', 1);
  mkdirSync(dir, { recursive: true });
  const problems = [];
  for (const e of eps) {
    if (e.local && existsSync(e.local)) { console.log(`  ${e.n}: already here (${basename(e.local)})`); continue; }
    const ext = (extname(new URL(e.audio.url).pathname).toLowerCase().match(/^\.[a-z0-9]{2,4}$/) || [''])[0] || (e.audio.type?.includes('mpeg') ? '.mp3' : '.m4a');
    const file = join(dir, `${String(e.n).padStart(2, '0')}-${slug(e.title ?? 'episode')}${ext}`);
    const part = file + '.part';
    try {
      const r = await fetch(e.audio.url, { headers: { 'user-agent': UA }, redirect: 'follow' });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      await pipeline(Readable.fromWeb(r.body), createWriteStream(part));
      renameSync(part, file);
    } catch (err) { rmSync(part, { force: true }); problems.push(`${e.n}: download failed (${err.message})`); continue; }
    const got = probeDuration(file);
    if (got == null) { problems.push(`${e.n}: the file is not readable audio`); continue; }
    if (e.duration_s && Math.abs(got - e.duration_s) > Math.max(5, e.duration_s * 0.03)) problems.push(`${e.n}: ${got} s, the feed says ${e.duration_s} s`);
    e.local = file;
    console.log(`  ${e.n}: ${basename(file)} (${Math.round(got / 60)} min)`);
    writeFileSync(showPath, JSON.stringify(doc, null, 2) + '\n');
  }
  if (problems.length) { console.error('show-reader: download checks FAILED:\n  ' + problems.join('\n  ')); process.exit(1); }
  console.log(`show-reader: ${eps.length} episode(s) in ${dir}`);
}

const a = parseArgs(process.argv.slice(2));
if (a._[0] === 'read') await readCmd(a);
else if (a._[0] === 'download') await downloadCmd(a);
else die('usage: show-reader.mjs read <source> --out show.json | download --show show.json --dir <dir> (see the header of this file)', 64);
