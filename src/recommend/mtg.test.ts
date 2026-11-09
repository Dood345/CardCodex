/**
 * The Magic evaluator, its text file and the builder on the real catalog and
 * Oracle text. Every test deck is assembled here by rule from the data (the
 * strongest mono-red creatures of the most common red creature type in
 * Standard, basic lands found by name, cards found by what their text says),
 * never from a list written by hand. Nothing here ships to the app.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import type { CollectionMap } from '@/data/collection';
import type { DeckCard } from '@/data/db';
import { normalizeText } from '@/data/normalize';
import type { CatalogCard } from '@/data/types';
import { expandMtgCatalog, type MtgCatalogFile } from '@/games/mtg/catalog';
import { formatReport, runBench, scoreJudges } from './bench/bench';
import { builtCorpus } from './bench/built';
import { swapAny, swapKind } from './bench/damage';
import { buildDeck, suggestAdds } from './builder';
import { colourChance, costMv, createMtgEvaluator, hyperAtLeast, landDrops, landTarget, MTG_FORMATS, mtgSeeds, saturating, type MtgEvaluator } from './mtg';
import { buildMtgTextIndex, MTG_TEXT_FORMATS, type MtgTextFile } from './mtg-text';
import type { BuildOptions } from './types';

const dataDir = new URL('../../public/data/', import.meta.url);
const read = <T,>(f: string): T => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8')) as T;
const file = read<MtgTextFile>('mtg/text.json');
const index = buildIndex(expandMtgCatalog(read<MtgCatalogFile>('mtg/catalog.json')), []);
const text = buildMtgTextIndex(file);
const ev = createMtgEvaluator({ index, text, format: 'standard' });
const options: BuildOptions = { source: 'catalog', collection: new Map(), format: 'standard' };
const pool = ev.pool(options);

/** The newest printing of a card by name. */
const byName = (name: string) => index.cardsByName.get(normalizeText(name))?.[0];
const deck = (lines: [CatalogCard, number][]): DeckCard[] => {
  const out = new Map<string, number>();
  for (const [c, n] of lines) out.set(c.id, (out.get(c.id) ?? 0) + n);
  return [...out].map(([cardId, qty]) => ({ cardId, qty }));
};
const partOf = (e: MtgEvaluator, cards: DeckCard[], id: string) => e.score(cards).parts.find((p) => p.id === id)!.score;
const count = (cards: DeckCard[]) => cards.reduce((n, c) => n + c.qty, 0);

/** Basic land by colour letter, by name (CR 305.6 names the basic land types of the five colours). */
const BASIC: Record<string, CatalogCard> = Object.fromEntries(
  Object.entries({ W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }).map(([c, n]) => [c, byName(n)!]),
);

/** Mono-coloured creatures of the pool, strongest first by the evaluator's threat value (ties to the lower id). */
function creaturesOf(colour: string): CatalogCard[] {
  return pool
    .filter((c) => {
      const f = ev.features(c);
      return f.isCreature && f.colours === colour && !f.legendary;
    })
    .sort((a, b) => ev.features(b).threat - ev.features(a).threat || (a.id < b.id ? -1 : 1));
}

/** The creature type most common among a colour's mono-coloured creatures. */
function commonType(colour: string): string {
  const n = new Map<string, number>();
  for (const c of creaturesOf(colour)) for (const t of ev.features(c).provides) if (t.startsWith('type:') && t !== 'type:*') n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0][0];
}

const RED_TYPE = commonType('R');
const redCreatures = creaturesOf('R');
const redOfType = redCreatures.filter((c) => ev.features(c).provides.has(RED_TYPE));

/** `spells` four of each until `60 - lands` copies, then `lands` basics of `colour`. */
function fill(spells: readonly CatalogCard[], lands: number, colour = 'R'): DeckCard[] {
  const lines: [CatalogCard, number][] = [];
  let left = 60 - lands;
  for (const c of spells) {
    if (left <= 0) break;
    const n = Math.min(4, left);
    lines.push([c, n]);
    left -= n;
  }
  lines.push([BASIC[colour], lands]);
  return deck(lines);
}

/** The base deck: nine 4-ofs of the strongest red creatures of the most common type, 24 Mountains. */
const base = fill([...redOfType, ...redCreatures.filter((c) => !redOfType.includes(c))], 24);
const nonCreatureRed = (role: string) =>
  pool
    .filter((c) => {
      const f = ev.features(c);
      return !f.isCreature && !f.isLand && f.colours === 'R' && f.roles.has(role as never);
    })
    .sort((a, b) => ev.features(a).mv - ev.features(b).mv || (a.id < b.id ? -1 : 1));
