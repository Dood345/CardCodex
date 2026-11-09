import { describe, expect, it } from 'vitest';
import { buildIndex } from '@/data/catalog';
import { groupsOf } from '@/data/collection';
import { decodeDeck, encodeDeck, DECK_LINK_PREFIX } from '@/data/deck-code';
import { decodeDeckText, encodeDeckFile } from '@/data/deck-file';
import { limitHint, overLimit } from '@/data/decks';
import { routeForUrl } from '@/app/deepLinks';
import { searchCards } from '@/data/search';
import { cardImageUrl } from '@/data/types';
import { MTG_DECK_RULES, sectionHint } from '../deck-rules';
import { gameOfId, isGameId } from '../ids';
import { expandMtgCatalog, isBasicLand, mtgCategory } from './catalog';
import { scryfallCards, scryfallSets } from './fixture.test-util';
import { mtg } from './index';
import { createMtgMatcher } from './match';
import { buildMtgCatalog, compareCollector, skipReason } from './scryfall';

const built = buildMtgCatalog(scryfallCards, scryfallSets, '2026-11-02T00:00:00Z');
const file = built.file;
const catalog = expandMtgCatalog(file);
const byId = new Map(catalog.cards.map((c) => [c.id, c]));

describe('buildMtgCatalog (Scryfall → file)', () => {
  it('keeps English paper game cards and says why the rest were left out', () => {
    expect(file.printings).toHaveLength(7);
    expect(Object.fromEntries(built.skipped)).toEqual({
      'not English': 1,
      'digital only': 1,
      'token set': 1,
      'memorabilia set': 1,
      'art_series layout': 1,
      oversized: 1,
    });
  });

  it('makes one row per Oracle card, sorted by name, and one per printing', () => {
    expect(file.cards.map((c) => c.name)).toEqual([
      'Delver of Secrets // Insectile Aberration',
      'Dryad Arbor',
      'Lightning Bolt',
      'Ral, Storm Conduit',
      // A reversible card's two identical faces collapse to one name.
      'Sol Ring',
    ]);
    const bolt = file.cards.findIndex((c) => c.name === 'Lightning Bolt');
    expect(file.printings.filter((p) => p[0] === bolt)).toHaveLength(3);
  });

  it('orders sets by release date and synthesizes sets /sets does not list', () => {
    expect(file.sets.map((s) => s.id)).toEqual(['lea', 'm10', 'isd', 'war', 'sld', 'xyz']);
    expect(file.sets.find((s) => s.id === 'm10')).toEqual({ id: 'm10', name: 'Magic 2010', date: '2009-07-17', total: 2 });
    expect(file.sets.at(-1)).toEqual({ id: 'xyz', name: 'Mystery Box', date: '2024-01-01', total: 1 });
    expect(built.synthesizedSets).toEqual(['xyz']);
  });

  it('reads costs, colors and stats from the front face of double-faced cards', () => {
    const delver = file.cards[0];
    expect(delver).toEqual({
      oid: 'c9ed6d45-5a5c-4b3a-bb6e-4b2f1a3f5c4e',
      name: 'Delver of Secrets // Insectile Aberration',
      tl: 'Creature — Human Wizard // Creature — Human Insect',
      cost: '{U}',
      mv: 1,
      col: 'U',
      pow: '1',
      tou: '1',
    });
    // Reversible cards carry the Oracle id on their faces; colorless cards have no `col`.
    expect(file.cards[4]).toMatchObject({ oid: '6ad8011d-3471-4369-9d68-b264cc027487', tl: 'Artifact', cost: '{1}', mv: 1 });
    expect(file.cards[4].col).toBeUndefined();
    // Colors in WUBRG order whatever order Scryfall lists them.
    expect(file.cards[3]).toMatchObject({ col: 'UR', loy: '4', mv: 4 });
  });

  it('orders printings by set, then collector number, and shares artist names', () => {
    const rows = file.printings.map((p) => `${file.sets[p[1]].id}-${p[2]}`);
    expect(rows).toEqual(['lea-161', 'm10-10a', 'm10-146', 'isd-51', 'war-211', 'sld-1638★', 'xyz-2']);
    const lea = file.printings[0];
    expect(lea[3]).toBe('c');
    expect(lea[4]).toBe('d573ef03-4730-45aa-93dd-e45ac1dbaf4a');
    expect(file.artists[lea[5]]).toBe('Christopher Rush');
    expect(file.artists.filter((a) => a === 'Christopher Rush')).toHaveLength(1);
  });

  it('refuses two cards with the same set and collector number', () => {
    const dup = { ...scryfallCards[0], id: 'ffffffff-0000-0000-0000-000000000000' };
    expect(() => buildMtgCatalog([scryfallCards[0], dup], scryfallSets, '')).toThrow(/duplicate printing m10-146/);
  });

  it('skips by reason', () => {
    expect(skipReason(scryfallCards[0])).toBeNull();
    expect(skipReason({ ...scryfallCards[0], games: ['arena'] })).toBe('digital only');
    expect(skipReason({ ...scryfallCards[0], set_type: 'minigame' })).toBe('minigame set');
    expect(skipReason({ ...scryfallCards[0], layout: 'emblem' })).toBe('emblem layout');
  });

  it('sorts collector numbers numerically, then the rest', () => {
    expect(['10', '2', '10a', 'PF19-1', '1', '★1', '2b'].sort(compareCollector)).toEqual(['1', '2', '2b', '10', '10a', '★1', 'PF19-1']);
  });
});

