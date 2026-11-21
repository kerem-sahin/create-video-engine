#!/usr/bin/env node
// shorts-from-long: pick 15-45 s highlight segments from a word-timed transcript, then cut and reframe one to 9:16.
// Own code, zero dependencies (Node >= 22, ffmpeg, ffprobe). The picker only PROPOSES: the agent reads shorts.md,
// may adjust, and the person chooses. No face detection: reframe is a centre crop, or a crop centred on --face-x.
//
//   node shorts.mjs pick --words cut.words.json --out shorts.json [--min 15] [--max 45] [--count 5] [--keywords a,b] [--lang tr|en]
//   node shorts.mjs cut  --video cut.mp4 --words cut.words.json (--from shorts.json --id 1 | --start 12.3 --end 41.2)
//                        --out short-1.mp4 [--mode crop|fit] [--face-x 0.5] [--size 1080x1920]
//                        with --from, --start and/or --end override that candidate's times (no hand-editing of the JSON)
//
// Pick rules (each is checked, flagged in the output, and explained in shorts.md):
//   1. whole sentences only: a segment starts at a sentence start and ends at a sentence end;
//   2. a hook in the first 2 s: the opening sentence is a question, contains a number, uses a hook word, or is short
//      and punchy (<= 9 words); a segment that opens with "and/but/because..." is penalised (starts mid-thought);
//   3. up to --count candidates that do not overlap, anywhere in the --min..--max range: the set with the best total score
//      is chosen (more candidates beat one long one; at equal score the shorter wins);
//   4. length 15-45 s, pace 2-3.6 words/s preferred, few filler words, optional keyword hits.
// cut: --mode crop (default) fills 9:16 from a centre crop (x centre at --face-x of the width, 0..1); --mode fit keeps the
// whole picture over a blurred copy. Writes <out>.words.json: the words of the segment with times starting at 0, for captions.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const die = (m, c = 2) => { console.error("shorts-from-long: " + m); process.exit(c); };
const [cmd, ...rest] = process.argv.slice(2);
const a = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith("--")) { const n = rest[i + 1]; if (n === undefined || n.startsWith("--")) a[rest[i].slice(2)] = true; else { a[rest[i].slice(2)] = n; i++; } }
const run = (c, args) => { const r = spawnSync(c, args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); if (r.error) die(`cannot run ${c}: ${r.error.message}`); return r; };
const norm = (w) => String(w).toLocaleLowerCase("tr").replace(/[\p{P}\p{S}\s]+/gu, "");
function readWords(f) {
  const j = JSON.parse(readFileSync(resolve(f), "utf8"));
  return { words: (j.words || j).map((x) => ({ w: x.w ?? x.text, start: +x.start, end: +x.end })), language: j.language ?? null, engine: j.engine ?? null };
}

const SENT_END = /[.!?…]["”')]*$/u;
const CONT = new Set(["ve", "ama", "fakat", "ancak", "çünkü", "yani", "ki", "ayrıca", "dolayısıyla", "sonra", "ardından", "and", "but", "because", "so", "also", "then", "or", "which"]);
const HOOK_TR = ["neden", "nasıl", "hiç", "asla", "sır", "hata", "yanlış", "en büyük", "bilmediğiniz", "şaşıracaksınız", "dikkat", "durun", "kimse", "herkes", "gerçek", "tek bir", "sadece"];
const HOOK_EN = ["why", "how", "never", "stop", "mistake", "secret", "nobody", "everyone", "truth", "wrong", "biggest", "only", "don't", "dont"];
const FILL = /^(ı+h*|e{2,}h*|ee+m*|hm+|mm+|öö+|aa+h*|u+m+|u+h+|er)$/u;

function sentences(words) {
  const withP = words.filter((w) => SENT_END.test(w.w)).length;
  const out = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const next = words[i + 1];
    const end = withP >= 3 ? SENT_END.test(words[i].w) : !!next && next.start - words[i].end >= 0.35; // no punctuation: split at pauses
    if (end || !next) out.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end, closed: end || (withP < 3) });
    if (end) cur = [];
  }
  return out.filter((s) => s.words.length);
}

