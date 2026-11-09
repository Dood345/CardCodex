/**
 * Reads what a card does from its rules text, for the playtest pilot. The
 * evaluator's features say which roles a card plays (draw, search, …); the
 * pilot also needs the amounts (how many cards, what kind, where they go),
 * so this file reads them from the same text (`features(card).text`).
 * Everything here runs once per deck, never inside a game.
 *
 * What is read: drawing (a number, until a hand size, discard-and-draw,
 * shuffle-hand-and-draw, Iono-style hand to the bottom), deck search by kind
 * (Pokémon with stage/type/HP limits, Trainer subtypes, Energy, any card) to
 * the hand, the Bench or attached, attaching Energy from the hand or discard
 * pile, getting Energy back from the discard pile, switching the Active
 * Pokémon, Rare Candy, a discard cost ("only if you discard 2 other cards"),
 * one coin flip ("Flip a coin. If heads, …"), and for Abilities when they
 * trigger. Anything else leaves the card unread; the report counts those.
 */
import { COST_LETTERS } from '../card-text';

export type CardFilter =
  | { k: 'any' }
  | { k: 'pokemon'; basic?: boolean; evolution?: boolean; stage?: number; type?: string; hpMax?: number; suffix?: string }
  | { k: 'trainer'; tt?: string }
  | { k: 'energy'; basic?: boolean; type?: string };

export interface AttachTarget {
  where: 'any' | 'bench' | 'active' | 'self';
  /** Only Pokémon of this type letter. */
  type?: string;
}

export type Effect =
  | { k: 'draw'; n: number }
  | { k: 'drawUntil'; n: number }
  | { k: 'discardHandDraw'; n: number }
  /** Hand shuffled into the deck (or put on its bottom), then draw n; n = -1: one per remaining Prize card. */
  | { k: 'shuffleHandDraw'; n: number; bottom: boolean }
  | { k: 'search'; n: number; f: CardFilter; to: 'hand' | 'bench' | 'attach'; target?: AttachTarget }
  | { k: 'attach'; n: number; from: 'discard' | 'hand'; f: CardFilter; target: AttachTarget }
  | { k: 'recover'; n: number; f: CardFilter }
  | { k: 'switch' }
  | { k: 'rareCandy' };

export interface ParsedText {
  effects: Effect[];
  /** Cards to discard from the hand to play it. */
  discardCost: number;
  /** 0.5 when the effect hangs on one coin flip. */
  chance: number;
  /** "your turn ends". */
  endsTurn: boolean;
  /** Why nothing could be read, when `effects` is empty. */
  unread: string;
}

