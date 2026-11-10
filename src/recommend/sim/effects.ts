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
 * Pokémon, Rare Candy, looking at the top cards of the deck for a kind of card
 * (Great Ball, Pokégear 3.0, Bill's Transfer), searching for cards to put on
 * top of the deck, a discard cost ("only if you discard 2 other cards"),
 * one coin flip ("Flip a coin. If heads, …"), and for Abilities when they
 * trigger. Anything else leaves the card unread; the report counts those.
 *
 * Every text is also accounted for sentence by sentence (`sentences`): a
 * sentence is `read` when an effect the engine applies was taken from it and
 * nothing in it was skipped (no condition, no "for each", no clause about the
 * opponent, no word in a search clause the filter does not model), `noop`
 * when it is on the NOOP list below (a sentence that changes nothing in the
 * engine, each with its reason), and `unread` otherwise. A text is `followed`
 * only when no sentence is unread. That is the number the benchmark tracks
 * (coverage.ts): a pattern that matched is not the same as a text obeyed.
 */
import { COST_LETTERS } from '../card-text';
import type { Cond, DamageMod, PokeTest, SpecialCondition, StaticEffect } from './damage';
import { parseCond, parseDamageMods, parsePokeTest, parseStatic } from './damage-text';

export type CardFilter = (
  | { k: 'any' }
  | { k: 'pokemon'; basic?: boolean; evolution?: boolean; stage?: number; type?: string; hpMax?: number; suffix?: string }
  | { k: 'trainer'; tt?: string }
  | { k: 'energy'; basic?: boolean; type?: string }
) & {
  /** Words of the clause the filter does not model ("Tera Pokémon"); the search is wider than the card says. */
  vague?: string;
  /** "that doesn't have a Rule Box": no ex, V, VMAX, VSTAR, GX, EX, Radiant or Mega Pokémon. */
  ruleBox?: false;
  /** An owner's card ("Team Rocket's Pokémon", "Ethan's Pokémon"): the name starts with it. */
  owner?: string;
  /** "that has "Team Rocket" in its name". */
  nameHas?: string;
};

export interface AttachTarget {
  where: 'any' | 'bench' | 'active' | 'self';
  /** Only Pokémon of this type letter. */
  type?: string;
}

/** "If you have exactly 6 Prize cards remaining, draw 8 cards instead." */
export interface DrawAlt {
  if: Cond;
  n: number;
}

export type Effect = {
  /** Only when this holds (a `did`: the effect before it in the same text did something). */
  if?: Cond;
} & (
  | { k: 'draw'; n: number; alt?: DrawAlt }
  | { k: 'drawUntil'; n: number; alt?: DrawAlt }
  | { k: 'discardHandDraw'; n: number }
  /**
   * Hand shuffled into the deck (or put on its bottom), then draw n; n = -1: one per remaining Prize card.
   * `both`: the opponent does the same (Judge, Iono), drawing `oppN` when it differs (Unfair Stamp).
   */
  | { k: 'shuffleHandDraw'; n: number; bottom: boolean; alt?: DrawAlt; both?: boolean; oppN?: number }
  /**
   * `top`: only the top cards of the deck are looked at (Great Ball: the top 7), and the rest is shuffled back
   * (`discardRest`: discarded). `alts`: other kinds the card may take instead ("a Basic Fighting Energy card or a
   * Basic Fighting Pokémon"). `distinctTypes`: Energy of different types. `distinctFrom`: not the type the
   * effect at that index fetched (Crispin).
   */
  | { k: 'search'; n: number; f: CardFilter; to: 'hand' | 'bench' | 'attach'; target?: AttachTarget; top?: number; alts?: CardFilter[]; discardRest?: boolean; distinctTypes?: boolean; distinctFrom?: number }
  /** Search the deck for n cards and put them on top of it (Ciphermaniac's Codebreaking). */
  | { k: 'stack'; n: number }
  | { k: 'attach'; n: number; from: 'discard' | 'hand'; f: CardFilter; target: AttachTarget }
  /** From the discard pile into the hand: n cards of the filter or any of `alts` ("a Pokémon or a Basic Energy card"). */
  | { k: 'recover'; n: number; f: CardFilter; alts?: CardFilter[] }
  /** From the discard pile into the deck (Super Rod, Energy Recycler). */
  | { k: 'recoverToDeck'; n: number; f: CardFilter; alts?: CardFilter[] }
  /** Energy moved between the player's Pokémon (Energy Switch, N's Plan). */
  | { k: 'moveEnergy'; n: number; basic?: boolean; from: 'any' | 'bench'; to: 'any' | 'active' }
  /** Discard up to `max` cards of the filter from the hand and draw `per` for each (Gwynn). */
  | { k: 'discardDraw'; max: number; f: CardFilter; per: number }
  /** Heal n damage (or all) from one Pokémon, the Active, or each; the target may need Energy attached or little HP left. */
  | { k: 'heal'; n: number; all?: boolean; target: 'any' | 'active' | 'each' | 'that'; minEnergy?: number; maxHpLeft?: number }
  | { k: 'switch' }
  | { k: 'rareCandy' }
  /* Attack costs and own-side effects (damage-text.ts), run by the engine around the attack's damage. */
  /** Discard Energy from the attacker: n of them (or all), of a type or kind; optional when `may`. */
  | { k: 'discardSelfEnergy'; n: number; all?: boolean; type?: string; basic?: boolean; special?: boolean; may?: boolean }
  /** Discard any amount of Energy from any of your Pokémon; the pilot picks the count (engine.ts). */
  | { k: 'discardAnyEnergy'; type?: string; basic?: boolean; special?: boolean }
  | { k: 'energyToHand'; n: number; type?: string; may?: boolean }
  | { k: 'energyToDeck'; n: number; all?: boolean; may?: boolean }
  /** Damage to the attacker itself, after its damage; `ifPaid`: only when the optional cost before it was paid. */
  | { k: 'selfDamage'; n: number; ifPaid?: boolean }
  | { k: 'benchDamageOwn'; n: number; each: boolean }
  /** The attacker and everything attached go back to the hand. */
  | { k: 'selfToHand' }
  | { k: 'millSelf'; n: number }
  | { k: 'discardHand'; n: number; may?: boolean }
  /** Shuffle this Pokémon and everything attached into the deck (Dudunsparce's Run Away Draw). */
  | { k: 'selfToDeck' }
  /** Discard the Stadium in play (Chien-Pao's Snow Sink). */
  | { k: 'discardStadium' }
  /** A Special Energy attached from the hand does something (Enriching Energy draws, Telepathic Psychic Energy searches); `t`: only onto such a Pokémon. */
  | { k: 'onAttach'; t?: PokeTest; effects: Effect[] }
  /* What needs an opponent (duel.ts); in a solo game these do nothing and the card sits idle. */
  /** Switch in one of the opponent's Benched Pokémon: the player chooses (Boss's Orders) or the opponent does ("Switch out … to the Bench"). */
  | { k: 'gust'; by: 'you' | 'opponent' }
  /** Damage to the opponent's Bench: `n` to one, two or each Benched Pokémon, or `n` damage counters spread as the player likes; `any`: any of their Pokémon. */
  | { k: 'benchDamage'; n: number; how: 'one' | 'two' | 'each' | 'counters'; any?: boolean; ifPaid?: boolean }
  | { k: 'condition'; c: SpecialCondition; on: 'opponentActive' | 'self' }
  /** During the opponent's next turn the Defending Pokémon can't retreat or attack, or the opponent can't play Items. */
  | { k: 'lock'; what: 'retreat' | 'attack' | 'items' }
  /** During the opponent's next turn this Pokémon takes no damage (or `less`) from attacks. */
  | { k: 'shield'; less?: number }
  | { k: 'millOpp'; n: number }
  /** The opponent reveals their hand and the player discards `n` cards of the kind from it. */
  | { k: 'discardOppHand'; n: number; f?: CardFilter }
  /** The opponent discards down to `n` cards in hand. */
  | { k: 'oppDiscardTo'; n: number }
  /** The opponent puts their hand on the bottom of their deck and draws `n`. */
  | { k: 'oppHandBottomDraw'; n: number }
  | { k: 'discardOppEnergy'; n: number; special?: boolean; from: 'active' | 'any' }
  /** `n` damage counters on one of the opponent's Pokémon (Cursed Blast). */
  | { k: 'countersOpp'; n: number }
  /** Up to `n` damage counters moved from one of the player's Pokémon to one of the opponent's (Adrena-Brain). */
  | { k: 'moveCounters'; n: number }
  /** "If you use this Ability, this Pokémon is Knocked Out." */
  | { k: 'selfKO' }
);

export type SentenceStatus = 'read' | 'noop' | 'unread';

export interface Sentence {
  text: string;
  status: SentenceStatus;
  /** Why it is unread (a short kind), or the NOOP reason. */
  why: string;
}

export interface ParsedText {
  effects: Effect[];
  /** "You can use this card only if …": the engine plays it only while this holds. */
  cond?: Cond;
  /** "You can't use this card during your first turn." */
  notFirstTurn?: boolean;
  /** "If you go first, you may use this card during your first turn." (a Supporter). */
  firstTurnOk?: boolean;
  /** Cards to discard from the hand to play it; `discardCostF`: of this kind only (Lunatone's Basic Psychic Energy). */
  discardCost: number;
  discardCostF?: CardFilter;
  /** 0.5 when the effect hangs on one coin flip. */
  chance: number;
  /** "your turn ends". */
  endsTurn: boolean;
  /** Attacks: what the text does to the damage (damage.ts), applied by the engine at attack time. */
  mods: DamageMod[];
  /** Tools and Stadiums: what the card does while in play (damage.ts `StaticEffect`). */
  statics?: StaticEffect[];
  /** Why nothing could be read, when `effects` is empty. */
  unread: string;
  /** Every sentence of the text and what became of it. */
  sentences: Sentence[];
  /** No sentence is unread: the engine acts on the whole text. */
  followed: boolean;
}

const TYPE_NAMES = Object.keys(COST_LETTERS).filter((t) => t !== 'Colorless');
const TYPE_ALT = TYPE_NAMES.join('|');
const WORD_N: Record<string, number> = { a: 1, an: 1, one: 1, another: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

function countOf(s: string): number {
  const m = /(?:up to |any )?(\d+|a|an|one|two|three|four|five|six|seven|eight|another)\b/i.exec(s);
  if (!m) return 1;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : (WORD_N[m[1].toLowerCase()] ?? 1);
}

/** "{R}" → "Fire", so one set of patterns reads both spellings; HTML left in a few texts (`<em>`, energy-symbol spans) is dropped. */
export function normalizeEnergySymbols(t: string): string {
  return t
    .replace(/<[^>]+>/g, '')
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\{([A-Z])\}/g, (_, l: string) => Object.keys(COST_LETTERS).find((n) => COST_LETTERS[n] === l) ?? l)
    .trim();
}

const RE_TYPE_WORD = new RegExp(`\\b(${TYPE_ALT})\\b`);

/**
 * Words a search clause may use once the modelled phrases are taken out. Anything else ("that doesn't have a Rule
 * Box", "of different types", "Team Rocket's", "or") makes the filter vague: the engine searches wider than the card.
 */
const KNOWN_FILTER_WORDS = new Set(['a', 'an', 'card', 'cards', 'basic', 'pokémon', 'evolution', 'item', 'supporter', 'tool', 'stadium', 'trainer', 'energy', 'and', ...TYPE_NAMES.map((n) => n.toLowerCase())]);

function vagueWords(clause: string): string {
  const rest = clause
    .replace(/\bwith \d+ HP or less\b/gi, ' ')
    .replace(/\bthat (?:doesn't|don't) have a Rule Box\b/gi, ' ')
    .replace(/\bthat (?:has|have) "[^"]+" in (?:its|their) names?\b/gi, ' ')
    .replace(/\b(?:Team Rocket's|[A-Z][a-z]*'s) (?=Pokémon|Energy|Adventure)/g, ' ')
    .replace(/\bof different types\b/gi, ' ')
    .replace(/\bPokémon[- ](?:ex|V|VMAX|VSTAR|GX|EX)\b/g, 'Pokémon')
    .replace(/\bStage [12]\b/g, ' ')
    .replace(/\b(?:up to|any number of)\b/gi, ' ')
    .replace(/\b\d+\b/g, ' ');
  const out: string[] = [];
  for (const w of rest.split(/[\s,]+/)) {
    if (!w) continue;
    if (KNOWN_FILTER_WORDS.has(w.toLowerCase())) continue;
    out.push(w);
  }
  return out.join(' ');
}

/** What a search clause asks for: "up to 2 Basic Pokémon with 70 HP or less", "an Item card", "a card". */
export function parseFilter(clause: string): CardFilter | null {
  const c = clause.trim();
  const typeM = RE_TYPE_WORD.exec(c);
  const type = typeM ? COST_LETTERS[typeM[1]] : undefined;
  const vague = vagueWords(c) || undefined;
  const f = parseFilterBase(c, type, vague);
  if (!f) return null;
  if (/\bthat (?:doesn't|don't) have a Rule Box\b/i.test(c)) f.ruleBox = false;
  const owner = /\b(Team Rocket's|[A-Z][a-z]*'s) (?=Pokémon|Energy|Adventure)/.exec(c);
  if (owner) f.owner = owner[1];
  const named = /\bthat (?:has|have) "([^"]+)" in (?:its|their) names?\b/i.exec(c);
  if (named) f.nameHas = named[1];
  return f;
}

