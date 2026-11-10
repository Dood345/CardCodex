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
import type { DamageMod } from './damage';
import { parseDamageMods } from './damage-text';

export type CardFilter = (
  | { k: 'any' }
  | { k: 'pokemon'; basic?: boolean; evolution?: boolean; stage?: number; type?: string; hpMax?: number; suffix?: string }
  | { k: 'trainer'; tt?: string }
  | { k: 'energy'; basic?: boolean; type?: string }
) & {
  /** Words of the clause the filter does not model ("that doesn't have a Rule Box", "of different types"); the search is wider than the card says. */
  vague?: string;
};

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
  /** `top`: only the top cards of the deck are looked at (Great Ball: the top 7), and the rest is shuffled back. */
  | { k: 'search'; n: number; f: CardFilter; to: 'hand' | 'bench' | 'attach'; target?: AttachTarget; top?: number }
  /** Search the deck for n cards and put them on top of it (Ciphermaniac's Codebreaking). */
  | { k: 'stack'; n: number }
  | { k: 'attach'; n: number; from: 'discard' | 'hand'; f: CardFilter; target: AttachTarget }
  | { k: 'recover'; n: number; f: CardFilter }
  | { k: 'switch' }
  | { k: 'rareCandy' };

export type SentenceStatus = 'read' | 'noop' | 'unread';

export interface Sentence {
  text: string;
  status: SentenceStatus;
  /** Why it is unread (a short kind), or the NOOP reason. */
  why: string;
}

export interface ParsedText {
  effects: Effect[];
  /** Cards to discard from the hand to play it. */
  discardCost: number;
  /** 0.5 when the effect hangs on one coin flip. */
  chance: number;
  /** "your turn ends". */
  endsTurn: boolean;
  /** Attacks: what the text does to the damage (damage.ts), applied by the engine at attack time. */
  mods: DamageMod[];
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
        const why = skipped(s.text, lead);
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
const RE_LOOK = /Look at the top (\d+) cards of your deck\. You may reveal (a|an|up to \d+|any number of) ([^.]*?) you find there,? and put (?:it|them) into your hand/gi;
const RE_STACK = /Search your deck for (\d+|a|an|up to \d+) cards?, shuffle your deck, then put (?:those cards|that card|it) on top of it/i;
const RE_ATTACH = /attach (a|an|\d+|up to \d+) ((?:Basic )?(?:[A-Z][a-z]+ )?)Energy cards? from (?:your|their) (discard pile|hand) to ([^.]*)/gi;
const RE_RECOVER = /put (a|an|\d+|up to \d+) ((?:Basic )?(?:[A-Z][a-z]+ )?)Energy cards? from your discard pile into your hand/i;
const RE_SWITCH = /switch your Active Pokémon with 1 of your Benched Pokémon|switch this Pokémon with 1 of your Benched Pokémon/i;
const RE_COST = /only if you discard (another|\d+ other|a|an) cards? from your hand/i;
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
  if (mode === 'attack' && t0.trim()) {
    const dm = parseDamageMods(splitSentences(t0));
    out.mods = dm.mods;
    for (const [start, end] of dm.spans) {
      marks.push({ start, end, exact: true });
      t = t.slice(0, start) + ' '.repeat(end - start) + t.slice(end);
    }
  }
  const fail = (why: string): ParsedText => ({ ...out, unread: why, sentences: unreadAll(t0, why), followed: false });
  if (!t0.trim()) return { ...out, unread: 'no text', sentences: [], followed: true };
  if (!t.trim() && out.mods.length) {
    out.unread = 'damage only';
    out.sentences = account(t0, marks, 1);
    out.followed = out.sentences.every((s) => s.status !== 'unread');
    return out;
  }
  if (/Flip (?:\d+|two|three) coins|until you get tails|for each heads/i.test(t)) return fail('coin flips');
  let m: RegExpExecArray | null;
  if ((m = /^Flip a coin\. If heads,/i.exec(t))) {
    out.chance = 0.5;
    marks.push({ start: 0, end: 'Flip a coin.'.length, exact: true });
  } else if (/Flip a coin/i.test(t)) return fail('coin flips');
  const cost = RE_COST.exec(t);
  if (cost) {
    out.discardCost = cost[1] === 'another' || cost[1] === 'a' || cost[1] === 'an' ? 1 : countOf(cost[1]);
    marks.push({ start: cost.index, end: cost.index + cost[0].length, exact: true });
  }
  const rest = cost ? t.replace(RE_COST, '') : t;
  if (RE_CONDITION.test(rest)) return fail('condition');
  if ((m = RE_ENDS_TURN.exec(t))) marks.push({ start: m.index, end: m.index + m[0].length, exact: true });

