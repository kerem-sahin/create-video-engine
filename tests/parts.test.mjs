import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, haveFfmpeg, makeClip, ffmpeg } from './helpers.mjs';

const root = new URL('../', import.meta.url).pathname;
const part = (rel) => join(root, 'catalog', rel);
const env = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` };
const node = (script, args, opts = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env, ...opts });
const skip = { skip: !haveFfmpeg && 'ffmpeg not installed' };

test('frame-vars runs when its path has spaces and non-ASCII characters', () => {
  const d = join(tmp(), 'bir klasör ü');
  mkdirSync(d, { recursive: true });
  const script = join(d, 'frame-vars.mjs');
  writeFileSync(script, readFileSync(part('scene/captions/files/frame-vars.mjs')));
  const frame = join(d, 'frame.md');
  writeFileSync(frame, '---\ncolors:\n  ink: "#ffffff"\n  ground: "#000000"\n---\n');
  const r = node(script, [frame]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /:root/);
});

const words = (list) => { const f = join(tmp(), 'w.json'); writeFileSync(f, JSON.stringify({ words: list })); return f; };

test('captions accept w, word or text and skip entries without text', () => {
  const out = join(tmp(), 'c.html');
  const f = words([{ word: 'alpha', start: 0.2, end: 0.5 }, { text: 'beta', start: 0.5, end: 0.8 }, { start: 0.8, end: 0.9 }, { w: 'gamma', start: 0.9, end: 1.2 }]);
  const r = node(part('scene/captions/files/build-captions.mjs'), ['--words', f, '--style', 'clean', '--aspect', '16:9', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(out, 'utf8');
  assert.ok(!html.includes('undefined'));
  for (const w of ['alpha', 'beta', 'gamma']) assert.ok(html.includes(w));
});

const capsBuild = (list, args) => {
  const out = join(tmp(), 'c.html');
  const r = node(part('scene/captions/files/build-captions.mjs'), ['--words', words(list), '--aspect', '16:9', '--out', out, ...args]);
  assert.equal(r.status, 0, r.stderr);
  return readFileSync(out, 'utf8');
};
const three = [{ w: 'size', start: 0.2, end: 0.5 }, { w: 'videoları', start: 0.5, end: 0.8 }, { w: 'nasıl', start: 0.8, end: 1.1 }];

test('pop captions: word gap is an explicit margin, not whitespace; scale never outgrows the gap', () => {
  const html = capsBuild(three, ['--style', 'pop']);
  assert.match(html, /<\/span><wbr><span class="cap-w"/);
  assert.doesNotMatch(html, /<\/span> <span class="cap-w"/);
  assert.match(html, /\.cap-w \{[^}]*display: inline-block; margin-right: 0\.\d+em/);
  assert.match(html, /\.cap-w:last-child \{ margin-right: 0/);
  const grow = (n) => +html.match(new RegExp(`#captions-g0-w${n}", \\{ color: "var\\(--c-ink, #fff\\)", scale: 1 \\}, \\{ color: "var\\(--c-accent, #ffd84d\\)", scale: ([\\d.]+)`))[1];
  assert.ok(grow(0) <= 1.12 && grow(1) < grow(0) && grow(1) > 1, 'longer word grows less');
  assert.ok((grow(1) - 1) * 'videoları'.length * 0.7 / 2 <= 0.13);
});

