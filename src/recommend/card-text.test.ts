import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Catalog } from '@/data/types';
import { buildTextIndex, COST_LETTERS, costCount, costTypes, damageValue, textFileFor, type CardTextFile } from './card-text';

const dataDir = new URL('../../public/data/', import.meta.url);
const file = JSON.parse(readFileSync(new URL('text.json', dataDir), 'utf8')) as CardTextFile;
const catalog = JSON.parse(readFileSync(new URL('catalog.json', dataDir), 'utf8')) as Catalog;

describe('card text helpers', () => {
  it('reads costs and damage', () => {
    expect(costCount('RRC')).toBe(3);
    expect(costCount('')).toBe(0);
    expect(costCount('{Odd}C')).toBe(2);
    expect(costTypes('RRC')).toEqual(['R']);
    expect(costTypes('GWC')).toEqual(['G', 'W']);
    expect(costTypes('CC')).toEqual([]);
    expect(damageValue('30+')).toBe(30);
    expect(damageValue('20×')).toBe(20);
    expect(damageValue(undefined)).toBe(0);
  });

  it('knows which game has a text file', () => {
    expect(textFileFor('pokemon')).toBe('text.json');
    expect(textFileFor('ygo')).toBeNull();
    expect(textFileFor('mtg')).toBeNull();
  });
});

describe('public/data/text.json', () => {
  const index = buildTextIndex(file);

  it('covers nearly every catalog card, with legality per printing', () => {
    expect(file.game).toBe('pokemon');
    expect(file.ids.length).toBe(file.ti.length);
    expect(file.ids.length).toBe(file.mk.length);
    expect(file.ids.length).toBe(file.lg.length);
    const ids = new Set(catalog.cards.map((c) => c.id));
    expect(index.byId.size / ids.size).toBeGreaterThan(0.99);
    for (const id of file.ids) expect(ids.has(id), id).toBe(true);
    const pineco = index.byId.get('sv01-001')!;
    expect(pineco.text.a?.[0]).toMatchObject({ c: 'CC', n: 'Guard Press', d: '10' });
    expect(pineco.mark).toBe('G');
    expect(pineco.expanded).toBe(true);
    expect(index.byId.get('base1-4')!.text.ev).toBe('Charmeleon');
    expect(index.byId.get('sv01-172')!.text.tt).toBe('Item');
    expect(index.byId.get('base1-98')!.text.et).toBe('Normal');
  });

  it('writes attack costs with the letters the app reads', async () => {
    const lib = (await import(/* @vite-ignore */ pathToFileURL(fileURLToPath(new URL('../../scripts/build-text.mjs', import.meta.url))).href)) as {
      COST_LETTERS: Record<string, string>;
      costLetters(cost: string[]): string;
      textOf(raw: Record<string, unknown>): Record<string, unknown> | null;
      legalBits(legal: { standard?: boolean; expanded?: boolean } | null): number;
    };
    expect(lib.COST_LETTERS).toEqual(COST_LETTERS);
    expect(lib.costLetters(['Fire', 'Fire', 'Colorless'])).toBe('RRC');
    expect(lib.textOf({ attacks: [], abilities: null, effect: null })).toBeNull();
    expect(lib.textOf({ attacks: [{ cost: ['Grass'], name: ' Vine Whip ', damage: 10, effect: null }], retreat: 1 })).toEqual({
      a: [{ c: 'G', n: 'Vine Whip', d: '10' }],
      rc: 1,
    });
    expect(lib.legalBits({ standard: true, expanded: true })).toBe(3);
    expect(lib.legalBits(null)).toBe(0);
  });
});
