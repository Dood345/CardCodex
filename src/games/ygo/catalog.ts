/**
 * Yu-Gi-Oh! catalog file (public/data/ygo/catalog.json, written by
 * scripts/build-ygo-catalog.mjs) and its expansion into the generic Catalog.
 *
 * The file is two-level: `cards` has one row per card (passcode) and
 * `printings` one row per printed set code. The app works in printings, like
 * the Pokémon side works in cards: every `CatalogCard` here is one printing
 * ("LOB-EN005" is the Dark Magician in Legend of Blue Eyes), its `pc` field
 * names the card, and all printings of a card share a name and `pc`.
 */
import type { CardCategory, Catalog, CatalogCard, CatalogSet } from '@/data/types';
import { YGO_ID_PREFIX } from '../ids';

export interface YgoSetRow {
  id: string;
  name: string;
  /** Set code prefix as printed ("LOB"). */
  code: string;
  /** TCG release date "YYYY-MM-DD" or "". */
  date: string;
  total: number;
}

export interface YgoCardRow {
  /** Passcode (8 digits printed bottom-left). */
  pc: number;
  name: string;
  /** API type string, e.g. "Effect Monster", "Spell Card". */
  type: string;
  /** API frameType, e.g. "effect", "xyz_pendulum", "spell". */
  frame: string;
  /** Monster type ("Dragon") or Spell/Trap subtype ("Quick-Play"). */
  race?: string;
  attr?: string;
  atk?: number;
  def?: number;
  /** Level, Rank or Link rating. */
  lv?: number;
  arc?: string;
  /** Passcodes of alternate artworks. */
  alt?: number[];
}

/** [card index, set index, printed code, rarity] */
export type YgoPrintingRow = [number, number, string, string];

export interface YgoCatalogFile {
  version: number;
  game: 'ygo';
  builtAt: string;
  sets: YgoSetRow[];
  cards: YgoCardRow[];
  printings: YgoPrintingRow[];
}

/** "Flip Tuner Effect Monster" → "Monster"; "Spell Card" → "Spell"; ... */
export function ygoCategory(type: string): CardCategory {
  if (/monster/i.test(type)) return 'Monster';
  if (/^spell/i.test(type)) return 'Spell';
  if (/^trap/i.test(type)) return 'Trap';
  if (/^skill/i.test(type)) return 'Skill';
  return 'Token';
}

/** Year of a release date, used as the "series" grouping on the Sets tab. */
function yearOf(date: string): string {
  return /^\d{4}/.test(date) ? date.slice(0, 4) : '';
}

/** Expand the two-level file into sets + one CatalogCard per printing. Pure. */
export function expandYgoCatalog(file: YgoCatalogFile): Catalog {
  const sets: CatalogSet[] = file.sets.map((s) => {
    const year = yearOf(s.date);
    return {
      id: s.id,
      name: s.name,
      series: year || 'undated',
      seriesName: year || 'Undated',
      releaseDate: s.date,
      // No "/total" numbering on Yu-Gi-Oh! cards: formatCardNumber falls back to the code.
      official: 0,
      total: s.total,
      abbr: s.code,
    };
  });

  const cards: CatalogCard[] = [];
  const seenCode = new Set<string>();
  for (const [ci, si, code, rarity] of file.printings) {
    const row = file.cards[ci];
    const set = sets[si];
    if (!row || !set) continue;
    // The same code is occasionally printed on two different cards (misprints,
    // data quirks); the second one gets the passcode appended to stay unique.
    const id = seenCode.has(code) ? `${YGO_ID_PREFIX}${code}~${row.pc}` : `${YGO_ID_PREFIX}${code}`;
    seenCode.add(code);
    const card: CatalogCard = {
      id,
      set: set.id,
      num: code,
      name: row.name,
      cat: ygoCategory(row.type),
      pc: row.pc,
      frame: row.frame,
      sub: row.type,
    };
    if (row.attr) card.types = [row.attr];
    if (rarity) card.rarity = rarity;
    if (row.race) card.race = row.race;
    if (row.lv !== undefined) card.lv = row.lv;
    if (row.atk !== undefined) card.atk = row.atk;
    if (row.def !== undefined) card.def = row.def;
    if (row.arc) card.arc = row.arc;
    if (row.alt?.length) card.alt = row.alt;
    cards.push(card);
  }

  return { version: file.version, builtAt: file.builtAt, game: 'ygo', sets, cards };
}

/** Human label for the level-like stat by frame: "Level 7", "Rank 4", "Link 2". */
export function levelLabel(card: Pick<CatalogCard, 'frame'>): string {
  const f = card.frame ?? '';
  if (f.startsWith('xyz')) return 'Rank';
  if (f === 'link') return 'Link';
  return 'Level';
}
