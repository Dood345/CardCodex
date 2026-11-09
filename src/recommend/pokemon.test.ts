/**
 * The Pokémon evaluator and the builder on the real catalog and card text.
 * The deck under test is assembled here from the catalog for the test's sake:
 * a Charizard ex line with Pidgeot ex for search, draw Supporters, Items to
 * find Pokémon, and Fire Energy. Nothing here ships to the app.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { CollectionMap } from '@/data/collection';
import type { DeckCard } from '@/data/db';
import { withQty } from '@/data/decks';
import type { Catalog, SpeciesFile } from '@/data/types';
import { POKEMON_DECK_RULES } from '@/games/deck-rules';
import { buildDeck, contributions, suggestAdds, suggestSwaps } from './builder';
import { buildTextIndex, type CardTextFile } from './card-text';
import { BW_ACE_SPEC_SETS, createPokemonEvaluator, energyCredit, mulliganChance, parseEnergyText, STADIUM_CREDIT } from './pokemon';
import type { BuildOptions, Move } from './types';

const dataDir = new URL('../../public/data/', import.meta.url);
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8')) as T;
const index = buildIndex(read<Catalog>('catalog.json'), read<SpeciesFile>('species.json').species);
const text = buildTextIndex(read<CardTextFile>('text.json'));
const ev = createPokemonEvaluator({ index, text });

const deck = (lines: [string, number][]): DeckCard[] => lines.map(([cardId, qty]) => ({ cardId, qty }));

const CHARIZARD: [string, number][] = [
  ['sv04.5-007', 3], // Charmander
  ['sv04.5-008', 1], // Charmeleon
  ['sv04.5-054', 3], // Charizard ex
  ['sv04.5-196', 2], // Pidgey
  ['sv04.5-221', 2], // Pidgeot ex
  ['swsh12.5-045', 1], // Rotom V
  ['swsh12.5gg-GG39', 1], // Lumineon V
  ['swsh12.5-020', 1], // Radiant Charizard
  ['swsh12.5gg-GG06', 1], // Manaphy
  ['sv07-098', 1], // Jirachi
  ['sv04.5-089', 4], // Rare Candy
  ['sv04.5-091', 4], // Ultra Ball
  ['sv04.5-084', 4], // Nest Ball
  ['sv08.5-101', 3], // Buddy-Buddy Poffin
  ['sv04.5-235', 4], // Arven
  ['sv04.5-080', 4], // Iono
  ['sv02-172', 3], // Boss's Orders
  ['sv10.5b-085', 2], // Professor's Research
  ['sv04-160', 1], // Counter Catcher
  ['sv02-188', 1], // Super Rod
  ['swsh12.5-135', 1], // Lost Vacuum
  ['sv03.5-206', 1], // Switch
  ['sv01-169', 1], // Defiance Band
  ['swsh12-156', 1], // Forest Seal Stone
  ['sv04-178', 1], // Technical Machine: Evolution
  ['swsh9-144', 1], // Magma Basin
  ['sv01-187', 1], // Pokémon Catcher
  ['sv10.5w-082', 1], // Energy Retrieval
  ['sve-002', 6], // Fire Energy
];

const options: BuildOptions = { source: 'catalog', collection: new Map(), format: 'any' };
const partOf = (cards: DeckCard[], id: string) => ev.score(cards).parts.find((p) => p.id === id)!;

describe('mulliganChance', () => {
  it('is the hypergeometric chance of no Basic in seven cards', () => {
    expect(mulliganChance(60, 10)).toBeCloseTo(0.259, 2);
    expect(mulliganChance(60, 0)).toBe(1);
    expect(mulliganChance(60, 60)).toBe(0);
  });
});

describe('Pokémon evaluator', () => {
  const cards = deck(CHARIZARD);

  it('has every test card in the catalog with text', () => {
    for (const [id] of CHARIZARD) {
      expect(index.cardsById.get(id), id).toBeDefined();
      expect(text.byId.get(id), id).toBeDefined();
    }
    expect(cards.reduce((n, c) => n + c.qty, 0)).toBe(60);
  });

  it('scores a coherent deck well above a random pile of 60 legal cards', () => {
    const good = ev.score(cards);
    expect(good.issues).toEqual([]);
    expect(good.total).toBeGreaterThan(75);
    // A seeded pseudo-random pile of distinct cards.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const all = index.catalog.cards;
    const pile: DeckCard[] = [];
    while (pile.length < 60) {
      const c = all[Math.floor(rnd() * all.length)];
      if (!pile.some((p) => p.cardId === c.id)) pile.push({ cardId: c.id, qty: 1 });
    }
    const bad = ev.score(pile);
    expect(bad.total).toBeLessThan(good.total - 25);
  });

  it('scores the test deck the same from run to run', () => {
    // Pinned so that a change to any part shows up here. 90.3 until the Energy amount and the attacker copies
    // were calibrated against the playtest simulator (six Energy read as fewer than fit, and so they are).
    expect(ev.score(cards).total).toBe(89.3);
  });

  it('explains each part in one line', () => {
    const s = ev.score(cards);
    expect(s.parts.map((p) => p.id)).toEqual(['rules', 'basics', 'lines', 'energy', 'draw', 'power', 'synergy', 'focus', 'era']);
    expect(s.parts.reduce((n, p) => n + p.weight, 0)).toBe(100);
    for (const p of s.parts) expect(p.detail.length).toBeGreaterThan(0);
    expect(partOf(cards, 'basics').detail).toMatch(/^10 Basic Pokémon: 2\d% chance/);
    expect(partOf(cards, 'era').detail).toMatch(/^Cards from 202\d–202\d$/);
    expect(partOf([...cards, { cardId: 'base1-91', qty: 1 }], 'era').detail).toContain('out of era: Bill');
    expect(partOf(cards, 'lines').score).toBe(1);
    expect(partOf(cards, 'power').detail).toContain('Charizard ex');
  });

  it('notices a missing pre-evolution unless Rare Candy bridges it', () => {
    const noCharmander = cards.filter((c) => c.cardId !== 'sv04.5-007');
    const lines = partOf(noCharmander, 'lines');
    expect(lines.score).toBeLessThan(1);
    expect(lines.detail).toContain('Charmeleon');
    // Without the Stage 1 the Stage 2 still stands on Rare Candy and the Basic.
    const noCharmeleon = cards.filter((c) => c.cardId !== 'sv04.5-008');
    expect(partOf(noCharmeleon, 'lines').score).toBe(1);
    const noCandyNoCharmeleon = noCharmeleon.filter((c) => c.cardId !== 'sv04.5-089');
    expect(partOf(noCandyNoCharmeleon, 'lines').detail).toContain('Charizard ex');
  });

  it('wants Energy of the attackers’ type', () => {
    const noFire = cards.filter((c) => c.cardId !== 'sve-002');
    const e = partOf(noFire, 'energy');
    expect(e.score).toBeLessThan(partOf(cards, 'energy').score);
    expect(e.detail).toMatch(/no Energy for Fire/);
    const water = [...noFire, { cardId: 'sve-003', qty: 6 }];
    expect(partOf(water, 'energy').detail).toMatch(/no Energy for Fire/);
  });

  it('flags conditional Trainers the deck cannot use', () => {
    // Magma Basin wants Fire Pokémon: fine here, dead in a Water deck.
    expect(partOf(cards, 'synergy').score).toBe(1);
    const waterDeck = deck([
      ['swsh12.5gg-GG06', 4], // Manaphy
      ['swsh9-144', 2], // Magma Basin
      ['sve-003', 10],
    ]);
    const s = partOf(waterDeck, 'synergy');
    expect(s.score).toBe(0);
    expect(s.detail).toContain('Magma Basin');
  });

  it('reports rule problems as issues', () => {
    const s = ev.score([...cards, { cardId: 'sv02-172', qty: 2 }]);
    expect(s.issues).toContain("Boss's Orders: 5 copies, 4 at most");
    expect(s.issues).toContain('2 cards over 60');
  });

  it('scores the mulligan odds, not the count', () => {
    const fewBasics = deck([
      ['sv04.5-054', 4],
      ['sv04.5-007', 2],
      ['sve-002', 54],
    ]);
    expect(partOf(fewBasics, 'basics').score).toBeLessThan(0.3);
  });
});

describe('builder', () => {
  const cards = deck(CHARIZARD);
  const pool = ev.pool(options);

  it('builds a pool of one printing per name', () => {
    const names = new Set(pool.map((c) => c.name));
    expect(names.size).toBe(pool.length);
    expect(pool.length).toBeGreaterThan(3500);
  });

  it('suggests the missing Basic for a line, with the reason', () => {
    const noCharmander = cards.filter((c) => c.cardId !== 'sv04.5-007');
    const adds = suggestAdds(ev, noCharmander, { ...options, limit: 5 }, pool);
    expect(adds.length).toBeGreaterThan(0);
    const charmander = adds.find((s) => s.move.add.some((c) => c.name === 'Charmander'));
    expect(charmander).toBeDefined();
    expect(charmander!.delta).toBeGreaterThan(0);
    expect(charmander!.partId).toBe('lines');
  });

  it('brings the earlier stages along when it suggests an evolution', () => {
    const start = deck([['sve-002', 4]]);
    const charizard = pool.find((c) => c.name === 'Charizard ex')!;
    const req = ev.requirements(charizard, start, pool);
    expect(req.map((c) => c.name)).toEqual(['Charmeleon', 'Charmander']);
  });

  it('ranks the weakest cards by what they carry', () => {
    const c = contributions(ev, cards, pool);
    expect(c.length).toBe(CHARIZARD.length);
    expect(c[0].loss).toBeLessThan(c[c.length - 1].loss);
    // A spare copy costs little; the main attacker is not dispensable.
    expect(c[0].loss).toBeLessThan(0.5);
    expect(c.slice(-5).map((x) => x.card.name)).toEqual(expect.arrayContaining(['Charizard ex']));
  });

  it('finds swaps that raise the score of a weakened deck', () => {
    // Trade the Fire Energy for Water: the swaps should bring Fire back.
    const broken = [...cards.filter((c) => c.cardId !== 'sve-002'), { cardId: 'sve-003', qty: 6 }];
    const swaps = suggestSwaps(ev, broken, { ...options, limit: 3 }, pool);
    expect(swaps.length).toBeGreaterThan(0);
    expect(swaps[0].delta).toBeGreaterThan(0);
    // Fire Energy, or a Special Energy that provides Fire to these Pokémon (Legacy Energy provides every type).
    expect(swaps.some((s) => s.move.add.some((c) => c.name === 'Fire Energy' || ev.features(c).energy?.base === '*'))).toBe(true);
  });

  it('builds a legal 60-card deck of one era around a seed', { timeout: 60000 }, () => {
    const t0 = performance.now();
    const built = buildDeck(ev, ['sv04.5-054'], { ...options, breadth: 80 }, pool);
    const ms = performance.now() - t0;
    const total = built.cards.reduce((n, c) => n + c.qty, 0);
    expect(total).toBe(60);
    expect(built.score.issues).toEqual([]);
    const names = new Set(built.cards.map((c) => index.cardsById.get(c.cardId)?.name));
    expect(names.has('Charizard ex')).toBe(true);
    expect(names.has('Charmander')).toBe(true);
    expect(names.has('Fire Energy')).toBe(true);
    expect(built.score.total).toBeGreaterThan(80);
    expect(built.steps.length).toBeGreaterThan(10);
    expect(built.score.parts.find((p) => p.id === 'basics')!.score).toBeGreaterThan(0.5);
    expect(built.score.parts.find((p) => p.id === 'era')!.score).toBeGreaterThan(0.8);
    expect(ms, `build took ${Math.round(ms)} ms`).toBeLessThan(10000);
  });

  it('keeps to the collection when that is the source', { timeout: 60000 }, () => {
    const collection: CollectionMap = new Map();
    for (const [id, qty] of CHARIZARD) collection.set(id, { cardId: id, qty, wanted: 0, addedAt: 0, updatedAt: 0 });
    const owned = { ...options, source: 'collection' as const, collection };
    const ownedPool = ev.pool(owned);
    expect(ownedPool.length).toBe(CHARIZARD.length);
    const built = buildDeck(ev, ['sv04.5-054'], owned, ownedPool);
    for (const c of built.cards) expect(c.qty, c.cardId).toBeLessThanOrEqual(collection.get(c.cardId)!.qty);
    expect(built.cards.reduce((n, c) => n + c.qty, 0)).toBe(60);
  });
});

/* ---------- once-per-deck limits, Special Energy, Stadiums ---------- */