function pick() {
  if (!a.words || !a.out) die("usage: pick --words <words.json> --out <shorts.json>", 64);
  const { words, language } = readWords(a.words);
  words.sort((x, y) => x.start - y.start);
  const lang = (a.lang || language || "").slice(0, 2);
  const minD = +(a.min ?? 15), maxD = +(a.max ?? 45), count = +(a.count ?? 5);
  const kws = typeof a.keywords === "string" ? a.keywords.split(",").map((k) => norm(k)).filter(Boolean) : [];
  const S = sentences(words);
  const hookWords = lang === "en" ? HOOK_EN : lang === "tr" ? HOOK_TR : [...HOOK_TR, ...HOOK_EN];
  const cands = [];
  for (let i = 0; i < S.length; i++) {
    for (let j = i; j < S.length; j++) {
      const ws = S.slice(i, j + 1).flatMap((s) => s.words);
      const dur = S[j].end - S[i].start;
      if (dur > maxD) break;
      if (dur < minD) continue;
      if (!S[j].closed) continue; // must end on a finished sentence
      const first = S[i];
      const opening = first.words.filter((w) => w.start < first.start + 2.0).map((w) => w.w).join(" ");
      const firstText = first.words.map((w) => w.w).join(" ");
      const reasons = [];
      let hook = 0;
      if (/\?/.test(firstText)) { hook += 2; reasons.push("opens with a question"); }
      if (/\d/.test(firstText)) { hook += 1; reasons.push("a number in the first sentence"); }
      if (hookWords.some((h) => norm(opening).includes(norm(h)))) { hook += 2; reasons.push("hook word in the first 2 s"); }
      if (first.words.length <= 9) { hook += 1; reasons.push("short opening sentence"); }
      // a hook needs a question or a hook word, or two weaker signals; one weak signal alone is only noted
      const flags = [];
      if (CONT.has(norm(first.words[0].w))) { hook -= 3; flags.push("starts mid-thought (\"" + first.words[0].w + "\")"); }
      const fillers = ws.filter((w) => FILL.test(norm(w.w))).length;
      const wps = ws.length / dur;
      let score = hook + (dur >= 20 && dur <= 35 ? 1 : 0) - fillers * 0.5;
      if (wps < 1.8 || wps > 3.8) { score -= 1; flags.push(`pace ${r2(wps)} words/s`); }
      const hits = kws.length ? kws.filter((k) => ws.some((w) => norm(w.w).includes(k))).length : 0;
      score += Math.min(3, hits);
      cands.push({
        start: first.start, end: S[j].end, sentences: j - i + 1, hook_ok: hook >= 2 && !flags.some((f) => f.startsWith("starts")),
        hook: hook >= 2 && !flags.some((f) => f.startsWith("starts")), hook_reasons: reasons, flags, fillers, keywords: hits, score: r2(score), opening, text: ws.map((w) => w.w).join(" "),
      });
    }
  }
  // up to `count` non-overlapping candidates with the best total weight (weighted interval scheduling, k <= count).
  // weight = score + 4 (+1 with a hook) - tiny length term, so more candidates win over one long one and the shorter wins a tie.
  const wt = (c) => c.score + 4 + (c.hook_ok ? 1 : 0) - 0.001 * (c.end - c.start);
  const byEnd = cands.filter((c) => wt(c) > 0).sort((x, y) => x.end - y.end || x.start - y.start);
  const n = byEnd.length;
  const prevIdx = byEnd.map((c) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (byEnd[m].end <= c.start + 1e-9) lo = m + 1; else hi = m; } return lo; });   // how many end before c starts
  const K = Math.max(0, Math.floor(count));
  const dp = Array.from({ length: K + 1 }, () => new Float64Array(n + 1));
  const take = Array.from({ length: K + 1 }, () => new Uint8Array(n + 1));
  for (let k = 1; k <= K; k++) for (let i = 1; i <= n; i++) {
    const skip = dp[k][i - 1], use = wt(byEnd[i - 1]) + dp[k - 1][prevIdx[i - 1]];
    if (use > skip + 1e-12) { dp[k][i] = use; take[k][i] = 1; } else dp[k][i] = skip;
  }
  const chosen = [];
  for (let k = K, i = n; k > 0 && i > 0;) { if (take[k][i]) { chosen.push(byEnd[i - 1]); i = prevIdx[i - 1]; k--; } else i--; }
  chosen.sort((x, y) => x.start - y.start);
  // padding: a breath before the first word and after the last, never into a neighbour word
  const all = words;
  chosen.forEach((c, k) => {
    const prev = [...all].reverse().find((w) => w.end <= c.start + 0.001 && w.start < c.start);
    const next = all.find((w) => w.start >= c.end - 0.001 && w.end > c.end);
    c.cut_start = r3(Math.max(0, prev ? Math.max(c.start - 0.15, (prev.end + c.start) / 2) : c.start - 0.15));
    c.cut_end = r3(next ? Math.min(c.end + 0.35, (c.end + next.start) / 2) : c.end + 0.35);
    c.id = k + 1;
    c.duration = r2(c.cut_end - c.cut_start);
    c.start = r3(c.start); c.end = r3(c.end);
  });
  const res = { schema: 1, source_words: resolve(a.words), params: { min: minD, max: maxD, count, keywords: kws }, candidates: chosen };
  writeFileSync(resolve(a.out), JSON.stringify(res, null, 2) + "\n");
  const md = resolve(a.out).replace(/\.json$/, "") + ".md";
  writeFileSync(md, `# Short candidates\n\nThe picker proposes; read the text, adjust the times if a sentence should start or end elsewhere, then cut with \`cut --from <this json> --id N\`.\n\n` + chosen.map((c) => `## ${c.id}. ${c.cut_start}s - ${c.cut_end}s (${c.duration}s), score ${c.score}\n- hook in first 2 s: ${c.hook_ok ? "yes (" + c.hook_reasons.join(", ") + ")" : "no" + (c.hook_reasons.length ? ` (only a weak signal: ${c.hook_reasons.join(", ")})` : " (no hook signal)")}${c.flags.length ? "\n- flags: " + c.flags.join("; ") : ""}\n- opening: ${c.opening}\n- text: ${c.text}\n`).join("\n"));
  console.log(`shorts: ${chosen.length} candidate(s) of ${cands.length} windows -> ${resolve(a.out)}\n  review: ${md}`);
  if (!chosen.length) { console.error("shorts-from-long: no window of 15-45 s made of whole sentences; check the transcript has sentence punctuation or lower --min"); process.exit(1); }
  if (!chosen.some((c) => c.hook_ok)) console.log("  note: none of them has a clear hook in the first 2 s; consider whether the source has a short at all");
}