describe('expandMtgCatalog (file → Catalog)', () => {
  it('makes prefixed printing ids with lowercase set codes', () => {
    expect(catalog.game).toBe('mtg');
    expect(catalog.cards.map((c) => c.id)).toEqual(['mtg:lea-161', 'mtg:m10-10a', 'mtg:m10-146', 'mtg:isd-51', 'mtg:war-211', 'mtg:sld-1638★', 'mtg:xyz-2']);
    for (const c of catalog.cards) expect(gameOfId(c.id)).toBe('mtg');
  });

  it('carries the card facts onto every printing', () => {
    expect(byId.get('mtg:lea-161')).toEqual({
      id: 'mtg:lea-161',
      set: 'lea',
      num: '161',
      name: 'Lightning Bolt',
      cat: 'Instant',
      types: ['Red'],
      sid: 'd573ef03-4730-45aa-93dd-e45ac1dbaf4a',
      oid: '4457ed35-7c10-48c8-9776-456485fdf070',
      sub: 'Instant',
      mv: 1,
      cost: '{R}',
      rarity: 'Common',
      artist: 'Christopher Rush',
    });
    expect(byId.get('mtg:war-211')).toMatchObject({ cat: 'Planeswalker', types: ['Blue', 'Red'], loy: '4', rarity: 'Rare' });
    expect(byId.get('mtg:xyz-2')).toMatchObject({ cat: 'Artifact', types: ['Colorless'] });
    expect(byId.get('mtg:m10-10a')).toMatchObject({ cat: 'Creature', pow: '1', tou: '1' });
  });

  it('groups sets by release year, abbreviated by their code, without a printed total', () => {
    expect(catalog.sets[0]).toMatchObject({ id: 'lea', series: '1993', seriesName: '1993', official: 0, total: 1, abbr: 'LEA' });
  });

  it('indexes the printings of one card together, newest first, and finds them by name, code and number', () => {
    const index = buildIndex(catalog, []);
    expect(index.cardsByName.get('lightning bolt')?.map((c) => c.id)).toEqual(['mtg:sld-1638★', 'mtg:m10-146', 'mtg:lea-161']);
    expect(index.types).toEqual(['Blue', 'Colorless', 'Green', 'Red']);
    expect(searchCards(index, 'lightning bolt').cards).toHaveLength(3);
    expect(searchCards(index, 'lea 161').cards.map((c) => c.id)).toEqual(['mtg:lea-161']);
    expect(searchCards(index, 'insectile').cards.map((c) => c.id)).toEqual(['mtg:isd-51']);
    expect(searchCards(index, 'wizard').cards.map((c) => c.id)).toEqual(['mtg:isd-51']);
    expect(searchCards(index, 'rush').cards.map((c) => c.id).sort()).toEqual(['mtg:lea-161', 'mtg:sld-1638★']);
    expect(searchCards(index, '', { cat: 'Creature' }).cards.map((c) => c.id).sort()).toEqual(['mtg:isd-51', 'mtg:m10-10a']);
    expect(searchCards(index, '', { type: 'Red' }).total).toBe(4);
  });

  it('counts an Oracle card once in the collection stats', () => {
    expect(groupsOf(byId.get('mtg:lea-161')!)).toEqual(['4457ed35-7c10-48c8-9776-456485fdf070']);
    expect(groupsOf(byId.get('mtg:m10-146')!)).toEqual(groupsOf(byId.get('mtg:lea-161')!));
  });
});

