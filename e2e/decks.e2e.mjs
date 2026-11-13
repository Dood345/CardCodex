/** Deck pages: the copy-limit reminder, switching an old Special Energy printing to the basic one, the large card view. */
import assert from 'node:assert/strict';
import { openApp, overflowsSideways } from './lib/app.mjs';

/** Put a deck into the app's database and open its page. */
async function openDeck(page, deck) {
  await page.run(async (d) => {
    const { db } = await import('/src/data/db.ts');
    const now = Date.now();
    await db.decks.put({ ...d, createdAt: now, updatedAt: now });
    location.hash = `#/decks/${d.id}`;
  }, deck);
  await page.waitFor(() => document.querySelectorAll('.deck-card').length > 0, { what: 'the deck page' });
}

const texts = (selector) => [...document.querySelectorAll(selector)].map((e) => e.innerText.replace(/\s+/g, ' ').trim());

export default [
  {
    name: 'Pokémon: twelve old Special Darkness Energy are flagged and can be switched to basic Energy',
    async run({ page, base }) {
      await openApp(page, base, 'pokemon', '#/collection');
      // hgss3-79 is the Special "Darkness Energy" of Undaunted; the player owns the twelve they put in the deck.
      await page.run(async () => {
        const col = await import('/src/data/collection.ts');
        await col.setQty('hgss3-79', 12);
      });
      await openDeck(page, { id: 'e2e-twin', game: 'pokemon', name: 'Twin', cards: [{ cardId: 'base1-4', qty: 2 }, { cardId: 'hgss3-79', qty: 12 }, { cardId: 'base1-96', qty: 4 }] });
      assert.deepEqual(await page.run(texts, '.deck-limit'), ['4 copies at most: Darkness Energy ×12.']);
      const hint = (await page.run(texts, '.deck-twin .deck-hint'))[0];
      assert.match(hint, /These Darkness Energy are Special Energy \(Undaunted · 79\/90\), limited to 4\. Basic Energy of the same name has no limit\./);
      const rows = await page.run(texts, '.deck-card');
      assert.ok(rows.some((r) => /Darkness Energy.*Special Energy/.test(r)), 'the line says Special Energy');
      assert.ok(rows.some((r) => /Double Colorless Energy.*Special Energy/.test(r)));
      assert.equal(await page.run(overflowsSideways), false);

      await page.run(() => document.querySelector('.deck-twin button').click());
      const sheet = await page.waitFor(() => document.querySelector('.sheet, [role=dialog]')?.innerText, { what: 'the confirmation sheet' });
      assert.match(sheet, /Switch to Basic Energy\?/);
      assert.match(sheet, /Also move my 12 owned copies to that printing/);
      await page.run(() => [...document.querySelector('.sheet, [role=dialog]').querySelectorAll('button')].find((b) => b.innerText.trim() === 'Switch').click());
      await page.waitFor(() => !document.querySelector('.deck-limit'), { what: 'the reminder to go away' });
      const after = await page.run(async () => {
        const { db } = await import('/src/data/db.ts');
        return { cards: (await db.decks.get('e2e-twin')).cards, owned: (await db.collection.toArray()).map((e) => [e.cardId, e.qty]) };
      });
      const energy = after.cards.find((c) => c.qty === 12);
      assert.ok(energy && energy.cardId !== 'hgss3-79', 'the twelve copies are another printing now');
      assert.deepEqual(after.owned, [[energy.cardId, 12]], 'the owned copies moved with them');
      assert.ok((await page.run(texts, '.deck-card')).some((r) => /Darkness Energy.*Basic Energy/.test(r)));
    },
  },
  {
    name: 'Pokémon: eleven basic and one old Special Darkness Energy are not flagged',
    async run({ page, base }) {
      await openApp(page, base, 'pokemon', '#/collection');
      await openDeck(page, { id: 'e2e-mixed', game: 'pokemon', name: 'Mixed', cards: [{ cardId: 'swsh12.5-158', qty: 11 }, { cardId: 'hgss3-79', qty: 1 }] });
      assert.deepEqual(await page.run(texts, '.deck-limit'), []);
      assert.deepEqual(await page.run(texts, '.deck-twin'), []);
    },
  },
  ...[
    ['ygo', 'Yu-Gi-Oh!'],
    ['mtg', 'Magic'],
  ].map(([game, label]) => ({
    name: `${label}: six copies of a card bring up the copy reminder, and no Energy talk`,
    async run({ page, base }) {
      await openApp(page, base, game, '#/collection');
      const ids = await page.run(async (g) => {
        const { loadCatalog } = await import('/src/data/catalog.ts');
        const index = await loadCatalog(g);
        // Two cards with a picture and different names, from the first set that has them.
        const seen = new Set();
        const out = [];
        for (const c of index.catalog.cards) {
          if (seen.has(c.name) || (g === 'mtg' && /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(c.name))) continue;
          if (g === 'mtg' && c.cat === 'Land') continue;
          seen.add(c.name);
          out.push(c.id);
          if (out.length === 2) break;
        }
        return out;
      }, game);
      assert.equal(ids.length, 2);
      await openDeck(page, { id: 'e2e-limit', game, name: 'Limit', cards: [{ cardId: ids[0], qty: 6 }, { cardId: ids[1], qty: 1 }] });
      const limit = await page.run(texts, '.deck-limit');
      assert.equal(limit.length, 1);
      assert.match(limit[0], /cop(?:y|ies) at most: .+ ×6\./);
      assert.deepEqual(await page.run(texts, '.deck-twin'), [], 'no printing switch outside Pokémon');
      assert.ok(!(await page.run(texts, '.deck-card')).some((r) => /Basic Energy|Special Energy/.test(r)));
      assert.equal(await page.run(overflowsSideways), false);
    },
  })),
  {
    name: 'Pokémon: a deck line opens the large card view, and the stepper does not',
    async run({ page, base }) {
      await openApp(page, base, 'pokemon', '#/collection');
      await openDeck(page, { id: 'e2e-zoom', game: 'pokemon', name: 'Zoom', cards: [{ cardId: 'base1-4', qty: 2 }, { cardId: 'base1-96', qty: 1 }] });
      await page.run(() => document.querySelector('.deck-card .stepper-btn[aria-label^="Add one"]').click());
      await page.waitFor(() => document.querySelector('.deck-card .stepper-value')?.innerText.trim() === '3', { what: 'the count to go up' });
      assert.equal(await page.run(() => !!document.querySelector('.card-zoom')), false, 'the stepper leaves the large view closed');
      await page.run(() => document.querySelector('.deck-card .deck-thumb').click());
      const zoom = await page.waitFor(() => {
        const z = document.querySelector('.card-zoom');
        const a = z?.querySelector('.card-zoom-art')?.getBoundingClientRect();
        const c = z?.querySelector('.card-zoom-actions')?.getBoundingClientRect();
        return z && a && c ? { name: z.querySelector('.card-zoom-name')?.innerText, fits: a.top >= 0 && c.bottom <= innerHeight, link: z.querySelector('.card-zoom-actions a')?.getAttribute('href') } : null;
      }, { what: 'the large card view' });
      assert.equal(zoom.name, 'Charizard');
      assert.equal(zoom.fits, true, 'the picture and its buttons fit the screen');
      assert.match(zoom.link, /#\/card\/base1-4$/);
      // Escape closes it; the text of a line opens it too; "Card page" goes to the card.
      await page.run(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
      await page.waitFor(() => !document.querySelector('.card-zoom'), { what: 'Escape to close the view' });
      await page.run(() => document.querySelectorAll('.deck-card')[1].querySelector('.cand-body').click());
      await page.waitFor(() => document.querySelector('.card-zoom .card-zoom-name')?.innerText === 'Double Colorless Energy', { what: 'the second card in the large view' });
      await page.run(() => document.querySelector('.card-zoom-actions a').click());
      await page.waitFor(() => location.hash === '#/card/base1-96' && !document.querySelector('.card-zoom'), { what: 'the card page' });
    },
  },
];
