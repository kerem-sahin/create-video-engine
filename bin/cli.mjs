#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PACKAGE_VERSION } from '../src/lib/constants.mjs';

const HELP = `create-video-engine ${PACKAGE_VERSION} (pre-release)

Usage: create-video-engine <command> [options]

Commands:
  doctor [--json]                                   check the environment
  init <dir> [--no-install] [--json]                create a studio
  verify <project> [--mp4 <file>] [--json] [--no-hf-check]
                                                    verify a video before delivery
  refs <video-file> --out <dir> [--json]            analyse a reference video
  music --mood "<words>" --duration <s> --out <dir> [--used <file>] [--json]
                                                    find a recorded CC0/CC BY track by feel
  crop <image> --out <file.png> [--auto] [--rect x,y,w,h] [--status-bar] [--json]
                                                    crop a store screenshot to the real app screen
  catalog check [--dir <catalog-dir>] [--json]      validate the parts catalog
  catalog list [--lane <id>] [--dir <catalog-dir>] [--json]
                                                    list parts (optionally one lane's)
  upgrade [--studio <dir>] [--dry-run] [--json]     bring a studio's skills, lane recipes and parts up to this version
                                                    (your edits are kept or backed up as <file>.bak-<date>)
  add <part-id>|lane:<id> [--studio <dir>] [--paid] [--dry-run] [--json]
                                                    install a catalog part or lane into a studio
  remove <part-id>|lane:<id> [--studio <dir>] [--json]
                                                    remove an installed part or lane

  --help, --version

Exit codes: 0 ok, 1 checks found errors, 2 could not run, 64 bad usage.`;

const COMMANDS = {
  doctor: ['../src/doctor.mjs', 'runDoctor'],
  init: ['../src/init.mjs', 'runInit'],
  verify: ['../src/verify/index.mjs', 'runVerify'],
  refs: ['../src/refs/index.mjs', 'runRefs'],
  music: ['../src/music/index.mjs', 'runMusic'],
  crop: ['../src/crop/index.mjs', 'runCrop'],
  catalog: ['../src/catalog/index.mjs', 'runCatalog'],
  add: ['../src/add/index.mjs', 'runAdd'],
  remove: ['../src/add/index.mjs', 'runRemove'],
  upgrade: ['../src/upgrade.mjs', 'runUpgrade'],
};

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(HELP); process.exit(0); }
if (cmd === '--version' || cmd === '-v') { console.log(PACKAGE_VERSION); process.exit(0); }
if (!cmd || !COMMANDS[cmd]) {
  console.error(cmd ? `Unknown command: ${cmd}\n` : '');
  console.error(HELP);
  process.exit(64);
}
if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }

const [rel, fn] = COMMANDS[cmd];
const url = new URL(rel, import.meta.url);
if (!existsSync(fileURLToPath(url))) {
  console.error(`${cmd}: not available in this build`);
  process.exit(2);
}
let mod;
try {
  mod = await import(pathToFileURL(fileURLToPath(url)).href);
} catch (e) {
  console.error(`${cmd}: unexpected error: ${e?.message ?? e}`);
  process.exit(2);
}
let code;
try {
  code = await mod[fn](rest);
} catch (e) {
  console.error(`${cmd}: unexpected error: ${e?.message ?? e}`);
  code = 2;
}
process.exit(code);
