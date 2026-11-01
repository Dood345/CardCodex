import { describe, expect, it } from 'vitest';
import { buildScanIndex, findNames, printingsOf, scanLines } from './match';
import { cardLines, fixtureCatalog, line } from './fixtures.test-util';
import { iou } from './ocr-normalize';

const index = buildScanIndex(fixtureCatalog);
const ids = (r: ReturnType<typeof scanLines>) => r.map((c) => c.card.id);

describe('buildScanIndex', () => {
  it('never indexes official 0 or empty abbreviations', () => {
    expect(index.setsByOfficial.has(0)).toBe(false);
    expect(index.setsByAbbr.has('')).toBe(false);
    expect(index.setsByAbbr.get('BRS')?.map((s) => s.id)).toEqual(['swsh9tg']);
    expect(index.setsByOfficial.get(198)?.map((s) => s.id)).toEqual(['rv1', 'sv01']); // newest first
  });
  it('keys cards by canonical number regardless of padding', () => {
    expect(index.cardBySetNum.get('sv01|57')?.name).toBe('Wugtrio');
    expect(index.cardBySetNum.get('base1|4')?.name).toBe('Charizard');
    expect(index.cardBySetNum.get('swsh9tg|TG1')?.name).toBe('Flareon');
  });
  it('lists printings newest first', () => {
    expect(printingsOf('PIKACHU', index).map((c) => c.id)).toEqual(['mep-001', 'rv1-063', 'sv01-025', 'base1-58']);
  });
});

describe('findNames', () => {
  it('finds exact, suffix-less and fuzzy names inside noisy lines', () => {
    expect(findNames('25 wugtrio', index)[0]).toMatchObject({ name: 'wugtrio', sim: 1 });
    expect(findNames('wugtiro', index)[0].name).toBe('wugtrio');
    expect(findNames('professors reseach', index)[0].name).toBe('professors research');
    // OCR lost the "ex": exact base-name hit on "pikachu" plus the ex variant.
    const hits = findNames('pikachu', index).map((h) => h.name);
    expect(hits).toContain('pikachu');
    expect(hits).toContain('pikachu ex');
  });
});

describe('matchObservations', () => {
  it('number + total + set code is near-certain', () => {
    const r = scanLines(cardLines(0, 0, { name: 'Wugtrio', hp: 'HP 90', number: 'SVI 057/198' }), index);
    expect(ids(r)).toEqual(['sv01-057']);
    expect(r[0].score).toBeGreaterThan(0.9);
    expect(r[0].confident).toBe(true);
  });

  it('disambiguates sets sharing an official total by the name', () => {
    // 057/198 exists in sv01 (Wugtrio) and rv1 (Pikachu ex).
    const a = scanLines(cardLines(0, 0, { name: 'Wugtrio', number: '057/198' }), index);
    expect(ids(a)).toEqual(['sv01-057']);
    expect(a[0].alternatives[0].card.id).toBe('rv1-057');
    const b = scanLines(cardLines(0, 0, { name: 'PIKACHU EX', number: '057/198' }), index);
    expect(ids(b)).toEqual(['rv1-057']);
  });

  it('prefers the newest set when number + total are all there is, without claiming confidence', () => {
    const r = scanLines(cardLines(0, 0, { number: '057/198' }), index);
    expect(ids(r)).toEqual(['rv1-057']);
    expect(r[0].confident).toBe(false);
    expect(r[0].alternatives.map((x) => x.card.id)).toContain('sv01-057');
  });

  it('name alone gives all printings, newest first, HP as tie-breaker', () => {
    const r = scanLines(cardLines(0, 0, { name: 'Pikachu' }), index);
    expect(ids(r)).toEqual(['mep-001']);
    expect(r[0].alternatives.map((x) => x.card.id).slice(0, 3)).toEqual(['rv1-063', 'sv01-025', 'base1-58']);
    const withHp = scanLines(cardLines(0, 0, { name: 'Pikachu', hp: 'HP 40' }), index);
    expect(ids(withHp)).toEqual(['base1-58']);
  });

  it('tolerates a one-digit misread total when the name agrees (real "190/195" reading)', () => {
    const r = scanLines(cardLines(0, 0, { name: 'Professor’s Research', number: '(JBI 190/195 %' }), index);
    expect(ids(r)).toEqual(['sv01-190']);
    expect(r[0].score).toBeGreaterThan(0.8);
  });

  it('handles OCR-noisy numbers and unpadded old numbers', () => {
    expect(ids(scanLines(cardLines(0, 0, { name: 'Wugtrio', number: 'O57/I98' }), index))).toEqual(['sv01-057']);
    expect(ids(scanLines(cardLines(0, 0, { name: 'Charizard', number: '4/1O2' }), index))).toEqual(['base1-4']);
    // Slash read as 7 plus a broken name line still lands on Base Set Charizard.
    expect(ids(scanLines(cardLines(0, 0, { name: 'Ch d', number: '47102 x', hp: '120 HP' }), index))).toEqual([
      'base1-4',
    ]);
  });

  it('reads Trainer Gallery numbers', () => {
    expect(ids(scanLines(cardLines(0, 0, { name: 'Flareon', number: 'TG01/TG30' }), index))).toEqual(['swsh9tg-TG01']);
  });

  it('does not let Pokémon names in rules text become cards', () => {
    const r = scanLines(
      cardLines(0, 0, {
        name: 'Wugtrio',
        number: '057/198',
        body: ['Evolves from Charizard', 'Put Pikachu on the Stage 1 card'],
      }),
      index,
    );
    expect(ids(r)).toEqual(['sv01-057']);
  });

  it('groups two cards side by side into two candidates', () => {
    const lines = [
      ...cardLines(0, 0, { name: 'Wugtrio', hp: 'HP 90', number: '057/198' }),
      ...cardLines(330, 10, { name: 'Charizard', hp: 'HP 120', number: '4/102' }),
    ];
    const r = scanLines(lines, index);
    expect(ids(r)).toEqual(['sv01-057', 'base1-4']);
    expect(iou(r[0].cardBox, r[1].cardBox)).toBe(0);
    // Chip anchors lie on their own card.
    expect(r[0].bbox.x).toBeLessThan(300);
    expect(r[1].bbox.x).toBeGreaterThan(300);
  });

  it('groups a 2×2 grid of smaller cards', () => {
    const scale = (ls: ReturnType<typeof cardLines>) =>
      ls.map((l) => ({ ...l, bbox: { x: l.bbox.x * 0.6, y: l.bbox.y * 0.6, w: l.bbox.w * 0.6, h: l.bbox.h * 0.6 } }));
    const lines = scale([
      ...cardLines(0, 0, { name: 'Wugtrio', number: '057/198' }),
      ...cardLines(320, 0, { name: 'Pikachu ex', number: '057/198' }),
      ...cardLines(0, 440, { name: 'Flareon', number: 'TG01/TG30' }),
      ...cardLines(320, 440, { name: 'Dewgong', number: '25/102' }),
    ]);
    expect(ids(scanLines(lines, index))).toEqual(['sv01-057', 'rv1-057', 'swsh9tg-TG01', 'base1-25']);
  });

  it('returns nothing for frames without card text', () => {
    expect(scanLines([line('the quick brown fox', 0, 0, 100, 10)], index)).toEqual([]);
    expect(scanLines([], index)).toEqual([]);
  });

  it('is deterministic', () => {
    const lines = cardLines(0, 0, { name: 'Pikachu' });
    expect(JSON.stringify(scanLines(lines, index))).toBe(JSON.stringify(scanLines(lines, index)));
  });
});
