import { describe, expect, it } from 'vitest';
import type { CatalogIndex } from '@/data/catalog';
import type { CollectionEntry } from '@/data/db';
import { deckSections, limitHint, normalizeCards, overLimit, parseExportedDecks, qtyOf, summarizeDeck, withMoved, withQty } from '@/data/decks';
import type { CatalogCard } from '@/data/types';
import { isBasicEnergy, isExtraDeckCard, POKEMON_DECK_RULES, YGO_DECK_RULES } from './deck-rules';
import { pokemon } from './pokemon';
import { ygo } from './ygo';

const ygoCard = (id: string, name: string, frame: string, cat: CatalogCard['cat'] = 'Monster'): CatalogCard => ({ id, set: 'x', num: id, name, cat, frame });
const pkmCard = (id: string, name: string, cat: CatalogCard['cat'], extra: Partial<CatalogCard> = {}): CatalogCard => ({ id, set: 'x', num: id, name, cat, ...extra });

const FUSION = ygoCard('ygo:LOB-003', 'Flame Swordsman', 'fusion');
const LINK = ygoCard('ygo:YS17-EN041', 'Decode Talker', 'link');
const XYZ_P = ygoCard('ygo:CORE-EN051', 'Odd-Eyes Rebellion Dragon', 'xyz_pendulum');
const PEND = ygoCard('ygo:P-1', 'Pendulum monster', 'effect_pendulum');
const POT = ygoCard('ygo:LOB-EN119', 'Pot of Greed', 'spell', 'Spell');
const POT2 = ygoCard('ygo:MRL-E129', 'Pot of Greed', 'spell', 'Spell');

function indexOf(cards: CatalogCard[]): CatalogIndex {
  return { cardsById: new Map(cards.map((c) => [c.id, c])) } as unknown as CatalogIndex;
}
function owned(entries: [string, number][]): Map<string, CollectionEntry> {
  return new Map(entries.map(([cardId, qty]) => [cardId, { cardId, qty, wanted: 0, addedAt: 0, updatedAt: 0 }]));
}

describe('deck rules', () => {
  it('hangs off each game profile', () => {
    expect(pokemon.deckRules).toBe(POKEMON_DECK_RULES);
    expect(ygo.deckRules).toBe(YGO_DECK_RULES);
    expect(POKEMON_DECK_RULES.sections.map((s) => [s.id, s.min, s.max])).toEqual([['main', 60, 60]]);
    expect(YGO_DECK_RULES.sections.map((s) => [s.label, s.min, s.max])).toEqual([
      ['Main', 40, 60],
      ['Extra', 0, 15],
      ['Side', 0, 15],
    ]);
  });

  it('puts Fusion, Synchro, Xyz and Link monsters (pendulum ones too) in the Extra deck, the rest in Main', () => {
    for (const f of ['fusion', 'synchro', 'xyz', 'link', 'fusion_pendulum', 'synchro_pendulum', 'xyz_pendulum']) expect(isExtraDeckCard({ frame: f })).toBe(true);
    for (const f of ['normal', 'effect', 'ritual', 'effect_pendulum', 'normal_pendulum', 'ritual_pendulum', 'spell', 'trap', 'token', 'skill', undefined]) {
      expect(isExtraDeckCard({ frame: f })).toBe(false);
    }
    expect(YGO_DECK_RULES.sectionOf(FUSION, {})).toBe('extra');
    expect(YGO_DECK_RULES.sectionOf(XYZ_P, {})).toBe('extra');
    expect(YGO_DECK_RULES.sectionOf(PEND, {})).toBe('main');
    expect(YGO_DECK_RULES.sectionOf(POT, {})).toBe('main');
    expect(YGO_DECK_RULES.sectionOf(FUSION, { zone: 'side' })).toBe('side');
    expect(YGO_DECK_RULES.sectionOf(undefined, {})).toBe('main');
    expect(POKEMON_DECK_RULES.sectionOf(undefined, { zone: 'side' })).toBe('main');
  });

  it('allows three copies of a Yu-Gi-Oh! card and four of a Pokémon card, any number of basic Energy', () => {
    expect(YGO_DECK_RULES.copyLimit(POT)).toBe(3);
    expect(POKEMON_DECK_RULES.copyLimit(pkmCard('base1-4', 'Charizard', 'Pokemon'))).toBe(4);
    expect(POKEMON_DECK_RULES.copyLimit(pkmCard('base1-98', 'Fire Energy', 'Energy', { stage: 'Basic', rarity: 'Common' }))).toBe(Infinity);
    // Basic Energy without the catalog's Basic stage still counts, by name.
    expect(isBasicEnergy(pkmCard('sv01-257', 'Basic Lightning Energy', 'Energy', { rarity: 'Hyper rare' }))).toBe(true);
    expect(isBasicEnergy(pkmCard('sve-7', 'Darkness Energy', 'Energy', { rarity: 'Common' }))).toBe(true);
    // Special Energy, including the old Special Darkness and Metal Energy.
    expect(isBasicEnergy(pkmCard('base1-96', 'Double Colorless Energy', 'Energy', { rarity: 'Uncommon' }))).toBe(false);
    expect(isBasicEnergy(pkmCard('neo1-105', 'Darkness Energy', 'Energy', { rarity: 'Rare' }))).toBe(false);
    expect(isBasicEnergy(pkmCard('dp2-119', 'Metal Energy', 'Energy', { rarity: 'Uncommon' }))).toBe(false);
    expect(isBasicEnergy(pkmCard('x', 'Fire Energy', 'Trainer'))).toBe(false);
  });
});

