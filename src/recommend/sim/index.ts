/**
 * The playtest simulator: seeded practice draws and (milestone 2) head-to-head
 * races for Pokémon decks, read from the evaluator's card features. See
 * docs/deck-playtest.md.
 */
export type { DeckSimulator, DuelOptions, DuelReport, PlaytestOptions, PlaytestReport, PokemonPlaytestReport, UnreadCard } from './types';
export { wilson } from './types';
export { playtest } from './playtest';
export { dealOpening, drawNext, type PracticeDeal } from './practice';
export { POKEMON_RULES_PAR_2023, prizeValue, type PokemonRuleSet } from './rules';
