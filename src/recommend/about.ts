/**
 * "How decks are recommended", in plain words, for Settings → About: what the
 * deck check and "Build one for me" look at, how a suggestion is chosen, what
 * playing a deck adds, and what none of it can know. One text per game,
 * because the parts differ; about.test.ts holds each text to the part names
 * the game's evaluator really shows.
 */
import type { GameId } from '@/games/ids';
import { PLAY_GAMES } from './advice';

export interface AboutRecommender {
  /** What a deck is scored on, the parts in the order the deck check shows them. */
  parts: string;
  /** Paragraphs, in reading order. */
  paragraphs: string[];
}

const PARTS: Partial<Record<GameId, string>> = {
  pokemon:
    'the deck rules (60 cards; four copies of a card by name, Special Energy included, and any number of basic Energy; one ACE SPEC; one Radiant Pokémon), ' +
    'enough Basic Pokémon for the opening hand, ' +
    'evolution lines that are whole, Energy the attackers can use and in the amount their attacks cost, draw and search, ' +
    'power (the damage the best attack keeps up turn after turn, as its text says) against Pokémon of the same years, ' +
    'synergy (cards that name a type or a Pokémon have it in the deck), focus and era',
  ygo:
    'the deck rules and the TCG Forbidden & Limited list, consistency (the chance of opening no starter in five cards), ' +
    'bricks (cards that cannot be used on their own), cohesion around an archetype, interaction (hand traps, negation, removal), ' +
    'the Extra Deck (monsters the Main Deck can actually make) and the shape of the deck',
  mtg:
    'the deck rules and format legality, lands (how many the curve needs), colours (the chance of having each colour when its spells are due), ' +
    'the curve (a play on each early turn), card advantage, interaction (removal, counterspells, sweepers), threats, synergy and focus',
};

/** The explanation for a game, or null when the game has no recommender. */
export function aboutRecommender(game: GameId): AboutRecommender | null {
  const parts = PARTS[game];
  if (!parts) return null;
  const paragraphs = [
    'The Deck check on a deck page and “Build one for me” under Decks run on this device and read only the rules text printed on the cards. ' +
      'Nothing is uploaded, and nothing is learned from other people’s decks.',
    `A deck gets a score out of 100, made of parts that are each a rule of thumb: ${parts}. Every part shows the finding behind its number.`,
    'A suggestion is the card, or the swap, that raises that score most, and it names the part that gained. ' +
      '“Prefer my cards”, “Only my cards” and “Any card” decide where suggestions may come from, and the format decides which cards are legal. ' +
      '“Prefer my cards” uses your cards first and another card only where it does clearly more; “Only my cards” never uses more copies of a printing than you own.',
    'A built deck starts from the one to three cards you pick, up to three copies of each, and keeps them. It adds the best card one at a time until the deck is full, then tries swaps while they help. ' +
      (game === 'pokemon' ? 'For the last third of a Pokémon deck the score can no longer tell cards apart, so each candidate is played in practice games and the one that plays best goes in. ' : '') +
      (game === 'ygo' ? 'The Main Deck is built first and the Extra Deck is filled with monsters it can make. ' : '') +
      '“Build another” does the same without the cards of the last attempt.',
  ];
  if (game === 'pokemon') {
    paragraphs.push(
      `Pokémon decks are also played. A test pilot plays a full deck ${PLAY_GAMES} practice games against nobody and reports how soon it attacks, ` +
        'how much damage it does and how often it has nothing to play. “Tune by playing” and “Find a swap by playing” try swaps the same way ' +
        'and keep one only if the deck plays better with it on fresh games.',
      'The pilot plays the cards as they are written: damage that grows with Energy, Benched Pokémon or coin flips, attacks that cannot be used ' +
        'two turns running, the Energy or damage an attack costs its user, and what Trainers, Tools, Stadiums, Abilities and Special Energy do. ' +
        'It is a plain player, though: it works toward the deck’s main attacker and does not plan several turns ahead.',
      'With nobody across the table, cards that act on an opponent (Boss’s Orders, healing, Burn or Poison) sit unused, and the report names them. ' +
        'It also names the few cards the pilot still cannot read. Text about Tera, Future and Ancient Pokémon is among those, ' +
        'because the card data does not say which cards they are.',
    );
  } else {
    paragraphs.push('Decks of this game are scored, not played: there is no practice pilot for it yet, so “Tune by playing” is not offered.');
  }
  paragraphs.push(
    'What it cannot tell you is how a deck does against real opponents. It knows nothing about tournament results or what is popular right now, ' +
      'so treat the score as a second opinion, not a verdict.',
  );
  return { parts, paragraphs };
}