describe('deck lines by card and zone', () => {
  it('keeps one line per card and zone', () => {
    let cards = withQty([], POT.id, 2);
    cards = withQty(cards, POT.id, 1, 'side');
    expect(cards).toEqual([
      { cardId: POT.id, qty: 2 },
      { cardId: POT.id, qty: 1, zone: 'side' },
    ]);
    expect([qtyOf(cards, POT.id), qtyOf(cards, POT.id, 'side')]).toEqual([2, 1]);
    expect(withQty(cards, POT.id, 0, 'side')).toEqual([{ cardId: POT.id, qty: 2 }]);
    expect(withMoved(cards, POT.id, undefined, 'side')).toEqual([
      { cardId: POT.id, qty: 1 },
      { cardId: POT.id, qty: 2, zone: 'side' },
    ]);
    expect(withMoved(withMoved(cards, POT.id, undefined, 'side', 5), POT.id, 'side', undefined)).toEqual([
      { cardId: POT.id, qty: 2, zone: 'side' },
      { cardId: POT.id, qty: 1 },
    ]);
    expect(withMoved(cards, 'nothing', undefined, 'side')).toEqual(cards);
    expect(
      normalizeCards([
        { cardId: 'a', qty: 1 },
        { cardId: 'a', qty: 2, zone: 'side' },
        { cardId: 'a', qty: 1, zone: 'side' },
        { cardId: 'a', qty: 1, zone: 'bogus' as 'side' },
      ]),
    ).toEqual([
      { cardId: 'a', qty: 2 },
      { cardId: 'a', qty: 3, zone: 'side' },
    ]);
  });

  it('compares a card with the collection once over both zones', () => {
    const cards = [
      { cardId: POT.id, qty: 2 },
      { cardId: POT.id, qty: 1, zone: 'side' as const },
      { cardId: FUSION.id, qty: 1 },
    ];
    const s = summarizeDeck(cards, owned([[POT.id, 2]]));
    expect([s.total, s.distinct, s.covered, s.short]).toEqual([4, 2, 2, 2]);
    expect(s.needs).toEqual([
      { cardId: POT.id, qty: 3, owned: 2, claimed: 0, short: 1 },
      { cardId: FUSION.id, qty: 1, owned: 0, claimed: 0, short: 1 },
    ]);
  });

  it('keeps the side zone through the Settings backup', () => {
    const [deck] = parseExportedDecks([
      { id: 'd1', game: 'ygo', name: 'x', cards: [{ cardId: POT.id, qty: 1 }, { cardId: POT.id, qty: 2, zone: 'side' }], createdAt: 1, updatedAt: 2 },
    ]);
    expect(deck.cards).toEqual([
      { cardId: POT.id, qty: 1 },
      { cardId: POT.id, qty: 2, zone: 'side' },
    ]);
  });
});

describe('deck sections and reminders', () => {
  const index = indexOf([FUSION, LINK, POT, POT2]);

  it('splits a Yu-Gi-Oh! deck into Main, Extra and Side; owned copies go to the deck before the side', () => {
    const cards = [
      { cardId: FUSION.id, qty: 1 },
      { cardId: LINK.id, qty: 2 },
      { cardId: POT.id, qty: 2 },
      { cardId: POT.id, qty: 1, zone: 'side' as const },
    ];
    const placed = deckSections(YGO_DECK_RULES, cards, index, owned([[POT.id, 2]]));
    expect(placed.map((p) => [p.section.id, p.total])).toEqual([
      ['main', 2],
      ['extra', 3],
      ['side', 1],
    ]);
    expect(placed[0].hint).toBe('A Yu-Gi-Oh! main deck has 40–60 cards: 38 to go.');
    expect(placed[1].hint).toBeNull();
    expect(placed[0].lines).toEqual([{ cardId: POT.id, qty: 2, available: 2 }]);
    expect(placed[2].lines).toEqual([{ cardId: POT.id, qty: 1, zone: 'side', available: 0 }]);
    expect(overLimit(YGO_DECK_RULES, cards, index)).toEqual([]);
  });

  it('counts copies by name over printings and sections', () => {
    const cards = [
      { cardId: POT.id, qty: 2 },
      { cardId: POT2.id, qty: 1 },
      { cardId: POT.id, qty: 1, zone: 'side' as const },
    ];
    const over = overLimit(YGO_DECK_RULES, cards, index);
    expect(over).toEqual([{ name: 'Pot of Greed', qty: 4, limit: 3 }]);
    expect(limitHint(YGO_DECK_RULES, over)).toBe('3 copies at most: Pot of Greed ×4.');
    expect(limitHint(YGO_DECK_RULES, [])).toBeNull();
  });

  it('keeps a Pokémon deck in one 60-card section and lets basic Energy run past four', () => {
    const fire = pkmCard('base1-98', 'Fire Energy', 'Energy', { stage: 'Basic' });
    const char = pkmCard('base1-4', 'Charizard', 'Pokemon');
    const pIndex = indexOf([fire, char]);
    const cards = [
      { cardId: char.id, qty: 5 },
      { cardId: fire.id, qty: 20 },
    ];
    const placed = deckSections(POKEMON_DECK_RULES, cards, pIndex, owned([]));
    expect(placed).toHaveLength(1);
    expect([placed[0].total, placed[0].hint]).toEqual([25, 'A Pokémon deck has 60 cards: 35 to go.']);
    expect(limitHint(POKEMON_DECK_RULES, overLimit(POKEMON_DECK_RULES, cards, pIndex))).toBe('4 copies at most: Charizard ×5.');
  });
});