function cut() {
  if (!a.video || !a.words || !a.out) die("usage: cut --video <file> --words <words.json> (--from shorts.json --id N | --start s --end s) --out <short.mp4>", 64);
  let start = a.start !== undefined ? +a.start : NaN, end = a.end !== undefined ? +a.end : NaN;
  if (a.from) {
    const j = JSON.parse(readFileSync(resolve(a.from), "utf8"));
    const c = j.candidates.find((x) => String(x.id) === String(a.id));
    if (!c) die(`no candidate ${a.id} in ${a.from}`, 1);
    start = a.start !== undefined ? +a.start : c.cut_start; end = a.end !== undefined ? +a.end : c.cut_end;
  }
  if (!(end > start) || start < 0) die("need --from + --id, or --start and --end (end after start, start not negative)", 64);
  const video = resolve(a.video);
  if (!existsSync(video)) die("no such video: " + video);
  const pr = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "json", video]);
  const st = JSON.parse(pr.stdout).streams?.[0];
  if (!st) die("no video stream in " + video);
  const [tw, th] = String(a.size || "1080x1920").split("x").map(Number);
  const iw = st.width, ih = st.height;
  const [fn, fd] = st.r_frame_rate.split("/").map(Number);
  const fps = fd ? fn / fd : 30;
  const faceX = Math.min(1, Math.max(0, +(a["face-x"] ?? 0.5)));
  const mode = a.mode || "crop";
  const dur = end - start;
  let vf;
  if (mode === "fit") {
    vf = `[0:v]split[a][b];[a]scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},boxblur=30:3[bg];[b]scale=${tw}:-2:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`;
  } else {
    // crop window of the target aspect, as large as the source allows, centred on face-x of the width
    let cw = Math.min(iw, Math.round((ih * tw) / th)), ch = Math.round((cw * th) / tw);
    if (ch > ih) { ch = ih; cw = Math.round((ch * tw) / th); }
    cw -= cw % 2; ch -= ch % 2;
    const x = Math.max(0, Math.min(iw - cw, Math.round(faceX * iw - cw / 2)));
    const y = Math.max(0, Math.round((ih - ch) / 2));
    vf = `[0:v]crop=${cw}:${ch}:${x}:${y},scale=${tw}:${th}:flags=lanczos,setsar=1[v]`;
  }
  const ap = run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", video]);
  const hasAudio = ap.stdout.trim() !== "";
  const args = ["-hide_banner", "-nostats", "-loglevel", "error", "-y", "-ss", String(start), "-i", video, "-t", String(r3(dur)),
    "-filter_complex", vf + (hasAudio ? `;[0:a]afade=t=in:d=0.04,afade=t=out:st=${Math.max(0, r3(dur - 0.2))}:d=0.2[a]` : ""), "-map", "[v]", ...(hasAudio ? ["-map", "[a]"] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-r", String(r3(fps)), "-g", String(Math.round(fps)),
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : ["-an"]), "-movflags", "+faststart", resolve(a.out)];
  const r = run("ffmpeg", args);
  if (r.status !== 0) die("ffmpeg failed:\n" + r.stderr.slice(-1200));
  const { words, language, engine } = readWords(a.words);
  const seg = words.filter((w) => (w.start + w.end) / 2 >= start && (w.start + w.end) / 2 <= end)
    .map((w) => ({ w: w.w, start: r3(Math.max(0, w.start - start)), end: r3(Math.min(dur, w.end - start)) }));
  const wp = resolve(String(a.out).replace(/\.[^.]+$/, "") + ".words.json");
  writeFileSync(wp, JSON.stringify({ schema: 1, language, engine, duration: r3(dur), words: seg, from: { start, end } }, null, 2) + "\n");
  console.log(`short: ${r2(dur)} s, ${tw}x${th} (${mode}${mode === "crop" ? ", face-x " + faceX : ""}) -> ${resolve(a.out)}\n  words: ${seg.length} -> ${wp}`);
}

if (cmd === "pick") pick();
else if (cmd === "cut") cut();
else { console.error("usage: shorts.mjs pick|cut ... (see the header of this file)"); process.exit(64); }