  const ef: { at: number; e: Effect }[] = [];
  const mark = (at: number, len: number, exact = false, vague?: string) => marks.push({ start: at, end: at + len, exact, vague });
  let drew = false;
  if ((m = RE_PRIZE_DRAW.exec(t))) {
    ef.push({ at: m.index, e: { k: 'shuffleHandDraw', n: -1, bottom: /bottom/.test(m[0]) } });
    mark(m.index, m[0].length);
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
    for (const d of t.matchAll(RE_DRAW)) {
      if (d[2]) continue; // the opponent draws
      ef.push({ at: d.index ?? 0, e: { k: 'draw', n: countOf(d[4]) } });
      mark(d.index ?? 0, d[0].length);
    }
  }
  for (const s of t.matchAll(RE_SEARCH)) {
    const to = /^attach/.test(s[2]) ? 'attach' : /Bench/.test(s[2]) ? 'bench' : 'hand';
    // "an Item card and a Pokémon Tool card": two searches.
    const parts = s[1].split(/,? and (?=(?:a|an|up to \d+|\d+) )/);
    let any = false;
    for (const p of parts) {
      const f = parseFilter(p);
      if (!f) continue;
      any = true;
      ef.push({ at: s.index ?? 0, e: { k: 'search', n: countOf(p), f, to, target: to === 'attach' ? parseTarget(s[3] ?? '') : undefined } });
      mark(s.index ?? 0, s[0].length, false, f.vague);
    }
    if (!any) mark(s.index ?? 0, s[0].length, false, s[1]);
  }
  for (const l of t.matchAll(RE_LOOK)) {
    const f = parseFilter(l[3]);
    if (!f) continue;
    ef.push({ at: l.index ?? 0, e: { k: 'search', n: /any number/i.test(l[2]) ? 99 : countOf(l[2]), f, to: 'hand', top: Number(l[1]) } });
    mark(l.index ?? 0, l[0].length, false, f.vague);
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
  if ((m = RE_RECOVER.exec(t))) {
    const f = parseFilter(`${m[2]}Energy`) ?? { k: 'energy' };
    ef.push({ at: m.index, e: { k: 'recover', n: countOf(m[1]), f } });
    mark(m.index, m[0].length, false, f.vague);
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
 * A Special Energy's text. The engine reads what an Energy provides from the evaluator's features
 * (`provides`), so the plain "provides" sentence counts as read; every other sentence is unread
 * until an effect is modelled.
 */
export function parseEnergyText(raw: string): ParsedText {
  const t = normalizeEnergySymbols(raw);
  const out: ParsedText = { effects: [], discardCost: 0, chance: 1, endsTurn: false, mods: [], unread: '', sentences: [], followed: true };
  if (!t) return out;
  const marks: Mark[] = [];
  for (const m of t.matchAll(/(?:As long as|While) this card is attached to a Pokémon, (?:it|this card) provides (?:[A-Z][a-z]+ Energy|every type of Energy but provides only 1 Energy at a time)\./gi)) {
    marks.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, exact: true });
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
export function attackRest(effect: string): 0 | 1 | 2 {
  const m = /During your next turn, this Pokémon can't (attack|use attacks|use [^.]+)|This Pokémon can't (attack|use attacks|use [^.]+?) during your next turn/i.exec(effect);
  if (!m) return 0;
  if (/If (?:tails|heads),[^.]*$/i.test(effect.slice(0, m.index))) return 0;
  const what = (m[1] ?? m[2]).toLowerCase();
  return what === 'attack' || what === 'use attacks' ? 1 : 2;
}

/** The rest sentence of an attack, which the engine honours (`attackRest`), is read. */
export function parseAttackText(raw: string): ParsedText {
  const fx = parseText(raw, 'attack');
  if (!attackRest(raw)) return fx;
  const re = /During your next turn, this Pokémon can't (?:attack|use attacks|use [^.]+)\.?|This Pokémon can't (?:attack|use attacks|use [^.]+?) during your next turn\.?/i;
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
  const body = text
    .replace(/^.*?(?:When you play this Pokémon from your hand (?:to evolve 1 of your Pokémon|onto your Bench) during your turn, |Once during your turn(?: \(before your attack\))?, |As often as you like during your turn(?: \(before your attack\))?, )/i, '')
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
    fx: trigger === 'passive' ? { effects: [], discardCost: 0, chance: 1, endsTurn: false, mods: [], unread: 'passive', sentences: unreadAll(normalizeEnergySymbols(text), 'passive'), followed: false } : parseText(body.replace(/^you may /i, '')),
  };
}
