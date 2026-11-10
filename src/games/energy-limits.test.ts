/**
 * The Energy copy rule over the whole catalog: a deck may hold any number of
 * basic Energy, and at most four of a Special Energy by name. Which card is
 * basic is decided by the card itself (deck-rules.ts), not by the data
 * source's label, which calls a number of Special Energy "Normal".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Catalog } from '@/data/types';
import { buildTextIndex, type CardTextFile } from '@/recommend/card-text';
import { isBasicEnergy, POKEMON_DECK_RULES } from './deck-rules';

const root = new URL('../../', import.meta.url);
const json = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, root), 'utf8')) as T;
const catalog = json<Catalog>('public/data/catalog.json');
const text = buildTextIndex(json<CardTextFile>('public/data/text.json'));
const energy = catalog.cards.filter((c) => c.cat === 'Energy');
const BASIC_NAME = /^(?:Basic )?(?:Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/;

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
