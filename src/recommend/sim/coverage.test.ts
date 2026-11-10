/**
 * The coverage measure: a card counts as followed only when every sentence of
 * its text is read into an effect the engine applies or is on the explicit
 * no-op list. Cards are named by catalog id and the assertions are on what
 * the shipped text says.
 */
import { describe, expect, it } from 'vitest';
import { compileDeck } from './cards';
import { coverageOfDecks, coverageOfPool, formatCoverage, kindOf } from './coverage';
import { NOOP, parseAbility, parseText, splitSentences } from './effects';
import { CHARIZARD, deck, loadEvaluator } from './fixtures';

const { ev, index } = loadEvaluator();

/** The compiled card of one printing. */
function one(id: string) {
  const d = compileDeck(ev, [{ cardId: id, qty: 1 }]);
  expect(d.cards.length, id).toBe(1);
  return d.cards[0];
}

describe('sentence accounting', () => {
  it('splits a text into sentences, keeping abbreviations and parentheses together', () => {
    expect(splitSentences('Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.').map((s) => s.text)).toEqual([
      'Search your deck for a Pokémon, reveal it, and put it into your hand.',
      'Then, shuffle your deck.',
    ]);
    expect(splitSentences('Search your deck for a Pokémon that doesn\'t have a Rule Box. (Pokémon ex, Pokémon V, etc. have Rule Boxes.)').map((s) => s.text)).toEqual([
      "Search your deck for a Pokémon that doesn't have a Rule Box.",
      '(Pokémon ex, Pokémon V, etc. have Rule Boxes.)',
    ]);
    expect(splitSentences('Put Mr. Mime into your hand. Draw a card.').length).toBe(2);
  });

  it('counts Ultra Ball, Nest Ball, Poffin and Arven as followed: cost, search and the shuffle reminder', () => {
    for (const id of ['sv04.5-091', 'sv04.5-084', 'sv08.5-101', 'sv04.5-235']) {
      const c = one(id);
      expect(c.fx?.followed, c.name).toBe(true);
      expect(c.fx?.sentences.map((s) => s.status), c.name).not.toContain('unread');
    }
    const ball = one('sv04.5-091').fx!;
    expect(ball.sentences.map((s) => [s.status, s.why])).toEqual([
      ['read', ''],
      ['read', ''],
      ['noop', 'a search already shuffles the deck'],
    ]);
  });

  it('does not count a card whose search is wider than the text, or whose draw has a clause the pilot skips', () => {
    // Poké Pad: "a Pokémon that doesn't have a Rule Box". The pilot searches for any Pokémon.
    const pad = one('me03-081');
    expect(pad.fx?.effects[0]).toMatchObject({ k: 'search', f: { k: 'pokemon', vague: "that doesn't have Rule Box" } });
    expect(pad.fx?.followed).toBe(false);
    expect(kindOf(pad.fx!)).toBe('search wider than "that doesn\'t have Rule Box"');
    // Lillie's Determination: "If you have exactly 6 Prize cards remaining, draw 8 cards instead."
    const lillie = one('me01-119');
    expect(lillie.fx?.effects).toEqual([{ k: 'shuffleHandDraw', n: 6, bottom: false }]);
    expect(lillie.fx?.followed).toBe(false);
    expect(kindOf(lillie.fx!)).toBe('"instead"');
    // Iono: both players shuffle; the pilot only resolves its own side.
    const iono = one('sv04.5-080');
    expect(iono.fx?.effects[0]).toMatchObject({ k: 'shuffleHandDraw', n: -1 });
    expect(iono.fx?.followed).toBe(false);
    expect(iono.fx?.sentences.every((s) => s.status === 'unread')).toBe(true);
    expect(iono.fx?.sentences[0].why).toBe('the opponent');
  });

  it('counts an unread Trainer by the kind of its first unread sentence', () => {
    expect(one('sv02-172').unread).toBe('gust');
    expect(kindOf(one('sv02-172').fx!)).toBe('gust');
    expect(kindOf(one('sv06.5-061').fx!)).toBe('recovery from the discard pile');
    // Crushing Hammer: "If heads, discard an Energy from 1 of your opponent's Pokémon."
    expect(kindOf(one('me03-071').fx!)).toBe('coin flips');
    expect(kindOf(one('me04-082').fx!)).toBe('"only if"');
    expect(kindOf(one('sv10.5b-079').fx!)).toBe('Retreat Cost');
  });

  it('honours Ability triggers and limits outside the body, and reads the body like a Trainer', () => {
    const kanga = one('me01-104').abilities.find((a) => a.name === 'Run Errand')!;
    expect(kanga).toMatchObject({ trigger: 'turn', activeOnly: true, limitName: 'Run Errand' });
    expect(kanga.fx.effects).toEqual([{ k: 'draw', n: 2 }]);
    expect(kanga.fx.followed).toBe(true);
    const meowth = one('me03-062').abilities.find((a) => a.name === 'Last-Ditch Catch')!;
    expect(meowth.trigger).toBe('bench');
    expect(meowth.fx.followed).toBe(true);
    // Teal Dance: "If you attached Energy to a Pokémon in this way, draw a card." is a condition the engine does not check.
    const ogerpon = one('sv06-025').abilities[0];
    expect(ogerpon.fx.effects.map((e) => e.k)).toEqual(['attach', 'draw']);
    expect(ogerpon.fx.followed).toBe(false);
    expect(ogerpon.fx.sentences[1]).toMatchObject({ status: 'unread', why: 'condition' });
    // A passive Ability is never used, so nothing of it is followed.
    expect(parseAbility('Ability', 'Skyliner', 'Your Basic Pokémon in play have no Retreat Cost.').fx.followed).toBe(false);
  });

  it('counts an attack with no text, or with only the rest the engine honours, as acted on', () => {
    const umbreon = one('sv03-130').attacks.find((a) => a.name === 'Pitch-Black Blade')!;
    expect(umbreon.rest).toBe(1);
    expect(umbreon.fx?.followed).toBe(true);
    const dreepy = one('sv06-128');
    for (const a of dreepy.attacks) expect(a.fx, a.name).toBeNull();
    // Mist Energy: "Prevent all effects of attacks …" is not followed; only what it provides is read.
    const mist = one('sv05-161');
    expect(mist.fx?.sentences[0].status).toBe('read');
    expect(mist.fx?.followed).toBe(false);
    // Phantom Dive puts damage counters on the Bench: unread until duels model it.
    const dragapult = one('sv06-130').attacks.find((a) => a.name === 'Phantom Dive')!;
    expect(dragapult.fx?.followed).toBe(false);
    expect(kindOf(dragapult.fx!)).toBe('hits the Bench');
  });

  it('keeps the no-op list explicit, with a reason for every entry', () => {
    for (const [, why] of NOOP) expect(why.length).toBeGreaterThan(8);
    expect(parseText('Draw 2 cards. Then, shuffle your deck.').sentences[1]).toMatchObject({ status: 'noop' });
    expect(parseText('Flip a coin. If heads, draw 3 cards.').followed).toBe(true);
    expect(parseText('Flip a coin. If heads, draw 3 cards. If tails, draw 1 card.').followed).toBe(false);
  });
});

