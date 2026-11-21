// text.mjs: the pure, testable parts of assemble-long. Word JSON -> caption groups, SRT cues; chapters JSON ->
// YouTube chapter list, with the validator. No I/O, no ffmpeg. Own code, zero dependencies.

export const r3 = (x) => Math.round(x * 1000) / 1000;
const SENT = /[.!?…]["”')]*$/u;

/** Words as { w, start, end } sorted by start; accepts w | text | word; drops entries without text or times. */
export function cleanWords(input) {
  const list = Array.isArray(input) ? input : input?.words;
  if (!Array.isArray(list)) throw new Error("not a word JSON ({ words: [...] })");
  return list
    .map((x) => ({ w: x.w ?? x.text ?? x.word, start: +x.start, end: +x.end }))
    .filter((x) => typeof x.w === "string" && x.w.trim() && isFinite(x.start) && isFinite(x.end))
    .sort((x, y) => x.start - y.start);
}

/** Same grouping rules as the `captions` part (build-captions.mjs): pop = 2-4 words, clean = sentence lines. */
export function groupWords(words, style, portrait) {
  const cfg = style === "pop"
    ? { maxWords: portrait ? 3 : 4, maxChars: portrait ? 18 : 26, pause: 0.15 }
    : { maxWords: portrait ? 6 : 9, maxChars: portrait ? 40 : 80, pause: 0.4 };
  const groups = [];
  let cur = [];
  const flush = () => { if (cur.length) groups.push(cur); cur = []; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const chars = cur.reduce((s, x) => s + x.w.length + 1, 0) + w.w.length;
    if (cur.length && (cur.length >= cfg.maxWords || chars > cfg.maxChars)) flush();
    cur.push(w);
    const next = words[i + 1];
    if (SENT.test(w.w) || (next && next.start - w.end >= cfg.pause) || (style === "clean" && /[,;:]$/.test(w.w) && cur.length >= 4)) flush();
  }
  flush();
  return groups;
}

/**
 * Caption states on the frame grid: [{ group, word (index or -1), from, to }] in seconds. A group shows from just before
 * its first word until a quarter second after its last; while it shows, `highlight` gives one state per word (that word
 * in the accent colour), otherwise one state for the whole group. Boundaries are multiples of 1/fps, never overlap.
 */
export function captionStates(groups, { fps = 30, total, highlight = true }) {
  const q = (t) => Math.round(t * fps) / fps;
  const out = [];
  groups.forEach((g, gi) => {
    const start = Math.max(0.1, g[0].start - 0.04);
    const nextStart = groups[gi + 1] ? Math.max(0.1, groups[gi + 1][0].start - 0.04) : total;
    let end = Math.min(g[g.length - 1].end + 0.25, nextStart, total);
    if (end - start < 0.3) end = Math.min(total, start + 0.3);
    end = Math.min(end, nextStart);
    if (!highlight) { out.push({ group: gi, word: -1, from: q(start), to: q(end) }); return; }
    g.forEach((w, wi) => {
      const from = wi === 0 ? start : Math.max(start, w.start);
      const to = wi === g.length - 1 ? end : Math.min(end, Math.max(from, g[wi + 1].start));
      out.push({ group: gi, word: wi, from: q(from), to: q(to) });
    });
  });
  // make them strictly sequential and non-empty on the grid
  const res = [];
  let t = 0;
  for (const s of out) {
    const from = Math.max(s.from, t);
    const to = Math.max(s.to, from);
    if (to - from < 1 / fps - 1e-9) { if (res.length && s.group === res[res.length - 1].group) continue; continue; }
    res.push({ ...s, from: r3(from), to: r3(to) });
    t = to;
  }
  return res;
}

// ---- SRT -------------------------------------------------------------------------------------
const ts = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** Sentence-level cues: a cue ends at a sentence end, a pause of 0.7 s or more, or when it reaches 84 characters / 7 s. */
export function srtCues(words, { maxChars = 84, maxSeconds = 7, pause = 0.7 } = {}) {
  const cues = [];
  let cur = [];
  const flush = () => { if (cur.length) cues.push(cur); cur = []; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const chars = cur.reduce((s, x) => s + x.w.length + 1, 0) + w.w.length;
    if (cur.length && (chars > maxChars || w.end - cur[0].start > maxSeconds)) flush();
    cur.push(w);
    const next = words[i + 1];
    if (SENT.test(w.w) || (next && next.start - w.end >= pause)) flush();
  }
  flush();
  return cues.map((c, i) => {
    const start = c[0].start;
    let end = c[c.length - 1].end + 0.1;
    const next = cues[i + 1]?.[0].start;
    if (next !== undefined) end = Math.min(end, next);
    return { start, end: Math.max(end, start + 0.3), text: c.map((x) => x.w).join(" ") };
  });
}

export function toSrt(words, opts) {
  const cues = srtCues(words, opts);
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");
}

// ---- chapters (YouTube) ------------------------------------------------------------------------
export function chapterStamp(t, hours) {
  const s = Math.floor(t + 1e-6);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return hours ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(sec).padStart(2, "0")}`;
}

/** YouTube's rules: first chapter at 0:00, at least 3 chapters, each at least 10 s long. Plus: strictly increasing, inside the video. */
export function validateChapters(list, duration) {
  const errors = [];
  if (!Array.isArray(list)) return ["chapters must be a JSON array of { start, title }"];
  if (list.length < 3) errors.push(`YouTube needs at least 3 chapters (got ${list.length})`);
  list.forEach((c, i) => {
    if (!c || typeof c !== "object") { errors.push(`chapter ${i}: not an object`); return; }
    if (!(typeof c.start === "number" && isFinite(c.start) && c.start >= 0)) errors.push(`chapter ${i}: start must be a number of seconds >= 0`);
    if (typeof c.title !== "string" || !c.title.trim()) errors.push(`chapter ${i}: title is empty`);
    else if (/[\r\n]/.test(c.title)) errors.push(`chapter ${i}: title has a line break`);
    else if (c.title.trim().length > 100) errors.push(`chapter ${i}: title longer than 100 characters`);
  });
  if (errors.length) return errors;
  if (list[0].start !== 0) errors.push(`the first chapter must start at 0:00 (starts at ${list[0].start} s)`);
  for (let i = 1; i < list.length; i++) {
    const gap = list[i].start - list[i - 1].start;
    if (gap <= 0) errors.push(`chapter ${i}: start ${list[i].start} s is not after the previous one`);
    else if (gap < 10) errors.push(`chapter ${i - 1} is only ${r3(gap)} s long; YouTube needs at least 10 s`);
  }
  if (isFinite(duration)) {
    const last = list[list.length - 1];
    if (last.start >= duration) errors.push(`the last chapter starts at ${last.start} s, but the video is ${r3(duration)} s`);
    else if (duration - last.start < 10) errors.push(`the last chapter would be only ${r3(duration - last.start)} s long; YouTube needs at least 10 s`);
  }
  return errors;
}

export function chaptersText(list, duration) {
  const errors = validateChapters(list, duration);
  if (errors.length) throw new Error("chapters invalid:\n  " + errors.join("\n  "));
  const hours = Math.max(duration || 0, list[list.length - 1].start) >= 3600;
  return list.map((c) => `${chapterStamp(c.start, hours)} ${c.title.trim()}`).join("\n") + "\n";
}
