// rss.mjs: a small, dependency-free podcast RSS reader (RSS 2.0 + iTunes tags). Pure functions, tested.
// Not a general XML parser: it reads <channel> fields and <item> blocks, CDATA and entities, which is what podcast
// feeds use. Anything it cannot read is left out, never guessed.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decode = (s) => String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

// HTML (episode descriptions) -> plain text with paragraph breaks
export const htmlToText = (s) => decode(String(s ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<\s*br\s*\/?>/gi, '\n')
  .replace(/<\/\s*(p|div|li|h\d)\s*>/gi, '\n')
  .replace(/<li[^>]*>/gi, '- ')
  .replace(/<[^>]+>/g, ''))
  .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// first <tag ...>text</tag> inside xml (tag may carry a namespace prefix, e.g. itunes:duration)
export function tag(xml, name) {
  const m = new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}>`, 'i').exec(xml);
  return m ? decode(m[1]).trim() : null;
}
export function attr(xml, name, a) {
  const m = new RegExp(`<${esc(name)}(\\s[^>]*?)/?>`, 'i').exec(xml);
  if (!m) return null;
  const v = new RegExp(`\\s${esc(a)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(m[1]);
  return v ? decode(v[2] ?? v[3]) : null;
}

// "01:02:03" | "62:03" | "3723" -> seconds
export function durationSeconds(s) {
  if (s == null || s === '') return null;
  const p = String(s).trim().split(':').map(Number);
  if (p.some((x) => !Number.isFinite(x))) return null;
  return p.reduce((acc, x) => acc * 60 + x, 0);
}

export const slug = (s, max = 48) => String(s).toLocaleLowerCase('tr')
  .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  .replace(new RegExp(`^(.{1,${max}})(-|$).*`), '$1') || 'episode';  // whole words, at most max characters

export function parseFeed(xml) {
  const ch = /<channel[^>]*>([\s\S]*)<\/channel>/i.exec(xml);
  if (!ch) throw new Error('not a podcast RSS feed (no <channel>)');
  const body = ch[1];
  const head = body.split(/<item[\s>]/i)[0];
  const show = {
    title: tag(head, 'title'),
    description: htmlToText(tag(head, 'description') ?? tag(head, 'itunes:summary') ?? ''),
    author: tag(head, 'itunes:author'),
    language: tag(head, 'language'),
    link: tag(head, 'link'),
    image: attr(head, 'itunes:image', 'href') ?? tag(tag(head, 'image') ?? '', 'url'),
    categories: [...head.matchAll(/<itunes:category\s[^>]*text="([^"]*)"/gi)].map((m) => decode(m[1])),
    explicit: tag(head, 'itunes:explicit'),
  };
  const items = [...body.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const episodes = items.map((it) => {
    const date = tag(it, 'pubDate');
    const t = date ? Date.parse(date) : NaN;
    return {
      guid: tag(it, 'guid'),
      title: tag(it, 'title'),
      date: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null,
      duration_s: durationSeconds(tag(it, 'itunes:duration')),
      season: tag(it, 'itunes:season') ? +tag(it, 'itunes:season') : null,
      number: tag(it, 'itunes:episode') ? +tag(it, 'itunes:episode') : null,
      type: tag(it, 'itunes:episodeType'),
      description: htmlToText(tag(it, 'content:encoded') ?? tag(it, 'description') ?? tag(it, 'itunes:summary') ?? ''),
      link: tag(it, 'link'),
      image: attr(it, 'itunes:image', 'href'),
      audio: attr(it, 'enclosure', 'url') ? { url: attr(it, 'enclosure', 'url'), type: attr(it, 'enclosure', 'type'), bytes: +attr(it, 'enclosure', 'length') || null } : null,
    };
  });
  // oldest first, numbered 1..n in publishing order (feeds list newest first); trailers keep their place
  episodes.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  episodes.forEach((e, i) => { e.n = i + 1; });
  return { show, episodes };
}

// show names from different directories differ in quotes and case: "real G’s" vs "Real G's"
export const sameName = (a, b) => {
  const n = (s) => String(s ?? '').toLocaleLowerCase('tr').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
  return n(a) !== '' && n(a) === n(b);
};
