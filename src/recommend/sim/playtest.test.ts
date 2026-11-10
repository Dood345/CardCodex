/**
 * The practice-draw simulator on the real catalog and card text: the Charizard
 * ex fixture deck (fixtures.ts) against damaged copies of itself and random
 * piles of the same years.
 */
import { describe, expect, it } from 'vitest';
import type { DeckCard } from '@/data/db';
import { mulliganChance } from '../pokemon';
import { compileDeck } from './cards';
import { pokemonPlaytest } from '../pokemon-play';
import { attackRest, parseText } from './effects';
import { attack, mainPhase, newPlayer, type Game, type Mon, type Player } from './engine';
import { BLANK, CHARIZARD, deck, loadEvaluator, randomPile, withBlanks } from './fixtures';
import { compiledDeck, playtest } from './playtest';
import { dealOpening, drawNext } from './practice';
import { POKEMON_RULES_PAR_2023, prizeValue } from './rules';

const { index, ev } = loadEvaluator();
const cards = deck(CHARIZARD);
const LONG = { timeout: 60000 };
const strip = <T extends { ms: number }>(r: T) => ({ ...r, ms: 0 });
/** Four standard errors of a difference of two shares measured over n games each. */
const fourSE = (p: number, q: number, n: number) => 4 * Math.sqrt((p * (1 - p) + q * (1 - q)) / n);

describe('reading the fixture deck', () => {
  const d = compileDeck(ev, cards);
  const byName = (name: string) => d.cards.find((c) => c.name === name)!;

  it('picks Charizard ex as the main attacker, with its line through Charmeleon', () => {
    expect(d.plan?.attackerName).toBe('Charizard ex');
    expect(d.plan?.line).toEqual(['charizard ex', 'charmeleon', 'charmander']);
    expect(d.list.length).toBe(60);
    expect(d.unknown).toBe(0);
  });

  it('reads the draw, search and acceleration of the deck from the card text', () => {
    expect(byName('Professor\'s Research').fx?.effects).toEqual([{ k: 'discardHandDraw', n: 7 }]);
    expect(byName('Iono').fx?.effects).toEqual([{ k: 'shuffleHandDraw', n: -1, bottom: true }]);
    expect(byName('Ultra Ball').fx?.discardCost).toBe(2);
    expect(byName('Nest Ball').fx?.effects[0]).toMatchObject({ k: 'search', to: 'bench', f: { k: 'pokemon', basic: true } });
    expect(byName('Buddy-Buddy Poffin').fx?.effects[0]).toMatchObject({ k: 'search', n: 2, f: { hpMax: 70 } });
    expect(byName('Arven').fx?.effects.map((e) => (e.k === 'search' ? e.f : null))).toEqual([
      { k: 'trainer', tt: 'Item' },
      { k: 'trainer', tt: 'Tool' },
    ]);
    const reign = byName('Charizard ex').abilities[0];
    expect(reign.trigger).toBe('evolve');
    expect(reign.fx.effects[0]).toMatchObject({ k: 'search', n: 3, to: 'attach', f: { k: 'energy', basic: true, type: 'R' } });
    const quick = byName('Pidgeot ex').abilities[0];
    expect(quick).toMatchObject({ trigger: 'turn', limitName: 'Quick Search' });
    expect(byName('Rotom V').abilities[0].fx.endsTurn).toBe(true);
    expect(byName('Lumineon V').abilities[0].trigger).toBe('bench');
    expect(byName('Rare Candy').fx?.effects).toEqual([{ k: 'rareCandy' }]);
    expect(byName('Charizard ex').candyBase).toBe('charmander');
    // Pidgeotto is not in the deck: the catalog supplies what it evolves from.
    expect(byName('Pidgeot ex').candyBase).toBe('pidgey');
  });

  it('lists what it cannot read, with the kind of effect', () => {
    const reasons = new Map(d.unread.map((u) => [u.name, u.reason]));
    expect(reasons.get("Boss's Orders")).toBe('gust');
    expect(reasons.get('Defiance Band')).toBe('tool');
    expect(reasons.has('Iono')).toBe(false);
    // Played, but with an Ability the pilot does not use.
    const partly = new Map(d.partlyRead.map((u) => [u.name, u.reason]));
    expect(partly.get('Radiant Charizard: Excited Heart')).toBe('passive Ability');
    expect(partly.get('Manaphy: Wave Veil')).toBe('passive Ability');
    expect([...partly.keys()].some((n) => n.startsWith('Pidgeot ex'))).toBe(false);
  });

  it('reads a coin flip and a condition as such', () => {
    expect(parseText('Flip a coin. If heads, draw 3 cards.')).toMatchObject({ chance: 0.5, effects: [{ k: 'draw', n: 3 }] });
    expect(parseText('Flip 2 coins. For each heads, draw a card.').unread).toBe('coin flips');
    expect(parseText('You can use this card only if your opponent has 3 or fewer Prize cards remaining. Draw 3 cards.').unread).toBe('condition');
  });

  it('gives each kind of Pokémon its prize value', () => {
    expect(prizeValue(index.cardsById.get('sv04.5-054')!.name)).toBe(2);
    expect(prizeValue(index.cardsById.get('swsh12.5-020')!.name)).toBe(1);
    const vmax = index.catalog.cards.find((c) => c.stage === 'VMAX')!;
    expect(prizeValue(vmax.name)).toBe(3);
    const tagTeam = index.catalog.cards.find((c) => /&.* GX$/.test(c.name))!;
    expect(prizeValue(tagTeam.name)).toBe(3);
    const gx = index.catalog.cards.find((c) => c.cat === 'Pokemon' && / GX$/.test(c.name) && !c.name.includes('&'))!;
    expect(prizeValue(gx.name)).toBe(2);
    const ex = index.catalog.cards.find((c) => c.cat === 'Pokemon' && / EX$/.test(c.name))!;
    expect(prizeValue(ex.name)).toBe(2);
    const megaEx = index.catalog.cards.find((c) => /^Mega .* ex$/.test(c.name))!;
    expect(prizeValue(megaEx.name)).toBe(3);
    expect(POKEMON_RULES_PAR_2023.prizes).toBe(6);
  });
});

