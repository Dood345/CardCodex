import { describe, expect, it } from 'vitest';
import { baseName, boundedDamerau, canonicalNum, normalizeName } from './ocr-normalize';
import { parseHp, parseLines, parseNumbers, parseSetCodes, type ParseContext } from './parse';
import { line } from './fixtures.test-util';

const ctx: ParseContext = {
  abbrs: new Set(['SVI', 'PAL', 'OBF', 'PAF', 'TEF', 'MEG', 'BS', 'SV4', 'BRS']),
  knownTotals: new Set([102, 198, 193, 197, 189, 30]),
};

const nums = (text: string, c: ParseContext = ctx) =>
  parseNumbers(line(text, 0, 0, 100, 10), 0, c).map((n) => `${n.num}/${n.totalPrefix ?? ''}${n.total ?? ''}:${n.quality}`);

describe('canonicalNum', () => {
  it('strips zero padding and upper-cases prefixes', () => {
    expect(canonicalNum('057')).toBe('57');
    expect(canonicalNum('57')).toBe('57');
    expect(canonicalNum('4')).toBe('4');
    expect(canonicalNum('TG01')).toBe('TG1');
    expect(canonicalNum('sv001')).toBe('SV1');
    expect(canonicalNum('SWSH123')).toBe('SWSH123');
    expect(canonicalNum('000')).toBe('0');
  });
});

describe('parseNumbers', () => {
  it('reads clean numbers and strips padding', () => {
    expect(nums('057/198')).toEqual(['57/198:clean']);
    expect(nums('SVI 057/198')).toEqual(['57/198:clean']);
  });
  it('tolerates letter/digit confusions', () => {
    expect(nums('O57/198')).toEqual(['57/198:noisy']);
    expect(nums('57/1O2')).toEqual(['57/102:noisy']);
    expect(nums('S7/I98')).toEqual(['57/198:noisy']);
    expect(nums('B/1O2')).toEqual([]); // no real digit on the left: not a number
    expect(nums('1B/1O2')).toEqual(['18/102:noisy']);
  });
  it('accepts spaced and alternative separators', () => {
    expect(nums('25 / 102')).toEqual(['25/102:clean']);
    expect(nums('25|102')).toEqual(['25/102:clean']);
    expect(nums('25 \\ 102')).toEqual(['25/102:clean']);
    expect(nums('057I198')).toEqual(['57/198:noisy']);
  });
  it('reads prefixed subset numbers', () => {
    expect(nums('TG01/TG30')).toEqual(['TG1/TG30:clean']);
  });
  it('handles real Tesseract readings', () => {
    expect(nums('[¢) 057/198 &')).toEqual(['57/198:clean']);
    expect(nums('(JBI 190/195 %')).toEqual(['190/195:clean']);
    // Base Set "4/102" with the slash read as 7: only with known totals.
    expect(nums('47102 x')).toEqual(['4/102:loose']);
    expect(nums('47102 x', {})).toEqual([]);
  });
  it('ignores copyright lines, years and zero totals', () => {
    expect(nums('©2023 Pokémon / Nintendo / Creatures / GAME FREAK')).toEqual([]);
    expect(nums('12/0')).toEqual([]);
    expect(nums('1999/2000')).toEqual([]);
  });
});

describe('parseSetCodes', () => {
  const codes = (text: string, hasNumber = true) =>
    parseSetCodes(line(text, 0, 0, 10, 10), 0, ctx, hasNumber).map((c) => `${c.code}>${c.abbr}:${c.distance}`);
  it('matches exact codes case-sensitively upper', () => {
    expect(codes('SVI 057/198')).toEqual(['SVI>SVI:0']);
    expect(codes('svi 057/198')).toEqual([]);
  });
  it('tolerates one substituted character for 3–4 letter codes', () => {
    expect(codes('SV1 057/198')).toContain('SV1>SVI:1');
    expect(codes('PAI 012/193')).toContain('PAI>PAL:1');
  });
  it('only accepts 2-letter codes exactly and on number lines', () => {
    expect(codes('BS 4/102')).toEqual(['BS>BS:0']);
    expect(codes('BS', false)).toEqual([]);
  });
});

describe('parseHp', () => {
  const hp = (t: string) => parseHp(line(t, 0, 0, 10, 10), 0).map((h) => `${h.hp}${h.explicit ? '' : '?'}`);
  it('reads explicit HP in all orders', () => {
    expect(hp('HP 120')).toEqual(['120']);
    expect(hp('120 HP')).toEqual(['120']);
    expect(hp('HP120')).toEqual(['120']);
    expect(hp('Charizard HP12O')).toEqual(['120']);
  });
  it('reads loose HP tokens seen on SV cards', () => {
    expect(hp('»90@')).toEqual(['90?']);
    expect(hp('w110')).toEqual(['110?']);
    expect(hp('#330')).toEqual(['330?']);
    expect(hp('HP 15')).toEqual([]);
  });
});

describe('normalizeName', () => {
  it('is case/diacritic/punctuation insensitive', () => {
    expect(normalizeName('Pikachu ex')).toBe(normalizeName('PIKACHU EX'));
    expect(normalizeName('Pokémon Center')).toBe('pokemon center');
    expect(normalizeName("Professor's Research")).toBe(normalizeName('Professor’s Research'));
    expect(normalizeName("Professor's Research")).toBe('professors research');
  });
  it('joins split suffixes and maps the ex logo', () => {
    expect(normalizeName('Charizard VMAX')).toBe('charizard vmax');
    expect(normalizeName('Charizard V-MAX')).toBe('charizard vmax');
    expect(normalizeName('Arceus V STAR')).toBe('arceus vstar');
    expect(normalizeName('Charizard €X')).toBe('charizard ex');
    expect(baseName('charizard vmax')).toBe('charizard');
    expect(baseName('pikachu ex')).toBe('pikachu');
  });
  it('keeps Nidoran genders apart', () => {
    expect(normalizeName('Nidoran♀')).not.toBe(normalizeName('Nidoran♂'));
    expect(normalizeName('Greninja ☆')).toBe('greninja star');
  });
});

describe('boundedDamerau', () => {
  it('computes small distances and bails out early', () => {
    expect(boundedDamerau('wugtrio', 'wugtrio', 2)).toBe(0);
    expect(boundedDamerau('wugtiro', 'wugtrio', 2)).toBe(1); // transposition
    expect(boundedDamerau('furret', 'furet', 2)).toBe(1);
    expect(boundedDamerau('charizard', 'pikachu', 2)).toBe(3);
  });
});

describe('parseLines', () => {
  it('collects all observation kinds with line indices', () => {
    const obs = parseLines(
      [line('Wugtrio', 0, 0, 10, 10), line('HP 90', 0, 0, 10, 10), line('SVI 057/198', 0, 0, 10, 10)],
      ctx,
    );
    expect(obs.names.map((n) => n.norm)).toEqual(['wugtrio', 'svi 057 198']);
    expect(obs.hps.map((h) => [h.hp, h.lineIndex])).toEqual([[90, 1]]);
    expect(obs.numbers.map((n) => [n.num, n.total, n.lineIndex])).toEqual([['57', 198, 2]]);
    expect(obs.setCodes.map((c) => c.abbr)).toEqual(['SVI']);
  });
  it('reads bare numbers next to a set code', () => {
    const obs = parseLines([line('PAL EN 123', 0, 0, 10, 10)], ctx);
    expect(obs.numbers.map((n) => [n.num, n.total])).toEqual([['123', undefined]]);
  });
});
