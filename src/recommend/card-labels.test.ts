/**
 * The labels printed on the cards (Single Strike, Rapid Strike, Fusion Strike, Ancient, Future, Tera), read
 * off the card pictures by scripts/build-labels.mjs because the card data has no field for them, and what
 * the deck check does with them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeckCard } from '@/data/db';
import { CARD_LABELS, type CardTextFile } from './card-text';
import { energyCredit } from './pokemon';
import { deck, loadEvaluator } from './sim/fixtures';

const { ev, index } = loadEvaluator();
const root = new URL('../../', import.meta.url);
const text = JSON.parse(readFileSync(new URL('public/data/text.json', root), 'utf8')) as CardTextFile;
const record = JSON.parse(readFileSync(new URL('scripts/card-labels.json', root), 'utf8')) as { labels: Record<string, string[]> };
const card = (id: string) => index.cardsById.get(id)!;
const labelsOf = (id: string) => ev.features(card(id)).labels;
const part = (cards: DeckCard[], id: string) => ev.score(cards).parts.find((p) => p.id === id)!;

describe('the labels in the card text file', () => {
  it('holds the six labels, for cards of the catalog, as the record of the reading has them', () => {
    expect(Object.keys(text.lb ?? {})).toEqual([...CARD_LABELS]);
    const inText = new Set(text.ids);
    for (const label of CARD_LABELS) {
      const ids = text.lb![label];
      for (const id of ids) expect(index.cardsById.has(id), `${label} ${id}`).toBe(true);
      expect(ids).toEqual(record.labels[label].filter((id) => inText.has(id)));
      expect([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(ids);
    }
    // About as many as were read on 2026-11-12 (146, 159, 53, 74, 70, 151); a rebuild adds new sets, never halves a label.
    const counts = CARD_LABELS.map((l) => text.lb![l].length);
    for (const [i, least] of [130, 140, 45, 65, 60, 135].entries()) expect(counts[i], CARD_LABELS[i]).toBeGreaterThanOrEqual(least);
  });

  it('keeps each label to the sets that print it', () => {
    const setOf = (id: string) => index.setsById.get(card(id).set)!;
    for (const label of ['Single Strike', 'Rapid Strike', 'Fusion Strike']) for (const id of text.lb![label]) expect(setOf(id).series, `${label} ${id}`).toBe('swsh');
    for (const label of ['Ancient', 'Future', 'Tera']) {
      for (const id of text.lb![label]) {
        expect(setOf(id).series, `${label} ${id}`).not.toBe('swsh');
        expect(setOf(id).releaseDate >= '2023-01-01', `${label} ${id}`).toBe(true);
      }
    }
    // No card is both Ancient and Future.
    const future = new Set(text.lb!.Future);
    expect(text.lb!.Ancient.filter((id) => future.has(id))).toEqual([]);
  });

  it('agrees with every card whose name says its label', () => {
    // The name is the one independent witness in the card data: all of these must have been read.
    let named = 0;
    for (const c of index.catalog.cards) {
      // The Strike labels only: a card named "Single Strike …" is one, while "Tera Orb" and "Ancient Ruins" are
      // Trainers about the word and carry no badge.
      const label = CARD_LABELS.find((l) => l.endsWith('Strike') && c.name.startsWith(`${l} `));
      if (!label || !c.img || index.setsById.get(c.set)!.series !== 'swsh') continue;
      named++;
      expect(labelsOf(c.id), `${c.id} ${c.name}`).toContain(label);
    }
    expect(named).toBeGreaterThan(30);
    expect(labelsOf('sv04-159')).toEqual(['Ancient']); // Ancient Booster Energy Capsule
    expect(labelsOf('sv04-164')).toEqual(['Future']); // Future Booster Energy Capsule
    expect(labelsOf('sv08-189')).toEqual([]); // Tera Orb: about Tera Pokémon, not one
    // And the cards the reading was set up on.
    expect(labelsOf('swsh5-97')).toEqual(['Single Strike']); // Tyranitar V
    expect(labelsOf('swsh5-37')).toEqual(['Rapid Strike']); // Octillery
    expect(labelsOf('swsh8-113')).toEqual(['Fusion Strike']); // Mew V
    expect(labelsOf('sv04-124')).toEqual(['Ancient']); // Roaring Moon ex
    expect(labelsOf('sv04-089')).toEqual(['Future']); // Iron Valiant ex
    expect(labelsOf('sv03-125')).toEqual(['Tera']); // Charizard ex
    // Deoxys of Fusion Strike carries all three Strike badges, one under the other.
    expect(labelsOf('swsh8-120')).toEqual(['Single Strike', 'Rapid Strike', 'Fusion Strike']);
    // Cards of the same sets without a badge, and cards from before the labels existed.
    for (const id of ['swsh1-65', 'sv01-034', 'sv04-034', 'swsh12-015', 'base1-4']) expect(labelsOf(id), id).toEqual([]);
  });
});

describe('what the deck check does with a label', () => {
  const IMPACT = 'swsh6-157'; // Impact Energy: "can only be attached to a Single Strike Pokémon"
  const TYRANITAR = 'swsh5-97'; // Single Strike
  const CHESNAUGHT = 'swsh12-015'; // no label
  const DARK = 'sve-007';
  const GRASS = 'sve-009';

  it('knows which Pokémon an Energy for a labelled group can go on', () => {
    const rule = ev.features(card(IMPACT)).energy!;
    expect(rule.only).toEqual({ kind: 'name', text: 'Single Strike' });
    expect(energyCredit(rule, ev.features(card(TYRANITAR)), 'D')).toBeGreaterThan(0);
    // Not half credit any more: the card has no Single Strike badge, so the Energy cannot be attached to it.
    expect(energyCredit(rule, ev.features(card(CHESNAUGHT)), 'G')).toBe(0);
    const single = deck([[TYRANITAR, 4], [DARK, 8]]);
    const plain = deck([[CHESNAUGHT, 4], [GRASS, 8]]);
    expect(ev.relevance(single, [card(IMPACT)])[0]).toBeGreaterThanOrEqual(0.6);
    expect(ev.relevance(plain, [card(IMPACT)])[0]).toBeLessThanOrEqual(0.1);
    expect(part(deck([[CHESNAUGHT, 4], [GRASS, 8], [IMPACT, 2]]), 'energy').detail).toMatch(/10 Energy, 8 that the attackers can use/);
    expect(part(deck([[TYRANITAR, 4], [DARK, 8], [IMPACT, 2]]), 'energy').detail).not.toMatch(/that the attackers can use/);
  });

  it('checks a Trainer that names a labelled kind of Pokémon against the deck', () => {
    const capsule = card('sv04-164'); // Future Booster Energy Capsule
    expect(ev.features(capsule).mentions.labels).toEqual(new Set(['Future']));
    const future = deck([['sv04-089', 3], ['sv04-164', 2], ['sve-005', 8]]); // Iron Valiant ex
    const none = deck([[CHESNAUGHT, 3], ['sv04-164', 2], [GRASS, 8]]);
    expect(part(future, 'synergy').detail).not.toMatch(/Future Booster/);
    expect(part(none, 'synergy').detail).toBe('Nothing in the deck for Future Booster Energy Capsule');
    // Offered to a deck that plays Future Pokémon, not to one that plays none.
    expect(ev.relevance(deck([['sv04-089', 3], ['sve-005', 8]]), [capsule])[0]).toBeGreaterThan(0.5);
    expect(ev.relevance(deck([[CHESNAUGHT, 3], [GRASS, 8]]), [capsule])[0]).toBeLessThanOrEqual(0.1);
  });
});
