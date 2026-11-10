/**
 * What the deck screens ask of the recommender, as plain functions: the
 * check of a deck with its next suggestions, the words for a suggestion, the
 * names other decks already use, and the cards worth starting a deck from.
 * No React here, so the tests call it directly.
 */
import type { Deck, DeckCard } from '@/data/db';
import type { CatalogCard } from '@/data/types';
import { suggestAdds, suggestSwaps, type SuggestOptions } from './builder';
import type { BuildOptions, DeckEvaluator, DeckScore, FormatOption, Suggestion } from './types';

/** Games behind the playtest numbers the screens show. */
export const PLAY_GAMES = 400;

export interface SourceOption {
  id: BuildOptions['source'];
  label: string;
}

/** Where suggested cards may come from, in the order the screens offer them. */
export const SOURCES: readonly SourceOption[] = [
  { id: 'prefer-collection', label: 'Prefer my cards' },
  { id: 'collection', label: 'Only my cards' },
  { id: 'catalog', label: 'Any card' },
];

const ANY: FormatOption = { id: 'any', label: 'Any format' };

/** The formats to offer for an evaluator; a game without formats gets "Any format" alone. */
export function formatsOf(ev: DeckEvaluator): readonly FormatOption[] {
  return ev.formats?.length ? ev.formats : [ANY];
}

/** The format the screens start on: the one the evaluator marks, else "any", else its first. */
export function defaultFormat(ev: DeckEvaluator): string {
  const formats = formatsOf(ev);
  return (formats.find((f) => f.default) ?? formats.find((f) => f.id === 'any') ?? formats[0]).id;
}

/** The evaluator to use under a format (see `DeckEvaluator.forFormat`). */
export function evaluatorFor(ev: DeckEvaluator, format: string): DeckEvaluator {
  return ev.forFormat?.(format) ?? ev;
}

/** Copies in the deck's first section (the 60 of a Pokémon deck, the Main Deck of a Yu-Gi-Oh! deck). */
export function mainCount(ev: DeckEvaluator, cards: readonly DeckCard[]): number {
  const main = ev.rules.sections[0].id;
  let n = 0;
  for (const l of cards) if (ev.rules.sectionOf(ev.card(l.cardId), l) === main) n += l.qty;
  return n;
}

export interface Advice {
  score: DeckScore;
  /** "add" while the deck is short of its size, "swap" once it is full. */
  mode: 'add' | 'swap';
  main: number;
  target: number;
  suggestions: Suggestion[];
}

/** The deck's score and what to do next: cards to add while it is short, swaps once it is full. */
export function advise(ev: DeckEvaluator, cards: readonly DeckCard[], options: SuggestOptions, pool = ev.pool(options)): Advice {
  const target = ev.rules.sections[0].min;
  const main = mainCount(ev, cards);
  const mode = main < target ? 'add' : 'swap';
  const limit = options.limit ?? 6;
  const suggestions =
    mode === 'add'
      ? suggestAdds(ev, cards, { ...options, limit }, pool).filter((s) => s.delta > 0 && main + s.move.add.length <= target)
      : suggestSwaps(ev, cards, { ...options, limit }, pool);
  return { score: ev.score(cards), mode, main, target, suggestions };
}

const list = (cards: readonly CatalogCard[]) => {
  const names = cards.map((c) => c.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
};

/** "Add Charmander", "Add Charizard ex with Charmander", "Swap Lost Vacuum for Rare Candy". */
export function describeMove(s: Suggestion): string {
  const { add, remove } = s.move;
  if (remove.length) return `Swap ${list(remove)} for ${list(add)}`;
  return add.length > 1 ? `Add ${add[0].name} with ${list(add.slice(1))}` : `Add ${list(add)}`;
}

/** "+3.2" for a gain, "−1.0" for a loss, "+0.0" never: a gain under a twentieth of a point shows as "+0.1". */
export function formatDelta(delta: number): string {
  const v = Math.abs(delta) < 0.05 ? (delta >= 0 ? 0.1 : -0.1) : delta;
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
}

/**
 * Names the user's other decks of this game already play, for "avoid what my
 * other decks use". Cards a deck may hold any number of (basic Energy, basic
 * lands) are left out: every deck needs those.
 */
export function namesInDecks(ev: DeckEvaluator, decks: readonly Deck[], exceptId?: string): Set<string> {
  const out = new Set<string>();
  for (const d of decks) {
    if (d.id === exceptId || d.game !== ev.game) continue;
    for (const l of d.cards) {
      const card = ev.card(l.cardId);
      if (card && Number.isFinite(ev.rules.copyLimit(card))) out.add(card.name);
    }
  }
  return out;
}

/** The same for one built deck, for "build another": everything it plays except its seeds, what they evolve from, and the any-number cards. */
export function namesToVary(ev: DeckEvaluator, cards: readonly DeckCard[], seeds: readonly CatalogCard[]): Set<string> {
  const inDeck = cards.map((l) => ev.card(l.cardId)).filter((c): c is CatalogCard => !!c);
  // A seed keeps what it cannot be played without (a Stage 2 its Stage 1 and its Basic): with those names
  // avoided, "build another" could not put the seed into play and built a deck without it.
  const keep = new Set(seeds.map((c) => c.name));
  for (const seed of seeds) for (const need of ev.requirements(seed, [], inDeck)) keep.add(need.name);
  const out = new Set<string>();
  for (const card of inDeck) if (!keep.has(card.name) && Number.isFinite(ev.rules.copyLimit(card))) out.add(card.name);
  return out;
}

/**
 * Cards to offer as a start for "Build a deck": the evaluator's own ideas
 * when it has them, else the pool's monsters with the highest printed HP or
 * ATK, one per name. With an owned-cards source the pool is what the user
 * owns, so the ideas are their own cards.
 */
export function seedIdeas(ev: DeckEvaluator, pool: readonly CatalogCard[], count = 8): CatalogCard[] {
  if (ev.seedIdeas) return ev.seedIdeas(pool, count);
  const seen = new Set<string>();
  return pool
    .filter((c) => ev.kindOf(c) === 'pokemon')
    .sort((a, b) => (b.hp ?? b.atk ?? 0) - (a.hp ?? a.atk ?? 0) || (a.id < b.id ? -1 : 1))
    .filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)))
    .slice(0, count);
}

/** "Charizard ex deck", "Charizard ex and Pidgeot ex deck". */
export function builtDeckName(seeds: readonly CatalogCard[]): string {
  return seeds.length ? `${list(seeds.slice(0, 2))} deck` : 'Built deck';
}
