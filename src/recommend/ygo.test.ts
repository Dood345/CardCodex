/**
 * The Yu-Gi-Oh! evaluator and the builder on the real catalog and card text.
 * Every test deck is assembled here by rule from the catalog and the text
 * (the cards of one archetype by the catalog's own archetype field, the
 * Level 4 monsters, the Xyz monsters whose materials line asks for them),
 * never from a deck list written by hand. Nothing here ships to the app.
 *
 * `YGO_BENCH=1 npx vitest run src/recommend/ygo.test.ts` also runs the full
 * benchmark and writes scripts/.cache/deck-bench/ygo-report.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { DeckCard } from '@/data/db';
import type { StarterDeckFile } from '@/data/starter-decks';
import type { CatalogCard } from '@/data/types';
import { isExtraDeckCard } from '@/games/deck-rules';
import { expandYgoCatalog, type YgoCatalogFile } from '@/games/ygo/catalog';
import { formatReport, runBench, scoreJudges, type BenchReport, type Corpus } from './bench/bench';
import { swapAny, swapKind, type Damage } from './bench/damage';
import { buildDeck, suggestAdds, suggestSwaps, type SuggestOptions } from './builder';
import type { BuildOptions } from './types';
import { createYgoEvaluator, noneInHand, YGO_WEIGHTS, type YgoFeatures } from './ygo';
import { buildYgoTextIndex, tcgLimitOf, type YgoTextFile } from './ygo-text';

const dataDir = new URL('../../public/data/', import.meta.url);
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8')) as T;
const textFile = read<YgoTextFile>('ygo/text.json');
const index = buildIndex(expandYgoCatalog(read<YgoCatalogFile>('ygo/catalog.json')), []);
const text = buildYgoTextIndex(textFile);
const ev = createYgoEvaluator({ index, text });

const options: SuggestOptions = { source: 'catalog', collection: new Map(), format: 'tcg' };
const pool = ev.pool(options);
const byPc = [...pool].sort((a, b) => a.pc! - b.pc!);
const f = (c: CatalogCard) => ev.features(c);

const lines = (cards: CatalogCard[], qty = 1): DeckCard[] => cards.map((c) => ({ cardId: c.id, qty }));
const count = (cards: readonly DeckCard[]) => cards.reduce((n, c) => n + c.qty, 0);
const partOf = (cards: readonly DeckCard[], id: keyof typeof YGO_WEIGHTS) => ev.score(cards).parts.find((p) => p.id === id)!;
/** `n` copies' worth of `cards`, three of each (fewer for the last), in the given order. */
function threes(cards: CatalogCard[], n: number): DeckCard[] {
  const out: DeckCard[] = [];
  let left = n;
  for (const c of cards) {
    if (left <= 0) break;
    const q = Math.min(3, left);
    out.push({ cardId: c.id, qty: q });
    left -= q;
  }
  return out;
}
const unlimited = (c: CatalogCard) => tcgLimitOf(text, c.pc) === 3;
const isStarter = (x: YgoFeatures) => x.roles.has('search') || x.roles.has('deckSummon');
const plain = (x: YgoFeatures) => x.roles.size === 0 && !x.names.length && !x.mentionArcs.length && !x.mentionRaces.length && !x.mentionAttrs.length;

/**
 * The archetype the tests build around, by rule: of the catalog's archetypes
 * with at least 14 Unlimited Main Deck cards, at least 4 of them starters and
 * no Ritual Monsters, the one with the most starters (ties to the name).
 */
const archetype = (() => {
  const best = index.archetypes
    .map((a) => {
      const cards = byPc.filter((c) => c.arc === a.name && unlimited(c));
      return { name: a.name, cards, starters: cards.filter((c) => isStarter(f(c))).length };
    })
    .filter((a) => a.cards.length >= 14 && a.starters >= 4 && !a.cards.some((c) => f(c).ritual))
    .sort((a, b) => b.starters - a.starters || a.name.localeCompare(b.name))[0];
  return best;
})();
/** Its cards, starters first, then by passcode: 40 copies, three of each. */
const ARC_DECK = threes([...archetype.cards.filter((c) => isStarter(f(c))), ...archetype.cards.filter((c) => !isStarter(f(c)))], 40);
/** 40 different Unlimited Main Deck cards spread over the whole pool by passcode: a pile. */
const PILE = lines(byPc.filter(unlimited).filter((_, i, a) => i % Math.floor(a.length / 40) === 0).slice(0, 40));
/** Level 4 or lower Normal Monsters with no text: what a starter is replaced with. */
const VANILLA = byPc.filter((c) => f(c).normal && f(c).level <= 4 && !c.arc && unlimited(c));

