/**
 * Regression: on SWSH/SM-era cards OCR glues the stage badge to the name
 * ("zest) Furret" for "Stage 1 … Furret"). Measured on the Darkness Ablaze
 * Furret scan: 600×825 image, name line 29 px tall, median line 23 px, the
 * number line unreadable. The card must still surface as a candidate.
 */
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../data/types';
import { buildScanIndex, findNames, scanLines } from './match';
import type { RecognizedLine } from './types';

const catalog: Catalog = {
  version: 1,
  builtAt: '2026-01-01T00:00:00Z',
  sets: [
    { id: 'swsh3', name: 'Darkness Ablaze', series: 'swsh', seriesName: 'Sword & Shield', releaseDate: '2020-08-14', official: 189, total: 201, abbr: 'DAA' },
    { id: 'neo1', name: 'Neo Genesis', series: 'neo', seriesName: 'Neo', releaseDate: '2000-12-16', official: 111, total: 111, abbr: 'N1' },
  ],
  cards: [
    { id: 'swsh3-136', set: 'swsh3', num: '136', name: 'Furret', cat: 'Pokemon', dex: [162], hp: 110, stage: 'Stage1' },
    { id: 'swsh3-135', set: 'swsh3', num: '135', name: 'Sentret', cat: 'Pokemon', dex: [161], hp: 70, stage: 'Basic' },
    { id: 'neo1-35', set: 'neo1', num: '35', name: 'Furret', cat: 'Pokemon', dex: [162], hp: 70, stage: 'Stage1' },
    { id: 'swsh3-100', set: 'swsh3', num: '100', name: 'Pokémon Center Lady', cat: 'Trainer' },
  ],
};
const index = buildScanIndex(catalog);

const line = (text: string, x: number, y: number, w: number, h: number, confidence = 0.8): RecognizedLine => ({
  text,
  bbox: { x, y, w, h },
  confidence,
});

describe('glued badge or HP next to an exact name', () => {
  it('credits near-full coverage for one junk token at an edge', () => {
    expect(findNames('zest furret', index)[0]).toMatchObject({ name: 'furret', sim: 1, coverage: 0.85 });
    expect(findNames('furret 110', index)[0]).toMatchObject({ name: 'furret', sim: 1, coverage: 0.85 });
    // Two junk tokens, or junk on both sides, are not forgiven.
    expect(findNames('evolves from sentret', index)[0].coverage).toBeLessThan(0.5);
    expect(findNames('zest furret 110', index)[0].coverage).toBeLessThan(0.85);
  });

  it('still surfaces the card when the number line is unreadable', () => {
    const lines = [
      line('zest) Furret', 24, 35, 199, 29, 0.58),
      line('»110', 450, 39, 71, 28, 0.83),
      line('Evolves from Sentret', 60, 81, 180, 12, 0.92),
      line('Feelin’ Fine', 60, 484, 140, 24, 0.96),
      line('Draw 3 cards.', 60, 520, 160, 22, 0.96),
      line('Tail Smash', 60, 587, 120, 24, 0.96),
      line('Flip a coin. If tails, this attack does nothing.', 60, 622, 420, 22, 0.94),
      line('The nest is impossible for other Pokémon to enter.', 60, 772, 440, 14, 0.85),
      line('LW © 1sem89 0', 30, 774, 120, 18, 0.22),
    ];
    const cands = scanLines(lines, index);
    expect(cands).toHaveLength(1);
    expect(cands[0].card.id).toBe('swsh3-136');
    expect(cands[0].evidence).toContain('HP 110');
    expect(cands[0].confident).toBe(false);
    expect(cands[0].alternatives.map((a) => a.card.id)).toContain('neo1-35');
  });
});
