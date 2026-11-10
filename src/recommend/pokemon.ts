/**
 * The Pokémon TCG deck evaluator: reads each card's rules text (card-text.ts)
 * into a few features, then scores a deck on nine rules of thumb every
 * player applies by hand. Each part explains itself in one line, so the
 * builder can say why it suggests a card.
 *
 *   rules    60 cards, four copies at most, one ACE SPEC, one Radiant, one of each Prism Star
 *   basics   enough Basic Pokémon that the opening hand rarely has none
 *   lines    every evolution has what it evolves from (or Rare Candy)
 *   energy   Energy of the attackers' types, in a sensible amount
 *   draw     draw, search and Energy acceleration to find the pieces
 *   power    the best attack hits hard for the deck's era
 *   synergy  cards that name a type, stage or Pokémon have it in the deck
 *   focus    a deck-sized share of Pokémon, in one or two lines, few one-ofs
 *   era      the cards were printed within a few years of each other
 *
 * The era for `power` is the deck's own: the 90th percentile HP of Pokémon
 * printed in the years the deck's sets span, so a Base Set deck is not asked
 * to deal 300 damage. Nothing here learns from published decks; the parts
 * are computed from the cards' own text, which is why the builder can
 * propose decks nobody has played.
 */
import type { CatalogIndex } from '@/data/catalog';
import type { DeckCard } from '@/data/db';
import { overLimit } from '@/data/decks';
import { normalizeText } from '@/data/normalize';
import type { CatalogCard } from '@/data/types';
import { isBasicEnergy, POKEMON_DECK_RULES, type DeckRules } from '@/games/deck-rules';
import { COST_LETTERS, costCount, costTypes, damageValue, type CardText, type CardTextIndex } from './card-text';
import type { BuildOptions, DeckEvaluator, DeckScore, FormatOption, ScorePart } from './types';
import { expectedDamage, pokeMatches, staticView, sustainedOf, type DamageMod, type DeckSupply, type PokeLike } from './sim/damage';
import { attackDrain, attackMiss, attackRest, parseAttackText } from './sim/effects';

/* ---------- features ---------- */

export type Role = 'draw' | 'searchPokemon' | 'searchAny' | 'searchEnergy' | 'accel' | 'switch' | 'gust' | 'heal' | 'recover' | 'disrupt' | 'rareCandy';

/** What a card's text asks of the rest of the deck. */
export interface Mentions {
  /** Energy-type letters ("Fire Pokémon", "Fire Energy"). */
  types: Set<string>;
  /** "Stage 1", "Stage 2", "Evolution". */
  stages: Set<string>;
  /** "ex", "V", "VMAX", "VSTAR", "GX", "EX", "Radiant". */
  suffixes: Set<string>;
  /** National Dex ids of species the text names. */
  species: Set<number>;
}

/** What an evolution card evolves from when the card data does not say and no other printing of the name does. */
export const UNKNOWN_STAGE = 'an earlier stage the card data does not name';

export interface AttackFeature {
  name: string;
  cost: string;
  costN: number;
  /** Typed cost letters, each once. */
  types: string[];
  /** The printed number ("60+" → 60, "20×" → 20). */
  damage: number;
  /** The damage as printed: "60+", "20×", "" when none. */
  printed: string;
  effect: string;
  /** What the text does to the damage (sim/damage.ts). */
  mods: DamageMod[];
  /**
   * The damage expected on the stated typical board (`staticView`): the printed number plus what the text adds,
   * coin flips at their expectation, a conditional bonus half. The one figure the plan choice, the Power part
   * and the playtest's plan line share.
   */
  expected: number;
  /** Energy its own text takes from its user each time (a mandatory discard, or Energy put back): `sustained` divides by max(1, drain) (sim/effects.ts). */
  drain: number;
  /** The share of its next turns a Special Condition on its user costs (Wailord ex's Falling Down: Asleep, a quarter): `sustained` divides by 1 + miss. */
  miss: number;
  /** 1: its user cannot attack next turn; 2: it cannot use this attack next turn; 0: neither (sim/effects.ts). */
  rest: 0 | 1 | 2 | 3;
  /**
   * Damage a turn the attack keeps up: `expected`, except for an attack that rests its user: that one lands
   * every other turn, with the card's next attack (at no higher cost) in between when only the attack itself
   * is barred.
   */
  sustained: number;
}

export interface PokemonFeatures {
  card: CatalogCard;
  text?: CardText;
  /** Normalized name. */
  key: string;
  /** Release year of this printing, 0 when unknown. */
  year: number;
  isPokemon: boolean;
  /** A Pokémon that can be put down from the hand: no "evolves from". */
  isBasic: boolean;
  /** Normalized name of the card this evolves from, "" when none. */
  evolvesFrom: string;
  /** The same as printed ("Cosmoem"), for messages; UNKNOWN_STAGE when no printing of the card says. */
  evolvesFromName: string;
  /** "Stage 1" | "Stage 2" | "" (Basic or a non-staged evolution such as VMAX). */
  stage: string;
  suffix: string;
  /** Energy-type letters of the Pokémon. */
  types: string[];
  attacks: AttackFeature[];
  /** The attack with the highest damage, if any. */
  best?: AttackFeature;
  roles: Set<Role>;
  /** Roles that come from an attack rather than a Trainer or Ability (they weigh half). */
  attackRoles: Set<Role>;
  mentions: Mentions;
  /** Energy cards: the type letters the card provides, or "*" for any type. */
  provides: string;
  isEnergy: boolean;
  isBasicEnergy: boolean;
  isTrainer: boolean;
  trainerType: string;
  /** A Stadium card: only one is in play at a time, so the score gives only a few copies credit (STADIUM_CREDIT). */
  stadium: boolean;
  /** Most copies of this card's name a deck may hold (a Prism Star, or a limit its own text states); Infinity when neither. */
  nameMax: number;
  /** Ids of the GROUP_LIMITS this card counts toward (ACE SPEC, Radiant). */
  groups: string[];
  /** Special Energy only: what it provides, to which Pokémon, read from its text. */
  energy?: EnergyRule;
}

/* ---------- once-per-deck limits, as data ---------- */

/** What the evaluator knows from the whole catalog when it classifies one card. */
export interface LimitKnowledge {
  /** The text objects of every print rated "ACE SPEC Rare" (reprints share one object, so a reprint under another label is caught). */
  aceTexts: ReadonlySet<CardText>;
}

/**
 * A limit on a whole class of cards, whatever their names ("one ACE SPEC card
 * per deck"). `matches` reads only the catalog fields and the card text; how
 * each class is recognised in the data is explained next to its row.
 */
export interface GroupLimit {
  id: string;
  /** How the violation is named in `DeckScore.issues`: "ACE SPEC: 2 in the deck (A, B), 1 at most". */
  label: string;
  max: number;
  matches(card: CatalogCard, text: CardText | undefined, known: LimitKnowledge): boolean;
}

/** Sets of the Black & White series that print ACE SPEC cards as "Rare" Items and Tools (see GROUP_LIMITS). */
export const BW_ACE_SPEC_SETS: ReadonlySet<string> = new Set(['bw7', 'bw8', 'bw9', 'bw10']);