describe('card text', () => {
  it('holds text for nearly every catalog card and reads the TCG list', () => {
    expect(textFile.pc.length).toBeGreaterThan(13000);
    expect(text.tcgLimit.size).toBeGreaterThan(200);
    const extra = byPc.length;
    expect(extra).toBeGreaterThan(10000);
    const values = new Set(text.tcgLimit.values());
    expect([...values].sort()).toEqual([0, 1, 2]);
  });

  it('reads the materials of most Extra Deck monsters', () => {
    const extras = [...index.cardsByPasscode.entries()].filter(([pc, l]) => l[0].pc === pc && isExtraDeckCard(l[0])).map(([, l]) => l[0]);
    const parsed = extras.filter((c) => f(c).materials);
    expect(extras.length).toBeGreaterThan(2000);
    expect(parsed.length / extras.length).toBeGreaterThan(0.9);
  });
});

describe('noneInHand', () => {
  it('is the hypergeometric chance of none of k in an opening hand of five', () => {
    // C(28,5)/C(40,5)
    expect(noneInHand(40, 12)).toBeCloseTo(98280 / 658008, 6);
    expect(noneInHand(40, 0)).toBe(1);
    expect(noneInHand(40, 40)).toBe(0);
    expect(noneInHand(60, 12)).toBeGreaterThan(noneInHand(40, 12));
  });
});

describe('features', () => {
  it('does not take what a card negates for what it does', () => {
    // Text that names "from the Deck" without "your" describes someone else's effect (Ash Blossom's list of what it negates).
    const describing = byPc.filter((c) => {
      const t = text.byPc.get(c.pc!)?.fx ?? '';
      return /from the Deck to the hand/.test(t) && !/from your Deck/.test(t);
    });
    expect(describing.length).toBeGreaterThan(0);
    for (const c of describing) expect(f(c).roles.has('search'), c.name).toBe(false);
    const ash = pool.find((c) => c.name === 'Ash Blossom & Joyous Spring')!;
    expect(f(ash).roles.has('handTrap')).toBe(true);
    expect(isStarter(f(ash))).toBe(false);
  });

  it('finds starters, hand traps, negation and removal in the catalog in plausible numbers', () => {
    const n = (role: Parameters<YgoFeatures['roles']['has']>[0]) => pool.filter((c) => f(c).roles.has(role)).length;
    expect(n('search')).toBeGreaterThan(1000);
    expect(n('deckSummon')).toBeGreaterThan(700);
    expect(n('handTrap')).toBeGreaterThan(100);
    expect(n('handTrap')).toBeLessThan(400);
    expect(n('negate')).toBeGreaterThan(800);
    expect(n('removal')).toBeGreaterThan(1500);
  });

  it('maps monsters to "pokemon" and everything else to "trainer", for every catalog card', () => {
    const kinds = new Set(index.catalog.cards.map((c) => ev.kindOf(c)));
    expect([...kinds].sort()).toEqual(['pokemon', 'trainer']);
    for (const c of pool.slice(0, 500)) expect(ev.kindOf(c)).toBe(c.cat === 'Monster' ? 'pokemon' : 'trainer');
  });
});

