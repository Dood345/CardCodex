/**
 * The playtest simulator as judges: instead of counting a deck's cards, play
 * it (src/recommend/sim) and rate what happened. One seeded run per deck is
 * shared by the judges.
 */
import type { DeckCard } from '@/data/db';
import type { PokemonEvaluator } from '../pokemon';
import { duel, playtest } from '../sim';
import type { PokemonPlaytestReport } from '../sim';
import type { BenchDeck, Corpus, Judge } from './bench';

export interface PlaytestJudgeOptions {
  /** Games per deck (default 200: about 35 ms a deck on a desktop). */
  games?: number;
  seed?: number;
}

export function playtestJudges(ev: PokemonEvaluator, options: PlaytestJudgeOptions = {}): Judge[] {
  const games = options.games ?? 200;
  const seed = options.seed ?? 1;
  const cache = new WeakMap<readonly DeckCard[], PokemonPlaytestReport>();
  const run = (cards: readonly DeckCard[]) => {
    let r = cache.get(cards);
    if (!r) cache.set(cards, (r = playtest(ev, cards, { games, seed })));
    return r;
  };
  return [
    { id: 'sim:online3', label: 'Attacking by turn 3', rate: (c) => run(c).onlineBy[2] ?? 0 },
    { id: 'sim:online4', label: 'Attacking by turn 4', rate: (c) => run(c).onlineBy[3] ?? 0 },
    { id: 'sim:damage', label: 'Damage per turn', rate: (c) => run(c).meanDamagePerTurn },
    { id: 'sim:live', label: 'Turns with a play', rate: (c) => 1 - run(c).deadTurnRate },
  ];
}

export interface DuelJudgeOptions {
  /** Decks of the corpus that make up the field, an even sample (default 10). */
  field?: number;
  /** Games per pairing (default 30). */
  games?: number;
  seed?: number;
}

/**
 * Winning as a judge: a deck's rating is its mean simulated win rate against
 * a field, an even sample of the corpus's own decks. A deck that is in the
 * field does not play itself. This is the judge to compare with real
 * results: when the corpus knows how its decks did, the report's strength
 * column says how well simulated wins follow real ones.
 */
export function duelJudge(ev: PokemonEvaluator, corpus: Corpus, options: DuelJudgeOptions = {}): Judge {
  const games = options.games ?? 30;
  const seed = options.seed ?? 1;
  const step = Math.max(1, Math.ceil(corpus.decks.length / (options.field ?? 10)));
  const field: BenchDeck[] = corpus.decks.filter((_, i) => i % step === 0);
  const cache = new WeakMap<readonly DeckCard[], number>();
  return {
    id: 'sim:duel',
    label: 'Wins against the field',
    rate(cards) {
      let r = cache.get(cards);
      if (r === undefined) {
        let sum = 0;
        let n = 0;
        for (const f of field) {
          if (f.cards === cards) continue;
          sum += duel(ev, cards, f.cards, { games, seed }).winRate;
          n++;
        }
        cache.set(cards, (r = n ? sum / n : 0.5));
      }
      return r;
    },
  };
}

/** A duel function for `roundRobin`: the share of simulated games deck A wins against deck B. */
export function simulatedDuel(ev: PokemonEvaluator, options: { games?: number; seed?: number } = {}): (a: BenchDeck, b: BenchDeck) => number {
  return (a, b) => duel(ev, a.cards, b.cards, { games: options.games ?? 30, seed: options.seed ?? 1 }).winRate;
}
