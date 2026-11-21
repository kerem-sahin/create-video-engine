export const SYMBOL = { ok: '✓', warn: '!', fail: '✗' };
export const out = (s = '') => process.stdout.write(s + '\n');
export const err = (s = '') => process.stderr.write(s + '\n');
export const printJson = (o) => out(JSON.stringify(o, null, 2));
