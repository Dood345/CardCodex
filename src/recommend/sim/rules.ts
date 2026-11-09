/**
 * The Pokémon TCG rules the simulator plays by, as one named config so a rule
 * can be checked against its source and corrected. Every field cites the
 * page of the official rulebook it comes from: "Pokémon Trading Card Game
 * Rules", Scarlet & Violet—Paradox Rift edition (2023),
 * https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/rulebook/par_rulebook_en.pdf
 * (docs/deck-playtest.md lists them again with the quotes).
 *
 * Effects printed on cards (Rare Candy's "not during your first turn",
 * Abilities that end the turn) come from the cards' own text instead and are
 * read in effects.ts.
 */

export interface PokemonRuleSet {
  id: string;
  name: string;
  source: string;
  /** p. 8: "Shuffle your 60-card deck and draw the top 7 cards." */
  deckSize: number;
  openingHand: number;
  /** p. 8, step 7: "Put the top 6 cards of your deck off to the side face down as your Prize cards." */
  prizes: number;
  /** p. 10: "Your Bench can hold up to 5 Pokémon." */
  benchSize: number;
  /** p. 8 and p. 18: no Basic Pokémon in the opening hand → reveal, shuffle back, draw 7 again; the opponent may draw 1 card per extra mulligan. */
  opponentDrawsPerMulligan: number;
  /** p. 13: "On the first turn of the game, the starting player skips this step [attack]." */
  firstPlayerAttacksTurn1: boolean;
  /** p. 12: "The player who goes first cannot play a Supporter card on their first turn." */
  firstPlayerSupporterTurn1: boolean;
  /** p. 9–10: every turn starts with "Draw a card"; the rulebook makes no exception for the starting player. */
  firstPlayerDrawsTurn1: boolean;
  /** p. 11: "neither player can evolve a Pokémon on that player's first turn unless a card says so." */
  evolveOnOwnFirstTurn: boolean;
  /** p. 11: "Neither player can evolve a Pokémon on its first turn in play." (Evolving makes it new in play again.) */
  evolveOnTurnPlayed: boolean;
  /** p. 9: attach an Energy card "once per turn"; one Supporter and one Stadium per turn; retreat "only once per turn". */
  energyPerTurn: number;
  supportersPerTurn: number;
  retreatsPerTurn: number;
  /** p. 10: "If there are no cards in your deck at the beginning of your turn and you cannot draw a card, the game is over, and your opponent wins." */
  deckOutLoses: boolean;
  /** p. 14: when a knocked-out player has no Benched Pokémon to promote, the other player wins. */
  noPokemonLoses: boolean;
}

export const POKEMON_RULES_PAR_2023: PokemonRuleSet = {
  id: 'pokemon-par-2023',
  name: 'Pokémon TCG rulebook, Scarlet & Violet—Paradox Rift (2023)',
  source: 'https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/rulebook/par_rulebook_en.pdf',
  deckSize: 60,
  openingHand: 7,
  prizes: 6,
  benchSize: 5,
  opponentDrawsPerMulligan: 1,
  firstPlayerAttacksTurn1: false,
  firstPlayerSupporterTurn1: false,
  firstPlayerDrawsTurn1: true,
  evolveOnOwnFirstTurn: false,
  evolveOnTurnPlayed: false,
  energyPerTurn: 1,
  supportersPerTurn: 1,
  retreatsPerTurn: 1,
  deckOutLoses: true,
  noPokemonLoses: true,
};

/**
 * Prize cards the opponent takes when this Pokémon is Knocked Out, from the
 * name (TCGdex's text has no rule boxes, so the kind is read from the name;
 * TCGdex writes most GX and EX names with a space, "Charizard EX", a few with
 * the printed hyphen):
 *   3: Pokémon VMAX (appendix 10, p. 27), V-UNION (appendix 7, p. 26),
 *      TAG TEAM (appendix 13, p. 29: names joined by "&" ending in -GX),
 *      Mega Evolution Pokémon ex (2025 onward: the card's printed rule box;
 *      not in the 2023 rulebook, see docs/deck-playtest.md)
 *   2: Pokémon ex (appendix 2, p. 23; Tera ex appendix 3, p. 24), Pokémon V
 *      (appendix 9, p. 27), VSTAR (appendix 6, p. 25), Pokémon-GX (appendix
 *      16, p. 31), Pokémon-EX including Mega Evolution EX (appendices 22–23,
 *      p. 35–36)
 *   1: everything else (p. 14: "takes 1 of their own Prize cards"), Radiant
 *      Pokémon included (appendix 5, p. 25 gives them no prize rule). LEGEND
 *      cards (2010) are not in this rulebook and count 1 here.
 */
export function prizeValue(name: string): number {
  if (/^Mega .* ex$/.test(name)) return 3;
  if (/ VMAX$| V-UNION$/.test(name)) return 3;
  if (/&.*[- ]GX$/.test(name)) return 3;
  if (/ ex$|[- ]EX$|[- ]GX$| V$| VSTAR$/.test(name)) return 2;
  return 1;
}