/** The base deck with its last two creature lines (eight copies) replaced by `cards`, four each. */
const replaceTwo = (cards: CatalogCard[]) => {
  const spells = base.filter((l) => l.cardId !== BASIC.R.id);
  return deck([...spells.slice(0, -2).map((l) => [ev.card(l.cardId)!, l.qty] as [CatalogCard, number]), [cards[0], 4], [cards[1], 4], [BASIC.R, 24]]);
};

describe('hypergeometric helpers', () => {
  it('match a direct product', () => {
    let none = 1;
    for (let i = 0; i < 7; i++) none *= (36 - i) / (60 - i);
    expect(hyperAtLeast(60, 24, 7, 1)).toBeCloseTo(1 - none, 10);
    expect(hyperAtLeast(60, 0, 7, 1)).toBe(0);
    expect(hyperAtLeast(60, 60, 7, 7)).toBeCloseTo(1, 10);
  });

  it('ask for more lands as the curve rises, and count every land', () => {
    for (let k = 2; k < 6; k++) expect(landTarget(60, k + 1)).toBeGreaterThan(landTarget(60, k));
    for (let m = 1; m < 30; m++) expect(landDrops(60, m + 1, 4)).toBeGreaterThan(landDrops(60, m, 4));
    expect(saturating(8, 8)).toBeCloseTo(0.9, 10);
  });

  it('gives colour odds that rise with sources and reach 1 when every source makes the colour', () => {
    expect(colourChance(60, 24, 24, 3, 2)).toBeCloseTo(1, 10);
    expect(colourChance(60, 24, 14, 3, 2)).toBeGreaterThan(colourChance(60, 24, 8, 3, 2));
    expect(colourChance(60, 24, 0, 1, 1)).toBe(0);
  });
});

describe('Magic card text', () => {
  it('covers the catalog and reads by Oracle id', () => {
    expect(file.game).toBe('mtg');
    expect(file.formats).toEqual([...MTG_TEXT_FORMATS]);
    const oids = new Set(index.catalog.cards.map((c) => c.oid));
    expect(text.byKey.size).toBeGreaterThan(0.99 * oids.size);
    const bolt = byName('Lightning Bolt')!;
    expect(text.get(bolt.oid)?.text).toMatch(/deals 3 damage to any target/);
    expect(text.get(byName('Forest')!.oid)?.produces).toBe('G');
    const island = text.get(byName('Island')!.oid)!;
    for (const f of MTG_TEXT_FORMATS) expect(island.legal.has(f)).toBe(true);
  });

  it('keeps each face of a multi-faced card', () => {
    const dfc = index.catalog.cards.find((c) => (c.sub ?? '').includes(' // ') && (text.get(c.oid)?.faces.length ?? 0) === 2)!;
    expect(dfc).toBeDefined();
    const faces = text.get(dfc.oid)!.faces;
    expect(dfc.name.split(' // ')).toEqual(faces.map((f) => f.n));
  });
});

