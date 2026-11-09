/**
 * The deck benchmark: does a judge tell good decks from bad ones?
 *
 * A judge is anything that rates a deck with one number, higher is better:
 * the evaluator's total, one of its parts, a playtest result (share of games
 * attacking by turn three), a win rate. The benchmark rates every deck of a
 * corpus and its known-worse versions (damage.ts) with every judge and
 * reports, per judge:
 *
 *   pile      share of decks rated above a random pile of their own years
 *   <damage>  share of decks rated above each damaged copy of themselves
 *   order     how well the rating follows the ladder original > 6 swapped
 *             > 12 > 24 > pile (mean Spearman correlation, 1 is perfect)
 *   strength  when the corpus knows how strong its decks really are (a
 *             tournament placing, a round-robin win rate): the correlation
 *             of the rating with that strength
 *
 * A report is compared with a recorded baseline; a judge that falls behind
 * its baseline by more than the tolerance is a regression.
 */
import type { CatalogIndex } from '@/data/catalog';
import type { DeckCard } from '@/data/db';
import type { DeckEvaluator, DeckScore } from '../types';
import { copiesOf, DAMAGES, eraPool, randomPile, type Damage } from './damage';
import { mean, pairedWins, spearman } from './metrics';
import { mulberry32 } from './rng';

export interface Judge {
  id: string;
  label: string;
  /** Higher is better. */
  rate(cards: readonly DeckCard[]): number;
}

export interface BenchDeck {
  id: string;
  name: string;
  cards: DeckCard[];
  /** How strong the deck really is, when known; higher is stronger. */
  strength?: number;
}

export interface Corpus {
  id: string;
  label: string;
  decks: BenchDeck[];
}

/** The evaluator's total and each of its parts as judges (one score per deck, shared between them). */
export function scoreJudges(ev: DeckEvaluator): Judge[] {
  const cache = new WeakMap<readonly DeckCard[], DeckScore>();
  const scoreOf = (cards: readonly DeckCard[]) => {
    let s = cache.get(cards);
    if (!s) cache.set(cards, (s = ev.score(cards)));
    return s;
  };
  return [
    { id: 'total', label: 'Score', rate: (cards) => scoreOf(cards).total },
    ...ev.score([]).parts.map((p) => ({
      id: `part:${p.id}`,
      label: p.label,
      rate: (cards: readonly DeckCard[]) => scoreOf(cards).parts.find((q) => q.id === p.id)?.score ?? 0,
    })),
  ];
}

export interface JudgeResult {
  id: string;
  label: string;
  /** Mean rating of the corpus decks themselves. */
  mean: number;
  pile: number;
  /** Per damage id: share of (deck, repeat) pairs where the original rates higher (ties half). */
  damage: Record<string, number>;
  order: number;
  strength?: number;
}

export interface BenchReport {
  corpus: string;
  label: string;
  decks: number;
  repeats: number;
  seed: number;
  judges: JudgeResult[];
}

export interface BenchOptions {
  seed?: number;
  /** Damaged copies and piles per deck (default 5); more repeats, finer rates. */
  repeats?: number;
  damages?: readonly Damage[];
  /** Run on an even sample of at most this many decks, for judges that take time (a playtest per deck). */
  maxDecks?: number;
}

