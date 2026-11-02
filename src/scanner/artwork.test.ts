import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARTWORK_GROUP_BITS,
  ARTWORK_MATCH_BITS,
  ARTWORK_WEAK_BITS,
  artworkBonus,
  hashFileFor,
  loadHashTable,
  mergeArtworkEvidence,
  resetHashTables,
  sameArtworkGroup,
  type CardLookup,
} from './artwork';
import { HASH_SPEC, POKEMON_HASH_SPEC, YGO_HASH_SPEC, encodeHashes, type HashHit } from './hash';
import { fixtureCatalog } from './fixtures.test-util';
import type { ScanCandidate } from './types';

const setById = new Map(fixtureCatalog.sets.map((s) => [s.id, s]));
const lookup: CardLookup = (id) => {
  const card = fixtureCatalog.cards.find((c) => c.id === id);
  const set = card && setById.get(card.set);
  return card && set ? { card, set } : undefined;
};
const region = { x: 0, y: 0, w: 1000, h: 1400 };
const box = { x: 10, y: 10, w: 900, h: 1300 };

function cand(id: string, score: number, evidence: string[], opts: { confident?: boolean; alternatives?: [string, number, string[]][] } = {}): ScanCandidate {
  const { card, set } = lookup(id)!;
  return {
    key: id,
    card,
    set,
    score,
    margin: 0.2,
    confident: opts.confident ?? false,
    evidence,
    bbox: box,
    cardBox: box,
    alternatives: (opts.alternatives ?? []).map(([aid, s, ev]) => ({ ...lookup(aid)!, score: s, evidence: ev })),
  };
}
const hit = (id: string, distance: number): HashHit => ({ index: 0, id, distance });

describe('artworkBonus / sameArtworkGroup', () => {
  it('rewards a close picture, fades past the match limit, is 0 past the weak limit', () => {
    expect(artworkBonus(0)).toBeCloseTo(0.9, 6);
    expect(artworkBonus(12)).toBeCloseTo(0.725, 6);
    expect(artworkBonus(ARTWORK_MATCH_BITS)).toBeCloseTo(0.55, 6);
    expect(artworkBonus(ARTWORK_MATCH_BITS + 1)).toBeLessThan(0.25);
    expect(artworkBonus(ARTWORK_WEAK_BITS)).toBe(0);
    expect(artworkBonus(100)).toBe(0);
    for (let d = 0; d < 128; d++) expect(artworkBonus(d)).toBeGreaterThanOrEqual(artworkBonus(d + 1));
  });

  it('groups the printings of one picture around the best hit', () => {
    const hits = [hit('base1-4', 8), hit('sv01-125', 8 + ARTWORK_GROUP_BITS), hit('rv1-025', 8 + ARTWORK_GROUP_BITS + 1), hit('sv01-057', 40)];
    expect(sameArtworkGroup(hits).map((h) => h.id)).toEqual(['base1-4', 'sv01-125']);
    expect(sameArtworkGroup([hit('base1-4', ARTWORK_WEAK_BITS + 1)])).toEqual([]);
    expect(sameArtworkGroup([])).toEqual([]);
  });
});