describe('playtest', () => {
  it('gives the same report for the same seed, another for another seed', LONG, () => {
    const a = playtest(ev, cards, { games: 300, seed: 11 });
    const b = playtest(ev, cards, { games: 300, seed: 11 });
    const c = playtest(ev, cards, { games: 300, seed: 12 });
    expect(strip(a)).toEqual(strip(b));
    expect(strip(c)).not.toEqual(strip(a));
    // The same cards in another order, or split over more lines, play the same games.
    const reordered = [...cards].reverse().flatMap((l) => (l.qty > 1 ? [{ ...l, qty: 1 }, { ...l, qty: l.qty - 1 }] : [l]));
    expect(strip(playtest(ev, reordered, { games: 300, seed: 11 }))).toEqual(strip(a));
  });

  it('mulligans as often as the hypergeometric chance says', LONG, () => {
    const basics = cards.reduce((n, c) => n + (ev.features(ev.card(c.cardId)!).isBasic ? c.qty : 0), 0);
    expect(basics).toBe(10);
    const n = 4000;
    const r = playtest(ev, cards, { games: n, seed: 5, turns: 1 });
    const p = mulliganChance(60, basics);
    expect(Math.abs(r.mulliganRate - p)).toBeLessThan(4 * Math.sqrt((p * (1 - p)) / n));
  });

  it('never attacks without Energy', LONG, () => {
    const noEnergy: DeckCard[] = [
      ...cards.filter((c) => c.cardId !== 'sve-002' && c.cardId !== 'sv01-169' && c.cardId !== 'swsh12.5-135'),
      { cardId: 'sv01-169', qty: 4 }, // Defiance Band
      { cardId: 'swsh12.5-135', qty: 3 }, // Lost Vacuum
      { cardId: 'sv02-172', qty: 1 }, // a fourth Boss's Orders
    ];
    expect(noEnergy.reduce((n, c) => n + c.qty, 0)).toBe(60);
    // Every attack in the deck costs something.
    for (const c of compileDeck(ev, noEnergy).cards) for (const a of c.attacks) expect(a.cost.length, `${c.name}'s ${a.name}`).toBeGreaterThan(0);
    const r = playtest(ev, noEnergy, { games: 500, seed: 3 });
    expect(r.onlineBy.every((x) => x === 0)).toBe(true);
    expect(r.meanDamagePerTurn).toBe(0);
  });

  it('gets the Charizard ex deck attacking far sooner than random piles of its years', LONG, () => {
    const good = playtest(ev, cards, { games: 1000, seed: 1 });
    expect(good.onlineBy[3]).toBeGreaterThan(0.6);
    expect(good.meanDamagePerTurn).toBeGreaterThan(60);
    for (const s of [3, 4, 5]) {
      const pile = playtest(ev, randomPile(index, s, 2023, 2024), { games: 500, seed: 1 });
      expect(pile.onlineBy[3]).toBeLessThan(0.15);
      expect(pile.meanOnlineTurn).toBeGreaterThan(good.meanOnlineTurn + 2);
    }
  });

  it('is measurably slower without its draw and search Trainers', LONG, () => {
    const d = compiledDeck(ev, cards);
    const drawSearch = d.cards
      .filter((c) => c.kind === 'trainer' && c.fx?.effects.some((e) => e.k === 'search' || e.k === 'draw' || e.k === 'discardHandDraw' || e.k === 'shuffleHandDraw'))
      .map((c) => c.card.id);
    expect(drawSearch.length).toBeGreaterThanOrEqual(6);
    const n = 2000;
    const full = playtest(ev, cards, { games: n, seed: 2 });
    const thin = playtest(ev, withBlanks(cards, drawSearch), { games: n, seed: 2 });
    expect(thin.mulliganRate).toBeCloseTo(full.mulliganRate, 1);
    expect(full.onlineBy[2] - thin.onlineBy[2]).toBeGreaterThan(fourSE(full.onlineBy[2], thin.onlineBy[2], n));
    expect(thin.meanOnlineTurn).toBeGreaterThan(full.meanOnlineTurn + 0.5);
    expect(thin.deadTurnRate).toBeGreaterThan(full.deadTurnRate);
  });

  it('is slower to its Stage 2 without Rare Candy', LONG, () => {
    const n = 2000;
    const full = playtest(ev, cards, { games: n, seed: 4 });
    const noCandy = playtest(ev, withBlanks(cards, ['sv04.5-089']), { games: n, seed: 4 });
    // A Stage 2 attacks on turn 2 only through Rare Candy.
    expect(full.onlineBy[1]).toBeGreaterThan(0.2);
    expect(noCandy.onlineBy[1]).toBe(0);
    expect(full.onlineBy[2] - noCandy.onlineBy[2]).toBeGreaterThan(fourSE(full.onlineBy[2], noCandy.onlineBy[2], n));
    expect(noCandy.meanOnlineTurn).toBeGreaterThan(full.meanOnlineTurn + 0.5);
    // With one Charmeleon and no Candy, a prized Charmeleon strands the line.
    expect(noCandy.keyPieceStuckRate).toBeGreaterThan(0.05);
    expect(full.keyPieceStuckRate).toBeLessThan(0.01);
  });

  it('reports a deck without Basic Pokémon as unable to open', () => {
    const r = playtest(ev, [{ cardId: 'sve-002', qty: 60 }], { games: 10, seed: 1 });
    expect(r.cannotOpen).toBe(true);
    expect(r.onlineBy.every((x) => x === 0)).toBe(true);
  });

  it('plays 1,000 games of a 60-card deck in about a second', LONG, () => {
    playtest(ev, cards, { games: 50, seed: 9 }); // warm the compile cache and the JIT
    const r = playtest(ev, cards, { games: 1000, seed: 9 });
    expect(r.ms).toBeLessThan(2500);
  });
});

