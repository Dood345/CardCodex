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
    // Tera Orb: "a Tera Pokémon". The pilot searches for any Pokémon, and says so.
    const orb = one(index.cardsByName.get('tera orb')![0].id);
    expect(orb.fx?.effects[0]).toMatchObject({ k: 'search', f: { k: 'pokemon', vague: 'Tera' } });
    expect(orb.fx?.followed).toBe(false);
    expect(kindOf(orb.fx!)).toBe('search wider than "Tera"');
    // Lillie's Determination: "If you have exactly 6 Prize cards remaining, draw 8 cards instead." is an alternative.
    const lillie = one('me01-119');
    expect(lillie.fx?.effects).toEqual([{ k: 'shuffleHandDraw', n: 6, bottom: false, alt: { if: { k: 'prizes', side: 'self', exactly: [6] }, n: 8 } }]);
    expect(lillie.fx?.followed).toBe(true);
    // Iono: both players shuffle; in a duel the engine resolves both sides, so every sentence is read.
    const iono = one('sv04.5-080');
    expect(iono.fx?.effects[0]).toMatchObject({ k: 'shuffleHandDraw', n: -1, both: true });
    expect(iono.fx?.followed).toBe(true);
    // Academy at Night: a card from the hand on top of the deck is a wording the pilot does not read.
    const academy = one(index.cardsByName.get('academy at night')![0].id);
    expect(academy.fx?.followed).toBe(false);
    expect(academy.unread).toBe('other');
  });

  it('counts an unread Trainer by the kind of its first unread sentence', () => {
    expect(one('sv02-172').unread).toBe('');
    expect(kindOf(one('sv02-172').fx!)).toBe('followed');
    // Pokémon Catcher: one coin, then a gust on heads; Crushing Hammer: one coin, then an Energy off one of the opponent's Pokémon.
    expect(one('sv01-187').fx).toMatchObject({ chance: 0.5, effects: [{ k: 'gust', by: 'you' }], followed: true });
    expect(one('me03-071').fx).toMatchObject({ chance: 0.5, effects: [{ k: 'discardOppEnergy', n: 1, from: 'any' }], followed: true });
    // Delivery Drone: two coins are not read.
    expect(kindOf(one('sv02-178').fx!)).toBe('coin flips');
    // Special Red Card: its "only if" and what the opponent does with their hand are both read.
    expect(one('me04-082').fx).toMatchObject({ cond: { k: 'prizes', side: 'opponent', max: 3 }, effects: [{ k: 'oppHandBottomDraw', n: 3 }], followed: true });
    // Gravity Gemstone: "the Retreat Cost of both Active Pokémon is 1 more" while the holder is Active.
    expect(kindOf(one(index.cardsByName.get('gravity gemstone')![0].id).fx!)).toBe('Retreat Cost');
  });

  it('honours Ability triggers and limits outside the body, and reads the body like a Trainer', () => {
    const kanga = one('me01-104').abilities.find((a) => a.name === 'Run Errand')!;
    expect(kanga).toMatchObject({ trigger: 'turn', activeOnly: true, limitName: 'Run Errand' });
    expect(kanga.fx.effects).toEqual([{ k: 'draw', n: 2 }]);
    expect(kanga.fx.followed).toBe(true);
    const meowth = one('me03-062').abilities.find((a) => a.name === 'Last-Ditch Catch')!;
    expect(meowth.trigger).toBe('bench');
    expect(meowth.fx.followed).toBe(true);
    // Teal Dance: "If you attached Energy to a Pokémon in this way, draw a card." hangs on the attachment having happened.
    const ogerpon = one('sv06-025').abilities[0];
    expect(ogerpon.fx.effects).toMatchObject([{ k: 'attach' }, { k: 'draw', n: 1, if: { k: 'did' } }]);
    expect(ogerpon.fx.followed).toBe(true);
    // A passive Ability is a standing effect: Skyliner takes the Retreat Cost off the player's Basic Pokémon.
    const sky = parseAbility('Ability', 'Skyliner', 'Your Basic Pokémon in play have no Retreat Cost.').fx;
    expect(sky.statics).toEqual([{ k: 'retreat', delta: -99, t: { basic: true }, scope: 'own' }]);
    expect(sky.followed).toBe(true);
    expect(parseAbility('Ability', 'Rough Skin', 'If this Pokémon is damaged by an attack, put 2 damage counters on the Attacking Pokémon.').fx.followed).toBe(false);
  });

  it('counts an attack with no text, or with only the rest the engine honours, as acted on', () => {
    const umbreon = one('sv03-130').attacks.find((a) => a.name === 'Pitch-Black Blade')!;
    expect(umbreon.rest).toBe(1);
    expect(umbreon.fx?.followed).toBe(true);
    const dreepy = one('sv06-128');
    for (const a of dreepy.attacks) expect(a.fx, a.name).toBeNull();
    // Mist Energy: what it provides and "Prevent all effects of attacks …" are both read.
    const mist = one('sv05-161');
    expect(mist.fx?.sentences[0].status).toBe('read');
    expect(mist.fx?.followed).toBe(true);
    // Phantom Dive puts damage counters on the opponent's Bench: read, applied in duels.
    const dragapult = one('sv06-130').attacks.find((a) => a.name === 'Phantom Dive')!;
    expect(dragapult.fx?.followed).toBe(true);
    expect(dragapult.fx?.effects).toEqual([{ k: 'benchDamage', n: 6, how: 'counters' }]);
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
    expect(by.trainers.groups.find((g) => g.kind === 'gust')).toBeUndefined();
    expect(by.trainers.followed).toBeGreaterThanOrEqual(30);
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
    expect(text).not.toMatch(/Boss's Orders/);
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