const card = (id: string) => ev.card(id)!;
const feat = (id: string) => ev.features(card(id));
/** The Charizard deck with its Fire Energy replaced by `extra`, topped up with Fire Energy to stay at 60 cards. */
function withExtra(extra: [string, number][], drop: string[] = []): DeckCard[] {
  const base = CHARIZARD.filter(([id]) => id !== 'sve-002' && !drop.includes(id));
  const lines: [string, number][] = [...base, ...extra];
  const n = lines.reduce((s, [, q]) => s + q, 0);
  return deck([...lines, ['sve-002', 60 - n]]);
}
const applyMove = (cards: DeckCard[], move: Move): DeckCard[] => {
  let out = [...cards];
  for (const c of move.remove) {
    const l = out.find((x) => x.cardId === c.id && !x.zone);
    if (l) out = withQty(out, c.id, Math.max(0, l.qty - 1));
  }
  for (const c of move.add) out = withQty(out, c.id, (out.find((x) => x.cardId === c.id && !x.zone)?.qty ?? 0) + 1);
  return out;
};
const countOf = (cards: DeckCard[], ids: Set<string>) => cards.reduce((n, c) => n + (ids.has(c.cardId) ? c.qty : 0), 0);

describe('limits as data', () => {
  const members = (group: string) => index.catalog.cards.filter((c) => feat(c.id).groups.includes(group));

  it('recognises ACE SPEC cards by rarity and, for Black & White, by set, type and rarity', () => {
    const ace = members('ace-spec');
    const byRarity = ace.filter((c) => c.rarity === 'ACE SPEC Rare');
    expect(byRarity.length).toBe(33);
    expect(new Set(byRarity.map((c) => c.set))).toEqual(new Set(['sv05', 'sv06', 'sv06.5', 'sv07', 'sv08', 'sv08.5']));
    const bw = ace.filter((c) => c.rarity !== 'ACE SPEC Rare');
    expect(bw.length).toBe(13);
    expect(new Set(bw.map((c) => c.set))).toEqual(new Set(BW_ACE_SPEC_SETS));
    expect(bw.every((c) => c.cat === 'Trainer' && c.rarity === 'Rare')).toBe(true);
    // Special Energy and Stadiums can be ACE SPEC too.
    expect(['sv05-162', 'sv07-136'].every((id) => feat(id).groups.includes('ace-spec'))).toBe(true);
    // Not ACE SPEC: the old Master Ball prints, Dragon Vault's Rare Items, the Rare Supporter Ghetsis.
    for (const id of ['gym2-116', 'ecard1-143', 'dv1-20', 'dv1-18', 'bw9-101']) expect(feat(id).groups, id).toEqual([]);
    // The same card as a BW "Rare" and an SV "ACE SPEC Rare" is recognised both ways.
    expect(feat('bw8-129').groups).toEqual(['ace-spec']);
    expect(feat('sv08-186').groups).toEqual(['ace-spec']);
  });

  it('recognises Radiant Pokémon by name, the promo included', () => {
    const radiant = members('radiant');
    expect(radiant.length).toBe(16);
    expect(radiant.every((c) => c.cat === 'Pokemon' && c.name.startsWith('Radiant '))).toBe(true);
    expect(feat('swshp-SWSH230').groups).toEqual(['radiant']); // Radiant Eevee, rated Ultra Rare
    expect(feat('sm5-89').groups).toEqual([]); // Solgaleo ◇: its attack is called "Radiant Star"
  });

  it('limits Prism Star cards and a card whose text states a limit to one copy of the name', () => {
    const limited = index.catalog.cards.filter((c) => feat(c.id).nameMax !== Infinity);
    expect(limited.length).toBe(28);
    expect(limited.filter((c) => c.name.includes('◇')).length).toBe(27);
    expect(limited.find((c) => !c.name.includes('◇'))!.name).toBe('Miracle Energy');
    expect(feat('neo4-16').nameMax).toBe(1);
    // Prism Energy is not a Prism Star card.
    expect(feat('bw4-93').nameMax).toBe(Infinity);
    expect(ev.rules.copyLimit(card('sm5-62'))).toBe(1);
    expect(ev.rules.copyLimit(card('sv02-172'))).toBe(4);
    // The deck page's rules are untouched.
    expect(POKEMON_DECK_RULES.copyLimit(card('sm5-62'))).toBe(4);
  });

  it('names a broken ACE SPEC limit in one line, whatever the card names', () => {
    expect(ev.score(withExtra([['sv05-157', 1]])).issues).toEqual([]);
    const two = withExtra([
      ['sv05-157', 1],
      ['sv05-153', 1],
    ]);
    expect(ev.score(two).issues).toEqual(['ACE SPEC: 2 in the deck (Prime Catcher, Master Ball), 1 at most']);
    // A Black & White ACE SPEC counts against a Scarlet & Violet one.
    expect(
      ev.score(
        withExtra([
          ['sv05-157', 1],
          ['bw7-137', 1],
        ]),
      ).issues,
    ).toEqual(['ACE SPEC: 2 in the deck (Prime Catcher, Computer Search), 1 at most']);
    // Two copies of one ACE SPEC break it too, and so do two printings.
    expect(ev.score(withExtra([['sv05-157', 2]])).issues).toEqual(['ACE SPEC: 2 in the deck (Prime Catcher), 1 at most']);
    expect(
      ev.score(
        withExtra([
          ['sv08-186', 1],
          ['bw8-129', 1],
        ]),
      ).issues,
    ).toEqual(['ACE SPEC: 2 in the deck (Scramble Switch), 1 at most']);
    const ok = partOf(withExtra([['sv05-157', 1]]), 'rules');
    const bad = partOf(two, 'rules');
    expect(ok.score).toBe(1);
    expect(bad.score).toBe(0.75);
    expect(bad.detail).toBe('1 deck limit broken');
  });

  it('names a broken Radiant limit in one line', () => {
    expect(ev.score(deck(CHARIZARD)).issues).toEqual([]); // the test deck plays one Radiant Charizard
    expect(ev.score(withExtra([['swsh10-046', 1]])).issues).toEqual(['Radiant Pokémon: 2 in the deck (Radiant Charizard, Radiant Greninja), 1 at most']);
    // The other print of the same Radiant counts as a second one.
    expect(ev.score(withExtra([['swsh10.5-011', 1]])).issues).toEqual(['Radiant Pokémon: 2 in the deck (Radiant Charizard), 1 at most']);
  });

  it('names a broken one-copy limit like the four-copy one', () => {
    expect(ev.score(withExtra([['sm5-62', 2]])).issues).toEqual(['Lunala ◇: 2 copies, 1 at most']);
    expect(
      ev.score(
        withExtra([
          ['sm5-62', 1],
          ['sm5-89', 1],
        ]),
      ).issues,
    ).toEqual([]);
    expect(ev.score(withExtra([['neo4-16', 2]])).issues).toEqual(['Miracle Energy: 2 copies, 1 at most']);
    // Over both limits: said once, with the stricter one.
    expect(ev.score(withExtra([['sv02-172', 2]])).issues).toEqual(["Boss's Orders: 5 copies, 4 at most"]);
  });

  it('answers whether a move keeps the group limits', () => {
    const base = withExtra([['sv05-157', 1]]);
    expect(ev.fits(base, [card('sv05-153')])).toBe(false);
    expect(ev.fits(base, [card('sv02-172')])).toBe(true);
    expect(ev.fits(base, [card('swsh10-046')])).toBe(false); // the deck has a Radiant
    expect(ev.fits(deck([['sve-002', 4]]), [card('sv05-153'), card('sv05-157')])).toBe(false); // both at once
    expect(ev.fits(deck([['sve-002', 4]]), [card('sv05-153')])).toBe(true);
  });
});