describe('mergeArtworkEvidence', () => {
  it('leaves the OCR result alone when no picture comes close', () => {
    const ocr = [cand('sv01-057', 0.5, ['name "Wugtrio"'])];
    const out = mergeArtworkEvidence(ocr, [hit('base1-4', 40)], lookup, region);
    expect(out).toEqual(ocr);
    expect(mergeArtworkEvidence(ocr, [], lookup, region)).toEqual(ocr);
  });

  it('a match plus a read number makes the pocket confident on that printing', () => {
    // OCR read "57/198" and the name: sv01-057 at 0.7 but another set shares the total, so not confident.
    const ocr = [cand('sv01-057', 0.7, ['number 57/198', 'name "Wugtrio"'], { alternatives: [['rv1-057', 0.55, ['number 57/198']]] })];
    const out = mergeArtworkEvidence(ocr, [hit('sv01-057', 9), hit('base1-4', 45)], lookup, region);
    expect(out[0].card.id).toBe('sv01-057');
    expect(out[0].confident).toBe(true);
    expect(out[0].score).toBe(1);
    expect(out[0].evidence).toEqual(['number 57/198', 'name "Wugtrio"', 'artwork 9']);
    expect(out[0].alternatives[0].card.id).toBe('rv1-057');
    expect(out[0].bbox).toEqual(box);
  });

  it('a match alone ranks the picture first but is not confident; its reprints are the alternatives', () => {
    // Two printings of one picture (Pikachu base1-58 and sv01-025 stand in), nothing read.
    const out = mergeArtworkEvidence([], [hit('base1-58', 10), hit('sv01-025', 13), hit('rv1-063', 44)], lookup, region);
    expect(out).toHaveLength(1);
    expect(out[0].card.id).toBe('base1-58');
    expect(out[0].confident).toBe(false);
    expect(out[0].score).toBeCloseTo(artworkBonus(10), 6);
    expect(out[0].evidence).toEqual(['artwork 10']);
    expect(out[0].alternatives.map((a) => a.card.id)).toEqual(['sv01-025']);
    expect(out[0].bbox).toEqual(region);
    expect(out[0].cardBox).toEqual(region);
  });

  it('with the name read and a single-printing picture, the match is confident', () => {
    const ocr = [cand('sv01-057', 0.45, ['name "Wugtrio"'])];
    const out = mergeArtworkEvidence(ocr, [hit('sv01-057', 11), hit('base1-4', 38)], lookup, region);
    expect(out[0].card.id).toBe('sv01-057');
    expect(out[0].confident).toBe(true);
    // Two printings of the picture → the name alone no longer settles it.
    const two = mergeArtworkEvidence(ocr, [hit('sv01-057', 11), hit('rv1-057', 14)], lookup, region);
    expect(two[0].card.id).toBe('sv01-057');
    expect(two[0].confident).toBe(false);
    expect(two[0].alternatives[0].card.id).toBe('rv1-057');
  });

  it('a strong match outranks a name-only read of another card and lists it after the picture', () => {
    // OCR fuzzy-matched the name to Pikachu printings; the picture is Charizard.
    const ocr = [cand('sv01-025', 0.45, ['name "Pikachu"'], { alternatives: [['base1-58', 0.44, ['name "Pikachu"']]] })];
    const out = mergeArtworkEvidence(ocr, [hit('base1-4', 8), hit('sv01-025', 50)], lookup, region);
    expect(out[0].card.id).toBe('base1-4');
    expect(out[0].confident).toBe(false);
    expect(out[0].alternatives.map((a) => a.card.id)).toEqual(['sv01-025', 'base1-58']);
  });

  it('a confident OCR read survives a picture that agrees or says nothing, not one that points elsewhere', () => {
    const ocr = [cand('sv01-057', 0.95, ['number 57/198', 'name "Wugtrio"'], { confident: true })];
    expect(mergeArtworkEvidence(ocr, [hit('sv01-057', 20)], lookup, region)[0].confident).toBe(true);
    expect(mergeArtworkEvidence(ocr, [hit('base1-4', 30)], lookup, region)[0].confident).toBe(true);
    const contradicted = mergeArtworkEvidence(ocr, [hit('base1-4', 12)], lookup, region);
    expect(contradicted[0].card.id).toBe('sv01-057');
    expect(contradicted[0].confident).toBe(false);
    expect(contradicted[0].alternatives[0].card.id).toBe('base1-4');
  });

  it('breaks ties between a picture’s printings by recency and skips ids the catalog lacks', () => {
    const out = mergeArtworkEvidence([], [hit('gone-1', 5), hit('base1-25', 9), hit('rv1-190', 9)], lookup, region);
    expect(out[0].card.id).toBe('rv1-190');
    expect(out[0].alternatives.map((a) => a.card.id)).toEqual(['base1-25']);
  });

  it('keeps other physical cards the OCR saw behind the pocket’s card', () => {
    const ocr = [cand('sv01-057', 0.5, ['name "Wugtrio"']), cand('base1-4', 0.4, ['name "Charizard"'])];
    const out = mergeArtworkEvidence(ocr, [hit('sv01-057', 10)], lookup, region);
    expect(out.map((c) => c.card.id)).toEqual(['sv01-057', 'base1-4']);
  });
});

