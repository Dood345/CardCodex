/**
 * The Pokémon TCG deck evaluator: reads each card's rules text (card-text.ts)
 * into a few features, then scores a deck on nine rules of thumb every
 * player applies by hand. Each part explains itself in one line, so the
 * builder can say why it suggests a card.
 *
 *   rules    60 cards, four copies at most
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
import { isBasicEnergy, POKEMON_DECK_RULES } from '@/games/deck-rules';
import { COST_LETTERS, costCount, costTypes, damageValue, type CardText, type CardTextIndex } from './card-text';
import type { BuildOptions, DeckEvaluator, DeckScore, ScorePart } from './types';

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

export interface AttackFeature {
  name: string;
  cost: string;
  costN: number;
  /** Typed cost letters, each once. */
  types: string[];
  damage: number;
  effect: string;
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

function providesOf(card: CatalogCard, text: CardText | undefined): string {
  if (card.cat !== 'Energy') return '';
  const base = card.name.replace(/^Basic /, '');
  if (BASIC_ENERGY_LETTER[base]) return BASIC_ENERGY_LETTER[base];
  const fx = text?.fx ?? '';
  if (/provides? .*(?:every type|any type|each type|all types|Energy of each type|1 Energy of any type)/i.test(fx) || /provides 2 Energy/i.test(fx)) return '*';
  const types = new Set<string>();
  for (const m of fx.matchAll(RE_TYPE_ENERGY)) types.add(COST_LETTERS[m[1]]);
  return types.size ? [...types].join('') : 'C';
}

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

