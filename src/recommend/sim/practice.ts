/**
 * Practice draw for a screen: pure functions over plain data. `dealOpening`
 * shuffles a deck from a seed, mulligans until a Basic Pokémon (keeping each
 * redrawn hand to show), deals the opening seven and the six Prize cards;
 * `drawNext` takes the next cards off the top. Nothing is mutated and the
 * random state travels in the deal, so a screen can store, undo or replay it.
 */
import type { DeckCard } from '@/data/db';
import type { PokemonEvaluator } from '../pokemon';
import { compiledDeck } from './playtest';
import { stepRandom } from './rng';
import { POKEMON_RULES_PAR_2023, type PokemonRuleSet } from './rules';

export interface PracticeDeal {
  /** Card ids in hand, in the order drawn. */
  hand: string[];
  prizes: string[];
  /** The rest of the deck, top card first. */
  library: string[];
  /** Hands shuffled back for having no Basic Pokémon, in order. */
  mulligans: string[][];
  /** Random state after the deal, for any later shuffle. */
  rng: number;
  /** False when the deck has no Basic Pokémon: no opening hand can be kept (`hand` is the last one drawn). */
  ok: boolean;
}

/** Shuffle with the plain-state generator; returns the shuffled copy and the next state. */
export function shuffled<T>(xs: readonly T[], state: number): [T[], number] {
  const a = xs.slice();
  let s = state >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    const [r, next] = stepRandom(s);
    s = next;
    const j = Math.floor(r * (i + 1));
    const x = a[i];
    a[i] = a[j];
    a[j] = x;
  }
  return [a, s];
}

export function dealOpening(ev: PokemonEvaluator, cards: readonly DeckCard[], seed: number, rules: PokemonRuleSet = POKEMON_RULES_PAR_2023): PracticeDeal {
  const d = compiledDeck(ev, cards);
  const ids = d.list.map((i) => d.cards[i].card.id);
  const basic = new Set(d.cards.filter((c) => c.basic).map((c) => c.card.id));
  const mulligans: string[][] = [];
  let state = seed >>> 0;
  let deck: string[] = ids;
  let hand: string[] = [];
  const ok = basic.size > 0;
  for (let tries = 0; tries < 100; tries++) {
    [deck, state] = shuffled(ids, state);
    hand = deck.slice(0, rules.openingHand);
    if (!ok || hand.some((id) => basic.has(id))) break;
    mulligans.push(hand);
  }
  const rest = deck.slice(rules.openingHand);
  return { hand, prizes: rest.slice(0, rules.prizes), library: rest.slice(rules.prizes), mulligans, rng: state, ok };
}

/** The deal after drawing `n` more cards (fewer when the library runs out). */
export function drawNext(deal: PracticeDeal, n = 1): PracticeDeal {
  const k = Math.max(0, Math.min(n, deal.library.length));
  return { ...deal, hand: [...deal.hand, ...deal.library.slice(0, k)], library: deal.library.slice(k) };
}
