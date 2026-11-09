/**
 * The Yu-Gi-Oh! deck evaluator: reads each card's text (ygo-text.ts) and its
 * catalog fields into a few features, then scores a deck on seven rules of
 * thumb a player applies by hand. Each part explains itself in one line, so
 * the builder can say why it suggests a card. docs/deck-recommender-ygo.md
 * has the reasoning, the weights and the rules relied on.
 *
 *   rules        Main 40–60, Extra and Side 15 at most, three copies by name,
 *                the TCG Forbidden & Limited list
 *   consistency  the chance the opening five hold no starter (a card that
 *                searches the deck or Special Summons from it), and a Main
 *                Deck near 40
 *   bricks       cards that do nothing alone: high-Level monsters with no way
 *                to summon them, Ritual pieces without their partner, cards
 *                naming a card the deck lacks
 *   cohesion     one archetype (or Type) carries the deck, and cards that name
 *                an archetype, card, Type or Attribute find it in the deck
 *   interaction  hand traps, negation and removal
 *   extra        the Extra Deck monsters the Main Deck can make: Tuners and
 *                Levels for Synchro, Levels for Xyz, named Fusion materials
 *                and a way to Fusion Summon, enough monsters for Link
 *   shape        a share of monsters a deck can play, and cards in multiples
 *
 * Cards are read per passcode (every printing shares its text), so the
 * features of the 13,000 cards are computed once each, on first use.
 */
import type { CatalogIndex } from '@/data/catalog';
import type { DeckCard } from '@/data/db';
import type { CatalogCard } from '@/data/types';
import { isExtraDeckCard, YGO_DECK_RULES, type DeckRules } from '@/games/deck-rules';
import type { BuildOptions, DeckEvaluator, DeckFormat, DeckScore, FormatOption, ScorePart } from './types';
import { TCG_STATUS, tcgLimitOf, type YgoTextIndex } from './ygo-text';

/* ---------- features ---------- */

export type YgoRole =
  /** Adds a card from the own Deck to the hand. */
  | 'search'
  /** Special Summons from the own Deck. */
  | 'deckSummon'
  /** Sends a card from the own Deck to the GY. */
  | 'dump'
  | 'draw'
  /** A monster used from the hand on the opponent's turn. */
  | 'handTrap'
  | 'negate'
  | 'removal'
  /** Can Special Summon itself, or be Normal Summoned without Tributing. */
  | 'selfSummon'
  /** Text that Special Summons anything at all. */
  | 'summons'
  /** Performs a Fusion Summon (Polymerization and its kin). */
  | 'fusionSummon'
  /** Performs a Ritual Summon. */
  | 'ritualSummon';

/** One part of an Extra Deck monster's materials: "1 Tuner", "1+ non-Tuner monsters", "\"Dark Magician\"". */
export interface MaterialFilter {
  /** Any of these card names. */
  names?: string[];
  /** Any of these archetypes (a card belongs when its name contains the string, or its archetype is it). */
  arcs?: string[];
  races?: string[];
  attrs?: string[];
  /** Level range, inclusive. */
  level?: [number, number];
  /** True: a Tuner; false: a non-Tuner. */
  tuner?: boolean;
  effect?: boolean;
  normal?: boolean;
  pendulum?: boolean;
  /** Materials only the Extra Deck holds ("Synchro Monster"): the Main Deck alone cannot supply them. */
  fromExtra?: boolean;
}

export interface MaterialPart {
  count: number;
  /** "1+" / "or more". */
  more: boolean;
  filter: MaterialFilter;
}

export interface MaterialSpec {
  kind: 'fusion' | 'synchro' | 'xyz' | 'link';
  parts: MaterialPart[];
  /** ", including a ... monster". */
  including?: MaterialFilter;
  /** True when the spec names a card or an archetype (a payoff for a particular deck, not a generic one). */
  specific: boolean;
}

export interface YgoFeatures {
  /** A printing of the card (the first one seen). */
  card: CatalogCard;
  pc: number;
  name: string;
  monster: boolean;
  spell: boolean;
  trap: boolean;
  /** Lives in the Extra Deck. */
  extra: boolean;
  /** Level, Rank or Link rating; 0 for Spells and Traps. */
  level: number;
  tuner: boolean;
  /** An Effect Monster for material purposes. */
  effect: boolean;
  normal: boolean;
  ritual: boolean;
  pendulum: boolean;
  /** A Ritual Spell. */
  ritualSpell: boolean;
  quickPlay: boolean;
  attr: string;
  race: string;
  /** Archetypes the card belongs to: the catalog's own, plus any its text says it is "always treated as". */
  arcs: string[];
  roles: Set<YgoRole>;
  /** Card names the text mentions (not its own). */
  names: string[];
  /** Archetypes the text mentions. */
  mentionArcs: string[];
  /** Monster Types and Attributes the text asks for ("a Dragon monster", "LIGHT monsters"). */
  mentionRaces: string[];
  mentionAttrs: string[];
  /** Extra Deck monsters: the parsed materials, null when the line cannot be read (or there is none). */
  materials: MaterialSpec | null;
  /** An Extra Deck monster summoned without a Fusion Spell or the usual procedure ("You do not use \"Polymerization\""). */
  contact: boolean;
}

const ATTRS = ['LIGHT', 'DARK', 'EARTH', 'WATER', 'FIRE', 'WIND', 'DIVINE'];
const ATTR_ALT = ATTRS.join('|');

