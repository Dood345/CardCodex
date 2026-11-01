/**
 * Yu-Gi-Oh! matcher on synthetic lines laid out like a 600×875 card (59×86 mm
 * aspect): name at 8% height, type line at 77%, set code right-aligned at
 * 72.5%, ATK/DEF at 92.5%, passcode bottom-left at 96%.
 */
import { describe, expect, it } from 'vitest';
import { expandYgoCatalog } from '@/games/ygo/catalog';
import { ygoFile } from '@/games/ygo/fixture.test-util';
import type { RecognizedLine } from '../types';
import { buildYgoScanIndex, createYgoMatcher, scanYgoLines } from './match';

const catalog = expandYgoCatalog(ygoFile);
const index = buildYgoScanIndex(catalog);
const ids = (r: ReturnType<typeof scanYgoLines>) => r.map((c) => c.card.id);

const line = (text: string, x: number, y: number, w: number, h: number, confidence = 0.9): RecognizedLine => ({
  text,
  bbox: { x, y, w, h },
  confidence,
});

/** Lines of one card with its top-left at (ox, oy). */
function card(ox: number, oy: number, o: { name?: string; kind?: string; code?: string; stats?: string; passcode?: string; body?: boolean }) {
  const out: RecognizedLine[] = [];
  if (o.name) out.push(line(o.name, ox + 45, oy + 50, 320, 40));
  if (o.code) out.push(line(o.code, ox + 430, oy + 627, 115, 16));
  if (o.kind) out.push(line(o.kind, ox + 45, oy + 664, 220, 22));
  if (o.body !== false) {
    out.push(line('When a card or effect is activated that includes any of these effects', ox + 45, oy + 700, 500, 16));
    out.push(line('You can only use this effect once per turn.', ox + 45, oy + 720, 420, 16));
  }
  if (o.stats) out.push(line(o.stats, ox + 330, oy + 800, 220, 18));
  if (o.passcode) out.push(line(o.passcode, ox + 24, oy + 835, 92, 14, 0.7));
  return out;
}

