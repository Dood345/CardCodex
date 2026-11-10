/**
 * Turns a deck list into the simulator's card table: one SimCard per distinct
 * card with everything the pilot asks during a game already read (stage,
 * what it evolves from, attacks, Abilities, Trainer effects, what an Energy
 * provides, prize value), plus the deck's plan (its main attacker line).
 * Compiled once per deck; games index the table by number.
 */
import type { DeckCard } from '@/data/db';
import type { CatalogCard } from '@/data/types';
import { COST_LETTERS } from '../card-text';
import type { PokemonEvaluator } from '../pokemon';
import { energyMatches, expectedDamage, pokeMatches, staticView, sustainedOf, type DeckSupply } from './damage';
import { meetsCond } from '../pokemon';
import type { UnreadCard } from './types';
import { parseAbility, parseAttackText, parseEnergyText, parseStaticsText, parseText, type ParsedAbility, type ParsedText } from './effects';
import { prizeValue } from './rules';

export interface SimAttack {
  name: string;
  cost: string;
  costN: number;
  /** The printed number; `printed` keeps its "+" or "×". */
  damage: number;
  printed: string;
  /** The text's effects; `fx.mods` is what it does to the damage, applied at attack time (engine.ts `gameView`). */
  fx: ParsedText | null;
  /** Expected damage on the typical board (`AttackFeature.expected`): what the pilot compares attacks by before a game. */
  expected: number;
  /** Energy its own text takes from its user each time (`AttackFeature.drain`). */
  drain: number;
  /** 1: the Pokémon cannot attack on its next turn; 2: it cannot use this attack; 0: neither. */
  rest: 0 | 1 | 2;
  /** Damage a turn the attack keeps up (`AttackFeature.sustained`). */
  sustained: number;
}

export interface SimCard {
  /** Index in the deck's table. */
  i: number;
  card: CatalogCard;
  name: string;
  /** Normalized name, as the evaluator's features give it. */
  key: string;
  kind: 'pokemon' | 'trainer' | 'energy';
  /** A Basic Pokémon that can be put down from the hand. */
  basic: boolean;
  /** Key of the card this evolves from, "" when none. */
  from: string;
  /** 0 Basic, 1 Stage 1 (and other one-step evolutions: VMAX, VSTAR, …), 2 Stage 2. */
  stage: number;
  hp: number;
  /** Type letters of the Pokémon (weakness and resistance key off these). */
  types: string;
  retreat: number;
  weak: { t: string; mul: number; add: number }[];
  resist: { t: string; amt: number }[];
  attacks: SimAttack[];
  abilities: ParsedAbility[];
  prize: number;
  suffix: string;
  /** Trainer subtype: Item, Supporter, Stadium, Tool. */
  tt: string;
  /** A Trainer's text, or a Special Energy's (whose effects the pilot does not act on: `provides` is what it reads). */
  fx: ParsedText | null;
  /** Energy: type letters provided to any holder, "*" for any; "" for non-Energy. */
  provides: string;
  /**
   * A Special Energy's rule, resolved against this deck's Pokémon: `onlyKeys` the Pokémon it may be attached to
   * (null: any), `upgrades` what it provides instead to those holders (keys), `amount` Energy at a time.
   */
  energy?: { amount: number; onlyKeys: Set<string> | null; upgrades: { types: string; amount: number; keys: Set<string> }[] };
  /** Why the pilot cannot use this card ("" when it can or it needs no reading). */
  unread: string;
  /** Stage 2: key of the Basic Rare Candy puts it on, "" when unknown. */
  candyBase: string;
  /** Pokémon with an Ability the pilot can use (search, draw, acceleration). */
  engine: boolean;
  basicEnergy: boolean;
  /** A Stadium whose effect either player may use ("Once during each player's turn"). */
  shared: boolean;
}

export interface Plan {
  /** Key of the main attacker. */
  attacker: string;
  attackerName: string;
  attack: SimAttack;
  /** Keys from the attacker down to its Basic. */
  line: string[];
  root: string;
  /** One line for the report. */
  detail: string;
}

export interface CompiledDeck {
  cards: SimCard[];
  /** Table index per card of the deck, qty times. */
  list: number[];
  plan: Plan | null;
  /** Keys of the support lines (Pokémon whose Abilities the pilot uses, and what they evolve from). */
  support: Set<string>;
  basics: number;
  rareCandy: number;
  unread: UnreadCard[];
  /** Pokémon played whose Ability the pilot cannot use: passive ones, and activated ones whose text was not read. */
  partlyRead: UnreadCard[];
  /** Deck lines whose card id the catalog does not know. */
  unknown: number;
}