const ROLE_RULES: [YgoRole, RegExp][] = [
  // "from your Deck": the card's own Deck. Ash Blossom's "Add a card from the Deck to the hand" is what it negates, not what it does.
  ['search', /\badd (?:up to \d+ |\d+ |one |a |an )?[^.;]{0,100}?\bfrom your (?:hand, )?Deck(?:,? (?:and\/or|or) (?:your )?(?:GY|Graveyard))? to your hand/i],
  ['deckSummon', /\bSpecial Summon (?:up to \d+ |\d+ |one |a |an )?[^.;]{0,100}?\bfrom your (?:hand(?:,| or| and\/or) )?(?:your )?Deck\b/i],
  ['dump', /\bsend (?:up to \d+ |\d+ |one |a |an )?[^.;]{0,80}?\bfrom your (?:hand or )?Deck to the (?:GY|Graveyard)/i],
  ['draw', /\bdraw (?:\d+|one|two|three|a) cards?\b/i],
  [
    'handTrap',
    /(?:\(Quick Effect\)|during (?:either player's|your opponent's) (?:turn|Main Phase|Battle Phase|Standby Phase|End Phase))[^.]{0,80}?: You can (?:discard this card|send this card from your hand|reveal this card in your hand|Special Summon this card from your hand|banish this card from your hand)|: You can discard this card; (?:negate|destroy|banish)/i,
  ],
  ['negate', /\bnegate (?:the|that|its|their|this|it|all|any|those|up to)\b/i],
  [
    'removal',
    /\b(?:destroy|banish|return|shuffle|send|Tribute|take control of)\b[^.;]{0,60}\b(?:your opponent controls|on the field|your opponent's [^.;]{0,30}(?:monsters?|cards?|field|hand|GY|Graveyard))|\btarget (?:1|up to \d+|\d+) [^.;]{0,60}(?:your opponent controls|on the field|in your opponent's (?:GY|Graveyard))[^.]*?; (?:destroy|banish|return|shuffle|send|take control|change)/i,
  ],
  ['selfSummon', /\bSpecial Summon this card\b|\bcan be (?:Normal Summoned|Summoned) without Tributing\b|\bTribute Summon this card by Tributing 1\b/i],
  ['summons', /\bSpecial Summon\b/i],
  ['fusionSummon', /\bFusion Summon\b|\bFusion Monster\b.{0,40}\busing\b/i],
  ['ritualSummon', /\bRitual Summon\b/i],
];
/** An Extra Deck monster that does not need a Fusion Spell (or its usual procedure) to come out. */
const CONTACT = /do not use "Polymerization"|Must (?:first )?be Special Summoned (?:\(from your Extra Deck\) )?by (?:sending|shuffling|banishing|Tributing|returning)|(?:can|must) be Special Summoned from your Extra Deck by (?:sending|shuffling|banishing|Tributing|returning)/i;

/** Words after a quoted string that make it an archetype ("Blue-Eyes" monster) rather than a card name. */
const ARC_AFTER = /^\s*(?:monsters?|cards?|Spells?|Traps?|Spell\/Trap|Spell Cards?|Trap Cards?|Fusion|Synchro|Xyz|Link|Ritual|Tuners?|Pendulum|non-Tuner|Normal|Effect|Continuous|Quick-Play|Field|Equip|Monsters?|Counter)\b/;

/* ---------- evaluator ---------- */

export interface YgoEvaluatorDeps {
  index: CatalogIndex;
  text: YgoTextIndex;
  /** The list the score's rules part applies: "tcg" (default) or "any" (three copies of anything). */
  format?: DeckFormat;
}

/** The Yu-Gi-Oh! evaluator also hands out a card's features, for tests, the benchmark and a future playtest. */
export interface YgoEvaluator extends DeckEvaluator {
  features(card: CatalogCard): YgoFeatures;
  /** Whether the Main Deck lines in `cards` can make the Extra Deck monster `card`. */
  canMake(card: CatalogCard, cards: readonly DeckCard[]): boolean;
}

export const YGO_WEIGHTS = { rules: 10, consistency: 20, bricks: 10, cohesion: 20, interaction: 15, extra: 15, shape: 10 } as const;

export const YGO_FORMATS: readonly FormatOption[] = [
  { id: 'tcg', label: 'TCG list', default: true },
  { id: 'any', label: 'No list' },
];

/** Opening hand: five cards (the Yu-Gi-Oh! rulebook; see docs/deck-recommender-ygo.md). */
export const OPENING_HAND = 5;

/** Chance that a `hand`-card opening hand from `n` cards holds none of `k` (k may be fractional: half-starters). */
export function noneInHand(n: number, k: number, hand = OPENING_HAND): number {
  if (n < hand) return k > 0 ? 0 : 1;
  let p = 1;
  for (let i = 0; i < hand; i++) p *= Math.max(0, n - k - i) / (n - i);
  return p;
}

interface Line {
  f: YgoFeatures;
  qty: number;
}

/** What the deck offers, computed once per deck and shared by the parts and the relevance ranking. */
interface DeckContext {
  main: Line[];
  extra: Line[];
  side: Line[];
  mainCount: number;
  extraCount: number;
  sideCount: number;
  /** Main Deck monsters. */
  monsters: Line[];
  /** Card name → copies over every section. */
  byName: Map<string, number>;
  /** Names in the Main and Extra Deck. */
  names: Set<string>;
  /** Archetype → Main Deck copies. */
  arcCount: Map<string, number>;
  raceCount: Map<string, number>;
  attrCount: Map<string, number>;
  /** Archetypes, names, Types and Attributes the deck's cards mention. */
  mentionArcs: Set<string>;
  mentionNames: Set<string>;
  mentionRaces: Set<string>;
  mentionAttrs: Set<string>;
  /** Main Deck copies by monster Level. */
  levelCount: Map<number, number>;
  tuners: number;
  fusionEnablers: number;
}

