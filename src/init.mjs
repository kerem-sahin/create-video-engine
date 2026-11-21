import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HYPERFRAMES_VERSION, PACKAGE_ROOT, PACKAGE_VERSION, HF_ENV, EXIT } from './lib/constants.mjs';
import { run, which } from './lib/exec.mjs';
import { isNonEmptyDir, listDirs, copyDir, exists } from './lib/fsx.mjs';
import { out, err, printJson } from './lib/log.mjs';
import { installedHashes } from './upgrade.mjs';

const HF_SKILLS = ['hyperframes', 'hyperframes-cli', 'media-use'];

function copySkills(srcRoot, names, destRoot, studio, warnings, label) {
  const copied = [];
  for (const name of names) {
    const src = join(srcRoot, name);
    if (!exists(src)) { warnings.push(`${label} skill "${name}" not found at ${src}`); continue; }
    for (const base of ['skills', join('.claude', 'skills')]) copyDir(src, join(studio, base, name));
    copied.push(name);
  }
  return copied;
}

export async function runInit(argv = []) {
  let json = false;
  let install = true;
  const pos = [];
  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a === '--no-install') install = false;
    else if (a.startsWith('-')) { err(`init: unknown option ${a}`); return EXIT.USAGE; }
    else pos.push(a);
  }
  if (pos.length !== 1) { err('usage: create-video-engine init <dir> [--no-install] [--json]'); return EXIT.USAGE; }
  const dir = resolve(pos[0]);
  if (isNonEmptyDir(dir)) { err(`init: ${dir} exists and is not empty. Pick a new or empty folder.`); return EXIT.USAGE; }

  const warnings = [];
  const skills = [];
  const fromCheckout = exists(join(PACKAGE_ROOT, '.git'));
  const engineDep = fromCheckout ? `file:${PACKAGE_ROOT}` : PACKAGE_VERSION;

  mkdirSync(dir, { recursive: true });
  const tpl = join(PACKAGE_ROOT, 'templates', 'studio');
  copyDir(tpl, dir);
  // npm drops files named .gitignore when packing, so the template ships as "gitignore".
  if (exists(join(dir, 'gitignore'))) {
    writeFileSync(join(dir, '.gitignore'), readFileSync(join(dir, 'gitignore')));
    rmSync(join(dir, 'gitignore'));
  }
  const studioJson = readFileSync(join(tpl, 'studio.json'), 'utf8')
    .replaceAll('__ENGINE_VERSION__', PACKAGE_VERSION)
    .replaceAll('__HYPERFRAMES_VERSION__', HYPERFRAMES_VERSION);
  writeFileSync(join(dir, 'studio.json'), studioJson);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'my-video-studio',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: { doctor: 'create-video-engine doctor', verify: 'create-video-engine verify', hf: 'hyperframes' },
    devDependencies: { 'create-video-engine': engineDep, hyperframes: HYPERFRAMES_VERSION },
  }, null, 2) + '\n');
  for (const d of ['brands', 'skills', join('.claude', 'skills')]) mkdirSync(join(dir, d), { recursive: true });

  const ours = join(PACKAGE_ROOT, 'skills');
  const ourNames = listDirs(ours);
  if (ourNames.length === 0) warnings.push('this package has no skills/ folder yet; our skills were not copied');
  else skills.push(...copySkills(ours, ourNames, '', dir, warnings, 'our'));

  const st = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  st.skills_hash = installedHashes(dir);
  writeFileSync(join(dir, 'studio.json'), JSON.stringify(st, null, 2) + '\n');

  let installed = false;
  if (install) {
    if (!json) out('Installing HyperFrames locally (npm install; uses the npm cache first, can take a few minutes on a first install)...');
    const r = await run('npm', ['install', '--prefer-offline', '--no-fund', '--no-audit'], { cwd: dir, env: HF_ENV, timeout: 600000 });
    if (r.code !== 0) {
      err(`init: npm install failed (exit ${r.code}).\n${r.stderr.trim().split('\n').slice(-8).join('\n')}`);
      err(`The studio files are in ${dir}. Fix the problem and run \`npm install\` there.`);
      if (json) printJson({ ok: false, dir, installed: false, skills, warnings });
      return EXIT.CANNOT_RUN;
    }
    installed = true;
    const hfSkills = join(dir, 'node_modules', 'hyperframes', 'dist', 'skills');
    skills.push(...copySkills(hfSkills, HF_SKILLS, '', dir, warnings, 'HyperFrames'));
  }

  if (!installed) warnings.push("HyperFrames' own skills (hyperframes, hyperframes-cli, media-use) were not copied because nothing was installed; run `npm install`, then `npx create-video-engine init` in a new folder or copy them from node_modules/hyperframes/dist/skills");
  if (!exists(join(ours, 'make')) || !exists(join(ours, 'learn'))) warnings.push('the make and learn skills are not in this release yet');

  if (which('git')) {
    const g = await run('git', ['init', '-q'], { cwd: dir });
    if (g.code !== 0) warnings.push('git init failed');
  } else warnings.push('git not found; the studio was not made a git repository');

  if (json) printJson({ ok: true, dir, installed, skills, warnings });
  else {
    out(`Studio created: ${dir}`);
    for (const w of warnings) out(`! ${w}`);
    if (!installed) out(`Not installed yet: run \`npm install\` in the folder.`);
    out('\nNext steps:\n  1. Open the folder in your agent (Claude Code, Codex, ...).\n  2. Say: "set up my studio" (in any language).');
  }
  return EXIT.OK;
}