const TYPE_NAMES = Object.keys(COST_LETTERS).filter((t) => t !== 'Colorless');
const TYPE_ALT = TYPE_NAMES.join('|');
const WORD_N: Record<string, number> = { a: 1, an: 1, one: 1, another: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

function countOf(s: string): number {
  const m = /(?:up to |any )?(\d+|a|an|one|two|three|four|five|six|seven|eight|another)\b/i.exec(s);
  if (!m) return 1;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : (WORD_N[m[1].toLowerCase()] ?? 1);
}

/** "{R}" → "Fire", so one set of patterns reads both spellings. */
export function normalizeEnergySymbols(t: string): string {
  return t.replace(/\{([A-Z])\}/g, (_, l: string) => TYPE_NAMES.find((n) => COST_LETTERS[n] === l) ?? l);
}

const RE_TYPE_WORD = new RegExp(`\\b(${TYPE_ALT})\\b`);

/** What a search clause asks for: "up to 2 Basic Pokémon with 70 HP or less", "an Item card", "a card". */
export function parseFilter(clause: string): CardFilter | null {
  const c = clause.trim();
  const typeM = RE_TYPE_WORD.exec(c);
  const type = typeM ? COST_LETTERS[typeM[1]] : undefined;
  if (/\bEnergy\b/.test(c)) return { k: 'energy', basic: /\bBasic\b/.test(c) || undefined, type };
  if (/\bSupporter\b/.test(c)) return { k: 'trainer', tt: 'Supporter' };
  if (/\bPokémon Tool\b/.test(c)) return { k: 'trainer', tt: 'Tool' };
  if (/\bItem\b/.test(c)) return { k: 'trainer', tt: 'Item' };
  if (/\bStadium\b/.test(c)) return { k: 'trainer', tt: 'Stadium' };
  if (/\bTrainer\b/.test(c)) return { k: 'trainer' };
  if (/that evolves from|of the same name|in play/i.test(c)) return null;
  if (/\bPokémon\b|\bEvolution cards?\b/.test(c)) {
    const hp = /with (\d+) HP or less/.exec(c);
    const stage = /\bStage (1|2)\b/.exec(c);
    const suffix = /Pokémon[- ](ex|V|VMAX|VSTAR|GX|EX)\b/.exec(c);
    return {
      k: 'pokemon',
      basic: /\bBasic\b/.test(c) || undefined,
      evolution: /\bEvolution\b/.test(c) || undefined,
      stage: stage ? Number(stage[1]) : undefined,
      type,
      hpMax: hp ? Number(hp[1]) : undefined,
      suffix: suffix?.[1],
    };
  }
  if (/^(?:up to \d+ |any \d+ |\d+ |a |an )?cards?$/i.test(c)) return { k: 'any' };
  return null;
}

function parseTarget(clause: string): AttachTarget {
  const c = clause.trim();
  const typeM = new RegExp(`\\b(${TYPE_ALT}) Pokémon`).exec(c);
  const type = typeM ? COST_LETTERS[typeM[1]] : undefined;
  if (/^this Pokémon/i.test(c)) return { where: 'self' };
  if (/^(?:your|their) Active Pokémon/i.test(c)) return { where: 'active', type };
  if (/Benched/i.test(c)) return { where: 'bench', type };
  return { where: 'any', type };
}

const RE_PRIZE_DRAW = /(shuffles?|puts?) (?:it|them|their hand|your hand)(?: and puts? it)? (?:into (?:their|your) deck|on the bottom of (?:their|your) deck)[^]*?draws? a card for each of (?:their|your) remaining Prize cards/i;
const RE_BOTTOM_DRAW = /(?:shuffles?|puts?) (?:their|your) hand (?:and puts? it )?on the bottom of (?:their|your) deck[^]*?\byou draw (\d+) cards/i;
const RE_SHUFFLE_DRAW = /shuffles? (?:their|your) hand into (?:their|your) deck[^.]*?(?:\. Then,? | and )(?:you )?draws? (\d+) cards/i;
const RE_DISCARD_DRAW = /discard your hand and draw (\d+) cards/i;
const RE_DRAW_UNTIL = /draw cards until you have (\d+) cards in your hand/i;
const RE_DRAW = /(^|[^a-z])(opponent )?draws? (up to )?(\d+|a|an|one|two|three|four|five|six|seven) cards?\b/gi;
const RE_SEARCH = /search your deck for ([^.]*?)(?:,? (?:reveal|show) (?:it|them)(?: to your opponent)?,?)? and (put (?:it|them) (?:into your hand|onto your Bench)|attach (?:it|them) to ([^.]*))/gi;
const RE_ATTACH = /attach (a|an|\d+|up to \d+) ((?:Basic )?(?:[A-Z][a-z]+ )?)Energy cards? from (?:your|their) (discard pile|hand) to ([^.]*)/gi;
const RE_RECOVER = /put (a|an|\d+|up to \d+) ((?:Basic )?(?:[A-Z][a-z]+ )?)Energy cards? from your discard pile into your hand/i;
const RE_SWITCH = /switch your Active Pokémon with 1 of your Benched Pokémon|switch this Pokémon with 1 of your Benched Pokémon/i;
const RE_COST = /only if you discard (another|\d+ other|a|an) cards? from your hand/i;
const RE_CONDITION = /\bonly if\b|\bcan't use this card unless\b/i;

/** Read one text (a Trainer's effect, an Ability, an attack's effect). */
export function parseText(raw: string): ParsedText {
  const t = normalizeEnergySymbols(raw);
  const out: ParsedText = { effects: [], discardCost: 0, chance: 1, endsTurn: /your turn ends/i.test(t), unread: '' };
  if (!t.trim()) return { ...out, unread: 'no text' };
  if (/Flip (?:\d+|two|three) coins|until you get tails|for each heads/i.test(t)) return { ...out, unread: 'coin flips' };
  if (/^Flip a coin\. If heads,/i.test(t)) out.chance = 0.5;
  else if (/Flip a coin/i.test(t)) return { ...out, unread: 'coin flips' };
  const cost = RE_COST.exec(t);
  if (cost) out.discardCost = cost[1] === 'another' || cost[1] === 'a' || cost[1] === 'an' ? 1 : countOf(cost[1]);
  const rest = cost ? t.replace(RE_COST, '') : t;
  if (RE_CONDITION.test(rest)) return { ...out, unread: 'condition' };

  const ef: { at: number; e: Effect }[] = [];
  let drew = false;
  let m: RegExpExecArray | null;
  if ((m = RE_PRIZE_DRAW.exec(t))) {
    ef.push({ at: m.index, e: { k: 'shuffleHandDraw', n: -1, bottom: /bottom/.test(m[0]) } });
    drew = true;
  } else if ((m = RE_BOTTOM_DRAW.exec(t))) {
    ef.push({ at: m.index, e: { k: 'shuffleHandDraw', n: Number(m[1]), bottom: true } });
    drew = true;
  } else if ((m = RE_SHUFFLE_DRAW.exec(t))) {
    ef.push({ at: m.index, e: { k: 'shuffleHandDraw', n: Number(m[1]), bottom: false } });
    drew = true;
  } else if ((m = RE_DISCARD_DRAW.exec(t))) {
    ef.push({ at: m.index, e: { k: 'discardHandDraw', n: Number(m[1]) } });
    drew = true;
  } else if ((m = RE_DRAW_UNTIL.exec(t))) {
    ef.push({ at: m.index, e: { k: 'drawUntil', n: Number(m[1]) } });
    drew = true;
  }
  if (!drew) {
    for (const d of t.matchAll(RE_DRAW)) {
      if (d[2]) continue; // the opponent draws
      ef.push({ at: d.index ?? 0, e: { k: 'draw', n: countOf(d[4]) } });
    }
  }
  for (const s of t.matchAll(RE_SEARCH)) {
    const to = /^attach/.test(s[2]) ? 'attach' : /Bench/.test(s[2]) ? 'bench' : 'hand';
    // "an Item card and a Pokémon Tool card": two searches.
    const parts = s[1].split(/,? and (?=(?:a|an|up to \d+|\d+) )/);
    for (const p of parts) {
      const f = parseFilter(p);
      if (!f) continue;
      ef.push({ at: s.index ?? 0, e: { k: 'search', n: countOf(p), f, to, target: to === 'attach' ? parseTarget(s[3] ?? '') : undefined } });
    }
  }
  for (const a of t.matchAll(RE_ATTACH)) {
    const f = parseFilter(`${a[2]}Energy`) ?? { k: 'energy' };
    ef.push({ at: a.index ?? 0, e: { k: 'attach', n: countOf(a[1]), from: a[3] === 'hand' ? 'hand' : 'discard', f, target: parseTarget(a[4]) } });
  }
  if ((m = RE_RECOVER.exec(t))) ef.push({ at: m.index, e: { k: 'recover', n: countOf(m[1]), f: parseFilter(`${m[2]}Energy`) ?? { k: 'energy' } } });
  if ((m = RE_SWITCH.exec(t))) ef.push({ at: m.index, e: { k: 'switch' } });
  if ((m = /skipping the Stage 1/i.exec(t))) ef.push({ at: m.index, e: { k: 'rareCandy' } });
  ef.sort((a, b) => a.at - b.at);
  out.effects = ef.map((x) => x.e);
  if (!out.effects.length) out.unread = 'other';
  return out;
}

export type AbilityTrigger = 'evolve' | 'bench' | 'turn' | 'repeat' | 'passive';

export interface ParsedAbility {
  name: string;
  trigger: AbilityTrigger;
  /** Usable only while this Pokémon is Active. */
  activeOnly: boolean;
  /** "You can't use more than 1 Quick Search Ability each turn." */
  limitName: string;
  /** A VSTAR Power: once per game for all of a player's VSTAR Powers. */
  vstar: boolean;
  fx: ParsedText;
}

export function parseAbility(kind: string, name: string, text: string): ParsedAbility {
  const trigger: AbilityTrigger = /When you play this Pokémon from your hand to evolve/i.test(text)
    ? 'evolve'
    : /When you play this Pokémon from your hand onto your Bench/i.test(text)
      ? 'bench'
      : /As often as you like during your turn/i.test(text)
        ? 'repeat'
        : /Once during your turn|during your turn, you may/i.test(text)
          ? 'turn'
          : 'passive';
  const limit = /You can't use more than 1 (.+?) Ability each turn/i.exec(text);
  const body = text
    .replace(/^.*?(?:When you play this Pokémon from your hand (?:to evolve 1 of your Pokémon|onto your Bench) during your turn, |Once during your turn(?: \(before your attack\))?, |As often as you like during your turn(?: \(before your attack\))?, )/i, '')
    .replace(/You can't use more than 1 .+? Ability each turn\.?/i, '')
    .replace(/\(You can't use more than 1 VSTAR Power in a game\.\)/i, '');
  return {
    name,
    trigger,
    activeOnly: /If this Pokémon is in the Active Spot/i.test(text),
    limitName: limit ? limit[1] : '',
    vstar: /VSTAR/i.test(kind) || /VSTAR Power in a game/i.test(text),
    fx: trigger === 'passive' ? { effects: [], discardCost: 0, chance: 1, endsTurn: false, unread: 'passive' } : parseText(body.replace(/^you may /i, '')),
  };
}