describe('loadHashTable', () => {
  afterEach(() => {
    resetHashTables();
    vi.unstubAllGlobals();
  });

  it('knows which games have a table', () => {
    expect(hashFileFor('pokemon')).toBe('hashes.json');
    expect(hashFileFor('ygo')).toBe('ygo/hashes.json');
    expect(hashFileFor('other')).toBeNull();
  });

  it('fetches once, decodes, and shares the promise; resolves null without a file or on a bad spec', async () => {
    const file = { version: 1, builtAt: '', game: 'pokemon', spec: HASH_SPEC, ids: ['a', 'b'], hashes: encodeHashes(new Uint32Array(8).fill(7)) };
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => file }));
    vi.stubGlobal('fetch', fetchMock);
    const [t1, t2] = await Promise.all([loadHashTable('pokemon'), loadHashTable('pokemon')]);
    expect(t1).toBe(t2);
    expect(t1?.ids).toEqual(['a', 'b']);
    expect(t1?.spec).toBe(POKEMON_HASH_SPEC);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/data\/hashes\.json$/);
    expect(await loadHashTable('other')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resetHashTables();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    expect(await loadHashTable('pokemon')).toBeNull();
    resetHashTables();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...file, spec: 'old' }) })));
    expect(await loadHashTable('pokemon')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('loads the Yu-Gi-Oh! table from its own file with its own spec, passcodes as ids', async () => {
    const file = { version: 1, builtAt: '', game: 'ygo', spec: YGO_HASH_SPEC.id, ids: ['46986414', '89631139'], hashes: encodeHashes(new Uint32Array(8).fill(9)) };
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => file }));
    vi.stubGlobal('fetch', fetchMock);
    const t = await loadHashTable('ygo');
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/data\/ygo\/hashes\.json$/);
    expect(t?.spec).toBe(YGO_HASH_SPEC);
    expect(t?.indexOf.get('89631139')).toBe(1);
    // A Pokémon table served under the Yu-Gi-Oh! name is refused (the spec names the game).
    resetHashTables();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...file, spec: HASH_SPEC }) })));
    expect(await loadHashTable('ygo')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('mergeArtworkEvidence with Yu-Gi-Oh! evidence', () => {
  // The Yu-Gi-Oh! matcher's evidence strings: "code LOB-EN005" names the printing, "passcode 46986414" the card.
  const ygoSets = [
    { id: 'lob', name: 'Legend of Blue Eyes White Dragon', series: '2002', seriesName: '2002', releaseDate: '2002-03-08', official: 0, total: 126, abbr: 'LOB' },
    { id: 'sdk', name: 'Starter Deck: Kaiba', series: '2002', seriesName: '2002', releaseDate: '2002-03-29', official: 0, total: 50, abbr: 'SDK' },
  ];
  const ygoCards = [
    { id: 'ygo:LOB-005', set: 'lob', num: 'LOB-005', name: 'Dark Magician', cat: 'Monster' as const, pc: 46986414 },
    { id: 'ygo:SDK-001', set: 'sdk', num: 'SDK-001', name: 'Blue-Eyes White Dragon', cat: 'Monster' as const, pc: 89631139 },
    { id: 'ygo:LOB-001', set: 'lob', num: 'LOB-001', name: 'Blue-Eyes White Dragon', cat: 'Monster' as const, pc: 89631139 },
  ];
  const ygoLookup: CardLookup = (id) => {
    const card = ygoCards.find((c) => c.id === id);
    const set = card && ygoSets.find((s) => s.id === card.set);
    return card && set ? { card, set } : undefined;
  };
  const ygoCand = (id: string, score: number, evidence: string[]): ScanCandidate => ({
    key: id,
    ...ygoLookup(id)!,
    score,
    margin: 0.1,
    confident: false,
    evidence,
    bbox: box,
    cardBox: box,
    alternatives: [],
  });

  it('a picture match plus a read set code is confident on that printing; the passcode alone is not', () => {
    // Blue-Eyes: one picture (passcode), two printings; the hits arrive expanded to printings (page.ts).
    const hits = [hit('ygo:SDK-001', 8), hit('ygo:LOB-001', 8)];
    const code = mergeArtworkEvidence([ygoCand('ygo:LOB-001', 0.7, ['code LOB-001'])], hits, ygoLookup, region);
    expect(code[0].card.id).toBe('ygo:LOB-001');
    expect(code[0].confident).toBe(true);
    expect(code[0].evidence).toEqual(['code LOB-001', 'artwork 8']);
    const passcode = mergeArtworkEvidence([ygoCand('ygo:SDK-001', 0.73, ['passcode 89631139'])], hits, ygoLookup, region);
    expect(passcode[0].confident).toBe(false);
    expect(passcode[0].alternatives.map((a) => a.card.id)).toEqual(['ygo:LOB-001']);
    // Dark Magician exists in one printing here: picture + passcode settles it.
    const single = mergeArtworkEvidence([ygoCand('ygo:LOB-005', 0.73, ['passcode 46986414'])], [hit('ygo:LOB-005', 10)], ygoLookup, region);
    expect(single[0].confident).toBe(true);
  });

  it('a hit alone shows the newest printing with the others as alternatives', () => {
    const out = mergeArtworkEvidence([], [hit('ygo:LOB-001', 12), hit('ygo:SDK-001', 12)], ygoLookup, region);
    expect(out[0].card.id).toBe('ygo:SDK-001');
    expect(out[0].confident).toBe(false);
    expect(out[0].evidence).toEqual(['artwork 12']);
    expect(out[0].alternatives.map((a) => a.card.id)).toEqual(['ygo:LOB-001']);
  });
});
