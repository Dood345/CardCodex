import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { expansionCandidates, nameKey, numberKey, pairCards, parseExpansionList, parseExpansionPage, SCRYDEX_IMAGES as BUILD_SCRYDEX_IMAGES } from '../../scripts/scrydex-images.mjs';
import { isCacheableImage } from './imageCache';
import { cardImageUrl, isScrydexImage, SCRYDEX_IMAGES, TCGDEX_ASSETS, type Catalog } from './types';

describe('cardImageUrl, Pokémon', () => {
  it('builds the TCGdex path from the flag, or from another base', () => {
    expect(cardImageUrl({ img: true, set: 'sv01', num: '001' }, 'sv', 'low')).toBe('https://assets.tcgdex.net/en/sv/sv01/001/low.webp');
    expect(cardImageUrl({ img: 'https://assets.tcgdex.net/en/swsh/swsh9/TG01', set: 'swsh9tg', num: 'TG01' }, 'swsh', 'high')).toBe(
      'https://assets.tcgdex.net/en/swsh/swsh9/TG01/high.webp',
    );
    expect(cardImageUrl({ set: 'mfb', num: '1' }, 'sv')).toBeUndefined();
  });
  it('uses the sizes Scrydex serves, with no extension, for a Scrydex base', () => {
    const card = { img: 'https://images.scrydex.com/pokemon/sve-1', set: 'sve', num: '001' };
    expect(cardImageUrl(card, 'sv', 'low')).toBe('https://images.scrydex.com/pokemon/sve-1/small');
    expect(cardImageUrl(card, 'sv', 'high')).toBe('https://images.scrydex.com/pokemon/sve-1/large');
    expect(cardImageUrl(card, 'sv')).toBe('https://images.scrydex.com/pokemon/sve-1/small');
  });
  it('tells a Scrydex base from the others', () => {
    expect(isScrydexImage('https://images.scrydex.com/pokemon/sve-1')).toBe(true);
    expect(isScrydexImage('https://images.scrydex.com.example.org/pokemon/sve-1')).toBe(false);
    expect(isScrydexImage('https://assets.tcgdex.net/en/swsh/swsh9/TG01')).toBe(false);
    expect(isScrydexImage(true)).toBe(false);
    expect(isScrydexImage(undefined)).toBe(false);
    expect(BUILD_SCRYDEX_IMAGES).toBe(SCRYDEX_IMAGES);
  });
});

describe('the image store', () => {
  it('keeps Scrydex and YGOPRODeck pictures on the device, and leaves the other hosts to the browser cache', () => {
    expect(isCacheableImage('https://images.scrydex.com/pokemon/sve-1/small')).toBe(true);
    expect(isCacheableImage('https://images.ygoprodeck.com/images/cards_small/89631139.jpg')).toBe(true);
    expect(isCacheableImage('https://assets.tcgdex.net/en/sv/sv01/001/low.webp')).toBe(false);
    expect(isCacheableImage('https://cards.scryfall.io/grid/front/d/5/d573ef03-4730-45aa-93dd-e45ac1dbaf4a.webp')).toBe(false);
    expect(isCacheableImage(undefined)).toBe(false);
  });
});

