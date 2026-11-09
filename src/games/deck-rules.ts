/**
 * Deck rules per game: the sections a deck has (Pokémon one of 60 cards;
 * Yu-Gi-Oh! Main 40–60, Extra 0–15, Side 0–15; Magic 60 or more and a sideboard of 0–15), which section a deck line
 * belongs to, and how many copies of a card a deck may hold. Pure (no React)
 * so the data layer and the tests use it directly; each game profile points
 * at its rules (`GameProfile.deckRules`). Nothing here is enforced: the deck
 * page shows the rules as reminders.
 */
import type { DeckCard } from '@/data/db';
import type { CatalogCard } from '@/data/types';
import { isBasicLand } from './mtg/catalog';

export type DeckSectionId = 'main' | 'extra' | 'side';

export interface DeckSection {
  id: DeckSectionId;
  label: string;
  min: number;
  max: number;
  /** The reminder when the section is outside its size range, e.g. "A Yu-Gi-Oh! main deck has 40–60 cards". */
  hint: string;
}

export interface DeckRules {
  /** Sections in display order; the first is where a new card goes unless `sectionOf` says otherwise. */
  sections: readonly DeckSection[];
  /** True when a line can be moved to and from the side deck (a stored `zone: 'side'`). */
  side: boolean;
  /** Which section a deck line belongs to. `card` is undefined for a card the catalog does not know. */
  sectionOf(card: CatalogCard | undefined, line: Pick<DeckCard, 'zone'>): DeckSectionId;
  /** Copies of one card (by name, over every printing and section) a deck may hold; Infinity for no limit. */
  copyLimit(card: CatalogCard): number;
  /** Reminder heading for cards over the limit: "3 copies at most". */
  limitHint: string;
}

/* ---------- Pokémon ---------- */

const BASIC_ENERGY = /^(?:Basic )?(?:Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy) Energy$/;

/**
 * Basic Energy, which a Pokémon deck may run any number of. TCGdex marks a
 * card as basic Energy (`stage: 'Basic'`) on a minority of prints only, so
 * the printed name decides as well. One exception: from Neo Genesis to
 * HeartGold SoulSilver, "Darkness Energy" and "Metal Energy" were Special
 * Energy, printed Rare or Uncommon, and count toward the four-copy limit.
 */
export function isBasicEnergy(card: Pick<CatalogCard, 'cat' | 'name' | 'stage' | 'rarity'>): boolean {
  if (card.cat !== 'Energy') return false;
  if (card.stage === 'Basic') return true;
  if (!BASIC_ENERGY.test(card.name)) return false;
  if (/^(?:Darkness|Metal) Energy$/.test(card.name) && (card.rarity === 'Rare' || card.rarity === 'Uncommon')) return false;
  return true;
}

export const POKEMON_DECK_RULES: DeckRules = {
  sections: [{ id: 'main', label: 'Deck', min: 60, max: 60, hint: 'A Pokémon deck has 60 cards' }],
  side: false,
  sectionOf: () => 'main',
  copyLimit: (card) => (isBasicEnergy(card) ? Infinity : 4),
  limitHint: '4 copies at most',
};

/* ---------- Yu-Gi-Oh! ---------- */

/** API frame types of the monsters that live in the Extra deck (src/games/ygo/catalog.ts keeps the frame). */
const EXTRA_FRAMES = new Set(['fusion', 'synchro', 'xyz', 'link', 'fusion_pendulum', 'synchro_pendulum', 'xyz_pendulum']);

export function isExtraDeckCard(card: Pick<CatalogCard, 'frame'> | undefined): boolean {
  return !!card?.frame && EXTRA_FRAMES.has(card.frame);
}

export const YGO_DECK_RULES: DeckRules = {
  sections: [
    { id: 'main', label: 'Main', min: 40, max: 60, hint: 'A Yu-Gi-Oh! main deck has 40–60 cards' },
    { id: 'extra', label: 'Extra', min: 0, max: 15, hint: 'An Extra deck has at most 15 cards' },
    { id: 'side', label: 'Side', min: 0, max: 15, hint: 'A Side deck has at most 15 cards' },
  ],
  side: true,
  sectionOf: (card, line) => (line.zone === 'side' ? 'side' : isExtraDeckCard(card) ? 'extra' : 'main'),
  copyLimit: () => 3,
  limitHint: '3 copies at most',
};

/* ---------- Magic: The Gathering ---------- */

/**
 * Constructed: at least 60 cards and a sideboard of at most 15, four copies of
 * a card at most over both, any number of basic lands.
 */
export const MTG_DECK_RULES: DeckRules = {
  sections: [
    { id: 'main', label: 'Deck', min: 60, max: Infinity, hint: 'A Magic deck has at least 60 cards' },
    { id: 'side', label: 'Sideboard', min: 0, max: 15, hint: 'A sideboard has at most 15 cards' },
  ],
  side: true,
  sectionOf: (_card, line) => (line.zone === 'side' ? 'side' : 'main'),
  copyLimit: (card) => (isBasicLand(card) ? Infinity : 4),
  limitHint: '4 copies at most',
};

/** The size reminder for one section, or null when its count is in range. */
export function sectionHint(section: DeckSection, total: number): string | null {
  if (total >= section.min && total <= section.max) return null;
  return total < section.min ? `${section.hint}: ${section.min - total} to go.` : `${section.hint}: ${total - section.max} over.`;
}