export function createPokemonEvaluator({ index, text }: PokemonEvaluatorDeps): DeckEvaluator {
  const rules = POKEMON_DECK_RULES;
  const features = new Map<string, PokemonFeatures>();

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

  function featuresOf(card: CatalogCard): PokemonFeatures {
    let f = features.get(card.id);
    if (f) return f;
    const t = text.byId.get(card.id)?.text;
    const isPokemon = card.cat === 'Pokemon';
    const attacks: AttackFeature[] = (t?.a ?? []).map((a) => ({
      name: a.n,
      cost: a.c,
      costN: costCount(a.c),
      types: costTypes(a.c),
      damage: damageValue(a.d),
      effect: a.e ?? '',
    }));
    let best: AttackFeature | undefined;
    for (const a of attacks) if (a.damage > 0 && (!best || a.damage > best.damage)) best = a;
    const roleTexts = [...(t?.b ?? []).map((b) => b.e), t?.fx ?? ''];
    const roles = new Set<Role>();
    for (const [role, re] of ROLE_RULES) if (roleTexts.some((x) => re.test(x))) roles.add(role);
    const attackRoles = new Set<Role>();
    for (const [role, re] of ROLE_RULES) if (!roles.has(role) && attacks.some((a) => re.test(a.effect))) attackRoles.add(role);
    const m = /^(.*?) (ex|V|VMAX|VSTAR)$|^(.*?)-(GX|EX)$|^Radiant (.*)$/.exec(card.name);
    f = {
      card,
      text: t,
      key: normalizeText(card.name),
      year: yearOf(card),
      isPokemon,
      isBasic: isPokemon && !t?.ev,
      evolvesFrom: t?.ev ? normalizeText(t.ev) : '',
      stage: card.stage === 'Stage1' ? 'Stage 1' : card.stage === 'Stage2' ? 'Stage 2' : '',
      suffix: m ? (m[2] ?? m[4] ?? 'Radiant') : '',
      types: (card.types ?? []).map((x) => COST_LETTERS[x]).filter(Boolean),
      attacks,
      best,
      roles,
      attackRoles,
      mentions: mentionsOf(roleTexts, isPokemon ? null : speciesRe, speciesId),
      provides: providesOf(card, t),
      isEnergy: card.cat === 'Energy',
      isBasicEnergy: isBasicEnergy(card),
      isTrainer: card.cat === 'Trainer',
      trainerType: t?.tt ?? '',
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
    const sizeOff = Math.abs(60 - total);
    for (const o of over) issues.push(`${o.name}: ${o.qty} copies, ${o.limit} at most`);
    if (sizeOff) issues.push(total < 60 ? `${60 - total} cards to go` : `${total - 60} cards over 60`);
    parts.push(part('rules', 'Deck rules', 1 - sizeOff / 60 - over.length * 0.25, sizeOff ? `${total} of 60 cards` : over.length ? `${over.length} over the copy limit` : '60 cards, copy limits kept'));

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
        if (!pre) missing.push(`${l.card.name} (needs ${l.f.text?.ev})`);
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
    // Basic Energy covers a type outright; Special Energy that provides it (or any type) counts half, since
    // its conditions (one per deck, one per Pokémon, no other Special Energy) are not read here.
    const basicProvided = new Set<string>();
    const specialProvided = new Set<string>();
    let anySpecial = false;
    for (const l of energyLines) {
      if (l.f.provides === '*') anySpecial = true;
      else for (const ch of l.f.provides) (l.f.isBasicEnergy ? basicProvided : specialProvided).add(ch);
    }
    const accel = lines.reduce((n, l) => n + (l.f.roles.has('accel') ? l.qty : l.f.roles.has('searchEnergy') ? l.qty / 2 : 0), 0);
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
        const need = l.f.best!.types;
        if (need.every((t) => basicProvided.has(t))) covered += weight;
        else if (anySpecial || need.every((t) => basicProvided.has(t) || specialProvided.has(t))) covered += 0.5 * weight;
        else for (const t of need) if (!basicProvided.has(t) && !specialProvided.has(t)) uncovered.set(t, (uncovered.get(t) ?? 0) + weight);
        w += weight;
        costSum += l.f.best!.costN * l.qty;
        attackerQty += l.qty;
      }
      const avgCost = costSum / attackerQty;
      const target = Math.max(5, Math.min(16, 4 + 2.5 * avgCost - 0.75 * accel));
      const coverage = w ? covered / w : 0;
      const quantity = 1 - Math.min(1, Math.abs(energyCount - target) / 5);
      energyScore = 0.5 * coverage + 0.5 * quantity;
      const unc = [...uncovered]
        .filter(([, weight]) => weight >= 0.15 * w)
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => typeName(t))
        .join(', ');
      energyDetail = `${energyCount} Energy (about ${Math.round(target)} fit the attacks)${unc ? `; no Energy for ${unc} attacks` : ''}`;
    }
    parts.push(part('energy', 'Energy', energyScore, energyDetail));

    // draw: both kinds matter, cards that draw (Supporters mostly) and cards that search the deck.
    let draw = 0;
    let search = 0;
    for (const l of lines) {
      const r = l.f.roles;
      const ar = l.f.attackRoles;
      if (r.has('draw')) draw += l.qty;
      if (r.has('searchPokemon') || r.has('searchAny')) search += l.qty;
      if (r.has('searchEnergy') || r.has('accel')) search += 0.5 * l.qty;
      if (ar.has('searchPokemon') || ar.has('searchAny') || ar.has('draw')) search += 0.5 * l.qty;
    }
    parts.push(part('draw', 'Draw and search', 0.5 * Math.min(1, draw / 8) + 0.5 * Math.min(1, search / 10), `${draw} draw, ${Math.round(search)} search cards`));

    // power
    let top = 0;
    let topName = '';
    const era = ctx.eraMin ? eraHp(ctx.eraMin, ctx.eraMax) : 120;
    for (const l of attackers) {
      const d = l.f.best!.damage * Math.min(1, l.qty / 2);
      if (d > top) {
        top = d;
        topName = `${l.card.name}'s ${l.f.best!.name}`;
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
      conditional += l.qty;
      if (mentionsMet(l.f.mentions, ctx)) met += l.qty;
      else dead.push(l.card.name);
    }
    parts.push(part('synergy', 'Synergy', conditional ? met / conditional : 1, dead.length ? `Nothing in the deck for ${dead.join(', ')}` : conditional ? `${met} cards find what they name` : 'No conditional cards'));

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
        if ([...f.provides].some((t) => ctx.need.has(t))) r = Math.max(r, f.isBasicEnergy ? 0.95 : 0.85);
        else if (f.provides === '*') r = Math.max(r, 0.8);
        else r = Math.min(r, 0.1);
      } else if (hasMentions(f.mentions)) r = Math.max(r, mentionsMet(f.mentions, ctx) ? 0.8 : 0.05);
      else if (f.roles.size) r = Math.max(r, 0.7);
      else r = Math.max(r, 0.3);
      // A card with no printing near the deck's era is a poor fit, whatever it does.
      if (!f.isBasicEnergy && !printedInEra(f.key, ctx.eraMin, ctx.eraMax)) r *= 0.3;
      return r;
    });
  }

  return { game: 'pokemon', rules, card: (id) => index.cardsById.get(id), score, pool, requirements, kindOf, relevance };
}