describe('practice draw', () => {
  it('deals seven, six Prize cards and the rest, the same way for the same seed', () => {
    const a = dealOpening(ev, cards, 42);
    expect(a.ok).toBe(true);
    expect(a.hand.length).toBe(7);
    expect(a.prizes.length).toBe(6);
    expect(a.hand.length + a.prizes.length + a.library.length).toBe(60);
    expect(a.hand.some((id) => ev.features(ev.card(id)!).isBasic)).toBe(true);
    for (const h of a.mulligans) expect(h.some((id) => ev.features(ev.card(id)!).isBasic)).toBe(false);
    expect(dealOpening(ev, cards, 42)).toEqual(a);
    expect(dealOpening(ev, cards, 43)).not.toEqual(a);
    const all = [...a.hand, ...a.prizes, ...a.library].sort();
    expect(all).toEqual(cards.flatMap((c) => Array<string>(c.qty).fill(c.cardId)).sort());
  });

  it('draws the next cards off the top without changing the deal it was given', () => {
    const a = dealOpening(ev, cards, 7);
    const b = drawNext(a, 2);
    expect(b.hand).toEqual([...a.hand, ...a.library.slice(0, 2)]);
    expect(b.library).toEqual(a.library.slice(2));
    expect(a.hand.length).toBe(7);
    expect(drawNext({ ...a, library: [BLANK] }, 3).hand.length).toBe(8);
  });

  it('shows the mulligans it took', () => {
    // Fewer Basics, more mulligans: some seed among the first few must mulligan.
    const few: DeckCard[] = [{ cardId: 'sv04.5-007', qty: 2 }, { cardId: 'sve-002', qty: 58 }];
    const deals = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => dealOpening(ev, few, s));
    expect(deals.some((d) => d.mulligans.length > 0)).toBe(true);
    for (const d of deals) expect(d.hand).toContain('sv04.5-007');
  });
});

