/**
 * Magic: The Gathering catalog file (public/data/mtg/catalog.json, written by
 * scripts/build-mtg-catalog.mjs from Scryfall bulk data, see ./scryfall.ts) and
 * its expansion into the generic Catalog.
 *
 * Laid out like the Yu-Gi-Oh! file: `cards` has one row per Oracle card (the
 * rules object every reprint shares) and `printings` one row per printed card
 * (set + collector number). The app works in printings: every `CatalogCard`
 * here is one printing ("mtg:lea-161" is Lightning Bolt in Alpha), its `oid`
 * field names the Oracle card, and all printings of a card share a name and
 * `oid`, the role the passcode plays for Yu-Gi-Oh!.
 */
import type { CardCategory, Catalog, CatalogCard, CatalogSet } from '@/data/types';
import { MTG_ID_PREFIX } from '../ids';

export interface MtgSetRow {
  /** Lowercase Scryfall set code ("lea", "blb"); also the set id. */
  id: string;
  name: string;
  /** Release date "YYYY-MM-DD" or "". */
  date: string;
  /** Printings of the set in the catalog. */
  total: number;
}

export interface MtgCardRow {
  /** Scryfall Oracle id: one per card across all its printings. */
  oid: string;
  /** Oracle name; double-faced and split cards read "Front // Back". */
  name: string;
  /** Type line ("Legendary Creature — Goblin Warrior"; both faces for double-faced cards). */
  tl: string;
  /** Mana cost in Scryfall's brace notation ("{1}{R}"), front face for double-faced cards. */
  cost?: string;
  /** Mana value. */
  mv: number;
  /** Colors as WUBRG letters ("UR"); absent for colorless. */
  col?: string;
  pow?: string;
  tou?: string;
  /** Planeswalker loyalty. */
  loy?: string;
  /** Battle defense. */
  def?: string;
}

/** [card index, set index, collector number, rarity letter, Scryfall card id, artist index (-1 = none)] */
export type MtgPrintingRow = [number, number, string, string, string, number];

export interface MtgCatalogFile {
  version: number;
  game: 'mtg';
  builtAt: string;
  sets: MtgSetRow[];
  cards: MtgCardRow[];
  artists: string[];
  printings: MtgPrintingRow[];
}

/** WUBRG letter → color name; the names are what `CatalogCard.types` holds. */
export const MTG_COLORS: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
export const MTG_COLORLESS = 'Colorless';

/** Scryfall rarity → one letter in the file; expanded back by `expandMtgCatalog`. */
export const MTG_RARITY: Record<string, string> = {
  c: 'Common',
  u: 'Uncommon',
  r: 'Rare',
  m: 'Mythic Rare',
  s: 'Special',
  b: 'Bonus',
};

/**
 * Category from a type line, first match wins: a creature is a Creature
 * whatever else it is (artifact creatures, Dryad Arbor), a land is a Land
 * (artifact lands, Urza's Saga), then Planeswalker, Battle, Instant, Sorcery,
 * Artifact, Enchantment. Double-faced cards are judged by the front face.
 * Anything else (Conspiracy, Dungeon, Stickers…) is "Other".
 */
export function mtgCategory(typeLine: string): CardCategory {
  const front = typeLine.split(' // ')[0];
  const t = front.split(' — ')[0];
  const has = (w: string) => new RegExp(`\\b${w}\\b`, 'i').test(t);
  if (has('Creature')) return 'Creature';
  if (has('Land')) return 'Land';
  if (has('Planeswalker')) return 'Planeswalker';
  if (has('Battle')) return 'Battle';
  if (has('Instant')) return 'Instant';
  if (has('Sorcery')) return 'Sorcery';
  if (has('Artifact')) return 'Artifact';
  if (has('Enchantment')) return 'Enchantment';
  return 'Other';
}

/** Basic lands (and Snow-Covered ones, and Wastes) are exempt from the four-copies rule. */
export function isBasicLand(card: Pick<CatalogCard, 'sub'>): boolean {
  return /\bBasic\b/.test((card.sub ?? '').split(' // ')[0].split(' — ')[0]);
}

/** Year of a release date, used as the "series" grouping on the Sets tab. */
function yearOf(date: string): string {
  return /^\d{4}/.test(date) ? date.slice(0, 4) : '';
}

/** Expand the two-level file into sets + one CatalogCard per printing. Pure. */
export function expandMtgCatalog(file: MtgCatalogFile): Catalog {
  const sets: CatalogSet[] = file.sets.map((s) => {
    const year = yearOf(s.date);
    return {
      id: s.id,
      name: s.name,
      series: year || 'undated',
      seriesName: year || 'Undated',
      releaseDate: s.date,
      // Collector numbers are shown as printed, without a "/total".
      official: 0,
      total: s.total,
      abbr: s.id.toUpperCase(),
    };
  });

  const cards: CatalogCard[] = [];
  for (const [ci, si, num, rarity, sid, ai] of file.printings) {
    const row = file.cards[ci];
    const set = sets[si];
    if (!row || !set) continue;
    const card: CatalogCard = {
      id: `${MTG_ID_PREFIX}${set.id}-${num}`,
      set: set.id,
      num,
      name: row.name,
      cat: mtgCategory(row.tl),
      types: row.col ? [...row.col].map((l) => MTG_COLORS[l] ?? l) : [MTG_COLORLESS],
      sid,
      oid: row.oid,
      sub: row.tl,
      mv: row.mv,
    };
    const r = MTG_RARITY[rarity];
    if (r) card.rarity = r;
    if (row.cost) card.cost = row.cost;
    if (row.pow !== undefined) card.pow = row.pow;
    if (row.tou !== undefined) card.tou = row.tou;
    if (row.loy !== undefined) card.loy = row.loy;
    if (row.def !== undefined) card.dfn = row.def;
    const artist = ai >= 0 ? file.artists[ai] : undefined;
    if (artist) card.artist = artist;
    cards.push(card);
  }

  return { version: file.version, builtAt: file.builtAt, game: 'mtg', sets, cards };
}