describe('coverage over decks and pools', () => {
  it('measures the Charizard ex fixture', () => {
    const cov = coverageOfDecks(ev, [deck(CHARIZARD)]);
    const by = Object.fromEntries(cov.map((m) => [m.id, m]));
    expect(by.trainers.copies).toBe(38);
    expect(by.trainers.followed).toBeGreaterThan(15);
    expect(by.trainers.followed).toBeLessThan(by.trainers.copies);
    expect(by.trainers.groups.find((g) => g.kind === 'gust')?.examples).toContain("Boss's Orders");
    expect(by.abilities.copies).toBe(10);
    expect(by.energy.copies).toBe(0);
    expect(by.energy.share).toBe(1);
    expect(by.attacks.copies).toBeGreaterThan(10);
    for (const m of cov) {
      expect(m.share).toBeCloseTo(m.copies ? m.followed / m.copies : 1, 6);
      expect(m.groups.reduce((n, g) => n + g.copies, 0)).toBe(m.copies - m.followed);
    }
    const text = formatCoverage(cov);
    expect(text).toMatch(/\| Trainer copies played with every sentence followed \| 38 \|/);
    expect(text).toMatch(/gust: \d+ .*Boss's Orders/);
  });

  it('measures a pool one printing per name', () => {
    const pool = index.catalog.cards.filter((c) => c.set === 'sv04.5');
    const cov = coverageOfPool(ev, pool);
    const names = new Set(pool.map((c) => c.name));
    const trainers = cov.find((m) => m.id === 'trainers')!;
    expect(trainers.copies).toBe([...names].filter((n) => pool.find((c) => c.name === n)!.cat === 'Trainer').length);
    expect(trainers.followed).toBeGreaterThan(0);
  });
});