function parseFilterBase(c: string, type: string | undefined, vague: string | undefined): CardFilter | null {
  if (/\bEnergy\b/.test(c)) return { k: 'energy', basic: /\bBasic\b/.test(c) || undefined, type, vague };
  if (/\bSupporter\b/.test(c)) return { k: 'trainer', tt: 'Supporter', vague };
  if (/\bPokémon Tool\b/.test(c)) return { k: 'trainer', tt: 'Tool', vague: vagueWords(c.replace(/\bPokémon Tool\b/, 'Tool')) || undefined };
  if (/\bItem\b/.test(c)) return { k: 'trainer', tt: 'Item', vague };
  if (/\bStadium\b/.test(c)) return { k: 'trainer', tt: 'Stadium', vague };
  if (/\bTrainer\b/.test(c)) return { k: 'trainer', vague };
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
      vague,
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

/* ---------- sentences ---------- */

const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Lt|Prof|Dr|Jr|St|No|vs|etc)\.$/;

/** The sentences of a text with their character spans; a parenthesis or quote after the full stop stays with the sentence. */
export function splitSentences(t: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    let j = i + 1;
    while (j < t.length && (t[j] === ')' || t[j] === '"' || t[j] === '”')) j++;
    if (j < t.length && !/^\s+[A-Z(•"“]/.test(t.slice(j, j + 4))) continue;
    if (ABBREVIATION.test(t.slice(start, j))) continue;
    const text = t.slice(start, j).trim();
    if (text) out.push({ text, start, end: j });
    start = j;
    i = j - 1;
  }
  const tail = t.slice(start).trim();
  if (tail) out.push({ text: tail, start, end: t.length });
  return out;
}

/**
 * Sentences that change nothing in the engine, each with the reason. A sentence is on this list only when the
 * engine's own behaviour already covers it (a search shuffles the deck; Weakness applies to the Active only) or it
 * is a reminder of a rule (the rule-box note, "Damage is not an effect").
 */
export const NOOP: readonly [RegExp, string][] = [
  [/^Then,? shuffle your deck\.?$/i, 'a search already shuffles the deck'],
  [/^Shuffle your deck afterward\.?$/i, 'a search already shuffles the deck'],
  [/^You (?:can|may) play only one Supporter card each turn\.?$/i, 'the rules already say so (older printings carry the reminder)'],
  [/^Shuffle (?:the other cards|the rest|them)(?: back)? into your deck\.?$/i, 'a look at the top cards already shuffles the rest back'],
  [/^Shuffle the other cards and put them on the bottom of your deck\.?$/i, 'a look at the top cards already shuffles the rest back (bottom or shuffled makes no difference to a pilot that does not count cards)'],
  [/^Put the other cards? on the bottom of your deck\.?$/i, 'a look at the top cards already shuffles the rest back (bottom or shuffled makes no difference to a pilot that does not count cards)'],
  [/^Reveal (?:it|them)\.?$/i, 'revealing a card changes nothing'],
  [/^\(?Pokémon ex, Pokémon V, etc\. have Rule Boxes\.\)?$/i, 'a reminder of the rule-box rule'],
  [/^\(?(?:Existing effects are not removed\.\s*)?Damage is not an effect\.\)?$/i, 'a reminder'],
  [/^\(?Existing effects are not removed\.\)?$/i, 'a reminder'],
  [/^\(?Don't apply Weakness and Resistance for Benched Pokémon\.\)?$/i, 'the engine applies Weakness and Resistance to the Active only'],
  [/^\(?Apply Weakness as ×\d+\.\)?$/i, 'the engine reads the printed Weakness'],
  [/^\(?You still need the necessary Energy to use (?:this|each|that) attack\.\)?$/i, 'the engine pays every attack cost'],
  [/^\(?You can't use more than 1 VSTAR Power in a game\.\)?$/i, 'VSTAR Powers are one per game in the engine'],
  [/^The effect of .+ doesn't stack\.$/i, 'the engine applies an Ability once'],
  [/^\(?This includes new Pokémon that come into play\.\)?$/i, 'a reminder'],
  [/^\(?Your opponent chooses the new Active Pokémon\.\)?$/i, 'the knocked-out or switched-out player promotes in the engine'],
  [/^Your opponent reveals their hand\.?$/i, 'seeing a hand changes nothing for a pilot that does not plan around it'],
  [/^\(?Players can't evolve a Basic Pokémon during their first turn or a Basic Pokémon that was put into play this turn\.\)?$/i, 'the rules already say so'],
  [/^\(?Damage from attacks is still taken\.\)?$/i, 'a reminder'],
];

/**
 * Words that mean a sentence says more than the effect taken from it: a condition, a count, a clause about the
 * opponent, a choice. Such a sentence stays unread until the engine models the rest.
 */
const SKIPPED: readonly [RegExp, string][] = [
  [/\binstead\b/i, 'instead'],
  [/\bfor each\b/i, 'for each'],
  [/\b(?:if|unless|as long as|while|except|otherwise|only)\b/i, 'condition'],
  [/\b(?:your opponent|opponent's|each player|both players|their hand|their deck)\b/i, 'the opponent'],
  [/\bChoose \d+:/i, 'a choice'],
  [/\bin any combination\b/i, 'a combination'],
];

/** What a read sentence still skips, "" when nothing: `lead` is a clause the parse did honour ("If heads, "). */
function skipped(text: string, lead: RegExp | null): string {
  const t = lead ? text.replace(lead, '') : text;
  for (const [re, why] of SKIPPED) if (re.test(t)) return why;
  return '';
}

interface Mark {
  start: number;
  end: number;
  /** An exact reading of the whole clause (a cost, a coin flip, Rare Candy): no SKIPPED check. */
  exact: boolean;
  /** Vague filter words of the effect, if any: the sentence stays unread. */
  vague?: string;
}

function account(t: string, marks: readonly Mark[], chance: number): Sentence[] {
  const out: Sentence[] = [];
  const lead = chance < 1 ? /^If heads, /i : null;
  for (const s of splitSentences(t)) {
    const own = marks.filter((m) => m.start < s.end && m.end > s.start);
    if (own.length) {
      const vague = own.find((m) => m.vague)?.vague;
      if (vague) out.push({ text: s.text, status: 'unread', why: `search wider than "${vague}"` });
      else if (own.every((m) => m.exact)) out.push({ text: s.text, status: 'read', why: '' });
      else {
        // What an exact reading honoured (a condition, a cost) is not what the rest of the sentence skips.
        let rest = '';
        for (let i = s.start; i < s.end; i++) rest += own.some((m) => m.exact && i >= m.start && i < m.end) ? ' ' : t[i];
        const why = skipped(rest.trim(), lead);
        out.push(why ? { text: s.text, status: 'unread', why } : { text: s.text, status: 'read', why: '' });
      }
      continue;
    }
    const noop = NOOP.find(([re]) => re.test(s.text));
    out.push(noop ? { text: s.text, status: 'noop', why: noop[1] } : { text: s.text, status: 'unread', why: '' });
  }
  return out;
}

/** A text accounted for as wholly unread (nothing could be read), with the reason on every sentence. */
function unreadAll(t: string, why: string): Sentence[] {
  return splitSentences(t).map((s) => ({ text: s.text, status: 'unread' as const, why }));
}

/* ---------- Trainer, Ability and attack text ---------- */

const RE_PRIZE_DRAW = /(shuffles?|puts?) (?:it|them|their hand|your hand)(?: and puts? it)? (?:into (?:their|your) deck|on the bottom of (?:their|your) deck)[^]*?draws? a card for each of (?:their|your) remaining Prize cards/i;
const RE_BOTTOM_DRAW = /(?:shuffles?|puts?) (?:their|your) hand (?:and puts? it )?on the bottom of (?:their|your) deck[^]*?\byou draw (\d+) cards/i;
const RE_SHUFFLE_DRAW = /shuffles? (?:their|your) hand into (?:their|your) deck[^.]*?(?:\. Then,? | and )(?:you )?draws? (\d+) cards/i;
const RE_DISCARD_DRAW = /discard your hand and draw (\d+) cards/i;
const RE_DRAW_UNTIL = /draw cards until you have (\d+) cards in your hand/i;
const RE_DRAW = /(^|[^a-z])(opponent )?draws? (up to )?(\d+|a|an|one|two|three|four|five|six|seven) cards?\b/gi;
const RE_SEARCH = /search your deck for ([^.]*?)(?:,? (?:reveal|show) (?:it|them)(?: to your opponent)?,?)? and (put (?:it|them) (?:into your hand|onto your Bench)|attach (?:it|them) to ([^.]*))/gi;
const RE_LOOK = /Look at the top (\d+) cards of your deck(?:\. You may reveal|, reveal|\. Reveal) (a|an|up to \d+|any number of) ([^.]*?) you find there,? and put (?:it|them) into your hand/gi;
const RE_LOOK_ATTACH = /Look at the top (\d+) cards of your deck and attach (a|an|up to \d+|any number of) ([^.]*?) you find there to ([^.]*?)(?: in any way you like)?\./gi;
const RE_DID = /^If you (?:attached (?:any )?Energy to a Pokémon|drew any cards|searched your deck|healed any damage|moved any Energy|put any cards(?: [^,]*)?|did) in this way, (.+)$/i;
const RE_SELF_TO_DECK = /shuffle (?:this Pokémon|it) and all attached cards into your deck/i;
const RE_DISCARD_STADIUM = /^discard a Stadium in play\.?$/i;
const RE_STACK = /Search your deck for (\d+|a|an|up to \d+) cards?, shuffle your deck, then put (?:those cards|that card|it) on top of it/i;
const RE_ATTACH = /attach (a|an|\d+|up to \d+) ((?:Basic )?(?:[A-Z][a-z]+ )?)Energy cards? from (?:your|their) (discard pile|hand) to ([^.]*)/gi;
const RE_RECOVER = /put (a|an|\d+|up to \d+)( in any combination of)? ([^.]*?) from your discard pile into your hand/i;
const RE_RECOVER_DECK = /shuffle (a|an|\d+|up to \d+)( in any combination of)? ([^.]*?) from your discard pile (?:back )?into your deck/i;
const RE_SWITCH = /switch (?:your|1 of your) Active Pokémon with 1 of your Benched Pokémon|switch this Pokémon with 1 of your Benched Pokémon/i;
const RE_MOVE = /move (a|an|\d+|up to \d+) (Basic )?Energy from (1 of your Pokémon|your Benched Pokémon) to (another of your Pokémon|your Active Pokémon|1 of your other Pokémon)/i;
const RE_LOOK_TAKE = /Look at the top (\d+) cards of your deck and put (\d+|up to \d+) of them into your hand\.( Discard the other cards\.)?/i;
const RE_DISCARD_DRAW_PER = /Discard up to (\d+) ([^.]*?) from your hand, and draw (\d+) cards for each card you discarded in this way\./i;
const RE_HEAL = /Heal (\d+|all) damage from (1 of your Pokémon|your Active Pokémon|each of your Pokémon|that Pokémon|your Active Pokémon that has (\d+) or more Energy attached|1 of your Pokémon that has (\d+) HP or less remaining)\./i;
const RE_HEAL_COUNTERS = /Remove (?:up to )?(\d+) damage counters? from 1 of your Pokémon/i;
const RE_CRISPIN = /Search your deck for up to 2 Basic Energy cards of different types, reveal them, and put 1 of them into your hand\. Attach the other to 1 of your Pokémon\./i;
const RE_ALT_DRAW = /If ([^.]+?), draw (\d+) cards instead\./i;
const RE_ALT_DRAW_UNTIL = /If ([^.]+?), draw cards until you have (\d+) cards in your hand instead\./i;
const RE_BOTH_DRAW = /Each player shuffles their hand into their deck and draws (\d+) cards\./i;
const RE_BOTH_THEN = /Each player shuffles their hand into their deck\. Then, you draw (\d+) cards, and your opponent draws (\d+) cards\./i;
const RE_ONLY_IF = /You can use this card only (?:if|when) ([^.]+?)\./i;
const RE_NOT_FIRST = /You can't use this card during your first turn\./i;
const RE_FIRST_OK = /If you go first, you may use this card during your first turn\./i;
/** Sentences that need an opponent, each read whole. */
const OPPONENT_SENTENCES: readonly [RegExp, (m: RegExpExecArray) => Effect | Effect[] | null][] = [
  [/^Switch in 1 of your opponent's Benched Pokémon to the Active Spot\.$/i, () => ({ k: 'gust', by: 'you' })],
  [/^Switch out your opponent's Active Pokémon to the Bench\.$/i, () => ({ k: 'gust', by: 'opponent' })],
  [/^(If you do, )?[Tt]his attack (?:also )?does (\d+) damage to (1|2|each) of your opponent's (Benched )?Pokémon\.$/, (m) => ({ k: 'benchDamage', n: Number(m[2]), how: m[3] === 'each' ? 'each' : m[3] === '2' ? 'two' : 'one', any: m[4] ? undefined : true, ifPaid: m[1] ? true : undefined })],
  [/^(?:Put|Place) (\d+) damage counters on your opponent's Benched Pokémon in any way you like\.$/i, (m) => ({ k: 'benchDamage', n: Number(m[1]), how: 'counters' })],
  [/^(?:Put|Place) (\d+) damage counters on 1 of your opponent's (Benched )?Pokémon\.$/i, (m) => ({ k: 'countersOpp', n: Number(m[1]) * (m[2] ? 1 : 1), ...(m[2] ? {} : {}) })],
  [/^(?:Your opponent's Active Pokémon|The Defending Pokémon) is now (Asleep|Burned|Confused|Paralyzed|Poisoned)(?: and (Asleep|Burned|Confused|Paralyzed|Poisoned))?\.$/, (m) => [{ k: 'condition', c: m[1] as SpecialCondition, on: 'opponentActive' }, ...(m[2] ? [{ k: 'condition' as const, c: m[2] as SpecialCondition, on: 'opponentActive' as const }] : [])]],
  [/^This Pokémon is now (Asleep|Burned|Confused|Paralyzed|Poisoned)\.$/, (m) => ({ k: 'condition', c: m[1] as SpecialCondition, on: 'self' })],
  [/^During your opponent's next turn, (?:the Defending Pokémon|that Pokémon|your opponent's Active Pokémon) can't (retreat|attack|use attacks)\.$|^(?:The Defending Pokémon|That Pokémon) can't (retreat|attack|use attacks) during your opponent's next turn\.$/, (m) => ({ k: 'lock', what: (m[1] ?? m[2]) === 'retreat' ? 'retreat' : 'attack' })],
  [/^During your opponent's next turn, they can't play any Item cards from their hand\.$/, () => ({ k: 'lock', what: 'items' })],
  [/^During your opponent's next turn, prevent all damage (?:from and effects of attacks done to this Pokémon|done to this Pokémon by attacks)\.$/, () => ({ k: 'shield' })],
  [/^During your opponent's next turn, this Pokémon takes (\d+) less damage from attacks(?: \(after applying Weakness and Resistance\))?\.$/, (m) => ({ k: 'shield', less: Number(m[1]) })],
  [/^Discard the top (\d+|card) cards? of your opponent's deck\.$/, (m) => ({ k: 'millOpp', n: m[1] === 'card' ? 1 : Number(m[1]) })],
  [/^Your opponent reveals their hand, and you discard (a|an|\d+|up to \d+) (.+?) you find there\.$/, (m) => ({ k: 'discardOppHand', n: countOf(m[1]), f: /^cards?$/.test(m[2]) ? undefined : (parseFilter(m[2]) ?? undefined) })],
  [/^Your opponent discards cards from their hand until they have (\d+) cards in their hand\.$/, (m) => ({ k: 'oppDiscardTo', n: Number(m[1]) })],
  [/^[Dd]iscard (an?|\d+) (Special )?Energy(?: card)? from (your opponent's Active Pokémon|1 of your opponent's Pokémon|the Defending Pokémon)\.$/, (m) => ({ k: 'discardOppEnergy', n: countOf(m[1]), special: m[2] ? true : undefined, from: /1 of your opponent/.test(m[3]) ? 'any' : 'active' })],
  [/^[Mm]ove up to (\d+) damage counters from 1 of your Pokémon to 1 of your opponent's Pokémon\.$/, (m) => ({ k: 'moveCounters', n: Number(m[1]) })],
  [/^If you use this Ability, this Pokémon is Knocked Out\.$/, () => ({ k: 'selfKO' })],
];

const RE_COST = /only if you discard (another|\d+ other|a|an) cards? from your hand/i;
const RE_ABILITY_COST = /(?:You must |you may )?discard (a|an|\d+) ([^.]*?)(?: cards?)? from your hand in order to use this Ability\.?/i;
const RE_ABILITY_IF = /^if ([^.]+?), (?=you may |you can )/i;
const RE_CONDITION = /\bonly if\b|\bcan't use this card unless\b/i;
const RE_ENDS_TURN = /your turn ends/i;

/**
 * Read one text (a Trainer's effect, an Ability, an attack's effect). In `attack` mode the damage
 * wordings are read first (`parseDamageMods`); the sentences they consume are blanked, positions
 * kept, before the rest of the text is read like any other.
 */
export function parseText(raw: string, mode: 'text' | 'attack' = 'text'): ParsedText {
  const t0 = normalizeEnergySymbols(raw);
  const out: ParsedText = { effects: [], discardCost: 0, chance: 1, endsTurn: RE_ENDS_TURN.test(t0), mods: [], unread: '', sentences: [], followed: false };
  const marks: Mark[] = [];
  let t = t0;
  const ef: { at: number; e: Effect }[] = [];
  if (mode === 'attack' && t0.trim()) {
    const dm = parseDamageMods(splitSentences(t0));
    out.mods = dm.mods;
    ef.push(...dm.effects);
    for (const [start, end] of dm.spans) {
      marks.push({ start, end, exact: true });
      t = t.slice(0, start) + ' '.repeat(end - start) + t.slice(end);
    }
  }
  const fail = (why: string): ParsedText => ({ ...out, unread: why, sentences: unreadAll(t0, why), followed: false });
  if (!t0.trim()) return { ...out, unread: 'no text', sentences: [], followed: true };
  // "If you attached Energy to a Pokémon in this way, draw a card.": the rest of the sentence, on a did-condition.
  for (const s of splitSentences(t)) {
    const dm = RE_DID.exec(s.text);
    if (!dm) continue;
    const inner = parseText(dm[1].charAt(0).toUpperCase() + dm[1].slice(1));
    if (!inner.effects.length || !inner.followed) continue;
    for (const e of inner.effects) ef.push({ at: s.start, e: { ...e, if: { k: 'did' } } });
    marks.push({ start: s.start, end: s.end, exact: true });
    t = t.slice(0, s.start) + ' '.repeat(s.end - s.start) + t.slice(s.end);
  }
  const std = RE_SELF_TO_DECK.exec(t);
  if (std) {
    ef.push({ at: std.index, e: { k: 'selfToDeck' } });
    marks.push({ start: std.index, end: std.index + std[0].length, exact: true });
    t = t.slice(0, std.index) + ' '.repeat(std[0].length) + t.slice(std.index + std[0].length);
  }
  if (RE_DISCARD_STADIUM.test(t.trim())) {
    ef.push({ at: 0, e: { k: 'discardStadium' } });
    marks.push({ start: 0, end: t0.length, exact: true });
    t = ' '.repeat(t.length);
  }
  if (!t.trim() && (out.mods.length || ef.length)) {
    out.effects = ef.sort((a, b) => a.at - b.at).map((x) => x.e);
    out.unread = out.effects.length ? '' : 'damage only';
    out.sentences = account(t0, marks, 1);
    out.followed = out.sentences.every((s) => s.status !== 'unread');
    return out;
  }
  if (/Flip (?:\d+|two|three) coins|until you get tails|for each heads/i.test(t)) return fail('coin flips');
  let m: RegExpExecArray | null;
  if ((m = /^Flip a coin\. If heads,/i.exec(t0)) && /^Flip a coin\./i.test(t)) {
    out.chance = 0.5;
    marks.push({ start: 0, end: 'Flip a coin.'.length, exact: true });
    t = ' '.repeat('Flip a coin.'.length) + t.slice('Flip a coin.'.length);
  } else if (/Flip a coin/i.test(t)) return fail('coin flips');
  const cost = RE_COST.exec(t);
  if (cost) {
    out.discardCost = cost[1] === 'another' || cost[1] === 'a' || cost[1] === 'an' ? 1 : countOf(cost[1]);
    marks.push({ start: cost.index, end: cost.index + cost[0].length, exact: true });
  }
  const abCost = RE_ABILITY_COST.exec(t);
  if (abCost) {
    const f = /^cards?$/.test(abCost[2]) ? { k: 'any' as const } : parseFilter(`${abCost[2]} card`);
    if (f && !f.vague) {
      out.discardCost = countOf(abCost[1]);
      if (f.k !== 'any') out.discardCostF = f;
      marks.push({ start: abCost.index, end: abCost.index + abCost[0].length, exact: true });
    }
  }
  // An Ability's "if …, you may …": the engine uses it only while that holds.
  const abIf = RE_ABILITY_IF.exec(t);
  if (abIf) {
    const c = parseCond(abIf[1]);
    if (c) {
      out.cond = c;
      marks.push({ start: abIf.index, end: abIf.index + abIf[0].length, exact: true });
      t = t.slice(0, abIf.index) + ' '.repeat(abIf[0].length) + t.slice(abIf.index + abIf[0].length);
    }
  }
  // Special Red Card's two sentences read together: the opponent's hand to the bottom, then a draw.
  const red = /Your opponent shuffles their hand and puts it on the bottom of their deck\. If they put any cards on the bottom of their deck in this way, they draw (\d+) cards\./.exec(t);
  if (red) {
    ef.push({ at: red.index, e: { k: 'oppHandBottomDraw', n: Number(red[1]) } });
    marks.push({ start: red.index, end: red.index + red[0].length, exact: true });
    t = t.slice(0, red.index) + ' '.repeat(red[0].length) + t.slice(red.index + red[0].length);
  }
  // Sentences that need an opponent: each one whole, blanked once read.
  for (const s of splitSentences(t)) {
    // The sentence may follow a span already blanked ("Flip a coin." or an Ability's "if …,"), so trim it.
    const lead = s.text.trim().replace(/^If heads, /i, '').replace(/^you may /i, '');
    const text = lead.charAt(0).toUpperCase() + lead.slice(1);
    for (const [re, make] of OPPONENT_SENTENCES) {
      const x = re.exec(text);
      if (!x) continue;
      const made = make(x);
      if (!made) break;
      for (const e of Array.isArray(made) ? made : [made]) ef.push({ at: s.start, e });
      marks.push({ start: s.start, end: s.end, exact: true });
      t = t.slice(0, s.start) + ' '.repeat(s.end - s.start) + t.slice(s.end);
      break;
    }
  }
  const rest = cost ? t.replace(RE_COST, '') : t;
  if ((m = RE_ONLY_IF.exec(rest))) {
    const c = parseCond(m[1]);
    if (!c) return fail('condition');
    out.cond = c;
    const at = t.indexOf(m[0]);
    marks.push({ start: at, end: at + m[0].length, exact: true });
  } else if (RE_CONDITION.test(rest)) return fail('condition');
  if ((m = RE_NOT_FIRST.exec(t))) {
    out.notFirstTurn = true;
    marks.push({ start: m.index, end: m.index + m[0].length, exact: true });
  }
  if ((m = RE_FIRST_OK.exec(t))) {
    out.firstTurnOk = true;
    marks.push({ start: m.index, end: m.index + m[0].length, exact: true });
  }
  if ((m = RE_ENDS_TURN.exec(t))) marks.push({ start: m.index, end: m.index + m[0].length, exact: true });

  const mark = (at: number, len: number, exact = false, vague?: string) => marks.push({ start: at, end: at + len, exact, vague });
  let drew = false;
  if ((m = RE_PRIZE_DRAW.exec(t))) {
    const both = /^Each player/i.test(t.slice(0, m.index + 12)) || /each player draws/i.test(m[0]);
    ef.push({ at: m.index, e: { k: 'shuffleHandDraw', n: -1, bottom: /bottom/.test(m[0]), both: both || undefined } });
    mark(m.index, m[0].length, both);
    if (both) mark(0, m.index, true);
    drew = true;
  } else if ((m = RE_BOTH_DRAW.exec(t))) {
    ef.push({ at: m.index, e: { k: 'shuffleHandDraw', n: Number(m[1]), bottom: false, both: true } });
    mark(m.index, m[0].length, true);
    drew = true;
  } else if ((m = RE_BOTH_THEN.exec(t))) {
    ef.push({ at: m.index, e: { k: 'shuffleHandDraw', n: Number(m[1]), bottom: false, both: true, oppN: Number(m[2]) } });
    mark(m.index, m[0].length, true);
    drew = true;
  } else if ((m = RE_BOTTOM_DRAW.exec(t))) {
    ef.push({ at: m.index, e: { k: 'shuffleHandDraw', n: Number(m[1]), bottom: true } });
    mark(m.index, m[0].length);
    drew = true;
  } else if ((m = RE_SHUFFLE_DRAW.exec(t))) {
    ef.push({ at: m.index, e: { k: 'shuffleHandDraw', n: Number(m[1]), bottom: false } });
    mark(m.index, m[0].length);
    drew = true;
  } else if ((m = RE_DISCARD_DRAW.exec(t))) {
    ef.push({ at: m.index, e: { k: 'discardHandDraw', n: Number(m[1]) } });
    mark(m.index, m[0].length);
    drew = true;
  } else if ((m = RE_DRAW_UNTIL.exec(t))) {
    ef.push({ at: m.index, e: { k: 'drawUntil', n: Number(m[1]) } });
    mark(m.index, m[0].length);
    drew = true;
  }
  if (!drew) {
    // A draw inside an "instead" clause or Gwynn's "draw 3 cards for each" belongs to that reading, not to a plain draw.
    const taken: [number, number][] = [];
    for (const re of [RE_ALT_DRAW, RE_ALT_DRAW_UNTIL, RE_DISCARD_DRAW_PER]) {
      const x = re.exec(t);
      if (x) taken.push([x.index, x.index + x[0].length]);
    }
    for (const d of t.matchAll(RE_DRAW)) {
      if (d[2]) continue; // the opponent draws
      const at = d.index ?? 0;
      if (taken.some(([a, b]) => at >= a && at < b)) continue;
      ef.push({ at, e: { k: 'draw', n: countOf(d[4]) } });
      mark(at, d[0].length);
    }
  }
  // "If you have exactly 6 Prize cards remaining, draw 8 cards instead.": an alternative on the draw before it.
  const altM = RE_ALT_DRAW.exec(t) ?? RE_ALT_DRAW_UNTIL.exec(t);
  if (altM) {
    const c = parseCond(altM[1]);
    const last = [...ef].reverse().find((x) => x.e.k === 'draw' || x.e.k === 'drawUntil' || x.e.k === 'shuffleHandDraw');
    if (c && last && (last.e.k === 'draw' || last.e.k === 'drawUntil' || last.e.k === 'shuffleHandDraw')) {
      last.e.alt = { if: c, n: Number(altM[2]) };
      mark(altM.index, altM[0].length, true);
    }
  }
  if ((m = RE_CRISPIN.exec(t))) {
    const f: CardFilter = { k: 'energy', basic: true };
    ef.push({ at: m.index, e: { k: 'search', n: 1, f, to: 'hand', distinctTypes: true } });
    ef.push({ at: m.index + 1, e: { k: 'search', n: 1, f, to: 'attach', target: { where: 'any' }, distinctFrom: 0 } });
    mark(m.index, m[0].length, true);
  }
  for (const s of t.matchAll(RE_SEARCH)) {
    if (RE_CRISPIN.test(t)) break;
    const to = /^attach/.test(s[2]) ? 'attach' : /Bench/.test(s[2]) ? 'bench' : 'hand';
    // "an Item card and a Pokémon Tool card": two searches.
    const parts = s[1].split(/,? and (?=(?:a|an|up to \d+|\d+) )/);
    let any = false;
    for (const p of parts) {
      // "a Basic Fighting Energy card or a Basic Fighting Pokémon": one search, either kind.
      const options = p.split(/ or (?=(?:a|an|up to \d+|\d+) )/);
      const fs = options.map((x) => parseFilter(x));
      const f = fs[0];
      if (!f || fs.some((x) => !x)) continue;
      any = true;
      const distinct = /of different types/i.test(p) || undefined;
      ef.push({ at: s.index ?? 0, e: { k: 'search', n: countOf(p), f, to, target: to === 'attach' ? parseTarget(s[3] ?? '') : undefined, alts: fs.length > 1 ? (fs.slice(1) as CardFilter[]) : undefined, distinctTypes: distinct } });
      mark(s.index ?? 0, s[0].length, false, fs.map((x) => x!.vague).find((v) => v));
    }
    if (!any) mark(s.index ?? 0, s[0].length, false, s[1]);
  }
  for (const l of t.matchAll(RE_LOOK)) {
    // "a Pokémon and a Trainer card you find there": one of each from the same cards.
    const parts = l[3].split(/,? and (?=(?:a|an|up to \d+|\d+) )/);
    const fs = parts.map((x) => parseFilter(x));
    if (fs.some((x) => !x)) continue;
    fs.forEach((f, i) => ef.push({ at: (l.index ?? 0) + i, e: { k: 'search', n: /any number/i.test(l[2]) ? 99 : countOf(parts[i]), f: f!, to: 'hand', top: Number(l[1]) } }));
    mark(l.index ?? 0, l[0].length, false, fs.map((x) => x!.vague).find((v) => v));
  }
  for (const l of t.matchAll(RE_LOOK_ATTACH)) {
    const f = parseFilter(l[3]);
    if (!f) continue;
    ef.push({ at: l.index ?? 0, e: { k: 'search', n: /any number/i.test(l[2]) ? 99 : countOf(l[2]), f, to: 'attach', target: parseTarget(l[4]), top: Number(l[1]) } });
    mark(l.index ?? 0, l[0].length, false, f.vague);
  }
  if ((m = RE_LOOK_TAKE.exec(t))) {
    ef.push({ at: m.index, e: { k: 'search', n: countOf(m[2]), f: { k: 'any' }, to: 'hand', top: Number(m[1]), discardRest: !!m[3] || undefined } });
    mark(m.index, m[0].length, true);
  }
  if ((m = RE_DISCARD_DRAW_PER.exec(t))) {
    const f = parseFilter(m[2]);
    if (f) {
      ef.push({ at: m.index, e: { k: 'discardDraw', max: Number(m[1]), f, per: Number(m[3]) } });
      mark(m.index, m[0].length, true, f.vague);
    }
  }
  if ((m = RE_HEAL.exec(t))) {
    const target = /^each/.test(m[2]) ? 'each' : /^that/.test(m[2]) ? 'that' : /^your Active/.test(m[2]) ? 'active' : 'any';
    ef.push({ at: m.index, e: { k: 'heal', n: m[1] === 'all' ? 999 : Number(m[1]), all: m[1] === 'all' || undefined, target, minEnergy: m[3] ? Number(m[3]) : undefined, maxHpLeft: m[4] ? Number(m[4]) : undefined } });
    mark(m.index, m[0].length, true);
  } else if ((m = RE_HEAL_COUNTERS.exec(t))) {
    ef.push({ at: m.index, e: { k: 'heal', n: Number(m[1]) * 10, target: 'any' } });
    mark(m.index, m[0].length, true);
  }
  if ((m = RE_STACK.exec(t))) {
    ef.push({ at: m.index, e: { k: 'stack', n: countOf(m[1]) } });
    mark(m.index, m[0].length);
  }
  for (const a of t.matchAll(RE_ATTACH)) {
    const f = parseFilter(`${a[2]}Energy`) ?? { k: 'energy' };
    ef.push({ at: a.index ?? 0, e: { k: 'attach', n: countOf(a[1]), from: a[3] === 'hand' ? 'hand' : 'discard', f, target: parseTarget(a[4]) } });
    mark(a.index ?? 0, a[0].length, false, f.vague);
  }
  for (const [re, k] of [
    [RE_RECOVER, 'recover'],
    [RE_RECOVER_DECK, 'recoverToDeck'],
  ] as const) {
    if (!(m = re.exec(t))) continue;
    // "a Pokémon or a Basic Energy card", "Pokémon and Basic Energy cards" (in any combination): any of them.
    const fs = m[3].split(/ (?:or|and) (?=(?:a |an )?[A-Z])/).map((x) => parseFilter(x.replace(/^(?:a|an) /, '')));
    if (fs.some((x) => !x)) continue;
    ef.push({ at: m.index, e: { k, n: countOf(m[1]), f: fs[0]!, alts: fs.length > 1 ? (fs.slice(1) as CardFilter[]) : undefined } });
    mark(m.index, m[0].length, true, fs.map((x) => x!.vague).find((v) => v));
  }
  if ((m = RE_MOVE.exec(t))) {
    ef.push({ at: m.index, e: { k: 'moveEnergy', n: countOf(m[1]), basic: m[2] ? true : undefined, from: /Benched/.test(m[3]) ? 'bench' : 'any', to: /Active/.test(m[4]) ? 'active' : 'any' } });
    mark(m.index, m[0].length, true);
  }
  if ((m = RE_SWITCH.exec(t))) {
    ef.push({ at: m.index, e: { k: 'switch' } });
    mark(m.index, m[0].length);
  }
  if ((m = /skipping the Stage 1/i.exec(t))) {
    ef.push({ at: m.index, e: { k: 'rareCandy' } });
    // Rare Candy's whole text is the engine's rule: not on the first turn, not on a Basic played this turn.
    mark(0, t.length, true);
  }
  ef.sort((a, b) => a.at - b.at);
  out.effects = ef.map((x) => x.e);
  if (!out.effects.length) out.unread = 'other';
  out.sentences = account(t0, marks, out.chance);
  out.followed = out.sentences.every((s) => s.status !== 'unread');
  return out;
}

/**
 * A Tool's or a Stadium's text: each sentence a static effect the engine applies while the card is
 * in play, or a no-op. A Stadium that lets each player act ("Once during each player's turn, that
 * player may …") is read like a Trainer instead, its "their" turned into "your"; Lumiose City's
 * "their turn ends" and Prism Tower's "discard 2 cards … in order to draw a card" are read with it.
 */
export function parseStaticsText(raw: string, kind: 'Tool' | 'Stadium' | 'Ability'): ParsedText {
  const t0 = normalizeEnergySymbols(raw);
  const shared = /^Once during each player's turn, that player may /i.exec(t0);
  if (kind === 'Stadium' && shared) {
    const body = t0
      .slice(shared[0].length)
      .replace(/\btheir\b/g, 'your')
      .replace(/\bthat player shuffles\b/g, 'shuffle')
      .replace(/\bthat player\b/g, 'you')
      .replace(/\bIf a player (searches|discarded|healed) your (deck|hand|Pokémon)/g, 'If you $1 your $2')
      .replace(/^(?:search|discard|put|draw|switch|heal|flip)/, (w) => w);
    const fx = parseText(body.replace(/(\d+) cards from your hand in order to draw (a|\d+) cards?\./, (_, k: string, d: string) => `${k} cards from your hand in order to use this Ability. Draw ${d === 'a' ? 1 : d} cards.`));
    // "If you searched your deck in this way, your turn ends." is the turn-ending clause the engine honours.
    for (const x of fx.sentences) if (x.status === 'unread' && /your turn ends/i.test(x.text)) {
      x.status = 'read';
      x.why = '';
    }
    fx.endsTurn = /turn ends/i.test(t0);
    fx.followed = fx.sentences.every((x) => x.status !== 'unread');
    return fx;
  }
  const out: ParsedText = { effects: [], discardCost: 0, chance: 1, endsTurn: false, mods: [], statics: [], unread: '', sentences: [], followed: false };
  for (const s of splitSentences(t0)) {
    const fx = parseStatic(s.text);
    if (fx.length) {
      out.statics!.push(...fx);
      out.sentences.push({ text: s.text, status: 'read', why: '' });
      continue;
    }
    const noop = NOOP.find(([re]) => re.test(s.text));
    out.sentences.push(noop ? { text: s.text, status: 'noop', why: noop[1] } : { text: s.text, status: 'unread', why: '' });
  }
  out.followed = out.sentences.every((x) => x.status !== 'unread');
  if (!out.statics!.length) out.unread = kind === 'Ability' ? 'passive' : kind.toLowerCase();
  else if (kind === 'Ability') for (const x of out.statics!) if (!x.scope) x.scope = 'self';
  return out;
}

/**
 * A Special Energy's text. What it provides, to whom, and when more (`rule`, read by the evaluator:
 * base, amount, an attach restriction, upgrades under a condition) is read through the engine's
 * `energyOf`, so those sentences count; a draw on attaching (Enriching Energy) is an effect; the
 * rest are standing effects like a Tool's (Spiky, Legacy, Boomerang). Mist Energy's "prevent all
 * effects" stays unread while the engine has no effects to prevent.
 */
export function parseEnergyText(raw: string, rule?: { only: unknown; upgrades: { cond: unknown }[] } | null): ParsedText {
  const t = normalizeEnergySymbols(raw);
  const out: ParsedText = { effects: [], discardCost: 0, chance: 1, endsTurn: false, mods: [], statics: [], unread: '', sentences: [], followed: true };
  if (!t) return out;
  const marks: Mark[] = [];
  const exact = (m: RegExpExecArray | RegExpMatchArray) => marks.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, exact: true });
  for (const m of t.matchAll(/(?:(?:As long as|While) this card is attached to a Pokémon, (?:it|this card)|This card) provides (?:(?:[A-Z][a-z]+)+ Energy|every type of Energy but provides only \d Energy at a time|\d in any combination of [A-Z][a-z]+ Energy and [A-Z][a-z]+ Energy)\./gi)) exact(m);
  let m: RegExpExecArray | null;
  if (rule?.only && (m = /^This card can only be attached to (?:a |an )?.+?\. If this card is attached to anything other than (?:a |an )?.+?, discard this card\./.exec(t))) exact(m);
  if (rule?.upgrades.some((u) => u.cond !== 'unread') && (m = /If (?:this card is attached to|the Pokémon this card is attached to is) (?:a |an )?.+?, (?:this card|it) provides (?:every type of Energy but provides only \d Energy at a time|(?:[A-Z][a-z]+)+ Energy instead)\./.exec(t))) exact(m);
  if ((m = /When you attach this card from your hand to (?:a |an )?(.+?), (.+)$/.exec(t))) {
    const tt = m[1] === 'Pokémon' ? undefined : parsePokeTest(m[1]);
    const inner = parseText(m[2].charAt(0).toUpperCase() + m[2].slice(1));
    if (tt !== null && inner.effects.length && inner.followed) {
      out.effects.push({ k: 'onAttach', t: tt as PokeTest | undefined, effects: inner.effects });
      exact(m);
    }
  }
  for (const s of splitSentences(t)) {
    const fx = parseStatic(s.text);
    if (fx.length) {
      out.statics!.push(...fx.map((x) => ({ ...x, scope: 'self' as const })));
      marks.push({ start: s.start, end: s.end, exact: true });
    }
  }
  if ((m = /This effect of your .+? can't be applied more than once per game\./.exec(t))) {
    for (const x of out.statics!) if (x.k === 'prizeLess') x.once = true;
    exact(m);
  }
  out.sentences = account(t, marks, 1);
  out.followed = out.sentences.every((s) => s.status !== 'unread');
  if (!out.followed) out.unread = 'energy';
  return out;
}

/**
 * What an attack costs its user on the next turn: 1 when the Pokémon cannot
 * attack at all ("During your next turn, this Pokémon can't attack"), 2 when
 * it cannot use that attack again, 0 when neither. A rest that hangs on a
 * coin flip is not counted.
 */
export function attackRest(effect: string): 0 | 1 | 2 | 3 {
  // "This Pokémon can't use Blaze Blitz again until it leaves the Active Spot": once per stay there.
  if (/This Pokémon can't use [^.]+? again until it leaves the Active Spot/i.test(effect)) return 3;
  const m = /During your next turn, this Pokémon can't (attack|use attacks|use [^.]+)|This Pokémon can't (attack|use attacks|use [^.]+?) during your next turn/i.exec(effect);
  if (!m) return 0;
  if (/If (?:tails|heads),[^.]*$/i.test(effect.slice(0, m.index))) return 0;
  const what = (m[1] ?? m[2]).toLowerCase();
  return what === 'attack' || what === 'use attacks' ? 1 : 2;
}

/**
 * Energy an attack's own text takes from its user every time, to be attached again a card a turn:
 * a mandatory discard (a number, or the whole cost for "all"), or Energy put back into the hand or
 * deck. Optional costs count nothing: the pilot pays them only for a Knock Out.
 */
export function attackDrain(fx: ParsedText | null, costN: number): number {
  let n = 0;
  for (const e of fx?.effects ?? []) {
    if ((e.k === 'discardSelfEnergy' || e.k === 'energyToDeck') && !e.may) n += e.all ? costN : e.n;
    else if (e.k === 'energyToHand' && !e.may) n += e.n;
  }
  return Math.min(n, costN);
}

/**
 * The share of its next turns an attack costs its user through a Special Condition on itself
 * ("This Pokémon is now Asleep"): Asleep a quarter (two coins before its next attack), Confused a
 * half, Paralyzed the whole next turn. `sustained` divides by 1 + miss.
 */
export function attackMiss(fx: ParsedText | null): number {
  let miss = 0;
  for (const e of fx?.effects ?? []) {
    if (e.k !== 'condition' || e.on !== 'self') continue;
    miss = Math.max(miss, e.c === 'Asleep' ? 0.25 : e.c === 'Confused' ? 0.5 : e.c === 'Paralyzed' ? 1 : 0);
  }
  return miss * (fx?.chance ?? 1);
}

/** The rest sentence of an attack, which the engine honours (`attackRest`), is read. */
export function parseAttackText(raw: string): ParsedText {
  const fx = parseText(raw, 'attack');
  if (!attackRest(raw)) return fx;
  const re = /During your next turn, this Pokémon can't (?:attack|use attacks|use [^.]+)\.?|This Pokémon can't (?:attack|use attacks|use [^.]+?) during your next turn\.?|This Pokémon can't use [^.]+? again until it leaves the Active Spot\.?/i;
  for (const s of fx.sentences) if (s.status === 'unread' && re.test(s.text) && !/^If (?:tails|heads),/i.test(s.text)) {
    s.status = 'read';
    s.why = '';
  }
  fx.followed = fx.sentences.every((s) => s.status !== 'unread');
  return fx;
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
  // "1 Quick Search Ability each turn", or "1 Ability that has "Last-Ditch" in its name each turn".
  const limit = /You can't use more than 1 (?:(.+?) Ability|Ability that has "([^"]+)" in its name) (?:each|during your) turn/i.exec(text);
  const activeOnly = /If this Pokémon is in the Active Spot/i.test(text);
  // The trigger, the Active-only clause, the per-turn limit and the VSTAR note are honoured by the engine itself and
  // leave the body; what is left is read like a Trainer.
  // A cost stated before the trigger ("You must discard a card from your hand in order to use this Ability. Once
  // during your turn, …") stays with the body.
  const prefix = /(?:When you play this Pokémon from your hand (?:to evolve 1 of your Pokémon|onto your Bench) during your turn, |Once during your turn(?: \(before your attack\))?, |As often as you like during your turn(?: \(before your attack\))?, )/i.exec(text);
  const body = (prefix ? text.slice(0, prefix.index) + text.slice(prefix.index + prefix[0].length) : text)
    .replace(/^when you play this Pokémon from your hand (?:onto your Bench|to evolve 1 of your Pokémon), /i, '')
    .replace(/^if this Pokémon is in the Active Spot, /i, '')
    .replace(/^you may use this Ability\.\s*/i, '')
    .replace(/You can't use more than 1 (?:.+? Ability|Ability that has "[^"]+" in its name) (?:each|during your) turn\.?/i, '')
    .replace(/\(You can't use more than 1 VSTAR Power in a game\.\)/i, '');
  return {
    name,
    trigger,
    activeOnly,
    limitName: limit ? (limit[1] ?? limit[2]) : '',
    vstar: /VSTAR/i.test(kind) || /VSTAR Power in a game/i.test(text),
    fx: trigger === 'passive' ? parseStaticsText(text, 'Ability') : parseText(body.replace(/^you may (?!use this Ability)/i, '')),
  };
}