describe('Magic evaluator features', () => {
  it('maps kinds as the builder shares its attention', () => {
    expect(ev.kindOf(redCreatures[0])).toBe('pokemon');
    expect(ev.kindOf(BASIC.R)).toBe('energy');
    expect(ev.kindOf(nonCreatureRed('removal')[0])).toBe('trainer');
    expect(MTG_FORMATS.map((f) => f.id)).toEqual(expect.arrayContaining(['standard', 'pioneer', 'modern', 'any']));
  });

  it('reads roles from the text: a card that only counters a spell is a counterspell', () => {
    const counter = index.catalog.cards.find((c) => text.get(c.oid)?.text === 'Counter target spell.')!;
    expect(ev.features(counter).roles.has('counter')).toBe(true);
    const shock = byName('Lightning Bolt')!;
    expect(ev.features(shock).roles.has('removal')).toBe(true);
    // Ward's reminder text ("counter it unless that player pays") is gone from the file, so ward is not a counterspell.
    const ward = index.catalog.cards.find((c) => {
      const e = text.get(c.oid);
      return e?.keywords.includes('Ward') && !/counter/i.test(e.text.replace(/Ward/g, ''));
    })!;
    expect(ev.features(ward).roles.has('counter')).toBe(false);
  });

  it('casts a split or adventure card by its front half', () => {
    expect(costMv('{2}{W}{W}')).toBe(4);
    expect(costMv('{X}{R}')).toBe(1);
    expect(costMv('{2/W}{U/P}')).toBe(3);
    const halves = index.catalog.cards.filter((c) => (c.cost ?? '').includes(' // '));
    expect(halves.length).toBeGreaterThan(100);
    for (const c of halves) {
      const f = ev.features(c);
      const front = c.cost!.split(' // ')[0];
      expect(f.mv).toBe(costMv(front));
      expect(f.pips.reduce((n, p) => n + p.n, 0)).toBeLessThanOrEqual(Math.max(1, f.mv));
    }
  });

  it('allows any number of the cards that say so, and one of a restricted card in Vintage', () => {
    const anyNumber = index.catalog.cards.find((c) => /A deck can have any number of cards named/.test(text.get(c.oid)?.text ?? ''))!;
    expect(ev.rules.copyLimit(anyNumber)).toBe(Infinity);
    expect(ev.rules.copyLimit(BASIC.R)).toBe(Infinity);
    const restricted = index.catalog.cards.find((c) => text.get(c.oid)?.restricted.has('vintage'))!;
    const vintage = ev.withFormat('vintage');
    expect(vintage.rules.copyLimit(restricted)).toBe(1);
    expect(ev.withFormat('legacy').rules.copyLimit(restricted)).not.toBe(1);
    const two = deck([[restricted, 2], [BASIC.R, 58]]);
    expect(vintage.score(two).issues.some((i) => i.includes(restricted.name) && i.includes('restricted'))).toBe(true);
  });

  it('brings a partner the card searches for by name', () => {
    const anyPool = ev.withFormat('any').pool({ ...options, format: 'any' });
    const names = new Set(anyPool.map((c) => normalizeText(c.name)));
    const seeker = anyPool.find((c) => ev.features(c).partners.some((p) => names.has(p)))!;
    expect(seeker).toBeDefined();
    const req = ev.requirements(seeker, [], anyPool);
    expect(req.length).toBeGreaterThan(0);
    expect(ev.features(seeker).partners).toContain(normalizeText(req[0].name));
    // Nothing is required once the partner is in the deck.
    expect(ev.requirements(seeker, [{ cardId: req[0].id, qty: 1 }], anyPool)).toEqual([]);
  });
});