describe('builder keeps the limits', () => {
  const pool = ev.pool(options);
  const named = (name: string) => pool.find((c) => c.name === name)!;
  const aceIds = new Set(index.catalog.cards.filter((c) => feat(c.id).groups.includes('ace-spec')).map((c) => c.id));
  const radiantIds = new Set(index.catalog.cards.filter((c) => feat(c.id).groups.includes('radiant')).map((c) => c.id));
  const blind = { ...ev, fits: undefined } as unknown as typeof ev;
  // The Charizard deck with its Counter Catcher replaced by an ACE SPEC Item, Prime Catcher.
  const withAce = withExtra([['sv05-157', 1]], ['sv04-160']);

  it('has pool cards of both kinds', () => {
    expect(pool.some((c) => aceIds.has(c.id))).toBe(true);
    expect(pool.some((c) => radiantIds.has(c.id))).toBe(true);
  });

  it('never suggests a second ACE SPEC or Radiant, as an add or a swap', { timeout: 60000 }, () => {
    // Control: without the group check the deck is offered more ACE SPEC and Radiant cards, so the check is what keeps them out.
    const wide = { ...options, limit: 100, perPart: 100, breadth: 400 };
    const limited = pool.filter((c) => aceIds.has(c.id) || radiantIds.has(c.id) || c.cat === 'Energy');
    const free = suggestAdds(blind, withAce, wide, limited);
    expect(free.some((s) => s.move.add.some((c) => aceIds.has(c.id)))).toBe(true);
    expect(free.some((s) => s.move.add.some((c) => radiantIds.has(c.id)))).toBe(true);
    const adds = suggestAdds(ev, withAce, wide, limited);
    expect(adds.length).toBeGreaterThan(5);
    for (const s of adds) {
      const after = applyMove(withAce, s.move);
      expect(countOf(after, aceIds), s.move.add.map((c) => c.name).join()).toBeLessThanOrEqual(1);
      expect(countOf(after, radiantIds)).toBeLessThanOrEqual(1);
    }
    // The same on the whole pool.
    for (const s of suggestAdds(ev, withAce, { ...options, limit: 30, perPart: 30 }, pool)) {
      expect(countOf(applyMove(withAce, s.move), aceIds), s.move.add.map((c) => c.name).join()).toBeLessThanOrEqual(1);
    }
    // A swap may trade the ACE SPEC for another; it may not keep it and add one.
    const swaps = suggestSwaps(ev, withAce, { ...options, limit: 30, perPart: 30 }, pool);
    for (const s of swaps) {
      const after = applyMove(withAce, s.move);
      expect(countOf(after, aceIds), s.move.add.map((c) => c.name).join()).toBeLessThanOrEqual(1);
      expect(countOf(after, radiantIds)).toBeLessThanOrEqual(1);
    }
  });

  it('builds around an ACE SPEC seed and a Radiant seed without breaking a limit', { timeout: 60000 }, () => {
    for (const name of ['Prime Catcher', 'Master Ball', 'Radiant Greninja', 'Radiant Charizard']) {
      const built = buildDeck(ev, [named(name).id], { ...options, breadth: 60 }, pool);
      expect(built.cards.reduce((n, c) => n + c.qty, 0), name).toBe(60);
      expect(built.score.issues, name).toEqual([]);
      expect(built.cards.some((c) => c.cardId === named(name).id), name).toBe(true);
      expect(countOf(built.cards, aceIds), name).toBeLessThanOrEqual(1);
      expect(countOf(built.cards, radiantIds), name).toBeLessThanOrEqual(1);
    }
  });

  it('leaves out a second ACE SPEC or Radiant seed and a fifth copy, and says so', { timeout: 60000 }, () => {
    const boss = named("Boss's Orders").id;
    const seeds = [named('Prime Catcher').id, named('Master Ball').id, named('Radiant Greninja').id, named('Radiant Charizard').id, boss, boss, boss, boss, boss];
    const built = buildDeck(ev, seeds, { ...options, breadth: 40 }, pool);
    expect(built.dropped).toEqual(['Master Ball', 'Radiant Charizard', "Boss's Orders"]);
    expect(built.score.issues).toEqual([]);
    expect(built.cards.find((c) => c.cardId === boss)!.qty).toBe(4);
  });

  it('offers no second Prism Star copy', () => {
    const lunala = card('sm5-62');
    const have = deck([
      ['sm5-62', 1],
      ['sve-002', 4],
    ]);
    const small = [lunala, card('sv02-172'), card('sve-002')];
    const wide = { ...options, limit: 10, perPart: 10 };
    expect(suggestAdds(ev, have, wide, small).some((s) => s.move.add.some((c) => c.id === lunala.id))).toBe(false);
    // The deck page's four-copy rules would offer it.
    const loose = { ...ev, rules: POKEMON_DECK_RULES } as typeof ev;
    expect(suggestAdds(loose, have, wide, small).some((s) => s.move.add.some((c) => c.id === lunala.id))).toBe(true);
  });
});

