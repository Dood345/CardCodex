/** "Build a deck" and the Deck check: where the cards come from, a build in each game, the kept deck's check. */
import assert from 'node:assert/strict';
import { openApp, overflowsSideways } from './lib/app.mjs';

const chooseSource = (label) => {
  const chip = [...document.querySelectorAll('.advisor-choices .chip-row')][0] && [...document.querySelectorAll('.advisor-choices .chip-row')][0].querySelectorAll('.chip');
  const el = chip && [...chip].find((c) => c.textContent.trim() === label);
  if (!el) return false;
  el.click();
  return true;
};
const hint = () => document.querySelector('.advisor-source-hint')?.innerText ?? '';
const ideas = () => [...document.querySelectorAll('.build-ideas .chip')].map((b) => b.textContent.trim());

/** Press "Build the deck" (or "Build again") and wait for the result; returns what the result block says. */
async function build(page) {
  await page.run(() => [...document.querySelectorAll('button')].find((b) => /^Build (the deck|again)$/.test(b.textContent.trim())).click());
  // The result appears and the button is no longer "Building…". A Pokémon build plays practice games: give it time.
  await page.waitFor(() => !!document.querySelector('.build-result') && ![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Building…'), { timeout: 120_000, what: 'the built deck' });
  return page.run(() => {
    const text = document.querySelector('.build-result').innerText;
    const counts = /(\d+) cards · you own (\d+) · (\d+) missing/.exec(text);
    return {
      title: text.split('\n')[0],
      total: document.querySelector('.build-result .advisor-total')?.innerText ?? '',
      cards: counts ? Number(counts[1]) : -1,
      owned: counts ? Number(counts[2]) : -1,
      missing: counts ? Number(counts[3]) : -1,
      parts: document.querySelectorAll('.build-result .advisor-part').length,
      plan: document.querySelector('.build-result .advisor-plan')?.innerText ?? '',
      play: [...document.querySelectorAll('.build-result .advisor-play li')].map((e) => e.innerText),
    };
  });
}

export default [
  {
    name: 'Pokémon: the three card sources say what they do, and "Only my cards" builds from owned cards alone',
    async run({ page, base }) {
      await openApp(page, base, 'pokemon', '#/collection');
      // A small collection around Chesnaught V, the Grass Energy in two printings.
      await page.run(async () => {
        const col = await import('/src/data/collection.ts');
        const mine = [['swsh12-015', 2], ['sv08.5-002', 3], ['sv08.5-001', 3], ['sv03.5-127', 2], ['swsh1-165', 4], ['swsh1-161', 4], ['swsh1-164', 4], ['swsh2-167', 2], ['mee-001', 6], ['sve-009', 8]];
        for (const [id, qty] of mine) await col.setQty(id, qty);
        location.hash = '#/decks/build';
      });
      await page.waitFor(() => document.querySelectorAll('.advisor-choices .chip').length >= 3, { timeout: 60_000, what: 'the build page' });
      const hints = {};
      for (const label of ['Prefer my cards', 'Only my cards', 'Any card']) {
        assert.equal(await page.run(chooseSource, label), true, `the "${label}" chip`);
        await page.waitFor((l) => [...document.querySelectorAll('.advisor-choices .chip.active')].some((c) => c.textContent.trim() === l), { args: [label], what: `"${label}" to be selected` });
        hints[label] = await page.run(hint);
      }
      assert.match(hints['Prefer my cards'], /^Your cards first\./);
      assert.match(hints['Only my cards'], /^Only cards you own/);
      assert.match(hints['Any card'], /^Any card of the game/);
      assert.equal(await page.run(overflowsSideways), false);

      await page.run(chooseSource, 'Only my cards');
      const offered = await page.waitFor(() => {
        const list = [...document.querySelectorAll('.build-ideas .chip')].map((b) => b.textContent.trim());
        return list.includes('Chesnaught V') && list;
      }, { timeout: 60_000, what: 'the owned cards to be offered as a start' });
      assert.ok(offered.every((n) => ['Chesnaught V', 'Exeggutor', 'Pinsir', 'Exeggcute'].includes(n)), `only owned Pokémon are offered: ${offered.join(', ')}`);
      await page.run(() => [...document.querySelectorAll('.build-ideas .chip')].find((b) => b.textContent.trim() === 'Chesnaught V').click());
      const only = await build(page);
      assert.match(only.title, /Chesnaught V/);
      assert.equal(only.missing, 0, 'nothing in an "Only my cards" deck is missing from the collection');
      assert.equal(only.owned, only.cards);
      assert.ok(only.cards >= 30 && only.cards <= 38, `${only.cards} cards from a collection of 38`);
      assert.match(only.total, /^\d+\/100$/);
    },
  },
  ...[
    ['pokemon', 'Pokémon', 60, 9],
    ['ygo', 'Yu-Gi-Oh!', 40, 7],
    ['mtg', 'Magic', 60, 9],
  ].map(([game, label, least, parts]) => ({
    name: `${label}: a deck is built from an idea, kept, and its Deck check opens`,
    async run({ page, base }) {
      await openApp(page, base, game, '#/decks/build');
      await page.waitFor(() => document.querySelectorAll('.advisor-choices .chip').length >= 3, { timeout: 60_000, what: 'the build page' });
      await page.run(chooseSource, 'Any card');
      const start = await page.waitFor(() => document.querySelector('.build-ideas .chip')?.textContent.trim(), { timeout: 90_000, what: 'ideas to start from' });
      assert.ok((await page.run(ideas)).length >= 4);
      await page.run(() => document.querySelector('.build-ideas .chip').click());
      const built = await build(page);
      assert.ok(built.title.includes(start), `"${built.title}" is named for ${start}`);
      assert.ok(built.cards >= least, `${built.cards} cards`);
      assert.match(built.total, /^\d+\/100$/);
      assert.ok(built.parts >= parts, `${built.parts} score parts`);
      if (game === 'pokemon') {
        assert.match(built.plan, /^Plays toward .+\(.+\)$/);
        assert.ok(built.play.some((l) => /^Attacks by turn 3 in \d+% of games/.test(l)));
        assert.ok(built.play.some((l) => /damage a turn over the first 6 turns/.test(l)));
      } else {
        assert.equal(built.plan, '', 'only Pokémon decks are played');
      }
      assert.equal(await page.run(overflowsSideways), false);

      // Keep it: the deck page shows the same score in its Deck check.
      await page.run(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Keep this deck').click());
      await page.waitFor(() => /^#\/decks\/(?!build)/.test(location.hash) && !!document.querySelector('.advisor-head'), { what: 'the kept deck page' });
      await page.run(() => {
        const head = document.querySelector('.advisor-head');
        if (head.getAttribute('aria-expanded') !== 'true') head.click();
      });
      const check = await page.waitFor(() => document.querySelectorAll('.advisor .advisor-part').length && { total: document.querySelector('.advisor .advisor-total')?.innerText, parts: document.querySelectorAll('.advisor .advisor-part').length }, { timeout: 60_000, what: 'the Deck check' });
      assert.equal(check.total, built.total);
      assert.ok(check.parts >= parts);
      // A practice hand can be dealt.
      const dealt = await page.run(() => {
        const b = [...document.querySelectorAll('.advisor button')].find((x) => x.textContent.trim() === 'Draw a hand');
        if (!b) return -1;
        b.click();
        return 0;
      });
      assert.equal(dealt, 0, 'the "Draw a hand" button');
      const hand = await page.waitFor(() => document.querySelectorAll('.advisor .practice-card').length, { what: 'a practice hand' });
      assert.ok(hand >= 5, `${hand} cards in the opening hand`);
    },
  })),
];
