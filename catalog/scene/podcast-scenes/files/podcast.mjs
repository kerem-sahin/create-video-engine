// podcast.mjs: shared helpers of the podcast-scenes part (own code, zero dependencies).
// Used by build-scene.mjs (the scene templates) and by assemble-long.mjs (audio mode). Nothing here touches the disk
// except loadFrameVars (reads the captions part's frame-vars.mjs) and nothing starts a process.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const r3 = (x) => Math.round(x * 1000) / 1000;
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const KINDS = ["stage", "waveform", "punchline", "quote", "topic", "reaction", "lower-third"];
export const SCENE_KINDS = ["waveform", "punchline", "quote", "topic", "reaction", "lower-third"]; // the timed blocks of scenes.json
export const LOOKS = ["ink-sketch", "clean"];
const CENTER_KINDS = ["punchline", "quote", "topic"]; // share the middle of the frame: two of them may not overlap
const MIN_SECONDS = { punchline: 1, quote: 2, topic: 2, reaction: 1, "lower-third": 2, waveform: 1 };
export const MAX_SECONDS = { punchline: 3.5 };

// ---- layout: one place, so the HTML templates and ffmpeg's overlays agree on pixels ------------------------------
export function layout(portrait) {
  return portrait
    ? { W: 1080, H: 1920, plate: { w: 480, h: 150, y: 120, xs: [40, 560] }, wave: { x: 140, y: 330, w: 800, h: 110 },
        react: { y: 500, w: 380, h: 330 }, center: { x: 70, y: 520, w: 940, h: 560 }, lower: { bottom: 1000, edge: 60, maxW: 760 } }
    : { W: 1920, H: 1080, plate: { w: 480, h: 156, y: 48, xs: [60, 1380] }, wave: { x: 640, y: 66, w: 640, h: 120 },
        react: { y: 290, w: 380, h: 330 }, center: { x: 160, y: 270, w: 1600, h: 380 }, lower: { bottom: 640, edge: 96, maxW: 900 } };
}

// ---- tiny reader for the flow-style `podcast: { ... }` block of frame.md ------------------------------------------
export function parseFlow(src) {
  let i = 0;
  const fail = (m) => { throw new Error(`podcast block: ${m} (near "${src.slice(Math.max(0, i - 12), i + 12).replace(/\s+/g, " ")}")`); };
  const ws = () => { for (;;) { while (i < src.length && /\s/.test(src[i])) i++; if (src[i] === "#") { while (i < src.length && src[i] !== "\n") i++; } else break; } };
  const str = () => { const q = src[i++]; let s = ""; while (i < src.length && src[i] !== q) { if (src[i] === "\\" && i + 1 < src.length) i++; s += src[i++]; } if (src[i] !== q) fail("unterminated string"); i++; return s; };
  const bare = (stop) => { const s = i; while (i < src.length && !stop.includes(src[i]) && src[i] !== "\n") i++; return src.slice(s, i).trim(); };
  const value = () => {
    ws();
    if (src[i] === "{") {
      i++; const o = {};
      for (;;) {
        ws(); if (src[i] === "}") { i++; return o; }
        if (i >= src.length) fail("unclosed {");
        const k = src[i] === '"' || src[i] === "'" ? str() : bare(":,}");
        ws(); if (src[i] !== ":") fail(`expected ":" after key "${k}"`); i++;
        o[k] = value(); ws(); if (src[i] === ",") i++;
        if (i >= src.length) fail("unclosed {");
      }
    }
    if (src[i] === "[") {
      i++; const a = [];
      for (;;) { ws(); if (src[i] === "]") { i++; return a; } if (i >= src.length) fail("unclosed ["); a.push(value()); ws(); if (src[i] === ",") i++; if (i >= src.length) fail("unclosed ["); }
    }
    if (src[i] === '"' || src[i] === "'") return str();
    const t = bare(",}]");
    if (t === "") fail("a value is missing or a bracket does not match");
    if (t === "true") return true; if (t === "false") return false; if (t === "null") return null;
    return /^-?\d+(\.\d+)?$/.test(t) ? +t : t;
  };
  const v = value(); ws(); if (i < src.length) fail("text after the block");
  return v;
}

/** The `podcast:` block of frame.md's frontmatter (flow style, may span lines), or null. */
export function podcastFromFrame(frameText) {
  const m = frameText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const at = lines.findIndex((l) => /^podcast:/.test(l));
  if (at < 0) return null;
  let text = lines[at].replace(/^podcast:/, "");
  if (!text.trim()) throw new Error("podcast block: write it in flow style, e.g. podcast: { look: \"ink-sketch\", hosts: [{id: \"A\", name: \"...\"}] }");
  const depth = (s) => { let d = 0, q = null; for (const c of s) { if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === "{" || c === "[") d++; else if (c === "}" || c === "]") d--; } return d; };
  let d = depth(text), k = at + 1;
  while (d > 0 && k < lines.length) { text += "\n" + lines[k]; d = depth(lines[k]) + d; k++; }
  return parseFlow(text);
}