describe('Special Energy', () => {
  const rule = (id: string) => parseEnergyText(text.byId.get(id)!.text.fx ?? '')!;
  const credit = (energyId: string, pokemonId: string, letter: string) => energyCredit(rule(energyId), feat(pokemonId), letter);
  const CHARMANDER = 'sv04.5-007'; // Fire, Basic
  const CHARIZARD_EX = 'sv04.5-054'; // Darkness (Tera), Stage 2, attacks with Fire
  const MANAPHY = 'swsh12.5gg-GG06'; // Water, Basic
  const OGERPON = 'svp-123'; // Grass, Basic

  it('reads the types a Special Energy provides', () => {
    expect(rule('swsh9-151')).toMatchObject({ base: 'C', only: null }); // Double Turbo: Colorless only
    expect(rule('swsh3-174')).toMatchObject({ base: 'R', only: null }); // Heat Fire
    expect(rule('sv06-167')).toMatchObject({ base: '*' }); // Legacy: every type
    expect(rule('sm5-137').base).toBe('CGRW'); // Unit: three types, one at a time
    expect(rule('bw6-117').base).toBe('CGRPD'); // Blend
    expect(rule('swsh5-140')).toMatchObject({ base: 'WF', amount: 2 }); // Rapid Strike: 2 in any combination
    expect(feat('swsh9-151').provides).toBe('C');
    expect(feat('sm5-137').provides).toBe('CGRW');
  });

  it('applies "can only be attached to" and the like', () => {
    expect(rule('xy3-103').only).toEqual({ kind: 'type', letter: 'G' }); // Herbal: Grass Pokémon
    expect(rule('xy6-97').only).toEqual({ kind: 'type', letter: 'N' }); // Double Dragon
    expect(rule('ecard2-145').only).toEqual({ kind: 'evolution' }); // Boost: Evolved Pokémon
    expect(credit('xy3-103', OGERPON, 'G')).toBe(1);
    expect(credit('xy3-103', CHARMANDER, 'G')).toBe(0);
    expect(credit('xy8-151', CHARMANDER, 'R')).toBe(1); // Burning: Fire Pokémon only
    expect(credit('xy8-151', CHARIZARD_EX, 'R')).toBe(0); // this Charizard ex is a Darkness Pokémon
    expect(credit('xy6-97', CHARMANDER, 'R')).toBe(0); // Double Dragon on a Fire Pokémon
  });

  it('gives Colorless-only and wrong-type Energy no credit for a typed need', () => {
    expect(credit('swsh9-151', CHARMANDER, 'R')).toBe(0);
    expect(credit('swsh3-174', MANAPHY, 'W')).toBe(0); // Heat Fire provides Fire
    expect(credit('swsh3-174', CHARMANDER, 'R')).toBe(1);
    expect(credit('sm5-137', CHARMANDER, 'R')).toBe(1);
    expect(credit('sm5-137', CHARMANDER, 'L')).toBe(0);
  });

  it('reads conditions about the Pokémon an upgrade needs', () => {
    expect(rule('sv05-162').upgrades).toEqual([{ types: '*', cond: { kind: 'stage', stage: 'Stage 2' } }]); // Neo Upper
    expect(credit('sv05-162', CHARIZARD_EX, 'R')).toBe(1);
    expect(credit('sv05-162', CHARMANDER, 'R')).toBe(0);
    expect(credit('sv10.5b-086', CHARMANDER, 'R')).toBe(1); // Prism Energy: Basic Pokémon
    expect(credit('sv10.5b-086', CHARIZARD_EX, 'R')).toBe(0);
  });

  it('keeps half weight where a condition cannot be read', () => {
    expect(credit('sm6-117', CHARMANDER, 'R')).toBe(0.5); // Beast: Ultra Beast, a group the catalog does not record
    expect(credit('sv02-192', CHARMANDER, 'R')).toBe(0.5); // Reversal: depends on Prize cards
    expect(credit('sv02-191', CHARMANDER, 'R')).toBe(0.5); // Luminous: "{C} instead" beside other Special Energy
    expect(credit('swsh8-244', CHARMANDER, 'R')).toBe(0.5); // Fusion Strike: a group the printed name does not say
    expect(credit('neo4-16', CHARMANDER, 'R')).toBe(0.5); // Miracle: Shining or Light Pokémon
    expect(energyCredit(rule('swsh5-140'), { ...feat(CHARMANDER), card: { ...card(CHARMANDER), name: 'Rapid Strike Urshifu' } }, 'W')).toBe(1);
  });

  it('covers the attackers its text lets it, not every attacker', () => {
    const noFire = withExtra([], []).filter((c) => c.cardId !== 'sve-002');
    const cover = (extra: [string, number][]) => partOf(deck([...noFire.map((c): [string, number] => [c.cardId, c.qty]), ...extra]), 'energy');
    const basic = cover([['sve-002', 6]]);
    const heat = cover([['swsh3-174', 4]]); // Heat Fire provides Fire to any Pokémon
    const aurora = cover([['swsh1-186', 4]]); // every type
    const turbo = cover([['swsh9-151', 4]]); // Colorless only
    const herbal = cover([['xy3-103', 4]]); // Grass Pokémon only
    const beast = cover([['sm6-117', 4]]); // Ultra Beast: half weight
    expect(heat.detail).not.toMatch(/no Energy for/);
    expect(aurora.detail).not.toMatch(/no Energy for/);
    expect(turbo.detail).toMatch(/no Energy for Fire/);
    expect(herbal.detail).toMatch(/no Energy for Fire/);
    expect(beast.detail).not.toMatch(/no Energy for/);
    expect(beast.score).toBeGreaterThan(turbo.score);
    // Full coverage is full coverage: 4 Heat Fire and 4 Basic Fire differ only in the amount.
    expect(heat.score).toBe(cover([['sve-002', 4]]).score);
    expect(basic.score).toBeGreaterThan(0);
    // Half coverage (one Beast Energy beside Energy that cannot help) scores below full coverage of the same amount.
    expect(cover([['sm6-117', 1], ['swsh9-151', 3]]).score).toBeLessThan(cover([['swsh3-174', 4]]).score);
  });

  it('does not count Energy no attacker can use toward the amount', () => {
    // The attackers need Fire, Lightning and Water. Grass Energy powers none of them.
    const own = partOf(withExtra([]), 'energy');
    const half = partOf(withExtra([['sve-002', 3], ['sve-001', 3]]), 'energy');
    const allWrong = partOf(withExtra([['sve-001', 6]]), 'energy');
    expect(own.score).toBeCloseTo(0.74, 2);
    expect(half.score).toBeLessThan(own.score - 0.2); // the same for both before the amount counted only usable Energy
    expect(half.detail).toContain('3 that the attackers can use');
    expect(allWrong.score).toBeLessThan(half.score);
    // Colorless-only Special Energy still pays Colorless costs; one that provides nothing these attackers can hold does not.
    expect(partOf(withExtra([['sve-002', 3], ['swsh9-151', 3]]), 'energy').score).toBeCloseTo(own.score, 3);
    expect(partOf(withExtra([['sve-002', 3], ['xy6-97', 3]]), 'energy').score).toBeCloseTo(half.score, 3);
  });

  it('suggests Special Energy only where it works', () => {
    const rel = (id: string) => ev.relevance(deck(CHARIZARD), [card(id)])[0];
    expect(rel('sv05-162')).toBeGreaterThanOrEqual(0.85); // Neo Upper Energy: every type for the deck's Stage 2 attacker
    expect(rel('sv02-191')).toBe(0.6); // Luminous Energy: half weight, as its text can withhold the types
    expect(rel('sv02-190')).toBeLessThan(0.2); // Jet Energy: Colorless only
    expect(rel('sv10-182')).toBeLessThan(0.2); // Team Rocket's Energy: Psychic and Darkness, for Team Rocket's Pokémon
    expect(rel('xy6-97')).toBeLessThan(0.2); // Double Dragon Energy: Dragon Pokémon only
  });
});

