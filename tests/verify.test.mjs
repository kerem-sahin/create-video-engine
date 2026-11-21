import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runVerify } from '../src/verify/index.mjs';
import { probeMedia, makeContactSheet } from '../src/verify/util.mjs';
import { ffmpeg, haveFfmpeg, makeClip, makeProject, tmp, verifyJson } from './helpers.mjs';

const opts = { skip: !haveFfmpeg && 'ffmpeg not installed' };
const root = tmp();
const check = (rep, id) => rep.layers.mp4.checks.find((c) => c.id === id);
let n = 0;
const proj = (o) => { const d = join(root, `p${n++}`); makeProject(d, o); return d; };
const clip = (o) => { const f = join(root, `c${n++}.mp4`); makeClip(f, o); return f; };

test('usage errors exit 64', opts, async () => {
  assert.equal(await runVerify([]), 64);
  assert.equal(await runVerify([root, '--bogus']), 64);
  assert.equal(await runVerify([join(root, 'nope')]), 64);
});

test('good clip passes layer 2 and writes report + contact sheet', opts, async () => {
  const p = proj();
  const { code, report } = await verifyJson(runVerify, p, ['--mp4', clip(), '--no-hf-check']);
  assert.equal(code, 0, JSON.stringify(report.layers.mp4, null, 1));
  assert.equal(report.layers.mp4.status, 'pass');
  for (const id of ['probe', 'duration', 'first-frame', 'blank-stretch', 'frozen-stretch', 'audio-present', 'contact-sheet']) {
    assert.equal(check(report, id).status, 'pass', id);
  }
  assert.ok(['pass', 'warn'].includes(check(report, 'loudness').status));
  assert.ok(existsSync(join(p, '.cve', 'verify-report.json')));
  assert.ok(existsSync(join(p, '.cve', 'contact-sheet.png')));
  assert.ok(report.skipped.some((s) => s.startsWith('hfCheck')));
});

test('black first frame fails first-frame', opts, async () => {
  const f = clip({ vf: "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,0,0.2)'" });
  const { code, report } = await verifyJson(runVerify, proj(), ['--mp4', f, '--no-hf-check']);
  assert.equal(code, 1);
  assert.equal(check(report, 'first-frame').status, 'fail');
});

test('1 s black gap fails blank-stretch', opts, async () => {
  const f = clip({ vf: "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,2,3)'" });
  const { code, report } = await verifyJson(runVerify, proj(), ['--mp4', f, '--no-hf-check']);
  assert.equal(code, 1);
  const c = check(report, 'blank-stretch');
  assert.equal(c.status, 'fail');
  assert.ok(Math.abs(c.at - 2) < 0.15, `at ${c.at}`);
});

test('4 s freeze mid-video fails frozen-stretch', opts, async () => {
  const f = clip({ vf: 'split[a][b];[a][b]freezeframes=first=60:last=180:replace=60', duration: 8, audio: false });
  const { code, report } = await verifyJson(runVerify, proj({ duration: 8 }), ['--mp4', f, '--no-hf-check']);
  assert.equal(code, 1);
  assert.equal(check(report, 'frozen-stretch').status, 'fail');
});

test('4 s still end card only warns', opts, async () => {
  const f = clip({ vf: 'trim=duration=2,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=4', duration: 6, audio: false });
  const { report } = await verifyJson(runVerify, proj(), ['--mp4', f, '--no-hf-check']);
  assert.equal(check(report, 'frozen-stretch').status, 'warn');
});

test('0.6 s black dip only warns', opts, async () => {
  const f = clip({ vf: "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,2,2.6)'" });
  const { report } = await verifyJson(runVerify, proj(), ['--mp4', f, '--no-hf-check']);
  assert.equal(check(report, 'blank-stretch').status, 'warn');
});

test('duration mismatch fails duration', opts, async () => {
  const { code, report } = await verifyJson(runVerify, proj({ duration: 10 }), ['--mp4', clip(), '--no-hf-check']);
  assert.equal(code, 1);
  assert.equal(check(report, 'duration').status, 'fail');
});

test('missing audio with <audio> in html fails audio-present', opts, async () => {
  const { code, report } = await verifyJson(runVerify, proj({ audioTag: true }), ['--mp4', clip({ audio: false }), '--no-hf-check']);
  assert.equal(code, 1);
  assert.equal(check(report, 'audio-present').status, 'fail');
  assert.equal(check(report, 'loudness').status, 'skipped');
});

test('missing hyperframes binary: layer 1 skipped, exit 2, never ok', opts, async () => {
  const { code, report } = await verifyJson(runVerify, proj(), ['--mp4', clip()]);
  assert.equal(code, 2);
  assert.equal(report.layers.hfCheck.status, 'skipped');
  assert.equal(report.ok, false);
});

test('no mp4 found: mp4 layer skipped, exit 2', opts, async () => {
  const { code, report } = await verifyJson(runVerify, proj(), ['--no-hf-check']);
  assert.equal(code, 2);
  assert.equal(report.layers.mp4.status, 'skipped');
  assert.equal(report.ok, false);
});

