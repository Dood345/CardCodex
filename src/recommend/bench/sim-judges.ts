/**
 * The playtest simulator as judges: instead of counting a deck's cards, play
 * it (src/recommend/sim) and rate what happened. One seeded run per deck is
 * shared by the judges.
 */
import type { DeckCard } from '@/data/db';
import type { PokemonEvaluator } from '../pokemon';
import { playtest } from '../sim';
import type { PokemonPlaytestReport } from '../sim';
import type { Judge } from './bench';

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
