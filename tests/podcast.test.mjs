import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp, haveFfmpeg, ffmpeg } from './helpers.mjs';
import { parseFlow, podcastFromFrame, checkPodcast, normalizeTurns, validateScenes, fitText, barHeights, layout } from '../catalog/scene/podcast-scenes/files/podcast.mjs';
import { levelsFromPcm, computeLevels } from '../catalog/scene/podcast-scenes/files/levels.mjs';

const root = new URL('../', import.meta.url).pathname;
const part = (rel) => join(root, 'catalog', rel);
const env = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` };
const node = (script, args, opts = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env, ...opts });
const skip = { skip: !haveFfmpeg && 'ffmpeg not installed' };
const BUILD = part('scene/podcast-scenes/files/build-scene.mjs');
const ASSEMBLE = part('tool/assemble-long/files/assemble-long.mjs');

const FRAME = `---
colors:
  ground: "#0a0c0a"
  surface: "#111411"
  ink: "#ffffff"
  muted: "#a0aec0"
  accent: "#39ff14"
typography:
  display: { fontFamily: "Bricolage Grotesque", weight: 800, tracking: "-0.02em" }
  body:    { fontFamily: "Inter", weight: 600 }
format: { aspect: "16:9", min_text_px: 48 }
podcast: { look: "ink-sketch", accent_alt: "#fc3c44", lang: "tr",
  hosts: [ {id: "A", name: "Sunucu A", tag: "real G's"}, {id: "B", name: "Sunucu B", tag: ""} ] }
