/**
 * Card rules text: the attacks, Abilities, Trainer and Energy effects and the
 * printing's legality, shipped as public/data/text.json (scripts/build-text.mjs)
 * and loaded only by the deck recommender. The Pokédex, search and scanner
 * never need it, so it stays out of the catalog.
 *
 * The file holds every distinct text once and, per card that has one, parallel
 * arrays: card id, text index, regulation mark and legality bits. Reprints
 * share a text; the mark and legality belong to the printing.
 */
import { fetchDataJson } from '@/data/catalog';
import type { GameId } from '@/games/ids';

export interface AttackText {
  /** Cost as one letter per Energy ("RRC"); see COST_LETTERS. "" for a free attack. */
  c: string;
  n: string;
  /** Damage as printed: "10", "30+", "20×", "" when none. */
  d?: string;
  e?: string;
}

export interface AbilityText {
  /** "Ability", "Poké-Power", "Poké-Body", "Pokemon Power", "Ancient Trait", ... */
  k: string;
  n: string;
  e: string;
}

export interface CardText {
  a?: AttackText[];
  b?: AbilityText[];
  /** Weaknesses as [type, value, type, value, ...]. */
  w?: string[];
  r?: string[];
  /** Retreat cost. */
  rc?: number;
  /** Name of the card this one evolves from. */
  ev?: string;
  /** Trainer or Special Energy effect text. */
  fx?: string;
  /** Trainer type: "Item", "Supporter", "Stadium", "Tool", ... */
  tt?: string;
  /** Energy type: "Normal" (basic) or "Special". */
  et?: string;
}

export interface CardTextFile {
  version: number;
  builtAt: string;
  game: GameId;
  texts: CardText[];
  ids: string[];
  ti: number[];
  mk: string[];
  /** Bit 1: Standard-legal, bit 2: Expanded-legal (as TCGdex reports them). */
  lg: number[];
}

export interface CardTextEntry {
  text: CardText;
  /** Regulation mark ("G"), "" when the printing has none. */
  mark: string;
  standard: boolean;
  expanded: boolean;
}

export interface CardTextIndex {
  game: GameId;
  builtAt: string;
  byId: Map<string, CardTextEntry>;
}

/** One letter per Energy type, as deck lists write attack costs. Mirrors scripts/build-text.mjs. */
export const COST_LETTERS: Readonly<Record<string, string>> = {
  Grass: 'G',
  Fire: 'R',
  Water: 'W',
  Lightning: 'L',
  Psychic: 'P',
  Fighting: 'F',
  Darkness: 'D',
  Metal: 'M',
  Fairy: 'Y',
  Dragon: 'N',
  Colorless: 'C',
};

/** Energy type name of a cost letter. */
export const TYPE_OF_LETTER: ReadonlyMap<string, string> = new Map(Object.entries(COST_LETTERS).map(([t, l]) => [l, t]));

/** Energy symbols in an attack cost ("RRC" → 3; a braced unknown type counts once). */
export function costCount(cost: string): number {
  return cost.replace(/\{[^}]*\}/g, 'X').length;
}

/** The typed (non-Colorless) letters of a cost, each once. */
export function costTypes(cost: string): string[] {
  const out = new Set<string>();
  for (const ch of cost.replace(/\{[^}]*\}/g, '')) if (ch !== 'C') out.add(ch);
  return [...out];
}

/** The leading number of a printed damage ("30+" → 30, "20×" → 20, "" → 0). */
export function damageValue(d: string | undefined): number {
  const m = /^\d+/.exec(d ?? '');
  return m ? Number(m[0]) : 0;
}

export function buildTextIndex(file: CardTextFile): CardTextIndex {
  const byId = new Map<string, CardTextEntry>();
  for (let i = 0; i < file.ids.length; i++) {
    const text = file.texts[file.ti[i]];
    if (!text) continue;
    const bits = file.lg[i] ?? 0;
    byId.set(file.ids[i], { text, mark: file.mk[i] ?? '', standard: (bits & 1) !== 0, expanded: (bits & 2) !== 0 });
  }
  return { game: file.game, builtAt: file.builtAt, byId };
}

/** The data file (under public/data) holding a game's card text, or null when the game has none yet. */
export function textFileFor(game: GameId): string | null {
  return game === 'pokemon' ? 'text.json' : null;
}

const loaded = new Map<GameId, Promise<CardTextIndex | null>>();

/** The game's card text, fetched once; null when the game has no text file. */
export function loadCardText(game: GameId): Promise<CardTextIndex | null> {
  const file = textFileFor(game);
  if (!file) return Promise.resolve(null);
  let p = loaded.get(game);
  if (!p) {
    p = fetchDataJson<CardTextFile>(file).then((f) => (f.game === game ? buildTextIndex(f) : null));
    loaded.set(game, p);
  }
  return p;
}
