/**
 * The deck recommender's contract. A game supplies a DeckEvaluator (Pokémon:
 * src/recommend/pokemon.ts); the builder (src/recommend/builder.ts) is
 * game-neutral and turns the evaluator's score into suggestions and decks.
 *
 * The score is a weighted sum of parts, each 0..1 with a one-line detail the
 * UI shows as the reason for a suggestion. Nothing here learns from other
 * people's decks: the parts are rules of thumb computed from the cards' own
 * text, so the recommender can propose decks nobody has published.
 */
import type { CollectionMap } from '@/data/collection';
import type { DeckCard } from '@/data/db';
import type { CatalogCard } from '@/data/types';
import type { DeckRules } from '@/games/deck-rules';
import type { GameId } from '@/games/ids';

export interface ScorePart {
  id: string;
  label: string;
  /** 0..1. */
  score: number;
  /** Share of the total (the parts' weights add up to 100). */
  weight: number;
  /** One line: what was measured and the number behind it. */
  detail: string;
}

export interface DeckScore {
  /** 0..100. */
  total: number;
  parts: ScorePart[];
  /** Rule or format problems, each one line. */
  issues: string[];
}

/**
 * A format id the game's evaluator understands: "standard", "expanded" and
 * "any" for Pokémon; other games name their own. "any" (no format limit)
 * exists in every game.
 */
export type DeckFormat = string;

/** A format the user can pick, in the evaluator's display order. */
export interface FormatOption {
  id: DeckFormat;
  label: string;
}

export interface BuildOptions {
  /** Where cards may come from: the collection only, the whole catalog, or the catalog with owned cards preferred. */
  source: 'collection' | 'catalog' | 'prefer-collection';
  collection: CollectionMap;
  format: DeckFormat;
  /** Card names the builder should avoid (what the user's other decks already play), for variety. */
  avoid?: ReadonlySet<string>;
}

/** One change to a deck: add `add` (with any cards it requires), remove `remove`. */
export interface Move {
  add: CatalogCard[];
  remove: CatalogCard[];
  /** Relevance of the added card to the deck before the move (ties between equal scores go to the more relevant). */
  relevance?: number;
}

export interface Suggestion {
  move: Move;
  /** Score after the move. */
  total: number;
  /** Change of the total. */
  delta: number;
  /** The part that gained most, as "Evolution lines: 0% → 50%". */
  reason: string;
  /** That part's one-line detail after the move. */
  detail: string;
  /** The part behind the reason. */
  partId: string;
}

export interface DeckEvaluator {
  game: GameId;
  rules: DeckRules;
  /** The formats `BuildOptions.format` may name, "any" included; a game without formats leaves this out. */
  formats?: readonly FormatOption[];
  /**
   * Finishes a deck the builder filled section by section: given the built
   * main deck, returns the deck with whatever else the game wants (a
   * Yu-Gi-Oh! Extra Deck). The builder calls it once, after its last swap.
   */
  complete?(cards: readonly DeckCard[], options: BuildOptions, pool: readonly CatalogCard[]): DeckCard[];
  /** Cards of `pool` worth building a deck around, best first: what "Build a deck" offers before the user has picked a seed. */
  seedIdeas?(pool: readonly CatalogCard[], count: number): CatalogCard[];
  /** The catalog card behind a deck line's id. */
  card(id: string): CatalogCard | undefined;
  score(cards: readonly DeckCard[]): DeckScore;
  /** One printing per distinct card that the options allow, the builder's candidate pool. */
  pool(options: BuildOptions): CatalogCard[];
  /** Cards that must come along when `card` is added to `cards` (pre-evolutions), chosen from `pool`. */
  requirements(card: CatalogCard, cards: readonly DeckCard[], pool: readonly CatalogCard[]): CatalogCard[];
  /** The kind a card counts as when the builder shares its attention: "pokemon" (monsters, creatures), "trainer" (spells, traps), "energy" (lands). */
  kindOf(card: CatalogCard): 'pokemon' | 'trainer' | 'energy';
  /** How much each candidate has to do with the deck, 0..1, in the candidates' order; the builder scores only the most relevant. */
  relevance(cards: readonly DeckCard[], candidates: readonly CatalogCard[]): number[];
}
