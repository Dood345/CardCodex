/**
 * Worse decks on demand. A benchmark needs decks that are known to be worse
 * than a given deck without anyone's judgement: a random pile of the deck's
 * own years, and copies of the deck with a known number of cards swapped for
 * random cards of those years. A judge that cannot tell these from the
 * original cannot rank real decks either.
 *
 * The damage is defined by structure only (how many copies, of which kind),
 * never by the evaluator's own reading of the cards, so a judge is not
 * marked against its own opinion.
 */
import type { CatalogIndex } from '@/data/catalog';
import type { DeckCard } from '@/data/db';
import type { CatalogCard } from '@/data/types';
import type { DeckEvaluator } from '../types';
import { pick, shuffled, type Rng } from './rng';

export type Kind = ReturnType<DeckEvaluator['kindOf']>;

/** One card id per copy, for the lines outside the side deck. */
export function copiesOf(cards: readonly DeckCard[]): string[] {
  const out: string[] = [];
  for (const l of cards) if (!l.zone) for (let i = 0; i < l.qty; i++) out.push(l.cardId);
  return out;
}

/** Deck lines from one id per copy; lines of other zones are carried over from `keep`. */
export function linesOf(ids: readonly string[], keep: readonly DeckCard[] = []): DeckCard[] {
  const qty = new Map<string, number>();
  for (const id of ids) qty.set(id, (qty.get(id) ?? 0) + 1);
  return [...[...qty].map(([cardId, q]) => ({ cardId, qty: q })), ...keep.filter((l) => l.zone)];
}

export interface EraPool {
  /** One printing per card name, printed within a year of the deck's own years. */
  all: CatalogCard[];
  byKind: Record<Kind, CatalogCard[]>;
}

const yearOf = (index: CatalogIndex, card: CatalogCard) => Number(index.setsById.get(card.set)?.releaseDate?.slice(0, 4)) || 0;

const pools = new WeakMap<CatalogIndex, Map<string, EraPool>>();

/** The cards a deck's random replacements come from: everything printed within a year of the deck's span. */
export function eraPool(ev: DeckEvaluator, index: CatalogIndex, cards: readonly DeckCard[]): EraPool {
  let lo = Infinity;
  let hi = -Infinity;
  for (const l of cards) {
    const card = ev.card(l.cardId);
    const y = card ? yearOf(index, card) : 0;
    if (!y) continue;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  const key = lo <= hi ? `${lo - 1}-${hi + 1}` : 'all';
  let cache = pools.get(index);
  if (!cache) pools.set(index, (cache = new Map()));
  let pool = cache.get(key);
  if (pool) return pool;
  pool = { all: [], byKind: { pokemon: [], trainer: [], energy: [] } };
  const seen = new Set<string>();
  for (const card of index.catalog.cards) {
    if (key !== 'all') {
      const y = yearOf(index, card);
      if (y < lo - 1 || y > hi + 1) continue;
    }
    if (seen.has(card.name)) continue;
    seen.add(card.name);
    pool.all.push(card);
    pool.byKind[ev.kindOf(card)].push(card);
  }
  cache.set(key, pool);
  return pool;
}

/** A pile of `size` different cards of the era: what a deck must always beat. */
export function randomPile(pool: EraPool, size: number, rng: Rng): DeckCard[] {
  return shuffled(rng, pool.all)
    .slice(0, size)
    .map((c) => ({ cardId: c.id, qty: 1 }));
}

export interface Damage {
  id: string;
  label: string;
  /** Copies swapped, for the damages that form a ladder (more is worse). */
  level?: number;
  apply(cards: readonly DeckCard[], pool: EraPool, rng: Rng, ev: DeckEvaluator): DeckCard[];
}

/** `count` copies, whichever they are, swapped for random cards of the era. */
export function swapAny(count: number): Damage {
  return {
    id: `swap-${count}`,
    label: `${count} random cards swapped in`,
    level: count,
    apply(cards, pool, rng) {
      const ids = copiesOf(cards);
      const slots = shuffled(
        rng,
        ids.map((_, i) => i),
      ).slice(0, count);
      for (const i of slots) ids[i] = pick(rng, pool.all).id;
      return linesOf(ids, cards);
    },
  };
}

/** A share of the copies of one kind swapped for random cards of the same kind: the deck keeps its shape and loses its plan. */
export function swapKind(kind: Kind, share: number, id: string, label: string): Damage {
  return {
    id,
    label,
    apply(cards, pool, rng, ev) {
      const ids = copiesOf(cards);
      const same = pool.byKind[kind];
      if (!same.length) return linesOf(ids, cards);
      const slots = shuffled(
        rng,
        ids
          .map((cardId, i) => ({ cardId, i }))
          .filter((s) => {
            const card = ev.card(s.cardId);
            return card ? ev.kindOf(card) === kind : false;
          }),
      );
      for (const s of slots.slice(0, Math.round(slots.length * share))) ids[s.i] = pick(rng, same).id;
      return linesOf(ids, cards);
    },
  };
}

/** The standard set: a ladder of 6, 12 and 24 swapped copies, and one damage per kind of card. */
export const DAMAGES: readonly Damage[] = [
  swapAny(6),
  swapAny(12),
  swapAny(24),
  swapKind('trainer', 1 / 3, 'trainers', 'a third of the Trainers swapped for random Trainers'),
  swapKind('energy', 1 / 2, 'energy', 'half of the Energy swapped for random Energy'),
  swapKind('pokemon', 1 / 3, 'pokemon', 'a third of the Pokémon swapped for random Pokémon'),
];
