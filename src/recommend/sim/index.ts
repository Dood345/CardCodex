/**
 * The playtest simulator: seeded practice draws and head-to-head races for
 * Pokémon decks, read from the evaluator's card features. See
 * docs/deck-playtest.md.
 */
import type { PokemonEvaluator } from '../pokemon';
import { duel } from './duel';
import { playtest } from './playtest';
import type { DeckSimulator } from './types';

export type { DeckSimulator, DuelOptions, DuelReport, PlaytestOptions, PlaytestReport, PokemonPlaytestReport, UnreadCard } from './types';
export { wilson } from './types';
export { playtest } from './playtest';
export { duel, duelGame, type DuelGame } from './duel';
export { dealOpening, drawNext, type PracticeDeal } from './practice';
export { POKEMON_RULES_PAR_2023, prizeValue, type PokemonRuleSet } from './rules';

/** The Pokémon simulator behind the game-neutral interface. */
export function createPokemonSimulator(ev: PokemonEvaluator): DeckSimulator {
  return {
    game: 'pokemon',
    playtest: (cards, options) => playtest(ev, cards, options),
    duel: (a, b, options) => duel(ev, a, b, options),
  };
}
