/**
 * The game-neutral deck builder: given a DeckEvaluator, it suggests cards to
 * add to a deck, swaps that raise its score, and builds a whole deck from a
 * seed by greedy search followed by local improvement. Every suggestion names
 * the score part that gained most, so the UI can say why.
 *
 * Cost: a suggestion round scores the top `breadth` candidates by relevance
 * once each; a build runs one round per card added (about 60), which is fine
 * on a phone because a score is arithmetic over a few dozen cached features.
 */
import type { DeckCard } from '@/data/db';
import { withQty } from '@/data/decks';
import type { CatalogCard } from '@/data/types';
import type { BuildOptions, DeckEvaluator, DeckScore, Move, Suggestion } from './types';

export interface SuggestOptions extends BuildOptions {
  /** Candidates scored per round, by relevance (default 120). */
  breadth?: number;
  /** Suggestions returned (default 8). */
  limit?: number;
  /** Suggestions per score part among those returned (default 3), so a list is not six Energy cards. */
  perPart?: number;
}

function qtyByName(cards: readonly DeckCard[], index: Map<string, CatalogCard>): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cards) {
    const card = index.get(c.cardId);
    if (card) out.set(card.name, (out.get(card.name) ?? 0) + c.qty);
  }
  return out;
}

function apply(cards: readonly DeckCard[], move: Move, index: Map<string, CatalogCard>): DeckCard[] {
  let out: DeckCard[] = [...cards];
  for (const c of move.remove) {
    const line = out.find((l) => l.cardId === c.id && !l.zone);
    if (line) out = withQty(out, c.id, Math.max(0, line.qty - 1));
  }
  for (const c of move.add) {
    const line = out.find((l) => l.cardId === c.id && !l.zone);
    out = withQty(out, c.id, (line?.qty ?? 0) + 1);
    index.set(c.id, c);
  }
  return out;
}

/** Why `after` beats `before`: the part that gained most, as "Label: 40% → 70%", with its detail after the move. */
export function reasonFor(before: DeckScore, after: DeckScore): { reason: string; detail: string; partId: string } {
  let best = after.parts[0];
  let was = 0;
  let gain = -Infinity;
  for (const p of after.parts) {
    const prev = before.parts.find((q) => q.id === p.id)?.score ?? 0;
    const d = (p.score - prev) * p.weight;
    if (d > gain) {
      gain = d;
      best = p;
      was = prev;
    }
  }
  if (!best) return { reason: '', detail: '', partId: '' };
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return { reason: `${best.label}: ${pct(was)} → ${pct(best.score)}`, detail: best.detail, partId: best.id };
}

