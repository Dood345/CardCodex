/**
 * Catalog schema shared by the build script (scripts/build-catalog.mjs), the
 * app, and the scanner. The catalog is a prebuilt, offline snapshot of every
 * English Pokémon TCG card (source: TCGdex) plus the National Pokédex species
 * list (source: PokéAPI). It ships as static JSON in public/data/.
 *
 * Field names are deliberately short: the card list has ~24k entries.
 */

export type CardCategory = 'Pokemon' | 'Trainer' | 'Energy';

export interface CatalogSet {
  /** TCGdex set id, e.g. "sv01", "swsh3", "base1". Card ids are `${set}-${num}`. */
  id: string;
  /** Display name, e.g. "Scarlet & Violet". */
  name: string;
  /** Series id, e.g. "sv". Also the first path segment of image URLs. */
  series: string;
  /** Series display name, e.g. "Scarlet & Violet". */
  seriesName: string;
  /** ISO date "YYYY-MM-DD", or "" when unknown. */
  releaseDate: string;
  /** Printed card count: the denominator on the card ("123/198" → 198). */
  official: number;
  /** Total cards in the set including secret rares. */
  total: number;
  /** Official set abbreviation printed on modern cards (e.g. "SVI"), or "". */
  abbr: string;
  /** True when TCGdex hosts a logo at `${ASSETS}/${series}/${id}/logo.webp`. */
  logo?: boolean;
  /** True when TCGdex hosts a symbol at `${ASSETS}/${series}/${id}/symbol.webp`. */
  symbol?: boolean;
}

export interface CatalogCard {
  /** TCGdex card id: `${set}-${num}`, e.g. "sv01-1". */
  id: string;
  /** Set id (CatalogSet.id). */
  set: string;
  /** Local number as printed, e.g. "1", "TG01", "SV001", "H3". */
  num: string;
  /** Card name as printed, e.g. "Pikachu ex", "Professor's Research". */
  name: string;
  cat: CardCategory;
  /** National Pokédex ids featured on the card (Pokémon cards only). */
  dex?: number[];
  /** TCG energy types, e.g. ["Lightning"]. */
  types?: string[];
  /** Rarity string as given by TCGdex, e.g. "Common", "Double Rare". */
  rarity?: string;
  hp?: number;
  /** "Basic" | "Stage1" | "Stage2" | "VMAX" | ... as given by TCGdex. */
  stage?: string;
  /**
   * Image flag. When true the image lives at the predictable TCGdex path
   * `${ASSETS}/${series}/${set}/${num}/{low|high}.webp` (see cardImageUrl).
   * When a string, it is a full base URL that must be used instead (rare).
   * Absent when TCGdex has no image for the card.
   */
  img?: true | string;
}

export interface Species {
  /** National Pokédex number, 1..1025. */
  id: number;
  /** English name, e.g. "Mr. Mime", "Farfetch'd", "Nidoran♀". */
  name: string;
  /** Generation 1..9. */
  gen: number;
  /** Game types of the default form, lowercase, e.g. ["grass","poison"]. */
  types: string[];
}

export interface Catalog {
  /** Schema version. Bump when field semantics change. */
  version: number;
  /** ISO timestamp of the build. */
  builtAt: string;
  sets: CatalogSet[];
  cards: CatalogCard[];
}

export interface SpeciesFile {
  version: number;
  builtAt: string;
  species: Species[];
}

/** Base of per-language TCGdex assets (card images, set logos). */
export const TCGDEX_ASSETS = 'https://assets.tcgdex.net/en';
/** PokéAPI sprite repository. */
export const POKEAPI_SPRITES =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

export type ImageQuality = 'low' | 'high';

/** URL of a card's image, or undefined when the catalog has none. */
export function cardImageUrl(
  card: Pick<CatalogCard, 'img' | 'set' | 'num'>,
  series: string,
  quality: ImageQuality = 'low',
): string | undefined {
  if (!card.img) return undefined;
  const base = card.img === true ? `${TCGDEX_ASSETS}/${series}/${card.set}/${card.num}` : card.img;
  return `${base}/${quality}.webp`;
}

/** Small pixel sprite (96px) used as the Pokédex icon. */
export function speciesSpriteUrl(id: number): string {
  return `${POKEAPI_SPRITES}/${id}.png`;
}

/** Large official artwork used on the species page. */
export function speciesArtworkUrl(id: number): string {
  return `${POKEAPI_SPRITES}/other/official-artwork/${id}.png`;
}

export function setLogoUrl(set: CatalogSet): string | undefined {
  return set.logo ? `${TCGDEX_ASSETS}/${set.series}/${set.id}/logo.webp` : undefined;
}

export function setSymbolUrl(set: CatalogSet): string | undefined {
  return set.symbol ? `${TCGDEX_ASSETS}/${set.series}/${set.id}/symbol.webp` : undefined;
}
