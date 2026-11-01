import { describe, expect, it } from 'vitest';
import { buildIndex, compareCardNum, formatCardNumber } from './catalog';
import { normalizeText } from './normalize';
import { searchCards, searchSpecies } from './search';
import type { Catalog, Species } from './types';

const catalog: Catalog = {
  version: 1,
  builtAt: '2026-01-01T00:00:00Z',
  sets: [
    { id: 'base1', name: 'Base Set', series: 'base', seriesName: 'Base', releaseDate: '1999-01-09', official: 102, total: 102, abbr: 'BS' },
    { id: 'sv01', name: 'Scarlet & Violet', series: 'sv', seriesName: 'Scarlet & Violet', releaseDate: '2023-03-31', official: 198, total: 258, abbr: 'SVI' },
    { id: 'sv02', name: 'Paldea Evolved', series: 'sv', seriesName: 'Scarlet & Violet', releaseDate: '2023-06-09', official: 193, total: 279, abbr: 'PAL' },
  ],
  cards: [
    { id: 'base1-4', set: 'base1', num: '4', name: 'Charizard', cat: 'Pokemon', dex: [6], types: ['Fire'], rarity: 'Rare', hp: 120, img: true },
    { id: 'base1-58', set: 'base1', num: '58', name: 'Pikachu', cat: 'Pokemon', dex: [25], types: ['Lightning'], rarity: 'Common', hp: 40, img: true },
    { id: 'base1-102', set: 'base1', num: '102', name: 'Water Energy', cat: 'Energy', img: true },
    { id: 'sv01-025', set: 'sv01', num: '025', name: 'Pikachu', cat: 'Pokemon', dex: [25], types: ['Lightning'], rarity: 'Common', hp: 60, img: true },
    { id: 'sv01-057', set: 'sv01', num: '057', name: 'Kirlia', cat: 'Pokemon', dex: [281], types: ['Psychic'], rarity: 'Uncommon', hp: 80, img: true },
    { id: 'sv02-057', set: 'sv02', num: '057', name: 'Pikachu ex', cat: 'Pokemon', dex: [25], types: ['Lightning'], rarity: 'Double Rare', hp: 190, img: true },
    { id: 'sv02-180', set: 'sv02', num: '180', name: "Professor's Research", cat: 'Trainer', rarity: 'Uncommon', img: true },
  ],
};

const species: Species[] = [
  { id: 6, name: 'Charizard', gen: 1, types: ['fire', 'flying'] },
  { id: 25, name: 'Pikachu', gen: 1, types: ['electric'] },
  { id: 281, name: 'Kirlia', gen: 3, types: ['psychic', 'fairy'] },
  { id: 669, name: 'Flabébé', gen: 6, types: ['fairy'] },
];

const index = buildIndex(catalog, species);

describe('normalizeText', () => {
  it('folds diacritics, symbols and punctuation', () => {
    expect(normalizeText('Flabébé')).toBe('flabebe');
    expect(normalizeText("Farfetch'd")).toBe('farfetchd');
    expect(normalizeText('Nidoran♀')).toBe('nidoran f');
    expect(normalizeText('  Professor’s  Research ')).toBe('professors research');
  });
});

describe('buildIndex', () => {
  it('groups cards by set, species and name, newest printing first', () => {
    expect(index.cardsBySet.get('base1')?.map((c) => c.id)).toEqual(['base1-4', 'base1-58', 'base1-102']);
    expect(index.cardsByDex.get(25)?.map((c) => c.id)).toEqual(['sv02-057', 'sv01-025', 'base1-58']);
    expect(index.cardsByName.get('pikachu')?.map((c) => c.id)).toEqual(['sv01-025', 'base1-58']);
    expect(index.series.map((s) => s.id)).toEqual(['sv', 'base']);
    expect(index.series[0].sets.map((s) => s.id)).toEqual(['sv02', 'sv01']);
  });
});

describe('card numbers', () => {
  it('compares numerically with alphanumeric ids last', () => {
    expect(['10', '2', 'TG01', '1', '057'].sort(compareCardNum)).toEqual(['1', '2', '10', '057', 'TG01']);
  });
  it('formats with the set denominator and zero padding', () => {
    expect(formatCardNumber(catalog.cards[0], index.setsById.get('base1'))).toBe('004/102');
    expect(formatCardNumber(catalog.cards[3], index.setsById.get('sv01'))).toBe('025/198');
  });
});

describe('searchCards', () => {
  it('ranks exact name matches first and newest printings before older ones', () => {
    const r = searchCards(index, 'pikachu');
    expect(r.total).toBe(3);
    expect(r.cards.map((c) => c.id)).toEqual(['sv01-025', 'base1-58', 'sv02-057']);
  });
  it('matches set names and set codes', () => {
    expect(searchCards(index, 'base set').cards.map((c) => c.set)).toEqual(['base1', 'base1', 'base1']);
    expect(searchCards(index, 'PAL').total).toBe(2);
  });
  it('resolves printed numbers against the set denominator', () => {
    expect(searchCards(index, '57/198').cards.map((c) => c.id)).toEqual(['sv01-057']);
    expect(searchCards(index, '057 / 193').cards.map((c) => c.id)).toEqual(['sv02-057']);
    expect(searchCards(index, '4/102').cards.map((c) => c.id)).toEqual(['base1-4']);
  });
  it('applies filters', () => {
    expect(searchCards(index, '', { cat: 'Trainer' }).cards.map((c) => c.id)).toEqual(['sv02-180']);
    expect(searchCards(index, '', { type: 'Fire' }).cards.map((c) => c.id)).toEqual(['base1-4']);
    expect(searchCards(index, 'pikachu', { series: 'sv' }).total).toBe(2);
    const owned = new Map([['base1-58', { cardId: 'base1-58', qty: 2, wanted: 0 as const, addedAt: 0, updatedAt: 0 }]]);
    expect(searchCards(index, 'pikachu', { owned: 'owned' }, owned).cards.map((c) => c.id)).toEqual(['base1-58']);
    expect(searchCards(index, 'pikachu', { owned: 'missing' }, owned).total).toBe(2);
  });
  it('respects the limit but reports the full total', () => {
    const r = searchCards(index, '', {}, undefined, 2);
    expect(r.cards).toHaveLength(2);
    expect(r.total).toBe(7);
  });
});

describe('searchSpecies', () => {
  it('matches by prefix, substring and dex number', () => {
    expect(searchSpecies(index, 'pik').map((s) => s.id)).toEqual([25]);
    expect(searchSpecies(index, 'zard').map((s) => s.id)).toEqual([6]);
    expect(searchSpecies(index, '#281').map((s) => s.id)).toEqual([281]);
    expect(searchSpecies(index, 'flabebe').map((s) => s.id)).toEqual([669]);
  });
});
