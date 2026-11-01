/**
 * Shared fixtures for scanner tests (not a test file itself).
 * Small catalog: 4 sets, 16 cards. sv01 and "rv1" share official 198 so
 * number+total alone is ambiguous between them.
 */
import type { Catalog, CatalogCard, CatalogSet } from '../data/types';
import type { RecognizedLine } from './types';

const set = (id: string, name: string, abbr: string, official: number, releaseDate: string, series = 'sv'): CatalogSet => ({
  id,
  name,
  series,
  seriesName: series,
  releaseDate,
  official,
  total: official + 20,
  abbr,
});

const card = (setId: string, num: string, name: string, hp?: number, cat: CatalogCard['cat'] = 'Pokemon'): CatalogCard => ({
  id: `${setId}-${num}`,
  set: setId,
  num,
  name,
  cat,
  hp,
});

export const fixtureCatalog: Catalog = {
  version: 1,
  builtAt: '2026-01-01T00:00:00Z',
  sets: [
    set('base1', 'Base Set', 'BS', 102, '1999-01-09', 'base'),
    set('sv01', 'Scarlet & Violet', 'SVI', 198, '2023-03-31'),
    set('rv1', 'Rival Test Set', 'RVT', 198, '2024-05-01'),
    set('swsh9tg', 'Brilliant Stars Trainer Gallery', 'BRS:TG', 30, '2022-02-25', 'swsh'),
    set('mep', 'Promo with zero official', '', 0, '2025-01-01'),
  ],
  cards: [
    // Base Set: unpadded numbers.
    card('base1', '4', 'Charizard', 120),
    card('base1', '58', 'Pikachu', 40),
    card('base1', '25', 'Dewgong', 80),
    // Scarlet & Violet: zero-padded as stored in the real catalog.
    card('sv01', '025', 'Pikachu', 60),
    card('sv01', '057', 'Wugtrio', 90),
    card('sv01', '063', 'Pikachu ex', 190),
    card('sv01', '190', "Professor's Research", undefined, 'Trainer'),
    card('sv01', '125', 'Charizard ex', 330),
    // Rival set: same official 198, different cards at the same numbers.
    card('rv1', '057', 'Pikachu ex', 200),
    card('rv1', '025', 'Charizard VMAX', 330),
    card('rv1', '190', "Boss's Orders", undefined, 'Trainer'),
    card('rv1', '063', 'Pikachu', 70),
    // Trainer gallery: prefixed numbers.
    card('swsh9tg', 'TG01', 'Flareon', 110),
    card('swsh9tg', 'TG02', 'Vaporeon', 120),
    card('mep', '001', 'Pikachu', 60),
    card('mep', '002', 'Nidoran♀', 60),
  ],
};

/** Shorthand for a recognized line. */
export function line(text: string, x: number, y: number, w: number, h: number, confidence = 0.9): RecognizedLine {
  return { text, bbox: { x, y, w, h }, confidence };
}

/**
 * Lines of one synthetic card (300×420 px) with its top-left at (ox, oy):
 * name at ~6% height, HP top-right, body text, number at ~95% height.
 */
export function cardLines(
  ox: number,
  oy: number,
  opts: { name?: string; hp?: string; number?: string; body?: string[] },
): RecognizedLine[] {
  const out: RecognizedLine[] = [];
  if (opts.name) out.push(line(opts.name, ox + 40, oy + 15, 150, 20));
  if (opts.hp) out.push(line(opts.hp, ox + 220, oy + 14, 60, 22));
  (opts.body ?? ['Flip a coin. If heads, this attack', 'does 30 more damage.']).forEach((t, i) =>
    out.push(line(t, ox + 20, oy + 260 + i * 14, 260, 10)),
  );
  if (opts.number) out.push(line(opts.number, ox + 18, oy + 392, 90, 14));
  return out;
}