/** The best suggestions with at most `perPart` for any one score part. */
function diverse(all: Suggestion[], limit: number, perPart: number): Suggestion[] {
  const seen = new Map<string, number>();
  const out: Suggestion[] = [];
  for (const s of all) {
    const n = seen.get(s.partId) ?? 0;
    if (n >= perPart) continue;
    seen.set(s.partId, n + 1);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** An evaluator that keeps once-per-deck limits across card names (the Pokémon one: ACE SPEC, Radiant) says so with `fits`. */
interface GroupLimited {
  fits(cards: readonly DeckCard[], adds: readonly CatalogCard[]): boolean;
}

/** True unless adding all of `adds` would break a limit that spans card names. */
function fitsLimits(ev: DeckEvaluator, cards: readonly DeckCard[], adds: readonly CatalogCard[]): boolean {
  const g = ev as Partial<GroupLimited>;
  return g.fits ? g.fits(cards, adds) : true;
}

/** Copies of `card` the options still allow into `cards` (rules limit, and what the collection holds when it is the source). */
function roomFor(ev: DeckEvaluator, card: CatalogCard, byName: Map<string, number>, cards: readonly DeckCard[], options: BuildOptions): number {
  const have = byName.get(card.name) ?? 0;
  let room = ev.rules.copyLimit(card) - have;
  if (options.source === 'collection') {
    const owned = options.collection.get(card.id)?.qty ?? 0;
    const inDeck = cards.find((l) => l.cardId === card.id)?.qty ?? 0;
    room = Math.min(room, owned - inDeck);
  }
  return room;
}

/**
 * The moves worth trying on `cards`: the most relevant candidates plus what each
 * requires, if there is room. The breadth is split by card kind (half Pokémon or
 * monsters, a third Trainers or spells, the rest Energy or lands) so a deck short
 * of Basics is offered Basics and not only the hundreds of relevant Trainers.
 */
function candidateMoves(ev: DeckEvaluator, cards: readonly DeckCard[], pool: readonly CatalogCard[], options: SuggestOptions, index: Map<string, CatalogCard>): Move[] {
  const byName = qtyByName(cards, index);
  const rel = ev.relevance(cards, pool);
  const groups = new Map<string, { card: CatalogCard; r: number }[]>();
  pool.forEach((card, i) => {
    const r = rel[i];
    if (r <= 0 || roomFor(ev, card, byName, cards, options) <= 0 || !fitsLimits(ev, cards, [card])) return;
    const kind = ev.kindOf(card);
    let g = groups.get(kind);
    if (!g) groups.set(kind, (g = []));
    g.push({ card, r });
  });
  const breadth = options.breadth ?? 120;
  const share: Record<string, number> = { pokemon: 0.5, trainer: 0.35, energy: 0.15 };
  const ranked: { card: CatalogCard; r: number }[] = [];
  for (const [kind, g] of groups) {
    g.sort((a, b) => b.r - a.r);
    ranked.push(...g.slice(0, Math.max(4, Math.round(breadth * (share[kind] ?? 0.2)))));
  }
  ranked.sort((a, b) => b.r - a.r);
  const moves: Move[] = [];
  for (const { card, r } of ranked) {
    const req = ev.requirements(card, cards, pool);
    if (req.some((c) => roomFor(ev, c, byName, cards, options) <= 0) || !fitsLimits(ev, cards, [card, ...req])) continue;
    moves.push({ add: [card, ...req], remove: [], relevance: r });
  }
  return moves;
}

/** The pool's cards by id, plus the deck's own printings (which may differ from the pool's). */
function indexOf(ev: DeckEvaluator, pool: readonly CatalogCard[], cards: readonly DeckCard[]): Map<string, CatalogCard> {
  const index = new Map(pool.map((c) => [c.id, c]));
  for (const c of cards) if (!index.has(c.cardId)) index.set(c.cardId, ev.card(c.cardId) ?? ({ id: c.cardId, name: c.cardId } as CatalogCard));
  return index;
}

/** Cards to add to the deck, best first, each with the reason. */
export function suggestAdds(ev: DeckEvaluator, cards: readonly DeckCard[], options: SuggestOptions, pool = ev.pool(options)): Suggestion[] {
  const index = indexOf(ev, pool, cards);
  const base = ev.score(cards);
  const out: Suggestion[] = [];
  for (const move of candidateMoves(ev, cards, pool, options, index)) {
    const after = ev.score(apply(cards, move, index));
    out.push({ move, total: after.total, delta: after.total - base.total, ...reasonFor(base, after) });
  }
  out.sort((a, b) => b.delta - a.delta || (b.move.relevance ?? 0) - (a.move.relevance ?? 0));
  return diverse(out, options.limit ?? 8, options.perPart ?? 3);
}

/** How much each line carries: the score lost when one copy leaves. Lowest first. */
export function contributions(ev: DeckEvaluator, cards: readonly DeckCard[], pool: readonly CatalogCard[]): { card: CatalogCard; loss: number }[] {
  const index = indexOf(ev, pool, cards);
  const base = ev.score(cards).total;
  const out: { card: CatalogCard; loss: number }[] = [];
  const seen = new Set<string>();
  for (const l of cards) {
    if (l.zone || seen.has(l.cardId)) continue;
    seen.add(l.cardId);
    const card = index.get(l.cardId)!;
    const after = ev.score(apply(cards, { add: [], remove: [card] }, index)).total;
    out.push({ card, loss: base - after });
  }
  return out.sort((a, b) => a.loss - b.loss);
}

/** Swaps (one copy out, one card in) that raise the score, best first. */
export function suggestSwaps(ev: DeckEvaluator, cards: readonly DeckCard[], options: SuggestOptions, pool = ev.pool(options)): Suggestion[] {
  const index = indexOf(ev, pool, cards);
  const base = ev.score(cards);
  const weakest = contributions(ev, cards, pool).slice(0, 6);
  const out: Suggestion[] = [];
  for (const { card } of weakest) {
    const reduced = apply(cards, { add: [], remove: [card] }, index);
    const adds = suggestAdds(ev, reduced, { ...options, limit: 3 }, pool).filter((s) => !s.move.add.some((c) => c.id === card.id));
    for (const s of adds) {
      if (s.total <= base.total) continue;
      const move: Move = { add: s.move.add, remove: [card] };
      const after = ev.score(apply(cards, move, index));
      out.push({ move, total: after.total, delta: after.total - base.total, ...reasonFor(base, after) });
    }
  }
  out.sort((a, b) => b.delta - a.delta);
  return diverse(out, options.limit ?? 5, options.perPart ?? 3);
}

export interface BuildResult {
  cards: DeckCard[];
  score: DeckScore;
  /** The moves taken, in order, for the UI's "how this deck came together". */
  steps: Suggestion[];
  /** Seeds the options ruled out (not in the pool under this format or source), by name. */
  dropped: string[];
}

/**
 * Builds a deck around `seeds` (card ids, one copy each to start; a seed whose
 * printing the pool lacks is taken by name, so a seed from an older set still
 * works under a format): greedy additions until the main section is full,
 * then swaps while they help.
 */
export function buildDeck(ev: DeckEvaluator, seeds: readonly string[], options: SuggestOptions, pool = ev.pool(options)): BuildResult {
  const index = new Map(pool.map((c) => [c.id, c]));
  const target = ev.rules.sections[0].min;
  let cards: DeckCard[] = [];
  const steps: Suggestion[] = [];
  const dropped: string[] = [];
  for (const id of seeds) {
    const wanted = ev.card(id);
    const card = index.get(id) ?? (wanted && pool.find((c) => c.name === wanted.name));
    if (!card) {
      dropped.push(wanted?.name ?? id);
      continue;
    }
    const move: Move = { add: [card, ...ev.requirements(card, cards, pool)], remove: [] };
    // A seed the rules forbid (a second ACE SPEC, a fifth copy) is left out and reported, like one the options rule out.
    const names = qtyByName(cards, index);
    const overCopies = move.add.some((c) => (names.get(c.name) ?? 0) + move.add.filter((x) => x.name === c.name).length > ev.rules.copyLimit(c));
    if (overCopies || !fitsLimits(ev, cards, move.add)) {
      dropped.push(card.name);
      continue;
    }
    cards = apply(cards, move, index);
  }
  const count = () => cards.reduce((n, c) => n + (c.zone ? 0 : c.qty), 0);
  let guard = 0;
  while (count() < target && guard++ < target + 10) {
    const before = ev.score(cards);
    const moves = candidateMoves(ev, cards, pool, options, index).filter((m) => count() + m.add.length <= target);
    if (!moves.length) break;
    let best: Suggestion | undefined;
    for (const move of moves) {
      const after = ev.score(apply(cards, move, index));
      const s: Suggestion = { move, total: after.total, delta: after.total - before.total, ...reasonFor(before, after) };
      if (!best || s.total > best.total || (s.total === best.total && (move.relevance ?? 0) > (best.move.relevance ?? 0))) best = s;
    }
    if (!best) break;
    cards = apply(cards, best.move, index);
    steps.push(best);
  }
  // Local improvement: swap while a swap helps, a bounded number of times.
  for (let i = 0; i < 12; i++) {
    const swaps = suggestSwaps(ev, cards, { ...options, limit: 1, breadth: Math.min(options.breadth ?? 120, 60) }, pool);
    if (!swaps.length || swaps[0].delta <= 0.05) break;
    cards = apply(cards, swaps[0].move, index);
    steps.push(swaps[0]);
  }
  return { cards, score: ev.score(cards), steps, dropped };
}