describe('images', () => {
  it('uses Scryfall CDN images by Scryfall id', () => {
    const bolt = byId.get('mtg:lea-161')!;
    expect(cardImageUrl(bolt, '', 'low')).toBe('https://cards.scryfall.io/grid/front/d/5/d573ef03-4730-45aa-93dd-e45ac1dbaf4a.webp');
    expect(cardImageUrl(bolt, '', 'high')).toBe('https://cards.scryfall.io/display/front/d/5/d573ef03-4730-45aa-93dd-e45ac1dbaf4a.webp');
  });
});

describe('categories', () => {
  it('derives the category from the type line, first match wins', () => {
    expect(mtgCategory('Artifact Creature — Golem')).toBe('Creature');
    expect(mtgCategory('Land Creature — Forest Dryad')).toBe('Creature');
    expect(mtgCategory('Artifact Land')).toBe('Land');
    expect(mtgCategory('Legendary Enchantment Land — Urza’s Saga')).toBe('Land');
    expect(mtgCategory('Legendary Planeswalker — Jace')).toBe('Planeswalker');
    expect(mtgCategory('Battle — Siege')).toBe('Battle');
    expect(mtgCategory('Kindred Instant — Goblin')).toBe('Instant');
    expect(mtgCategory('Sorcery')).toBe('Sorcery');
    expect(mtgCategory('Legendary Artifact — Equipment')).toBe('Artifact');
    expect(mtgCategory('Enchantment — Aura')).toBe('Enchantment');
    expect(mtgCategory('Instant // Sorcery')).toBe('Instant');
    // Front face decides: a creature that transforms into a land is a Creature.
    expect(mtgCategory('Legendary Creature — Vampire // Legendary Land')).toBe('Creature');
    expect(mtgCategory('Conspiracy')).toBe('Other');
    expect(mtgCategory('Stickers')).toBe('Other');
  });

  it('recognises basic lands', () => {
    expect(isBasicLand({ sub: 'Basic Land — Forest' })).toBe(true);
    expect(isBasicLand({ sub: 'Basic Snow Land — Island' })).toBe(true);
    expect(isBasicLand({ sub: 'Basic Land' })).toBe(true);
    expect(isBasicLand({ sub: 'Land — Forest Island' })).toBe(false);
    expect(isBasicLand({ sub: 'Legendary Land' })).toBe(false);
  });
});

describe('ids', () => {
  it('knows the three games and their id prefixes', () => {
    expect(isGameId('mtg')).toBe(true);
    expect(isGameId('magic')).toBe(false);
    expect(gameOfId('mtg:lea-161')).toBe('mtg');
    expect(gameOfId('mtg:plst-PF19-1')).toBe('mtg');
    expect(gameOfId('ygo:LOB-EN001')).toBe('ygo');
    expect(gameOfId('sv01-057')).toBe('pokemon');
  });
});

