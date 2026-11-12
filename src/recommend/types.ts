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
  /** The format the screens start on; without one they start on "any". */
  default?: boolean;
}

export interface BuildOptions {
  /** Where cards may come from: the collection only, the whole catalog, or the catalog with owned cards preferred. */
  source: 'collection' | 'catalog' | 'prefer-collection';
  /** false: never choose an addition by playing the deck (the builder then goes by the score alone). */
  fillByPlay?: boolean;
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

export interface PlayOptions {
  games: number;
  seed: number;
}

/** What playing a deck some hundred times showed. */
export interface PlaySummary {
  /** One number, higher is better, comparable between decks of the game: what tuning climbs. */
  value: number;
  /** What the test pilot plays toward, one line ("Charizard ex's Burning Darkness"); "" when the deck cannot play. */
  plan: string;
  /** The findings, one line each, most important first. */
  lines: string[];
  games: number;
}

/** A practice deal: the opening hand of a shuffled deck, for trying a deck out by hand. Plain data, so a screen can keep it. */
export interface PracticeHand {
  /** Card ids in hand, in the order drawn. */
  hand: string[];
  /** Cards set aside face down at the start (Pokémon: the six Prize cards); empty in games without any. */
  aside: string[];
  /** What the set-aside cards are called ("Prize cards"). */
  asideLabel: string;
  /** The rest of the deck, top card first. */
  library: string[];
  /** Opening hands that had to be shuffled back (Pokémon: no Basic Pokémon). */
  redraws: number;
  /** A line about the deal when there is something to say ("Redrawn twice: no Basic Pokémon"). */
  note: string;
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
  /**
   * The evaluator to score and build with under a format, for a game whose rules change with it (the Yu-Gi-Oh!
   * Forbidden & Limited list sets the copy limits). Games whose formats only limit the pool leave this out.
   */
  forFormat?(format: DeckFormat): DeckEvaluator;
  /** Plays the deck against nobody, seeded, and reports how it went; only games with a simulator have it (src/recommend/sim). */
  playtest?(cards: readonly DeckCard[], options: PlayOptions): PlaySummary;
  /** Shuffles the deck from a seed and deals an opening hand by the game's rules. */
  practice?(cards: readonly DeckCard[], seed: number): PracticeHand;
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