describe('Stadiums', () => {
  const MYSTERY_GARDEN = 'me01-122'; // a Stadium that draws
  const withStadiums = (n: number, other = 0): DeckCard[] => withExtra([[MYSTERY_GARDEN, n], ...(other ? ([['swsh9-144', other]] as [string, number][]) : [])], ['swsh9-144']);

  it('gives only a few copies credit in the draw part', () => {
    expect(feat(MYSTERY_GARDEN).stadium).toBe(true);
    expect(feat(MYSTERY_GARDEN).roles.has('draw')).toBe(true);
    const draw = (n: number) => partOf(withStadiums(n), 'draw');
    expect(draw(2).score).toBeGreaterThan(draw(1).score);
    expect(draw(STADIUM_CREDIT + 1).score).toBe(draw(STADIUM_CREDIT).score);
    expect(draw(4).score).toBe(draw(3).score);
    expect(draw(4).detail).toBe(draw(3).detail);
  });

  it('shares the credit between Stadium names', () => {
    // 3 Mystery Garden + 3 Magma Basin: the Magma Basins do not draw, so the draw part is that of 3 + 3 → still 3 credit.
    const one = partOf(withStadiums(3), 'draw').score;
    const mixed = partOf(withStadiums(2, 3), 'draw').score;
    expect(mixed).toBeLessThan(one);
  });

  it('weighs a dead Stadium by the credited copies only', () => {
    // xy7-74 names Grass Pokémon, which this Fire deck has none of.
    const syn = (n: number) => partOf(withExtra([['xy7-74', n]], ['swsh9-144']), 'synergy');
    expect(feat('xy7-74').stadium).toBe(true);
    expect(syn(3).score).toBeLessThan(syn(1).score);
    expect(syn(5).score).toBe(syn(3).score);
    expect(syn(5).detail).toContain('Nothing in the deck for');
  });
});