describe('scanYgoLines', () => {
  it('identifies the printing from passcode + code, with every signal as evidence', () => {
    const r = scanYgoLines(
      card(0, 0, { name: 'Dark Magician', kind: '[Spellcaster/Normal]', code: 'LOB-005', stats: 'ATK/2500 DEF/2100', passcode: '46986414' }),
      index,
    );
    expect(ids(r)).toEqual(['ygo:LOB-005']);
    expect(r[0].confident).toBe(true);
    expect(r[0].score).toBe(1);
    expect(r[0].evidence).toEqual(
      expect.arrayContaining(['passcode 46986414', 'code LOB-005', 'name "Dark Magician"', 'ATK/DEF 2500/2100', 'type spellcaster']),
    );
    // The outline is roughly the synthetic card.
    expect(r[0].cardBox.w / r[0].cardBox.h).toBeCloseTo(59 / 86, 2);
    expect(r[0].cardBox.y).toBeGreaterThan(-80);
    expect(r[0].cardBox.y).toBeLessThan(80);
  });

  it('names the card but not the printing from the passcode alone', () => {
    const r = scanYgoLines(card(0, 0, { passcode: '89631139', body: false }), index);
    expect(r).toHaveLength(1);
    expect(r[0].card.id).toBe('ygo:SDK-001'); // newest printing
    expect(r[0].confident).toBe(false);
    expect(r[0].alternatives.map((a) => a.card.id)).toEqual(['ygo:LOB-001', 'ygo:LOB-EN001']);
  });

  it('tolerates one wrong digit in the passcode and one wrong character in the code', () => {
    const near = scanYgoLines(card(0, 0, { name: 'Dark Magician', passcode: '46986419' }), index);
    expect(near[0].card.name).toBe('Dark Magician');
    expect(near[0].evidence).toContain('passcode ≈46986414');
    const code = scanYgoLines(card(0, 0, { code: 'LOB-EN0O7', name: 'Blue-Eyes White Dragon' }), index);
    expect(ids(code)).toEqual(['ygo:LOB-EN001']);
    expect(code[0].evidence).toContain('code ≈LOB-EN001');
  });

  it('resolves a code read with OCR confusions exactly, and becomes confident with ATK/DEF', () => {
    const r = scanYgoLines(card(0, 0, { code: 'L0B-EN00l', stats: 'ATK/3000 DEF/2500' }), index);
    expect(ids(r)).toEqual(['ygo:LOB-EN001']);
    expect(r[0].evidence).toEqual(expect.arrayContaining(['code LOB-EN001', 'ATK/DEF 3000/2500']));
    expect(r[0].confident).toBe(true);
    const alone = scanYgoLines(card(0, 0, { code: 'LOB-EN001' }), index);
    expect(alone[0].confident).toBe(false);
  });

  it('falls back to the name (newest printing first, printings as alternatives)', () => {
    const r = scanYgoLines(card(0, 0, { name: 'Blue-Eyes White Dragon', kind: '[Dragon/Normal]', stats: 'ATK/3000 DEF/2500' }), index);
    expect(r[0].card.id).toBe('ygo:SDK-001');
    expect(r[0].confident).toBe(false);
    expect(r[0].alternatives.map((a) => a.card.id)).toEqual(expect.arrayContaining(['ygo:LOB-001', 'ygo:LOB-EN001']));
    const fuzzy = scanYgoLines(card(0, 0, { name: 'Mystical Space Typhon', kind: '[Spell Card]' }), index);
    expect(ids(fuzzy)).toEqual(['ygo:SDK-033']);
    expect(fuzzy[0].evidence).toContain('type spell card');
  });

  it('keeps two cards apart and orders them left to right', () => {
    const lines = [
      ...card(700, 0, { name: 'Dark Magician', code: 'LOB-005', passcode: '46986414' }),
      ...card(0, 0, { name: 'Blue-Eyes White Dragon', code: 'SDK-001', passcode: '89631139' }),
    ];
    expect(ids(scanYgoLines(lines, index))).toEqual(['ygo:SDK-001', 'ygo:LOB-005']);
  });

  it('resolves artwork-table ids (passcodes) to printings, newest first, alternate arts included', () => {
    const m = createYgoMatcher(catalog);
    expect(m.game).toBe('ygo');
    // Every printing of the passcode, newest set first.
    expect(m.artworkCards!('89631139')).toEqual(['ygo:SDK-001', 'ygo:LOB-001', 'ygo:LOB-EN001']);
    // An alternate artwork's passcode names the same card (and so the same printings).
    expect(m.artworkCards!('89631140')).toEqual(['ygo:SDK-001', 'ygo:LOB-001', 'ygo:LOB-EN001']);
    expect(m.artworkCards!('46986414')).toEqual(['ygo:LOB-005', 'ygo:PRM-EN001']);
    expect(m.artworkCards!('12345678')).toEqual([]);
    expect(m.artworkCards!('ygo:LOB-005')).toEqual([]);
    // lookup: a printing id, or a passcode → its newest printing.
    expect(m.lookup!('ygo:LOB-001')?.card.id).toBe('ygo:LOB-001');
    expect(m.lookup!('ygo:LOB-001')?.set.id).toBe('lob');
    expect(m.lookup!('89631139')?.card.id).toBe('ygo:SDK-001');
    expect(m.lookup!('89631140')?.card.id).toBe('ygo:SDK-001');
    expect(m.lookup!('nope')).toBeUndefined();
    expect(m.lookup!('12345678')).toBeUndefined();
  });

  it('returns nothing for noise and is deterministic', () => {
    expect(scanYgoLines([line('the quick brown fox', 0, 0, 100, 10)], index)).toEqual([]);
    expect(scanYgoLines([], index)).toEqual([]);
    const lines = card(0, 0, { name: 'Dark Magician', code: 'LOB-005' });
    expect(JSON.stringify(scanYgoLines(lines, index))).toBe(JSON.stringify(scanYgoLines(lines, index)));
  });
});
