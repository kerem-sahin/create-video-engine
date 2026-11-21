import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HYPERFRAMES_VERSION = '0.9.67';
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PACKAGE_VERSION = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
export const HF_ENV = { HYPERFRAMES_TELEMETRY: '0', DO_NOT_TRACK: '1' };
export const EXIT = { OK: 0, FAIL: 1, CANNOT_RUN: 2, USAGE: 64 };
