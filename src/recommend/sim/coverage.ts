/**
 * How much of the cards' text the pilot follows, as numbers the benchmark can
 * hold to. Four shares, by copies over a set of decks or by name over a card
 * pool: Trainer copies the pilot plays with every sentence accounted for,
 * Ability copies it uses the same way, Special Energy copies whose text is
 * followed beyond the type provided, and damaging attack copies whose text
 * is fully acted on (an attack with no text counts). "Followed" is the
 * parser's sentence accounting (effects.ts `ParsedText.followed`): every
 * sentence either read into an effect the engine applies or on the explicit
 * no-op list. What is not followed is grouped by the kind of its first unread
 * sentence, with example card names, so the report says what to read next.
 */
import type { DeckCard } from '@/data/db';
import type { CatalogCard } from '@/data/types';
import type { PokemonEvaluator } from '../pokemon';
import { compileCard, compileDeck, type SimCard } from './cards';
import type { ParsedText } from './effects';

export type CoverageId = 'trainers' | 'abilities' | 'energy' | 'attacks';

export interface CoverageGroup {
  kind: string;
  copies: number;
  /** Up to five card names, most copies first. */
  examples: string[];
}

export interface CoverageMetric {
  id: CoverageId;
  label: string;
  copies: number;
  followed: number;
  /** followed / copies (1 when there are no copies). */
  share: number;
  /** Copies not followed by the kind of their first unread sentence, largest first. */
  groups: CoverageGroup[];
}

export type Coverage = CoverageMetric[];

const LABELS: Record<CoverageId, string> = {
  trainers: 'Trainer copies played with every sentence followed',
  abilities: 'Ability copies used with every sentence followed',
  energy: 'Special Energy copies whose text is followed',
  attacks: 'Damaging attack copies whose text is fully acted on',
};

/**
 * The kind of an unread sentence, for the report. The first pattern that matches names the group;
 * the order puts the specific before the general.
 */