describe('Yu-Gi-Oh! evaluator parts', () => {
  it('assembles its test decks from the data', () => {
    expect(archetype, 'an archetype fit to build around').toBeDefined();
    expect(count(ARC_DECK)).toBe(40);
    expect(count(PILE)).toBe(40);
    expect(VANILLA.length).toBeGreaterThan(20);
  });

  it('scores an archetype deck well above a pile of 40 different cards', () => {
    const deck = ev.score(ARC_DECK);
    const pile = ev.score(PILE);
    expect(deck.total).toBeGreaterThan(pile.total + 20);
    expect(deck.parts.reduce((s, p) => s + p.weight, 0)).toBe(100);
    for (const p of deck.parts) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
      expect(p.detail.length).toBeGreaterThan(0);
    }
  });

  it('rules: section sizes, three copies by name, and the TCG list as issues', () => {
    expect(ev.score(ARC_DECK).issues).toEqual([]);
    expect(partOf(ARC_DECK, 'rules').score).toBe(1);
    const short = ARC_DECK.slice(1);
    expect(ev.score(short).issues.some((i) => /Main Deck: \d+ cards to go/.test(i))).toBe(true);
    expect(partOf(short, 'rules').score).toBeLessThan(1);
    // A fourth copy under another printing still counts by name.
    const first = ev.card(ARC_DECK[0].cardId)!;
    const other = index.cardsByPasscode.get(first.pc!)!.find((c) => c.id !== first.id && c.pc === first.pc);
    if (other) expect(ev.score([...ARC_DECK, { cardId: other.id, qty: 1 }]).issues).toContain(`${first.name}: 4 copies, 3 at most`);
    // A Forbidden card, and a Limited card twice.
    const forbidden = byPc.find((c) => tcgLimitOf(text, c.pc) === 0) ?? index.catalog.cards.find((c) => tcgLimitOf(text, c.pc) === 0)!;
    const limited = byPc.find((c) => tcgLimitOf(text, c.pc) === 1)!;
    const banned = [...ARC_DECK.slice(0, -1), { cardId: forbidden.id, qty: 1 }];
    expect(ev.score(banned).issues).toContain(`${forbidden.name} is Forbidden in the TCG`);
    expect(partOf(banned, 'rules').score).toBeLessThan(1);
    expect(ev.score([...ARC_DECK, { cardId: limited.id, qty: 2 }]).issues).toContain(`${limited.name}: 2 copies, Limited to 1 in the TCG`);
    // Under "any" only the three-copy rule applies.
    const any = createYgoEvaluator({ index, text, format: 'any' });
    expect(any.score(banned).issues).toEqual([]);
    expect(any.rules.copyLimit(forbidden)).toBe(3);
    expect(ev.rules.copyLimit(forbidden)).toBe(0);
    expect(ev.rules.copyLimit(limited)).toBe(1);
  });

  it('consistency: starters replaced by vanilla monsters lower it', () => {
    const starters = ARC_DECK.filter((l) => isStarter(f(ev.card(l.cardId)!)));
    expect(starters.length).toBeGreaterThan(1);
    let i = 0;
    const dull = ARC_DECK.map((l) => (isStarter(f(ev.card(l.cardId)!)) ? { cardId: VANILLA[i++].id, qty: l.qty } : l));
    expect(partOf(dull, 'consistency').score).toBeLessThan(partOf(ARC_DECK, 'consistency').score - 0.3);
    expect(partOf(ARC_DECK, 'consistency').detail).toMatch(/starters in 40: \d+% chance of none in the opening 5/);
    // A 60-card deck of the same cards is less consistent than 40.
    const sixty = [...ARC_DECK, ...lines(VANILLA.slice(0, 20))];
    expect(partOf(sixty, 'consistency').score).toBeLessThan(partOf(ARC_DECK, 'consistency').score);
  });

  it('bricks: Level 7+ Normal Monsters nothing can summon count against the deck', () => {
    const big = byPc.filter((c) => f(c).normal && f(c).level >= 7 && !c.arc && unlimited(c)).slice(0, 3);
    expect(big.length).toBe(3);
    const bricked = [...ARC_DECK.slice(0, -3), ...lines(big, 3)];
    expect(count(bricked)).toBeGreaterThanOrEqual(40);
    const p = partOf(bricked, 'bricks');
    expect(p.score).toBeLessThan(partOf(ARC_DECK, 'bricks').score);
    expect(p.detail).toMatch(/with no way to summon it/);
  });

  it('bricks: a Ritual Spell without a Ritual Monster, and a card naming a card the deck lacks', () => {
    const ritualSpell = byPc.find((c) => f(c).ritualSpell && unlimited(c))!;
    const lonely = byPc.find((c) => c.cat === 'Spell' && f(c).names.length === 1 && !f(c).mentionArcs.length && f(c).roles.size <= 2 && unlimited(c))!;
    const base = ARC_DECK.slice(0, -2);
    const deck = [...base, { cardId: ritualSpell.id, qty: 1 }, { cardId: lonely.id, qty: 1 }];
    const p = partOf(deck, 'bricks');
    expect(p.detail).toMatch(/no Ritual Monster|needs /);
    expect(ev.score(deck).parts.find((x) => x.id === 'bricks')!.score).toBeLessThanOrEqual(partOf(ARC_DECK, 'bricks').score);
  });

  it('cohesion: one archetype beats a pile, and cards whose named archetype is absent are called out', () => {
    expect(partOf(ARC_DECK, 'cohesion').score).toBeGreaterThan(0.7);
    expect(partOf(PILE, 'cohesion').score).toBeLessThan(partOf(ARC_DECK, 'cohesion').score - 0.3);
    expect(partOf(ARC_DECK, 'cohesion').detail).toContain(`"${archetype.name}"`);
    // A card that names another archetype, with none of it in the deck.
    const stranger = byPc.find((c) => c.cat === 'Spell' && f(c).mentionArcs.length === 1 && !f(c).mentionArcs.some((a) => archetype.cards.some((x) => x.name.includes(a))) && unlimited(c))!;
    const deck = [...ARC_DECK.slice(0, -1), { cardId: stranger.id, qty: 3 }];
    expect(partOf(deck, 'cohesion').detail).toContain(stranger.name);
    expect(partOf(deck, 'cohesion').score).toBeLessThan(partOf(ARC_DECK, 'cohesion').score);
  });

  it('interaction: hand traps, negation and removal raise it', () => {
    const quiet = threes(byPc.filter((c) => plain(f(c)) && c.cat !== 'Monster'), 40);
    const traps = byPc.filter((c) => f(c).roles.has('handTrap') && unlimited(c)).slice(0, 4);
    const loud = [...quiet.slice(0, -4), ...threes(traps, 12)].slice(0, 40);
    expect(partOf(quiet, 'interaction').score).toBe(0);
    expect(partOf(loud, 'interaction').score).toBeGreaterThan(0.8);
    expect(partOf(loud, 'interaction').detail).toMatch(/^\d+ hand traps/);
  });

  describe('extra', () => {
    // Level 4 non-Tuner Effect Monsters with no text conditions, three of each; Xyz monsters asking for exactly "2 Level 4 monsters".
    const level4 = byPc.filter((c) => f(c).monster && f(c).level === 4 && f(c).effect && !f(c).tuner && plain({ ...f(c), roles: new Set() }) && unlimited(c)).slice(0, 8);
    const level3 = byPc.filter((c) => f(c).monster && f(c).level === 3 && f(c).effect && !f(c).tuner && unlimited(c)).slice(0, 8);
    const spells = byPc.filter((c) => c.cat === 'Spell' && plain(f(c)) && unlimited(c)).slice(0, 6);
    const xyz = [...index.cardsByPasscode.entries()]
      .filter(([pc, l]) => l[0].pc === pc && l[0].frame === 'xyz' && text.byPc.get(pc)?.mt === '2 Level 4 monsters' && unlimited(l[0]))
      .map(([, l]) => l[0])
      .slice(0, 3);
    const main4 = [...threes(level4, 24), ...threes(spells, 16)];
    const main3 = [...threes(level3, 24), ...threes(spells, 16)];

    it('has its test cards', () => {
      expect(level4.length).toBe(8);
      expect(level3.length).toBe(8);
      expect(xyz.length).toBe(3);
      expect(count(main4)).toBe(40);
    });

    it('an Extra Deck of Rank 4 Xyz monsters is all makeable with Level 4s and none with Level 3s', () => {
      const p4 = partOf([...main4, ...lines(xyz)], 'extra');
      const p3 = partOf([...main3, ...lines(xyz)], 'extra');
      expect(p4.score).toBe(1);
      expect(p3.score).toBe(0);
      expect(p3.detail).toMatch(/^0 of 3 can be made/);
      for (const x of xyz) expect(ev.canMake(x, main4)).toBe(true);
    });

    it('without an Extra Deck, it rewards what the Main Deck opens (Tuners open Synchro)', () => {
      const tuners = byPc.filter((c) => f(c).monster && f(c).tuner && f(c).level > 0 && f(c).level <= 4 && unlimited(c)).slice(0, 2);
      const withTuners = [...main4.slice(0, -2), ...lines(tuners, 3)];
      expect(partOf(main4, 'extra').detail).toMatch(/Opens .*Xyz/);
      expect(partOf(withTuners, 'extra').score).toBeGreaterThan(partOf(main4, 'extra').score);
      expect(partOf(withTuners, 'extra').detail).toMatch(/Synchro/);
    });
  });

  it('shape: a deck with no monsters, or all one-ofs, scores lower', () => {
    const spells = byPc.filter((c) => c.cat !== 'Monster' && unlimited(c));
    const balanced = [...threes(archetype.cards.filter((c) => c.cat === 'Monster'), 24), ...threes(spells, 16)];
    expect(count(balanced)).toBe(40);
    expect(partOf(balanced, 'shape').score).toBe(1);
    const noMonsters = threes(spells, 40);
    expect(partOf(noMonsters, 'shape').score).toBeLessThan(0.6);
    expect(partOf(PILE, 'shape').score).toBeLessThan(0.6);
  });

  it('scores a deck quickly', () => {
    ev.score(ARC_DECK);
    const t = performance.now();
    for (let i = 0; i < 200; i++) ev.score(ARC_DECK);
    expect((performance.now() - t) / 200).toBeLessThan(2);
  });
});

