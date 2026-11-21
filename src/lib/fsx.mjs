import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const exists = (p) => existsSync(p);

export function isNonEmptyDir(p) {
  try { return statSync(p).isDirectory() ? readdirSync(p).length > 0 : true; } catch { return false; }
}

export function listDirs(p) {
  try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; }
}

// Copies a directory tree; symlinks are followed so the result holds real files.
export function copyDir(src, dest) {
  cpSync(src, dest, { recursive: true, dereference: true });
}

export function findUp(startDir, name) {
  let dir = resolve(startDir);
  for (;;) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