---
body text
`;
const dir = tmp('podcast-');
const frame = join(dir, 'frame.md');
writeFileSync(frame, FRAME);

test('podcast block: flow style over several lines, quotes with apostrophes, nested lists', () => {
  const p = podcastFromFrame(FRAME);
  assert.equal(p.look, 'ink-sketch');
  assert.equal(p.accent_alt, '#fc3c44');
  assert.deepEqual(p.hosts.map((h) => h.id), ['A', 'B']);
  assert.equal(p.hosts[0].tag, "real G's");
  assert.equal(podcastFromFrame('---\ncolors:\n  ink: "#fff"\n---\n'), null);
  assert.throws(() => podcastFromFrame('---\npodcast:\n  look: clean\n---\n'), /flow style/);
  assert.deepEqual(parseFlow('{a: 1, b: [x, "y z", true], c: {d: null}}'), { a: 1, b: ['x', 'y z', true], c: { d: null } });
  assert.throws(() => parseFlow('{a: [1, 2}'), /podcast block/);
});

test('podcast block is checked: look, host ids, colours', () => {
  const ok = checkPodcast({ hosts: [{ id: 'A', name: 'Ali' }] });
  assert.equal(ok.look, 'clean');
  assert.equal(checkPodcast({ look: 'ink-sketch', hosts: [{ id: 'A', name: 'Ali' }] }, { lookOverride: 'clean' }).look, 'clean');
  assert.throws(() => checkPodcast({ look: 'neon', hosts: [{ id: 'A', name: 'Ali' }] }), /look must be/);
  assert.throws(() => checkPodcast({ hosts: [] }), /one to three hosts/);
  assert.throws(() => checkPodcast({ hosts: [{ id: 'A', name: 'x' }, { id: 'A', name: 'y' }] }), /twice/);
  assert.throws(() => checkPodcast({ hosts: [{ id: 'A', name: 'x' }], accent_alt: 'red' }), /hex/);
});

test('turns: short blips dropped, near turns of one host merged, unknown speaker refused', () => {
  const r = normalizeTurns({ turns: [
    { start: 5, end: 9, speaker: 'B' }, { start: 0, end: 4, speaker: 'A' }, { start: 4.3, end: 4.6, speaker: 'B' },
    { start: 4.7, end: 8, speaker: 'A' }, { start: 20, end: 20.3, speaker: 'A' }] });
  assert.deepEqual(r.turns, [{ start: 0, end: 8, speaker: 'A' }, { start: 4.3, end: 9, speaker: 'B' }]);
  assert.equal(r.merged, 2); assert.equal(r.dropped, 1);
  assert.throws(() => normalizeTurns({ turns: [{ start: 0, end: 1, speaker: 'C' }] }, { hostIds: ['A', 'B'] }), /not one of the hosts/);
  assert.throws(() => normalizeTurns({ turns: [{ start: 2, end: 1, speaker: 'A' }] }), /end > start/);
  assert.throws(() => normalizeTurns({}), /expected/);
});

test('scenes.json: bad kinds, lengths, speakers, ends and overlaps in the middle of the frame are all named', () => {
  const good = validateScenes([
    { start: 1, end: 3, kind: 'punchline', text: 'Tamam' }, { start: 5, end: 9, kind: 'quote', text: 'x', speaker: 'A' },
    { start: 5, end: 7, kind: 'reaction', text: 'laugh', speaker: 'B' }], { duration: 60, hostIds: ['A', 'B'] });
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.scenes.map((s) => [s.f0, s.n]), [[30, 60], [150, 120], [150, 60]]);
  const bad = validateScenes([
    { start: 0, end: 1, kind: 'wobble', text: 'x' }, { start: 1, end: 6, kind: 'punchline', text: 'long' },
    { start: 2, end: 4, kind: 'quote', text: 'q', speaker: 'Z' }, { start: 3, end: 5, kind: 'topic', text: 't' },
    { start: 58, end: 62, kind: 'topic', text: 'late' }, { start: 10, end: 12, kind: 'quote', text: 'no host' },
    { start: 20, end: 20.4, kind: 'lower-third', speaker: 'A' }], { duration: 60, hostIds: ['A', 'B'] }).errors.join('\n');
  for (const re of [/kind must be one of/, /too long for a punchline/, /speaker "Z"/, /overlaps/, /after the audio/, /attributed to a host/, /too short/]) assert.match(bad, re);
  assert.ok(validateScenes({}, {}).errors.length);
});

test('fitText shrinks to fit and says when it cannot', () => {
  const big = fitText('Bir dakika dur', { boxW: 1400, boxH: 380, maxPx: 200, minPx: 48, charW: 0.64, lineH: 1.02, maxLines: 3 });
  assert.ok(big.fits && big.px >= 100, JSON.stringify(big));
  const long = fitText('a '.repeat(200), { boxW: 600, boxH: 200, maxPx: 100, minPx: 48 });
  assert.equal(long.fits, false); assert.equal(long.px, 48);
});

test('waveform bars: deterministic, in range, the middle follows now and the sides the recent past', () => {
  const lv = Array.from({ length: 100 }, (_, i) => (i === 50 ? 1 : 0));
  const a = barHeights(lv, 50, 40), b = barHeights(lv, 50, 40);
  assert.deepEqual(a, b);
  assert.ok(a.every((v) => v >= 0.04 && v <= 1));
  assert.ok(a[19] > a[0] * 2, 'the burst is in the middle now');
  const later = barHeights(lv, 62, 40);
  assert.ok(later[0] > a[0], 'a few frames later it has reached the edges');
  assert.equal(barHeights([], 3, 8).length, 8);
});

test('levels: silence is low, speech-level noise is high, release is slower than attack', () => {
  const rate = 8000, fps = 30, secs = 3, pcm = Buffer.alloc(rate * secs * 2);
  for (let i = 0; i < rate * 2; i++) pcm.writeInt16LE(i < rate ? 0 : Math.round(Math.sin(i * 0.3) * 12000), i * 2);
  const { levels } = levelsFromPcm(pcm, fps);
  assert.equal(levels.length, 90);
  assert.ok(levels[10] < 0.05, 'silence'); assert.ok(levels[45] > 0.8, 'loud');
  assert.ok(levels[61] > 0.1 && levels[61] < levels[59], 'release: the level falls over a few frames, not at once');
});

test('levels from a real file: one value per frame, same on every run', skip, () => {
  const f = join(dir, 'tone.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', f]);
  const a = computeLevels(f, 30), b = computeLevels(f, 30);
  assert.equal(a.frames, 60); assert.deepEqual(a.levels, b.levels);
  assert.ok(a.levels.slice(10).every((v) => v > 0.7));
  const cli = node(part('scene/podcast-scenes/files/levels.mjs'), [f, '--out', join(dir, 'l.json')]);
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(readFileSync(join(dir, 'l.json'), 'utf8')).frames, 60);
  assert.equal(node(part('scene/podcast-scenes/files/levels.mjs'), []).status, 64);
});

const scene = (kind, args, aspect = '16:9', extra = []) => {
  const out = join(dir, `${kind}-${aspect.replace(':', 'x')}-${Math.random().toString(36).slice(2, 6)}`, 'compositions', 'x.html');
  const r = node(BUILD, ['--kind', kind, '--aspect', aspect, '--duration', '3', '--frame', frame, '--out', out, '--id', 'x', ...args, ...extra]);
  return { r, html: existsSync(out) ? readFileSync(out, 'utf8') : '', out };
};
const CASES = { punchline: ['--text', 'Bir *dakika* dur yani'], quote: ['--text', 'Mahalle bir hafıza', '--speaker', 'A'], topic: ['--text', 'Mahallenin tarihi', '--detail', 'BÖLÜM 2'], reaction: ['--text', '!?,laugh', '--speaker', 'B'], 'lower-third': ['--speaker', 'A'] };

test('every block builds in both looks and both shapes; the look is a CSS class, the code is the same', () => {
  for (const [kind, args] of Object.entries(CASES)) {
    for (const aspect of ['16:9', '9:16']) {
      const ink = scene(kind, args, aspect), clean = scene(kind, args, aspect, ['--look', 'clean']);
      assert.equal(ink.r.status, 0, `${kind} ${aspect}: ${ink.r.stderr}`);
      assert.equal(clean.r.status, 0, `${kind} ${aspect} clean: ${clean.r.stderr}`);
      assert.match(ink.html, /id="root" class="look-ink-sketch" lang="tr"/);
      assert.match(clean.html, /id="root" class="look-clean" lang="tr"/);
      for (const html of [ink.html, clean.html]) {
        assert.match(html, /^<template>/); assert.match(html, /window\.__timelines\["x"\] = tl;/);
        assert.match(html, /#root\.look-ink-sketch \{/); assert.match(html, /#root\.look-clean \{/); // both looks live in the CSS
        assert.doesNotMatch(html, /https?:\/\//, 'nothing is fetched at render time');
        assert.doesNotMatch(html, /Math\.random|Date\.now/, 'deterministic');
        assert.match(html, /--c-accent: #39ff14/); assert.match(html, /--c-alt: #fc3c44/);
      }
      const strip = (h) => h.replace(/class="look-[\w-]+"/, '').replace(/\/\/ Generated by.*\n/, '');
      assert.equal(strip(ink.html), strip(clean.html), `${kind} ${aspect}: only the class differs`);
    }
  }
});

test('blocks follow the brief: highlight, attribution, marks, host defaults, 9:16 sizes', () => {
  const pl = scene('punchline', CASES.punchline).html;
  assert.match(pl, /class="pl-w hl" id="x-w1"/); assert.match(pl, /scale: 0\.15/); assert.match(pl, /keyframes: \{ x: \[0, -16/);
  assert.match(scene('punchline', ['--text', 'iki kelime']).html, /class="pl-w hl" id="x-w1"/, 'the last word when none is marked');
  const q = scene('quote', CASES.quote).html;
  assert.match(q, /<span>Sunucu A<\/span>/);
  assert.match(scene('quote', ['--text', 'x', '--speaker', 'B']).html, /<span>Sunucu B<\/span>/);
  const rc = scene('reaction', ['--text', '!?,laugh', '--speaker', 'B']).html;
  assert.equal((rc.match(/<svg class="rc-g"/g) || []).length, 3);
  assert.match(rc, /left: 1\d\d\d px?|left: 1\d\d\dpx/);
  const lt = scene('lower-third', ['--speaker', 'A']).html;
  assert.match(lt, /Sunucu A/); assert.match(lt, /real G&#39;s|real G's/);
  assert.match(lt, /left: 96px/); assert.match(scene('lower-third', ['--speaker', 'B']).html, /right: 96px/);
  const p9 = scene('punchline', CASES.punchline, '9:16').html;
  assert.match(p9, /data-width="1080" data-height="1920"/);
  // text floor from frame.md applies to the informational text
  for (const m of scene('lower-third', ['--speaker', 'A']).html.matchAll(/font-size: (\d+)px/g)) assert.ok(+m[1] >= 48, m[0]);
});

test('build-scene refuses what cannot work', () => {
  assert.equal(node(BUILD, []).status, 64);
  assert.equal(scene('wobble', []).r.status, 64);
  assert.equal(scene('punchline', ['--text', 'x', '--speaker', 'Z']).r.status, 64);
  assert.equal(scene('reaction', ['--text', 'banana', '--speaker', 'A']).r.status, 64);
  assert.match(scene('reaction', ['--text', 'banana']).r.stderr, /exclaim/);
  assert.equal(scene('punchline', ['--text', 'x'], '16:9', ['--duration', '0.5']).r.status, 64);
  assert.equal(scene('punchline', ['--text', 'x'], '4:3').r.status, 64);
  const noBlock = join(dir, 'f2.md'); writeFileSync(noBlock, '---\ncolors:\n  ink: "#fff"\n---\n');
  const r = node(BUILD, ['--kind', 'topic', '--text', 't', '--duration', '3', '--frame', noBlock, '--out', join(dir, 'n', 'compositions', 'n.html')]);
  assert.equal(r.status, 64); assert.match(r.stderr, /podcast:/);
});

test('stage: bg is one seamless loop, plates are a dim/lit sheet, the cover is baked next to the project', skip, () => {
  const cover = join(dir, 'cover.png');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=white:s=200x200', '-frames:v', '1', cover]);
  const bg = scene('stage', [], '16:9', ['--mode', 'bg', '--loop', '6', '--background', cover]);
  assert.equal(bg.r.status, 0, bg.r.stderr);
  assert.match(bg.r.stdout, /inverted/);
  assert.match(bg.html, /const LOOP = 6,/); assert.match(bg.html, /data-duration|window\.__timelines/);
  assert.match(bg.html, /1\.02 \+ 0\.02 \* Math\.sin/, 'zoom stays inside 1.00-1.04');
  assert.ok(existsSync(join(bg.out, '..', '..', 'assets', 'stage-art-ink-sketch.png')));
  const pl = scene('stage', [], '16:9', ['--mode', 'plates']);
  assert.equal((pl.html.match(/class="st-frame"/g) || []).length, 4, 'two hosts: dim and lit each');
  assert.match(pl.r.stdout, /0\.133 s/);
  const full = scene('stage', [], '9:16', ['--mode', 'full', '--duration', '10', '--turns', (() => { const f = join(dir, 't.json'); writeFileSync(f, JSON.stringify({ turns: [{ start: 1, end: 4, speaker: 'A' }, { start: 4.5, end: 8, speaker: 'B' }] })); return f; })()]);
  assert.equal(full.r.status, 0, full.r.stderr);
  assert.match(full.html, /className: "st-plate lit" \}, 1\)/); assert.match(full.html, /x-p1/);
  assert.equal(layout(true).plate.xs.length, 2);
});

test('assemble-long --audio refuses bad input before anything renders', () => {
  const sc = join(dir, 'scenes-bad.json'); writeFileSync(sc, JSON.stringify([{ start: 1, end: 2, kind: 'punchline' }]));
  assert.equal(node(ASSEMBLE, ['assemble', '--audio', join(dir, 'a.wav')]).status, 64);
  assert.equal(node(ASSEMBLE, ['assemble', '--audio', join(dir, 'missing.wav'), '--frame', frame, '--out', join(dir, 'o.mp4')]).status, 2);
  if (!haveFfmpeg) return;
  const wav = join(dir, 'a.wav'); ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=4', wav]);
  const r = node(ASSEMBLE, ['assemble', '--audio', wav, '--frame', frame, '--scenes', sc, '--out', join(dir, 'o.mp4')]);
  assert.equal(r.status, 64); assert.match(r.stderr, /needs text/);
  assert.equal(node(ASSEMBLE, ['assemble', '--audio', wav, '--video', wav, '--frame', frame, '--out', join(dir, 'o.mp4')]).status, 64);
  assert.equal(node(ASSEMBLE, ['assemble', '--audio', wav, '--frame', frame, '--out', join(dir, 'o.mp4'), '--captions', 'pop']).status, 64, 'captions need words');
  assert.equal(node(ASSEMBLE, ['assemble', '--audio', wav, '--frame', frame, '--out', join(dir, 'o.mp4'), '--loop', '0.5']).status, 64);
  const tr = join(dir, 'turns-bad.json'); writeFileSync(tr, JSON.stringify({ turns: [{ start: 0, end: 1, speaker: 'Q' }] }));
  const rt = node(ASSEMBLE, ['assemble', '--audio', wav, '--frame', frame, '--turns', tr, '--out', join(dir, 'o.mp4')]);
  assert.equal(rt.status, 64); assert.match(rt.stderr, /not one of the hosts/);
});

// End to end needs the studio's hyperframes binary and network for the fonts and GSAP; run it with HYPERFRAMES_BIN=<path>.
test('assemble-long --audio end to end: frames, loudness, loop seam and chunk joints are measured', { skip: !process.env.HYPERFRAMES_BIN && 'set HYPERFRAMES_BIN to run the render test' }, () => {
  const wav = join(dir, 'e2e.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=9', '-af', 'tremolo=f=2:d=0.8', wav]);
  const sc = join(dir, 'e2e-scenes.json'), tr = join(dir, 'e2e-turns.json');
  writeFileSync(sc, JSON.stringify([{ start: 1, end: 3.5, kind: 'punchline', text: 'Tamam *bu* kadar' }, { start: 4, end: 6.5, kind: 'reaction', text: 'laugh', speaker: 'B' }, { start: 6, end: 8.5, kind: 'quote', text: 'Bir söz', speaker: 'A' }]));
  writeFileSync(tr, JSON.stringify({ speakers: ['A', 'B'], turns: [{ start: 0, end: 4, speaker: 'A' }, { start: 4.5, end: 9, speaker: 'B' }] }));
  const out = join(dir, 'e2e', 'out.mp4');
  const r = node(ASSEMBLE, ['assemble', '--audio', wav, '--scenes', sc, '--turns', tr, '--frame', frame, '--out', out, '--loop', '2', '--chunk', '4', '--captions', 'none', '--hf', process.env.HYPERFRAMES_BIN]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const rep = JSON.parse(readFileSync(out + '.assemble.json', 'utf8'));
  assert.deepEqual(rep.problems, []);
  assert.equal(rep.video.frames_out, 270); assert.equal(rep.video.frames_expected, 270);
  assert.equal(rep.stage.chunks, 3);
  assert.ok(Math.abs(rep.audio.after.lufs + 16) <= 1 && rep.audio.after.true_peak <= -1);
  assert.equal(rep.scenes.length, 3);
});
