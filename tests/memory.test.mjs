import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toLines, recurringPhrases, names, norm } from '../catalog/tool/memory/files/memory.mjs';

const W = (text, t0 = 0) => text.split(' ').map((w, i) => ({ w, start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.35 }));

test('lines break at sentence ends and pauses', () => {
  const words = [...W('Bir iki üç.'), ...W('dört beş', 5)];
  assert.deepEqual(toLines(words).map((l) => l.text), ['Bir iki üç.', 'dört beş']);
});

test('a phrase that comes back across episodes is found; filler is not', () => {
  const eps = [
    { n: 1, words: W('yani şey park bankı yine dolu yani şey') },
    { n: 2, words: W('dün park bankı boştu yani şey işte') },
    { n: 3, words: W('bizim park bankı efsane') },
  ];
  const p = recurringPhrases(eps);
  const bank = p.find((x) => x.phrase === 'park bankı');
  assert.ok(bank, JSON.stringify(p));
  assert.deepEqual(bank.episodes, [1, 2, 3]);
  assert.ok(!p.some((x) => x.phrase === 'yani şey'), 'filler-only phrase dropped');
});

test('names: capitalised, not at a sentence start, plus titles', () => {
  const eps = [{ n: 1, words: W('dün Aydın geldi. Sonra Aydın gitti ve Selim kaldı ama Selim de gitti') }];
  const got = names(eps, ['Bu bölümde Yaprak var', 'Kanye West Erkek Miydi Ya Selim']);
  const by = Object.fromEntries(got.map((x) => [x.name, x]));
  assert.equal(by.Aydın.total, 2);
  assert.ok(by.Selim && by.Selim.total === 2);
  assert.ok(by.Yaprak && by.Yaprak.in_titles_or_descriptions === 1);
  assert.ok(!by.Kanye && by.Selim.in_titles_or_descriptions === 1, 'a Title Cased line only confirms names heard elsewhere');
  assert.ok(!by.Sonra, 'a sentence start is not a name');
  assert.equal(norm("Aydın'ın,"), "aydın'ın");
});

test('index writes index.md and a CHANNEL.md skeleton', () => {
  const mem = mkdtempSync(join(tmpdir(), 'mem-'));
  mkdirSync(join(mem, 'episodes'));
  writeFileSync(join(mem, 'episodes', '01.words.json'), JSON.stringify({ engine: 'test', words: W('bizim park bankı yine') }));
  writeFileSync(join(mem, 'episodes', '02.words.json'), JSON.stringify({ engine: 'test', words: W('park bankı yine dolu ve park bankı') }));
  const show = join(mem, 'show.json');
  writeFileSync(show, JSON.stringify({ show: { title: 'Test', description: 'Mahalledeki park bankı' }, episodes: [{ n: 1, title: 'Bir' }, { n: 2, title: 'İki' }] }));
  const cli = new URL('../catalog/tool/memory/files/memory.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [cli, 'index', '--memory', mem, '--show', show], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(mem, 'index.md'), 'utf8'), /"park bankı": 3x in 2 episodes/);
  assert.ok(existsSync(join(mem, 'CHANNEL.md')));
});
