/** The app starts in each game and shows that game's sets, on a phone-sized page. */
import assert from 'node:assert/strict';
import { openApp, overflowsSideways } from './lib/app.mjs';

const GAMES = [
  ['pokemon', 'Pokémon'],
  ['ygo', 'Yu-Gi-Oh!'],
  ['mtg', 'Magic'],
];

export default GAMES.map(([game, label]) => ({
  name: `${label} opens on its sets`,
  async run({ page, base }) {
    await openApp(page, base, game, '#/sets');
    const rows = await page.waitFor(() => document.querySelectorAll('.set-row').length > 20 && document.querySelectorAll('.set-row').length, { timeout: 60_000, what: 'the list of sets' });
    assert.ok(rows > 20, `${rows} sets listed`);
    assert.equal(await page.run(overflowsSideways), false, 'the Sets page fits the phone width');
    // A set opens to its cards.
    await page.run(() => document.querySelector('.set-row').click());
    const tiles = await page.waitFor(() => document.querySelectorAll('.card-grid > *').length, { what: 'the cards of a set' });
    assert.ok(tiles > 0, `${tiles} card tiles`);
    // The game in the settings is the one asked for.
    assert.equal(await page.run(() => JSON.parse(localStorage.getItem('cardcodex.settings')).game), game);
  },
}));