test('newest mp4 under renders/ is picked up', opts, async () => {
  const p = proj();
  mkdirSync(join(p, 'renders'));
  makeClip(join(p, 'renders', 'a.mp4'));
  const { code, report } = await verifyJson(runVerify, p, ['--no-hf-check']);
  assert.equal(code, 0);
  assert.ok(report.mp4.endsWith('a.mp4'));
});

function fakeHf(project, json) {
  const bin = join(project, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  const p = join(bin, 'hyperframes');
  writeFileSync(p, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(json)}\nEOF\nexit 0\n`);
  chmodSync(p, 0o755);
}

test('layer 1 trusts JSON, not exit code: errors fail', opts, async () => {
  const p = proj();
  fakeHf(p, {
    ok: false, contrast: { ok: false, errorCount: 2, warningCount: 1, findings: [
      { code: 'text_contrast', severity: 'error', time: 3.5, selector: '.cap', message: 'low contrast' },
      { code: 'x', severity: 'warning', message: 'w' }] },
    lint: { ok: true, errorCount: 0, warningCount: 0, findings: [] }, _meta: { version: '0.9.67' },
  });
  const { code, report } = await verifyJson(runVerify, p, ['--mp4', clip()]);
  assert.equal(code, 1);
  assert.equal(report.layers.hfCheck.status, 'fail');
  assert.equal(report.layers.hfCheck.summary.contrast.errors, 2);
  assert.equal(report.layers.hfCheck.findings.length, 1);
  assert.equal(report.tools.hyperframes, '0.9.67');
});

test('layer 1 clean + good clip = ok', opts, async () => {
  const p = proj();
  fakeHf(p, { ok: true, lint: { ok: true, errorCount: 0, warningCount: 0, findings: [] }, runtime: { ok: true, errorCount: 0, warningCount: 0, findings: [] } });
  const { code, report } = await verifyJson(runVerify, p, ['--mp4', clip()]);
  assert.equal(code, 0);
  assert.equal(report.ok, true);
});

test('layer 1 that prints no JSON is an error, not a pass', opts, async () => {
  const p = proj();
  const bin = join(p, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'hyperframes'), '#!/bin/sh\necho hello\n');
  chmodSync(join(bin, 'hyperframes'), 0o755);
  const { code, report } = await verifyJson(runVerify, p, ['--mp4', clip()]);
  assert.equal(code, 2);
  assert.equal(report.layers.hfCheck.status, 'error');
});

test('no index.html: duration is an error, run is not ok, exit 2', opts, async () => {
  const d = join(root, `p${n++}`);
  mkdirSync(d, { recursive: true });
  const { code, report } = await verifyJson(runVerify, d, ['--mp4', clip(), '--no-hf-check']);
  assert.equal(code, 2);
  assert.equal(report.ok, false);
  const c = check(report, 'duration');
  assert.equal(c.status, 'error');
  assert.equal(c.required, true);
  assert.match(c.message, /cannot verify duration: no root data-duration/);
  assert.equal(check(report, 'loudness').required, false);
});

test('empty project: skipped audio-present and missing duration block (layer error)', opts, async () => {
  const d = join(root, `p${n++}`);
  mkdirSync(d, { recursive: true });
  const { code, report } = await verifyJson(runVerify, d, ['--mp4', clip(), '--no-hf-check']);
  assert.equal(check(report, 'audio-present').status, 'skipped');
  assert.equal(report.layers.mp4.status, 'error');
  assert.equal(code, 2);
});

function fakeRaw(project, body) {
  const bin = join(project, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'hyperframes'), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, 'hyperframes'), 0o755);
}

test('hyperframes runtime_error JSON maps to layer error, exit 2', opts, async () => {
  const p = proj();
  fakeRaw(p, `echo '{"ok":false,"error":{"code":"runtime_error","message":"boom"},"_meta":{"version":"0.9.67"}}'`);
  const { code, report } = await verifyJson(runVerify, p, ['--mp4', clip()]);
  assert.equal(code, 2);
  assert.equal(report.layers.hfCheck.status, 'error');
  assert.match(report.layers.hfCheck.reason, /runtime_error.*boom/);
});

test('hyperframes {"ok":true} without sections is an error', opts, async () => {
  const p = proj();
  fakeRaw(p, `echo '{"ok":true}'`);
  const { code, report } = await verifyJson(runVerify, p, ['--mp4', clip()]);
  assert.equal(code, 2);
  assert.equal(report.layers.hfCheck.status, 'error');
  assert.match(report.layers.hfCheck.reason, /no sections/);
});

test('hyperframes version mismatch adds a warn note, does not fail', opts, async () => {
  const p = proj();
  const sec = '{"ok":true,"errorCount":0,"warningCount":0,"findings":[]}';
  fakeRaw(p, `echo '{"ok":true,"lint":${sec},"runtime":${sec}}'`);
  const mod = join(p, 'node_modules', 'hyperframes');
  mkdirSync(mod, { recursive: true });
  writeFileSync(join(mod, 'package.json'), '{"version":"0.1.0"}');
  const { code, report } = await verifyJson(runVerify, p, ['--mp4', clip()]);
  assert.equal(code, 0);
  assert.equal(report.tools.hyperframes, '0.1.0');
  assert.ok(report.notes.some((x) => x.level === 'warn' && /0\.1\.0/.test(x.message)));
});

test('0.4 s clip gets a contact sheet', opts, async () => {
  const f = clip({ duration: 0.4, audio: false });
  const out = join(root, 'short.png');
  const probe = await probeMedia(f);
  const sheet = await makeContactSheet(f, out, probe.duration);
  assert.ok(sheet.ok, sheet.error);
  assert.equal(sheet.frames, 1);
  assert.ok(existsSync(out));
});

// ---- near-empty ----
test('0.4 s of background plus a tiny box warns near-empty', opts, async () => {
  const f = join(root, `ne${n++}.mp4`);
  // moving content; between 2.0 and 2.4 s only a flat background and a 6x6 box remain
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=6',
    '-vf', "format=yuv420p,drawbox=x=0:y=0:w=320:h=180:color=0x202020:t=fill:enable='between(t,2,2.4)',drawbox=x=157:y=87:w=6:h=6:color=white:t=fill:enable='between(t,2,2.4)'",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30', f]);
  const { report } = await verifyJson(runVerify, proj(), ['--mp4', f, '--no-hf-check']);
  const c = check(report, 'near-empty');
  assert.equal(c.status, 'warn', JSON.stringify(c));
  assert.equal(c.required, false);
  assert.ok(c.data.stretches[0].start >= 1.9 && c.data.stretches[0].start <= 2.2);
});

test('normal moving clip passes near-empty', opts, async () => {
  const { report } = await verifyJson(runVerify, proj(), ['--mp4', clip(), '--no-hf-check']);
  assert.equal(check(report, 'near-empty').status, 'pass');
});

// ---- loudness ----
function beepClip(file, dbfs, { beeps = true } = {}) {
  const a = beeps
    ? `aevalsrc='${10 ** (dbfs / 20)}*sin(2*PI*880*t)*(between(t,0.5,0.7)+between(t,2,2.2)+between(t,3.5,3.7))':s=48000:d=5`
    : `sine=frequency=440:duration=5,volume=${dbfs}dB`;
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=5', '-f', 'lavfi', '-i', a,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-shortest', file.replace(/\.mp4$/, '.mov')]);
  return file.replace(/\.mp4$/, '.mov');
}

test('sparse beeps at -3 dBFS pass the sparse rule', opts, async () => {
  const { report } = await verifyJson(runVerify, proj(), ['--mp4', beepClip(join(root, `b${n++}.mp4`), -3), '--no-hf-check']);
  const c = check(report, 'loudness');
  assert.equal(c.status, 'pass', JSON.stringify(c));
  assert.equal(c.data.rule, 'sparse-true-peak');
  assert.ok(c.data.nonSilentShare < 0.4);
});

test('sparse beeps at -15 dBFS warn too quiet', opts, async () => {
  const { report } = await verifyJson(runVerify, proj(), ['--mp4', beepClip(join(root, `b${n++}.mp4`), -15), '--no-hf-check']);
  const c = check(report, 'loudness');
  assert.equal(c.status, 'warn');
  assert.match(c.message, /too quiet/);
  assert.equal(c.data.rule, 'sparse-true-peak');
});

test('continuous tone uses the integrated rule', opts, async () => {
  const { report } = await verifyJson(runVerify, proj(), ['--mp4', beepClip(join(root, `b${n++}.mp4`), -11, { beeps: false }), '--no-hf-check']);
  const c = check(report, 'loudness');
  assert.equal(c.data.rule, 'integrated');
  assert.equal(c.required, false);
});

test('report lists sound cues with bundled descriptions', opts, async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = proj({ audioTag: true });
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><body><div id="root" data-composition-id="main" data-duration="6"><audio id="sfx-01" class="clip" src="assets/sfx/click-soft.mp3" data-start="1.5" data-duration="0.37" data-volume="0.8"></audio></div></body></html>`);
  const man = join(dir, 'skills', 'media-use', 'audio', 'assets', 'sfx');
  mkdirSync(man, { recursive: true });
  writeFileSync(join(man, 'manifest.json'), JSON.stringify([{ file: 'click-soft.mp3', description: 'Quiet short click — test' }]));
  const { report } = await verifyJson(runVerify, dir, ['--mp4', clip(), '--no-hf-check']);
  assert.equal(report.soundCues.length, 1);
  assert.equal(report.soundCues[0].start, 1.5);
  assert.match(report.soundCues[0].described, /Quiet short click/);
});
