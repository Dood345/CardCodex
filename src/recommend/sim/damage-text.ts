/**
 * Reads the damage wordings of an attack's text into damage.ts modifiers, one
 * sentence at a time. Wordings were counted over every attack of the catalog
 * (2026-11-10): "This attack does N (more) damage for each X" with X an
 * Energy, Benched or in-play Pokémon, damage counter, Prize card, card in a
 * hand or discard pile, or heads flipped ("Flip N coins", "until you get
 * tails", "for each Energy"); "If X, this attack does N more damage";
 * "If X, this attack does nothing"; "If heads/tails"; the older "does N
 * damage plus N more damage" and "the Defending Pokémon"; "isn't affected by
 * Weakness/Resistance/effects"; and "If you go second, you can't use this
 * attack during your first turn". A sentence is consumed only when every
 * part of it is read; what the count or the condition names must be a kind
 * the engine can check (`parsePokeTest`, `parseCardTest`, `parseCond`).
 */
import { normalizeText } from '@/data/normalize';
import { COST_LETTERS } from '../card-text';
import type { CardTest, Cond, Count, DamageMod, PokeTest, SpecialCondition, StaticEffect } from './damage';
import type { Effect } from './effects';

const TYPE_NAMES = Object.keys(COST_LETTERS).filter((t) => t !== 'Colorless');
const TYPE_ALT = TYPE_NAMES.join('|');
const RE_TYPE = new RegExp(`^(${TYPE_ALT})$`);

const N = (s: string) => Number(s);

/** The opposite condition, flipping a `not` flag where the condition has one. */
function negate(c: Cond): Cond {
  if (c.k === 'not') return c.c;
  if ('not' in c) return { ...c, not: c.not ? undefined : true };
  return { k: 'not', c };
}

const SPECIAL_CONDITION = /^(?:Poisoned|Burned|Asleep|Paralyzed|Confused)$|affected by a Special Condition/;