describe('pool, formats and relevance', () => {
  it('holds Main Deck cards only, one printing per card, and no Forbidden cards under "tcg"', () => {
    expect(pool.some((c) => isExtraDeckCard(c))).toBe(false);
    expect(new Set(pool.map((c) => c.pc)).size).toBe(pool.length);
    expect(pool.some((c) => tcgLimitOf(text, c.pc) === 0)).toBe(false);
    const any = ev.pool({ ...options, format: 'any' });
    expect(any.length).toBeGreaterThan(pool.length);
    expect(ev.formats?.map((x) => x.id)).toEqual(['tcg', 'any']);
  });

  it('prefers owned printings and keeps to the collection when asked', () => {
    const card = archetype.cards[0];
    const printings = index.cardsByPasscode.get(card.pc!)!.filter((c) => c.pc === card.pc);
    const owned = printings[printings.length - 1];
    const collection = new Map([[owned.id, { qty: 1 }]]) as BuildOptions['collection'];
    const prefer = ev.pool({ ...options, source: 'prefer-collection', collection });
    expect(prefer.find((c) => c.pc === card.pc)!.id).toBe(owned.id);
    const only = ev.pool({ ...options, source: 'collection', collection });
    expect(only.map((c) => c.id)).toEqual([owned.id]);
  });

  it('ranks the archetype first, one pass over the whole pool', () => {
    const deck = ARC_DECK.slice(0, 4);
    const t = performance.now();
    const rel = ev.relevance(deck, pool);
    const ms = performance.now() - t;
    expect(rel.length).toBe(pool.length);
    expect(ms).toBeLessThan(500);
    const top = pool.map((c, i) => ({ c, r: rel[i] })).sort((a, b) => b.r - a.r).slice(0, 20);
    expect(top.filter((x) => x.c.arc === archetype.name || x.c.name.includes(archetype.name)).length).toBeGreaterThan(5);
  });
});