describe('createMtgMatcher (scanner seam)', () => {
  const matcher = createMtgMatcher(catalog);
  const line = (text: string, y: number) => ({ text, bbox: { x: 10, y, w: 200, h: 20 }, confidence: 0.9 });

  it('names the printing from the name plus set code and collector number', () => {
    const [c] = matcher.scanLines([line('Lightning Bolt', 10), line('Instant', 300), line('0146 C', 560), line('M10 • EN', 580)]);
    expect(c.card.id).toBe('mtg:m10-146');
    expect(c.confident).toBe(true);
    expect(c.alternatives.map((a) => a.card.id)).toEqual(['mtg:sld-1638★', 'mtg:lea-161']);
  });

  it('offers every printing when only the name is read, and matches a front-face name', () => {
    const [bolt] = matcher.scanLines([line('Lightning Bolt', 10)]);
    expect(bolt.card.id).toBe('mtg:sld-1638★');
    expect(bolt.confident).toBe(false);
    const [delver] = matcher.scanLines([line('Delver of Secrets', 10)]);
    expect(delver.card.id).toBe('mtg:isd-51');
    expect(delver.confident).toBe(true);
  });

  it('finds nothing in unrelated text and looks cards up by id', () => {
    expect(matcher.scanLines([line('Hello there', 10)])).toEqual([]);
    expect(matcher.lookup?.('mtg:lea-161')?.set.name).toBe('Limited Edition Alpha');
    expect(matcher.artworkCards).toBeUndefined();
  });
});

describe('deck rules', () => {
  const index = buildIndex(catalog, []);
  const forest = { ...byId.get('mtg:m10-146')!, id: 'mtg:m10-246', name: 'Forest', cat: 'Land' as const, sub: 'Basic Land — Forest' };
  index.cardsById.set(forest.id, forest);

  it('gives Magic a deck of at least 60 cards and a sideboard of at most 15', () => {
    expect(mtg.deckRules).toBe(MTG_DECK_RULES);
    const [main, side] = MTG_DECK_RULES.sections;
    expect(MTG_DECK_RULES.sections).toHaveLength(2);
    expect(MTG_DECK_RULES.side).toBe(true);
    expect(MTG_DECK_RULES.sectionOf(undefined, {})).toBe('main');
    expect(MTG_DECK_RULES.sectionOf(undefined, { zone: 'side' })).toBe('side');
    expect(sectionHint(side, 15)).toBeNull();
    expect(sectionHint(side, 16)).toBe('A sideboard has at most 15 cards: 1 over.');
    expect(sectionHint(main, 59)).toBe('A Magic deck has at least 60 cards: 1 to go.');
    expect(sectionHint(main, 60)).toBeNull();
    expect(sectionHint(main, 75)).toBeNull();
  });

  it('allows four copies of a card over all its printings, any number of basic lands', () => {
    const cards = [
      { cardId: 'mtg:lea-161', qty: 2 },
      { cardId: 'mtg:m10-146', qty: 3 },
      { cardId: forest.id, qty: 24 },
    ];
    expect(MTG_DECK_RULES.copyLimit(forest)).toBe(Infinity);
    expect(limitHint(MTG_DECK_RULES, overLimit(MTG_DECK_RULES, cards, index))).toBe('4 copies at most: Lightning Bolt ×5.');
    // The sideboard counts toward the limit.
    const split = [
      { cardId: 'mtg:lea-161', qty: 3 },
      { cardId: 'mtg:lea-161', qty: 2, zone: 'side' as const },
    ];
    expect(limitHint(MTG_DECK_RULES, overLimit(MTG_DECK_RULES, split, index))).toBe('4 copies at most: Lightning Bolt ×5.');
  });
});

describe('deck sharing', () => {
  // Collector numbers may carry ★ (and †, Φ): the ids must survive every way a deck travels.
  const deck = {
    game: 'mtg' as const,
    name: 'Burn',
    cards: [
      { cardId: 'mtg:sld-1638★', qty: 4 },
      { cardId: 'mtg:plst-PF19-1', qty: 1 },
      { cardId: 'mtg:lea-294', qty: 20 },
    ],
  };

  it('round-trips a Magic deck through the share code, the link and the .ccdeck file', async () => {
    const code = await encodeDeck(deck);
    expect(code).toMatch(/^CCD1\.[A-Za-z0-9_-]+$/);
    expect(await decodeDeck(code)).toEqual(deck);
    const link = `${DECK_LINK_PREFIX}${code}`;
    expect(routeForUrl(link)).toBe(`/decks/import/${code}`);
    expect(await decodeDeckText(encodeDeckFile(deck))).toEqual(deck);
  });
});
