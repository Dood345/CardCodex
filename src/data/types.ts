/**
 * Catalog schema shared by the build scripts, the app, and the scanner.
 *
 * Catalogs are prebuilt, offline snapshots that ship as static JSON in
 * public/data/: every English Pokémon TCG card (source: TCGdex) plus the
 * National Pokédex species list (source: PokéAPI), and every Yu-Gi-Oh! TCG
 * printing (source: YGOPRODeck, see src/games/ygo/catalog.ts). One shape
 * serves both games; game-specific fields are optional.
 *
 * Field names are deliberately short: the card lists have 20–40k entries.
 */
import type { GameId } from '@/games/ids';

export type CardCategory =
  // Pokémon TCG
  | 'Pokemon'
  | 'Trainer'
  | 'Energy'
  // Yu-Gi-Oh! TCG
  | 'Monster'
  | 'Spell'
  | 'Trap'
  | 'Skill'
  | 'Token';

export interface CatalogSet {
  /** Set id: TCGdex id ("sv01") or the Yu-Gi-Oh! code slug ("lob"). Unique within a game. */
  id: string;
  /** Display name, e.g. "Scarlet & Violet". */
  name: string;
  /** Series id, e.g. "sv" (also the first path segment of TCGdex image URLs), or the release year for Yu-Gi-Oh!. */
  series: string;
  /** Series display name, e.g. "Scarlet & Violet" / "2002". */
  seriesName: string;
  /** ISO date "YYYY-MM-DD", or "" when unknown. */
  releaseDate: string;
  /** Printed card count: the denominator on the card ("123/198" → 198). 0 when the game has no such numbering. */
  official: number;
  /** Total cards in the set including secret rares. */
  total: number;
  /** Set abbreviation printed on the cards ("SVI", "LOB"), or "". */
  abbr: string;
  /** True when TCGdex hosts a logo at `${ASSETS}/${series}/${id}/logo.webp`. */
  logo?: boolean;
  /** True when TCGdex hosts a symbol at `${ASSETS}/${series}/${id}/symbol.webp`. */
  symbol?: boolean;
}

export interface CatalogCard {
  /** Globally unique id: TCGdex "sv01-1" for Pokémon, "ygo:LOB-EN001" for Yu-Gi-Oh! (see src/games/ids.ts). */
  id: string;
  /** Set id (CatalogSet.id). */
  set: string;
  /** Number as printed: "1", "TG01", "SV001" (Pokémon) or the full set code "LOB-EN001" (Yu-Gi-Oh!). */
  num: string;
  /** Card name as printed, e.g. "Pikachu ex", "Blue-Eyes White Dragon". */
  name: string;
  cat: CardCategory;
  /** TCG energy types ["Lightning"], or the monster attribute ["DARK"] for Yu-Gi-Oh!. */
  types?: string[];
  /** Rarity string as given by the source, e.g. "Common", "Double Rare", "Ultra Rare / Ultimate Rare". */
  rarity?: string;
  /**
   * Image flag (Pokémon). When true the image lives at the predictable TCGdex
   * path `${ASSETS}/${series}/${set}/${num}/{low|high}.webp` (see cardImageUrl).
   * When a string, it is a full base URL that must be used instead (rare).
   * Absent when TCGdex has no image for the card.
   */
  img?: true | string;

  /* ---- Pokémon TCG ---- */
  /** National Pokédex ids featured on the card (Pokémon cards only). */
  dex?: number[];
  hp?: number;
  /** "Basic" | "Stage1" | "Stage2" | "VMAX" | ... as given by TCGdex. */
  stage?: string;

  /* ---- Yu-Gi-Oh! TCG (one CatalogCard per printing) ---- */
  /** Passcode: the 8-digit number printed bottom-left; names the card across printings and its image. */
  pc?: number;
  /** Passcodes of alternate artworks of the same card. */
  alt?: number[];
  /** Monster type ("Dragon") or Spell/Trap subtype ("Quick-Play"). */
  race?: string;
  /** Level, Rank or Link rating (see `frame`). */
  lv?: number;
  atk?: number;
  def?: number;
  /** Archetype ("Blue-Eyes"). */
  arc?: string;
  /** Frame type: "normal" | "effect" | "fusion" | "synchro" | "xyz" | "link" | "ritual" | "*_pendulum" | "spell" | "trap" | "token" | "skill". */
  frame?: string;
  /** Full type string, e.g. "Flip Tuner Effect Monster". */
  sub?: string;
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
  /** Which game this catalog describes. Absent in the original Pokémon file. */
  game?: GameId;
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
/**
 * YGOPRODeck card images: `${base}/cards_small/${passcode}.jpg` (~168×245) and
 * `${base}/cards/${passcode}.jpg` (~813×1185). Their guide forbids hotlinking:
 * the app fetches each image once and keeps it on the device
 * (src/data/imageCache.ts). Settings can point at a self-hosted mirror.
 */
export const YGOPRODECK_IMAGES = 'https://images.ygoprodeck.com/images';

let ygoImageBase = YGOPRODECK_IMAGES;

/** Set the Yu-Gi-Oh! image base URL (empty/undefined = YGOPRODeck). */
export function configureYgoImages(base?: string): void {
  const b = (base ?? '').trim().replace(/\/+$/, '');
  ygoImageBase = b || YGOPRODECK_IMAGES;
}

export function ygoImageUrl(passcode: number, quality: ImageQuality = 'low'): string {
  return `${ygoImageBase}/${quality === 'high' ? 'cards' : 'cards_small'}/${passcode}.jpg`;
}

export type ImageQuality = 'low' | 'high';

/** URL of a card's image, or undefined when the catalog has none. */
export function cardImageUrl(
  card: Pick<CatalogCard, 'img' | 'set' | 'num' | 'pc'>,
  series: string,
  quality: ImageQuality = 'low',
): string | undefined {
  if (card.pc !== undefined) return ygoImageUrl(card.pc, quality);
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
