/**
 * The Magic: The Gathering deck evaluator for 60-card constructed decks. It
 * reads each Oracle card's text (./mtg-text.ts) into a few features, then
 * scores a deck on nine rules of thumb, each explaining itself in one line so
 * the builder (./builder.ts) can say why it suggests a card:
 *
 *   rules        60 cards or more, four copies by name, legal in the format
 *   lands        a land count fitted to the curve
 *   colours      enough sources of each colour, on the turn the costs need them
 *   curve        plays on turns one to four, spells castable on time
 *   cards        draw, tutors, cantrips and selection
 *   interaction  removal, counterspells, sweepers, discard
 *   threats      creatures and planeswalkers that end games, power for cost
 *   synergy      cards that name a creature type, card type, keyword or
 *                mechanic find it in the deck
 *   focus        few colours unless the mana supports more, few one-ofs
 *
 * The mana numbers are computed by the hypergeometric distribution (a deck of
 * N cards, M of them mana sources, n cards seen by turn t), not quoted from
 * anyone's table; docs/deck-recommender-mtg.md shows the tables they give.
 * Nothing here learns from published decks.
 */
import type { CatalogIndex } from '@/data/catalog';
import type { DeckCard } from '@/data/db';
import { overLimit } from '@/data/decks';
import { normalizeText } from '@/data/normalize';
import type { CatalogCard } from '@/data/types';
import { MTG_DECK_RULES, type DeckRules } from '@/games/deck-rules';
import { isBasicLand, MTG_COLORS } from '@/games/mtg/catalog';
import type { MtgTextEntry, MtgTextIndex } from './mtg-text';
import type { BuildOptions, DeckEvaluator, DeckFormat, DeckScore, FormatOption, ScorePart } from './types';

/* ---------- formats ---------- */

export const MTG_FORMATS: readonly FormatOption[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'pioneer', label: 'Pioneer' },
  { id: 'modern', label: 'Modern' },
  { id: 'legacy', label: 'Legacy' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'pauper', label: 'Pauper' },
  { id: 'any', label: 'Any format' },
];

const formatLabel = (f: DeckFormat) => MTG_FORMATS.find((x) => x.id === f)?.label ?? f;

/* ---------- hypergeometric ---------- */

