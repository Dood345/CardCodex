/**
 * Where a built deck's cards come from ("Prefer my cards", "Only my cards",
 * "Any card") and what the builder will not go and add. From a player's
 * report (2026-11-10): "Prefer my cards" built a deck of mostly unowned
 * cards, with an Energy no Pokémon in it could use, eight Rare Candy-like
 * cards and an Ivysaur line that led nowhere.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { CollectionEntry, DeckCard } from '@/data/db';
import type { CatalogCard } from '@/data/types';
import { expandMtgCatalog, type MtgCatalogFile } from '@/games/mtg/catalog';
import { expandYgoCatalog, type YgoCatalogFile } from '@/games/ygo/catalog';
import { SOURCES } from './advice';
import { buildDeck, OWNED_BONUS, ownedShare, suggestAdds, type SuggestOptions } from './builder';
import { createMtgEvaluator } from './mtg';
import { buildMtgTextIndex, type MtgTextFile } from './mtg-text';
import { withPokemonPlaytest } from './pokemon-play';
import { deck, loadEvaluator } from './sim/fixtures';
import type { BuildOptions, DeckEvaluator } from './types';
import { createYgoEvaluator } from './ygo';
import { buildYgoTextIndex, type YgoTextFile } from './ygo-text';

const { ev, index } = loadEvaluator();
const card = (id: string) => index.cardsById.get(id)!;
const own = (list: [string, number][]) => new Map<string, CollectionEntry>(list.map(([cardId, qty]) => [cardId, { cardId, qty, wanted: 0, addedAt: 0, updatedAt: 0 } as CollectionEntry]));
const total = (cards: readonly DeckCard[]) => cards.reduce((n, c) => n + c.qty, 0);

const CHESNAUGHT = 'swsh12-015';
/** A small collection: one Chesnaught V deck's worth of cards, the Grass Energy in four printings. */
const MINE: [string, number][] = [
  [CHESNAUGHT, 2],
  ['sv08.5-002', 3], // Exeggutor
  ['sv08.5-001', 3], // Exeggcute
  ['sv03.5-127', 2], // Pinsir
  ['swsh1-165', 4], // Hop
  ['swsh1-161', 4], // Energy Search
  ['swsh1-164', 4], // Great Ball
  ['swsh2-167', 2], // Sonia
  ['swsh1-177', 2], // Potion
  ['mee-001', 6],
  ['sve-009', 3],
  ['swsh12.5-152', 4],
  ['xy12-91', 1],
];
const collection = own(MINE);
const LONG = { timeout: 120_000 };

