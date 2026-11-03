/**
 * A game profile: everything that differs between the card games CardCodex
 * tracks. The data layer, scanner pipeline, collection store and most pages
 * are game-neutral and consult the active profile (src/games/index.ts) for
 * the rest: how to load the catalog, how a card is pictured and described,
 * what the first tab browses, and how OCR lines are matched to cards.
 */
import type { ComponentType, ReactNode } from 'react';
import type { CatalogIndex } from '@/data/catalog';
import type { CardCategory, CatalogCard, CatalogSet } from '@/data/types';
import type { ScanMatcher } from '@/scanner/types';
import type { DeckRules } from './deck-rules';
import type { GameId } from './ids';

export interface IconProps {
  size?: number;
  className?: string;
}

/** One row of the card page's facts list. */
export interface Fact {
  label: string;
  value: ReactNode;
}

/** A browse-tab group surfaced by Search ("Pikachu #0025", "Blue-Eyes · 87 cards"). */
export interface QuickGroup {
  key: string;
  name: string;
  sub?: string;
  href: string;
  img?: string;
  /** Render the image with pixelated scaling (sprites). */
  pixel?: boolean;
}

export interface GameText {
  searchPlaceholder: string;
  /** Search subtitle before a query is typed. */
  searchSubtitle: string;
  searchEmptyHint: string;
  searchFindHint: string;
  /** Single-card scanner intro paragraph. */
  scanIntro: string;
  /** Hint under the live camera view. */
  scanHint: string;
  /** Hint when a photo yields no match. */
  scanPhotoHint: string;
  tourWelcome: string;
  tourBrowseTitle: string;
  tourBrowse: string;
  tourSearch: string;
  tourScan: string;
  /** Settings → Catalog: where the data and images come from. */
  credits: string;
  /** Settings → About: trademark disclaimer. */
  disclaimer: string;
}

export interface GameProfile {
  id: GameId;
  /** Full name, e.g. "Pokémon TCG". */
  name: string;
  /** Short name for chips and labels, e.g. "Pokémon". */
  short: string;
  Icon: ComponentType<IconProps>;
  /** Fetches this game's catalog files and builds the index. */
  load(): Promise<CatalogIndex>;
  /** Physical card size in millimetres (binder-page guide geometry). */
  cardMm: { w: number; h: number };
  /** First (browse) tab. */
  browse: { path: string; label: string; Icon: ComponentType<IconProps> };
  /** Card categories offered as search chips, in display order. */
  categories: readonly CardCategory[];
  /** Label for `CatalogCard.types` ("Type" for energy types, "Attribute" for Yu-Gi-Oh!). */
  typeLabel: string;
  TypeIcon: ComponentType<{ type: string; size?: number }>;
  /** Label for `CatalogSet.series` ("Series", "Year"). */
  seriesLabel: string;
  /** Plural noun for the collection stat counting `groupsOf` ("species", "archetypes"). */
  groupLabel: string;
  /** Rows of the card page's facts list, after Set and Number. */
  facts(card: CatalogCard, set: CatalogSet, index: CatalogIndex): Fact[];
  /** Browse groups matching a search query (shown above card results). */
  quickGroups(index: CatalogIndex, query: string): QuickGroup[];
  text: GameText;
  /** Deck sections, copy limits and size reminders (src/games/deck-rules.ts). */
  deckRules: DeckRules;
  /** The OCR-lines → card candidates matcher for this game's catalog. */
  createMatcher(index: CatalogIndex): ScanMatcher;
}
