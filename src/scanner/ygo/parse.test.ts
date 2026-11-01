import { describe, expect, it } from 'vitest';
import type { RecognizedLine } from '../types';
import { parseCodes, parseKind, parsePasscodes, parseStats, parseYgoLines, type YgoParseContext } from './parse';

const line = (text: string): RecognizedLine => ({ text, bbox: { x: 0, y: 0, w: 100, h: 10 }, confidence: 0.9 });

const ctx: YgoParseContext = {
  passcodes: new Set([46986414, 89631139, 5318639]),
  codes: new Set(['LOB-005', 'LOB-EN005', 'SDK-001', 'MP14-EN001', 'SOI-ENSE1', 'DB49']),
  prefixes: new Set(['LOB', 'SDK', 'MP14', 'SOI', 'DB49']),
};

describe('parsePasscodes', () => {
  it('reads eight digits with OCR confusions and a split in the middle', () => {
    expect(parsePasscodes(line('46986414'), 0, ctx)[0]).toMatchObject({ digits: '46986414', known: true, noisy: false });
    expect(parsePasscodes(line('4698 6414 1st Edition'), 0, ctx)[0]).toMatchObject({ digits: '46986414', known: true });
    expect(parsePasscodes(line('469864I4'), 0, ctx)[0]).toMatchObject({ digits: '46986414', known: true, noisy: true });
    expect(parsePasscodes(line('12345678'), 0, ctx)[0]).toMatchObject({ digits: '12345678', known: false });
  });
  it('ignores years, stats and words', () => {
    expect(parsePasscodes(line('©1996 KAZUKI TAKAHASHI'), 0, ctx)).toEqual([]);
    expect(parsePasscodes(line('ATK/2500 DEF/2100'), 0, ctx)).toEqual([]);
    expect(parsePasscodes(line('SOBOSSOS'), 0, ctx)).toEqual([]);
  });
});

describe('parseCodes', () => {
  it('normalizes the body and the prefix against the catalog', () => {
    expect(parseCodes(line('LOB-EN005'), 0, ctx)[0]).toMatchObject({ code: 'LOB-EN005', known: true, noisy: false });
    expect(parseCodes(line('L0B-EN0O5'), 0, ctx)[0]).toMatchObject({ code: 'LOB-EN005', known: true, noisy: true });
    expect(parseCodes(line('LOB–005'), 0, ctx)[0]).toMatchObject({ code: 'LOB-005', known: true });
    expect(parseCodes(line('MPl4-EN00l'), 0, ctx)[0]).toMatchObject({ code: 'MP14-EN001', known: true });
    expect(parseCodes(line('SOI-ENSE1'), 0, ctx)[0]).toMatchObject({ code: 'SOI-ENSE1', known: true });
  });
  it('recovers a lost or spaced separator', () => {
    expect(parseCodes(line('LOBEN005'), 0, ctx)[0]).toMatchObject({ code: 'LOB-EN005', known: true });
    expect(parseCodes(line('SDK EN001'), 0, ctx)).toEqual([]); // not a real code
    expect(parseCodes(line('LOB EN005'), 0, ctx)[0]).toMatchObject({ code: 'LOB-EN005', known: true });
  });
  it('reports an unknown body under a known prefix for the near search, and nothing for junk', () => {
    expect(parseCodes(line('LOB-EN009'), 0, ctx)[0]).toMatchObject({ code: 'LOB-EN009', prefix: 'LOB', known: false });
    expect(parseCodes(line('XYZ-EN001'), 0, ctx)).toEqual([]);
    expect(parseCodes(line('once per turn'), 0, ctx)).toEqual([]);
  });
});

describe('parseStats', () => {
  it('reads ATK/DEF, question marks and Link ratings', () => {
    expect(parseStats(line('ATK/2500 DEF/2100'), 0)).toMatchObject({ atk: 2500, def: 2100 });
    expect(parseStats(line('ATK/ 0 DEF/1800'), 0)).toMatchObject({ atk: 0, def: 1800 });
    expect(parseStats(line('ATK/25OO DEF/21OO'), 0)).toMatchObject({ atk: 2500, def: 2100 });
    expect(parseStats(line('ATK/? DEF/?'), 0)).toMatchObject({ atk: undefined, def: undefined });
    expect(parseStats(line('ATK/2000 LINK-2'), 0)).toMatchObject({ atk: 2000, link: 2 });
    expect(parseStats(line('Gains 500 ATK'), 0)).toBeNull();
  });
});

describe('parseKind', () => {
  it('reads bracketed type lines', () => {
    expect(parseKind(line('[Zombie/Tuner/Effect]'), 0)?.words).toEqual(['Zombie', 'Tuner', 'Effect']);
    expect(parseKind(line('[ SPELL CARD ]'), 0)?.words).toEqual(['SPELL CARD']);
    expect(parseKind(line('IDragon / NormalI'), 0)?.words).toEqual(['Dragon', 'Normal']);
    expect(parseKind(line('Spellcaster/Normal'), 0)?.words).toEqual(['Spellcaster', 'Normal']);
    expect(parseKind(line('Target 1 Spell/Trap on the field; destroy that target.'), 0)).toBeNull();
  });
});

describe('parseYgoLines', () => {
  it('collects every observation kind', () => {
    const obs = parseYgoLines(
      [line('Dark Magician'), line('[Spellcaster/Normal]'), line('LOB-005'), line('ATK/2500 DEF/2100'), line('46986414 ©1996 KAZUKI TAKAHASHI')],
      ctx,
    );
    expect(obs.names.map((n) => n.norm)).toContain('dark magician');
    expect(obs.kinds[0].words).toEqual(['Spellcaster', 'Normal']);
    expect(obs.codes[0].code).toBe('LOB-005');
    expect(obs.stats[0]).toMatchObject({ atk: 2500, def: 2100 });
    expect(obs.passcodes[0].digits).toBe('46986414');
  });
});