/** Normalises and checks a podcast block: look, hosts (id, name, tag), accent_alt, background. Throws on a bad block. */
export function checkPodcast(p, { lookOverride } = {}) {
  const o = { ...(p || {}) };
  o.look = lookOverride || o.look || "clean";
  if (!LOOKS.includes(o.look)) throw new Error(`podcast.look must be ${LOOKS.join(" or ")}, got "${o.look}"`);
  if (!Array.isArray(o.hosts) || o.hosts.length < 1 || o.hosts.length > 3) throw new Error("podcast.hosts: one to three hosts, each {id, name, tag?}");
  const seen = new Set();
  o.hosts = o.hosts.map((h, i) => {
    if (!h || typeof h !== "object" || !h.id || !h.name) throw new Error(`podcast.hosts[${i}] needs id and name`);
    const id = String(h.id);
    if (seen.has(id)) throw new Error(`podcast.hosts: id "${id}" twice`);
    seen.add(id);
    return { id, name: String(h.name), tag: h.tag ? String(h.tag) : "" };
  });
  if (o.accent_alt !== undefined && !/^#[0-9a-fA-F]{3,8}$/.test(String(o.accent_alt))) throw new Error("podcast.accent_alt must be a #hex colour");
  return o;
}

// ---- turns (who talks when) ---------------------------------------------------------------------------------------
/** speakers.json {speakers, turns:[{start,end,speaker}]} (or a bare array) -> sorted turns, short blips dropped, near neighbours merged. */
export function normalizeTurns(raw, { minSeconds = 0.6, mergeGap = 0.8, hostIds = null } = {}) {
  const list = Array.isArray(raw) ? raw : raw?.turns;
  if (!Array.isArray(list)) throw new Error("turns: expected {speakers, turns:[{start,end,speaker}]} or an array of turns");
  const ok = [];
  list.forEach((t, i) => {
    if (!t || !(t.start >= 0) || !(t.end > t.start) || t.speaker === undefined || t.speaker === null) throw new Error(`turns[${i}]: needs start >= 0, end > start and speaker`);
    const speaker = String(t.speaker);
    if (hostIds && !hostIds.includes(speaker)) throw new Error(`turns[${i}]: speaker "${speaker}" is not one of the hosts (${hostIds.join(", ")})`);
    ok.push({ start: +t.start, end: +t.end, speaker });
  });
  ok.sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  let merged = 0, dropped = 0;
  for (const t of ok) {
    const last = [...out].reverse().find((u) => u.speaker === t.speaker);
    if (last && t.start - last.end <= mergeGap) { last.end = Math.max(last.end, t.end); merged++; }
    else out.push({ ...t });
  }
  const kept = out.filter((t) => { const keep = t.end - t.start >= minSeconds; if (!keep) dropped++; return keep; });
  return { turns: kept.map((t) => ({ start: r3(t.start), end: r3(t.end), speaker: t.speaker })), merged, dropped };
}

// ---- scenes.json ---------------------------------------------------------------------------------------------------
/** Checks the plan. Returns { errors, scenes } with frame numbers added: f0 (first frame), n (frames). Times are quantised to the frame grid. */
export function validateScenes(list, { duration, fps = 30, hostIds = null } = {}) {
  const errors = [];
  if (!Array.isArray(list)) return { errors: ["scenes.json must be an array of {start, end, kind, text, speaker}"], scenes: [] };
  const scenes = [];
  list.forEach((s, i) => {
    const at = `scene ${i}${s && s.kind ? ` (${s.kind})` : ""}`;
    if (!s || typeof s !== "object") { errors.push(`${at}: not an object`); return; }
    if (!SCENE_KINDS.includes(s.kind)) { errors.push(`${at}: kind must be one of ${SCENE_KINDS.join(", ")}`); return; }
    if (!(s.start >= 0) || !(s.end > s.start)) { errors.push(`${at}: needs start >= 0 and end > start`); return; }
    if (duration !== undefined && s.end > duration + 0.001) errors.push(`${at}: ends at ${s.end} s, after the audio (${r3(duration)} s)`);
    const len = s.end - s.start;
    if (len < MIN_SECONDS[s.kind] - 1e-6) errors.push(`${at}: ${r3(len)} s is too short (at least ${MIN_SECONDS[s.kind]} s)`);
    if (MAX_SECONDS[s.kind] && len > MAX_SECONDS[s.kind] + 1e-6) errors.push(`${at}: ${r3(len)} s is too long for a ${s.kind} (at most ${MAX_SECONDS[s.kind]} s; it is a one-line beat)`);
    if (["punchline", "quote", "topic"].includes(s.kind) && !(typeof s.text === "string" && s.text.trim())) errors.push(`${at}: needs text`);
    if (s.kind === "quote" && !s.speaker) errors.push(`${at}: a quote is attributed to a host, give speaker`);
    if (s.kind === "reaction" && !(typeof s.text === "string" && s.text.trim())) errors.push(`${at}: text names the marks (exclaim, question, laugh, stars, shock)`);
    if (s.kind === "lower-third" && !s.speaker) errors.push(`${at}: a lower third belongs to a host, give speaker`);
    if (s.speaker !== undefined && hostIds && !hostIds.includes(String(s.speaker))) errors.push(`${at}: speaker "${s.speaker}" is not one of the hosts (${hostIds.join(", ")})`);
    const f0 = Math.round(s.start * fps), n = Math.max(1, Math.round((s.end - s.start) * fps));
    scenes.push({ ...s, speaker: s.speaker === undefined ? undefined : String(s.speaker), f0, n, id: `${s.kind}-${i}` });
  });
  const centre = scenes.filter((s) => CENTER_KINDS.includes(s.kind)).sort((a, b) => a.f0 - b.f0);
  for (let i = 1; i < centre.length; i++) if (centre[i].f0 < centre[i - 1].f0 + centre[i - 1].n) errors.push(`${centre[i].id} overlaps ${centre[i - 1].id}: punchline, quote and topic share the middle of the frame`);
  return { errors, scenes };
}

// ---- text fitting (estimate; the real fit is checked by looking at rendered frames) --------------------------------
export function fitText(text, { boxW, boxH, maxPx, minPx, charW = 0.6, lineH = 1.08, maxLines = 4 }) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const wrap = (px) => {
    const lines = []; let cur = "";
    for (const w of words) {
      const next = cur ? cur + " " + w : w;
      if (cur && next.length * charW * px > boxW) { lines.push(cur); cur = w; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  for (let px = maxPx; px >= minPx; px -= 2) {
    const lines = wrap(px);
    const widest = Math.max(...lines.map((l) => l.length)) * charW * px;
    if (lines.length <= maxLines && lines.length * lineH * px <= boxH && widest <= boxW) return { px, lines: lines.length, fits: true };
  }
  return { px: minPx, lines: wrap(minPx).length, fits: false };
}

// ---- waveform bars: one function for the HTML block and for ffmpeg's raw frames ------------------------------------
/** Heights (0..1) of `n` bars at frame `f`. The middle shows now, the sides show the recent past: a ripple that moves outward. */
export function barHeights(levels, f, n) {
  const out = new Array(n);
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(i - mid) / mid;               // 0 in the middle .. 1 at the edges
    const lag = Math.round(d * 12);
    const v = levels[Math.max(0, Math.min(levels.length - 1, f - lag))] ?? 0;
    const wob = 0.86 + 0.14 * Math.sin(i * 1.7 + f * 0.31);
    out[i] = Math.max(0.04, Math.min(1, (0.05 + v * 0.95) * wob * (1 - 0.35 * d)));
  }
  return out;
}

// ---- brand variables ------------------------------------------------------------------------------------------------
/** Imports the captions part's frame-vars.mjs (installed: parts/captions/, catalog: scene/captions/files/). */
export async function loadFrameVars(extraDir) {
  const cands = [];
  if (extraDir) cands.push(join(extraDir, "captions", "frame-vars.mjs"));
  cands.push(join(HERE, "..", "captions", "frame-vars.mjs"), join(HERE, "..", "..", "captions", "files", "frame-vars.mjs"));
  const p = cands.find((c) => existsSync(c));
  if (!p) throw new Error(`cannot find frame-vars.mjs of the captions part (looked in: ${cands.join(", ")}). Install it (add captions) or pass --parts <dir>.`);
  return import(pathToFileURL(p).href);
}

/** CSS custom properties for one composition root: brand colours and fonts, plus the show's own. */
export function brandVars(frame, podcast) {
  const c = frame.colors, t = frame.type;
  const v = {
    "--c-ground": c.ground || "#0a0c0a", "--c-ink": c.ink || "#ffffff", "--c-accent": c.accent || "#39ff14",
    "--c-surface": c.surface || "#111411", "--c-muted": c.muted || "#a0aec0",
    "--c-alt": podcast.accent_alt || c.accent2 || c.red || c.accent || "#fc3c44",
    "--f-display": `"${t.display?.family || "Bricolage Grotesque"}", sans-serif`, "--w-display": t.display?.weight || 800, "--t-display": t.display?.tracking || "-0.02em",
    "--f-body": `"${t.body?.family || "Inter"}", sans-serif`, "--w-body": t.body?.weight || 600,
  };
  return Object.entries(v).map(([k, x]) => `${k}: ${x};`).join(" ");
}
