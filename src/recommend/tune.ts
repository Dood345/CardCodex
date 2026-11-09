/**
 * Tuning a deck by playing it. The score (an evaluator's parts) counts
 * cards; an evaluator that can also play a deck (`DeckEvaluator.playtest`,
 * backed by src/recommend/sim for Pokémon) lets the builder go further: try
 * a swap, play the deck some hundred games with and without it, keep the
 * swap when the deck plays better. The benchmark (docs/deck-bench.md) showed
 * why this is needed: decks built on the score alone scored 98 and attacked
 * by turn three in one game out of six.
 *
 * One round: find the copy the deck misses least (play the deck without each
 * line in turn), then the card that helps most in its place (more copies of
 * what the deck already plays, and the pool's most relevant cards), check the
 * best swap again on fresh games, and keep it if it still wins and the score
 * does not object. Every candidate of a round is played with the same seed,
 * so the comparison is between decks and not between shuffles.
 *
 * A round is some dozens of playtests; the screens run rounds one at a time
 * between paints (`tuneRound`), the tests and the benchmark run them in a
 * loop (`tuneByPlay`).
 */
import type { DeckCard } from '@/data/db';
import type { CatalogCard } from '@/data/types';
import { apply, candidateMoves, fitsLimits, indexOf, roomFor, type SuggestOptions } from './builder';
import type { DeckEvaluator, PlaySummary } from './types';

export interface TuneOptions extends SuggestOptions {
  /** Games per candidate (default 120). */
  games?: number;
  seed?: number;
  /** Games of the second look a swap must also win before it is kept (default 400). */
  confirmGames?: number;
  /** Points of score a swap may cost (default 3): the score still guards rules, lines and shape. */
  guard?: number;
  /** Removal candidates tried per round, weakest first (default 2). */
  removals?: number;
  /** Card names that must stay in the deck (the seeds a deck was built around). */
  keep?: ReadonlySet<string>;
}

export interface TuneStep {
  out: CatalogCard;
  in: CatalogCard;
  /** Play value before and after, on the confirming games. */
  from: number;
  to: number;
}

export interface TuneState {
  cards: DeckCard[];
  steps: TuneStep[];
  round: number;
  /** True once a round found nothing to improve. */
  done: boolean;
}

export function tuneStart(cards: readonly DeckCard[]): TuneState {
  return { cards: [...cards], steps: [], round: 0, done: false };
}

/** True when the evaluator can play decks, so tuning is on offer. */
export function canTune(ev: DeckEvaluator): ev is DeckEvaluator & { playtest: NonNullable<DeckEvaluator['playtest']> } {
  return typeof ev.playtest === 'function';
}

/** One round of tuning; returns the next state (the same cards with `done` set when nothing better was found). */
export function tuneRound(ev: DeckEvaluator, state: TuneState, options: TuneOptions, pool: readonly CatalogCard[]): TuneState {
  if (state.done || !canTune(ev)) return { ...state, done: true };
  const games = options.games ?? 120;
  const confirmGames = options.confirmGames ?? 400;
  const guard = options.guard ?? 3;
  const seed = (options.seed ?? 1) + state.round * 7919;
  const play = (cards: readonly DeckCard[], n = games, s = seed): number => ev.playtest(cards, { games: n, seed: s }).value;

  const { cards } = state;
  const index = indexOf(ev, pool, cards);
  const baseScore = ev.score(cards);
  const next = (found: TuneState | null): TuneState => found ?? { ...state, round: state.round + 1, done: true };

  // The copies the deck misses least: play it without one copy of each line.
  const outs: { card: CatalogCard; value: number }[] = [];
  const names = new Map<string, number>();
  for (const l of cards) {
    const c = index.get(l.cardId);
    if (c && !l.zone) names.set(c.name, (names.get(c.name) ?? 0) + l.qty);
  }
  for (const l of cards) {
    if (l.zone) continue;
    const card = index.get(l.cardId);
    if (!card) continue;
    if (options.keep?.has(card.name) && (names.get(card.name) ?? 0) <= 1) continue;
    outs.push({ card, value: play(apply(cards, { add: [], remove: [card] }, index)) });
  }
  outs.sort((a, b) => b.value - a.value);

  for (const out of outs.slice(0, options.removals ?? 2)) {
    const reduced = apply(cards, { add: [], remove: [out.card] }, index);
    // What could take its place: another copy of what the deck plays, or the pool's most relevant cards.
    const byName = new Map<string, number>();
    for (const l of reduced) {
      const c = index.get(l.cardId);
      if (c) byName.set(c.name, (byName.get(c.name) ?? 0) + l.qty);
    }
    const ins = new Map<string, CatalogCard>();
    for (const l of reduced) {
      const c = index.get(l.cardId);
      if (c && !l.zone && c.id !== out.card.id && roomFor(ev, c, byName, reduced, options) > 0 && fitsLimits(ev, reduced, [c])) ins.set(c.id, c);
    }
    for (const m of candidateMoves(ev, reduced, pool, { ...options, breadth: options.breadth ?? 36 }, index)) {
      if (m.add.length === 1 && m.add[0].id !== out.card.id && m.add[0].name !== out.card.name) ins.set(m.add[0].id, m.add[0]);
    }
    let best: { card: CatalogCard; value: number; cards: DeckCard[] } | null = null;
    for (const card of ins.values()) {
      const tried = apply(reduced, { add: [card], remove: [] }, index);
      const value = play(tried);
      if (!best || value > best.value) best = { card, value, cards: tried };
    }
    if (!best) continue;
    // A second look on fresh games, and the score's say on rules and shape.
    const was = ev.playtest(cards, { games: confirmGames, seed: seed + 1 });
    const now = ev.playtest(best.cards, { games: confirmGames, seed: seed + 1 });
    const from = was.value;
    const to = now.value;
    if (to <= from * 1.01) continue;
    // A deck built around a card stays about that card: no swap may hand the plan to another attacker.
    const about = (plan: string) => [...(options.keep ?? [])].some((name) => plan.includes(name));
    if (about(was.plan) && !about(now.plan)) continue;
    const after = ev.score(best.cards);
    if (after.total < baseScore.total - guard || after.issues.length > baseScore.issues.length) continue;
    return next({
      cards: best.cards,
      steps: [...state.steps, { out: out.card, in: best.card, from, to }],
      round: state.round + 1,
      done: false,
    });
  }
  return next(null);
}

export interface TuneResult {
  cards: DeckCard[];
  steps: TuneStep[];
  before: PlaySummary;
  after: PlaySummary;
}

/** Rounds until nothing improves or `rounds` (default 8) are done; the summaries are played on games no round has seen. */
export function tuneByPlay(ev: DeckEvaluator, cards: readonly DeckCard[], options: TuneOptions & { rounds?: number }, pool = ev.pool(options)): TuneResult | null {
  if (!canTune(ev)) return null;
  const final = { games: 600, seed: (options.seed ?? 1) + 104729 };
  const before = ev.playtest(cards, final);
  let state = tuneStart(cards);
  for (let i = 0; i < (options.rounds ?? 8) && !state.done; i++) state = tuneRound(ev, state, options, pool);
  return { cards: state.cards, steps: state.steps, before, after: ev.playtest(state.cards, final) };
}
