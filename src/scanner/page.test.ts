import { describe, expect, it } from 'vitest';
import { PAGE_LAYOUTS, mergePocketCandidates, padBox, pageLayout, pageRect, pocketBoxes, stripLines } from './page';
import type { RecognizedLine, ScanCandidate } from './types';
import { fixtureCatalog } from './fixtures.test-util';

describe('pageRect', () => {
  it('keeps the page aspect and fits inside the frame minus the margin', () => {
    const layout = pageLayout('3x3');
    const r = pageRect(1000, 1400, layout);
    const aspect = (3 * 63) / (3 * 88);
    expect(r.w / r.h).toBeCloseTo(aspect, 3);
    expect(r.x).toBeGreaterThanOrEqual(30 - 1e-6);
    expect(r.y).toBeGreaterThanOrEqual(30 - 1e-6);
    expect(r.x + r.w).toBeLessThanOrEqual(1000 - 30 + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(1400 - 30 + 1e-6);
    // Centred.
    expect(r.x + r.w / 2).toBeCloseTo(500, 6);
    expect(r.y + r.h / 2).toBeCloseTo(700, 6);
  });

  it('is width-limited in a portrait frame and height-limited in a landscape one', () => {
    const layout = pageLayout('3x3');
    const portrait = pageRect(1000, 2000, layout);
    expect(portrait.w).toBeCloseTo(1000 - 60, 6);
    const landscape = pageRect(2000, 1000, layout);
    expect(landscape.h).toBeCloseTo(1000 - 60, 6);
  });
});

describe('pocketBoxes', () => {
  it('produces one cell per pocket in row-major order with card-shaped, non-overlapping boxes', () => {
    for (const layout of PAGE_LAYOUTS) {
      const pockets = pocketBoxes(1200, 1600, layout);
      expect(pockets).toHaveLength(layout.cols * layout.rows);
      pockets.forEach((p, i) => {
        expect(p.index).toBe(i);
        expect(p.row).toBe(Math.floor(i / layout.cols));
        expect(p.col).toBe(i % layout.cols);
        expect(p.box.w / p.box.h).toBeCloseTo(63 / 88, 3);
      });
      for (let a = 0; a < pockets.length; a++) {
        for (let b = a + 1; b < pockets.length; b++) {
          const A = pockets[a].box;
          const B = pockets[b].box;
          const overlap = A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('applies the inset inside each cell', () => {
    const layout = pageLayout('2x2');
    const tight = pocketBoxes(1000, 1000, layout, { inset: 0 });
    const inset = pocketBoxes(1000, 1000, layout, { inset: 0.1 });
    expect(inset[0].box.w).toBeCloseTo(tight[0].box.w * 0.8, 6);
    expect(inset[0].box.x).toBeCloseTo(tight[0].box.x + tight[0].box.w * 0.1, 6);
  });

  it('takes the card aspect from cardMm', () => {
    const layout = pageLayout('3x3');
    const ygo = pocketBoxes(1200, 1600, layout, { cardMm: { w: 59, h: 86 } });
    expect(ygo[0].box.w / ygo[0].box.h).toBeCloseTo(59 / 86, 3);
  });

  it('falls back to 3x3 for unknown layout ids', () => {
    expect(pageLayout('nope').id).toBe('3x3');
  });
});

describe('padBox', () => {
  it('grows the box on every side and clamps to the frame', () => {
    const b = padBox({ x: 100, y: 100, w: 200, h: 300 }, 0.1, 1000, 1000);
    expect(b).toEqual({ x: 80, y: 70, w: 240, h: 360 });
    const edge = padBox({ x: 0, y: 0, w: 200, h: 300 }, 0.1, 210, 320);
    expect(edge).toEqual({ x: 0, y: 0, w: 210, h: 320 });
  });
});

describe('stripLines', () => {
  const line = (text: string, y: number): RecognizedLine => ({ text, bbox: { x: 10, y, w: 100, h: 20 }, confidence: 0.9 });
  it('maps strip boxes back into crop coordinates and drops exact repeats', () => {
    const already = [line('Wugtrio', 30), line('057/198', 820)];
    const out = stripLines([line('057/198', 50), line('SVI', 60), line('  ', 70)], 760, already);
    expect(out.map((l) => l.text)).toEqual(['SVI']);
    // 2.5× magnification undone, offset by the strip's top.
    expect(out[0].bbox).toEqual({ x: 4, y: 760 + 24, w: 40, h: 8 });
  });
});

describe('mergePocketCandidates', () => {
  const [base1] = fixtureCatalog.sets;
  const sv01 = fixtureCatalog.sets[1];
  const cand = (cardId: string, score: number, confident = false, alternatives: ScanCandidate['alternatives'] = []): ScanCandidate => {
    const card = fixtureCatalog.cards.find((c) => c.id === cardId)!;
    const set = card.set === 'base1' ? base1 : sv01;
    const box = { x: 0, y: 0, w: 300, h: 420 };
    return { key: cardId, card, set, score, margin: 0.2, confident, evidence: ['name'], bbox: box, cardBox: box, alternatives };
  };
  const alt = (cardId: string, score: number) => {
    const c = cand(cardId, score);
    return { card: c.card, set: c.set, score, evidence: c.evidence };
  };

  it('returns nothing for empty frames', () => {
    expect(mergePocketCandidates([[], []]).candidate).toBeUndefined();
  });

  it('lets two agreeing frames beat one stronger frame', () => {
    const m = mergePocketCandidates([[cand('sv01-057', 0.5)], [cand('sv01-057', 0.5)], [cand('base1-4', 0.8)]]);
    expect(m.candidate!.card.id).toBe('sv01-057');
    expect(m.alternatives[0].card.id).toBe('base1-4');
  });

  it('is confident when every frame agrees with a clear margin', () => {
    const m = mergePocketCandidates([[cand('sv01-057', 0.6, false, [alt('base1-4', 0.2)])], [cand('sv01-057', 0.6)]]);
    expect(m.candidate!.confident).toBe(true);
    expect(m.candidate!.alternatives.map((a) => a.card.id)).toEqual(['base1-4']);
  });

  it('promotes a card that was only ever an alternative when it outweighs the leaders', () => {
    const m = mergePocketCandidates([[cand('sv01-057', 0.2, false, [alt('base1-4', 0.9)])], [cand('sv01-057', 0.2, false, [alt('base1-4', 0.9)])]]);
    expect(m.candidate!.card.id).toBe('base1-4');
    expect(m.candidate!.confident).toBe(false);
  });
});