export function createYgoEvaluator({ index, text, format = 'tcg' }: YgoEvaluatorDeps): YgoEvaluator {
  const limitOf = (card: CatalogCard | undefined, fmt: DeckFormat = format) => (fmt === 'tcg' ? Math.min(3, tcgLimitOf(text, card?.pc)) : 3);
  const rules: DeckRules = { ...YGO_DECK_RULES, copyLimit: (card) => limitOf(card) };

  // Printings per passcode, newest set first (the catalog lists sets in release order).
  const printings = new Map<number, CatalogCard[]>();
  for (const card of index.catalog.cards) {
    if (card.pc === undefined) continue;
    const l = printings.get(card.pc);
    if (l) l.unshift(card);
    else printings.set(card.pc, [card]);
  }
  const allNames = new Set<string>();
  for (const l of printings.values()) allNames.add(l[0].name);
  const archetypeNames = new Set(index.archetypes.map((a) => a.name));
  const races = [...new Set([...printings.values()].map((l) => l[0]).filter((c) => c.cat === 'Monster' && c.race).map((c) => c.race!))].sort((a, b) => b.length - a.length);
  const RACE_ALT = races.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const RE_RACE = new RegExp(`\\b(${RACE_ALT})(?:-Type)?\\b`, 'g');
  const RE_ATTR = new RegExp(`\\b(${ATTR_ALT})\\b`, 'g');
  // "a Dragon monster", "LIGHT Fairy monsters", "Level 4 or lower WATER monster"
  const RE_RACE_MENTION = new RegExp(`\\b(?:(${ATTR_ALT}) )?(?:(${RACE_ALT})(?:-Type)? )?(?:Tuner |Normal |Effect |Pendulum |non-Tuner )?(?:monsters?|Tuners?)\\b`, 'g');

  /** "Blue-Eyes" names a card or an archetype; null for a Token or anything else. */
  function classify(s: string, after: string): 'name' | 'arc' | null {
    if (/\bToken\b/.test(s)) return null;
    if (ARC_AFTER.test(after)) return 'arc';
    if (allNames.has(s)) return 'name';
    if (archetypeNames.has(s)) return 'arc';
    return null;
  }

  function mentionsOf(t: string, self: string, arcs: string[]) {
    const names = new Set<string>();
    const mArcs = new Set<string>();
    for (const m of t.matchAll(/"([^"]+)"/g)) {
      const s = m[1];
      if (s === self) continue;
      const before = t.slice(Math.max(0, m.index! - 40), m.index);
      if (/treated as (?:an? )?$|name (?:becomes|is also treated as) $|also treated as $/i.test(before)) {
        if (/always treated as (?:an? )?$/i.test(before)) arcs.push(s);
        continue;
      }
      const kind = classify(s, t.slice(m.index! + m[0].length, m.index! + m[0].length + 20));
      if (kind === 'name') names.add(s);
      else if (kind === 'arc') mArcs.add(s);
    }
    const mRaces = new Set<string>();
    const mAttrs = new Set<string>();
    for (const m of t.matchAll(RE_RACE_MENTION)) {
      if (m[1]) mAttrs.add(m[1]);
      if (m[2]) mRaces.add(m[2]);
    }
    return { names: [...names], mentionArcs: [...mArcs], mentionRaces: [...mRaces], mentionAttrs: [...mAttrs] };
  }

  /* ----- materials ----- */

  function filterOf(s: string): MaterialFilter | null {
    const f: MaterialFilter = {};
    const quoted = [...s.matchAll(/"([^"]+)"/g)];
    for (const m of quoted) {
      const kind = classify(m[1], s.slice(m.index! + m[0].length)) ?? (/monster|card/i.test(s.slice(m.index! + m[0].length)) ? 'arc' : 'name');
      if (kind === 'name') (f.names ??= []).push(m[1]);
      else (f.arcs ??= []).push(m[1]);
    }
    const rest = s.replace(/"[^"]+"/g, ' ');
    const lv = /\bLevel (\d+)(?: or (lower|higher))?/.exec(rest);
    if (lv) {
      const n = Number(lv[1]);
      f.level = lv[2] === 'lower' ? [0, n] : lv[2] === 'higher' ? [n, 99] : [n, n];
    }
    if (/\bnon-Tuners?\b/.test(rest)) f.tuner = false;
    else if (/\bTuners?\b/.test(rest) && !/\bTuner (?:Synchro|Xyz|Fusion|Link)\b/.test(rest)) f.tuner = true;
    const attrs = [...rest.matchAll(RE_ATTR)].map((m) => m[1]);
    if (attrs.length) f.attrs = attrs;
    const rs = [...rest.matchAll(RE_RACE)].map((m) => m[1]);
    if (rs.length) f.races = rs;
    if (/\bEffect Monsters?\b/.test(rest)) f.effect = true;
    if (/\bNormal Monsters?\b/.test(rest)) f.normal = true;
    if (/\bPendulum Monsters?\b/.test(rest)) f.pendulum = true;
    if (/\b(?:Fusion|Synchro|Xyz|Link)(?:,|\b.{0,40}\bMonsters?\b)/.test(rest)) f.fromExtra = true;
    if (/\bRitual\b/.test(rest) && f.fromExtra) f.fromExtra = true;
    if (!quoted.length && !/\bmonsters?\b|\bTuners?\b|\bnon-Tuners?\b/i.test(rest)) return null;
    return f;
  }

  const specCache = new Map<string, MaterialSpec | null>();
  function parseMaterials(mt: string, frame: string): MaterialSpec | null {
    const kind = (frame.split('_')[0] as MaterialSpec['kind']) ?? 'fusion';
    const key = `${kind}|${mt}`;
    if (specCache.has(key)) return specCache.get(key)!;
    let s = mt.trim();
    let including: MaterialFilter | undefined;
    const inc = /,?\s*including (?:at least )?(?:1 |an? )?(.+)$/i.exec(s);
    if (inc) {
      including = filterOf(inc[1]) ?? undefined;
      s = s.slice(0, inc.index);
    }
    s = s.replace(/,?\s*except Tokens\b.*$/i, '').replace(/\s+with (?:the same|different)\b.*$/i, '').replace(/\s*\(.*\)\s*$/, '');
    const parts: MaterialPart[] = [];
    let ok = true;
    for (const raw of s.split(/\s+\+\s+/)) {
      const p = raw.trim();
      const m = /^(\d+)(\+| or more)?\s+(?:x\s+)?(.*)$/.exec(p);
      const filter = filterOf(m ? m[3] : p);
      if (!filter) {
        ok = false;
        break;
      }
      parts.push({ count: m ? Number(m[1]) : 1, more: !!m?.[2], filter });
    }
    const spec: MaterialSpec | null =
      ok && parts.length ? { kind, parts, including, specific: [...parts.map((p) => p.filter), including].some((f) => !!(f?.names?.length || f?.arcs?.length)) } : null;
    specCache.set(key, spec);
    return spec;
  }

  /* ----- features ----- */

  const features = new Map<number, YgoFeatures>();
  const byId = (id: string) => index.cardsById.get(id);

  function featuresOf(card: CatalogCard): YgoFeatures {
    const pc = card.pc ?? -1;
    let f = features.get(pc);
    if (f) return f;
    const t = text.byPc.get(pc);
    const fx = t ? `${t.fx}\n${t.pe}` : '';
    const frame = card.frame ?? '';
    const monster = card.cat === 'Monster';
    const sub = card.sub ?? '';
    const roles = new Set<YgoRole>();
    for (const [role, re] of ROLE_RULES) if (re.test(fx)) roles.add(role);
    if (!monster) roles.delete('handTrap');
    const arcs = card.arc ? [card.arc] : [];
    const m = mentionsOf(fx, card.name, arcs);
    const extra = isExtraDeckCard(card);
    f = {
      card,
      pc,
      name: card.name,
      monster,
      spell: card.cat === 'Spell',
      trap: card.cat === 'Trap',
      extra,
      level: card.lv ?? 0,
      tuner: /\bTuner\b/.test(sub),
      effect: monster && !/^normal/.test(frame) && sub !== 'Ritual Monster' && !(extra && !t?.fx),
      normal: /^normal/.test(frame),
      ritual: /^ritual/.test(frame),
      pendulum: /pendulum/.test(frame),
      ritualSpell: card.cat === 'Spell' && card.race === 'Ritual',
      quickPlay: card.cat === 'Spell' && card.race === 'Quick-Play',
      attr: card.types?.[0] ?? '',
      race: monster ? (card.race ?? '') : '',
      arcs,
      roles,
      ...m,
      materials: extra && t?.mt ? parseMaterials(t.mt, frame) : null,
      contact: extra && CONTACT.test(t?.fx ?? ''),
    };
    features.set(pc, f);
    return f;
  }

  /** Whether `f` belongs to archetype `a`: its name contains it, or it is the card's archetype. */
  const inArc = (f: YgoFeatures, a: string) => f.arcs.includes(a) || f.name.includes(a);

  function matches(f: YgoFeatures, flt: MaterialFilter): boolean {
    if (!f.monster) return false;
    if (flt.fromExtra) return false;
    if (flt.names && !flt.names.includes(f.name)) return false;
    if (flt.arcs && !flt.arcs.some((a) => inArc(f, a))) return false;
    if (flt.races && !flt.races.includes(f.race)) return false;
    if (flt.attrs && !flt.attrs.includes(f.attr)) return false;
    if (flt.level && (f.level < flt.level[0] || f.level > flt.level[1])) return false;
    if (flt.tuner !== undefined && f.tuner !== flt.tuner) return false;
    if (flt.effect && !f.effect) return false;
    if (flt.normal && !f.normal) return false;
    if (flt.pendulum && !f.pendulum) return false;
    return true;
  }

  const copiesMatching = (monsters: readonly Line[], flt: MaterialFilter) => monsters.reduce((n, l) => n + (matches(l.f, flt) ? l.qty : 0), 0);

  /** Whether the Main Deck monsters can make an Extra Deck monster with this spec (and Level, for Synchro). */
  function makeable(spec: MaterialSpec | null, level: number, ctx: Pick<DeckContext, 'monsters' | 'fusionEnablers'>, contact: boolean): boolean {
    if (!spec) return false;
    const { monsters } = ctx;
    if (spec.parts.some((p) => p.filter.fromExtra)) return false;
    if (spec.including && copiesMatching(monsters, spec.including) < 1) return false;
    switch (spec.kind) {
      case 'synchro': {
        const tunerPart = spec.parts.find((p) => p.filter.tuner === true);
        const rest = spec.parts.filter((p) => p !== tunerPart);
        if (!tunerPart || !rest.length) return false;
        const tunerLevels = new Set<number>();
        for (const l of monsters) if (l.f.level && matches(l.f, tunerPart.filter)) tunerLevels.add(l.f.level);
        const non = new Map<number, number>();
        for (const l of monsters) if (l.f.level && matches(l.f, rest[0].filter)) non.set(l.f.level, (non.get(l.f.level) ?? 0) + l.qty);
        const want = rest[0].count;
        const two = rest[0].more || want >= 2;
        for (const t of tunerLevels) {
          const need = level - t * tunerPart.count;
          if (need <= 0) continue;
          if (want === 1 && non.has(need)) return true;
          if (two) for (const [a, qa] of non) if (need - a > 0 && non.has(need - a) && (need - a !== a || qa >= 2)) return true;
        }
        return false;
      }
      case 'xyz':
        // n monsters of one Level on the field: the deck holds a few more than n.
        return spec.parts.every((p) => copiesMatching(monsters, p.filter) >= p.count + 2);
      case 'link':
        return spec.parts.every((p) => copiesMatching(monsters, p.filter) >= Math.max(2, p.count));
      case 'fusion': {
        if (!contact && ctx.fusionEnablers < 1) return false;
        // Named materials need the card itself; "2 "Gem-Knight" monsters" needs that many copies.
        return spec.parts.every((p) => copiesMatching(monsters, p.filter) >= p.count);
      }
    }
    return false;
  }

  /* ----- the pool's Extra Deck, by spec, for "what the Main Deck opens" ----- */

  interface SpecGroup {
    spec: MaterialSpec;
    level: number;
    contact: boolean;
    cards: YgoFeatures[];
  }
  let extraGroups: { specific: Map<string, SpecGroup[]>; generic: SpecGroup[] } | null = null;
  function groups() {
    if (extraGroups) return extraGroups;
    const byKey = new Map<string, SpecGroup>();
    for (const list of printings.values()) {
      const card = list[0];
      if (!isExtraDeckCard(card) || limitOf(card) === 0) continue;
      const f = featuresOf(card);
      if (!f.materials) continue;
      const key = `${f.materials.kind}|${f.materials.kind === 'synchro' ? f.level : 0}|${f.contact}|${text.byPc.get(f.pc)?.mt}`;
      let g = byKey.get(key);
      if (!g) byKey.set(key, (g = { spec: f.materials, level: f.level, contact: f.contact, cards: [] }));
      g.cards.push(f);
    }
    const specific = new Map<string, SpecGroup[]>();
    const generic: SpecGroup[] = [];
    for (const g of byKey.values()) {
      if (!g.spec.specific) {
        generic.push(g);
        continue;
      }
      const keys = new Set<string>();
      for (const flt of [...g.spec.parts.map((p) => p.filter), g.spec.including]) {
        for (const n of flt?.names ?? []) keys.add(`n:${n}`);
        for (const a of flt?.arcs ?? []) keys.add(`a:${a}`);
      }
      for (const k of keys) {
        let l = specific.get(k);
        if (!l) specific.set(k, (l = []));
        l.push(g);
      }
    }
    return (extraGroups = { specific, generic });
  }
  /** Archetype strings the pool's Extra Deck materials name, for matching a deck's monsters against them. */
  let materialArcs: string[] | null = null;
  const arcKeysOf = new Map<number, string[]>();
  function materialArcKeys(f: YgoFeatures): string[] {
    let keys = arcKeysOf.get(f.pc);
    if (keys) return keys;
    materialArcs ??= [...groups().specific.keys()].filter((k) => k.startsWith('a:')).map((k) => k.slice(2));
    keys = materialArcs.filter((a) => inArc(f, a)).map((a) => `a:${a}`);
    arcKeysOf.set(f.pc, keys);
    return keys;
  }

  /** The Main Deck's Extra Deck options: generic mechanics open (0..1 each) and the deck-specific monsters it can make. */
  function access(ctx: DeckContext): { synchro: boolean; xyz: number; link: boolean; fusion: boolean; specific: YgoFeatures[] } {
    const lv = [...ctx.levelCount].filter(([l, n]) => l > 0 && l <= 12 && n >= 4).map(([l]) => l);
    const nonTuners = ctx.monsters.some((l) => !l.f.tuner && l.f.level > 0);
    const effectCopies = ctx.monsters.reduce((n, l) => n + (l.f.effect ? l.qty : 0), 0);
    const keys = new Set<string>();
    for (const l of ctx.monsters) {
      keys.add(`n:${l.f.name}`);
      for (const k of materialArcKeys(l.f)) keys.add(k);
    }
    const seen = new Set<SpecGroup>();
    const specific: YgoFeatures[] = [];
    const { specific: byKey } = groups();
    for (const k of keys) {
      for (const g of byKey.get(k) ?? []) {
        if (seen.has(g)) continue;
        seen.add(g);
        if (makeable(g.spec, g.level, ctx, g.contact)) specific.push(...g.cards);
      }
    }
    return { synchro: ctx.tuners > 0 && nonTuners, xyz: lv.length, link: effectCopies >= 4, fusion: ctx.fusionEnablers > 0, specific };
  }

  /* ----- deck context ----- */

  function contextOf(cards: readonly DeckCard[]): DeckContext {
    const lines = new Map<string, Line>();
    const side: Line[] = [];
    for (const c of cards) {
      const card = byId(c.cardId);
      if (!card || c.qty <= 0) continue;
      const f = featuresOf(card);
      if (c.zone === 'side') {
        side.push({ f, qty: c.qty });
        continue;
      }
      const l = lines.get(f.name);
      if (l) l.qty += c.qty;
      else lines.set(f.name, { f, qty: c.qty });
    }
    const all = [...lines.values()];
    const main = all.filter((l) => !l.f.extra);
    const extra = all.filter((l) => l.f.extra);
    const ctx: DeckContext = {
      main,
      extra,
      side,
      mainCount: main.reduce((n, l) => n + l.qty, 0),
      extraCount: extra.reduce((n, l) => n + l.qty, 0),
      sideCount: side.reduce((n, l) => n + l.qty, 0),
      monsters: main.filter((l) => l.f.monster),
      byName: new Map(),
      names: new Set(all.map((l) => l.f.name)),
      arcCount: new Map(),
      raceCount: new Map(),
      attrCount: new Map(),
      mentionArcs: new Set(),
      mentionNames: new Set(),
      mentionRaces: new Set(),
      mentionAttrs: new Set(),
      levelCount: new Map(),
      tuners: 0,
      fusionEnablers: 0,
    };
    for (const l of [...all, ...side]) ctx.byName.set(l.f.name, (ctx.byName.get(l.f.name) ?? 0) + l.qty);
    const add = (m: Map<string, number>, k: string, n: number) => k && m.set(k, (m.get(k) ?? 0) + n);
    for (const l of main) {
      for (const a of l.f.arcs) add(ctx.arcCount, a, l.qty);
      if (l.f.monster) {
        add(ctx.raceCount, l.f.race, l.qty);
        add(ctx.attrCount, l.f.attr, l.qty);
        if (l.f.level) ctx.levelCount.set(l.f.level, (ctx.levelCount.get(l.f.level) ?? 0) + l.qty);
        if (l.f.tuner) ctx.tuners += l.qty;
      }
      if (l.f.roles.has('fusionSummon') && !l.f.extra) ctx.fusionEnablers += l.qty;
    }
    for (const l of all) {
      for (const a of l.f.mentionArcs) ctx.mentionArcs.add(a);
      for (const n of l.f.names) ctx.mentionNames.add(n);
      for (const r of l.f.mentionRaces) ctx.mentionRaces.add(r);
      for (const a of l.f.mentionAttrs) ctx.mentionAttrs.add(a);
    }
    return ctx;
  }

  /** Whether some line other than `self` belongs to archetype `a`. */
  const deckHasArc = (ctx: DeckContext, a: string, self?: Line) => [...ctx.main, ...ctx.extra].some((l) => l !== self && inArc(l.f, a));

  /** Why a Main Deck line is dead alone, or "" when it is not. */
  function brickReason(l: Line, ctx: DeckContext): { why: string; weight: number } {
    const f = l.f;
    if (f.extra) return { why: '', weight: 0 };
    if (f.ritual && f.monster && !ctx.main.some((o) => o.f.ritualSpell || (o !== l && !o.f.monster && o.f.roles.has('ritualSummon')))) return { why: 'no Ritual Spell', weight: 1 };
    if (f.ritualSpell && !ctx.main.some((o) => o.f.ritual && o.f.monster)) return { why: 'no Ritual Monster', weight: 1 };
    if (f.names.length && !f.names.some((n) => ctx.names.has(n)) && !f.extra) {
      // A card that names others needs at least one of them; a Fusion Spell naming a Fusion Monster is judged with the Extra Deck.
      return { why: `needs ${f.names[0]}`, weight: 1 };
    }
    if (f.monster && !f.ritual && f.level >= 5 && !f.roles.has('selfSummon')) {
      const helped = ctx.main.some(
        (o) => o !== l && o.f.roles.has('summons') && (o.f.names.includes(f.name) || o.f.mentionArcs.some((a) => inArc(f, a)) || o.f.mentionRaces.includes(f.race) || o.f.mentionAttrs.includes(f.attr)),
      );
      if (!helped) return { why: `Level ${f.level} with no way to summon it`, weight: f.level >= 7 ? 1 : 0.5 };
    }
    return { why: '', weight: 0 };
  }

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const part = (id: keyof typeof YGO_WEIGHTS, label: string, score: number, detail: string): ScorePart => ({ id, label, score: clamp01(score), weight: YGO_WEIGHTS[id], detail });
  const list = (xs: string[], n = 3) => `${xs.slice(0, n).join(', ')}${xs.length > n ? '…' : ''}`;

  function score(cards: readonly DeckCard[]): DeckScore {
    const ctx = contextOf(cards);
    const { main, extra, monsters, mainCount } = ctx;
    const parts: ScorePart[] = [];
    const issues: string[] = [];

    // rules
    const mainOff = mainCount < 40 ? 40 - mainCount : mainCount > 60 ? mainCount - 60 : 0;
    const extraOver = Math.max(0, ctx.extraCount - 15);
    const sideOver = Math.max(0, ctx.sideCount - 15);
    if (mainOff) issues.push(mainCount < 40 ? `Main Deck: ${40 - mainCount} cards to go` : `Main Deck: ${mainCount - 60} cards over 60`);
    if (extraOver) issues.push(`Extra Deck: ${extraOver} cards over 15`);
    if (sideOver) issues.push(`Side Deck: ${sideOver} cards over 15`);
    let over = 0;
    let listed = 0;
    for (const [name, qty] of ctx.byName) {
      const l = [...main, ...extra, ...ctx.side].find((x) => x.f.name === name)!;
      const lim = limitOf(l.f.card);
      if (qty <= Math.min(3, lim)) continue;
      if (qty > 3) {
        over++;
        issues.push(`${name}: ${qty} copies, 3 at most`);
      } else {
        listed++;
        issues.push(lim === 0 ? `${name} is Forbidden in the TCG` : `${name}: ${qty} copies, ${TCG_STATUS[lim]} to ${lim} in the TCG`);
      }
    }
    if (mainOff === 0 && !extraOver && !sideOver && over + listed === 0) parts.push(part('rules', 'Deck rules', 1, `Main ${mainCount}, Extra ${ctx.extraCount}, Side ${ctx.sideCount}; copy limits kept`));
    else
      parts.push(
        part(
          'rules',
          'Deck rules',
          1 - mainOff / 40 - extraOver / 15 - sideOver / 15 - 0.25 * (over + listed),
          mainOff ? `Main Deck ${mainCount} of 40–60 cards` : over + listed ? `${over + listed} over the copy limit or the list` : `Extra ${ctx.extraCount}, Side ${ctx.sideCount} of 15`,
        ),
      );

    // bricks (computed first: a brick is no starter)
    const brickLines = new Map<Line, { why: string; weight: number }>();
    let bricks = 0;
    for (const l of main) {
      const b = brickReason(l, ctx);
      if (!b.weight) continue;
      brickLines.set(l, b);
      bricks += b.weight * l.qty;
    }

    // consistency
    let starters = 0;
    for (const l of main) {
      if (brickLines.get(l)?.weight === 1) continue;
      const r = l.f.roles;
      if (r.has('search') || r.has('deckSummon')) starters += l.qty;
      else if (r.has('dump') || r.has('draw')) starters += 0.5 * l.qty;
    }
    const n = Math.max(mainCount, 40);
    const p = noneInHand(n, starters);
    const size = mainCount <= 40 ? 1 : clamp01(1 - (mainCount - 40) / 20);
    parts.push(
      part(
        'consistency',
        'Consistency',
        mainCount ? 0.8 * clamp01((0.5 - p) / 0.4) + 0.2 * size : 0,
        `${Math.round(starters)} starters in ${mainCount}: ${pct(p)} chance of none in the opening ${OPENING_HAND}`,
      ),
    );

    const brickNames = [...brickLines].sort((a, b) => b[1].weight * b[0].qty - a[1].weight * a[0].qty).map(([l, b]) => `${l.f.name} (${b.why})`);
    parts.push(
      part('bricks', 'Bricks', mainCount ? 1 - Math.max(0, bricks - 1) / (0.15 * Math.max(mainCount, 40)) : 0, brickNames.length ? `Dead alone: ${list(brickNames, 2)}` : mainCount ? 'Every card can be used on its own' : 'No cards'),
    );

    // cohesion: one archetype (or Type) carries the deck, and conditional cards find what they name.
    const arcs = [...ctx.arcCount].sort((a, b) => b[1] - a[1]);
    const topArcs = arcs.slice(0, 2).filter(([, q], i) => i === 0 || q >= 6).map(([a]) => a);
    let inPlan = 0;
    for (const l of main) if (topArcs.some((a) => inArc(l.f, a) || l.f.mentionArcs.includes(a))) inPlan += l.qty;
    const topRace = [...ctx.raceCount].sort((a, b) => b[1] - a[1])[0];
    let raceShare = 0;
    if (topRace) {
      let q = 0;
      for (const l of main) if ((l.f.monster && l.f.race === topRace[0]) || l.f.mentionRaces.includes(topRace[0])) q += l.qty;
      raceShare = q;
    }
    // Against a full deck of 40, so a half-built deck earns focus card by card: 70% in the plan is full marks.
    const deckSize = Math.max(mainCount, 40);
    const focus = mainCount ? Math.max(clamp01(inPlan / (0.7 * deckSize)), 0.5 * clamp01(raceShare / (0.7 * deckSize))) : 0;
    let conditional = 0;
    let met = 0;
    const dead: string[] = [];
    for (const l of [...main, ...extra]) {
      const f = l.f;
      const wants = f.mentionArcs.length + f.names.length + f.mentionRaces.length + f.mentionAttrs.length;
      if (!wants) continue;
      conditional += l.qty;
      const ok =
        f.mentionArcs.some((a) => deckHasArc(ctx, a, l)) ||
        f.names.some((x) => ctx.names.has(x)) ||
        f.mentionRaces.some((r) => monsters.some((o) => o !== l && o.f.race === r)) ||
        f.mentionAttrs.some((a) => monsters.some((o) => o !== l && o.f.attr === a));
      if (ok) met += l.qty;
      else dead.push(f.name);
    }
    const metShare = conditional ? met / conditional : 1;
    const plan = topArcs.length && inPlan >= (topRace ? 0.6 * raceShare : 0) ? `"${topArcs[0]}"` : topRace ? `${topRace[0]} monsters` : '';
    parts.push(
      part(
        'cohesion',
        'Cohesion',
        mainCount ? 0.5 * focus + 0.5 * metShare : 0,
        !mainCount ? 'No cards' : dead.length ? `Nothing in the deck for ${list(dead, 2)}` : plan ? `Built around ${plan}: ${topArcs.length && plan.startsWith('"') ? inPlan : raceShare} of ${mainCount} cards` : 'No archetype or Type in common',
      ),
    );

    // interaction
    let traps = 0;
    let negates = 0;
    let removal = 0;
    for (const l of main) {
      const r = l.f.roles;
      if (r.has('handTrap')) traps += l.qty;
      else if (r.has('negate')) negates += l.qty;
      else if (r.has('removal')) removal += l.qty;
    }
    const inter = traps + negates + removal;
    parts.push(part('interaction', 'Interaction', inter / 10, `${traps} hand traps, ${negates} negation, ${removal} removal`));

    // extra
    if (extra.length) {
      let can = 0;
      const cannot: string[] = [];
      for (const l of extra) {
        if (makeable(l.f.materials, l.f.level, ctx, l.f.contact)) can += l.qty;
        else cannot.push(l.f.name);
      }
      parts.push(
        part('extra', 'Extra Deck', can / ctx.extraCount, cannot.length ? `${can} of ${ctx.extraCount} can be made; not ${list(cannot, 2)}` : `The Main Deck can make all ${ctx.extraCount} Extra Deck monsters`),
      );
    } else {
      const a = access(ctx);
      const generic = (Number(a.synchro) + Math.min(1, a.xyz) + Number(a.link)) / 3;
      const opens = [a.synchro && 'Synchro', a.xyz && `Xyz (${a.xyz} Rank${a.xyz > 1 ? 's' : ''})`, a.link && 'Link', a.fusion && 'Fusion'].filter(Boolean).join(', ');
      parts.push(
        part(
          'extra',
          'Extra Deck',
          monsters.length ? 0.5 * generic + 0.5 * Math.min(1, a.specific.length / 4) : 0,
          monsters.length ? `${opens ? `Opens ${opens}` : 'Opens no Summon mechanic'}; ${a.specific.length} Extra Deck monsters name its cards` : 'No monsters',
        ),
      );
    }

    // shape: a playable share of monsters, and cards in multiples.
    const monsterQty = monsters.reduce((s, l) => s + l.qty, 0);
    const share = mainCount ? monsterQty / mainCount : 0;
    const shareScore = share < 0.3 ? clamp01(1 - (0.3 - share) / 0.25) : share > 0.65 ? clamp01(1 - (share - 0.65) / 0.25) : 1;
    const multi = main.reduce((s, l) => s + (l.qty >= 2 ? l.qty : 0), 0);
    const multiScore = mainCount ? clamp01(multi / (0.6 * Math.max(mainCount, 40))) : 0;
    parts.push(
      part(
        'shape',
        'Shape',
        mainCount ? 0.5 * shareScore + 0.5 * multiScore : 0,
        mainCount ? `${monsterQty} monsters in ${mainCount} (${pct(share)}); ${multi} cards in twos and threes` : 'No cards',
      ),
    );

    const total = parts.reduce((s, x) => s + x.score * x.weight, 0);
    return { total: Math.round(total * 10) / 10, parts, issues };
  }

  /* ----- pool, requirements, relevance, completion ----- */

  function allowed(card: CatalogCard, fmt: DeckFormat): boolean {
    if (card.cat === 'Skill' || card.cat === 'Token') return false;
    return fmt !== 'tcg' || tcgLimitOf(text, card.pc) > 0;
  }

  /** One printing per card that the options allow: an owned one first, else the newest. */
  function pickPrinting(list: CatalogCard[], options: BuildOptions): CatalogCard | undefined {
    if (!allowed(list[0], options.format) || options.avoid?.has(list[0].name)) return undefined;
    if (options.source !== 'catalog') {
      const owned = list.find((c) => (options.collection.get(c.id)?.qty ?? 0) > 0);
      if (owned) return owned;
      if (options.source === 'collection') return undefined;
    }
    return list[0];
  }

  function pool(options: BuildOptions): CatalogCard[] {
    const out: CatalogCard[] = [];
    for (const list of printings.values()) {
      if (isExtraDeckCard(list[0])) continue;
      const pick = pickPrinting(list, options);
      if (pick) out.push(pick);
    }
    return out;
  }

  function requirements(card: CatalogCard, cards: readonly DeckCard[], candidates: readonly CatalogCard[]): CatalogCard[] {
    const f = featuresOf(card);
    const names = new Set<string>();
    for (const c of cards) {
      const k = byId(c.cardId);
      if (k) names.add(k.name);
    }
    const find = (pred: (g: YgoFeatures) => boolean) => candidates.find((c) => pred(featuresOf(c)));
    // A Ritual Monster comes with the Ritual Spell it names, and the other way round.
    if (f.ritual && f.monster) {
      const hasSpell = cards.some((c) => {
        const k = byId(c.cardId);
        return k && featuresOf(k).ritualSpell;
      });
      if (!hasSpell) {
        const named = find((g) => g.ritualSpell && f.names.includes(g.name)) ?? find((g) => g.ritualSpell && g.names.includes(f.name));
        return named ? [named] : [];
      }
      return [];
    }
    if (f.ritualSpell) {
      const named = f.names.find((x) => !names.has(x));
      const has = cards.some((c) => {
        const k = byId(c.cardId);
        return k && featuresOf(k).ritual && k.cat === 'Monster';
      });
      if (!has && named) {
        const m = find((g) => g.name === named && g.ritual && g.monster);
        return m ? [m] : [];
      }
      return [];
    }
    // A card naming exactly one Main Deck card the deck lacks brings it along.
    if (f.names.length === 1 && !names.has(f.names[0])) {
      const m = find((g) => g.name === f.names[0] && !g.extra);
      return m ? [m] : [];
    }
    return [];
  }

  function kindOf(card: CatalogCard): 'pokemon' | 'trainer' | 'energy' {
    return card.cat === 'Monster' ? 'pokemon' : 'trainer';
  }

  function relevance(cards: readonly DeckCard[], candidates: readonly CatalogCard[]): number[] {
    const ctx = contextOf(cards);
    const empty = !ctx.main.length && !ctx.extra.length;
    const deckArcs = [...ctx.arcCount.keys()];
    const topArcs = [...ctx.arcCount].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a);
    const mentionArcs = [...ctx.mentionArcs];
    const commonLevel = [...ctx.levelCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const needTuner = ctx.tuners === 0 && ctx.monsters.length > 0;
    return candidates.map((card) => {
      const f = featuresOf(card);
      const r0 = f.roles;
      const generic = r0.has('search') || r0.has('deckSummon') ? 0.55 : r0.has('handTrap') || r0.has('negate') ? 0.5 : r0.has('removal') || r0.has('draw') ? 0.4 : 0.2;
      if (empty) return generic;
      let r = Math.max(0.1, generic * 0.8);
      if (ctx.names.has(f.name)) r = Math.max(r, 0.9);
      if (ctx.mentionNames.has(f.name)) r = Math.max(r, 1);
      if (topArcs.some((a) => inArc(f, a))) r = Math.max(r, 1);
      else if (deckArcs.some((a) => inArc(f, a))) r = Math.max(r, 0.8);
      if (mentionArcs.some((a) => inArc(f, a))) r = Math.max(r, 0.95);
      const wants = f.mentionArcs.length + f.names.length + f.mentionRaces.length + f.mentionAttrs.length;
      if (wants) {
        const ok =
          f.mentionArcs.some((a) => deckArcs.includes(a) || ctx.main.some((l) => inArc(l.f, a))) ||
          f.names.some((x) => ctx.names.has(x)) ||
          f.mentionRaces.some((x) => ctx.raceCount.has(x)) ||
          f.mentionAttrs.some((x) => ctx.attrCount.has(x));
        r = ok ? Math.max(r, 0.85) : Math.min(r, 0.1);
      }
      if (f.monster) {
        if (ctx.mentionRaces.has(f.race) || ctx.mentionAttrs.has(f.attr)) r = Math.max(r, 0.7);
        if (needTuner && f.tuner) r = Math.max(r, 0.5);
        if (f.level && f.level === commonLevel && f.level <= 4) r = Math.max(r, 0.45);
        if (f.level >= 5 && !r0.has('selfSummon')) r *= 0.6;
      }
      return r;
    });
  }

  function complete(cards: readonly DeckCard[], options: BuildOptions): DeckCard[] {
    const ctx = contextOf(cards);
    const out = [...cards];
    let room = 15 - ctx.extraCount;
    if (room <= 0) return out;
    const deckArcs = new Set(ctx.arcCount.keys());
    const ranked: { card: CatalogCard; f: YgoFeatures; s: number }[] = [];
    for (const list of printings.values()) {
      if (!isExtraDeckCard(list[0])) continue;
      const card = pickPrinting(list, options);
      if (!card) continue;
      const f = featuresOf(card);
      if (ctx.names.has(f.name) || limitOf(card, options.format) === 0) continue;
      if (!makeable(f.materials, f.level, ctx, f.contact)) continue;
      let s = 0;
      if (f.materials?.specific) s += 3;
      if (f.arcs.some((a) => deckArcs.has(a))) s += 2;
      if (f.roles.has('negate') || f.roles.has('removal')) s += 1;
      if (f.roles.has('search') || f.roles.has('deckSummon')) s += 0.5;
      // A monster whose text asks for an archetype, card, Type or Attribute the deck lacks is half a card.
      const wants = f.mentionArcs.length + f.names.length + f.mentionRaces.length + f.mentionAttrs.length;
      if (wants) {
        const ok =
          f.mentionArcs.some((a) => ctx.main.some((l) => inArc(l.f, a))) ||
          f.names.some((x) => ctx.names.has(x)) ||
          f.mentionRaces.some((x) => ctx.raceCount.has(x)) ||
          f.mentionAttrs.some((x) => ctx.attrCount.has(x));
        s += ok ? 1 : -3;
      }
      s += Math.min(1, (f.card.atk ?? 0) / 3000) * 0.5;
      ranked.push({ card, f, s });
    }
    ranked.sort((a, b) => b.s - a.s || a.f.pc - b.f.pc);
    // Variety: at most five of one Summon kind unless nothing else is left.
    const perKind = new Map<string, number>();
    const take = (pass: number) => {
      for (const x of ranked) {
        if (room <= 0) break;
        if (out.some((l) => l.cardId === x.card.id)) continue;
        const kind = x.f.materials!.kind;
        if (pass === 0 && (perKind.get(kind) ?? 0) >= 5) continue;
        perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
        out.push({ cardId: x.card.id, qty: 1 });
        room--;
      }
    };
    take(0);
    take(1);
    return out;
  }

  function canMake(card: CatalogCard, cards: readonly DeckCard[]): boolean {
    const f = featuresOf(card);
    return f.extra && makeable(f.materials, f.level, contextOf(cards), f.contact);
  }

  return {
    game: 'ygo',
    rules,
    formats: YGO_FORMATS,
    card: byId,
    score,
    pool,
    requirements,
    kindOf,
    relevance,
    complete,
    features: featuresOf,
    canMake,
  };
}