describe('where the cards come from', () => {
  it('says under each choice what it does', () => {
    expect(SOURCES.map((s) => s.label)).toEqual(['Prefer my cards', 'Only my cards', 'Any card']);
    for (const s of SOURCES) expect(s.hint.length, s.id).toBeGreaterThan(20);
    expect(SOURCES[0].hint).toMatch(/Your cards first/);
    expect(SOURCES[1].hint).toMatch(/Only cards you own/);
  });

  it('counts an addition as owned only while a copy is left over', () => {
    const prefer: BuildOptions = { source: 'prefer-collection', collection, format: 'any' };
    const add = (id: string) => ({ add: [card(id)], remove: [] });
    expect(ownedShare(add(CHESNAUGHT), [], prefer)).toBe(1);
    expect(ownedShare(add(CHESNAUGHT), deck([[CHESNAUGHT, 1]]), prefer)).toBe(1);
    expect(ownedShare(add(CHESNAUGHT), deck([[CHESNAUGHT, 2]]), prefer)).toBe(0);
    expect(ownedShare(add('swsh12-016'), [], prefer)).toBe(0);
    // Only "Prefer my cards" weighs it: the other two sources need no bonus.
    expect(ownedShare(add(CHESNAUGHT), [], { ...prefer, source: 'catalog' })).toBe(0);
    expect(ownedShare(add(CHESNAUGHT), [], { ...prefer, source: 'collection' })).toBe(0);
    expect(OWNED_BONUS).toBeGreaterThan(0.5);
  });

  it('offers every owned printing as a card of its own, and one printing of a name otherwise', () => {
    const grass = (source: BuildOptions['source']) =>
      ev
        .pool({ source, collection, format: 'any' })
        .filter((c) => c.name === 'Grass Energy')
        .map((c) => c.id)
        .sort();
    expect(grass('collection')).toEqual(['mee-001', 'sve-009', 'swsh12.5-152', 'xy12-91']);
    expect(grass('prefer-collection')).toEqual(['mee-001', 'sve-009', 'swsh12.5-152', 'xy12-91']);
    expect(grass('catalog')).toHaveLength(1);
    // A name with no owned printing is absent from "Only my cards" and present, once, in the other two.
    const rare = (source: BuildOptions['source']) => ev.pool({ source, collection, format: 'any' }).filter((c) => c.name === 'Rare Candy').length;
    expect(rare('collection')).toBe(0);
    expect(rare('prefer-collection')).toBe(1);
  });

  it('builds from "Only my cards" with nothing unowned, across the printings owned', LONG, () => {
    const options: SuggestOptions = { source: 'collection', collection, format: 'any', fillByPlay: false };
    const built = buildDeck(ev, [CHESNAUGHT], options, ev.pool(options));
    for (const l of built.cards) expect(l.qty, l.cardId).toBeLessThanOrEqual(collection.get(l.cardId)?.qty ?? 0);
    expect(built.cards.find((l) => l.cardId === CHESNAUGHT)?.qty).toBe(2);
    // The Grass Energy of more than one printing went in: before, only the first printing found counted.
    const grass = built.cards.filter((l) => card(l.cardId).name === 'Grass Energy');
    expect(grass.length).toBeGreaterThan(1);
    expect(grass.reduce((n, l) => n + l.qty, 0)).toBeGreaterThan(6);
    // Forty cards are owned: the deck stops short of sixty and never borrows.
    expect(total(built.cards)).toBeLessThanOrEqual(40);
    expect(total(built.cards)).toBeGreaterThanOrEqual(30);
  });

  it('builds from "Prefer my cards" with far more owned cards than from "Any card"', LONG, () => {
    const ownedIn = (cards: readonly DeckCard[]) => cards.reduce((n, l) => n + Math.min(l.qty, collection.get(l.cardId)?.qty ?? 0), 0);
    const build = (source: BuildOptions['source']) => {
      const options: SuggestOptions = { source, collection, format: 'any', fillByPlay: false };
      return buildDeck(ev, [CHESNAUGHT], options, ev.pool(options)).cards;
    };
    const prefer = build('prefer-collection');
    const any = build('catalog');
    expect(total(prefer)).toBe(60);
    expect(total(any)).toBe(60);
    expect(ownedIn(prefer)).toBeGreaterThanOrEqual(24);
    expect(ownedIn(prefer)).toBeGreaterThan(ownedIn(any) + 10);
    // It is a preference, not a limit: the deck is still full.
    expect(ownedIn(prefer)).toBeLessThan(60);
  });

  it('suggests one card per name although the pool holds every owned printing', () => {
    const options: SuggestOptions = { source: 'prefer-collection', collection, format: 'any', limit: 20, perPart: 20 };
    const names = suggestAdds(ev, deck([[CHESNAUGHT, 2]]), options, ev.pool(options)).map((s) => s.move.add[0].name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('what a built deck is built around', () => {
  const options: SuggestOptions = { source: 'catalog', collection: new Map(), format: 'any', fillByPlay: false };
  const pool = ev.pool(options);

  it('plays the card it starts from in numbers and keeps it through the swaps', LONG, () => {
    const built = buildDeck(ev, [CHESNAUGHT], options, pool).cards;
    expect(built.find((l) => card(l.cardId).name === 'Chesnaught V')!.qty).toBeGreaterThanOrEqual(3);
    // A weak Stage 2 stays too, with the line it stands on: the swaps used to trade it away.
    const vivillon = pool.find((c) => c.name === 'Vivillon')!;
    const weak = buildDeck(ev, [vivillon.id], options, pool).cards;
    const names = new Map<string, number>();
    for (const l of weak) names.set(card(l.cardId).name, (names.get(card(l.cardId).name) ?? 0) + l.qty);
    expect(names.get('Vivillon')).toBeGreaterThanOrEqual(3);
    expect((names.get('Spewpa') ?? 0) + (names.get('Rare Candy') ?? 0) + (names.get('Pokémon Breeder') ?? 0)).toBeGreaterThan(0);
    expect(names.get('Scatterbug')).toBeGreaterThan(0);
  });

  it('does not go and add what the deck cannot use', LONG, () => {
    const built = buildDeck(ev, [CHESNAUGHT], options, pool).cards;
    const names = new Map<string, number>();
    for (const l of built) names.set(card(l.cardId).name, (names.get(card(l.cardId).name) ?? 0) + l.qty);
    // No Energy for a group the card data cannot confirm, no Trainer gated on an Energy the deck lacks.
    expect(names.has('Impact Energy')).toBe(false);
    expect(names.has('Melony')).toBe(false);
    // Rare Candy and Pokémon Breeder together: no more than the Stage 2 they can put down, four at most.
    let stage2 = 0;
    for (const l of built) if (card(l.cardId).stage === 'Stage2') stage2 += l.qty;
    expect((names.get('Rare Candy') ?? 0) + (names.get('Pokémon Breeder') ?? 0)).toBeLessThanOrEqual(Math.min(4, stage2));
    // Every evolution in the deck leads somewhere: it attacks about as hard as the deck's best, has a working
    // Ability, or something in the deck evolves from it.
    const feats = built.map((l) => ev.features(card(l.cardId)));
    const top = Math.max(...feats.map((f) => f.best?.sustained ?? 0));
    for (const f of feats) {
      if (!f.isPokemon || f.isBasic) continue;
      const leads = feats.some((g) => g.evolvesFrom === f.key);
      expect(leads || (f.best?.sustained ?? 0) >= 0.6 * top || f.roles.size > 0, f.card.name).toBe(true);
    }
  });

  it('rates filler at the bottom and capped cards at nothing', () => {
    const have = deck([
      [CHESNAUGHT, 4],
      ['me01-001', 1], // Bulbasaur
      ['sm7-10', 2], // Sceptile, a Stage 2
      ['sm8-20', 2], // Treecko
      ['swsh10.5-069', 2], // Rare Candy
      ['sve-009', 10],
    ]);
    const rel = (id: string) => ev.relevance(have, [card(id)])[0];
    expect(rel('me01-002')).toBeLessThanOrEqual(0.05); // Ivysaur: evolves from a card in the deck, does nothing for it
    expect(rel('swsh6-157')).toBe(0); // Impact Energy
    expect(rel('lc-102')).toBe(0); // Pokémon Breeder: two Stage 2, two Rare Candy already
    const short = deck([
      [CHESNAUGHT, 4],
      ['sm7-10', 2],
      ['sm8-20', 2],
      ['sve-009', 10],
    ]);
    expect(ev.relevance(short, [card('lc-102')])[0]).toBeGreaterThan(0.5);
    expect(ev.relevance(short, [card('sm8-21')])[0]).toBe(1); // Grovyle: Sceptile evolves from it
  });

  it('fills the last cards by playing when the evaluator can play, and not otherwise', LONG, () => {
    let games = 0;
    const playing = withPokemonPlaytest(ev);
    const counting: DeckEvaluator = { ...playing, playtest: (cards, o) => ((games += o.games), playing.playtest(cards, o)) };
    const byPlay = buildDeck(counting, [CHESNAUGHT], { ...options, fillByPlay: undefined }, pool);
    expect(games).toBeGreaterThan(0);
    expect(total(byPlay.cards)).toBe(60);
    expect(byPlay.score.issues).toEqual([]);
    games = 0;
    buildDeck(counting, [CHESNAUGHT], { ...options, fillByPlay: false }, pool);
    expect(games).toBe(0);
    // Without a playtest the option changes nothing.
    const a = buildDeck(ev, [CHESNAUGHT], { ...options, fillByPlay: undefined }, pool).cards;
    const b = buildDeck(ev, [CHESNAUGHT], options, pool).cards;
    expect(a).toEqual(b);
  });
});

describe('the same in the other games', () => {
  const dataDir = new URL('../../public/data/', import.meta.url);
  const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8')) as T;
  const games: [string, () => { ev: DeckEvaluator; byName: Map<string, CatalogCard[]>; format: string }][] = [
    [
      'Yu-Gi-Oh!',
      () => {
        const idx = buildIndex(expandYgoCatalog(read<YgoCatalogFile>('ygo/catalog.json')), []);
        return { ev: createYgoEvaluator({ index: idx, text: buildYgoTextIndex(read<YgoTextFile>('ygo/text.json')) }), byName: idx.cardsByName, format: 'any' };
      },
    ],
    [
      'Magic',
      () => {
        const idx = buildIndex(expandMtgCatalog(read<MtgCatalogFile>('mtg/catalog.json')), []);
        return { ev: createMtgEvaluator({ index: idx, text: buildMtgTextIndex(read<MtgTextFile>('mtg/text.json')), format: 'any' }), byName: idx.cardsByName, format: 'any' };
      },
    ],
  ];
  for (const [game, make] of games) {
    it(`${game}: every owned printing is in the pool, one printing of a name otherwise`, LONG, () => {
      const g = make();
      const all = g.ev.pool({ source: 'catalog', collection: new Map(), format: g.format });
      const inPool = new Set(all.map((c) => c.name));
      // A card of the pool that exists in two printings.
      const two = [...g.byName.values()].find((list) => list.length >= 2 && inPool.has(list[0].name) && list.every((c) => c.name === list[0].name))!;
      expect(two).toBeDefined();
      const mine = own([
        [two[0].id, 1],
        [two[1].id, 2],
      ]);
      const ids = (source: BuildOptions['source']) =>
        g.ev
          .pool({ source, collection: mine, format: g.format })
          .filter((c) => c.name === two[0].name)
          .map((c) => c.id)
          .sort();
      expect(ids('collection')).toEqual([two[0].id, two[1].id].sort());
      expect(ids('prefer-collection')).toEqual([two[0].id, two[1].id].sort());
      expect(ids('catalog')).toHaveLength(1);
      expect(g.ev.pool({ source: 'collection', collection: mine, format: g.format })).toHaveLength(2);
    });
  }
});

describe('Energy cover is a count of cards', () => {
  const pool = ev.pool({ source: 'catalog', collection: new Map(), format: 'standard' });
  const named = (name: string) => pool.find((c) => c.name === name)!;
  const energyPart = (cards: DeckCard[]) => ev.score(cards).parts.find((p) => p.id === 'energy')!;

  it('asks for more cards of a type the more of it an attack costs', () => {
    // Hydreigon ex's Dark Bite costs three Darkness and two more.
    const hydreigon = named('Hydreigon ex');
    expect(ev.features(hydreigon).best?.cost).toBe('DDDCC');
    const dark = named('Darkness Energy') ?? named('Basic Darkness Energy');
    const psychic = named('Psychic Energy') ?? named('Basic Psychic Energy');
    const any = named('Legacy Energy');
    const withEnergy = (lines: [CatalogCard, number][]) => [{ cardId: hydreigon.id, qty: 3 }, ...lines.map(([c, qty]) => ({ cardId: c.id, qty }))];
    const three = energyPart(withEnergy([[dark, 3], [psychic, 11]]));
    const eight = energyPart(withEnergy([[dark, 8], [psychic, 6]]));
    const fourteen = energyPart(withEnergy([[dark, 14]]));
    expect(three.score).toBeLessThan(eight.score);
    expect(eight.score).toBeLessThan(fourteen.score);
    // One Special Energy of every type is one card, not cover for the whole deck.
    const one = energyPart(withEnergy([[any, 1], [psychic, 13]]));
    expect(one.score).toBeLessThan(three.score);
    expect(one.detail).toMatch(/that the attackers can use/);
  });

  it('takes the types a deck needs from its real attackers, not from every Pokémon that can attack', () => {
    // Alakazam is in built decks to draw cards; its Energy is not a reason to run Psychic beside Hydreigon ex.
    const hydreigon = named('Hydreigon ex');
    const abra = named('Abra');
    expect(ev.features(abra).best).toBeDefined();
    expect(ev.features(abra).best!.sustained).toBeLessThan(0.5 * ev.features(hydreigon).best!.sustained);
    const psychic = named('Psychic Energy') ?? named('Basic Psychic Energy');
    const dark = named('Darkness Energy') ?? named('Basic Darkness Energy');
    const cards = [
      { cardId: hydreigon.id, qty: 3 },
      { cardId: abra.id, qty: 4 },
      { cardId: dark.id, qty: 8 },
    ];
    expect(ev.relevance(cards, [dark])[0]).toBeGreaterThan(0.9);
    expect(ev.relevance(cards, [psychic])[0]).toBeLessThanOrEqual(0.1);
  });
});