/**
 * A deck of thin lines whose biggest number is an attack that rests its user,
 * with the Trainers that look at the top of the deck: what a first home-made
 * deck looks like (reported 2026-11-09: "plays toward Umbreon" although its
 * attack lands every other turn, and six cards counted as blanks).
 */
const THIN: [string, number][] = [
  ['sv03-130', 2], // Umbreon: Pitch-Black Blade 140, "During your next turn, this Pokémon can't attack."
  ['swsh10.5-054', 2], // Eevee
  ['sv08.5-002', 2], // Exeggutor: Solar Beam 130
  ['sv08.5-001', 2], // Exeggcute
  ['swsh12-015', 1], // Chesnaught V: Touchdown 130, one copy
  ['swsh1-164', 2], // Great Ball
  ['sv01-186', 1], // Pokégear 3.0
  ['sv03.5-156', 1], // Bill's Transfer
  ['sv08.5-104', 1], // Ciphermaniac's Codebreaking
  ['swsh1-177', 1], // Potion
  ['swsh1-165', 4], // Hop
  ['sve-009', 21], // Grass Energy
  ['sve-007', 20], // Darkness Energy
];

describe('attacks that rest their user', () => {
  const thin = deck(THIN);
  const d = compileDeck(ev, thin);

  it('reads the rest from the attack text, and leaves coin flips and the opponent\'s turn alone', () => {
    expect(attackRest("During your next turn, this Pokémon can't attack.")).toBe(1);
    expect(attackRest("This Pokémon can't attack during your next turn.")).toBe(1);
    expect(attackRest("During your next turn, this Pokémon can't use attacks.")).toBe(1);
    expect(attackRest("During your next turn, this Pokémon can't use Slashing Strike.")).toBe(2);
    expect(attackRest("Does 30 damage times the amount of Grass Energy attached to this Pokémon. This Pokémon can't use Hundred Furious Lashes during your next turn.")).toBe(2);
    expect(attackRest("Flip a coin. If tails, during your next turn, this Pokémon can't attack.")).toBe(0);
    expect(attackRest("During your opponent's next turn, the Defending Pokémon can't retreat.")).toBe(0);
    expect(attackRest('')).toBe(0);
  });

  it('values such an attack at what it keeps up, in the features and in the score', () => {
    const umbreon = ev.features(index.cardsById.get('sv03-130')!);
    expect(umbreon.best).toMatchObject({ name: 'Pitch-Black Blade', damage: 140, rest: 1, sustained: 70 });
    expect(ev.features(index.cardsById.get('sv08.5-002')!).best).toMatchObject({ name: 'Solar Beam', rest: 0, sustained: 130 });
    const power = ev.score(thin).parts.find((p) => p.id === 'power')!;
    expect(power.detail).not.toMatch(/Umbreon/);
    // Two printings of Exeggutor are two copies of one attacker: the Power line names the deck's plan.
    const split = ev.score(deck([...THIN.filter(([id]) => id !== 'sv08.5-002'), ['sv08.5-002', 1], ['swsh9-002', 1]])).parts.find((p) => p.id === 'power')!;
    expect(split.detail).toMatch(/^Exeggutor's Solar Beam for /);
    expect(split.score).toBeCloseTo(power.score, 5);
  });

  it('plays toward the attack that lands every turn, not the bigger one that lands every other turn', () => {
    expect(d.plan?.attackerName).toBe('Exeggutor');
    expect(d.plan?.detail).toBe("Exeggutor's Solar Beam (GGC, 130)");
    // One copy of a Pokémon V is not a plan: the deck finds it too seldom.
    expect(d.plan?.attackerName).not.toBe('Chesnaught V');
    expect(compileDeck(ev, thin, 'umbreon').plan?.detail).toBe("Umbreon's Pitch-Black Blade (DCC, 140, every other turn)");
  });

  it('keeps a rested Pokémon from attacking on its next turn, and lets it attack on the one after', () => {
    const du = compileDeck(ev, thin, 'umbreon');
    const card = (name: string) => du.cards.find((c) => c.name === name)!;
    const g: Game = { rules: POKEMON_RULES_PAR_2023, stadium: null, winner: null, ending: '' };
    const p: Player = newPlayer(du, 1, false, 6, 5);
    const dark = card('Darkness Energy');
    const active: Mon = { c: card('Umbreon'), under: [], energy: [dark, dark, dark], dmg: 0, entered: 0, abilityTurn: -1, restTurn: 0, restAtk: '' };
    p.active = active;
    p.turn = 2;
    expect(attack(g, p, null)).toBe(140);
    p.turn = 3;
    expect(attack(g, p, null)).toBe(0);
    p.turn = 4;
    expect(attack(g, p, null)).toBe(140);
    expect(p.damage.slice(1, 4)).toEqual([140, 0, 140]);
  });
});

describe('Trainers that look at the top of the deck', () => {
  const thin = deck(THIN);
  const du = compileDeck(ev, thin, 'umbreon');
  const card = (name: string) => du.cards.find((c) => c.name === name)!;
  const table = (hand: string[], library: string[]): { g: Game; p: Player } => {
    const g: Game = { rules: POKEMON_RULES_PAR_2023, stadium: null, winner: null, ending: '' };
    const p = newPlayer(du, 1, false, 6, 5);
    p.turn = 2;
    p.active = { c: card('Eevee'), under: [], energy: [], dmg: 0, entered: 0, abilityTurn: -1, restTurn: 0, restAtk: '' };
    p.hand = hand.map((n) => card(n).i);
    // The top of the deck is the end of the list.
    p.deck = library.map((n) => card(n).i);
    return { g, p };
  };
  const grass = (n: number) => new Array<string>(n).fill('Grass Energy');

  it('reads them from the card text', () => {
    expect(card('Great Ball').fx?.effects).toMatchObject([{ k: 'search', n: 1, f: { k: 'pokemon' }, to: 'hand', top: 7 }]);
    expect(card('Pokégear 3.0').fx?.effects).toMatchObject([{ k: 'search', n: 1, f: { k: 'trainer', tt: 'Supporter' }, to: 'hand', top: 7 }]);
    expect(card("Bill's Transfer").fx?.effects).toMatchObject([{ k: 'search', n: 99, f: { k: 'pokemon' }, to: 'hand', top: 8 }]);
    expect(card("Ciphermaniac's Codebreaking").fx?.effects).toEqual([{ k: 'stack', n: 2 }]);
    // Potion heals, and nothing is hurt in a game against nobody: the only card left out.
    expect(du.unread).toEqual([{ id: 'swsh1-177', name: 'Potion', copies: 1, reason: 'heal' }]);
  });

  it('finds a Pokémon among the top seven cards with Great Ball', () => {
    const { g, p } = table(['Great Ball'], [...grass(10), 'Umbreon', ...grass(3)]);
    mainPhase(g, p, null);
    expect(p.active?.c.name).toBe('Umbreon');
    expect(p.discard).toContain(card('Great Ball').i);
    expect(p.deck.length).toBe(13);
  });

  it('misses one that lies deeper', () => {
    const { g, p } = table(['Great Ball'], ['Umbreon', ...grass(13)]);
    mainPhase(g, p, null);
    expect(p.active?.c.name).toBe('Eevee');
    expect(p.discard).toContain(card('Great Ball').i);
    expect(p.deck).toContain(card('Umbreon').i);
  });

  it('puts the card it wants most on top of the deck with Ciphermaniac\'s Codebreaking', () => {
    const { g, p } = table(["Ciphermaniac's Codebreaking"], ['Umbreon', ...grass(13)]);
    mainPhase(g, p, null);
    expect(p.discard).toContain(card("Ciphermaniac's Codebreaking").i);
    expect(p.deck[p.deck.length - 1]).toBe(card('Umbreon').i);
    expect(p.deck.length).toBe(14);
  });

  it('says in the report which cards sit unused and why', () => {
    const r = pokemonPlaytest(ev, thin, { games: 60, seed: 1 });
    expect(r.plan).toBe("Exeggutor's Solar Beam (GGC, 130)");
    const text = r.lines.join(' | ');
    expect(text).toMatch(/1 card needs an opponent to matter \(Potion\)/);
    expect(text).not.toMatch(/does not know how to play/);
    const charizard = pokemonPlaytest(ev, cards, { games: 20, seed: 1 }).lines.join(' | ');
    expect(charizard).toMatch(/need an opponent to matter \([^)]*Boss's Orders/);
    expect(charizard).toMatch(/The test pilot does not know how to play \d+ of the cards/);
  });
});

describe('gaps the built decks fell into', () => {
  it('takes what an evolution evolves from from another printing when its own does not say', () => {
    // The 30th-anniversary Solgaleo is a Stage 2 with no "evolves from" in the card data.
    const solgaleo = ev.features(index.cardsById.get('30th-105')!);
    expect(solgaleo.text?.ev).toBeUndefined();
    expect(solgaleo.isBasic).toBe(false);
    expect(solgaleo.evolvesFromName).toBe('Cosmoem');
    expect(solgaleo.evolvesFrom).toBe('cosmoem');
    // No Stage 1 or Stage 2 of the catalog passes for a Basic, whether or not a printing places it.
    let evolutions = 0;
    for (const c of index.catalog.cards) {
      if (c.cat !== 'Pokemon' || (c.stage !== 'Stage1' && c.stage !== 'Stage2')) continue;
      evolutions++;
      const f = ev.features(c);
      expect(f.isBasic, c.id).toBe(false);
      expect(f.evolvesFrom, c.id).not.toBe('');
    }
    expect(evolutions).toBeGreaterThan(5000);
    // Four of them with nothing under them are a broken line, and the deck check says what is missing.
    const lines = ev.score(deck([['30th-105', 4], ['sve-008', 16]])).parts.find((p) => p.id === 'lines')!;
    expect(lines.score).toBe(0);
    expect(lines.detail).toBe('Missing: Solgaleo (needs Cosmoem)');
  });

  it('does not take one Energy of a type for the Energy of the attackers that need it', () => {
    // Exeggutor attacks for GGC. One Grass Energy among Darkness does not cover it; three do.
    const energy = (grass: number) =>
      ev.score(deck([['sv08.5-002', 4], ['sv08.5-001', 4], ['sve-009', grass], ['sve-007', 14 - grass]])).parts.find((p) => p.id === 'energy')!.score;
    expect(energy(0)).toBeLessThan(energy(1));
    expect(energy(1)).toBeLessThan(energy(2));
    expect(energy(2)).toBeLessThan(energy(3));
    expect(energy(3)).toBeLessThan(energy(14));
  });
});