export const GROUP_LIMITS: readonly GroupLimit[] = [
  {
    // Scarlet & Violet prints (sv05–sv08.5, 33 cards) carry the rarity "ACE SPEC Rare". The Black & White prints
    // (Boundaries Crossed to Plasma Blast) are rated plain "Rare" and say nothing about ACE SPEC in the data; they
    // are recognised as the Item and Tool cards rated Rare in those four sets (13 cards; Dragon Vault's Rare Items
    // and the Rare Supporter Ghetsis are left out). That reading is inferred, corroborated by three of them being
    // reprinted as "ACE SPEC Rare" (Master Ball, Scramble Switch, Scoop Up Cyclone), not stated by the text.
    id: 'ace-spec',
    label: 'ACE SPEC',
    max: 1,
    matches: (card, text, known) =>
      card.rarity === 'ACE SPEC Rare' ||
      (!!text && known.aceTexts.has(text)) ||
      (card.cat === 'Trainer' && card.rarity === 'Rare' && BW_ACE_SPEC_SETS.has(card.set) && (text?.tt === 'Item' || text?.tt === 'Tool')),
  },
  {
    // "Radiant " begins the name of all 16 Radiant Pokémon (15 rated "Radiant Rare", the promo Radiant Eevee "Ultra
    // Rare"). The rarity alone would miss the promo, and a text search would catch Solgaleo ◇'s "Radiant Star" attack.
    id: 'radiant',
    label: 'Radiant Pokémon',
    max: 1,
    matches: (card) => card.cat === 'Pokemon' && /^Radiant /.test(card.name),
  },
];

/** A limit on the copies of one name, read off the card. */
export interface NameLimit {
  id: string;
  /** The most copies of this card's name, or undefined when the rule does not apply to the card. */
  max(card: CatalogCard, text: CardText | undefined): number | undefined;
}