describe('Magic evaluator parts', () => {
  it('scores the base deck as a legal 60-card Standard deck', () => {
    expect(redOfType.length).toBeGreaterThanOrEqual(4);
    expect(count(base)).toBe(60);
    const s = ev.score(base);
    expect(s.issues).toEqual([]);
    expect(s.parts.reduce((n, p) => n + p.weight, 0)).toBe(100);
    for (const p of s.parts) expect(p.detail.length).toBeGreaterThan(0);
  });

  it('marks too few lands down on the lands part', () => {
    const spells = [...redCreatures];
    expect(partOf(ev, fill(spells, 14), 'lands')).toBeLessThan(partOf(ev, fill(spells, 24), 'lands') - 0.3);
    expect(partOf(ev, fill(spells, 36), 'lands')).toBeLessThan(partOf(ev, fill(spells, 24), 'lands') - 0.3);
  });

  it('marks off-colour lands and a four-colour pile down on the colours part', () => {
    const offColour = base.map((l) => (l.cardId === BASIC.R.id ? { ...l, qty: 12 } : l)).concat([{ cardId: BASIC.U.id, qty: 12 }]);
    expect(partOf(ev, offColour, 'colours')).toBeLessThan(partOf(ev, base, 'colours') - 0.2);
    const four: [CatalogCard, number][] = [];
    for (const c of ['W', 'U', 'B', 'R']) {
      for (const card of creaturesOf(c).slice(0, 3)) four.push([card, 3]);
      four.push([BASIC[c], 6]);
    }
    const pile = deck(four);
    expect(count(pile)).toBe(60);
    expect(partOf(ev, pile, 'colours')).toBeLessThan(partOf(ev, base, 'colours') - 0.2);
    expect(partOf(ev, pile, 'focus')).toBeLessThan(partOf(ev, base, 'focus'));
  });

  it('marks a top-heavy deck down on the curve part', () => {
    const dear = redCreatures.filter((c) => ev.features(c).mv >= 5);
    expect(partOf(ev, fill(dear, 24), 'curve')).toBeLessThan(partOf(ev, base, 'curve') - 0.2);
  });

  it('rewards draw on the card-advantage part and removal on the interaction part', () => {
    const draw = nonCreatureRed('drawMany');
    expect(partOf(ev, replaceTwo(draw), 'cards')).toBeGreaterThan(partOf(ev, base, 'cards'));
    const removal = nonCreatureRed('removal');
    expect(partOf(ev, replaceTwo(removal), 'interaction')).toBeGreaterThan(partOf(ev, base, 'interaction') + 0.2);
  });

  it('marks weak creatures down on the threats part', () => {
    const weakest = [...redCreatures].reverse();
    expect(partOf(ev, fill(weakest, 24), 'threats')).toBeLessThan(partOf(ev, base, 'threats') - 0.2);
  });

  it('rewards a card that names a creature type when the deck has that type', () => {
    // The red card that asks for a creature type, of the type most red creatures have.
    const ofType = (t: string) => redCreatures.filter((c) => ev.features(c).provides.has(t));
    const payoffs = pool.filter((c) => ev.features(c).colours === 'R' && [...ev.features(c).needs].some((t) => t.startsWith('type:')));
    const ranked = payoffs
      .map((card) => {
        const t = [...ev.features(card).needs].filter((x) => x.startsWith('type:')).sort((a, b) => ofType(b).length - ofType(a).length)[0];
        return { card, t, n: ofType(t).filter((c) => c !== card).length };
      })
      .sort((a, b) => b.n - a.n || (a.card.id < b.card.id ? -1 : 1));
    const { card: payoff, t: type, n } = ranked[0];
    expect(n, `red creatures of ${type}`).toBeGreaterThanOrEqual(9);
    const withType = fill([payoff, ...ofType(type).filter((c) => c !== payoff)], 24);
    const others = redCreatures.filter((c) => !ev.features(c).provides.has(type) && !ev.features(c).provides.has('type:*'));
    const without = fill([payoff, ...others], 24);
    const detail = (cards: DeckCard[]) => ev.score(cards).parts.find((p) => p.id === 'synergy')!.detail;
    expect(detail(without)).toContain(payoff.name);
    expect(detail(withType)).not.toContain(payoff.name);
    expect(partOf(ev, withType, 'synergy')).toBeGreaterThan(partOf(ev, without, 'synergy'));
  });

  it('marks a pile of one-ofs down on the focus part', () => {
    const singles: [CatalogCard, number][] = redCreatures.slice(0, 36).map((c) => [c, 1]);
    singles.push([BASIC.R, 24]);
    expect(partOf(ev, deck(singles), 'focus')).toBeLessThan(partOf(ev, base, 'focus') - 0.3);
  });

  it('raises issues for size, copies and format legality', () => {
    const short = base.map((l) => (l.cardId === BASIC.R.id ? { ...l, qty: 23 } : l));
    expect(ev.score(short).issues).toContain('1 cards to go');
    const five = base.map((l, i) => (i === 0 ? { ...l, qty: 5 } : l.cardId === BASIC.R.id ? { ...l, qty: 23 } : l));
    expect(ev.score(five).issues.some((i) => /5 copies, 4 at most/.test(i))).toBe(true);
    const modernOnly = index.catalog.cards.find((c) => {
      const e = text.get(c.oid);
      return e?.legal.has('modern') && !e.legal.has('standard') && c.cat === 'Creature';
    })!;
    const withIllegal = [...base.slice(0, -1), { cardId: modernOnly.id, qty: 1 }, { cardId: BASIC.R.id, qty: 23 }];
    expect(ev.score(withIllegal).issues).toContain(`${modernOnly.name} is not legal in Standard`);
    expect(partOf(ev, withIllegal, 'rules')).toBeLessThan(1);
    expect(ev.withFormat('modern').score(withIllegal).issues).toEqual([]);
    expect(ev.withFormat('any').score(withIllegal).issues).toEqual([]);
  });
});

