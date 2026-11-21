import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin` };

export const tmp = (p = 'cve-test-') => mkdtempSync(join(tmpdir(), p));

export function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
}

export const haveFfmpeg = spawnSync('ffmpeg', ['-version'], { env }).status === 0;

/** 6 s 30 fps testsrc2 with a sine audio; `vf` extra video filter, `audio` false drops audio. */
export function makeClip(file, { vf = '', audio = true, duration = 6 } = {}) {
  const args = ['-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=30:duration=${duration}`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`);
  const chain = ['format=yuv420p', vf].filter(Boolean).join(',');
  args.push('-vf', chain, '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '30');
  if (audio) args.push('-c:a', 'aac', '-shortest');
  args.push(file);
  ffmpeg(args);
}

export function makeProject(dir, { duration = 6, fps, audioTag = false } = {}) {
  mkdirSync(dir, { recursive: true });
  const f = fps ? ` data-fps="${fps}"` : '';
  writeFileSync(join(dir, 'index.html'),
    `<!doctype html><html><body><div id="root" data-composition-id="main" data-duration="${duration}"${f}>${audioTag ? '<audio src="a.mp3"></audio>' : ''}</div></body></html>`);
}

export async function verifyJson(runVerify, project, extra = []) {
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c, ...r) => (typeof c === 'string' ? true : orig(c, ...r));
  let code;
  try { code = await runVerify([project, ...extra]); } finally { process.stdout.write = orig; }
  const report = JSON.parse(readFileSync(join(project, '.cve', 'verify-report.json'), 'utf8'));
  return { code, report };
}
