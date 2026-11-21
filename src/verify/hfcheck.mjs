import { HF_CHECK_TIMEOUT_MS } from './thresholds.mjs';
import { HYPERFRAMES_VERSION } from '../lib/constants.mjs';
import { findHyperframesBin, readHyperframesVersion } from './project.mjs';
import { run, text, toolEnv } from './util.mjs';

function parseJson(s) {
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch { /* ignore */ }
  }
  return null;
}

async function binVersion(bin, cwd) {
  const r = await run(bin, ['--version'], { cwd, env: toolEnv({ HYPERFRAMES_TELEMETRY: '0', DO_NOT_TRACK: '1' }), timeoutMs: 15000 });
  const m = /\b(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/.exec(text(r.stdout));
  return m ? m[1] : null;
}

/** Layer 1: `hyperframes check --json` with the studio's local binary. */
export async function runHfCheck(project, { disabled = false } = {}) {
  if (disabled) {
    return { layer: { status: 'skipped', reason: 'skipped by request (--no-hf-check)', summary: {}, findings: [] }, byRequest: true, version: null };
  }
  const bin = findHyperframesBin(project);
  if (!bin) {
    return {
      layer: { status: 'skipped', reason: 'local hyperframes binary not found (looked for node_modules/.bin/hyperframes in the project and its parents)', summary: {}, findings: [] },
      byRequest: false, version: null,
    };
  }
  const installed = readHyperframesVersion(project) ?? await binVersion(bin, project);
  const notes = [];
  if (installed && installed !== HYPERFRAMES_VERSION) {
    notes.push({ level: 'warn', message: `hyperframes ${installed} is installed but this engine was validated against ${HYPERFRAMES_VERSION}` });
  } else if (!installed) {
    notes.push({ level: 'warn', message: `could not read the installed hyperframes version (expected ${HYPERFRAMES_VERSION})` });
  }
  const r = await run(bin, ['check', '--json'], {
    cwd: project,
    env: toolEnv({ HYPERFRAMES_TELEMETRY: '0', DO_NOT_TRACK: '1' }),
    timeoutMs: HF_CHECK_TIMEOUT_MS,
  });
  const fail = (reason, v = null) => ({ layer: { status: 'error', reason, summary: {}, findings: [] }, byRequest: false, version: v ?? installed ?? null, notes });
  if (r.timedOut) return fail('hyperframes check timed out');
  if (r.error) return fail(`could not start hyperframes: ${r.error}`);
  const j = parseJson(text(r.stdout));
  if (!j || typeof j !== 'object') {
    return fail(`hyperframes check printed no JSON (exit ${r.code}): ${text(r.stderr).trim().split('\n').pop() ?? ''}`.trim());
  }

  if (j.ok === false && j.error && typeof j.error === 'object') {
    return fail(`hyperframes check failed to run: ${j.error.code ?? 'error'}: ${j.error.message ?? 'no message'}`, j._meta?.version);
  }

  const summary = {};
  const findings = [];
  let totalErrors = 0;
  for (const [name, sec] of Object.entries(j)) {
    if (!sec || typeof sec !== 'object' || typeof sec.errorCount !== 'number') continue;
    summary[name] = { ok: sec.errorCount === 0 && sec.ok !== false, errors: sec.errorCount, warnings: sec.warningCount ?? 0 };
    totalErrors += sec.errorCount;
    for (const f of sec.findings ?? []) {
      if (f.severity !== 'error') continue;
      findings.push({
        section: name, code: f.code, time: f.time ?? null, selector: f.selector ?? null,
        message: f.message, sourceFile: f.sourceFile ?? null,
      });
    }
  }
  const version = installed ?? j._meta?.version ?? null;
  const warnings = Object.values(summary).reduce((n, s) => n + s.warnings, 0);

  let status;
  let reason = '';
  if (j.browserSkipped === true) {
    status = 'error';
    reason = 'hyperframes skipped its browser checks (layout, contrast, ...); nothing was measured there';
  } else if (j.ok === true && totalErrors === 0 && (!('lint' in summary) || !('runtime' in summary))) {
    return fail('hyperframes check returned no sections', version);
  } else if (j.ok === true && totalErrors === 0) {
    status = 'pass';
    reason = `${warnings} warning(s)`;
  } else {
    status = 'fail';
    reason = totalErrors > 0
      ? `${totalErrors} error(s) in: ${Object.entries(summary).filter(([, s]) => s.errors > 0).map(([n, s]) => `${n} ${s.errors}`).join(', ')}`
      : 'hyperframes reported ok=false without listing errors';
  }
  return { layer: { status, reason, summary, findings }, byRequest: false, version, notes };
}