const STATED_LIMIT = /You can(?:'|’)t have more than (\d+) ([^.]+?) in your deck/i;

export const NAME_LIMITS: readonly NameLimit[] = [
  {
    // The only limit the card text states ("You can't have more than 1 Miracle Energy in your deck", neo4-16);
    // it counts when it names the card itself.
    id: 'stated',
    max: (card, text) => {
      const m = STATED_LIMIT.exec(text?.fx ?? '');
      return m && normalizeText(m[2]) === normalizeText(card.name) ? Number(m[1]) : undefined;
    },
  },
  {
    // Prism Star cards (27 in the catalog: 16 Pokémon, 9 Trainers, 2 Energy) carry ◇ after their name; a deck may
    // hold one copy of each. The rule itself is not in the text data: the symbol is the only mark.
    id: 'prism-star',
    max: (card) => (card.name.includes('◇') ? 1 : undefined),
  },
];

/* ---------- Special Energy ---------- */

/** A condition on the Pokémon an Energy is attached to. */
export type PokeCond =
  | { kind: 'type'; letter: string }
  | { kind: 'stage'; stage: string }
  | { kind: 'basic' }
  | { kind: 'evolution' }
  /** A group the catalog does not record (Rapid Strike, Ultra Beast, Team Rocket's): met when the printed name says so, otherwise unknown. */
  | { kind: 'name'; text: string };

/** What a Special Energy provides, to which Pokémon: its text read into data. */
export interface EnergyRule {
  /** Letters it provides unconditionally, or "*" for every type. Colorless only is "C". */
  base: string;
  /** Energy it counts as at a time when attached ("only 1 Energy at a time"); 1 when the text does not say. */
  amount: number;
  /** Provides nothing to a Pokémon that fails this ("can only be attached to a Grass Pokémon"). */
  only: PokeCond | null;
  /** Further types given when a condition holds (Stage 2 gets every type); "unread" for a condition that is not about the Pokémon (Prize cards). */
  upgrades: { types: string; cond: PokeCond | 'unread' }[];
  /** True when the text has a clause that can withhold what `base` promises ("provides {C} Energy instead") and could not be read. */
  caveat: boolean;
}

const TYPE_WORDS = Object.keys(COST_LETTERS);
const RE_TYPE_WORD = new RegExp(`(${TYPE_WORDS.join('|')})`, 'g');
// "As long as this card is attached to a Pokémon, it provides ...": the plain statement, not a condition.
const RE_GENERIC_ATTACH = /^(?:(?:as long as|while|when) (?:this card|it) is attached to (?:a|1 of your|your) pokémon\b|while in play\b)/i;
// Clauses that can withhold what the base promises and are not read: a stacking rule, a count of attached Energy.
const RE_CAVEAT = /\b(?:already has|any other) Special Energy\b|basic Energy cards? attached to the Pokémon/i;

/** The letters an Energy sentence provides after "provides", "*" for every type, '' when none are named. */
function typesProvided(sentence: string): string {
  const at = sentence.search(/\b(?:provides?|counts as)\b/i);
  if (at < 0) return '';
  let tail = sentence.slice(at);
  const stop = tail.search(/,? but |,? only while | instead|\. /i);
  if (stop > 0) tail = tail.slice(0, stop);
  if (/every type|all types|each type|any type/i.test(tail)) return '*';
  const out = new Set<string>();
  for (const m of tail.matchAll(/\{([A-Z])\}/g)) out.add(m[1]);
  for (const m of tail.matchAll(RE_TYPE_WORD)) out.add(COST_LETTERS[m[1]]);
  return [...out].join('');
}

function condOf(subject: string): PokeCond | 'unread' {
  const s = subject.replace(/^(?:an?|1 of your)\s+/i, '').replace(/\s+Pokémon$/i, '').trim();
  if (/^Stage [12]$/.test(s)) return { kind: 'stage', stage: s };
  if (/^Basic$/i.test(s)) return { kind: 'basic' };
  if (/^(?:Evolution|Evolved)$/i.test(s)) return { kind: 'evolution' };
  if (COST_LETTERS[s]) return { kind: 'type', letter: COST_LETTERS[s] };
  if (/^[A-Z][A-Za-z' ]{3,}$/.test(s)) return { kind: 'name', text: s };
  return 'unread';
}

/** The condition clause of an Energy sentence ("If this card is attached to a Stage 2 Pokémon"), read into a PokeCond. */
function clauseCond(sentence: string): PokeCond | 'unread' {
  const at = sentence.search(/,\s*(?:it|this card|[A-Z][\w' ]* Energy) provides?\b/);
  if (at < 0) return 'unread';
  const clause = sentence.slice(0, at);
  if (/Prize|Knocked Out|opponent|discard|hand|coin|more than|that |except|isn't|isn’t|doesn't|doesn’t|\band\b/i.test(clause)) return 'unread';
  const m = /(?:attached to|is) (?:an? |1 of your )?([A-Z][A-Za-z' ]*?|Stage [12])(?: Pokémon)?$/.exec(clause);
  return m ? condOf(m[1]) : 'unread';
}

/** Reads a Special Energy's text; null when it names no Energy provided (the caller then treats it as Colorless only). */
export function parseEnergyText(fx: string): EnergyRule | null {
  if (!fx) return null;
  const sentences = fx.split(/(?<=\.\)?)\s+(?=[A-Z({])/);
  let only: PokeCond | null = null;
  const m = /(?:can (?:only )?be attached (?:only )?to|attached only to|only be attached to|only while (?:this card|it) is attached to)\s+(?:an?\s+|1 of your\s+)?([A-Z][A-Za-z' ]*?|Stage [12])(?:\s+Pokémon)?(?=[.,]|\s+(?:if|If|and|The|This|Discard|When|Whenever)\b|$)/.exec(fx);
  if (m) {
    const c = condOf(m[1]);
    only = c === 'unread' ? { kind: 'name', text: m[1] } : c;
  }
  let base = '';
  let amount = 1;
  // "Attach Miracle Energy to 1 of your Shining or Light Pokémon": a restriction naming several groups cannot be read.
  let caveat = !only && /\bAttach [A-Z][\w' ]* Energy to 1 of your [A-Z][\w']*(?: or [A-Z][\w']*)+ Pokémon/.test(fx);
  const upgrades: EnergyRule['upgrades'] = [];
  for (const s of sentences) {
    if (!/\b(?:provides?|counts as)\b/i.test(s)) continue;
    const types = typesProvided(s);
    const am = /only (\d) Energy at a time/i.exec(s) ?? /provides (\d) in any combination/i.exec(s);
    const conditional = /^(?:if|while|as long as|when)\b/i.test(s) && !RE_GENERIC_ATTACH.test(s);
    if (!types) continue;
    if (/ instead\b/i.test(s)) caveat = true;
    if (conditional) {
      upgrades.push({ types, cond: clauseCond(s) });
      continue;
    }
    base = base === '*' || types === '*' ? '*' : [...new Set(base + types)].join('');
    if (am) amount = Number(am[1]);
    // "provides {C} Energy. If ... it provides every type instead" is an upgrade with an unreadable condition.
  }
  // A later sentence may turn a base into something else ("Luminous: ... {C} Energy instead"); without a base, a lone upgrade is the card.
  if (!only && /\b(?:can (?:only )?be attached|attached only to|only be attached)\b/i.test(fx)) caveat = true;
  if (RE_CAVEAT.test(fx)) caveat = true;
  if (!base && !upgrades.length) return null;
  return { base: base || 'C', amount, only, upgrades, caveat };
}

/** Does the Pokémon meet the condition? undefined when the data cannot say. */
export function meetsCond(c: PokeCond, f: Pick<PokemonFeatures, 'types' | 'stage' | 'isBasic' | 'isPokemon' | 'card'>): boolean | undefined {
  switch (c.kind) {
    case 'type':
      return f.types.includes(c.letter);
    case 'stage':
      return f.stage === c.stage;
    case 'basic':
      return f.isBasic;
    case 'evolution':
      return !f.isBasic;
    case 'name':
      return new RegExp(`\\b${c.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(f.card.name) ? true : undefined;
  }
}

/**
 * How much of an `attacker`'s need for Energy type `letter` this Special Energy
 * meets: 1 when its text says it provides the type to that Pokémon, 0.5 when a
 * condition could not be read (Prize cards, Ultra Beast, a group the catalog
 * does not record), 0 when it does not provide it or the Pokémon is not one it
 * may be attached to.
 */
export function energyCredit(rule: EnergyRule, attacker: Pick<PokemonFeatures, 'types' | 'stage' | 'isBasic' | 'isPokemon' | 'card'>, letter: string): number {
  let gate = 1;
  if (rule.only) {
    const ok = meetsCond(rule.only, attacker);
    if (ok === false) return 0;
    if (ok === undefined) gate = 0.5;
  }
  const gives = (types: string) => types === '*' || types.includes(letter);
  let best = gives(rule.base) ? (rule.caveat ? 0.5 : 1) : 0;
  for (const u of rule.upgrades) {
    if (!gives(u.types)) continue;
    const ok = u.cond === 'unread' ? undefined : meetsCond(u.cond, attacker);
    best = Math.max(best, ok === true ? 1 : ok === undefined ? 0.5 : 0);
  }
  return best * gate;
}

const TYPE_NAMES = Object.keys(COST_LETTERS).filter((t) => t !== 'Colorless');
const TYPE_ALT = TYPE_NAMES.join('|');
const RE_TYPE_POKEMON = new RegExp(`\\b(${TYPE_ALT})(?:[- ]type)? Pokémon`, 'g');
const RE_TYPE_ENERGY = new RegExp(`\\b(${TYPE_ALT}) Energy`, 'g');
const RE_SUFFIX = /Pokémon[- ](ex|V|VMAX|VSTAR|GX|EX)\b|\b(VMAX|VSTAR)\b|\bRadiant Pokémon/g;

const ROLE_RULES: [Role, RegExp][] = [
  ['draw', /\bdraw (?:\d+|a|up to \d+) cards?\b|\bdraw cards until\b|\bdraws? \d+ cards?\b/i],
  ['searchPokemon', /\bsearch your deck for (?:up to \d+ |a |an |\d+ )?(?:(?:Basic |Stage \d |Evolution |[A-Z][a-zé]+ )*Pokémon|Evolution cards?|Basic Pokémon)/i],
  ['searchAny', /\bsearch your deck for (?:a card|up to \d+ cards|\d+ cards|any \d+ cards|any card)\b/i],
  ['searchEnergy', /\bsearch your deck for (?:up to \d+ |a |an |\d+ )?(?:Basic |Special |[A-Z][a-z]+ )*Energy/i],
  ['accel', /\battach (?:a|an|\d+|up to \d+) (?:Basic |Special |[A-Z][a-z]+ )*Energy cards? from your (?:deck|discard pile|hand) to\b|\bsearch your deck for .{0,40}Energy cards? and attach (?:it|them)\b/i],
  ['switch', /\bswitch your Active Pokémon with 1 of your Benched Pokémon\b/i],
  ['gust', /\bswitch in 1 of your opponent's Benched Pokémon\b|\b(?:choose|switch) 1 of your opponent's Benched Pokémon and switch it with\b/i],
  ['heal', /\bheal \d+ damage\b|\bremove (?:\d+|all) damage counters?\b/i],
  ['recover', /\bfrom your discard pile (?:into your hand|on top of your deck|and shuffle|into your deck|and put)/i],
  ['disrupt', /\byour opponent (?:shuffles|discards|reveals) (?:their|his or her) hand\b|\bopponent's hand\b/i],
  ['rareCandy', /\bskipping the Stage 1\b/i],
];

/** Basic Energy by name → the letter it provides. */
const BASIC_ENERGY_LETTER: Record<string, string> = {};
for (const [t, l] of Object.entries(COST_LETTERS)) BASIC_ENERGY_LETTER[`${t} Energy`] = l;

/** The letters an Energy card can provide to some Pokémon ("*" for every type); a Special Energy's conditions live in `energy`. */
function providesOf(card: CatalogCard, rule: EnergyRule | undefined): string {
  if (card.cat !== 'Energy') return '';
  const base = card.name.replace(/^Basic /, '');
  if (BASIC_ENERGY_LETTER[base]) return BASIC_ENERGY_LETTER[base];
  if (!rule) return 'C';
  const all = [rule.base, ...rule.upgrades.map((u) => u.types)];
  if (all.includes('*')) return '*';
  const letters = new Set<string>();
  for (const t of all) for (const ch of t) letters.add(ch);
  return [...letters].join('');
}

/** Copies of Stadium cards that earn credit in the draw, search and synergy parts: only one Stadium is in play at a time. */
export const STADIUM_CREDIT = 3;

function mentionsOf(texts: string[], speciesRe: RegExp | null, speciesId: Map<string, number>): Mentions {
  const m: Mentions = { types: new Set(), stages: new Set(), suffixes: new Set(), species: new Set() };
  for (const t of texts) {
    for (const x of t.matchAll(RE_TYPE_POKEMON)) m.types.add(COST_LETTERS[x[1]]);
    for (const x of t.matchAll(RE_TYPE_ENERGY)) m.types.add(COST_LETTERS[x[1]]);
    if (/\bStage 1\b/.test(t)) m.stages.add('Stage 1');
    if (/\bStage 2\b/.test(t)) m.stages.add('Stage 2');
    if (/\bEvolution (?:Pokémon|cards?)\b|\bEvolved Pokémon\b/.test(t)) m.stages.add('Evolution');
    for (const x of t.matchAll(RE_SUFFIX)) m.suffixes.add(x[1] ?? x[2] ?? 'Radiant');
    if (speciesRe) for (const x of t.matchAll(speciesRe)) m.species.add(speciesId.get(x[1])!);
  }
  return m;
}

/** Trainer text mentioning only "Basic Pokémon" asks nothing special of a deck, so Basic is not a mention. */
function hasMentions(m: Mentions): boolean {
  return m.types.size + m.stages.size + m.suffixes.size + m.species.size > 0;
}

/* ---------- evaluator ---------- */

export interface PokemonEvaluatorDeps {
  index: CatalogIndex;
  text: CardTextIndex;
}

/** The Pokémon evaluator also hands out the features it read from a card, for the playtest simulator and the benchmarks. */
export interface PokemonEvaluator extends DeckEvaluator {
  features(card: CatalogCard): PokemonFeatures;
  /**
   * Whether adding `adds` to `cards` keeps every once-per-deck group limit (ACE SPEC, Radiant) that those cards
   * belong to. Name limits (four copies, Prism Star) are `rules.copyLimit`, which `rules` here already folds in.
   */
  fits(cards: readonly DeckCard[], adds: readonly CatalogCard[]): boolean;
}

/** The formats a Pokémon deck can be built for, from TCGdex's legality flags per printing. */
export const POKEMON_FORMATS: readonly FormatOption[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'expanded', label: 'Expanded' },
  { id: 'any', label: 'Any format' },
];

export const POKEMON_WEIGHTS = { rules: 10, basics: 10, lines: 10, energy: 15, draw: 15, power: 10, synergy: 10, focus: 10, era: 10 } as const;

/** Chance that a 7-card opening hand from `n` cards holds none of the `basics`. */
export function mulliganChance(n: number, basics: number): number {
  if (n < 7) return basics > 0 ? 0 : 1;
  let p = 1;
  for (let i = 0; i < 7; i++) p *= Math.max(0, n - basics - i) / (n - i);
  return p;
}

interface Line {
  card: CatalogCard;
  f: PokemonFeatures;
  qty: number;
}

/** What the deck as a whole offers, computed once per deck and shared by the parts and the relevance ranking. */
interface DeckContext {
  lines: Line[];
  pokemon: Line[];
  total: number;
  /** Normalized name → copies. */
  byName: Map<string, number>;
  types: Set<string>;
  stages: Set<string>;
  suffixes: Set<string>;
  species: Set<number>;
  /** Typed letters the attackers' best attacks need. */
  need: Set<string>;
  /** Copies of Stadium cards, over every name. */
  stadiumQty: number;
  /** The Pokémon's printing years, copy-weighted 10th and 90th percentile; 0 when there are none. */
  eraMin: number;
  eraMax: number;
}

function percentileYear(lines: Line[], q: number): number {
  const years: number[] = [];
  for (const l of lines) if (l.f.year) for (let i = 0; i < l.qty; i++) years.push(l.f.year);
  if (!years.length) return 0;
  years.sort((a, b) => a - b);
  return years[Math.min(years.length - 1, Math.floor(years.length * q))];
}

/** The share of a line's copies that earns credit: at most STADIUM_CREDIT Stadium copies count, over all Stadium names. */
function stadiumScale(l: Line, ctx: DeckContext): number {
  return l.f.stadium && ctx.stadiumQty > STADIUM_CREDIT ? STADIUM_CREDIT / ctx.stadiumQty : 1;
}

export interface GroupViolation {
  limit: GroupLimit;
  qty: number;
  names: string[];
}

/** The group limits (ACE SPEC, Radiant) a deck's lines break. */
function groupViolations(lines: readonly Line[]): GroupViolation[] {
  const out: GroupViolation[] = [];
  for (const limit of GROUP_LIMITS) {
    let qty = 0;
    const names: string[] = [];
    for (const l of lines) {
      if (!l.f.groups.includes(limit.id)) continue;
      qty += l.qty;
      if (!names.includes(l.card.name)) names.push(l.card.name);
    }
    if (qty > limit.max) out.push({ limit, qty, names });
  }
  return out;
}

export function createPokemonEvaluator({ index, text }: PokemonEvaluatorDeps): PokemonEvaluator {
  const features = new Map<string, PokemonFeatures>();
  // The deck page keeps POKEMON_DECK_RULES; the evaluator's copy also holds the limits the text and symbols state per name.
  const rules: DeckRules = { ...POKEMON_DECK_RULES, copyLimit: (card) => Math.min(POKEMON_DECK_RULES.copyLimit(card), featuresOf(card).nameMax) };
  const known: LimitKnowledge = { aceTexts: new Set<CardText>() };
  for (const c of index.catalog.cards) {
    const t = c.rarity === 'ACE SPEC Rare' ? text.byId.get(c.id)?.text : undefined;
    if (t) (known.aceTexts as Set<CardText>).add(t);
  }

  // Species names the text can mention, longest first so "Mewtwo" wins over "Mew".
  const speciesId = new Map<string, number>();
  for (const s of index.species) speciesId.set(s.name, s.id);
  const speciesRe = speciesId.size
    ? new RegExp(
        `\\b(${[...speciesId.keys()]
          .sort((a, b) => b.length - a.length)
          .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|')})(?![a-z])`,
        'g',
      )
    : null;

  const yearOf = (card: CatalogCard) => Number(index.setsById.get(card.set)?.releaseDate.slice(0, 4)) || 0;

  // HP by release year, for the era-aware power target.
  const hpByYear = new Map<number, number[]>();
  // Printing years per name, to tell whether a card had a printing in the deck's era.
  const yearsByName = new Map<string, number[]>();
  // What a name evolves from, as some printing says it: 143 Stage 1 and Stage 2 cards (the 30th-anniversary
  // set, Team Magma vs Team Aqua, ...) come without it in the card data.
  const evolvesFromByName = new Map<string, string>();
  for (const card of index.catalog.cards) {
    const from = card.cat === 'Pokemon' ? text.byId.get(card.id)?.text.ev : undefined;
    if (from && !evolvesFromByName.has(normalizeText(card.name))) evolvesFromByName.set(normalizeText(card.name), from);
  }
  for (const card of index.catalog.cards) {
    const year = yearOf(card);
    if (!year) continue;
    const key = normalizeText(card.name);
    let ys = yearsByName.get(key);
    if (!ys) yearsByName.set(key, (ys = []));
    ys.push(year);
    if (card.cat === 'Pokemon' && card.hp) {
      let l = hpByYear.get(year);
      if (!l) hpByYear.set(year, (l = []));
      l.push(card.hp);
    }
  }
  const eraHpCache = new Map<string, number>();
  function eraHp(minYear: number, maxYear: number): number {
    const key = `${minYear}-${maxYear}`;
    let v = eraHpCache.get(key);
    if (v !== undefined) return v;
    const all: number[] = [];
    for (let y = minYear; y <= maxYear; y++) for (const hp of hpByYear.get(y) ?? []) all.push(hp);
    all.sort((a, b) => a - b);
    v = all.length ? all[Math.min(all.length - 1, Math.floor(all.length * 0.9))] : 120;
    eraHpCache.set(key, v);
    return v;
  }

  /** True when some printing of the name falls within the era (a year either side). */
  function printedInEra(key: string, eraMin: number, eraMax: number): boolean {
    if (!eraMin) return true;
    const ys = yearsByName.get(key);
    return !ys || ys.some((y) => y >= eraMin - 1 && y <= eraMax + 1);
  }

  /** A text entry says something: attacks or Abilities for a Pokémon, an effect for a Trainer, an effect or a kind for an Energy. */
  const hasContent = (c: CatalogCard, t: CardText | undefined): boolean => (c.cat === 'Pokemon' ? !!(t?.a?.length || t?.b?.length) : c.cat === 'Energy' ? !!(t?.fx || t?.et) : !!t?.fx);

  /**
   * The printing's text, or, when its entry carries none (the 30th-anniversary Ultra Ball has only
   * "Item"), the text of the most recent printing of the same name and kind (same HP for a Pokémon)
   * that has some; the printing keeps its own regulation mark and legality.
   */
  function textOf(card: CatalogCard): CardText | undefined {
    const own = text.byId.get(card.id)?.text;
    if (hasContent(card, own)) return own;
    for (const other of index.cardsByName.get(normalizeText(card.name)) ?? []) {
      if (other.id === card.id || other.cat !== card.cat || (card.cat === 'Pokemon' && other.hp !== card.hp)) continue;
      const t = text.byId.get(other.id)?.text;
      if (hasContent(other, t)) return t;
    }
    return own;
  }

  function featuresOf(card: CatalogCard): PokemonFeatures {
    let f = features.get(card.id);
    if (f) return f;
    const t = textOf(card);
    const isPokemon = card.cat === 'Pokemon';
    const attacks: AttackFeature[] = (t?.a ?? []).map((a) => {
      const damage = damageValue(a.d);
      const fx = damage > 0 && a.e ? parseAttackText(a.e) : null;
      const mods = fx?.mods ?? [];
      const expected = damage > 0 ? expectedDamage(damage, mods, staticView(costCount(a.c))) : 0;
      return { name: a.n, cost: a.c, costN: costCount(a.c), types: costTypes(a.c), damage, printed: a.d ?? '', effect: a.e ?? '', mods, expected, drain: attackDrain(fx, costCount(a.c)), miss: attackMiss(fx), rest: attackRest(a.e ?? ''), sustained: expected };
    });
    for (const a of attacks) a.sustained = sustainedOf(a, attacks);
    // The best attack is the one that does the most turn after turn, not the biggest number on the card.
    let best: AttackFeature | undefined;
    for (const a of attacks) if (a.damage > 0 && (!best || a.sustained > best.sustained)) best = a;
    const roleTexts = [...(t?.b ?? []).map((b) => b.e), t?.fx ?? ''];
    const roles = new Set<Role>();
    for (const [role, re] of ROLE_RULES) if (roleTexts.some((x) => re.test(x))) roles.add(role);
    const attackRoles = new Set<Role>();
    for (const [role, re] of ROLE_RULES) if (!roles.has(role) && attacks.some((a) => re.test(a.effect))) attackRoles.add(role);
    const m = /^(.*?) (ex|V|VMAX|VSTAR)$|^(.*?)-(GX|EX)$|^Radiant (.*)$/.exec(card.name);
    const energy = card.cat === 'Energy' && !isBasicEnergy(card) ? (parseEnergyText(t?.fx ?? '') ?? undefined) : undefined;
    let nameMax = Infinity;
    for (const rule of NAME_LIMITS) nameMax = Math.min(nameMax, rule.max(card, t) ?? Infinity);
    // A Stage 1 or Stage 2 whose printing does not say what it evolves from takes it from another printing of
    // the name. One that no printing places is still an evolution, with an earlier stage nobody can supply:
    // never a Basic (a deck of four such Stage 2 "Basics" scored well and could not put one into play).
    const evolution = isPokemon && (card.stage === 'Stage1' || card.stage === 'Stage2');
    const from = t?.ev ?? (evolution ? (evolvesFromByName.get(normalizeText(card.name)) ?? UNKNOWN_STAGE) : '');
    f = {
      card,
      text: t,
      key: normalizeText(card.name),
      year: yearOf(card),
      isPokemon,
      isBasic: isPokemon && !from,
      evolvesFrom: from ? normalizeText(from) : '',
      evolvesFromName: from,
      stage: card.stage === 'Stage1' ? 'Stage 1' : card.stage === 'Stage2' ? 'Stage 2' : '',
      suffix: m ? (m[2] ?? m[4] ?? 'Radiant') : '',
      types: (card.types ?? []).map((x) => COST_LETTERS[x]).filter(Boolean),
      attacks,
      best,
      roles,
      attackRoles,
      mentions: mentionsOf(roleTexts, isPokemon ? null : speciesRe, speciesId),
      provides: providesOf(card, energy),
      isEnergy: card.cat === 'Energy',
      isBasicEnergy: isBasicEnergy(card),
      isTrainer: card.cat === 'Trainer',
      trainerType: t?.tt ?? '',
      stadium: card.cat === 'Trainer' && t?.tt === 'Stadium',
      nameMax,
      groups: GROUP_LIMITS.filter((g) => g.matches(card, t, known)).map((g) => g.id),
      energy,
    };
    features.set(card.id, f);
    return f;
  }

  function contextOf(cards: readonly DeckCard[]): DeckContext {
    const byId = new Map<string, Line>();
    for (const c of cards) {
      const card = index.cardsById.get(c.cardId);
      if (!card || c.qty <= 0) continue;
      const l = byId.get(card.id);
      if (l) l.qty += c.qty;
      else byId.set(card.id, { card, f: featuresOf(card), qty: c.qty });
    }
    const lines = [...byId.values()];
    const pokemon = lines.filter((l) => l.f.isPokemon);
    const ctx: DeckContext = {
      lines,
      pokemon,
      total: lines.reduce((n, l) => n + l.qty, 0),
      byName: new Map(),
      types: new Set(),
      stages: new Set(),
      suffixes: new Set(),
      species: new Set(),
      stadiumQty: lines.reduce((n, l) => n + (l.f.stadium ? l.qty : 0), 0),
      need: new Set(),
      eraMin: percentileYear(pokemon, 0.1),
      eraMax: percentileYear(pokemon, 0.9),
    };
    for (const l of lines) ctx.byName.set(l.f.key, (ctx.byName.get(l.f.key) ?? 0) + l.qty);
    for (const l of pokemon) {
      for (const t of l.f.types) ctx.types.add(t);
      if (l.f.stage) ctx.stages.add(l.f.stage);
      if (l.f.evolvesFrom) ctx.stages.add('Evolution');
      if (l.f.suffix) ctx.suffixes.add(l.f.suffix);
      for (const d of l.card.dex ?? []) ctx.species.add(d);
      for (const t of l.f.best?.types ?? []) ctx.need.add(t);
    }
    return ctx;
  }

  function mentionsMet(m: Mentions, ctx: DeckContext): boolean {
    return (
      [...m.types].some((t) => ctx.types.has(t)) ||
      [...m.stages].some((s) => ctx.stages.has(s)) ||
      [...m.suffixes].some((s) => ctx.suffixes.has(s)) ||
      [...m.species].some((s) => ctx.species.has(s))
    );
  }

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const part = (id: keyof typeof POKEMON_WEIGHTS, label: string, score: number, detail: string): ScorePart => ({ id, label, score: clamp01(score), weight: POKEMON_WEIGHTS[id], detail });
  const typeName = (letter: string) => TYPE_NAMES.find((t) => COST_LETTERS[t] === letter) ?? letter;

  function score(cards: readonly DeckCard[]): DeckScore {
    const ctx = contextOf(cards);
    const { lines, pokemon, total, byName } = ctx;
    const parts: ScorePart[] = [];
    const issues: string[] = [];

    // rules
    const over = overLimit(rules, cards, index);
    const overGroups = groupViolations(lines);
    const sizeOff = Math.abs(60 - total);
    for (const o of over) issues.push(`${o.name}: ${o.qty} copies, ${o.limit} at most`);
    for (const g of overGroups) issues.push(`${g.limit.label}: ${g.qty} in the deck (${g.names.join(', ')}), ${g.limit.max} at most`);
    if (sizeOff) issues.push(total < 60 ? `${60 - total} cards to go` : `${total - 60} cards over 60`);
    const broken = over.length + overGroups.length;
    parts.push(
      part(
        'rules',
        'Deck rules',
        1 - sizeOff / 60 - broken * 0.25,
        sizeOff ? `${total} of 60 cards` : broken ? `${broken} deck limit${broken > 1 ? 's' : ''} broken` : '60 cards, copy limits kept',
      ),
    );

    // basics
    const basics = pokemon.filter((l) => l.f.isBasic).reduce((n, l) => n + l.qty, 0);
    const mull = mulliganChance(Math.max(total, 60), basics);
    parts.push(part('basics', 'Basic Pokémon', (0.55 - mull) / 0.3, `${basics} Basic Pokémon: ${pct(mull)} chance of none in the opening hand`));

    // lines: a Stage 2 stands on its Stage 1, or on Rare Candy plus the Basic.
    const rareCandy = lines.filter((l) => l.f.roles.has('rareCandy')).reduce((n, l) => n + l.qty, 0);
    const evos = pokemon.filter((l) => l.f.evolvesFrom);
    let lineScore = 1;
    const missing: string[] = [];
    const thin: string[] = [];
    if (evos.length) {
      let sum = 0;
      let w = 0;
      for (const l of evos) {
        let pre = byName.get(l.f.evolvesFrom) ?? 0;
        if (l.f.stage === 'Stage 2' && rareCandy) {
          const mid = pokemon.find((p) => p.f.key === l.f.evolvesFrom);
          let basic = mid?.f.evolvesFrom ? (byName.get(mid.f.evolvesFrom) ?? 0) : 0;
          if (!basic) for (const p of pokemon) if (p.f.isBasic && evolvesInto(p, l)) basic += p.qty;
          pre += Math.min(rareCandy, basic);
        }
        const r = pre ? Math.min(1, pre / l.qty) : 0;
        if (!pre) missing.push(`${l.card.name} (needs ${l.f.evolvesFromName})`);
        else if (r < 1) thin.push(`${l.card.name} ${l.qty} on ${pre}`);
        sum += r * l.qty;
        w += l.qty;
      }
      lineScore = w ? sum / w : 1;
    }
    parts.push(
      part(
        'lines',
        'Evolution lines',
        lineScore,
        !evos.length ? 'No evolutions to support' : missing.length ? `Missing: ${missing.join(', ')}` : thin.length ? `Thin: ${thin.join(', ')}` : 'Every evolution has its earlier stage',
      ),
    );

    // energy
    const attackers = pokemon.filter((l) => l.f.best);
    const energyLines = lines.filter((l) => l.f.isEnergy);
    const energyCount = energyLines.reduce((n, l) => n + l.qty, 0);
    // Basic Energy covers a type outright. A Special Energy covers it for the attackers its text lets it
    // provide to (energyCredit): fully when the text says so, half where a condition could not be read.
    // One or two Basic Energy of a type do not power an attacker that asks for it: the type counts in full
    // from three copies (a deck built on Psychic Energy with a single Metal Energy once passed for covering
    // four Pokemon with Metal attacks, which then never attacked in practice games).
    const basicCount = new Map<string, number>();
    const specials: EnergyRule[] = [];
    for (const l of energyLines) {
      if (l.f.isBasicEnergy) for (const ch of l.f.provides) basicCount.set(ch, (basicCount.get(ch) ?? 0) + l.qty);
      else if (l.f.energy) specials.push(l.f.energy);
    }
    const creditFor = (a: PokemonFeatures, t: string): number => {
      let best = Math.min(1, (basicCount.get(t) ?? 0) / 3);
      if (best >= 1) return 1;
      for (const rule of specials) best = Math.max(best, energyCredit(rule, a, t));
      return best;
    };
    const accel = lines.reduce((n, l) => n + (l.f.roles.has('accel') ? l.qty : l.f.roles.has('searchEnergy') ? l.qty / 2 : 0) * stadiumScale(l, ctx), 0);
    let energyScore = 0.5;
    let energyDetail = 'No attackers yet';
    if (attackers.length) {
      let covered = 0;
      let w = 0;
      let costSum = 0;
      let attackerQty = 0;
      const uncovered = new Map<string, number>();
      for (const l of attackers) {
        const weight = l.qty * Math.max(1, l.f.best!.damage);
        let credit = 1;
        for (const t of l.f.best!.types) {
          const c = creditFor(l.f, t);
          credit = Math.min(credit, c);
          if (c === 0) uncovered.set(t, (uncovered.get(t) ?? 0) + weight);
        }
        covered += credit * weight;
        w += weight;
        costSum += l.f.best!.costN * l.qty;
        attackerQty += l.qty;
      }
      const avgCost = costSum / attackerQty;
      // Calibrated against the playtest simulator (docs/deck-playtest.md): tuned decks settled on more Energy than
      // the first formula allowed, and acceleration replaces only a few of them.
      // The main attacker's cost sets the amount, not the average over every small Basic that can attack.
      let topCost = 0;
      let topDamage = 0;
      for (const l of attackers) {
        const d = l.f.best!.damage * Math.min(1, l.qty / 3);
        if (d > topDamage) {
          topDamage = d;
          topCost = l.f.best!.costN;
        }
      }
      const target = Math.max(6, Math.min(16, 4 + 3 * Math.max(avgCost, topCost) - Math.min(3, 0.3 * accel)));
      const coverage = w ? covered / w : 0;
      // Only Energy some attacker can use counts toward the amount: Basic Energy of a type no attacker needs, or a
      // Special Energy that provides nothing to these attackers, fills the deck without powering anything.
      let usable = 0;
      // Copies that power nothing at all; an Energy whose condition could not be read is half usable, not dead.
      let dead = 0;
      for (const l of energyLines) {
        let u: number;
        if (!ctx.need.size) u = 1;
        else if (l.f.isBasicEnergy) u = [...l.f.provides].some((t) => ctx.need.has(t)) ? 1 : 0;
        else if (!l.f.energy) u = 0.5;
        else if (!/[^C]/.test(l.f.energy.base + l.f.energy.upgrades.map((x) => x.types).join(''))) u = 1; // Colorless costs
        else {
          u = 0;
          for (const a of attackers) for (const t of a.f.best!.types) u = Math.max(u, energyCredit(l.f.energy, a.f, t));
        }
        usable += l.qty * u;
        if (u === 0) dead += l.qty;
      }
      // Usable Energy is measured against the target; Energy no attacker can use is a dead card on top of that,
      // so swapping good Energy for dead Energy never looks like an improvement, not even in a deck that
      // already runs too many.
      // Short of the target the part falls in proportion, so every Energy added to a deck with none counts (a
      // flat zero there once left a Colorless deck with no Energy at all); five too many, or four dead ones, is zero.
      const quantity = 1 - Math.min(1, Math.max(0, target - usable) / target + Math.max(0, usable - target) / 5 + (1.2 * dead) / 5);
      energyScore = 0.5 * coverage + 0.5 * quantity;
      const unc = [...uncovered]
        .filter(([, weight]) => weight >= 0.15 * w)
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => typeName(t))
        .join(', ');
      energyDetail = `${energyCount} Energy${usable < energyCount ? `, ${Math.round(usable)} that the attackers can use` : ''} (about ${Math.round(target)} fit the attacks)${unc ? `; no Energy for ${unc} attacks` : ''}`;
    }
    parts.push(part('energy', 'Energy', energyScore, energyDetail));

    // draw: both kinds matter, cards that draw (Supporters mostly) and cards that search the deck.
    let draw = 0;
    let search = 0;
    for (const l of lines) {
      const r = l.f.roles;
      const ar = l.f.attackRoles;
      const q = l.qty * stadiumScale(l, ctx);
      if (r.has('draw')) draw += q;
      if (r.has('searchPokemon') || r.has('searchAny')) search += q;
      if (r.has('searchEnergy') || r.has('accel')) search += 0.5 * q;
      if (ar.has('searchPokemon') || ar.has('searchAny') || ar.has('draw')) search += 0.5 * q;
    }
    parts.push(part('draw', 'Draw and search', 0.5 * Math.min(1, draw / 8) + 0.5 * Math.min(1, search / 10), `${Math.round(draw * 10) / 10} draw, ${Math.round(search)} search cards`));

    // power: the best attack's sustained damage on the typical board, crediting only the conditions this deck
    // holds the means for (sim/damage.ts staticView), the same figure the playtest's plan uses.
    let top = 0;
    let topName = '';
    let topCostN = 0;
    const era = ctx.eraMin ? eraHp(ctx.eraMin, ctx.eraMax) : 120;
    const pokeLike = (f: PokemonFeatures): PokeLike => ({ stage: f.stage === 'Stage 2' ? 2 : f.evolvesFrom ? 1 : 0, types: f.types.join(''), suffix: f.suffix, key: f.key, name: f.card.name, abilities: (f.text?.b ?? []).map((b) => ({ name: b.n })), attacks: f.attacks });
    const supply: DeckSupply = {
      pokemon: (t) => pokemon.reduce((n, l) => n + (pokeMatches(pokeLike(l.f), t) ? l.qty : 0), 0),
      energy: (type, special) => lines.reduce((n, l) => n + (l.f.isEnergy && (!special || !l.f.isBasicEnergy) && (!type || l.f.provides === '*' || [...l.f.provides].some((ch) => type.includes(ch))) ? l.qty : 0), 0),
    };
    const inDeck = new Map<AttackFeature, number>();
    for (const l of attackers) {
      const best = l.f.best!;
      const attacks = l.f.attacks.map((a) => ({ ...a, expected: a.mods.length ? expectedDamage(a.damage, a.mods, staticView(a.costN, supply)) : a.expected }));
      inDeck.set(best, sustainedOf(attacks[l.f.attacks.indexOf(best)], attacks));
    }
    for (const l of attackers) {
      // Full credit at three copies: with fewer the attacker is too often prized or not found in time (playtest).
      // Copies count by name, over the printings that hit at least as hard: two printings of one Pokemon are
      // two copies of the attacker, not two attackers of one copy each.
      let copies = 0;
      for (const o of attackers) if (o.f.key === l.f.key && inDeck.get(o.f.best!)! >= inDeck.get(l.f.best!)!) copies += o.qty;
      const d = inDeck.get(l.f.best!)! * Math.min(1, copies / 3);
      // On a tie the cheaper attack is the one a deck plays toward.
      if (d > top || (d === top && d > 0 && l.f.best!.costN < topCostN)) {
        top = d;
        topCostN = l.f.best!.costN;
        topName = `${l.card.name}'s ${l.f.best!.name}${l.f.best!.rest === 3 ? ' (once per stay in the Active Spot)' : l.f.best!.rest ? ' (every other turn)' : ''}`;
      }
    }
    parts.push(part('power', 'Power', attackers.length ? top / (0.75 * era) : 0, attackers.length ? `${topName} for ${Math.round(top)} against ${era} HP Pokémon of the era` : 'No attacks'));

    // synergy
    let conditional = 0;
    let met = 0;
    const dead: string[] = [];
    for (const l of lines) {
      if (l.f.isPokemon && !l.f.text?.b?.length) continue;
      if (!hasMentions(l.f.mentions)) continue;
      const q = l.qty * stadiumScale(l, ctx);
      conditional += q;
      if (mentionsMet(l.f.mentions, ctx)) met += q;
      else dead.push(l.card.name);
    }
    parts.push(part('synergy', 'Synergy', conditional ? met / conditional : 1, dead.length ? `Nothing in the deck for ${dead.join(', ')}` : conditional ? `${Math.round(met)} cards find what they name` : 'No conditional cards'));

    // focus: a deck-sized share of Pokémon (15–35% of the cards), most of them in the two main lines, few one-ofs.
    const pokemonQty = pokemon.reduce((n, l) => n + l.qty, 0);
    const single = pokemon.filter((l) => (byName.get(l.f.key) ?? 0) < 2).reduce((n, l) => n + l.qty, 0);
    const share = total ? pokemonQty / total : 0;
    const shapeScore = share < 0.15 ? share / 0.15 : share <= 0.35 ? 1 : clamp01(1 - (share - 0.35) / 0.25);
    const rootQty = new Map<string, number>();
    for (const l of pokemon) {
      let root = l.f;
      for (let d = 0; d < 3 && root.evolvesFrom; d++) {
        const pre = pokemon.find((p) => p.f.key === root.evolvesFrom);
        if (!pre) break;
        root = pre.f;
      }
      rootQty.set(root.key, (rootQty.get(root.key) ?? 0) + l.qty);
    }
    const top2 = [...rootQty.values()].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);
    const concentration = pokemonQty ? clamp01((top2 / pokemonQty - 0.3) / 0.3) : 0;
    const oneOfs = pokemonQty ? 1 - Math.max(0, single - 3) / pokemonQty : 0;
    const focusDetail = !pokemonQty
      ? 'No Pokémon'
      : shapeScore < 1
        ? `${pokemonQty} Pokémon in ${total} cards: ${share > 0.35 ? 'too many' : 'too few'}`
        : concentration < 1
          ? `${rootQty.size} Pokémon lines; the two biggest hold ${top2} of ${pokemonQty}`
          : single > 3
            ? `${single} of ${pokemonQty} Pokémon are one-ofs`
            : `${rootQty.size} Pokémon lines, ${pokemonQty} Pokémon`;
    parts.push(part('focus', 'Focus', pokemonQty ? (shapeScore + concentration + oneOfs) / 3 : 0, focusDetail));

    // era: the Pokémon within a few years of each other, the rest printed (or reprinted) around then.
    let eraScore = 1;
    let eraDetail = 'No Pokémon yet';
    if (ctx.eraMin) {
      const span = ctx.eraMax - ctx.eraMin;
      let inEra = 0;
      let others = 0;
      const out: string[] = [];
      for (const l of lines) {
        if (l.f.isPokemon) continue;
        others += l.qty;
        if (l.f.isBasicEnergy || printedInEra(l.f.key, ctx.eraMin, ctx.eraMax)) inEra += l.qty;
        else out.push(l.card.name);
      }
      eraScore = 0.5 * clamp01(1 - Math.max(0, span - 3) / 6) + 0.5 * (others ? inEra / others : 1);
      const range = ctx.eraMin === ctx.eraMax ? `${ctx.eraMin}` : `${ctx.eraMin}–${ctx.eraMax}`;
      eraDetail = out.length ? `Pokémon from ${range}; out of era: ${out.slice(0, 4).join(', ')}${out.length > 4 ? '…' : ''}` : `Cards from ${range}`;
    }
    parts.push(part('era', 'Era', eraScore, eraDetail));

    const totalScore = parts.reduce((s, p) => s + p.score * p.weight, 0);
    return { total: Math.round(totalScore * 10) / 10, parts, issues };
  }

  function evolvesInto(basic: Line, stage2: Line): boolean {
    // The Basic's species sits just below the Stage 2's in the Dex when TCGdex has both.
    const a = basic.card.dex ?? [];
    const b = stage2.card.dex ?? [];
    return a.length > 0 && b.length > 0 && b[0] - a[0] > 0 && b[0] - a[0] <= 2;
  }

  function legalIn(card: CatalogCard, format: BuildOptions['format']): boolean {
    if (format === 'any') return true;
    const e = text.byId.get(card.id);
    if (!e) return false;
    return format === 'standard' ? e.standard : e.expanded;
  }

  function pool(options: BuildOptions): CatalogCard[] {
    const out: CatalogCard[] = [];
    for (const printings of index.cardsByName.values()) {
      // One printing per name: an owned one first, else the newest legal one with a picture.
      let pick: CatalogCard | undefined;
      if (options.source !== 'catalog') {
        pick = printings.find((c) => (options.collection.get(c.id)?.qty ?? 0) > 0 && legalIn(c, options.format));
        if (!pick && options.source === 'collection') continue;
      }
      pick ??= printings.find((c) => c.img && legalIn(c, options.format)) ?? printings.find((c) => legalIn(c, options.format));
      if (!pick) continue;
      if (options.avoid?.has(pick.name)) continue;
      // "Basic Fire Energy" is "Fire Energy" under another printed name.
      if (pick.cat === 'Energy' && pick.name.startsWith('Basic ') && index.cardsByName.has(normalizeText(pick.name.slice(6)))) continue;
      out.push(pick);
    }
    return out;
  }

  function requirements(card: CatalogCard, cards: readonly DeckCard[], candidates: readonly CatalogCard[]): CatalogCard[] {
    const out: CatalogCard[] = [];
    const names = new Set<string>();
    for (const c of cards) {
      const k = index.cardsById.get(c.cardId);
      if (k) names.add(normalizeText(k.name));
    }
    let f = featuresOf(card);
    for (let depth = 0; depth < 3 && f.evolvesFrom && !names.has(f.evolvesFrom); depth++) {
      const pre = candidates.find((c) => c.cat === 'Pokemon' && normalizeText(c.name) === f.evolvesFrom);
      if (!pre) break;
      out.push(pre);
      names.add(f.evolvesFrom);
      f = featuresOf(pre);
    }
    return out;
  }

  function kindOf(card: CatalogCard): 'pokemon' | 'trainer' | 'energy' {
    return card.cat === 'Pokemon' ? 'pokemon' : card.cat === 'Energy' ? 'energy' : 'trainer';
  }

  function relevance(cards: readonly DeckCard[], candidates: readonly CatalogCard[]): number[] {
    const ctx = contextOf(cards);
    const evolvesFromInDeck = new Set(ctx.pokemon.map((l) => l.f.evolvesFrom).filter(Boolean));
    const attackers = ctx.pokemon.filter((l) => l.f.best);
    return candidates.map((card) => {
      const f = featuresOf(card);
      if (!ctx.lines.length) return f.isPokemon && f.best ? Math.min(1, f.best.damage / 200) : 0.2;
      let r = ctx.byName.has(f.key) ? 0.9 : 0.1;
      if (f.isPokemon) {
        if (f.evolvesFrom && ctx.byName.has(f.evolvesFrom)) r = Math.max(r, 1);
        if (evolvesFromInDeck.has(f.key)) r = Math.max(r, 1);
        if (f.types.some((t) => ctx.types.has(t))) r = Math.max(r, 0.6);
        if (f.text?.b?.length) r = Math.max(r, 0.5);
      } else if (f.isEnergy) {
        if (f.isBasicEnergy) {
          if ([...f.provides].some((t) => ctx.need.has(t))) r = Math.max(r, 0.95);
          // Attackers that pay in Colorless only still need Energy: any Basic Energy does, their own type first.
          else if (!ctx.need.size && attackers.some((l) => l.f.best!.costN > 0)) r = Math.max(r, [...f.provides].some((t) => ctx.types.has(t)) ? 0.95 : 0.7);
          else r = Math.min(r, 0.1);
        } else if (!attackers.length) {
          if (f.provides === '*') r = Math.max(r, 0.8);
          else r = Math.min(r, 0.1);
        } else {
          // A Special Energy is as relevant as the best it does for one of the deck's attackers.
          let best = 0;
          if (f.energy) for (const a of attackers) for (const t of a.f.best!.types) best = Math.max(best, energyCredit(f.energy, a.f, t));
          if (best > 0) r = Math.max(r, best >= 1 ? 0.85 : 0.6);
          else r = Math.min(r, 0.1);
        }
      } else if (hasMentions(f.mentions)) r = Math.max(r, mentionsMet(f.mentions, ctx) ? 0.8 : 0.05);
      else if (f.roles.size) r = Math.max(r, 0.7);
      else r = Math.max(r, 0.3);
      // A card with no printing near the deck's era is a poor fit, whatever it does.
      if (!f.isBasicEnergy && !printedInEra(f.key, ctx.eraMin, ctx.eraMax)) r *= 0.3;
      return r;
    });
  }

  function fits(cards: readonly DeckCard[], adds: readonly CatalogCard[]): boolean {
    // Most cards belong to no group: no need to tally the deck for them.
    let touched: GroupLimit[] | undefined;
    const addGroups = adds.map((c) => featuresOf(c).groups);
    for (const gs of addGroups) {
      if (!gs.length) continue;
      touched ??= [];
      for (const g of GROUP_LIMITS) if (gs.includes(g.id) && !touched.includes(g)) touched.push(g);
    }
    if (!touched) return true;
    for (const g of touched) {
      let qty = 0;
      for (const c of cards) {
        const card = index.cardsById.get(c.cardId);
        if (card && featuresOf(card).groups.includes(g.id)) qty += c.qty;
      }
      for (const gs of addGroups) if (gs.includes(g.id)) qty++;
      if (qty > g.max) return false;
    }
    return true;
  }

  /**
   * Cards worth building around: evolved attackers (and Basics that hit like one) by printed damage, taken in
   * turn from each Energy type so the ideas are not eight Fire decks.
   */
  function seedIdeas(candidates: readonly CatalogCard[], count: number): CatalogCard[] {
    const byType = new Map<string, { card: CatalogCard; damage: number }[]>();
    for (const card of candidates) {
      const f = featuresOf(card);
      if (!f.isPokemon || !f.best || f.best.damage < 60 || !f.types.length) continue;
      let list = byType.get(f.types[0]);
      if (!list) byType.set(f.types[0], (list = []));
      list.push({ card, damage: f.best.damage });
    }
    const queues = [...byType.keys()].sort().map((t) => byType.get(t)!.sort((x, y) => y.damage - x.damage || (x.card.id < y.card.id ? -1 : 1)));
    const out: CatalogCard[] = [];
    const seen = new Set<string>();
    for (let round = 0; out.length < count && queues.some((q) => q.length > round); round++) {
      for (const q of queues) {
        const pick = q[round];
        if (!pick || seen.has(pick.card.name) || out.length >= count) continue;
        seen.add(pick.card.name);
        out.push(pick.card);
      }
    }
    return out;
  }

  return {
    game: 'pokemon',
    rules,
    formats: POKEMON_FORMATS,
    fits,
    card: (id) => index.cardsById.get(id),
    score,
    pool,
    requirements,
    kindOf,
    relevance,
    seedIdeas,
    features: featuresOf,
  };
}
