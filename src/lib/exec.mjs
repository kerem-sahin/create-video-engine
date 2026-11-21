import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

// Kills the whole process group (the child is spawned detached, so it leads its own group).
export function killTree(child) {
  try { process.kill(-child.pid, 'SIGKILL'); return; } catch { /* fall back */ }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

// Detached children don't get the terminal's Ctrl+C, so forward it: kill every live child tree, then exit.
const live = new Set();
let handlersInstalled = false;
export function track(child) {
  live.add(child);
  child.on('close', () => live.delete(child));
  child.on('error', () => live.delete(child));
  if (!handlersInstalled) {
    handlersInstalled = true;
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      process.once(sig, () => { for (const c of live) killTree(c); process.exit(code); });
    }
  }
  return child;
}

// Runs a command without a shell. Never rejects: failures to start give code -1.
export function run(cmd, args = [], { cwd, env, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      track(child);
    } catch (e) {
      return done({ code: -1, stdout, stderr: String(e.message) });
    }
    let timer;
    if (timeout > 0) {
      timer = setTimeout(() => { killTree(child); child.stdout.destroy(); child.stderr.destroy(); done({ code: -1, stdout, stderr: stderr + `\ntimed out after ${timeout}ms` }); }, timeout);
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); done({ code: -1, stdout, stderr: stderr + String(e.message) }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code: code ?? -1, stdout, stderr }); });
  });
}

export function which(cmd) {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, cmd);
    try {
      if (!statSync(p).isFile()) continue;
      accessSync(p, constants.X_OK);
      return p;
    } catch { /* keep looking */ }
  }
  return null;
}