/** Name → what it evolves from, over the whole catalog, for Stage 2 lines that skip their Stage 1 (Rare Candy). */
const catalogEvolution = new WeakMap<PokemonEvaluator, Map<string, string>>();

function catalogEvolvesFrom(ev: PokemonEvaluator): Map<string, string> {
  let m = catalogEvolution.get(ev);
  if (m) return m;
  m = new Map();
  for (const c of ev.pool({ source: 'catalog', collection: new Map(), format: 'any' })) {
    if (c.cat !== 'Pokemon') continue;
    const f = ev.features(c);
    if (f.evolvesFrom && !m.has(f.key)) m.set(f.key, f.evolvesFrom);
  }
  catalogEvolution.set(ev, m);
  return m;
}

function parsePairs(xs: string[] | undefined): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; xs && i + 1 < xs.length; i += 2) out.push([COST_LETTERS[xs[i]] ?? '', xs[i + 1]]);
  return out;
}

const NOT_FROM_HAND = new Set(['V-UNION', 'RESTORED', 'LEVEL-UP', 'BREAK', 'MEGA']);

/** One card of the table; `i` is its index. Exported for the coverage measure, which compiles a pool one card at a time. */
export function compileCard(ev: PokemonEvaluator, card: CatalogCard, i: number): SimCard {
  const f = ev.features(card);
  const t = f.text;
  const kind = f.isPokemon ? 'pokemon' : f.isEnergy ? 'energy' : 'trainer';
  // A braced unknown symbol in a cost counts as one Colorless.
  const attacks: SimAttack[] = f.attacks.map((a) => ({ name: a.name, cost: a.cost.replace(/\{[^}]*\}/g, 'C'), costN: a.costN, damage: a.damage, printed: a.printed, fx: a.effect ? parseAttackText(a.effect) : null, expected: a.expected, drain: a.drain, rest: a.rest, sustained: a.sustained }));
  const abilities = (t?.b ?? []).map((b) => parseAbility(b.k, b.n, b.e));
  let fx: ParsedText | null = null;
  let unread = '';
  if (kind === 'trainer') {
    fx = parseText(t?.fx ?? '');
    // A Tool that lends a VSTAR Power (Forest Seal Stone): read the power, played as an Item on a Pokémon V.
    const lend = /can use the VSTAR Power on this card\.\s*(?:[A-Z][\w'’ -]*?\s)?(During your turn, you may .*)$/.exec(t?.fx ?? '');
    if (f.trainerType === 'Tool' && lend) {
      fx = parseText(lend[1].replace(/^During your turn, you may /, '').replace(/\(You can't use more than 1 VSTAR Power in a game\.\)/, ''));
      if (fx.effects.length) fx.unread = '';
    } else if (f.trainerType === 'Tool' || f.trainerType === 'Stadium') {
      // A Tool changes the Pokémon it is attached to, a Stadium every Pokémon it names, while in play (statics);
      // a Stadium that lets each player act is read like a Trainer.
      fx = parseStaticsText(t?.fx ?? '', f.trainerType);
    }
    if (!fx.effects.length && !fx.statics?.length) {
      const roles = [...f.roles];
      unread = roles.find((r) => r === 'gust' || r === 'heal' || r === 'recover' || r === 'disrupt') ?? (fx.unread || 'other');
    }
  } else if (kind === 'energy' && !f.isBasicEnergy) {
    // What a Special Energy provides, to whom and when more comes from the evaluator's rule (resolved per deck in
    // compileDeck); its other sentences are read here.
    fx = parseEnergyText(t?.fx ?? '', f.energy);
  }
  const w = parsePairs(t?.w);
  const r = parsePairs(t?.r);
  const stage = f.stage === 'Stage 2' ? 2 : f.evolvesFrom ? 1 : 0;
  return {
    i,
    card,
    name: card.name,
    key: f.key,
    kind,
    basic: f.isBasic && !NOT_FROM_HAND.has(card.stage ?? ''),
    from: f.evolvesFrom,
    stage,
    hp: card.hp ?? 0,
    types: f.types.join(''),
    retreat: t?.rc ?? 0,
    weak: w.map(([type, v]) => ({ t: type, mul: v.startsWith('×') || v.startsWith('x') ? Number(v.slice(1)) || 2 : 1, add: v.startsWith('+') ? Number(v.slice(1)) || 0 : 0 })),
    resist: r.map(([type, v]) => ({ t: type, amt: Math.abs(Number(v)) || 0 })),
    attacks,
    abilities,
    prize: kind === 'pokemon' ? prizeValue(card.name) : 0,
    suffix: f.suffix,
    tt: f.trainerType,
    fx,
    // A Special Energy's unconditional letters; what an upgrade adds is resolved per holder (`energy`).
    provides: kind === 'energy' && f.energy && !f.isBasicEnergy ? f.energy.base : f.provides,
    unread,
    candyBase: '',
    engine: abilities.some((a) => a.trigger !== 'passive' && a.fx.effects.length > 0),
    basicEnergy: f.isBasicEnergy,
    shared: f.trainerType === 'Stadium' && /each player's turn/i.test(t?.fx ?? ''),
  };
}

/**
 * The main deck as one line per card id, sorted by id: the same cards in any
 * order or split over several lines compile to the same table, so a seed
 * gives the same games whatever order a list arrives in.
 */
export function normalizeDeck(deck: readonly DeckCard[]): DeckCard[] {
  const qty = new Map<string, number>();
  for (const line of deck) if (line.zone !== 'side' && line.qty > 0) qty.set(line.cardId, (qty.get(line.cardId) ?? 0) + line.qty);
  return [...qty]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([cardId, n]) => ({ cardId, qty: n }));
}

/**
 * Compile a deck list. Side-zone lines and ids the catalog lacks are left out.
 * `only`: the key of the Pokémon to take as the main attacker, for comparing plans.
 */
export function compileDeck(ev: PokemonEvaluator, deck: readonly DeckCard[], only = ''): CompiledDeck {
  const cards: SimCard[] = [];
  const byId = new Map<string, SimCard>();
  const list: number[] = [];
  let unknown = 0;
  for (const line of normalizeDeck(deck)) {
    const card = ev.card(line.cardId);
    if (!card) {
      unknown++;
      continue;
    }
    let c = byId.get(card.id);
    if (!c) {
      c = compileCard(ev, card, cards.length);
      cards.push(c);
      byId.set(card.id, c);
    }
    for (let k = 0; k < line.qty; k++) list.push(c.i);
  }

  const copies = new Map<string, number>();
  for (const i of list) copies.set(cards[i].key, (copies.get(cards[i].key) ?? 0) + 1);

  // Special Energy rules against this deck's Pokémon: whom each may be attached to, and whom it gives more.
  const pokemonCards = cards.filter((c) => c.kind === 'pokemon');
  for (const c of cards) {
    const rule = c.kind === 'energy' && !c.basicEnergy ? ev.features(c.card).energy : undefined;
    if (!rule) continue;
    const keysMeeting = (cond: Parameters<typeof meetsCond>[0]) => new Set(pokemonCards.filter((pc) => meetsCond(cond, ev.features(pc.card)) === true).map((pc) => pc.key));
    const upgrades: NonNullable<SimCard['energy']>['upgrades'] = [];
    // Symbols spelled as "{C}{C}" or "ColorlessColorless": how many Energy a sentence provides at once.
    const fxText = (ev.features(c.card).text?.fx ?? '').replace(/\{([A-Z])\}/g, (_, l: string) => Object.keys(COST_LETTERS).find((n) => COST_LETTERS[n] === l) ?? l);
    const NAMES = Object.keys(COST_LETTERS).join('|');
    const howMany = (run: string) => (run.match(new RegExp(NAMES, 'g')) ?? []).length;
    for (const u of rule.upgrades) {
      if (u.cond === 'unread') continue;
      // "only 2 Energy at a time", or "{C}{C}{C} Energy instead": how many the upgrade counts as.
      const am = new RegExp(`${u.types === '*' ? 'every type of Energy' : ''}.*?only (\\d) Energy at a time`).exec(fxText);
      const rep = new RegExp(`provides ((?:${NAMES}){2,}) Energy instead`).exec(fxText);
      upgrades.push({ types: u.types, amount: am ? Number(am[1]) : rep ? howMany(rep[1]) : 1, keys: keysMeeting(u.cond) });
    }
    // "provides {C}{C} Energy" with no "at a time": two Energy (Double Turbo Energy).
    const twice = new RegExp(`provides ((?:${NAMES}){2,}) Energy\\.`).exec(fxText);
    c.energy = { amount: twice && rule.amount === 1 ? howMany(twice[1]) : rule.amount, onlyKeys: rule.only ? keysMeeting(rule.only) : null, upgrades };
  }
  const fromInDeck = new Map<string, string>();
  for (const c of cards) if (c.kind === 'pokemon' && c.from) fromInDeck.set(c.key, c.from);
  const inDeck = new Set(cards.map((c) => c.key));
  // A card of the deck answers for itself; a stage the deck skips is looked up in the catalog.
  const fromOf = (key: string): string => (inDeck.has(key) ? (fromInDeck.get(key) ?? '') : (catalogEvolvesFrom(ev).get(key) ?? ''));
  for (const c of cards) if (c.stage === 2) c.candyBase = fromOf(c.from);

  // The line down to the Basic, through the catalog where the deck skips a stage.
  const lineOf = (key: string): string[] => {
    const out = [key];
    for (let k = key, d = 0; d < 3; d++) {
      const pre = fromOf(k);
      if (!pre) break;
      out.push(pre);
      k = pre;
    }
    return out;
  };

  // What the deck's Energy can pay for: types provided by Energy cards, or any.
  const provided = new Set<string>();
  for (const c of cards) if (c.kind === 'energy') for (const ch of c.provides) provided.add(ch);
  const payable = (cost: string) => [...cost].every((ch) => ch === 'C' || provided.has(ch) || provided.has('*'));

  // Expected damage on the typical board, crediting only the conditions this deck holds the means for.
  const supply: DeckSupply = {
    pokemon: (t) => cards.reduce((n, c) => n + (c.kind === 'pokemon' && pokeMatches(c, t) ? (copies.get(c.key) ?? 0) : 0), 0),
    energy: (type, special) => list.reduce((n, i) => n + (cards[i].kind === 'energy' && energyMatches(cards[i], type, undefined, special) ? 1 : 0), 0),
  };
  for (const c of cards) {
    if (c.kind !== 'pokemon') continue;
    for (const a of c.attacks) if (a.damage > 0 && a.fx?.mods.length) a.expected = expectedDamage(a.damage, a.fx.mods, staticView(a.costN, supply));
    for (const a of c.attacks) a.sustained = sustainedOf(a, c.attacks);
  }

  // Main attacker: the attack that does the most turn after turn, on a line the deck plays in numbers. An
  // attack that rests its user counts for the damage it keeps up (every other turn). The line counts by all
  // its copies, Basics included: counting only its scarcer end, or the odds of drawing both ends, named the
  // deck's own attacker less often on tournament lists (228 and 191 of 346, against 234) and fell for the
  // Basics of the old theme decks' 3-2-1 lines.
  let plan: Plan | null = null;
  let bestScore = 0;
  for (const c of cards) {
    if (c.kind !== 'pokemon') continue;
    if (only && c.key !== only) continue;
    for (const a of c.attacks) {
      if (a.damage <= 0) continue;
      const line = lineOf(c.key);
      const root = line[line.length - 1];
      const lineCopies = line.reduce((n, k) => n + (copies.get(k) ?? 0), 0);
      const s = a.sustained * Math.min(1, lineCopies / 4) * (payable(a.cost) ? 1 : 0.25) / Math.max(1, a.costN) ** 0.25;
      if (s > bestScore) {
        bestScore = s;
        const about = Math.round(a.expected) !== a.damage ? `, about ${Math.round(a.expected)}` : '';
        const drain = a.drain ? `, ${a.drain === a.costN ? 'all its' : a.drain} Energy discarded` : '';
        plan = { attacker: c.key, attackerName: c.name, attack: a, line, root, detail: `${c.name}'s ${a.name} (${a.cost || 'free'}, ${a.printed || a.damage}${about}${drain}${a.rest ? ', every other turn' : ''})` };
      }
    }
  }

  const support = new Set<string>();
  for (const c of cards) if (c.kind === 'pokemon' && c.engine) for (const k of lineOf(c.key)) support.add(k);

  const unreadMap = new Map<string, UnreadCard>();
  for (const i of list) {
    const c = cards[i];
    if (!c.unread) continue;
    const u = unreadMap.get(c.card.id);
    if (u) u.copies++;
    else unreadMap.set(c.card.id, { id: c.card.id, name: c.name, copies: 1, reason: c.unread });
  }

  const partly = new Map<string, UnreadCard>();
  for (const i of list) {
    const c = cards[i];
    for (const ab of c.abilities) {
      if (ab.trigger !== 'passive' && ab.fx.effects.length) continue;
      const key = `${c.card.id}:${ab.name}`;
      const u = partly.get(key);
      if (u) u.copies++;
      else partly.set(key, { id: c.card.id, name: `${c.name}: ${ab.name}`, copies: 1, reason: ab.trigger === 'passive' ? 'passive Ability' : `Ability: ${ab.fx.unread}` });
    }
  }

  return {
    cards,
    list,
    plan,
    support,
    basics: list.filter((i) => cards[i].basic).length,
    rareCandy: list.filter((i) => cards[i].fx?.effects.some((e) => e.k === 'rareCandy')).length,
    unread: [...unreadMap.values()].sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name)),
    partlyRead: [...partly.values()].sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name)),
    unknown,
  };
}