const KINDS: readonly [string, RegExp][] = [
  ['coin flips', /\bflip (?:a|\d+|two|three) coins?\b|\bheads\b|\btails\b/i],
  ['damage for each Energy', /(?:more damage|damage) (?:for each|times)[^.]*Energy/i],
  ['damage for each Benched or in play', /(?:more damage|damage) for each[^.]*(?:Benched|in play|of your Pokémon|of your opponent's Pokémon)/i],
  ['damage for each damage counter', /damage for each damage counter/i],
  ['damage for each Prize card', /damage for each[^.]*Prize/i],
  ['damage for each card in hand or discard pile', /damage for each[^.]*(?:hand|discard)/i],
  ['damage for each (other count)', /(?:more damage|damage) (?:for each|times)/i],
  ['more damage on a condition', /this attack does \d+ more damage|have this attack do \d+ more damage|do \d+ more damage|does \d+ more damage/i],
  ['does nothing unless', /this attack does nothing/i],
  ['Special Condition', /is now (?:Burned|Poisoned|Paralyzed|Asleep|Confused)|Special Conditions?/i],
  ['gust', /switch in 1 of your opponent's Benched|switch out your opponent's Active/i],
  ['discards its own Energy', /discard (?:all|an?|\d+|up to \d+|any amount of|any number of)[^.]*Energy[^.]*(?:from|attached to) (?:this Pokémon|your Pokémon|among your Pokémon)|shuffle \d+ Energy attached to this Pokémon/i],
  ['damages itself', /damage to itself/i],
  ['hits the Bench', /damage to (?:\d|each) of your opponent's (?:Benched )?Pokémon|damage counters on your opponent's Benched|damage counters on \d of your opponent's/i],
  ['protects itself next turn', /during your opponent's next turn, (?:prevent|this Pokémon takes)/i],
  ['locks the opponent', /can't (?:retreat|attack|play|use)[^.]*(?:opponent's next turn|their next turn)|during your opponent's next turn[^.]*can't/i],
  ['heals', /heal \d+|heal all|remove (?:\d+|up to \d+|all) damage counters?/i],
  ["Energy of the opponent's", /Energy from (?:your opponent's|\d of your opponent's)|from the Attacking Pokémon/i],
  ["opponent's hand or deck", /opponent (?:reveals|shuffles|discards|counts)|opponent's (?:hand|deck)|each player|both players/i],
  ['Weakness and Resistance', /isn't affected by (?:Weakness|Resistance|any effects)/i],
  ['Rule Box', /Rule Box/i],
  ['Pokémon Tool', /Pokémon Tool/i],
  ['Stadium', /Stadium/i],
  ['recovery from the discard pile', /from your discard pile|from your opponent's discard pile/i],
  ['Energy moved', /\bmove (?:a|an|\d+|up to \d+|any amount of|all|any number of)[^.]*Energy/i],
  ['Retreat Cost', /Retreat Cost/i],
  ['HP change', /gets [+-]\d+ HP|\+\d+ HP|-\d+ HP/i],
  ['damage prevented or reduced', /takes? \d+ less damage|prevent all (?:damage|effects)/i],
  ['damage boost', /do \d+ more damage|does \d+ more damage/i],
  ['cost reduced', /costs? [A-Z][a-z]+ less|costs? \d+ Energy less|can use the .* attack for/i],
  ['to the hand from play', /put (?:this Pokémon|an? [A-Z][a-z]+ Energy attached|an Energy attached|\d of your Pokémon)[^.]*into your hand|all attached cards into your hand/i],
  ['deck search (wording not read)', /search your deck/i],
  ['"instead"', /\binstead\b/i],
  ['"only if"', /\bonly (?:if|when|during)\b|can't use this card unless/i],
  ['Prize cards', /Prize cards?/i],
  ['Bench size', /on their Bench|Pokémon on your Bench/i],
  ['condition "if"', /\bif\b|\bunless\b|\bas long as\b|\bwhile\b/i],
  ['for each', /\bfor each\b/i],
  ['evolving', /\bevolve/i],
  ['Abilities turned off', /have no Abilities|has no Abilities/i],
];

/** The group name of a text that is not followed: the kind of its first unread sentence. */
export function kindOf(fx: ParsedText): string {
  const s = fx.sentences.find((x) => x.status === 'unread');
  if (!s) return fx.unread || 'followed';
  if (s.why === 'passive') return 'passive Ability';
  if (s.why.startsWith('search wider')) return s.why;
  for (const [kind, re] of KINDS) if (re.test(s.text)) return kind;
  return `other: "${s.text.slice(0, 50)}${s.text.length > 50 ? '…' : ''}"`;
}

interface Tally {
  copies: number;
  followed: number;
  groups: Map<string, { copies: number; names: Map<string, number> }>;
}

function newTally(): Tally {
  return { copies: 0, followed: 0, groups: new Map() };
}

function count(t: Tally, fx: ParsedText | null, name: string, w: number): void {
  t.copies += w;
  if (!fx || fx.followed) {
    t.followed += w;
    return;
  }
  const kind = kindOf(fx);
  let g = t.groups.get(kind);
  if (!g) t.groups.set(kind, (g = { copies: 0, names: new Map() }));
  g.copies += w;
  g.names.set(name, (g.names.get(name) ?? 0) + w);
}

/** Count one card's texts with weight `w` (its copies, or 1 per name). */
function countCard(ts: Record<CoverageId, Tally>, c: SimCard, w: number): void {
  if (c.kind === 'trainer') count(ts.trainers, c.unread ? { ...(c.fx ?? emptyText()), followed: false } : c.fx, c.name, w);
  else if (c.kind === 'energy') {
    if (!c.basicEnergy) count(ts.energy, c.fx, c.name, w);
  } else {
    for (const ab of c.abilities) count(ts.abilities, ab.fx.effects.length ? ab.fx : { ...ab.fx, followed: false }, `${c.name}: ${ab.name}`, w);
    for (const a of c.attacks) if (a.damage > 0) count(ts.attacks, a.fx, `${c.name}: ${a.name}`, w);
  }
}

function emptyText(): ParsedText {
  return { effects: [], discardCost: 0, chance: 1, endsTurn: false, mods: [], unread: 'other', sentences: [], followed: false };
}

function finish(ts: Record<CoverageId, Tally>): Coverage {
  return (Object.keys(LABELS) as CoverageId[]).map((id) => {
    const t = ts[id];
    const groups: CoverageGroup[] = [...t.groups]
      .sort((a, b) => b[1].copies - a[1].copies || a[0].localeCompare(b[0]))
      .map(([kind, g]) => ({
        kind,
        copies: g.copies,
        examples: [...g.names]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 5)
          .map(([n]) => n),
      }));
    return { id, label: LABELS[id], copies: t.copies, followed: t.followed, share: t.copies ? t.followed / t.copies : 1, groups };
  });
}

/** Coverage over deck lists, by copies. */
export function coverageOfDecks(ev: PokemonEvaluator, decks: readonly (readonly DeckCard[])[]): Coverage {
  const ts: Record<CoverageId, Tally> = { trainers: newTally(), abilities: newTally(), energy: newTally(), attacks: newTally() };
  for (const deck of decks) {
    const d = compileDeck(ev, deck);
    const copies = new Map<number, number>();
    for (const i of d.list) copies.set(i, (copies.get(i) ?? 0) + 1);
    for (const [i, n] of copies) countCard(ts, d.cards[i], n);
  }
  return finish(ts);
}

/** Coverage over a card pool, one printing per name (the first seen). */
export function coverageOfPool(ev: PokemonEvaluator, pool: readonly CatalogCard[]): Coverage {
  const ts: Record<CoverageId, Tally> = { trainers: newTally(), abilities: newTally(), energy: newTally(), attacks: newTally() };
  const seen = new Set<string>();
  for (const card of pool) {
    if (seen.has(card.name)) continue;
    seen.add(card.name);
    countCard(ts, compileCard(ev, card, 0), 1);
  }
  return finish(ts);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The coverage as Markdown: a table of the four shares, then the largest groups not followed with examples. */
export function formatCoverage(cov: Coverage, groups = 6): string {
  const out = ['| Text followed | Copies | Followed | Share |', '| --- | --- | --- | --- |'];
  for (const m of cov) out.push(`| ${m.label} | ${m.copies} | ${m.followed} | ${pct(m.share)} |`);
  out.push('');
  for (const m of cov) {
    if (!m.groups.length) continue;
    out.push(`${m.label}, largest groups not followed:`);
    for (const g of m.groups.slice(0, groups)) out.push(`- ${g.kind}: ${g.copies} (${pct(g.copies / m.copies)}) e.g. ${g.examples.join(', ')}`);
    out.push('');
  }
  return out.join('\n');
}
