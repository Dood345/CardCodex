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
import { dealOpening, playtest } from './sim';
import type { DeckEvaluator, PlayOptions, PlaySummary, PracticeHand } from './types';

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Cards whose effect is aimed at the other player's side or at damage taken: nothing to do in a solo game (unread kinds, and the effect kinds of readable cards that sat idle). */
const NEEDS_OPPONENT = new Set(['gust', 'heal', 'disrupt', 'discardOppEnergy', 'oppHandBottomDraw', 'oppDiscardTo', 'discardOppHand', 'millOpp', 'countersOpp', 'moveCounters']);

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
  // Two kinds of card do nothing in these games, for different reasons, and the report says which is which.
  // Healing is read now and sits idle in a solo game for want of damage: it joins the cards that need an opponent.
  const solo = [...r.unread.filter((u) => NEEDS_OPPONENT.has(u.reason)), ...r.idle.filter((u) => NEEDS_OPPONENT.has(u.reason))];
  const blind = r.unread.filter((u) => !NEEDS_OPPONENT.has(u.reason));
  const list = (us: typeof r.unread) => {
    const n = us.reduce((k, u) => k + u.copies, 0);
    const names = us
      .slice(0, 3)
      .map((u) => u.name)
      .join(', ');
    return { n, names: `${names}${us.length > 3 ? ', …' : ''}` };
  };
  if (solo.length) {
    const { n, names } = list(solo);
    lines.push(`${n} ${n === 1 ? 'card needs' : 'cards need'} an opponent to matter (${names}): with nobody across the table there is nothing to heal or disrupt, so ${n === 1 ? 'it sits' : 'they sit'} unused`);
  }
  if (blind.length) {
    const { n, names } = list(blind);
    lines.push(`The test pilot does not know how to play ${n} of the cards (${names}), so ${n === 1 ? 'it counts as a blank' : 'they count as blanks'}`);
  }
  return { value: r.meanDamagePerTurn * (0.7 + 0.3 * (1 - r.deadTurnRate)), plan: r.plan, lines, games: r.games };
}

/** A practice deal by the Pokémon rules: seven cards, redrawn while there is no Basic Pokémon, then six Prize cards. */
export function pokemonPractice(ev: PokemonEvaluator, cards: readonly DeckCard[], seed: number): PracticeHand {
  const d = dealOpening(ev, cards, seed);
  const n = d.mulligans.length;
  const note = !d.ok
    ? 'This deck has no Basic Pokémon, so no opening hand can be kept.'
    : n
      ? `Redrawn ${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`}: no Basic Pokémon in the first ${n === 1 ? 'hand' : 'hands'}.`
      : '';
  return { hand: d.hand, aside: d.prizes, asideLabel: 'Prize cards', library: d.library, redraws: n, note };
}

/** The evaluator with its playtest and practice deals attached. */
export function withPokemonPlaytest(ev: PokemonEvaluator): PokemonEvaluator & Required<Pick<DeckEvaluator, 'playtest' | 'practice'>> {
  return {
    ...ev,
    playtest: (cards, options) => pokemonPlaytest(ev, cards, options),
    practice: (cards, seed) => pokemonPractice(ev, cards, seed),
  };
}
