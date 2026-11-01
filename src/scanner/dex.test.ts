/**
 * The Pokédex line ("NO. 0204 Bagworm Pokémon") as a species cue. Measured on
 * a Scarlet & Violet Pineco scan where Tesseract read neither the stylised
 * name nor the number line, but did read that line at 87% confidence.
 */
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../data/types';
import { buildScanIndex, scanLines } from './match';
import { parseDex, parseLines } from './parse';
import type { RecognizedLine } from './types';

const line = (text: string, x: number, y: number, w: number, h: number, confidence = 0.85): RecognizedLine => ({
  text,
  bbox: { x, y, w, h },
  confidence,
});

const catalog: Catalog = {
  version: 1,
  builtAt: '2026-01-01T00:00:00Z',
  sets: [
    { id: 'sv01', name: 'Scarlet & Violet', series: 'sv', seriesName: 'Scarlet & Violet', releaseDate: '2023-03-31', official: 198, total: 258, abbr: 'SVI' },
    { id: 'swsh3', name: 'Darkness Ablaze', series: 'swsh', seriesName: 'Sword & Shield', releaseDate: '2020-08-14', official: 189, total: 201, abbr: 'DAA' },
    { id: 'neo1', name: 'Neo Genesis', series: 'neo', seriesName: 'Neo', releaseDate: '2000-12-16', official: 111, total: 111, abbr: 'N1' },
  ],
  cards: [
    { id: 'sv01-001', set: 'sv01', num: '001', name: 'Pineco', cat: 'Pokemon', dex: [204], hp: 60 },
    { id: 'neo1-72', set: 'neo1', num: '72', name: 'Pineco', cat: 'Pokemon', dex: [204], hp: 40 },
    { id: 'swsh3-136', set: 'swsh3', num: '136', name: 'Furret', cat: 'Pokemon', dex: [162], hp: 110 },
    { id: 'sv01-002', set: 'sv01', num: '002', name: 'Heracross', cat: 'Pokemon', dex: [214], hp: 120 },
  ],
};
const index = buildScanIndex(catalog);

describe('parseDex', () => {
  it('reads the Pokédex number with zero padding and OCR digit confusions', () => {
    expect(parseDex(line("NO. 0204. Bagworm Pokémon HI: 2", 0, 0, 10, 10), 0)?.dex).toBe(204);
    expect(parseDex(line('NO. 162 Long Body Pokémon', 0, 0, 10, 10), 0)?.dex).toBe(162);
    expect(parseDex(line('No. O996 Ice Fin Pokémon', 0, 0, 10, 10), 0)?.dex).toBe(996);
  });
  it('ignores rules text and out-of-range numbers', () => {
    expect(parseDex(line('No Pokémon in play', 0, 0, 10, 10), 0)).toBeNull();
    expect(parseDex(line('NO. 4000 nope', 0, 0, 10, 10), 0)).toBeNull();
    expect(parseDex(line('ANNO 12', 0, 0, 10, 10), 0)).toBeNull();
    expect(parseLines([line('Draw 3 cards.', 0, 0, 10, 10)]).dexes).toEqual([]);
  });
});

describe('matching from the Pokédex line alone', () => {
  const pinecoLines = [
    line('BASIC,', 40, 20, 80, 24, 0.95),
    line('NO. 0204. Bagworm Pokémon HI: 2', 90, 470, 420, 16, 0.87),
    line('WI 15 9 Ibs.', 520, 470, 90, 16, 0.9),
    line('©2023 Poké', 230, 800, 120, 12, 0.96),
  ];

  it('surfaces the newest printing of the species as a low-confidence candidate', () => {
    const cands = scanLines(pinecoLines, index);
    expect(cands).toHaveLength(1);
    expect(cands[0].card.id).toBe('sv01-001');
    expect(cands[0].evidence).toContain('dex #204');
    expect(cands[0].confident).toBe(false);
    expect(cands[0].alternatives.map((a) => a.card.id)).toEqual(['neo1-72']);
  });

  it('becomes confident when the number line is also read', () => {
    const cands = scanLines([...pinecoLines, line('001/198', 40, 790, 70, 11, 0.6)], index);
    expect(cands[0].card.id).toBe('sv01-001');
    expect(cands[0].evidence).toEqual(expect.arrayContaining(['number 1/198', 'dex #204']));
    expect(cands[0].confident).toBe(true);
  });
});
