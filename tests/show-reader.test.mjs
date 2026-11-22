import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFeed, htmlToText, durationSeconds, slug, sameName } from '../catalog/tool/show-reader/files/rss.mjs';

const FEED = `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title><![CDATA[Bank & Mic]]></title><description><![CDATA[<p>Two friends on a <b>park bench</b>.</p>]]></description>
<language>tr</language><itunes:image href="https://x.test/cover.jpg"/><itunes:category text="Comedy"/>
<item><title>Second: Big Day</title><pubDate>Thu, 14 May 2026 10:00:00 GMT</pubDate><itunes:duration>35:08</itunes:duration>
<guid>g2</guid><description><![CDATA[<p>Line one.</p><p>Line &amp; two.</p>]]></description><enclosure url="https://x.test/2.m4a" length="123" type="audio/x-m4a"/></item>
<item><title>First &#8217;one&#8217;</title><pubDate>Thu, 30 Apr 2026 10:00:00 GMT</pubDate><itunes:duration>1010</itunes:duration>
<guid>g1</guid><description>plain</description><enclosure url="https://x.test/1.mp3" length="9" type="audio/mpeg"/></item>
</channel></rss>`;

test('a podcast feed becomes show + episodes, oldest first', () => {
  const { show, episodes } = parseFeed(FEED);
  assert.equal(show.title, 'Bank & Mic');
  assert.equal(show.description, 'Two friends on a park bench.');
  assert.equal(show.image, 'https://x.test/cover.jpg');
  assert.deepEqual(show.categories, ['Comedy']);
  assert.deepEqual(episodes.map((e) => [e.n, e.title, e.date, e.duration_s]), [[1, 'First ’one’', '2026-04-30', 1010], [2, 'Second: Big Day', '2026-05-14', 2108]]);
  assert.equal(episodes[1].description, 'Line one.\nLine & two.');
  assert.deepEqual(episodes[1].audio, { url: 'https://x.test/2.m4a', type: 'audio/x-m4a', bytes: 123 });
});

test('helpers', () => {
  assert.equal(durationSeconds('01:02:03'), 3723);
  assert.equal(durationSeconds('x'), null);
  assert.equal(slug("Psikoloji Okuyup Ehliyeti 3'te Alan Adam: Aydın'ın Diss Savunması"), 'psikoloji-okuyup-ehliyeti-3-te-alan-adam-aydin');
  assert.ok(sameName('real G’s', "Real G's"));
  assert.ok(!sameName('', ''));
  assert.equal(htmlToText('<ul><li>a</li><li>b</li></ul>'), '- a\n- b');
});

test('read a saved feed file offline; a second read keeps local paths', () => {
  const d = mkdtempSync(join(tmpdir(), 'sr-'));
  writeFileSync(join(d, 'feed.xml'), FEED);
  const cli = new URL('../catalog/tool/show-reader/files/show-reader.mjs', import.meta.url).pathname;
  const out = join(d, 'show.json');
  let r = spawnSync(process.execPath, [cli, 'read', join(d, 'feed.xml'), '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  doc.episodes[0].local = '/x/01-first.mp3';
  writeFileSync(out, JSON.stringify(doc));
  r = spawnSync(process.execPath, [cli, 'read', join(d, 'feed.xml'), '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).episodes[0].local, '/x/01-first.mp3');
});

test('episode numbers never move: a back-dated new episode gets the next number', () => {
  const d = mkdtempSync(join(tmpdir(), 'sr-'));
  const cli = new URL('../catalog/tool/show-reader/files/show-reader.mjs', import.meta.url).pathname;
  const out = join(d, 'show.json');
  writeFileSync(join(d, 'feed.xml'), FEED);
  assert.equal(spawnSync(process.execPath, [cli, 'read', join(d, 'feed.xml'), '--out', out]).status, 0);
  const older = FEED.replace('</channel>', '<item><title>Old bonus</title><pubDate>Thu, 01 Jan 2026 10:00:00 GMT</pubDate><guid>g0</guid><enclosure url="https://x.test/0.mp3" type="audio/mpeg"/></item></channel>');
  writeFileSync(join(d, 'feed.xml'), older);
  assert.equal(spawnSync(process.execPath, [cli, 'read', join(d, 'feed.xml'), '--out', out]).status, 0);
  const eps = JSON.parse(readFileSync(out, 'utf8')).episodes;
  assert.deepEqual(eps.map((e) => [e.n, e.guid]), [[1, 'g1'], [2, 'g2'], [3, 'g0']]);
});

test('a broken character entity does not break the feed', () => {
  const { show } = parseFeed(FEED.replace('Bank &amp; Mic', 'Bank &#99999999; Mic').replace('<![CDATA[Bank & Mic]]>', 'Bank &#99999999; Mic'));
  assert.equal(show.title, 'Bank &#99999999; Mic');
});
