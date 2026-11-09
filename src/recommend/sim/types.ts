/**
 * The playtest simulator's contract, game-neutral where it can be: a game
 * supplies a DeckSimulator (Pokémon: src/recommend/sim/pokemon-sim.ts) that
 * plays seeded games with a greedy pilot and reports how the deck performs.
 * "Online" is the moment the deck does what it is built to do: the main
 * attacker attacks (Pokémon), a starter opens its combo without bricking
 * (Yu-Gi-Oh!), the curve is cast (Magic).
 */
import type { DeckCard } from '@/data/db';
import type { GameId } from '@/games/ids';

export interface PlaytestOptions {
  /** Games to play. */
  games: number;
  seed: number;
  /** Own turns per game (default 6). */
  turns?: number;
  /** Who goes first: alternating by game (default), always first, always second. */
  first?: 'alternate' | 'first' | 'second';
}

/** A card the pilot cannot read, so it never plays it. */
export interface UnreadCard {
  id: string;
  name: string;
  copies: number;
  /** What kind of effect it is ("gust", "tool", "condition", "coin flips", "other", …). */
  reason: string;
}

export interface PlaytestReport {
  game: GameId;
  games: number;
  seed: number;
  turns: number;
  /** What the pilot plays toward, one line. */
  plan: string;
  /** True when the deck cannot start a game at all (Pokémon: no Basic Pokémon); every rate is then 0. */
  cannotOpen: boolean;
  /** Share of games whose first opening hand had to be redrawn. */
  mulliganRate: number;
  meanMulligans: number;
  /** onlineBy[t - 1]: share of games where the plan came online by the player's own turn t. */
  onlineBy: number[];
  /** Mean own turn the plan first came online; games where it never did count as turns + 1. */
  meanOnlineTurn: number;
  /** Share of turns in which the pilot had nothing to play (no card from the hand, no Ability). */
  deadTurnRate: number;
  /** Share of games where a card the plan needs was out of reach from the start (Pokémon: every copy in the Prize cards). */
  keyPieceStuckRate: number;
  /** Cards the pilot cannot read, by copies. */
  unread: UnreadCard[];
  unreadCopies: number;
  /** Unread cards drawn per game (opening hand included): how often a blind spot is in hand. */
  unreadDrawsPerGame: number;
  /** Wall time of the run. */
  ms: number;
}

export interface PokemonPlaytestReport extends PlaytestReport {
  game: 'pokemon';
  /** Mean damage per own turn over the first six turns (or `turns`, when fewer), attack damage as printed. */
  meanDamagePerTurn: number;
  /** Mean damage on each own turn. */
  damageByTurn: number[];
}

export interface DuelOptions {
  games: number;
  seed: number;
  /** Turns (both players' together) before a game is called a draw (default 60). */
  maxTurns?: number;
}

export interface DuelReport {
  game: GameId;
  games: number;
  seed: number;
  /** Games deck A won, lost, and drew (turn limit or both winning at once). */
  wins: number;
  losses: number;
  draws: number;
  /** Deck A's win rate, a draw counting half. */
  winRate: number;
  /** 95% Wilson score interval of the win rate. */
  ci: [number, number];
  /** Share of games the player going first won (draws half). */
  firstPlayerWinRate: number;
  /** Mean game length in turns, both players' together. */
  meanTurns: number;
  /** Mean of A's score minus B's at the end (Pokémon: Prize cards taken). */
  meanScoreDiff: number;
  /** How games ended, by reason. */
  endings: Record<string, number>;
  planA: string;
  planB: string;
  ms: number;
}

/** A game's simulator. */
export interface DeckSimulator {
  game: GameId;
  playtest(cards: readonly DeckCard[], options: PlaytestOptions): PlaytestReport;
  duel(a: readonly DeckCard[], b: readonly DeckCard[], options: DuelOptions): DuelReport;
}

/** 95% Wilson score interval for `p` observed over `n` trials. */
export function wilson(p: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const z2 = z * z;
  const mid = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}
