/** Settings: the version, the credits, and "How decks are recommended" for each game. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openApp, overflowsSideways } from './lib/app.mjs';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const about = () => {
  const d = document.querySelector('.about-details');
  if (!d) return null;
  d.open = true;
  return { summary: d.querySelector('summary').innerText, paragraphs: [...d.querySelectorAll('p')].map((p) => p.innerText) };
};

export default [
  ...[
    ['pokemon', 'Pokémon'],
    ['ygo', 'Yu-Gi-Oh!'],
    ['mtg', 'Magic'],
  ].map(([game, label]) => ({
    name: `${label}: About says how decks are recommended`,
    async run({ page, base }) {
      await openApp(page, base, game, '#/settings');
      const a = await page.waitFor(about, { what: 'the About section' });
      assert.equal(a.summary, `How decks are recommended (${label})`);
      const text = a.paragraphs.join(' ');
      assert.match(text, /on this device/);
      assert.match(text, /score out of 100/);
      assert.match(text, /uses your cards first/);
      assert.match(text, /knows nothing about tournament results/);
      if (game === 'pokemon') assert.match(text, /400 practice games/);
      else assert.match(text, /scored, not played/);
      assert.match(await page.run(() => document.querySelector('#main').innerText), new RegExp(`CardCodex v${VERSION.replace(/\./g, '\\.')}`));
      assert.equal(await page.run(overflowsSideways), false);
    },
  })),
  {
    name: 'Pokémon: Scrydex is credited for the pictures it provides, with a link',
    async run({ page, base }) {
      await openApp(page, base, 'pokemon', '#/settings');
      await page.waitFor(() => /Scrydex/.test(document.querySelector('#main').innerText), { what: 'the Scrydex credit' });
      const credit = await page.run(() => ({
        lines: document.querySelector('#main').innerText.split('\n').filter((l) => l.includes('Scrydex')),
        links: [...document.querySelectorAll('#main a')].map((a) => a.href).filter((h) => h.includes('scrydex')),
      }));
      assert.ok(credit.lines.some((l) => /card images provided by Scrydex/i.test(l)), credit.lines.join(' | '));
      assert.deepEqual([...new Set(credit.links)], ['https://scrydex.com/']);
    },
  },
];
