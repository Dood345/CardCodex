/**
 * The Pokémon evaluator's playtest: the simulator's report (src/recommend/sim)
 * boiled down to what the screens show and the one number the tuner climbs.
 *
 * The value is the mean damage per turn over the first six turns, scaled by
 * how often the deck had a play: it rewards a deck whose attacker attacks
 * early, keeps attacking and does not stall, which is what the opening turns
 * of a game are about. It is a solo measure: no opponent, no prizes.
 */
import type { DeckCard } from '@/data/db';
import type { PokemonEvaluator } from './pokemon';
import { playtest } from './sim';
import type { DeckEvaluator, PlayOptions, PlaySummary } from './types';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function pokemonPlaytest(ev: PokemonEvaluator, cards: readonly DeckCard[], options: PlayOptions): PlaySummary {
  const r = playtest(ev, cards, { games: options.games, seed: options.seed });
  if (r.cannotOpen) {
    return { value: 0, plan: '', lines: ['The deck cannot start a game: it has no Basic Pokémon.'], games: r.games };
  }
  const lines = [
    `Attacks by turn 3 in ${pct(r.onlineBy[2] ?? 0)} of games, by turn 4 in ${pct(r.onlineBy[3] ?? 0)}`,
    `${Math.round(r.meanDamagePerTurn)} damage a turn over the first ${r.turns} turns`,
    `Something to play on ${pct(1 - r.deadTurnRate)} of turns`,
    `Opening hand redrawn in ${pct(r.mulliganRate)} of games`,
  ];
  if (r.keyPieceStuckRate >= 0.03) lines.push(`A piece the plan needs is stuck in the Prize cards in ${pct(r.keyPieceStuckRate)} of games`);
  if (r.unreadCopies > 0) {
    const names = r.unread
      .slice(0, 3)
      .map((u) => u.name)
      .join(', ');
    lines.push(`The test pilot cannot use ${r.unreadCopies} of the cards (${names}${r.unread.length > 3 ? ', …' : ''}), so they count as blanks`);
  }
  return { value: r.meanDamagePerTurn * (0.7 + 0.3 * (1 - r.deadTurnRate)), plan: r.plan, lines, games: r.games };
}

/** The evaluator with its playtest attached. */
export function withPokemonPlaytest(ev: PokemonEvaluator): PokemonEvaluator & Required<Pick<DeckEvaluator, 'playtest'>> {
  return { ...ev, playtest: (cards, options) => pokemonPlaytest(ev, cards, options) };
}