describe('Magic pool, relevance and builder', () => {
  it('pools one legal printing per card, owned first', () => {
    expect(pool.length).toBeGreaterThan(2000);
    expect(new Set(pool.map((c) => c.name)).size).toBe(pool.length);
    for (const c of pool) expect(ev.legalIn(c, 'standard')).toBe(true);
    const reprinted = pool.find((c) => (index.cardsByName.get(normalizeText(c.name))?.length ?? 0) > 2)!;
    const older = index.cardsByName.get(normalizeText(reprinted.name))!.at(-1)!;
    const collection: CollectionMap = new Map([[older.id, { cardId: older.id, qty: 1, wanted: 0, addedAt: 0, updatedAt: 0 }]]);
    const anyEv = ev.withFormat('any');
    expect(anyEv.pool({ ...options, format: 'any', source: 'prefer-collection', collection }).find((c) => c.name === reprinted.name)?.id).toBe(older.id);
    expect(anyEv.pool({ ...options, format: 'any', source: 'collection', collection }).map((c) => c.id)).toEqual([older.id]);
  });

  it('ranks on-colour lands above off-colour ones in one pass', () => {
    const rel = ev.relevance(base, [BASIC.R, BASIC.U, ...pool.slice(0, 50)]);
    expect(rel.length).toBe(52);
    expect(rel[0]).toBeGreaterThan(rel[1]);
  });

  it('suggests a land to a deck short of lands', { timeout: 30_000 }, () => {
    const short = fill(redCreatures, 12);
    const adds = suggestAdds(ev, short.map((l) => (l.cardId === BASIC.R.id ? l : l)), options, pool);
    expect(adds.length).toBeGreaterThan(0);
    expect(adds.some((s) => s.move.add.some((c) => c.cat === 'Land'))).toBe(true);
  });

  it('builds a legal 60-card deck with a sensible land count from a seed in a few seconds', { timeout: 60_000 }, () => {
    const seed = mtgSeeds(ev, pool, 1)[3]; // the red seed
    const t = performance.now();
    const built = buildDeck(ev, [seed.id], options, pool);
    const ms = performance.now() - t;
    expect(count(built.cards)).toBe(60);
    expect(built.score.issues).toEqual([]);
    const lands = built.cards.filter((l) => ev.card(l.cardId)?.cat === 'Land').reduce((n, l) => n + l.qty, 0);
    expect(lands).toBeGreaterThanOrEqual(16);
    expect(lands).toBeLessThanOrEqual(27);
    expect(built.cards.some((l) => ev.card(l.cardId)?.name === seed.name)).toBe(true);
    expect(ms).toBeLessThan(15_000);
  });
});

/** The benchmark's damages with Magic labels (the harness's own say Trainers, Energy and Pokémon). */
const MTG_DAMAGES = [
  swapAny(6),
  swapAny(12),
  swapAny(24),
  swapKind('trainer', 1 / 3, 'spells', 'a third of the noncreature spells swapped for random ones'),
  swapKind('energy', 1 / 2, 'lands', 'half of the lands swapped for random lands'),
  swapKind('pokemon', 1 / 3, 'creatures', 'a third of the creatures and planeswalkers swapped for random ones'),
];

describe('Magic benchmark', () => {
  // The full run (12 seeds, two per colour and two multicoloured, judged under Standard and under no format):
  // MTG_BENCH=1 npx vitest run src/recommend/mtg.test.ts → scripts/.cache/deck-bench/mtg-report.md
  it.runIf(process.env.MTG_BENCH)('full run over 12 seeds', { timeout: 30 * 60_000 }, () => {
    const corpus = builtCorpus(ev, mtgSeeds(ev, pool, 2), options, pool);
    const anyEv = ev.withFormat('any');
    const out = [
      `# Magic deck benchmark (${new Date().toISOString().slice(0, 10)})`,
      '',
      `Seeds: ${corpus.decks.map((d) => d.name).join(', ')}.`,
      '',
      formatReport(runBench(ev, index, corpus, scoreJudges(ev), { seed: 1, repeats: 5, damages: MTG_DAMAGES })),
      '### The same decks judged under no format (legality issues off)',
      '',
      formatReport(runBench(anyEv, index, corpus, scoreJudges(anyEv), { seed: 1, repeats: 5, damages: MTG_DAMAGES })),
    ];
    const dir = new URL('../../scripts/.cache/deck-bench/', import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('mtg-report.md', dir), out.join('\n'));
  });

  it('tells built decks from damaged copies', { timeout: 120_000 }, () => {
    const seeds = mtgSeeds(ev, pool, 1).slice(0, 3);
    const corpus = builtCorpus(ev, seeds, options, pool);
    const report = runBench(ev, index, corpus, scoreJudges(ev), { seed: 1, repeats: 3, damages: MTG_DAMAGES });
    expect(formatReport(report)).toContain('| Score |');
    const total = report.judges.find((j) => j.id === 'total')!;
    expect(total.pile).toBeGreaterThanOrEqual(0.95);
    expect(total.damage['swap-12']).toBeGreaterThanOrEqual(0.9);
    expect(total.damage.creatures).toBeGreaterThanOrEqual(0.8);
  });
});