describe('building', () => {
  const seed = archetype.cards.find((c) => isStarter(f(c)) && f(c).monster) ?? archetype.cards[0];

  it('builds a legal 40-card Main Deck with no issues from an archetype seed, then completes an Extra Deck it can make', { timeout: 30_000 }, () => {
    const t = performance.now();
    const built = buildDeck(ev, [seed.id], options, pool);
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(10_000);
    expect(count(built.cards)).toBe(40);
    expect(built.score.issues).toEqual([]);
    expect(built.cards.some((l) => l.cardId === seed.id)).toBe(true);
    // The seed's archetype carries the deck.
    const inArc = built.cards.filter((l) => ev.card(l.cardId)!.arc === archetype.name).reduce((n, l) => n + l.qty, 0);
    expect(inArc).toBeGreaterThanOrEqual(12);

    const full = ev.complete!(built.cards, options, pool);
    const extra = full.filter((l) => isExtraDeckCard(ev.card(l.cardId)));
    expect(count(extra)).toBeGreaterThan(0);
    expect(count(extra)).toBeLessThanOrEqual(15);
    for (const l of extra) expect(ev.canMake(ev.card(l.cardId)!, built.cards), ev.card(l.cardId)!.name).toBe(true);
    const s = ev.score(full);
    expect(s.issues).toEqual([]);
    expect(s.parts.find((p) => p.id === 'extra')!.score).toBe(1);
    expect(full.filter((l) => !isExtraDeckCard(ev.card(l.cardId)))).toEqual(built.cards);
  });

  it('suggests adds and swaps with reasons', { timeout: 30_000 }, () => {
    const adds = suggestAdds(ev, ARC_DECK.slice(0, 10), options, pool);
    expect(adds.length).toBeGreaterThan(0);
    for (const a of adds) {
      expect(a.reason).toMatch(/: \d+% → \d+%$/);
      expect(a.move.add.every((c) => !isExtraDeckCard(c))).toBe(true);
    }
    const swaps = suggestSwaps(ev, PILE, options, pool);
    expect(swaps.length).toBeGreaterThan(0);
    expect(swaps[0].delta).toBeGreaterThan(0);
  });

  it('brings a Ritual Monster its Ritual Spell', () => {
    const monster = byPc.find((c) => f(c).ritual && f(c).monster && f(c).names.some((n) => pool.some((p) => p.name === n && f(p).ritualSpell)))!;
    const req = ev.requirements(monster, ARC_DECK, pool);
    expect(req.length).toBe(1);
    expect(f(req[0]).ritualSpell).toBe(true);
  });
});