export function runBench(ev: DeckEvaluator, index: CatalogIndex, whole: Corpus, judges: readonly Judge[], options: BenchOptions = {}): BenchReport {
  const step = options.maxDecks ? Math.max(1, Math.ceil(whole.decks.length / options.maxDecks)) : 1;
  const corpus: Corpus = step > 1 ? { ...whole, decks: whole.decks.filter((_, i) => i % step === 0) } : whole;
  const seed = options.seed ?? 1;
  const repeats = options.repeats ?? 5;
  const damages = options.damages ?? DAMAGES;
  const ladder = damages.filter((d) => d.level !== undefined).sort((a, b) => a.level! - b.level!);

  // The same variants for every judge.
  const variants = corpus.decks.map((deck, di) => {
    const pool = eraPool(ev, index, deck.cards);
    const size = copiesOf(deck.cards).length;
    const rng = mulberry32(seed * 7919 + di);
    return Array.from({ length: repeats }, () => ({
      pile: randomPile(pool, size, rng),
      damaged: damages.map((d) => d.apply(deck.cards, pool, rng, ev)),
    }));
  });
  const known = corpus.decks.length > 1 && corpus.decks.every((d) => d.strength !== undefined);

  const results = judges.map((judge): JudgeResult => {
    const own: number[] = [];
    const real: number[] = [];
    const pile: number[] = [];
    const damaged = damages.map(() => [] as number[]);
    const orders: number[] = [];
    corpus.decks.forEach((deck, di) => {
      const r = judge.rate(deck.cards);
      own.push(r);
      for (const v of variants[di]) {
        const p = judge.rate(v.pile);
        const ds = v.damaged.map((cards) => judge.rate(cards));
        real.push(r);
        pile.push(p);
        ds.forEach((d, k) => damaged[k].push(d));
        if (ladder.length) {
          const steps = [r, ...ladder.map((d) => ds[damages.indexOf(d)]), p];
          orders.push(
            spearman(
              steps,
              steps.map((_, i) => -i),
            ),
          );
        }
      }
    });
    const out: JudgeResult = {
      id: judge.id,
      label: judge.label,
      mean: mean(own),
      pile: pairedWins(real, pile),
      damage: Object.fromEntries(damages.map((d, k) => [d.id, pairedWins(real, damaged[k])])),
      order: mean(orders),
    };
    if (known)
      out.strength = spearman(
        own,
        corpus.decks.map((d) => d.strength!),
      );
    return out;
  });
  return { corpus: corpus.id, label: corpus.label, decks: corpus.decks.length, repeats, seed, judges: results };
}

/**
 * Strength from play: every deck meets every other once through `duel`,
 * which returns the share of games the first deck wins; a deck's strength is
 * its mean win rate over its opponents.
 */
export function roundRobin(decks: readonly BenchDeck[], duel: (a: BenchDeck, b: BenchDeck) => number): number[] {
  const sum = decks.map(() => 0);
  for (let i = 0; i < decks.length; i++) {
    for (let j = i + 1; j < decks.length; j++) {
      const w = duel(decks[i], decks[j]);
      sum[i] += w;
      sum[j] += 1 - w;
    }
  }
  return sum.map((s) => (decks.length > 1 ? s / (decks.length - 1) : 0.5));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The report as a Markdown table, one judge per row. */
export function formatReport(report: BenchReport): string {
  const damages = Object.keys(report.judges[0]?.damage ?? {});
  const strength = report.judges.some((j) => j.strength !== undefined);
  const head = ['Judge', 'Mean', 'Beats pile', ...damages.map((d) => `Beats ${d}`), 'Order', ...(strength ? ['Strength'] : [])];
  const rows = report.judges.map((j) => [
    j.label,
    j.mean.toFixed(2),
    pct(j.pile),
    ...damages.map((d) => pct(j.damage[d])),
    j.order.toFixed(2),
    ...(strength ? [(j.strength ?? 0).toFixed(2)] : []),
  ]);
  return [
    `## ${report.label}`,
    '',
    `${report.decks} decks, ${report.repeats} damaged copies of each, seed ${report.seed}.`,
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
  ].join('\n');
}

/** What fell behind the baseline by more than `tolerance`, one line each; empty when nothing regressed. */
export function compareReports(now: BenchReport, baseline: BenchReport, tolerance = 0.03): string[] {
  const out: string[] = [];
  for (const base of baseline.judges) {
    const j = now.judges.find((x) => x.id === base.id);
    if (!j) {
      out.push(`${now.corpus}: judge ${base.id} is missing`);
      continue;
    }
    const check = (name: string, a: number | undefined, b: number | undefined) => {
      if (a === undefined || b === undefined) return;
      if (a < b - tolerance) out.push(`${now.corpus}: ${base.id} ${name} fell from ${b.toFixed(3)} to ${a.toFixed(3)}`);
    };
    check('pile', j.pile, base.pile);
    check('order', j.order, base.order);
    check('strength', j.strength, base.strength);
    for (const [d, b] of Object.entries(base.damage)) check(d, j.damage[d], b);
  }
  return out;
}
