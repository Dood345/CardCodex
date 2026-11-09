/**
 * Practice hands without game rules: shuffle the deck's first section from a
 * seed and take the top cards. An evaluator with opening rules of its own
 * (Pokémon: redraw without a Basic, six Prize cards) supplies
 * `DeckEvaluator.practice`; the others use this with their hand size.
 */
import type { DeckCard } from '@/data/db';
import type { DeckEvaluator, PracticeHand } from './types';

/** mulberry32, as in the benchmarks: small, fast, repeatable. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An opening hand of `handSize` cards from the shuffled main section (no Extra Deck, no side deck). */
export function dealPlain(ev: DeckEvaluator, cards: readonly DeckCard[], seed: number, handSize: number): PracticeHand {
  const main = ev.rules.sections[0].id;
  const ids: string[] = [];
  for (const l of cards) {
    if (ev.rules.sectionOf(ev.card(l.cardId), l) !== main) continue;
    for (let i = 0; i < l.qty; i++) ids.push(l.cardId);
  }
  const rnd = generator(seed);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return { hand: ids.slice(0, handSize), aside: [], asideLabel: '', library: ids.slice(handSize), redraws: 0, note: '' };
}

/** The deal after drawing the top card (unchanged when the deck is out). */
export function drawOne(deal: PracticeHand): PracticeHand {
  if (!deal.library.length) return deal;
  return { ...deal, hand: [...deal.hand, deal.library[0]], library: deal.library.slice(1) };
}