describe('pairing catalog cards with Scrydex cards (scripts/scrydex-images.mjs)', () => {
  it('compares names without case, accents and punctuation, and numbers without padding', () => {
    expect(nameKey('Pokémon Breeder’s Fields')).toBe(nameKey("Pokemon Breeder's Fields"));
    expect(nameKey('Reshiram & Charizard-GX')).toBe(nameKey('Reshiram and Charizard GX'));
    expect(nameKey('Pikachu')).not.toBe(nameKey('Pikachu ex'));
    expect(numberKey('001')).toBe('1');
    expect(numberKey('SM01')).toBe(numberKey('SM1'));
    expect(numberKey('tg05')).toBe('TG5');
    expect(numberKey('100')).toBe('100');
    expect(numberKey('H10')).toBe('H10');
  });

  const list =
    '<li><a data-turbo="true" class="x" href="/pokemon/expansions/delta-reign/me6"><div class="w-px"></div><span class="truncate">Delta Reign</span></a></li>' +
    '<a href="/pokemon/expansions/storm-emeralda/m6_ja"><span class="truncate">Storm Emeralda</span></a>' +
    '<a href="/pokemon/expansions/hgss-trainer-kit-gyarados/tk4b"><span class="truncate">HGSS Trainer Kit Gyarados</span></a>' +
    '<a href="/pokemon/expansions/mcdonalds-collection-2021/mcd21"><span class="truncate">McDonald&#39;s Collection 2021</span></a>' +
    '<a href="/pokemon/expansions/dragon-majesty/sm75"><span class="truncate">Dragon Majesty</span></a>';
  it('reads the English expansions off the list', () => {
    const expansions = parseExpansionList(list);
    expect(expansions.map((e) => e.id)).toEqual(['me6', 'tk4b', 'mcd21', 'sm75']);
    expect(expansions[2]).toEqual({ id: 'mcd21', slug: 'mcdonalds-collection-2021', name: "McDonald's Collection 2021" });
  });
  it('finds the expansion of a TCGdex set by id, by name or by alias', () => {
    const expansions = parseExpansionList(list);
    expect(expansionCandidates({ id: 'me06', name: 'Delta Reign' }, expansions)).toEqual(['me6']);
    expect(expansionCandidates({ id: 'sm7.5', name: 'Dragon Majesty' }, expansions)).toEqual(['sm75']);
    expect(expansionCandidates({ id: '2021swsh', name: "McDonald's Collection 2021" }, expansions)).toEqual(['mcd21']);
    expect(expansionCandidates({ id: 'tk-hs-g', name: 'HS trainer Kit (Gyarados)' }, expansions)).toEqual(['tk4b']);
    expect(expansionCandidates({ id: 'mfb', name: 'My First Battle' }, expansions)).toEqual([]);
  });

  const tile = (id: string, label: string) =>
    `<a href="/pokemon/cards/x/${id}?variant=normal"><div class="card" data-id="${id}"><img id="${id}-" loading="lazy" src="https://images.scrydex.com/pokemon/${id}/medium" /></div>` +
    `<span class="text-body-12 text-white text-center">${label}</span></a>`;
  const page =
    '<div class="expansion" data-id="expansion-sve"></div>' +
    tile('sve-1', 'Basic Grass Energy #1') +
    tile('sve-2', 'Basic Fire Energy #2') +
    tile('smp-SM246', 'Sabrina &amp; Brycen #SM246') +
    tile('sve-1', 'Basic Grass Energy #1') +
    '<nav class="pagy nav"><a href="/pokemon/expansions/x/sve?page=2">2</a><a href="/pokemon/expansions/x/sve?page=2" aria-label="Next">&gt;</a></nav>';
  it('reads id, name, number and picture off an expansion page, and the next page', () => {
    const { cards, next } = parseExpansionPage(page);
    expect(cards).toEqual([
      { id: 'sve-1', name: 'Basic Grass Energy', num: '1', image: 'https://images.scrydex.com/pokemon/sve-1' },
      { id: 'sve-2', name: 'Basic Fire Energy', num: '2', image: 'https://images.scrydex.com/pokemon/sve-2' },
      { id: 'smp-SM246', name: 'Sabrina & Brycen', num: 'SM246', image: 'https://images.scrydex.com/pokemon/smp-SM246' },
    ]);
    expect(next).toBe('/pokemon/expansions/x/sve?page=2');
    expect(parseExpansionPage(tile('sve-1', 'Basic Grass Energy #1')).next).toBeUndefined();
  });

  const ours = (id: string, num: string, name: string) => ({ id, set: 'x', num, name });
  const theirs = (id: string, num: string, name: string) => ({ id, num, name, image: `https://images.scrydex.com/pokemon/${id}` });
  it('pairs a card with the same number only when the name agrees', () => {
    const cards = [ours('x-001', '001', 'Bulbasaur'), ours('x-002', '002', 'Ivysaur'), ours('x-003', '003', 'Venusaur')];
    const { pairs, mismatched } = pairCards(cards, cards, [theirs('y-1', '1', 'Bulbasaur'), theirs('y-2', '2', 'Charmander'), theirs('y-4', '4', 'Squirtle')]);
    expect(pairs.get(cards[0])?.id).toBe('y-1');
    expect(pairs.has(cards[1])).toBe(false);
    expect(pairs.has(cards[2])).toBe(false);
    expect(mismatched).toEqual(['x-002 "Ivysaur" vs y-2 "Charmander"']);
  });
  it('pairs by name where the numbering differs, but only a name that occurs once on both sides', () => {
    const cards = [ours('x-004', '004', 'Genesect EX'), ours('x-005', '005', 'Unown'), ours('x-006', '006', 'Unown'), ours('x-007', '007', 'Mew')];
    const { pairs, byName } = pairCards(cards, cards, [theirs('y-4', '4', 'Charizard'), theirs('y-9', '9', 'Genesect-EX'), theirs('y-10', '10', 'Unown'), theirs('y-11', '11', 'Mew'), theirs('y-12', '12', 'Mew')]);
    expect(pairs.get(cards[0])?.id).toBe('y-9');
    expect(pairs.has(cards[1])).toBe(false);
    expect(pairs.has(cards[2])).toBe(false);
    expect(pairs.has(cards[3])).toBe(false);
    expect(byName).toBe(1);
  });
  it('counts a name against the whole set, not only the cards that still lack a picture', () => {
    const set = [ours('x-001', '001', 'Pikachu'), ours('x-050', '050', 'Pikachu')];
    const { pairs } = pairCards([set[1]], set, [theirs('y-7', '7', 'Pikachu')]);
    expect(pairs.size).toBe(0);
  });
});

describe('public/data/catalog.json pictures', () => {
  const dataDir = new URL('../../public/data/', import.meta.url);
  const catalog = JSON.parse(readFileSync(new URL('catalog.json', dataDir), 'utf8')) as Catalog;
  const hashed = new Set((JSON.parse(readFileSync(new URL('hashes.json', dataDir), 'utf8')) as { ids: string[] }).ids);
  const scrydex = catalog.cards.filter((c) => isScrydexImage(c.img));

  it('names a picture by the TCGdex flag, a TCGdex path or a Scrydex card, and nothing else', () => {
    for (const c of catalog.cards) {
      if (c.img === undefined || c.img === true) continue;
      const ok = c.img.startsWith(`${TCGDEX_ASSETS}/`) || /^https:\/\/images\.scrydex\.com\/pokemon\/[A-Za-z0-9._-]+$/.test(c.img);
      expect(ok, `${c.id}: ${c.img}`).toBe(true);
    }
  });
  it('fills in the cards TCGdex has no picture of from Scrydex: over a thousand, the basic Energy sets among them', () => {
    expect(scrydex.length).toBeGreaterThan(1000);
    const byId = new Map(catalog.cards.map((c) => [c.id, c]));
    expect(byId.get('sve-001')?.img).toBe('https://images.scrydex.com/pokemon/sve-1');
    expect(new Set(scrydex.map((c) => c.img)).size).toBe(scrydex.length);
  });
  it('has a scanner hash for every Scrydex picture (npm run hashes after npm run catalog)', () => {
    const missing = scrydex.filter((c) => !hashed.has(c.id)).map((c) => c.id);
    expect(missing).toEqual([]);
  });
});
