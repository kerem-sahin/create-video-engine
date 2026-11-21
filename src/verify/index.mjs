import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runMp4Checks } from './checks.mjs';
import { runHfCheck } from './hfcheck.mjs';
import { findNewestMp4, readRoot, scanAudioDeclared, listSoundCues, findSfxManifest } from './project.mjs';
import { ffmpegVersion, probeMedia } from './util.mjs';

const USAGE = 'usage: verify <video-project-dir> [--mp4 <file>] [--json] [--no-hf-check]';

function parseArgs(argv) {
  const o = { project: null, mp4: null, json: false, noHf: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--no-hf-check') o.noHf = true;
    else if (a === '--mp4') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: '--mp4 needs a file' };
      o.mp4 = v;
    } else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else if (o.project === null) o.project = a;
    else return { error: `unexpected argument ${a}` };
  }
  if (!o.project) return { error: 'missing <video-project-dir>' };
  return o;
}

export async function runVerify(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    process.stderr.write(`${args.error}\n${USAGE}\n`);
    return 64;
  }
  const project = resolve(args.project);
  if (!existsSync(project) || !statSync(project).isDirectory()) {
    process.stderr.write(`not a directory: ${project}\n${USAGE}\n`);
    return 64;
  }

  const started = Date.now();
  const ffv = await ffmpegVersion();

  // Layer 1
  const hf = await runHfCheck(project, { disabled: args.noHf });

  // Layer 2
  let mp4Path = args.mp4 ? resolve(args.mp4) : findNewestMp4(project);
  let mp4Layer;
  let contactSheet = null;
  let frames = [];
  let moments = [];
  const soundCues = listSoundCues(project, findSfxManifest(project));
  if (!mp4Path) {
    mp4Layer = { status: 'skipped', reason: 'no --mp4 given and no .mp4 found under renders/ or out/', checks: [] };
  } else if (!existsSync(mp4Path)) {
    mp4Layer = { status: 'error', reason: `file not found: ${mp4Path}`, checks: [] };
  } else if (!ffv) {
    mp4Layer = { status: 'error', reason: 'ffmpeg not found on PATH', checks: [] };
  } else {
    const probe = await probeMedia(mp4Path);
    if (!probe.ok) {
      mp4Layer = {
        status: 'error', reason: `cannot read the MP4: ${probe.error}`,
        checks: [{ id: 'probe', status: 'error', message: probe.error }],
      };
    } else {
      mkdirSync(join(project, '.cve'), { recursive: true });
      const res = await runMp4Checks({
        mp4: mp4Path, project, probe, root: readRoot(project), audio: scanAudioDeclared(project), ffmpegVersion: ffv, soundCues,
      });
      contactSheet = res.contactSheet;
      frames = res.frames;
      moments = res.moments;
      const blocked = res.checks.filter((c) => c.required && c.status === 'skipped');
      const st = res.checks.some((c) => c.status === 'fail') ? 'fail'
        : res.checks.some((c) => c.status === 'error') ? 'error'
          : blocked.length ? 'skipped' : 'pass';
      const bad = res.checks.filter((c) => c.status === 'fail' || c.status === 'error').map((c) => c.id);
      const reasons = [];
      if (bad.length) reasons.push(`problems in: ${bad.join(', ')}`);
      if (blocked.length) reasons.push(`required check(s) skipped: ${blocked.map((c) => c.id).join(', ')}`);
      mp4Layer = { status: st, reason: reasons.join('; '), checks: res.checks };
    }
  }

  const skipped = [];
  if (hf.layer.status === 'skipped') skipped.push(`hfCheck: ${hf.layer.reason}`);
  if (mp4Layer.status === 'skipped') skipped.push(`mp4: ${mp4Layer.reason}`);
  for (const c of mp4Layer.checks) if (c.status === 'skipped') skipped.push(`${c.id}: ${c.message}`);

  const hfRequired = !hf.byRequest;
  const layerStatuses = [mp4Layer.status, ...(hfRequired ? [hf.layer.status] : [])];
  const anyFail = layerStatuses.includes('fail');
  const ok = layerStatuses.every((s) => s === 'pass');
  const exitCode = ok ? 0 : anyFail ? 1 : 2;

  const report = {
    schema: 1,
    ok,
    project,
    mp4: mp4Path && existsSync(mp4Path) ? mp4Path : null,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    tools: { ffmpeg: ffv, hyperframes: hf.version ?? (hf.byRequest ? null : 'unknown') },
    notes: hf.notes ?? [],
    layers: { hfCheck: hf.layer, mp4: mp4Layer },
    contactSheet,
    frames,
    moments,
    soundCues,
    skipped,
  };
  mkdirSync(join(project, '.cve'), { recursive: true });
  const reportPath = join(project, '.cve', 'verify-report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(humanReport(report, reportPath));
  return exitCode;
}

function humanReport(r, reportPath) {
  const L = [];
  const tag = (s) => s.toUpperCase().padEnd(7);
  L.push(`verify ${r.project}${r.mp4 ? `  (${r.mp4})` : ''}`);
  const h = r.layers.hfCheck;
  L.push(`${tag(h.status)} hyperframes check${h.reason ? `: ${h.reason}` : ''}`);
  for (const f of h.findings.slice(0, 10)) {
    L.push(`          ${f.section}/${f.code}${f.time !== null ? ` @${f.time}s` : ''} ${f.selector ?? ''} ${f.message}`.trimEnd());
  }
  if (h.findings.length > 10) L.push(`          ... ${h.findings.length - 10} more in the report`);
  const m = r.layers.mp4;
  L.push(`${tag(m.status)} rendered MP4${m.reason ? `: ${m.reason}` : ''}`);
  for (const c of m.checks) {
    L.push(`  ${tag(c.status)} ${c.id.padEnd(15)} ${c.message}${c.at !== undefined && c.status !== 'pass' ? ` [at ${c.at}s]` : ''}`);
  }
  for (const n of r.notes ?? []) L.push(`${n.level.toUpperCase()} ${n.message}`);
  if (r.soundCues?.length) {
    L.push(`SOUND   ${r.soundCues.length} cue(s) — check each against the action on screen and STYLE.md sound:`);
    for (const c of r.soundCues) {
      if (c.kind) L.push(`  ${String(c.start).padStart(6)}s  scored ${c.kind}  beat ${c.beat}`);
      else L.push(`  ${String(c.start).padStart(6)}s  ${c.src.split('/').pop()}  gain ${c.volume}${c.described ? `  (${c.described.split(' — ')[0]})` : ''}`);
    }
  }
  if (r.moments?.length) {
    L.push(`MOMENTS ${r.moments.length} moment(s) for you to watch or listen to, nothing here replaces your own eyes and ears:`);
    for (const x of r.moments) L.push(`  ${String(x.t).padStart(6)}s  ${x.why}`);
  }
  L.push(r.ok ? 'RESULT ok (everything that ran passed; see skipped list)' : 'RESULT not ok');
  if (r.skipped.length) L.push(`skipped: ${r.skipped.join(' | ')}`);
  L.push(`report: ${reportPath}`);
  return `${L.join('\n')}\n`;
}