/** "Pokémon ex", "Basic Pokémon", "Fire Pokémon", "Stage 2 Pokémon", "Lunatone", "Beedrill and Beedrill ex", "Pokémon that has the Round attack". */
export function parsePokeTest(raw: string): PokeTest | null {
  let s = raw.trim().replace(/^(?:a|an|any|your|of your|of your opponent's) /i, '');
  if (SPECIAL_CONDITION.test(s)) return null;
  const t: PokeTest = {};
  let m: RegExpExecArray | null;
  if ((m = /^(.+?) (?:that (?:has|have) the (.+?) (Ability|attack))$/i.exec(s))) {
    s = m[1];
    if (m[3] === 'Ability') t.ability = m[2];
    else t.attack = m[2];
  }
  if ((m = /^(.+?), except any (.+)$/.exec(s))) {
    s = m[1];
    t.notNames = m[2].split(/,? (?:and|or) /).map((x) => normalizeText(x));
  }
  if ((m = /^(.+?) that (?:doesn't|don't) have a Rule Box$/.exec(s))) {
    s = m[1];
    t.ruleBox = false;
  }
  if ((m = /^(.+?) Pokémon$/.exec(s)) && (m[1] === 'Basic' || m[1] === 'Evolution' || m[1] === 'Evolved')) {
    if (m[1] === 'Basic') t.basic = true;
    else t.evolution = true;
    return t;
  }
  if ((m = /^Stage ([12]) (?:Evolved )?Pokémon$/.exec(s))) {
    t.stage = N(m[1]);
    return t;
  }
  if ((m = new RegExp(`^(${TYPE_ALT}|Colorless) Pokémon$`).exec(s))) {
    t.type = COST_LETTERS[m[1]];
    return t;
  }
  if ((m = /^Pokémon[- ](ex|V|VMAX|VSTAR|GX|EX)$/.exec(s))) {
    t.suffix = m[1];
    return t;
  }
  if (s === 'Pokémon') return t;
  // Kinds the card data does not mark: a card cannot be told to be one.
  if (/^(?:Future|Ancient|Tera|Mega Evolution|Fossil|Rule Box|Pokémon with a Rule Box) Pokémon$|^(?:Future|Ancient|Tera)$/.test(s)) return null;
  if ((m = /^(?:(Basic) )?((?:Team Rocket's|[A-Z][a-z]*'s)) Pokémon$/.exec(s))) {
    t.owner = m[2];
    if (m[1]) t.basic = true;
    return t;
  }
  if ((m = new RegExp(`^Basic non-(${TYPE_ALT}) Pokémon$`).exec(s))) {
    t.basic = true;
    t.notType = COST_LETTERS[m[1]];
    return t;
  }
  // One or more card names ("Lunatone", "Beedrill and Beedrill ex", "Charjabug"): capitalised words, no "Pokémon".
  if (/^[A-Z][\w'’.-]*(?: [A-Za-z][\w'’.-]*)*(?:,? (?:and|or) [A-Z][\w'’.-]*(?: [a-z]+)?)*$/.test(s) && !/\bPokémon\b/.test(s)) {
    t.names = s.split(/,? (?:and|or) /).map((n) => normalizeText(n));
    return t;
  }
  return null;
}

/** "Energy card", "Basic Energy card", "Fire Energy", "Supporter card that has "Team Rocket" in its name", "Ethan's Adventure card", "Pokémon that has the X Ability". */
export function parseCardTest(raw: string): CardTest | null {
  const s = raw.trim().replace(/^(?:a|an) /i, '');
  let m: RegExpExecArray | null;
  if ((m = /^(?:(Basic|Special) )?(?:([A-Z][a-z]+) )?Energy(?: cards?)?$/.exec(s))) {
    if (m[2] && !RE_TYPE.test(m[2])) return null;
    const t: CardTest = { energy: true };
    if (m[1] === 'Basic') t.basicEnergy = true;
    if (m[2]) t.energyType = COST_LETTERS[m[2]];
    return t;
  }
  if ((m = /^Supporter cards? that (?:has|have) "([^"]+)" in (?:its|their) names?$/.exec(s))) return { supporter: true, nameHas: m[1] };
  if (/^Supporter cards?$/.test(s)) return { supporter: true };
  if ((m = /^Pokémon that (?:has|have) the (.+?) Ability$/.exec(s))) return { pokemon: true, ability: m[1] };
  if (/^Pokémon$/.test(s)) return { pokemon: true };
  if ((m = /^([A-Z][\w'’ -]+?) cards?$/.exec(s)) && !/\b(?:Trainer|Item|Tool|Stadium)\b/.test(m[1])) return { nameHas: m[1].replace('’', "'") };
  return null;
}

/** The X of "for each X" or "times the number of X". */
export function parseCount(raw: string, flips: Count | null): Count | null {
  const s = raw.trim().replace(/\.$/, '');
  let m: RegExpExecArray | null;
  if (s === 'heads') return flips;
  if ((m = /^(?:(Basic|Special) )?(?:([A-Z][a-z]+) )?Energy(?: cards?)?(?: and each (?:([A-Z][a-z]+) )?Energy)? attached to (this Pokémon|all of your Pokémon|your opponent's Active Pokémon|the Defending Pokémon|all of your opponent's Pokémon|both Active Pokémon)$/.exec(s))) {
    if ((m[2] && !RE_TYPE.test(m[2])) || (m[3] && !RE_TYPE.test(m[3]))) return null;
    const on = m[4] === 'this Pokémon' ? 'self' : m[4] === 'all of your Pokémon' ? 'all' : m[4] === "all of your opponent's Pokémon" ? 'opponentAll' : m[4] === 'both Active Pokémon' ? 'bothActive' : 'opponentActive';
    const type = (m[2] ? COST_LETTERS[m[2]] : '') + (m[3] ? COST_LETTERS[m[3]] : '');
    return { k: 'energy', on, type: type || undefined, basic: m[1] === 'Basic' || undefined, special: m[1] === 'Special' || undefined };
  }
  if ((m = /^Benched Pokémon \(both yours and your opponent's\)$/.exec(s))) return { k: 'bench', side: 'both' };
  if ((m = /^Pokémon in play \(both yours and your opponent's\)$/.exec(s))) return { k: 'inPlay', side: 'both' };
  if ((m = /^(?:of )?your (opponent's )?Benched (.+)$/.exec(s)) || (m = /^(?:of )?(?:your )?(opponent's )?(.+?) on your Bench$/.exec(s))) {
    const t = m[2] === 'Pokémon' ? {} : parsePokeTest(m[2]);
    if (!t) return null;
    return { k: 'bench', side: m[1] ? 'opponent' : 'self', t: Object.keys(t).length ? t : undefined };
  }
  if ((m = /^(?:of )?your (opponent's )?(.+?) in play(?: (that (?:has|have) the .+? (?:attack|Ability)))?$/.exec(s))) {
    const t = m[2] === 'Pokémon' && !m[3] ? {} : parsePokeTest(m[3] ? `${m[2]} ${m[3]}` : m[2]);
    if (!t) return null;
    return { k: 'inPlay', side: m[1] ? 'opponent' : 'self', t: Object.keys(t).length ? t : undefined };
  }
  if ((m = /^damage counters? on (this Pokémon|your opponent's Active Pokémon|the Defending Pokémon|all of your opponent's Pokémon|all of your Benched Pokémon|your Benched Pokémon)$/.exec(s))) {
    const on = m[1] === 'this Pokémon' ? 'self' : /all of your opponent/.test(m[1]) ? 'opponentAll' : /Benched/.test(m[1]) ? 'bench' : 'opponentActive';
    return { k: 'counters', on };
  }
  if ((m = /^Prize cards? (your opponent has|you have) taken$/.exec(s))) return { k: 'prizesTaken', side: m[1] === 'you have' ? 'self' : 'opponent' };
  if ((m = /^cards? in (your|your opponent's) hand$/.exec(s))) return { k: 'hand', side: m[1] === 'your' ? 'self' : 'opponent' };
  if ((m = /^(.+?) in (your|your opponent's) discard pile$/.exec(s))) {
    const t = parseCardTest(m[1]);
    if (!t) return null;
    return { k: 'discard', side: m[2] === 'your' ? 'self' : 'opponent', t };
  }
  if (/^Colorless in your opponent's Active Pokémon's Retreat Cost$/.test(s)) return { k: 'retreatCost', on: 'opponentActive' };
  if (/^(?:cards?|Energy cards?) (?:you )?discarded(?: in this way)?$/.test(s)) return { k: 'discarded' };
  return null;
}

/** The X of "If X, this attack does N more damage" (and of "does nothing"), negation included. */
export function parseCond(raw: string): Cond | null {
  const s = raw.trim();
  let m: RegExpExecArray | null;
  if (s === 'heads') return { k: 'coin' };
  if (s === 'tails') return negate({ k: 'coin' });
  if ((m = /^(?:your opponent's Active Pokémon|the Defending Pokémon) (is|isn't|is not) (?:a |an )?(.+)$/.exec(s))) {
    const not = m[1] !== 'is' || undefined;
    const alts = m[2].split(/ or (?:a |an )?/);
    const tests = alts.map((a) => parsePokeTest(a));
    if (tests.some((t) => !t)) return null;
    const cs: Cond[] = tests.map((t) => ({ k: 'opponentActive', t: t!, not }));
    return cs.length === 1 ? cs[0] : { k: 'any', cs };
  }
  if ((m = /^(?:your opponent's Active Pokémon|the Defending Pokémon) (?:already )?has (any|no) damage counters on it$/.exec(s))) return { k: 'opponentActiveDamaged', not: m[1] === 'no' || undefined };
  if ((m = /^(?:your opponent's Active Pokémon|the Defending Pokémon|this Pokémon) is (Asleep|Burned|Confused|Paralyzed|Poisoned)$/.exec(s))) return { k: 'condition', on: /^this/.test(s) ? 'self' : 'opponentActive', c: m[1] as SpecialCondition };
  if ((m = /^(?:your opponent's Active Pokémon|the Defending Pokémon|this Pokémon) is affected by a Special Condition$/.exec(s))) return { k: 'condition', on: /^this/.test(s) ? 'self' : 'opponentActive', c: 'any' };
  if ((m = /^this Pokémon has (any|no) damage counters on it$/.exec(s))) return { k: 'selfDamaged', not: m[1] === 'no' || undefined };
  if ((m = /^this Pokémon has at least (\d+) extra Energy attached \(in addition to this attack's cost\)$/.exec(s))) return { k: 'selfEnergy', extra: N(m[1]) };
  if ((m = /^this Pokémon has any (?:(Special|Basic) )?(?:([A-Z][a-z]+) )?Energy attached$/.exec(s))) {
    if (m[2] && !RE_TYPE.test(m[2])) return null;
    return { k: 'selfEnergy', type: m[2] ? COST_LETTERS[m[2]] : undefined, special: m[1] === 'Special' || undefined };
  }
  if (/^this Pokémon moved from your Bench to the Active Spot this turn$|^this Pokémon was on the Bench and became your Active Pokémon this turn$/.test(s)) return { k: 'movedThisTurn' };
  if ((m = /^any of your (?:((?:Team Rocket's|[A-Z][a-z]*'s)) )?Pokémon were Knocked Out (?:by damage from an attack )?during your opponent's last turn$/.exec(s))) return { k: 'koLastTurn', owner: m[1] };
  if ((m = /^all of your Pokémon in play are (.+)$/.exec(s))) {
    const t = parsePokeTest(m[1]);
    return t ? { k: 'allInPlay', t } : null;
  }
  if (/^you go second, and only during your first turn$/.test(s)) return { k: 'firstTurnSecond' };
  if (/^it is the last card in your hand$/.test(s)) return { k: 'lastCardInHand' };
  if (/^(?:a|there is a|there is any|you have a) Stadium(?: card)? (?:is )?in play$/.test(s)) return { k: 'stadium' };
  if (/^there is no Stadium(?: card)? in play$/.test(s)) return { k: 'stadium', not: true };
  if ((m = /^you (don't )?have (?:any )?(.+?) (on your Bench|in play)$/.exec(s))) {
    const t = parsePokeTest(m[2]);
    if (!t) return null;
    return { k: 'inPlay', side: 'self', t, min: 1, bench: m[3] === 'on your Bench' || undefined, not: m[1] ? true : undefined };
  }
  if ((m = /^you have (\d+) or more (.+?) in your discard pile$/.exec(s))) {
    const t = parseCardTest(m[2]);
    if (!t) return null;
    return { k: 'discard', side: 'self', t, min: N(m[1]) };
  }
  if ((m = /^you have at least (\d+) (?:([A-Z][a-z]+) )?Energy in play$/.exec(s))) {
    if (m[2] && !RE_TYPE.test(m[2])) return null;
    return { k: 'energyInPlay', type: m[2] ? COST_LETTERS[m[2]] : undefined, min: N(m[1]) };
  }
  if ((m = /^your opponent has (\d+) or fewer Prize cards remaining$/.exec(s))) return { k: 'prizes', side: 'opponent', max: N(m[1]) };
  if ((m = /^your opponent (doesn't have|has) exactly (\d+)(?: or (\d+))? Prize cards? remaining$/.exec(s))) {
    const c: Cond = { k: 'prizes', side: 'opponent', exactly: m[3] ? [N(m[2]), N(m[3])] : [N(m[2])] };
    return m[1] === 'has' ? c : negate(c);
  }
  if ((m = /^you have exactly (\d+) Prize cards? remaining$/.exec(s))) return { k: 'prizes', side: 'self', exactly: [N(m[1])] };
  if (/^you have more Prize cards (?:remaining|left) than your opponent$/.test(s)) return { k: 'prizesMore', side: 'self' };
  if ((m = /^your opponent has (\d+) or fewer cards in their hand$/.exec(s))) return { k: 'hand', side: 'opponent', max: N(m[1]) };
  if ((m = /^you (don't )?have exactly (\d+) cards in your hand$/.exec(s))) {
    const c: Cond = { k: 'hand', side: 'self', exactly: N(m[2]) };
    return m[1] ? negate(c) : c;
  }
  if (/^you have no cards in your hand$/.test(s)) return { k: 'hand', side: 'self', exactly: 0 };
  if (/^this Pokémon and your opponent's Active Pokémon have the same amount of Energy attached$/.test(s)) return { k: 'sameEnergy' };
  if (/^your Benched Pokémon have any damage counters on them$/.test(s)) return { k: 'benchDamaged' };
  if (/^any of your Pokémon in play are the same type as any of your opponent's Pokémon in play$/.test(s)) return { k: 'sameType' };
  return null;
}

/** A Tool's "the (Lillie's) Pokémon this card is attached to", or a Stadium's "each Stage 2 Pokémon in play": the Pokémon it reaches. */
function subjectTest(raw: string | undefined): PokeTest | null | undefined {
  const s = (raw ?? '').trim();
  if (!s || s === 'Pokémon') return undefined;
  if (s.endsWith('Pokémon')) return parsePokeTest(s);
  // "Future, except any Iron Crown ex" → "Future Pokémon, except any Iron Crown ex".
  const at = s.indexOf(', except any ');
  return parsePokeTest(at >= 0 ? `${s.slice(0, at)} Pokémon${s.slice(at)}` : `${s} Pokémon`);
}

const BOTH = String.raw`(?: \(both yours and your opponent's\))?`;
const WR = String.raw`(?: \((?:before|after) applying Weakness and Resistance\))?`;

/**
 * One sentence of a Tool or Stadium into a static effect, or null. Tools speak of "the Pokémon this
 * card is attached to"; Stadiums of "each … Pokémon in play (both yours and your opponent's)".
 */
export function parseStatic(sentence: string): StaticEffect[] {
  const s = sentence.trim().replace(/’/g, "'");
  let m: RegExpExecArray | null;
  const n = (x: string) => Number(x);
  // Tools.
  if ((m = /^The (?:(.+?) )?Pokémon this card is attached to gets \+(\d+) HP\.$/.exec(s))) {
    const t = subjectTest(m[1]);
    return t === null ? [] : [{ k: 'hp', delta: n(m[2]), t }];
  }
  if ((m = /^The (?:(.+?) )?Pokémon this card is attached to has no Retreat Cost\.$/.exec(s))) {
    const t = subjectTest(m[1]);
    return t === null ? [] : [{ k: 'retreat', delta: -99, t }];
  }
  if (/^If this card is attached to 1 of your Pokémon, discard it at the end of your turn\.$/.test(s)) return [{ k: 'discardAtTurnEnd' }];
  if ((m = new RegExp(String.raw`^The attacks of the Pokémon this card is attached to do (\d+) less damage to your opponent's Pokémon${WR}\.$`).exec(s))) return [{ k: 'damage', n: -n(m[1]) }];
  if ((m = /^The Retreat Cost of the (?:(.+?) )?Pokémon this card is attached to is ((?:Colorless)+) (less|more)\.$/.exec(s))) {
    const t = subjectTest(m[1]);
    const k = m[2].length / 'Colorless'.length;
    return t === null ? [] : [{ k: 'retreat', delta: m[3] === 'less' ? -k : k, t }];
  }
  if ((m = new RegExp(String.raw`^Attacks used by the (?:(.+?) )?Pokémon this card is attached to do (\d+) more damage to your opponent's Active Pokémon( ex)?${WR}\.$`).exec(s))) {
    const t = subjectTest(m[1]);
    return t === null ? [] : [{ k: 'damage', n: n(m[2]), t, vs: m[3] ? { suffix: 'ex' } : undefined }];
  }
  if ((m = new RegExp(String.raw`^If the Pokémon this card is attached to doesn't have a Rule Box, the attacks it uses do (\d+) more damage to your opponent's Active Pokémon( ex)?${WR}\.$`).exec(s))) {
    return [{ k: 'damage', n: n(m[1]), vs: m[2] ? { suffix: 'ex' } : undefined, ruleBoxFree: true }];
  }
  if ((m = new RegExp(String.raw`^Attacks used by the (.+?) Pokémon this card is attached to cost Colorless less and do (\d+) more damage to your opponent's Active Pokémon${WR}\.$`).exec(s))) {
    const t = subjectTest(m[1]);
    return t ? [{ k: 'costLess', n: 1, t }, { k: 'damage', n: n(m[2]), t }] : [];
  }
  if ((m = /^If the (?:(.+?) )?Pokémon this card is attached to is Knocked Out by damage from an attack from your opponent's Pokémon, that player takes (\d+) fewer Prize cards?\.$/.exec(s))) {
    const t = subjectTest(m[1]);
    return t === null ? [] : [{ k: 'prizeLess', n: n(m[2]), t }];
  }
  if ((m = /^If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon \(even if this Pokémon is Knocked Out\), draw (\d+) cards\.$/.exec(s))) return [{ k: 'drawWhenHit', n: n(m[1]) }];
  if ((m = /^If the (?:(.+?) )?Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent's Pokémon \(even if this (?:.+? )?Pokémon is Knocked Out\), (?:put|place) (\d+) damage counters on the Attacking Pokémon\.$/.exec(s))) {
    const t = subjectTest(m[1]);
    return t === null ? [] : [{ k: 'hitBack', n: n(m[2]), t }];
  }
  if (/^If this card is discarded by an effect of an attack used by the Pokémon this card is attached to, attach this card from your discard pile to that Pokémon after attacking\.$/.test(s)) return [{ k: 'boomerang' }];
  // Abilities (passive): the holder, the owner's Pokémon, or the opponent's.
  if ((m = /^As long as this Pokémon is in the Active Spot, (.+)$/.exec(s))) {
    return parseStatic(m[1].charAt(0).toUpperCase() + m[1].slice(1)).map((x) => ({ ...x, activeOnly: true }));
  }
  if ((m = /^Your (?:(.+?) )?Pokémon in play have no Retreat Cost\.$/.exec(s))) {
    const t = subjectTest(m[1]);
    return t === null ? [] : [{ k: 'retreat', delta: -99, t, scope: 'own' }];
  }
  if ((m = new RegExp(String.raw`^This Pokémon takes (\d+) less damage from attacks(?: from your opponent's Pokémon)?${WR}\.$`).exec(s))) return [{ k: 'damageTaken', delta: n(m[1]), scope: 'self' }];
  if ((m = /^This Pokémon gets \+(\d+) HP\.$/.exec(s))) return [{ k: 'hp', delta: n(m[1]), scope: 'self' }];
  if ((m = new RegExp(String.raw`^Attacks used by your (.+?) Pokémon(, except any .+?)?,? do (\d+) more damage to your opponent's Active Pokémon${WR}\.$`).exec(s))) {
    const t = subjectTest(`${m[1]}${m[2] ?? ''}`);
    return t ? [{ k: 'damage', n: n(m[3]), t, scope: 'own' }] : [];
  }
  if ((m = new RegExp(String.raw`^Each Basic (${TYPE_ALT}) Energy attached to all of your Pokémon provides \1\1 Energy\.$`).exec(s))) return [{ k: 'energyDouble', type: COST_LETTERS[m[1]], scope: 'own' }];
  if ((m = new RegExp(String.raw`^The Weakness of each of your opponent's (.+?) Pokémon in play is now (${TYPE_ALT})\.$`).exec(s))) {
    const t = subjectTest(m[1]);
    return t ? [{ k: 'weakness', to: COST_LETTERS[m[2]], t, scope: 'opponent' }] : [];
  }
  if ((m = /^Prevent all damage done to this Pokémon by attacks from your opponent's (.+?)\.$/.exec(s))) {
    const from = parsePokeTest(m[1]);
    return from ? [{ k: 'preventDamage', from, scope: 'self' }] : [];
  }
  if (/^Prevent all effects of (?:your opponent's Pokémon's attacks and Abilities|attacks used by your opponent's Pokémon) done to (?:this Pokémon|the (?:[A-Z][a-z]+ )?Pokémon this card is attached to)\.$/.test(s)) return [{ k: 'preventEffects', scope: 'self' }];
  if ((m = /^Prevent all effects of attacks used by your opponent's Pokémon done to your (.+?)\.$/.exec(s))) {
    const t = subjectTest(m[1]);
    return t ? [{ k: 'preventEffects', scope: 'own', t } as StaticEffect] : [];
  }
  if ((m = /^Prevent all damage done to your Benched (.+?) by attacks from your opponent's Pokémon\.$/.exec(s))) {
    const t = parsePokeTest(m[1]);
    return t ? [{ k: 'preventBenchDamage', t, scope: 'own' }] : [];
  }
  if (/^Prevent all damage counters from being placed on Benched Pokémon \(both yours and your opponent's\) by effects of attacks and Abilities from the opponent's Pokémon\.$/.test(s)) return [{ k: 'preventBenchDamage', scope: 'both' }];
  if ((m = /^(.+?) used by this Pokémon costs Colorless less for each (.+?)\.$/.exec(s))) {
    const per = parseCount(m[2], null);
    return per ? [{ k: 'costLess', n: 1, attack: m[1], per, scope: 'self' }] : [];
  }
  // Stadiums.
  if ((m = new RegExp(String.raw`^Each (?:(.+?) )?Pokémon in play${BOTH} gets ([+-]\d+) HP\.$`).exec(s))) {
    const t = subjectTest(m[1]);
    return t === null ? [] : [{ k: 'hp', delta: n(m[2]), t }];
  }
  if ((m = new RegExp(String.raw`^(.+?) Pokémon in play${BOTH} have no Abilities\.$`).exec(s))) {
    const t = subjectTest(m[1]);
    return t ? [{ k: 'noAbilities', t }] : [];
  }
  if ((m = new RegExp(String.raw`^(.+?) Pokémon in play${BOTH} have no Retreat Cost\.$`).exec(s))) {
    const t = subjectTest(m[1]);
    return t ? [{ k: 'retreat', delta: -99, t }] : [];
  }
  if ((m = new RegExp(String.raw`^The Retreat Cost of each (.+?) in play${BOTH} is ((?:Colorless)+) less\.$`).exec(s))) {
    const t = parsePokeTest(m[1]);
    return t ? [{ k: 'retreat', delta: -(m[2].length / 'Colorless'.length), t }] : [];
  }
  if ((m = new RegExp(String.raw`^Attacks used by (.+?) Pokémon${BOTH} do (\d+) more damage to the opponent's Active Pokémon${WR}\.$`).exec(s))) {
    const t = subjectTest(m[1]);
    return t ? [{ k: 'damage', n: n(m[2]), t }] : [];
  }
  if (/^Pokémon Tools attached to each Pokémon \(both yours and your opponent's\) have no effect\.$/.test(s)) return [{ k: 'noTools' }];
  if ((m = /^Whenever any player puts a (.+?) onto their Bench during their turn, place (\d+) damage counters on that Pokémon\.$/.exec(s))) {
    const t = parsePokeTest(m[1]);
    return t ? [{ k: 'benchCounters', n: n(m[2]), t }] : [];
  }
  if ((m = new RegExp(String.raw`^Each player's (${TYPE_ALT}) Pokémon can evolve into \1 Pokémon during the turn they play those Pokémon, except during their first turn\.$`).exec(s))) return [{ k: 'evolveSameTurn', t: { type: COST_LETTERS[m[1]] } }];
  if ((m = new RegExp(String.raw`^(.+?) Pokémon${BOTH} take (\d+) less damage from attacks from the opponent's Pokémon${WR}\.$`).exec(s))) {
    const t = subjectTest(m[1]);
    return t ? [{ k: 'damageTaken', delta: n(m[2]), t }] : [];
  }
  return [];
}

export interface DamageParse {
  mods: DamageMod[];
  /** What the attack costs its user or does to its own side (effects.ts `Effect`), with the sentence start. */
  effects: { at: number; e: Effect }[];
  /** Character spans of the sentences consumed. */
  spans: [number, number][];
}

/** "a", "2", "all", "any amount of" as an Energy count. */
function energyN(s: string): { n: number; all?: boolean; any?: boolean } {
  if (s === 'all') return { n: 99, all: true };
  if (/^any (?:amount|number) of$/.test(s)) return { n: 99, any: true };
  return { n: /^\d+$/.test(s) ? N(s) : 1 };
}

const RE_TYPE_WORD = new RegExp(`^(${TYPE_ALT})$`);

/**
 * The cost and own-side sentences of an attack: Energy discarded from this Pokémon or any of yours
 * (a number, all, any amount, a type), Energy put back into the hand or deck, damage to itself or
 * to its own Bench, the Pokémon returned to the hand, the top of the deck discarded, cards discarded
 * from the hand; each may be optional ("You may …") with "and have this attack do N more damage" or
 * a following "If you do, …" tied to it.
 */
function parseCost(s: string): { e: Effect; bonus?: number } | null {
  let m: RegExpExecArray | null;
  if ((m = /^(You may )?[Dd]iscard (an?|\d+|all|any amount of|any number of) (?:(Basic|Special) )?(?:([A-Z][a-z]+) )?Energy(?: cards?)? (?:attached to|from) (this Pokémon|your Pokémon|among your Pokémon)(?:,? and (?:have this attack do|this attack does) (\d+) more damage)?\.$/.exec(s))) {
    if (m[4] && !RE_TYPE_WORD.test(m[4])) return null;
    const { n, all, any } = energyN(m[2]);
    const type = m[4] ? COST_LETTERS[m[4]] : undefined;
    const basic = m[3] === 'Basic' || undefined;
    const special = m[3] === 'Special' || undefined;
    if (m[5] !== 'this Pokémon') {
      if (!any) return null;
      return { e: { k: 'discardAnyEnergy', type, basic, special } };
    }
    return { e: { k: 'discardSelfEnergy', n, all, type, basic, special, may: !!m[1] || undefined }, bonus: m[6] ? N(m[6]) : undefined };
  }
  if ((m = /^(You may )?[Pp]ut (an?|\d+) (?:([A-Z][a-z]+) )?Energy attached to this Pokémon into your hand(?: and have this attack do (\d+) more damage)?\.$/.exec(s))) {
    if (m[3] && !RE_TYPE_WORD.test(m[3])) return null;
    return { e: { k: 'energyToHand', n: energyN(m[2]).n, type: m[3] ? COST_LETTERS[m[3]] : undefined, may: !!m[1] || undefined }, bonus: m[4] ? N(m[4]) : undefined };
  }
  if ((m = /^(You may )?[Ss]huffle (\d+|all) Energy attached to this Pokémon into your deck(?: and have this attack do (\d+) more damage)?\.$/.exec(s))) {
    const { n, all } = energyN(m[2]);
    return { e: { k: 'energyToDeck', n, all, may: !!m[1] || undefined }, bonus: m[3] ? N(m[3]) : undefined };
  }
  if ((m = /^(?:This Pokémon|It) (?:also )?does (\d+) damage to itself\.?$/.exec(s))) return { e: { k: 'selfDamage', n: N(m[1]) } };
  if ((m = /^This attack (?:also )?does (\d+) damage to (each|1) of your Benched Pokémon\.$/.exec(s))) return { e: { k: 'benchDamageOwn', n: N(m[1]), each: m[2] === 'each' } };
  if (/^Put this Pokémon and all attached cards into your hand\.$/.test(s)) return { e: { k: 'selfToHand' } };
  if ((m = /^(You may )?[Dd]iscard the top (\d+|card) cards? (?:of|from) your deck\.$/.exec(s))) return { e: { k: 'millSelf', n: m[2] === 'card' ? 1 : N(m[2]) } };
  if ((m = /^(You may )?[Dd]iscard (a|\d+|up to \d+) cards? from your hand\.$/.exec(s))) return { e: { k: 'discardHand', n: energyN(m[2].replace(/^up to /, '')).n, may: !!m[1] || undefined } };
  return null;
}

/**
 * Read the damage sentences of an attack text. `sentences` carries each sentence with its span;
 * a "Flip …" sentence is consumed only when a later sentence counts its heads or hangs on it.
 */
export function parseDamageMods(sentences: readonly { text: string; start: number; end: number }[]): DamageParse {
  const mods: DamageMod[] = [];
  const effects: { at: number; e: Effect }[] = [];
  const spans: [number, number][] = [];
  /** An optional cost was read: a following "If you do, …" hangs on it. */
  let optional = false;
  let flips: Count | null = null;
  let flipAt = -1;
  let flipUsed = false;
  let m: RegExpExecArray | null;
  const take = (i: number) => spans.push([sentences[i].start, sentences[i].end]);
  const useFlip = (i: number): boolean => {
    if (!flips) return false;
    if (!flipUsed) {
      take(flipAt);
      flipUsed = true;
    }
    take(i);
    return true;
  };
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i].text.replace(/’/g, "'");
    if ((m = /^Flip (a|\d+|two|three) coins?\.$/.exec(s))) {
      flips = { k: 'heads', flips: m[1] === 'a' ? 1 : m[1] === 'two' ? 2 : m[1] === 'three' ? 3 : N(m[1]) };
      flipAt = i;
      flipUsed = false;
      continue;
    }
    if (/^Flip a coin until you get tails\.$/.test(s)) {
      flips = { k: 'heads', flips: 'untilTails' };
      flipAt = i;
      flipUsed = false;
      continue;
    }
    if ((m = /^Flip a coin for each (.+?)\.$/.exec(s))) {
      const per = parseCount(m[1], null);
      if (per) {
        flips = { k: 'heads', flips: { per } };
        flipAt = i;
        flipUsed = false;
      }
      continue;
    }
    if (/^This attack's damage isn't affected by (?:Weakness or Resistance|Weakness|Resistance|any effects on your opponent's Active Pokémon|Weakness or Resistance, or by any effects on your opponent's Active Pokémon)\.$/.test(s)) {
      mods.push({ k: 'ignore', weakness: /Weakness/.test(s) || undefined, resistance: /Resistance/.test(s) || undefined, effects: /effects/.test(s) || undefined });
      take(i);
      continue;
    }
    if (/^If you go second, you can't use this attack during your first turn\.$/.test(s)) {
      mods.push({ k: 'firstTurnBarred' });
      take(i);
      continue;
    }
    // Costs and own-side effects.
    const cost = parseCost(s);
    if (cost) {
      effects.push({ at: sentences[i].start, e: cost.e });
      optional = 'may' in cost.e && !!cost.e.may;
      if (cost.bonus !== undefined) mods.push({ k: 'bonus', n: cost.bonus, if: { k: 'paid' } });
      take(i);
      continue;
    }
    if (optional && (m = /^If you do, this attack does (\d+) more damage\.$/.exec(s))) {
      mods.push({ k: 'bonus', n: N(m[1]), if: { k: 'paid' } });
      take(i);
      continue;
    }
    if (optional && (m = /^If you do, this Pokémon (?:also )?does (\d+) damage to itself\.$/.exec(s))) {
      effects.push({ at: sentences[i].start, e: { k: 'selfDamage', n: N(m[1]), ifPaid: true } });
      take(i);
      continue;
    }
    // "Discard the top card of each player's deck. This attack does 140 more damage for each Energy card discarded in this way." (Magcargo ex)
    if ((m = /^Discard the top (card|\d+ cards) of (your|each player's) deck\.$/.exec(s)) && i + 1 < sentences.length) {
      const next = /^This attack does (\d+) more damage for each Energy card discarded in this way\.$/.exec(sentences[i + 1].text);
      if (next) {
        const n = m[1] === 'card' ? 1 : N(m[1]);
        const both = m[2] !== 'your';
        effects.push({ at: sentences[i].start, e: { k: 'millSelf', n } });
        if (both) effects.push({ at: sentences[i].start, e: { k: 'millOpp', n } });
        mods.push({ k: 'plus', n: N(next[1]), per: { k: 'milledEnergy', n, both: both || undefined } });
        take(i);
        take(i + 1);
        i++;
        continue;
      }
    }
    // "Discard any amount of Fire Energy from among your Pokémon, and this attack does 50 damage for each card you discarded in this way."
    if ((m = /^(Discard (?:any amount of|any number of) (?:(?:Basic|Special) )?(?:[A-Z][a-z]+ )?Energy(?: cards?)? from (?:among )?your Pokémon), and this attack does (\d+) (more )?damage for each (cards? you discarded in this way)\.$/.exec(s))) {
      const c = parseCost(`${m[1]}.`);
      if (!c) continue;
      effects.push({ at: sentences[i].start, e: c.e });
      mods.push({ k: m[3] ? 'plus' : 'times', n: N(m[2]), per: { k: 'discarded' } });
      take(i);
      continue;
    }
    // Scaling: "This attack does N (more|less) damage for each X" / "Does N damage plus N more damage for each X" /
    // "N more damage times the amount of X".
    if ((m = /^(?:This attack does|Does) (?:\d+ damage (?:plus|minus) )?(\d+) (more |less )?damage (?:for each|times the (?:number|amount) of) (.+?)\.$/.exec(s))) {
      const perS = m[3].replace(/^(?:of )?(?:your )?/, (x) => x);
      const per = parseCount(perS, flips);
      if (!per) continue;
      const k = m[2] === 'less ' ? 'minus' : m[2] === 'more ' || /plus/.test(s) ? 'plus' : 'times';
      mods.push({ k, n: N(m[1]), per });
      if (per.k === 'heads' && flips) useFlip(i);
      else take(i);
      continue;
    }
    // "If X, this attack does N more damage" (and the older "does N damage plus N more damage").
    if ((m = /^If (.+?), this attack does (?:\d+ damage plus )?(\d+) more damage\.$/.exec(s))) {
      const c = parseCond(m[1]);
      if (!c) continue;
      mods.push({ k: 'bonus', n: N(m[2]), if: c });
      if (c.k === 'coin' || (c.k === 'not' && c.c.k === 'coin')) {
        if (!useFlip(i)) mods.pop();
      } else take(i);
      continue;
    }
    if ((m = /^If (.+?), this attack does nothing(?: \(not even damage\))?\.$/.exec(s))) {
      const c = parseCond(m[1]);
      if (!c) continue;
      const unless = negate(c);
      mods.push({ k: 'nothing', unless });
      if (unless.k === 'coin') {
        if (!useFlip(i)) mods.pop();
      } else take(i);
      continue;
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  return { mods, effects, spans };
}