const logChoose = (() => {
  const lf: number[] = [0];
  const logFact = (n: number) => {
    for (let i = lf.length; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
    return lf[n];
  };
  return (n: number, k: number) => (k < 0 || k > n ? -Infinity : logFact(n) - logFact(k) - logFact(n - k));
})();

/** P(X = x) for x successes in n draws without replacement from N cards holding K successes. */
export function hyperPmf(N: number, K: number, n: number, x: number): number {
  if (x < 0 || x > K || x > n || n - x > N - K) return 0;
  return Math.exp(logChoose(K, x) + logChoose(N - K, n - x) - logChoose(N, n));
}

const atLeastCache = new Map<string, number>();
/** P(X ≥ k) for the same draw. */
export function hyperAtLeast(N: number, K: number, n: number, k: number): number {
  if (k <= 0) return 1;
  n = Math.min(n, N);
  const key = `${N},${K},${n},${k}`;
  let p = atLeastCache.get(key);
  if (p !== undefined) return p;
  p = 0;
  for (let x = k; x <= Math.min(n, K); x++) p += hyperPmf(N, K, n, x);
  p = Math.min(1, p);
  atLeastCache.set(key, p);
  return p;
}

/** Cards seen by turn t for the player on the play: the opening seven, then one draw a turn from turn two (CR 103.5, 103.8a). */
export const seenBy = (t: number) => 6 + Math.max(1, t);

const condCache = new Map<string, number>();
/**
 * P(at least k of the S coloured sources among the mana cards seen by turn t),
 * given at least t of the deck's M mana cards were seen by then: the colour
 * question asked of a deck that did hit its land drops (the land count is
 * judged on its own). N cards in the deck.
 */
export function colourChance(N: number, M: number, S: number, t: number, k: number): number {
  if (k <= 0) return 1;
  if (S <= 0 || M <= 0) return 0;
  const n = Math.min(seenBy(t), N);
  const key = `${N},${M},${S},${n},${k},${t}`;
  let p = condCache.get(key);
  if (p !== undefined) return p;
  let num = 0;
  let den = 0;
  for (let l = Math.min(t, M); l <= Math.min(n, M); l++) {
    const w = hyperPmf(N, M, n, l);
    den += w;
    num += w * hyperAtLeast(M, S, l, k);
  }
  p = den > 1e-12 ? num / den : hyperAtLeast(M, S, Math.min(t, M), k);
  condCache.set(key, p);
  return p;
}

/** The share of games, on the play, that hold at least K mana cards by turn K, the threshold the land target asks of. */
export const LAND_THRESHOLD = 0.6;

const landTargetCache = new Map<string, number>();
/**
 * The fewest mana cards in N for which P(at least K of them by turn K, on the
 * play) reaches LAND_THRESHOLD; fractional K interpolates between turns.
 */
export function landTarget(N: number, K: number): number {
  const lo = Math.floor(K);
  const frac = K - lo;
  const at = (k: number) => {
    const key = `${N},${k}`;
    let v = landTargetCache.get(key);
    if (v === undefined) {
      v = 0;
      while (v < N && hyperAtLeast(N, v, seenBy(k), k) < LAND_THRESHOLD) v++;
      landTargetCache.set(key, v);
    }
    return v;
  };
  return frac ? at(lo) + frac * (at(lo + 1) - at(lo)) : at(lo);
}

/**
 * Mean over turns 1..⌈K⌉ of P(at least t mana cards by turn t, on the play)
 * with M mana cards in N (fractional M interpolates): how many land drops a
 * deck makes, on a scale that moves with every land.
 */
export function landDrops(N: number, M: number, K: number): number {
  const at = (m: number) => {
    let s = 0;
    const T = Math.max(1, Math.ceil(K));
    for (let t = 1; t <= T; t++) s += hyperAtLeast(N, m, seenBy(t), t);
    return s / T;
  };
  const lo = Math.floor(M);
  const frac = M - lo;
  return frac ? at(lo) + frac * (at(lo + 1) - at(lo)) : at(lo);
}

/** 1 − e^(−points/τ) with τ set so `target` points score 0.9: more always helps, a little less each time. */
export const saturating = (points: number, target: number) => 1 - Math.exp((-points * Math.LN10) / target);

/* ---------- features ---------- */

export type Role =
  | 'drawMany'
  | 'drawOne'
  | 'loot'
  | 'select'
  | 'tutor'
  | 'removal'
  | 'bounce'
  | 'counter'
  | 'sweeper'
  | 'discard'
  | 'ramp';

const START = '(?:^|[.:—•]\\s*|\\bthen |\\byou may |\\band |(?<!whenever )\\byou )';
const TGT = '(?:up to (?:one|two) )?(?:another )?target (?:[\\w-]+ ){0,4}?';
const NOT_OWN = '(?! cards?)(?! you control)(?! you own)';
const BASIC_TYPES = 'Plains|Island|Swamp|Mountain|Forest';

/** Roles read from Oracle text (reminder text is already gone from the file). Checked over the whole card pool; see the doc. */
const ROLE_RULES: [Role, RegExp][] = [
  ['drawMany', new RegExp(`${START}draw (?:two|three|four|five|six|seven|X|that many|\\d+) cards|draw cards equal to|draws? (?:two|three|four) cards`, 'im')],
  ['drawOne', new RegExp(`${START}draw a card`, 'im')],
  ['loot', /draw (?:a|one|two|three) cards?, then discard|discard a card[^.]*\. if you do, draw|discard a card: draw|\bconnive/im],
  ['select', /\b(?:scry|surveil) (?:\d+|X)\b|look at the top (?:\w+|X) cards? of your library|\bexplores?\b|\binvestigate\b/im],
  ['tutor', new RegExp(`search your library for (?:a|an|up to (?:one|two|three)) (?!basic land|land|(?:snow )?(?:basic )?(?:${BASIC_TYPES})|[^.]*\\bland card)(?:[\\w-]+ ){0,4}cards?`, 'im')],
  ['removal', new RegExp(`(?:destroy|exile) ${TGT}(?:creature|permanent|planeswalker)${NOT_OWN}(?![^.]*(?:\\.|, then) return (?:it|that card|the exiled card|them|those cards) to the battlefield)`, 'im')],
  ['removal', new RegExp(`deals? (?:\\d+|X|that much) damage to (?:any target|${TGT}(?:creature|planeswalker))|deals? damage equal to [^.]{1,60}? to (?:any target|${TGT}creature)`, 'im')],
  ['removal', new RegExp(`fights? ${TGT}creature|${TGT}creature (?:an opponent controls |you don't control )?gets -(?:\\d+|X)/-(?:[1-9]\\d*|X)`, 'im')],
  ['removal', /(?:target player|target opponent|each opponent) sacrifices (?:a|an|two) (?:[\w-]+ )?(?:creature|permanent|nonland permanent)/im],
  ['bounce', new RegExp(`return ${TGT}(?:creature|permanent|nonland permanent)${NOT_OWN} to its owner's hand`, 'im')],
  ['counter', /counter target (?:[\w-]+ ){0,3}?spell/im],
  [
    'sweeper',
    /(?:destroy|exile) all (?:[\w-]+ ){0,3}?(?:creatures|permanents|nonland permanents)|deals? (?:\d+|X) damage to each (?:other )?creature|all (?:other )?creatures get -(?:\d+|X)\/-(?:[1-9]\d*|X)|each (?:player|opponent) sacrifices (?:a|all) creatures?/im,
  ],
  ['discard', /target (?:player|opponent) reveals (?:their|his or her) hand[^.]*\. you choose|(?:target (?:player|opponent)|each opponent) discards (?:a|two|that many|\w+) cards?/im],
  [
    'ramp',
    new RegExp(
      `search your library for (?:up to (?:one|two) )?(?:a )?(?:basic land|land|(?:basic )?(?:${BASIC_TYPES})(?: or (?:${BASIC_TYPES}))*) cards?[^.]*(?:onto|put (?:it|them) onto) the battlefield|put (?:a|up to \\w+) land cards? from your hand onto the battlefield|you may play an additional land`,
      'im',
    ),
  ],
];

const RE_MANA_ABILITY = /\{T\}(?:, [^:]+)?: Add /m;
const RE_FETCH = new RegExp(`search your library for (?:a|an|up to one) (?:basic )?(land card|(?:${BASIC_TYPES})(?:,? (?:or )?(?:${BASIC_TYPES}))* card)`, 'im');
const RE_ANY_NUMBER = /A deck can have (?:any number of|up to (\w+)) cards named ~/m;
const RE_NAMED = /\bcards? named (?!~)([A-Z][^.;:"]*)/gm;
const RE_UNBLOCKABLE = /(?:This creature|~) can't be blocked\./m;
const RE_TAPPED = /^(?:~|This land) enters (?:the battlefield )?tapped\.$/m;
const BASIC_COLOUR: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
const NUMBER_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/* synergy tags: what a card asks for (needs) and what it is or makes (provides) */

const CARD_TYPES = ['artifact', 'enchantment', 'instant', 'sorcery', 'creature', 'planeswalker', 'land', 'equipment', 'aura', 'vehicle', 'legendary', 'saga'];
const TAG_RULES: { tag: string[]; re: RegExp }[] = [
  { tag: ['card:artifact'], re: /\bartifacts? you control\b|\bartifact spells?\b|\bfor each artifact\b|\bWhenever (?:an|another) artifact\b|\bartifact cards? in your graveyard\b|\bMetalcraft\b|\bAffinity for artifacts\b|\bImprovise\b/i },
  { tag: ['card:enchantment'], re: /\benchantments? you control\b|\benchantment spells?\b|\bfor each enchantment\b|\bWhenever (?:an|another) enchantment\b|\bConstellation\b/i },
  { tag: ['card:instant', 'card:sorcery'], re: /\binstant (?:or|and) sorcery\b|\bWhenever you cast (?:an|a) (?:instant|sorcery) spell\b|\bMagecraft\b|\bSpells? mastery\b/i },
  { tag: ['card:instant', 'card:sorcery', 'card:artifact', 'card:enchantment', 'card:planeswalker'], re: /\bnoncreature spells?\b/i },
  { tag: ['card:equipment'], re: /\bEquipment you control\b|\bequipped creatures? you control\b|\bfor each Equipment\b|\bWhenever an Equipment\b|\bEquipment spells?\b/i },
  { tag: ['card:aura'], re: /\bAuras? you control\b|\benchanted creatures? you control\b|\bfor each Aura\b|\bAura spells?\b/i },
  { tag: ['card:vehicle'], re: /\bVehicles? you control\b|\bVehicle spells?\b|\bfor each Vehicle\b/i },
  { tag: ['card:legendary'], re: /\blegendary spells?\b|\blegendary creatures? you control\b|\bfor each legendary\b|\bhistoric spells?\b/i },
  { tag: ['counters'], re: /\bwith (?:a|one or more) \+1\/\+1 counters? on (?:it|them)\b|\bfor each \+1\/\+1 counter\b|\bWhenever one or more \+1\/\+1 counters are put\b|\bproliferate\b/i },
  { tag: ['token'], re: /\bcreature tokens? you control\b|\bWhenever (?:a|one or more|another) (?:creature )?tokens?\b|\bfor each (?:creature )?token\b|\btokens you control\b/i },
  { tag: ['lifegain'], re: /\bWhenever you gain life\b|\bif you(?:'ve)? gained (?:\d+ or more )?life\b|\bfor each 1 life you gained\b/i },
  { tag: ['graveyard'], re: /\b(?:Threshold|Delirium|Descend \d+)\b|\b(?:\w+) or more (?:\w+ )?cards in your graveyard\b|\bfor each [\w ]*?card in your graveyard\b/i },
  { tag: ['sacrifice', 'token'], re: /\bWhenever (?:you sacrifice|another creature you control dies|a creature you control dies|another creature dies|a creature dies)\b/i },
];
const KEYWORD_MENTION = /\bcreatures? (?:you control )?with (flying|deathtouch|lifelink|trample|menace|haste|first strike|vigilance|reach|defender)\b/gi;
const RE_PROVIDES_COUNTERS = /\bput (?:a|an|one|two|three|four|X|\d+|that many) \+1\/\+1 counters? on\b/i;
const COUNTER_KEYWORDS = new Set(['Adapt', 'Evolve', 'Bolster', 'Outlast', 'Support', 'Mentor', 'Training', 'Backup', 'Modular', 'Riot', 'Unleash', 'Graft', 'Reinforce', 'Amass']);
const RE_PROVIDES_TOKEN = /\bcreate (?:a|an|one|two|three|four|five|X|\d+|that many)\b[^.]*?\btokens?\b/i;
const RE_PROVIDES_LIFE = /\byou gain (?:\d+|X|that much) life\b|\bgain (?:\d+|X) life\b/i;
const RE_PROVIDES_GRAVE = /\bmill (?:\w+) cards?\b|\bmills? (?:\w+) cards?\b|\bsurveil\b|\bdiscard (?:a|two|one or more) cards?\b|\bput the top (?:\w+ )?cards? of your library into your graveyard\b/i;
const RE_PROVIDES_SAC = /\bSacrifice (?:a|another) (?:creature|artifact|permanent)\b/;

export interface PipGroup {
  /** Colour letters any of which pays the pip ("W", "WU" for a hybrid pip, "C" for colourless). */
  colours: string;
  n: number;
}

export interface MtgFeatures {
  card: CatalogCard;
  entry?: MtgTextEntry;
  /** Normalized name. */
  key: string;
  /** Oracle text of every face, with the card's own name masked as "~". */
  text: string;
  mv: number;
  isLand: boolean;
  /** A modal double-faced card with a land back face: counts as half a land. */
  isMdfcLand: boolean;
  isCreature: boolean;
  isPlaneswalker: boolean;
  isBasic: boolean;
  legendary: boolean;
  /** Coloured pips of the (front face's) mana cost, grouped by what pays them. */
  pips: PipGroup[];
  /** Colours of the cost (WUBRG letters). */
  colours: string;
  identity: string;
  /** Colours this card adds as a mana source (WUBRGC; "*" means "the basic land types the deck has"). */
  produces: string;
  /** 1 for a land, 0.5 for a modal land or a cheap mana creature, artifact or enchantment, 0 otherwise. */
  manaWeight: number;
  tapped: boolean;
  roles: Set<Role>;
  /** Threat value, ~1 for a creature as strong as most of its mana value; 0 for non-threats. */
  threat: number;
  power: number;
  evasive: boolean;
  /** Synergy tags this card asks for. */
  needs: Set<string>;
  /** Synergy tags this card is or makes. */
  provides: Set<string>;
  /** Normalized names of other cards this one searches for by name. */
  partners: string[];
  /** Copies a deck may hold before format restrictions (4, Infinity for basics and "any number" cards, 7 or 9 for the "up to" cards). */
  copyLimit: number;
  /** 0..1, used to order candidates of equal relevance. */
  quality: number;
  /** `colours` as bits (W 1, U 2, B 4, R 8, G 16), and the interaction and card-advantage points of one copy, for the relevance pass. */
  colourMask: number;
  interactionPoints: number;
  cardPoints: number;
  /** `needs` and `provides` as arrays, and the builder's kind, for the relevance pass. */
  needList: string[];
  provideList: string[];
  kind: 'pokemon' | 'trainer' | 'energy';
}

const COLOUR_BIT: Record<string, number> = { W: 1, U: 2, B: 4, R: 8, G: 16 };
const maskOf = (letters: Iterable<string>) => {
  let m = 0;
  for (const l of letters) m |= COLOUR_BIT[l] ?? 0;
  return m;
};
const bits = (m: number) => {
  let n = 0;
  for (; m; m &= m - 1) n++;
  return n;
};

/** Interaction points per role: what one copy is worth to the interaction part. */
const INTERACTION_WEIGHT: Partial<Record<Role, number>> = { removal: 1, counter: 1, sweeper: 1.5, bounce: 0.6, discard: 0.6 };
/** Card-advantage points per role. */
const CARDS_WEIGHT: Partial<Record<Role, number>> = { drawMany: 1, tutor: 1, drawOne: 0.5, loot: 0.4, select: 0.3 };
/** A cheap effect is worth more than a dear one. */
const efficiency = (mv: number) => (mv <= 2 ? 1 : mv === 3 ? 0.85 : mv === 4 ? 0.7 : mv === 5 ? 0.55 : 0.4);

function bestOf(roles: Set<Role>, weights: Partial<Record<Role, number>>): number {
  let best = 0;
  for (const r of roles) best = Math.max(best, weights[r] ?? 0);
  return best;
}

const RE_CAPITALIZED = /(?<![\w'])[A-Z][A-Za-z'-]*/g;

/** Oracle text with the card's own names (full, each face, and a legend's short name) masked as "~". */
function maskName(text: string, name: string, faces: readonly string[]): string {
  if (!text) return text;
  const names = new Set([name, ...name.split(' // '), ...faces]);
  for (const n of [...names]) if (n.includes(', ')) names.add(n.split(', ')[0]);
  let out = text;
  for (const n of [...names].filter((x) => x.length > 2).sort((a, b) => b.length - a.length)) if (out.includes(n)) out = out.split(n).join('~');
  return out;
}

/** Mana value of a cost string (CR 202.3): generic numbers, 1 per other symbol, X as 0, a hybrid's largest component. */
export function costMv(cost: string): number {
  let n = 0;
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const parts = m[1].split('/');
    if (parts.every((p) => /^[XYZ]$/.test(p))) continue;
    n += Math.max(...parts.map((p) => (/^\d+$/.test(p) ? Number(p) : 1)));
  }
  return n;
}

function pipsOf(cost: string | undefined): PipGroup[] {
  const groups = new Map<string, number>();
  for (const m of (cost ?? '').matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1];
    if (sym.includes('/P')) continue; // Phyrexian: payable with life (CR 107.4f)
    const parts = sym.split('/');
    const colours = parts.filter((p) => /^[WUBRGC]$/.test(p));
    if (!colours.length || parts.some((p) => /^\d+$/.test(p))) continue; // generic, X, snow, {2/W}
    const key = colours.sort((a, b) => 'WUBRGC'.indexOf(a) - 'WUBRGC'.indexOf(b)).join('');
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([colours, n]) => ({ colours, n }));
}

const num = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/** Catalog-wide data the evaluator computes once per text index, shared by every format's evaluator. */
interface Shared {
  features: Map<string, MtgFeatures>;
  /** 75th-percentile power of creatures by mana value (index 0..10), the threat yardstick. */
  powerByMv: number[];
  creatureTypes: Set<string>;
  /** A creature type or one of its plurals → the type. */
  typeWords: Map<string, string>;
  /** Normalized names of every catalog card, for "card named X". */
  names: Set<string>;
}

const sharedCache = new WeakMap<MtgTextIndex, WeakMap<CatalogIndex, Shared>>();

function plural(t: string): string[] {
  const out = [t];
  if (/(?:s|x|ch|sh)$/.test(t)) out.push(`${t}es`);
  else if (/[^aeiou]y$/.test(t)) out.push(`${t.slice(0, -1)}ies`);
  else if (/f$/.test(t)) out.push(`${t.slice(0, -1)}ves`, `${t}s`);
  else out.push(`${t}s`);
  return out;
}

function sharedOf(index: CatalogIndex, text: MtgTextIndex): Shared {
  let byIndex = sharedCache.get(text);
  if (!byIndex) sharedCache.set(text, (byIndex = new WeakMap()));
  let s = byIndex.get(index);
  if (s) return s;
  const powers: number[][] = Array.from({ length: 11 }, () => []);
  const creatureTypes = new Set<string>();
  const names = new Set<string>();
  const seen = new Set<string>();
  for (const card of index.catalog.cards) {
    const oid = card.oid ?? card.name;
    if (seen.has(oid)) continue;
    seen.add(oid);
    names.add(card.name);
    const tl = (card.sub ?? '').split(' // ')[0];
    const [types, subs] = tl.split(' — ');
    if (/\b(?:Creature|Kindred|Tribal)\b/.test(types ?? '') && subs) for (const t of subs.split(' ')) if (/^[A-Z][\w'-]+$/.test(t)) creatureTypes.add(t);
    if (/\bCreature\b/.test(types ?? '')) {
      const p = num(card.pow);
      if (!Number.isNaN(p)) powers[Math.min(10, Math.max(0, Math.round(card.mv ?? 0)))].push(p);
    }
  }
  const powerByMv = powers.map((l, mv) => {
    l.sort((a, b) => a - b);
    return l.length ? Math.max(1, l[Math.floor(l.length * 0.75)]) : Math.max(1, mv);
  });
  // "Elf", "Elves", "Goblins": every creature type and its plurals, to the singular.
  const typeWords = new Map<string, string>();
  for (const t of creatureTypes) for (const w of plural(t)) if (!typeWords.has(w) || w === t) typeWords.set(w, t);
  s = { features: new Map(), powerByMv, creatureTypes, typeWords, names: new Set([...names].map(normalizeText)) };
  byIndex.set(index, s);
  return s;
}

/* ---------- evaluator ---------- */

export interface MtgEvaluatorDeps {
  index: CatalogIndex;
  text: MtgTextIndex;
  /** The format the score's issues and copy limits follow (default "any"); create one evaluator per format. */
  format?: DeckFormat;
}

export interface MtgEvaluator extends DeckEvaluator {
  format: DeckFormat;
  features(card: CatalogCard): MtgFeatures;
  /** The same evaluator under another format (caches shared). */
  withFormat(format: DeckFormat): MtgEvaluator;
  legalIn(card: CatalogCard, format: DeckFormat): boolean;
}

export const MTG_WEIGHTS = { rules: 10, lands: 15, colours: 15, curve: 10, cards: 10, interaction: 10, threats: 10, synergy: 10, focus: 10 } as const;

/** Card-advantage and interaction points for full marks; threat points for full density. */
export const CARDS_TARGET = 6;
export const INTERACTION_TARGET = 8;
export const THREAT_TARGET = 14;
/** Copies of what a synergy card names for it to count as fully met. */
export const SYNERGY_SUPPORT = 8;
/** Tags a deck can be built around, for cohesion: creature types, tokens, counters, life gain, sacrifice, artifacts, enchantments. */
const THEME_TAG = /^(?:type:(?!\*)|token$|counters$|lifegain$|sacrifice$|card:(?:artifact|enchantment|equipment|aura|vehicle)$)/;
const THEME_NAMES: Record<string, string> = {
  token: 'tokens',
  counters: '+1/+1 counters',
  lifegain: 'life gain',
  graveyard: 'the graveyard',
  sacrifice: 'sacrifice',
};
function themeLabel(tag: string): string {
  const [kind, value] = tag.split(':');
  if (!value) return THEME_NAMES[kind] ?? kind;
  if (kind === 'type') return `the type ${value}`;
  if (kind === 'kw') return value;
  return `${value}s`;
}

/** Land-equivalents that mana creatures, rocks and the like may stand in for (each counts half, so four of them). */
export const MAX_NONLAND_MANA = 2;
/** Candidates of each kind the relevance pass leaves above zero (the builder scores at most 60 of a kind). */
const RELEVANT_PER_KIND = 300;

interface Line {
  card: CatalogCard;
  f: MtgFeatures;
  qty: number;
}

interface DeckContext {
  lines: Line[];
  total: number;
  byName: Map<string, number>;
  /** Colours of the nonland cards' costs. */
  colours: Set<string>;
  /** Provided synergy tags → copies. */
  provided: Map<string, number>;
  /** Needed synergy tags → copies asking. */
  needed: Map<string, number>;
  interaction: number;
  cardPoints: number;
  threatPoints: number;
}

export function createMtgEvaluator({ index, text, format = 'any' }: MtgEvaluatorDeps): MtgEvaluator {
  const shared = sharedOf(index, text);
  const features = shared.features;

  function legalIn(card: CatalogCard, f: DeckFormat): boolean {
    const e = featuresOf(card).entry;
    if (!e) return false;
    return f === 'any' ? e.legal.size > 0 : e.legal.has(f);
  }

  const restricted = (card: CatalogCard) => format !== 'any' && (featuresOf(card).entry?.restricted.has(format) ?? false);

  const rules: DeckRules = {
    ...MTG_DECK_RULES,
    copyLimit: (card) => (restricted(card) ? 1 : featuresOf(card).copyLimit),
  };

  function featuresOf(card: CatalogCard): MtgFeatures {
    const k = card.oid ?? card.id;
    let f = features.get(k);
    if (f) return f;
    const entry = text.get(card.oid);
    const tl = card.sub ?? '';
    const faceTypes = tl.split(' // ');
    const front = faceTypes[0] ?? '';
    const frontTypes = front.split(' — ')[0];
    const has = (s: string, w: string) => new RegExp(`\\b${w}\\b`).test(s);
    const isLand = card.cat === 'Land';
    const isMdfcLand = !isLand && faceTypes.length > 1 && has(faceTypes[faceTypes.length - 1].split(' — ')[0], 'Land') && !has(frontTypes, 'Land');
    const isCreature = card.cat === 'Creature';
    const isPlaneswalker = card.cat === 'Planeswalker';
    const masked = maskName(entry?.text ?? '', card.name, entry?.faces.map((x) => x.n) ?? []);
    const roles = new Set<Role>();
    for (const [role, re] of ROLE_RULES) if (re.test(masked)) roles.add(role);

    // Mana: what a land or cheap mana permanent adds.
    let produces = entry?.produces ?? '';
    let manaWeight = 0;
    if (isLand) {
      manaWeight = 1;
      const fetch = RE_FETCH.exec(masked);
      if (!produces && fetch) produces = /land card/.test(fetch[1]) ? '*' : [...fetch[1].matchAll(new RegExp(BASIC_TYPES, 'g'))].map((m) => BASIC_COLOUR[m[0]]).join('');
      if (fetch) roles.delete('ramp');
    } else if (isMdfcLand) {
      manaWeight = 0.5;
    } else if (produces && (card.mv ?? 0) <= 2 && /\b(?:Creature|Artifact|Enchantment)\b/.test(frontTypes) && RE_MANA_ABILITY.test(masked)) {
      manaWeight = 0.5;
      roles.add('ramp');
    } else produces = '';
    if (!manaWeight) produces = '';

    // Threat: power against the 75th-percentile power at the card's mana value, plus evasion.
    // A split or adventure card's catalog cost holds both halves ("{1}{W} // {1}{W}{W}"): the front half is what
    // the deck casts on curve, with its own mana value (a split card's catalog mana value is both halves', CR 202.3d).
    const frontCost = (card.cost ?? '').split(' // ')[0];
    const mv = (card.cost ?? '').includes(' // ') ? costMv(frontCost) : (card.mv ?? 0);
    const kws = new Set(entry?.keywords ?? []);
    const power = num(card.pow);
    const evasive = kws.has('Flying') || kws.has('Trample') || kws.has('Menace') || kws.has('Shadow') || kws.has('Fear') || kws.has('Intimidate') || RE_UNBLOCKABLE.test(masked);
    let threat = 0;
    if (isCreature) {
      const base = shared.powerByMv[Math.min(10, Math.max(1, Math.round(mv)))];
      const p = Number.isNaN(power) ? 0.5 * base : power;
      threat = Math.min(2, p / base);
      if (kws.has('Double strike')) threat *= 1.6;
      let bonus = 0;
      if (evasive) bonus += 0.25;
      if (kws.has('Haste')) bonus += 0.15;
      if (kws.has('Lifelink') || kws.has('Deathtouch') || kws.has('First strike')) bonus += 0.1;
      if (kws.has('Hexproof') || kws.has('Ward') || kws.has('Indestructible')) bonus += 0.1;
      threat = Math.min(2.5, threat * (1 + bonus));
      if (has(frontTypes, 'Vehicle')) threat *= 0.6;
    } else if (isPlaneswalker) threat = 1;
    else if (has(frontTypes, 'Vehicle') && !Number.isNaN(power)) threat = 0.6 * Math.min(1.5, power / shared.powerByMv[Math.min(10, Math.max(1, Math.round(mv)))]);

    // Synergy: tags asked for and tags provided.
    const needs = new Set<string>();
    const provides = new Set<string>();
    const tokenClauses: string[] = [];
    const rest = masked.replace(/\bcreate\b[^.]*?\btokens?\b/gi, (m) => {
      tokenClauses.push(m);
      return ' ';
    });
    for (const { tag, re } of TAG_RULES) if (re.test(rest)) for (const t of tag) needs.add(t);
    for (const m of rest.matchAll(KEYWORD_MENTION)) needs.add(`kw:${m[1].toLowerCase()}`);
    for (const m of rest.matchAll(RE_CAPITALIZED)) {
      const word = m[0];
      const singular = shared.typeWords.get(word);
      if (!singular) continue;
      if (/non-$/i.test(rest.slice(Math.max(0, m.index - 4), m.index))) continue;
      const after = rest.slice(m.index + word.length, m.index + word.length + 24);
      // A type is asked for when the text counts, buffs, searches or casts it ("Goblins you control", "another Elf",
      // "Wizard spells"), not when it merely names one in passing.
      if (/^ (?:you control|spells?|cards?|creatures?|permanents?|get|have|gain)\b/.test(after) || /\b(?:other|Other|another|each|Each|for each|target)\s$/.test(rest.slice(Math.max(0, m.index - 12), m.index))) needs.add(`type:${singular}`);
    }
    for (const c of tokenClauses) for (const m of c.matchAll(RE_CAPITALIZED)) if (shared.creatureTypes.has(m[0])) provides.add(`type:${m[0]}`);
    const subtypes = (front.split(' — ')[1] ?? '').split(' ').filter(Boolean);
    if (isCreature || /\b(?:Kindred|Tribal)\b/.test(frontTypes)) for (const t of subtypes) provides.add(`type:${t}`);
    if (kws.has('Changeling')) provides.add('type:*');
    const lowerTypes = frontTypes.toLowerCase();
    for (const t of CARD_TYPES) if (new RegExp(`\\b${t}\\b`).test(lowerTypes) || subtypes.some((s) => s.toLowerCase() === t)) provides.add(`card:${t}`);
    for (const kw of kws) provides.add(`kw:${kw.toLowerCase()}`);
    if (tokenClauses.length || RE_PROVIDES_TOKEN.test(masked)) provides.add('token');
    if (RE_PROVIDES_COUNTERS.test(masked) || [...kws].some((k) => COUNTER_KEYWORDS.has(k))) provides.add('counters');
    if (RE_PROVIDES_LIFE.test(masked) || kws.has('Lifelink')) provides.add('lifegain');
    if (RE_PROVIDES_GRAVE.test(masked) || roles.has('loot')) provides.add('graveyard');
    if (RE_PROVIDES_SAC.test(masked)) provides.add('sacrifice');
    // A card's own tags do not satisfy itself (a lord does not count itself), but it may ask for what it also is.

    // Partners: other cards it searches for by name.
    const partners: string[] = [];
    for (const m of masked.matchAll(RE_NAMED)) {
      // The longest run of words after "named" that is a card's name ("Mu Yanling, Celestial Wind, reveal it" → "Mu Yanling, Celestial Wind").
      const words = m[1].split(' ').slice(0, 10);
      for (let n = words.length; n > 0; n--) {
        const name = normalizeText(words.slice(0, n).join(' '));
        if (shared.names.has(name)) {
          if (name !== normalizeText(card.name)) partners.push(name);
          break;
        }
      }
    }

    // Copy limit: four, any number for basic lands (CR 100.2a) and for cards that say so.
    let copyLimit = isBasicLand(card) ? Infinity : 4;
    const any = RE_ANY_NUMBER.exec(masked);
    if (any) copyLimit = any[1] ? (NUMBER_WORD[any[1].toLowerCase()] ?? Number(any[1])) || 4 : Infinity;

    const pips = pipsOf(frontCost);
    const colours = 'WUBRG'
      .split('')
      .filter((l) => pips.some((p) => p.colours.includes(l)) || (card.types ?? []).includes(MTG_COLORS[l]))
      .join('');

    // Quality: what the card does for its cost, for ordering candidates.
    let quality = 0.25;
    if (isLand) quality = produces === '*' || produces.replace('C', '').length >= 2 ? 0.6 : isBasicLand(card) ? 0.5 : 0.3;
    else {
      const inter = bestOf(roles, INTERACTION_WEIGHT);
      const adv = bestOf(roles, CARDS_WEIGHT);
      quality = Math.max(quality, Math.min(1, threat / 1.3), Math.min(1, inter * efficiency(mv)), Math.min(1, adv * efficiency(mv)), roles.has('ramp') ? 0.5 : 0);
      if (mv >= 7) quality *= 0.7;
    }

    f = {
      card,
      entry,
      key: normalizeText(card.name),
      text: masked,
      mv,
      isLand,
      isMdfcLand,
      isCreature,
      isPlaneswalker,
      isBasic: isBasicLand(card),
      legendary: /\bLegendary\b/.test(frontTypes),
      pips,
      colours,
      identity: entry?.identity ?? '',
      produces,
      manaWeight,
      tapped: RE_TAPPED.test(masked),
      roles,
      threat,
      power: Number.isNaN(power) ? 0 : power,
      evasive,
      needs,
      provides,
      partners,
      copyLimit,
      quality,
      colourMask: maskOf(colours),
      interactionPoints: bestOf(roles, INTERACTION_WEIGHT) * efficiency(mv),
      cardPoints: bestOf(roles, CARDS_WEIGHT) * efficiency(mv),
      needList: [...needs],
      provideList: [...provides],
      kind: isCreature || isPlaneswalker ? 'pokemon' : isLand ? 'energy' : 'trainer',
    };
    features.set(k, f);
    return f;
  }

  function contextOf(cards: readonly DeckCard[]): DeckContext {
    const byId = new Map<string, Line>();
    for (const c of cards) {
      if (c.zone || c.qty <= 0) continue;
      const card = index.cardsById.get(c.cardId);
      if (!card) continue;
      const l = byId.get(card.id);
      if (l) l.qty += c.qty;
      else byId.set(card.id, { card, f: featuresOf(card), qty: c.qty });
    }
    const lines = [...byId.values()];
    const ctx: DeckContext = {
      lines,
      total: lines.reduce((n, l) => n + l.qty, 0),
      byName: new Map(),
      colours: new Set(),
      provided: new Map(),
      needed: new Map(),
      interaction: 0,
      cardPoints: 0,
      threatPoints: 0,
    };
    for (const l of lines) {
      ctx.byName.set(l.f.key, (ctx.byName.get(l.f.key) ?? 0) + l.qty);
      if (!l.f.isLand) for (const c of l.f.colours) ctx.colours.add(c);
      for (const t of l.f.provides) ctx.provided.set(t, (ctx.provided.get(t) ?? 0) + l.qty);
      for (const t of l.f.needs) ctx.needed.set(t, (ctx.needed.get(t) ?? 0) + l.qty);
      ctx.interaction += l.qty * l.f.interactionPoints;
      ctx.cardPoints += l.qty * l.f.cardPoints;
      ctx.threatPoints += l.qty * Math.min(1.5, l.f.threat);
    }
    return ctx;
  }

  /** Copies elsewhere in the deck that provide one of `needs` (a changeling is every creature type). */
  function support(needs: Set<string>, ctx: DeckContext, self: Line): number {
    let best = 0;
    for (const t of needs) {
      let n = ctx.provided.get(t) ?? 0;
      if (t.startsWith('type:')) n += ctx.provided.get('type:*') ?? 0;
      if (self.f.provides.has(t) || (t.startsWith('type:') && self.f.provides.has('type:*'))) n -= self.qty;
      best = Math.max(best, n);
    }
    return best;
  }

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const part = (id: keyof typeof MTG_WEIGHTS, label: string, score: number, detail: string): ScorePart => ({ id, label, score: clamp01(score), weight: MTG_WEIGHTS[id], detail });
  const COLOUR_NAME: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colourless' };
  const groupName = (g: string) => g.split('').map((c) => COLOUR_NAME[c] ?? c).join('/');

  function score(cards: readonly DeckCard[]): DeckScore {
    const ctx = contextOf(cards);
    const { lines, total, byName } = ctx;
    const N = Math.max(60, total);
    const parts: ScorePart[] = [];
    const issues: string[] = [];
    const spells = lines.filter((l) => !l.f.isLand);
    const spellQty = spells.reduce((n, l) => n + l.qty, 0);

    // rules: at least 60 cards (CR 100.2a; more is legal, and dilutes), copy limits, format legality.
    const over = overLimit(rules, cards, index);
    for (const o of over) issues.push(`${o.name}: ${o.qty} copies, ${o.limit} at most${o.limit === 1 ? ` (restricted in ${formatLabel(format)})` : ''}`);
    if (total < 60) issues.push(`${60 - total} cards to go`);
    const illegal = lines.filter((l) => !legalIn(l.card, format));
    for (const l of illegal) issues.push(format === 'any' ? `${l.card.name} is not legal in any constructed format` : `${l.card.name} is not legal in ${formatLabel(format)}`);
    const sizeScore = total < 60 ? 1 - (60 - total) / 60 : 1 - Math.min(0.5, (total - 60) / 40);
    parts.push(
      part(
        'rules',
        'Deck rules',
        sizeScore - 0.25 * over.length - 0.25 * illegal.length,
        total < 60
          ? `${total} of 60 cards`
          : illegal.length
            ? `${illegal.length} card${illegal.length > 1 ? 's' : ''} not legal in ${formatLabel(format)}`
            : over.length
              ? `${over.length} over the copy limit`
              : total > 60
                ? `${total} cards: ${total - 60} over 60 thin out the best ones`
                : `60 cards, copy limits kept${format !== 'any' ? `, legal in ${formatLabel(format)}` : ''}`,
      ),
    );

    // Mana cards: lands (modal lands half) and cheap mana creatures and artifacts (half).
    // Nonland sources (modal lands aside) stand in for at most MAX_NONLAND_MANA lands: they cannot be played as a land drop.
    let landMana = 0;
    let otherMana = 0;
    for (const l of lines) {
      if (l.f.isLand || l.f.isMdfcLand) landMana += l.qty * l.f.manaWeight;
      else otherMana += l.qty * l.f.manaWeight;
    }
    const manaCards = landMana + Math.min(MAX_NONLAND_MANA, otherMana);
    const landQty = lines.filter((l) => l.f.isLand).reduce((n, l) => n + l.qty, 0);

    // lands: fitted to the top of the curve (mean mana value of the dearest quarter of the spells).
    const mvs: number[] = [];
    for (const l of spells) for (let i = 0; i < l.qty; i++) mvs.push(l.f.mv);
    mvs.sort((a, b) => b - a);
    const top = mvs.slice(0, Math.max(1, Math.ceil(mvs.length / 4)));
    const K = mvs.length ? Math.max(2, Math.min(6, top.reduce((a, b) => a + b, 0) / top.length)) : 3;
    const target = landTarget(N, K);
    // Short of the target: the land drops made (turns 1..K) against what the target makes, so every land
    // counts even far below it. Over it: a sixth per land past one spare, the cards that flood instead of cast.
    const landScore =
      manaCards <= target ? landDrops(N, manaCards, K) / Math.max(1e-9, landDrops(N, target, K)) : 1 - Math.max(0, manaCards - target - 1) / 6;
    parts.push(
      part(
        'lands',
        'Lands',
        mvs.length ? landScore : landQty ? 0.5 : 0,
        `${landQty} lands${manaCards !== landQty ? ` (${+manaCards.toFixed(1)} with mana creatures and rocks)` : ''}; about ${Math.round(target)} fit a curve whose dearest quarter costs ${K.toFixed(1)}`,
      ),
    );

    // colours: for each spell, the chance its coloured pips are paid on curve, given the land drops were hit.
    const M = Math.max(1, Math.round(manaCards));
    const basicColours = new Set<string>();
    for (const l of lines) if (l.f.isBasic) for (const c of l.f.produces) basicColours.add(c);
    const sourcesOf = (group: string) => {
      let s = 0;
      for (const l of lines) {
        if (!l.f.manaWeight) continue;
        const p = l.f.produces === '*' ? [...basicColours].join('') : l.f.produces;
        if ([...group].some((c) => p.includes(c))) s += l.qty * l.f.manaWeight;
      }
      return Math.min(M, Math.round(s));
    };
    const sourceCache = new Map<string, number>();
    const sources = (g: string) => {
      let s = sourceCache.get(g);
      if (s === undefined) sourceCache.set(g, (s = sourcesOf(g)));
      return s;
    };
    let pSum = 0;
    let pW = 0;
    let worst: { p: number; text: string } | undefined;
    for (const l of spells) {
      if (!l.f.pips.length) continue;
      const t = Math.max(1, Math.ceil(l.f.mv));
      let p = 1;
      let weakest = { p: 1, g: '', s: 0 };
      for (const g of l.f.pips) {
        const s = sources(g.colours);
        const q = colourChance(N, M, s, t, g.n);
        p *= q;
        if (q < weakest.p) weakest = { p: q, g: g.colours, s };
      }
      pSum += p * l.qty;
      pW += l.qty;
      if (!worst || p < worst.p) worst = { p, text: `${l.card.name} on turn ${t} with ${weakest.s} ${groupName(weakest.g)} sources: ${pct(p)}` };
    }
    const meanP = pW ? pSum / pW : 1;
    // And the share of mana cards that make a colour the spells use (any mana counts when no spell needs a colour).
    let useful = 0;
    let manaW = 0;
    for (const l of lines) {
      if (!l.f.manaWeight) continue;
      const p = l.f.produces === '*' ? [...basicColours].join('') : l.f.produces;
      manaW += l.qty * l.f.manaWeight;
      if (!ctx.colours.size || [...p].some((c) => ctx.colours.has(c))) useful += l.qty * l.f.manaWeight;
    }
    const usefulShare = manaW ? useful / manaW : 0;
    const offColour = Math.round(manaW - useful);
    parts.push(
      part(
        'colours',
        'Colours',
        pW ? 0.7 * clamp01((meanP - 0.5) / 0.4) + 0.3 * clamp01((usefulShare - 0.5) / 0.5) : landQty ? 1 : 0,
        (!pW ? 'No coloured spells' : worst!.p > 0.995 ? 'Every spell has the colours it needs on curve' : `Colours there on curve ${pct(meanP)} of the time; weakest ${worst!.text}`) +
          (offColour > 0 && pW ? `; ${offColour} mana cards make no colour the spells use` : ''),
      ),
    );

    // curve: a play on each of turns one to four, and spells castable on time with this many mana cards.
    const playChance = (t: number) => {
      const lo = t === 1 ? 1 : t - 1;
      let k = 0;
      for (const l of spells) if (l.f.mv >= lo && l.f.mv <= t && l.f.mv > 0) k += l.qty;
      if (t === 1) for (const l of spells) if (l.f.mv === 0) k += l.qty;
      return hyperAtLeast(N, k, seenBy(t), 1);
    };
    const plays = [1, 2, 3, 4].map(playChance);
    let onTime = 0;
    for (const l of spells) onTime += l.qty * hyperAtLeast(N, M, seenBy(Math.max(1, l.f.mv)), Math.max(1, Math.ceil(l.f.mv)));
    const castable = spellQty ? onTime / spellQty : 0;
    const mean = mvs.length ? mvs.reduce((a, b) => a + b, 0) / mvs.length : 0;
    const playScore = (0.5 * plays[0] + plays[1] + plays[2] + plays[3]) / 3.5;
    parts.push(
      part(
        'curve',
        'Curve',
        spellQty ? 0.6 * clamp01((playScore - 0.4) / 0.5) + 0.4 * clamp01((castable - 0.3) / 0.5) : 0,
        spellQty ? `A play on turns 1–4: ${plays.map(pct).join(', ')}; mean mana value ${mean.toFixed(1)} on ${landQty} lands` : 'No spells',
      ),
    );

    // cards: draw, tutors, cantrips, looting and selection, cheap ones worth more.
    const count = (role: Role) => lines.filter((l) => l.f.roles.has(role)).reduce((n, l) => n + l.qty, 0);
    const draws = count('drawMany') + count('tutor');
    parts.push(
      part(
        'cards',
        'Card advantage',
        saturating(ctx.cardPoints, CARDS_TARGET),
        `${draws} that draw or search, ${count('drawOne')} cantrips, ${count('loot') + count('select')} that loot or look ahead`,
      ),
    );

    // interaction: a sweeper is worth less the more of the deck is creatures it would also sweep.
    const creatureQty = spells.filter((l) => l.f.isCreature).reduce((n, l) => n + l.qty, 0);
    const creatureShare = spellQty ? creatureQty / spellQty : 0;
    let interaction = 0;
    for (const l of lines) {
      const r = l.f.roles;
      const onlySweeper = r.has('sweeper') && !r.has('removal') && !r.has('counter');
      interaction += l.qty * (onlySweeper ? l.f.interactionPoints * (1 - creatureShare) : l.f.interactionPoints);
    }
    const removal = count('removal');
    const counters = count('counter');
    const sweepers = count('sweeper');
    const otherInt = lines.filter((l) => !l.f.roles.has('removal') && !l.f.roles.has('counter') && !l.f.roles.has('sweeper') && (l.f.roles.has('bounce') || l.f.roles.has('discard'))).reduce((n, l) => n + l.qty, 0);
    parts.push(
      part(
        'interaction',
        'Interaction',
        saturating(interaction, INTERACTION_TARGET),
        `${removal} removal, ${counters} counterspells, ${sweepers} sweepers, ${otherInt} bounce or discard`,
      ),
    );

    // threats: how many, and how good the best eight copies are (a threat value of 1.5 is full marks).
    const threats = lines.filter((l) => l.f.threat > 0);
    const threatQty = threats.reduce((n, l) => n + l.qty, 0);
    const vals: number[] = [];
    for (const l of threats) for (let i = 0; i < l.qty; i++) vals.push(l.f.threat);
    vals.sort((a, b) => b - a);
    const best8 = vals.slice(0, 8);
    const quality = best8.length ? best8.reduce((a, b) => a + b, 0) / 8 : 0;
    const bestLine = threats.slice().sort((a, b) => b.f.threat - a.f.threat)[0];
    parts.push(
      part(
        'threats',
        'Threats',
        0.4 * saturating(ctx.threatPoints, THREAT_TARGET) + 0.6 * Math.min(1, quality / 1.5),
        bestLine
          ? `${threatQty} creatures and planeswalkers; best ${bestLine.card.name}${bestLine.f.isCreature ? ` (${bestLine.f.power} power for ${bestLine.f.mv}${bestLine.f.evasive ? ', evasive' : ''})` : ''}`
          : 'No creatures or planeswalkers',
      ),
    );

    // synergy: cards that ask for something find enough of it, and the spells share a theme.
    let condQty = 0;
    let met = 0;
    const dead: string[] = [];
    for (const l of lines) {
      if (!l.f.needs.size) continue;
      const s = support(l.f.needs, ctx, l);
      const sat = Math.min(1, s / SYNERGY_SUPPORT);
      condQty += l.qty;
      met += sat * l.qty;
      if (sat < 0.5) dead.push(l.card.name);
    }
    // Cohesion: the biggest share of the spells that share one theme tag (a creature type, a mechanic, a keyword,
    // artifacts or enchantments); full marks at 40%.
    let theme = '';
    let themeQty = 0;
    for (const [t, n] of ctx.provided) {
      if (!THEME_TAG.test(t) || n <= themeQty) continue;
      theme = t;
      themeQty = n;
    }
    const cohesion = spellQty ? Math.min(1, themeQty / spellQty / 0.4) : 0;
    const payoffs = condQty ? met / condQty : 1;
    parts.push(
      part(
        'synergy',
        'Synergy',
        0.7 * payoffs + 0.3 * cohesion,
        (dead.length
          ? `Too little in the deck for ${dead.slice(0, 3).join(', ')}${dead.length > 3 ? '…' : ''}`
          : condQty
            ? `${condQty} cards find what they ask for`
            : 'No cards that ask for a type or mechanic') + (theme ? `; ${themeQty} share ${themeLabel(theme)}` : ''),
      ),
    );

    // focus: few colours unless the mana supports more, and copies rather than one-ofs.
    const colourCount = ctx.colours.size;
    const baseFocus = colourCount <= 2 ? 1 : colourCount === 3 ? 0.75 : colourCount === 4 ? 0.45 : 0.25;
    const colourScore = parts.find((p) => p.id === 'colours')!.score;
    const colourFocus = baseFocus + (1 - baseFocus) * (colourCount > 2 ? 0.6 * colourScore : 0);
    let sets = 0;
    let setW = 0;
    for (const l of spells) {
      const n = byName.get(l.f.key) ?? l.qty;
      sets += l.qty * Math.min(1, n / (l.f.legendary || l.f.isPlaneswalker ? 2 : 3));
      setW += l.qty;
    }
    const playsets = setW ? sets / setW : 0;
    // One-ofs beyond two (legends excepted) each cost a tenth: a deck of singles draws a different hand every game.
    const singles = spells.filter((l) => (byName.get(l.f.key) ?? 0) === 1 && !l.f.legendary).length;
    const consistency = clamp01((playsets - 0.4) / 0.5) - 0.1 * Math.max(0, singles - 2);
    parts.push(
      part(
        'focus',
        'Focus',
        spellQty ? 0.4 * colourFocus + 0.6 * clamp01(consistency) : 0,
        !spellQty ? 'No spells' : `${colourCount} colour${colourCount === 1 ? '' : 's'}; ${new Set(spells.map((l) => l.f.key)).size} different spells, ${singles} one-ofs`,
      ),
    );

    const totalScore = parts.reduce((s, p) => s + p.score * p.weight, 0);
    return { total: Math.round(totalScore * 10) / 10, parts, issues };
  }

  function pool(options: BuildOptions): CatalogCard[] {
    const out: CatalogCard[] = [];
    for (const printings of index.cardsByName.values()) {
      const first = printings[0];
      if (!first || first.cat === 'Other') continue;
      if (!legalIn(first, options.format)) continue;
      if (options.avoid?.has(first.name)) continue;
      // Every owned printing when the player's cards count (a deck from "Only my cards" may hold no more of a printing
      // than is owned), else one printing per name, the newest (every Magic printing has a picture through its Scryfall id).
      const owned = options.source === 'catalog' ? [] : printings.filter((c) => (options.collection.get(c.id)?.qty ?? 0) > 0);
      if (owned.length) out.push(...owned);
      else if (options.source !== 'collection') out.push(printings.find((c) => c.sid) ?? first);
    }
    return out;
  }

  const poolNames = new WeakMap<readonly CatalogCard[], Map<string, CatalogCard>>();
  function requirements(card: CatalogCard, cards: readonly DeckCard[], candidates: readonly CatalogCard[]): CatalogCard[] {
    const f = featuresOf(card);
    if (!f.partners.length) return [];
    let byName = poolNames.get(candidates);
    if (!byName) poolNames.set(candidates, (byName = new Map(candidates.map((c) => [normalizeText(c.name), c]))));
    const have = new Set<string>();
    for (const c of cards) {
      const k = index.cardsById.get(c.cardId);
      if (k) have.add(normalizeText(k.name));
    }
    const out: CatalogCard[] = [];
    for (const p of f.partners) {
      if (have.has(p)) continue;
      const c = byName.get(p);
      if (c && c.id !== card.id) out.push(c);
    }
    return out;
  }

  /** The features of a candidate list, looked up once per list (the builder passes the same pool every round). */
  const featureLists = new WeakMap<readonly CatalogCard[], MtgFeatures[]>();
  function featuresFor(candidates: readonly CatalogCard[]): MtgFeatures[] {
    let l = featureLists.get(candidates);
    if (!l || l.length !== candidates.length) featureLists.set(candidates, (l = candidates.map(featuresOf)));
    return l;
  }

  function kindOf(card: CatalogCard): 'pokemon' | 'trainer' | 'energy' {
    return card.cat === 'Creature' || card.cat === 'Planeswalker' ? 'pokemon' : card.cat === 'Land' ? 'energy' : 'trainer';
  }

  function relevance(cards: readonly DeckCard[], candidates: readonly CatalogCard[]): number[] {
    const ctx = contextOf(cards);
    if (!ctx.lines.length) return keepTop(featuresFor(candidates).map((f) => 0.1 + 0.9 * f.quality), candidates);
    // Everything about the deck once; per candidate only lookups (the pool can hold 33k cards).
    const deckMask = maskOf(ctx.colours);
    const deckColourCount = bits(deckMask);
    let basicMask = 0;
    for (const l of ctx.lines) if (l.f.isBasic) basicMask |= maskOf(l.f.produces);
    const lowInteraction = ctx.interaction < INTERACTION_TARGET;
    const lowCards = ctx.cardPoints < CARDS_TARGET;
    const lowThreats = ctx.threatPoints < THREAT_TARGET;
    const anyType = ctx.needed.size > 0 && [...ctx.needed.keys()].some((t) => t.startsWith('type:'));
    const feats = featuresFor(candidates);
    const out = new Array<number>(candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      const f = feats[i];
      if (ctx.byName.has(f.key)) {
        out[i] = Math.min(1, 0.85 + 0.15 * f.quality);
        continue;
      }
      if (f.isLand) {
        if (!deckMask) {
          out[i] = f.isBasic ? 0.5 : 0.2;
          continue;
        }
        const makes = f.produces === '*' ? basicMask : maskOf(f.produces);
        const covered = bits(makes & deckMask);
        const extra = bits(makes & ~deckMask);
        out[i] = !covered
          ? f.produces.includes('C') && !f.tapped
            ? 0.15
            : 0.03
          : Math.min(1, 0.55 + 0.35 * (covered / deckColourCount) + (f.isBasic ? 0.05 : 0) - (f.tapped ? 0.1 : 0) - 0.1 * extra);
        continue;
      }
      let r = 0.1 + 0.3 * f.quality;
      if (!f.colourMask) r += 0.2;
      else if (!(f.colourMask & ~deckMask)) r += 0.3;
      else r *= deckColourCount >= 2 ? 0.15 : 0.4;
      let feeds = false;
      let typed = false;
      for (const t of f.provideList) {
        if (ctx.needed.has(t) || (t === 'type:*' && anyType)) feeds = true;
        if (!typed && t.startsWith('type:') && (ctx.provided.get(t) ?? 0) >= 4) typed = true;
      }
      if (feeds) r += 0.25;
      if (typed) r += 0.1;
      for (const t of f.needList)
        if ((ctx.provided.get(t) ?? 0) >= 4) {
          r += 0.2;
          break;
        }
      if (lowInteraction && f.interactionPoints > 0) r += 0.1;
      if (lowCards && f.cardPoints > 0) r += 0.08;
      if (lowThreats && f.threat > 0.8) r += 0.1;
      out[i] = Math.min(1, r);
    }
    return keepTop(out, candidates);
  }

  /**
   * Zero all but about RELEVANT_PER_KIND of each kind of card (by a histogram,
   * no sort): the builder scores a few dozen per kind and skips zeros, so a
   * 33k-card pool need not be ranked whole every round.
   */
  function keepTop(rel: number[], candidates: readonly CatalogCard[]): number[] {
    if (rel.length <= 3 * RELEVANT_PER_KIND) return rel;
    const BINS = 200;
    const kinds = featuresFor(candidates).map((f) => f.kind);
    const hist = new Map<string, Int32Array>();
    for (let i = 0; i < rel.length; i++) {
      let h = hist.get(kinds[i]);
      if (!h) hist.set(kinds[i], (h = new Int32Array(BINS + 1)));
      h[Math.round(rel[i] * BINS)]++;
    }
    const cut = new Map<string, number>();
    for (const [k, h] of hist) {
      let n = 0;
      let b = BINS;
      for (; b > 0; b--) {
        n += h[b];
        if (n >= RELEVANT_PER_KIND) break;
      }
      cut.set(k, b);
    }
    for (let i = 0; i < rel.length; i++) if (Math.round(rel[i] * BINS) < cut.get(kinds[i])!) rel[i] = 0;
    return rel;
  }

  const ev: MtgEvaluator = {
    game: 'mtg',
    format,
    rules,
    formats: MTG_FORMATS,
    card: (id) => index.cardsById.get(id),
    score,
    pool,
    requirements,
    kindOf,
    relevance,
    features: featuresOf,
    legalIn,
    withFormat: (f) => (f === format ? ev : createMtgEvaluator({ index, text, format: f })),
  };
  return ev;
}

/**
 * Seeds picked by rule, not by taste, for benchmarks and tests: per colour
 * (white, blue, black, red, green, then multicoloured), the creatures of the
 * pool with the highest threat value (ties to the lower id), `perColour` of
 * each.
 */
export function mtgSeeds(ev: MtgEvaluator, pool: readonly CatalogCard[], perColour = 2): CatalogCard[] {
  const groups = new Map<string, { card: CatalogCard; threat: number }[]>();
  for (const card of pool) {
    const f = ev.features(card);
    if (!f.isCreature || !f.colours) continue;
    const g = f.colours.length > 1 ? 'multi' : f.colours;
    let list = groups.get(g);
    if (!list) groups.set(g, (list = []));
    list.push({ card, threat: f.threat });
  }
  const out: CatalogCard[] = [];
  for (const g of ['W', 'U', 'B', 'R', 'G', 'multi']) {
    // Many creatures reach the threat cap; among them, more power per mana first, then the lower id.
    const ratio = (c: CatalogCard) => ev.features(c).power / Math.max(1, ev.features(c).mv);
    const list = (groups.get(g) ?? []).sort((a, b) => b.threat - a.threat || ratio(b.card) - ratio(a.card) || (a.card.id < b.card.id ? -1 : 1));
    out.push(...list.slice(0, perColour).map((x) => x.card));
  }
  return out;
}
