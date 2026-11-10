/**
 * The Energy copy rule over the whole catalog: a deck may hold any number of
 * basic Energy, and at most four of a Special Energy by name. Which card is
 * basic is decided by the card itself (deck-rules.ts), not by the data
 * source's label, which calls a number of Special Energy "Normal".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { CollectionEntry } from '@/data/db';
import { limitHint, overLimit, unlimitedTwin, withPrinting } from '@/data/decks';
import type { Catalog, SpeciesFile } from '@/data/types';
import { buildTextIndex, type CardTextFile } from '@/recommend/card-text';
import { isBasicEnergy, POKEMON_DECK_RULES } from './deck-rules';

const root = new URL('../../', import.meta.url);
const json = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, root), 'utf8')) as T;
const catalog = json<Catalog>('public/data/catalog.json');
const text = buildTextIndex(json<CardTextFile>('public/data/text.json'));
const energy = catalog.cards.filter((c) => c.cat === 'Energy');
const BASIC_NAME = /^(?:Basic )?(?:Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/;
const index = buildIndex(catalog, json<SpeciesFile>('public/data/species.json').species);
const own = (list: [string, number][]) => new Map<string, CollectionEntry>(list.map(([cardId, qty]) => [cardId, { cardId, qty, wanted: 0, addedAt: 0, updatedAt: 0 }]));

describe('Energy copy limits', () => {
  it('gives every Energy card one of the two limits: none for basic, four for Special', () => {
    expect(energy.length).toBeGreaterThan(500);
    for (const c of energy) {
      const limit = POKEMON_DECK_RULES.copyLimit(c);
      expect(limit === Infinity || limit === 4, `${c.id} ${c.name}: ${limit}`).toBe(true);
      expect(limit === Infinity, `${c.id} ${c.name}`).toBe(isBasicEnergy(c));
    }
  });

  it('never lets an Energy with a name of its own go unlimited', () => {
    // Double Colorless, Prism, Jet, Reversal, Team Rocket's, Growing Grass…: Special Energy, four by name.
    const named = energy.filter((c) => !BASIC_NAME.test(c.name));
    expect(named.length).toBeGreaterThan(150);
    for (const c of named) expect(POKEMON_DECK_RULES.copyLimit(c), `${c.id} ${c.name}`).toBe(4);
  });

  it('caps the Special Energy the data source labels as basic', () => {
    // TCGdex's energyType says "Normal" for these although their text gives them an effect.
    const mislabelled = energy.filter((c) => text.byId.get(c.id)?.text.et === 'Normal' && !BASIC_NAME.test(c.name));
    expect(mislabelled.length).toBeGreaterThan(0);
    for (const c of mislabelled) expect(POKEMON_DECK_RULES.copyLimit(c), `${c.id} ${c.name}`).toBe(4);
    for (const name of ['Prism Energy', 'Reversal Energy', "Team Rocket's Energy"]) {
      expect(mislabelled.some((c) => c.name === name), name).toBe(true);
    }
  });

  it('leaves basic Energy unlimited in every printing, and the old Special Darkness and Metal Energy capped', () => {
    const basicNamed = energy.filter((c) => BASIC_NAME.test(c.name));
    const capped = basicNamed.filter((c) => POKEMON_DECK_RULES.copyLimit(c) === 4);
    // From Neo Genesis to HeartGold SoulSilver, "Darkness Energy" and "Metal Energy" were Special Energy.
    for (const c of capped) {
      expect(/^(Darkness|Metal) Energy$/.test(c.name), `${c.id} ${c.name}`).toBe(true);
      expect(c.rarity === 'Rare' || c.rarity === 'Uncommon', `${c.id} ${c.rarity}`).toBe(true);
    }
    expect(capped.length).toBeGreaterThan(0);
    for (const type of ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Fairy']) {
      for (const c of basicNamed.filter((x) => x.name.includes(type))) expect(POKEMON_DECK_RULES.copyLimit(c), c.id).toBe(Infinity);
    }
    // The newest printings, named "Basic … Energy", and the unlabelled Energy-set ones.
    for (const id of ['sv01-257', 'sve-007', 'mee-007', 'swsh12.5-158']) {
      const c = catalog.cards.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect(POKEMON_DECK_RULES.copyLimit(c!), id).toBe(Infinity);
    }
  });
});

describe('a name that is two cards: basic and Special "Darkness Energy"', () => {
  // swsh12.5-158: basic (Crown Zenith, no effect). hgss3-79 and dp5-93: the older Special Energy (they have an effect).
  const BASIC = 'swsh12.5-158';
  const SPECIAL = 'hgss3-79';
  const SPECIAL2 = 'dp5-93';

  it('says which is which by the card, as the catalog and the card text both have it', () => {
    const note = (id: string) => POKEMON_DECK_RULES.cardNote!(index.cardsById.get(id)!);
    expect(note(BASIC)).toBe('Basic Energy');
    expect(note(SPECIAL)).toBe('Special Energy');
    expect(note('base1-96')).toBe('Special Energy'); // Double Colorless Energy
    expect(note('base1-4')).toBeUndefined(); // Charizard: only Energy cards get a note
    // Every printing the app calls Special has effect text; every one it calls basic has none.
    for (const c of energy.filter((x) => x.name === 'Darkness Energy' || x.name === 'Metal Energy')) {
      const fx = text.byId.get(c.id)?.text.fx;
      if (text.byId.has(c.id)) expect(!!fx, `${c.id} effect text`).toBe(!isBasicEnergy(c));
    }
  });

  it('does not hold twelve basic ones against the four a Special one allows', () => {
    expect(overLimit(POKEMON_DECK_RULES, [{ cardId: BASIC, qty: 12 }], index)).toEqual([]);
    // One old Special printing among basic ones used to flag all twelve.
    const mixed = [
      { cardId: BASIC, qty: 11 },
      { cardId: SPECIAL, qty: 1 },
    ];
    expect(overLimit(POKEMON_DECK_RULES, mixed, index)).toEqual([]);
    expect(limitHint(POKEMON_DECK_RULES, overLimit(POKEMON_DECK_RULES, mixed, index))).toBeNull();
  });

  it('still caps the Special one at four, over its printings, and names them', () => {
    const cards = [
      { cardId: BASIC, qty: 9 },
      { cardId: SPECIAL, qty: 3 },
      { cardId: SPECIAL2, qty: 2 },
    ];
    const over = overLimit(POKEMON_DECK_RULES, cards, index);
    expect(over).toEqual([{ name: 'Darkness Energy', qty: 5, limit: 4, ids: [SPECIAL, SPECIAL2] }]);
    expect(limitHint(POKEMON_DECK_RULES, over)).toBe('4 copies at most: Darkness Energy ×5.');
  });

  it('finds the basic printing to switch to: one you own first, else the newest with a picture', () => {
    const picked = unlimitedTwin(POKEMON_DECK_RULES, 'Darkness Energy', index, own([]))!;
    expect(isBasicEnergy(picked)).toBe(true);
    expect(picked.name).toBe('Darkness Energy');
    expect(picked.img).toBeTruthy();
    expect(unlimitedTwin(POKEMON_DECK_RULES, 'Darkness Energy', index, own([['sm1-170', 2]]))!.id).toBe('sm1-170');
    // Owning the Special printing does not make it the twin.
    expect(isBasicEnergy(unlimitedTwin(POKEMON_DECK_RULES, 'Darkness Energy', index, own([[SPECIAL, 12]]))!)).toBe(true);
    // A Special Energy with no basic card of its name has none.
    expect(unlimitedTwin(POKEMON_DECK_RULES, 'Double Colorless Energy', index, own([]))).toBeUndefined();
    expect(unlimitedTwin(POKEMON_DECK_RULES, 'Charizard', index, own([]))).toBeUndefined();
  });

  it('switches every line of the old printings to the basic one, zone by zone', () => {
    const cards = [
      { cardId: 'base1-4', qty: 2 },
      { cardId: SPECIAL, qty: 8 },
      { cardId: SPECIAL2, qty: 4 },
      { cardId: BASIC, qty: 1 },
    ];
    expect(withPrinting(cards, new Set([SPECIAL, SPECIAL2]), BASIC)).toEqual([
      { cardId: 'base1-4', qty: 2 },
      { cardId: BASIC, qty: 13 },
    ]);
    expect(overLimit(POKEMON_DECK_RULES, withPrinting(cards, new Set([SPECIAL, SPECIAL2]), BASIC), index)).toEqual([]);
    const sided = [
      { cardId: SPECIAL, qty: 3 },
      { cardId: SPECIAL, qty: 2, zone: 'side' as const },
    ];
    expect(withPrinting(sided, new Set([SPECIAL]), BASIC)).toEqual([
      { cardId: BASIC, qty: 3 },
      { cardId: BASIC, qty: 2, zone: 'side' },
    ]);
  });
});