test('captions chips are at least 90 % opaque with line gaps; clean has an optional accent', () => {
  for (const style of ['clean', 'pop']) {
    const html = capsBuild(three, ['--style', style]);
    assert.ok(+html.match(/var\(--c-ground, #000\) (\d+)%, transparent\); (?:padding|border)/)[1] >= 90, style);
    assert.ok(+html.match(/line-height: ([\d.]+)/)[1] >= 1.3, style);
  }
  assert.equal(+capsBuild(three, ['--style', 'pop', '--chip-opacity', '0.95']).match(/var\(--c-ground, #000\) (\d+)%, transparent\); padding/)[1], 95);
  assert.doesNotMatch(capsBuild(three, ['--style', 'clean']), /--c-accent/);
  assert.match(capsBuild(three, ['--style', 'clean', '--accent']), /#captions-g0-w1", \{ color: "var\(--c-ink, #fff\)" \}, \{ color: "var\(--c-accent/);
});

test('silence-cut plan does not cut fillers for a language without a list', skip, () => {
  const d = tmp();
  const video = join(d, 'v.mp4'); makeClip(video, { duration: 4 });
  const wf = join(d, 'w.json');
  writeFileSync(wf, JSON.stringify({ language: 'de', words: [{ w: 'Das', start: 0.2, end: 0.5 }, { w: 'er', start: 0.5, end: 0.8 }, { w: 'geht', start: 0.8, end: 1.2 }] }));
  const r = node(part('tool/silence-cut/files/silence-cut.mjs'), ['plan', '--video', video, '--words', wf, '--out', join(d, 'edl.json'), '--no-silence-check']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /no filler list for language "de"/);
  assert.ok(!/"w": "er"[^}]*filler/.test(readFileSync(join(d, 'edl.json'), 'utf8')));
  const edl = JSON.parse(readFileSync(join(d, 'edl.json'), 'utf8'));
  assert.ok(!JSON.stringify(edl.cuts ?? edl).includes('filler'));
});

const SC = part('tool/silence-cut/files/silence-cut.mjs');
const gapClip = (d) => {
  const video = join(d, 'gap.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,1,3),0,0.5*sin(2*PI*440*t))':d=4:s=48000", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  const wf = join(d, 'w.json');
  writeFileSync(wf, JSON.stringify({ language: 'tr', words: [{ w: 'bir', start: 0.2, end: 0.9 }, { w: 'iki', start: 3.1, end: 3.8 }] }));
  return { video, wf };
};
const edlGap = (edl) => edl.cuts.filter((c) => c.kind === 'pause').reduce((s, c) => s + (c.end - c.start), 0);

test('silence-cut keeps a shortened pause (tight 0.25 s, normal 0.4 s, --keep-pause) instead of removing it', skip, () => {
  const d = tmp(); const { video, wf } = gapClip(d);
  const plan = (...x) => { const o = join(d, `e${x.join('')}.json`); const r = node(SC, ['plan', '--video', video, '--words', wf, '--out', o, ...x]); assert.equal(r.status, 0, r.stderr); return JSON.parse(readFileSync(o, 'utf8')); };
  const tight = plan();
  assert.ok(Math.abs((2 - edlGap(tight)) - 0.25) < 0.08, `tight kept ${2 - edlGap(tight)}`);
  assert.equal(tight.params.mode, 'tight');
  const normal = plan('--mode', 'normal');
  assert.ok(Math.abs((2 - edlGap(normal)) - 0.4) < 0.08, `normal kept ${2 - edlGap(normal)}`);
  const custom = plan('--keep-pause', '0.6');
  assert.ok(Math.abs((2 - edlGap(custom)) - 0.6) < 0.08, `custom kept ${2 - edlGap(custom)}`);
  assert.notEqual(node(SC, ['plan', '--video', video, '--words', wf, '--out', join(d, 'x.json'), '--mode', 'bogus']).status, 0);
});

test('silence-cut apply warns about words edited after plan, uses --words, and prints words-out', skip, () => {
  const d = tmp(); const { video, wf } = gapClip(d);
  const edl = join(d, 'edl.json');
  assert.equal(node(SC, ['plan', '--video', video, '--words', wf, '--out', edl]).status, 0);
  const plain = node(SC, ['apply', '--edl', edl, '--out', join(d, 'cut.mp4')]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stderr, /embedded in the EDL; edits made to the words file after plan are ignored/);
  assert.match(plain.stdout, /words-out: .*cut\.words\.json/);
  writeFileSync(wf, JSON.stringify({ language: 'tr', words: [{ w: 'BİR', start: 0.2, end: 0.9, unsure: true }, { w: 'iki', start: 3.1, end: 3.8 }] }));
  const wo = join(d, 'fixed.json');
  const r = node(SC, ['apply', '--edl', edl, '--out', join(d, 'cut2.mp4'), '--words', wf, '--words-out', wo]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /differs from the words embedded/);
  assert.match(r.stdout, new RegExp(`words-out: ${wo}`));
  const out = JSON.parse(readFileSync(wo, 'utf8')).words;
  assert.equal(out[0].w, 'BİR'); assert.equal(out[0].unsure, true);
});

const SH = part('recipe/shorts-from-long/files/shorts.mjs');
const sentenceWords = (sents) => { let t = 0.3; const out = []; for (const sent of sents) { for (const w of sent.split(' ')) { out.push({ w, start: +t.toFixed(2), end: +(t + 0.4).toFixed(2) }); t += 0.45; } t += 0.3; } return out; };

test('shorts pick offers several non-overlapping candidates, with a clear hook yes/no', () => {
  const sents = ['Neden herkes bunu yanlış yapıyor?', 'Çünkü kimse size gerçeği söylemiyor.', 'İlk adımda ayarları açın ve bakın.', 'Sonra ikinci adımda dosyayı seçin.', 'Bu çok önemli bir nokta dostlar.', 'Üçüncü adım ise kaydetmek ve kapatmak.', 'Hepsi bu kadar basit aslında.', 'Peki şimdi sırada ne var?', 'Şimdi bunları birlikte deneyelim bakalım.', 'Sonuç gerçekten çok güzel görünüyor.'];
  const d = tmp(); const wf = join(d, 'w.json'); writeFileSync(wf, JSON.stringify({ language: 'tr', words: sentenceWords(sents) }));
  const r = node(SH, ['pick', '--words', wf, '--out', join(d, 's.json'), '--min', '8', '--max', '25', '--count', '3']);
  assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(readFileSync(join(d, 's.json'), 'utf8')).candidates;
  assert.ok(c.length >= 2, `got ${c.length}`);
  for (let i = 1; i < c.length; i++) assert.ok(c[i].start >= c[i - 1].end);
  for (const x of c) { assert.ok(x.duration >= 8 - 0.6 && x.duration <= 25 + 0.6); assert.equal(typeof x.hook, 'boolean'); }
  const md = readFileSync(join(d, 's.md'), 'utf8');
  assert.doesNotMatch(md, /hook in first 2 s: NO/);
  assert.doesNotMatch(md, /hook in first 2 s: no \(short opening sentence\)/);
  for (const line of md.split('\n').filter((l) => l.startsWith('- hook in first 2 s'))) assert.match(line, /: (yes \(.+\)|no \((no hook signal|only a weak signal: .+)\))$/);
});

test('shorts cut --start/--end override a candidate without editing the JSON', skip, () => {
  const d = tmp(); const video = join(d, 'v.mp4'); makeClip(video, { duration: 6 });
  const wf = join(d, 'w.json'); writeFileSync(wf, JSON.stringify({ language: 'tr', words: sentenceWords(['Bir iki üç dört beş altı yedi sekiz.']) }));
  const sj = join(d, 's.json'); writeFileSync(sj, JSON.stringify({ candidates: [{ id: 1, cut_start: 0, cut_end: 5 }] }));
  const r = node(SH, ['cut', '--video', video, '--words', wf, '--from', sj, '--id', '1', '--start', '1', '--end', '3', '--out', join(d, 'o.mp4')]);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(join(d, 'o.words.json'), 'utf8'));
  assert.deepEqual(j.from, { start: 1, end: 3 });
  assert.equal(j.duration, 2);
});

test('shorts cut works on a video with no audio track', skip, () => {
  const d = tmp();
  const video = join(d, 'v.mp4'); makeClip(video, { audio: false, duration: 5 });
  const wf = words([{ w: 'hi', start: 0.2, end: 0.6 }]);
  const out = join(d, 's.mp4');
  const r = node(part('recipe/shorts-from-long/files/shorts.mjs'), ['cut', '--video', video, '--words', wf, '--start', '0', '--end', '3', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(out));
});

test('transcribe removes its temp dir when it dies, and a failing run exits 2', skip, () => {
  const d = tmp();
  const video = join(d, 'v.mp4'); makeClip(video, { duration: 2 });
  const hf = join(d, 'fake-hf.mjs');
  writeFileSync(hf, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: false, error: { message: "boom" } }));\nprocess.exit(1);\n');
  chmodSync(hf, 0o755);
  const t = join(d, 'tmpdir'); mkdirSync(t);
  const r = node(part('tool/transcribe-local/files/transcribe.mjs'), [video, '--language', 'tr', '--out', join(d, 'o.json'), '--hf', hf], { env: { ...env, TMPDIR: t } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /boom/);
  assert.deepEqual(readdirSync(t), []);
});

test('transcribe passes --model through and marks unsure words (probability and heuristics) in the output and the list', skip, () => {
  const d = tmp();
  const video = join(d, 'v.mp4'); makeClip(video, { duration: 6 });
  const hf = join(d, 'fake-hf.mjs');
  const raw = [{ text: 'Merhaba', start: 0.1, end: 0.6 }, { text: 'bugün', start: 0.7, end: 1.1, p: 0.2 }, { text: 'Kerem', start: 1.2, end: 1.6 }, { text: 'ile', start: 1.7, end: 1.9 }, { text: 'xk9z', start: 2.0, end: 2.5 }, { text: 'tamam.', start: 2.6, end: 3.0 }];
  writeFileSync(hf, `#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
const a = process.argv.slice(2);
mkdirSync(a[a.indexOf('--dir') + 1], { recursive: true });
const p = a[a.indexOf('--dir') + 1] + '/transcript.json';
writeFileSync(p, ${JSON.stringify(JSON.stringify(raw))});
writeFileSync(a[a.indexOf('--dir') + 1] + '/args.txt', a.join(' '));
console.log(JSON.stringify({ ok: true, transcriptPath: p }));
`);
  chmodSync(hf, 0o755);
  const out = join(d, 'o.json');
  const r = node(part('tool/transcribe-local/files/transcribe.mjs'), [video, '--language', 'tr', '--model', 'medium', '--no-align', '--out', out, '--hf', hf]);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(j.engine, 'whisper:medium');
  assert.deepEqual(j.words.filter((w) => w.unsure).map((w) => w.w), ['bugün', 'Kerem', 'xk9z']);
  assert.match(r.stdout, /unsure: 3 word\(s\)/);
  assert.match(r.stdout, /"bugün"\s+\(low confidence 0\.20\)/);
  assert.match(r.stdout, /"Kerem"\s+\(capitalised mid-sentence/);
});

const CARD = part('scene/overlay-cards/files/build-card.mjs');
const card = (args, cwd) => { const out = join(tmp(), 'c.html'); const r = node(CARD, ['--text', 'Ayşe Demir', '--detail', 'Eğitmen', '--duration', '4', '--out', out, ...args], cwd ? { cwd } : {}); assert.equal(r.status, 0, r.stderr); return { html: readFileSync(out, 'utf8'), stdout: r.stdout }; };
const sizes = (html) => [...html.matchAll(/font-size: (\d+(?:\.\d+)?)px/g)].map((m) => +m[1]);

test('overlay cards: no blur glass by default, text floor from frame.md, signature underline, side away from the face', () => {
  for (const kind of ['lower-third', 'takeaway', 'stat', 'quote', 'keyword']) {
    for (const aspect of ['16:9', '9:16']) {
      const { html } = card(['--kind', kind, '--aspect', aspect]);
      assert.doesNotMatch(html, /backdrop-filter/, `${kind} ${aspect}`);
      const min = aspect === '16:9' ? 48 : 40;
      assert.ok(sizes(html).every((n) => n >= min), `${kind} ${aspect} sizes ${sizes(html)}`);
    }
  }
  assert.match(card(['--kind', 'takeaway', '--aspect', '16:9', '--glass']).html, /backdrop-filter: blur/);
  // frame.md raises the floor
  const d = tmp(); const frame = join(d, 'frame.md');
  writeFileSync(frame, '---\ncolors:\n  ink: "#fff"\nformat: { aspect: "16:9", min_text_px: 60 }\n---\n');
  const f = card(['--kind', 'lower-third', '--aspect', '16:9', '--frame', frame]);
  assert.ok(sizes(f.html).every((n) => n >= 60), String(sizes(f.html)));
  assert.match(f.stdout, /text floor 60px/);
  // signature: underline instead of the vertical stripe
  const sig = card(['--kind', 'lower-third', '--aspect', '16:9', '--signature']).html;
  assert.match(sig, /id="card-lower-third-sig"/); assert.doesNotMatch(sig, /id="card-lower-third-stripe"/);
  assert.match(card(['--kind', 'lower-third', '--aspect', '16:9']).html, /id="card-lower-third-stripe"/);
  // side: away from the face; bottom-left with a note when unknown
  assert.match(card(['--kind', 'lower-third', '--aspect', '16:9', '--face-x', '0.3']).html, /position: absolute; right: 192px;/);
  assert.match(card(['--kind', 'lower-third', '--aspect', '16:9', '--face-x', '0.7']).html, /position: absolute; left: 192px;/);
  const unknown = card(['--kind', 'lower-third', '--aspect', '16:9']);
  assert.match(unknown.html, /position: absolute; left: 192px;/); assert.match(unknown.stdout, /no --face-x given: card placed bottom-left/);
});