/* ---------- benchmark ---------- */

/** The harness's damages with Yu-Gi-Oh! labels: Spells and Traps count as the "trainer" kind, monsters as "pokemon"; there is no Energy. */
const YGO_DAMAGES: readonly Damage[] = [
  swapAny(6),
  swapAny(12),
  swapAny(24),
  swapKind('trainer', 1 / 3, 'spells-traps', 'a third of the Spells and Traps swapped for random Spells and Traps'),
  swapKind('pokemon', 1 / 3, 'monsters', 'a third of the monsters swapped for random monsters'),
];

/** Seeds by rule: the archetypes with the most starters (as above), one starter monster of each, `n` of them. */
function seedsByRule(n: number): CatalogCard[] {
  return index.archetypes
    .map((a) => {
      const cards = byPc.filter((c) => c.arc === a.name && unlimited(c));
      const starters = cards.filter((c) => isStarter(f(c)) && f(c).monster);
      return { name: a.name, cards, starters };
    })
    .filter((a) => a.cards.length >= 14 && a.starters.length >= 3)
    .sort((a, b) => b.starters.length - a.starters.length || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((a) => a.starters[0]);
}

function builtCorpusYgo(seeds: CatalogCard[]): Corpus {
  return {
    id: 'ygo-built',
    label: `Yu-Gi-Oh! decks built from ${seeds.length} seeds, with an Extra Deck`,
    decks: seeds.map((s) => ({ id: `built-${s.id}`, name: s.name, cards: ev.complete!(buildDeck(ev, [s.id], options, pool).cards, options, pool) })),
  };
}

function starterCorpus(limit?: number): Corpus {
  const decks = read<StarterDeckFile>('ygo/decks.json').decks.slice(0, limit);
  return {
    id: 'ygo-starters',
    label: `Yu-Gi-Oh! Structure and Starter Decks (${decks.length}, public/data/ygo/decks.json)`,
    decks: decks.map((d) => ({ id: d.id, name: d.name, cards: d.cards.map(([cardId, qty]) => ({ cardId, qty })) })),
  };
}

const rateOf = (r: BenchReport, judge: string) => r.judges.find((j) => j.id === judge)!;

describe('benchmark (small)', () => {
  it('the score tells built and published decks from piles and damaged copies', { timeout: 60_000 }, () => {
    const judges = scoreJudges(ev);
    expect(judges.map((j) => j.id)).toEqual(['total', ...Object.keys(YGO_WEIGHTS).map((k) => `part:${k}`)]);
    const built = runBench(ev, index, builtCorpusYgo(seedsByRule(3)), judges, { repeats: 2, damages: YGO_DAMAGES });
    const starters = runBench(ev, index, starterCorpus(20), judges, { repeats: 2, damages: YGO_DAMAGES });
    expect(rateOf(built, 'total').pile).toBe(1);
    expect(rateOf(built, 'total').damage['swap-12']).toBeGreaterThan(0.8);
    expect(rateOf(starters, 'total').pile).toBeGreaterThan(0.8);
    expect(rateOf(starters, 'total').order).toBeGreaterThan(0.3);
  });
});

it.runIf(process.env.YGO_BENCH)('benchmark (full): writes scripts/.cache/deck-bench/ygo-report.md', { timeout: 30 * 60_000 }, () => {
  const judges = scoreJudges(ev);
  const t = performance.now();
  const seeds = seedsByRule(12);
  const corpora = [builtCorpusYgo(seeds), starterCorpus()];
  const buildMs = performance.now() - t;
  const reports = corpora.map((c) => runBench(ev, index, c, judges, { damages: YGO_DAMAGES }));
  const outDir = new URL('../../scripts/.cache/deck-bench/', import.meta.url);
  mkdirSync(outDir, { recursive: true });
  const body = [
    `# Yu-Gi-Oh! deck benchmark`,
    '',
    `Seeds: ${seeds.map((s) => `${s.name} (${s.arc})`).join('; ')}. Built in ${Math.round(buildMs)} ms.`,
    '',
    ...reports.map(formatReport),
  ].join('\n');
  writeFileSync(new URL('ygo-report.md', outDir), body);
  writeFileSync(new URL('ygo-report.json', outDir), JSON.stringify(reports, null, 2));
});
