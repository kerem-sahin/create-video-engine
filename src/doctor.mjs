import { freemem } from 'node:os';
import { statfsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { HF_ENV, EXIT } from './lib/constants.mjs';
import { run, which } from './lib/exec.mjs';
import { findUp, exists } from './lib/fsx.mjs';
import { SYMBOL, out, err, printJson } from './lib/log.mjs';

// HyperFrames reports optional tools (Docker, whisper, TTS) as ok:false; only these block rendering.
const HF_REQUIRED = new Set(['chrome', 'ffmpeg', 'ffprobe', 'node.js']);
// HyperFrames tools this engine never uses: listing them with their install hints (pip install torch, Docker)
// sends a new person off to install gigabytes for nothing, so they are left out.
const HF_UNUSED = /^(tts\b|bgm\b|docker\b)/;
const check = (name, status, detail, hint = '') => ({ name, status, detail, hint });

async function toolVersion(cmd) {
  const r = await run(cmd, ['-version'], { timeout: 10000 });
  const m = /version\s+(\S+)/.exec(r.stdout);
  return r.code === 0 ? (m ? m[1] : 'unknown') : null;
}

export function normalizeHf(parsed) {
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.checks) ? parsed.checks : null;
  if (!list) return [check('hyperframes doctor', 'warn', 'unrecognised output from hyperframes doctor --json', 'Run `npx hyperframes doctor` to see it.')];
  return list.filter((c) => !HF_UNUSED.test(String(c.name ?? c.id ?? '').toLowerCase())).map((c) => {
    let status = c.status;
    if (status === 'pass' || status === 'passed') status = 'ok';
    if (status === 'warning') status = 'warn';
    if (status === 'error' || status === 'failed') status = 'fail';
    if (!['ok', 'warn', 'fail'].includes(status)) status = c.ok === false ? 'fail' : 'ok';
    if (status === 'fail' && !HF_REQUIRED.has(String(c.name ?? '').toLowerCase())) status = 'warn';
    return check(`hyperframes: ${c.name ?? c.id ?? 'check'}`, status, String(c.detail ?? c.message ?? c.version ?? ''), String(c.hint ?? c.fix ?? c.suggestion ?? ''));
  });
}

export async function runDoctor(argv = []) {
  let json = false;
  for (const a of argv) {
    if (a === '--json') json = true;
    else { err(`doctor: unknown option ${a}`); return EXIT.USAGE; }
  }
  const checks = [];

  const major = Number(process.versions.node.split('.')[0]);
  checks.push(major >= 22
    ? check('node', 'ok', `v${process.versions.node}`)
    : check('node', 'fail', `v${process.versions.node}`, 'Install Node 22 or newer: https://nodejs.org'));

  for (const tool of ['ffmpeg', 'ffprobe']) {
    if (!which(tool)) {
      checks.push(check(tool, 'fail', 'not found on PATH', 'Install ffmpeg (macOS: `brew install ffmpeg`; Linux: your package manager).'));
      continue;
    }
    const v = await toolVersion(tool);
    if (!v) { checks.push(check(tool, 'fail', 'found but could not run', 'Reinstall ffmpeg.')); continue; }
    const vmajor = Number(/^n?(\d+)/.exec(v)?.[1]);
    if (vmajor !== 8) {
      checks.push(check(tool, 'warn', `version ${v}`, 'Loudness numbers only comparable on 8.0.1.'));
    } else checks.push(check(tool, 'ok', `version ${v}`));
  }

  const freeGb = freemem() / 2 ** 30;
  checks.push(freeGb >= 2
    ? check('memory', 'ok', `${freeGb.toFixed(1)} GB free`)
    : check('memory', 'warn', `${freeGb.toFixed(1)} GB free`, 'Rendering needs about 2 GB free; close other apps.'));

  try {
    const s = statfsSync(process.cwd());
    const gb = (s.bavail * s.bsize) / 2 ** 30;
    checks.push(gb >= 5
      ? check('disk', 'ok', `${gb.toFixed(1)} GB free`)
      : check('disk', 'warn', `${gb.toFixed(1)} GB free`, 'Renders are large; free up at least 5 GB.'));
  } catch {
    checks.push(check('disk', 'warn', 'could not read free space', ''));
  }

  checks.push(which('git')
    ? check('git', 'ok', 'found')
    : check('git', 'warn', 'not found', 'Install git to version your studio (optional).'));

  const studioFile = findUp(process.cwd(), 'studio.json');
  if (studioFile) {
    const root = dirname(studioFile);
    const bin = join(root, 'node_modules', '.bin', 'hyperframes');
    if (!exists(bin)) {
      checks.push(check('hyperframes', 'fail', 'not installed in this studio', `Run \`npm install\` in ${root}.`));
    } else {
      const r = await run(bin, ['doctor', '--json'], { cwd: root, env: HF_ENV, timeout: 120000 });
      let parsed = null;
      try { parsed = JSON.parse(r.stdout); } catch { /* handled below */ }
      if (parsed) checks.push(...normalizeHf(parsed));
      else checks.push(check('hyperframes', 'fail', `doctor produced no JSON (exit ${r.code})`, 'Run `npx hyperframes doctor` to see the problem.'));
    }
  } else {
    checks.push(check('studio', 'warn', 'not inside a studio, so Chrome and the render engine were not checked', 'Run `npx create-video-engine doctor` from inside your studio folder for the full check.'));
  }

  const ok = !checks.some((c) => c.status === 'fail');
  if (json) printJson({ ok, checks });
  else {
    for (const c of checks) {
      out(`${SYMBOL[c.status]} ${c.name}: ${c.detail}`);
      if (c.hint && c.status !== 'ok') out(`    ${c.hint}`);
    }
    out(ok ? '\nAll required checks passed.' : '\nSome required checks failed.');
  }
  return ok ? EXIT.OK : EXIT.FAIL;
}
