import { describe, expect, it } from 'vitest';
import type { CardLookup } from './artwork';
import { fixtureCatalog } from './fixtures.test-util';
import { hashCardIn, hashTableFrom, lumaImage, windowOf, type LumaImage } from './hash';
import { LIVE_MAX_CARDS, LIVE_MIN_CARD_PX, addLiveArtwork, liveArtworkRegion } from './live-artwork';
import type { Box, ScanCandidate } from './types';

const frame = { w: 1280, h: 960 };
const setById = new Map(fixtureCatalog.sets.map((s) => [s.id, s]));
const lookup: CardLookup = (id) => {
  const card = fixtureCatalog.cards.find((c) => c.id === id);
  const set = card && setById.get(card.set);
  return card && set ? { card, set } : undefined;
};

/** A synthetic scene of 16 px random blocks over the frame: every card region hashes to something of its own (unrelated regions sit ~64 bits apart). */
function noise(ix: number, iy: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) % 256;
}
function sceneLuma(x: number, y: number): number {
  return noise(Math.floor(x / 16), Math.floor(y / 16));
}

/** `region` of the scene sampled 272 px wide, as hash.ts samplePocketLuma would from a canvas. */
function sample(region: Box, width = 272): LumaImage {
  const w = width;
  const h = Math.round((width * region.h) / region.w);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = sceneLuma(region.x + ((i + 0.5) * region.w) / w, region.y + ((j + 0.5) * region.h) / h);
      const o = (j * w + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return lumaImage(data, w, h);
}

function cand(id: string, cardBox: Box, alternatives: string[] = []): ScanCandidate {
  const { card, set } = lookup(id)!;
  return {
    key: `t-${id}`,
    card,
    set,
    score: 0.45,
    margin: 0,
    confident: false,
    evidence: ['name "Pikachu"'],
    bbox: { x: cardBox.x + 20, y: cardBox.y + 10, w: cardBox.w * 0.6, h: 30 },
    cardBox,
    alternatives: alternatives.map((a) => ({ ...lookup(a)!, score: 0.45, evidence: ['name "Pikachu"'] })),
  };
}

/** Table entry for the card that really sits at `cardBox` in the scene. */
function entryFor(cardBox: Box): Uint32Array {
  const region = liveArtworkRegion(cardBox, frame)!;
  return hashCardIn(sample(region), windowOf(cardBox, region));
}

describe('liveArtworkRegion', () => {
  it('pads the outline and clamps to the frame; rejects tiny or cut-off outlines', () => {
    const r = liveArtworkRegion({ x: 400, y: 200, w: 300, h: 420 }, frame)!;
    expect(r.x).toBeCloseTo(400 - 36);
    expect(r.w).toBeCloseTo(300 + 72);
    expect(liveArtworkRegion({ x: 0, y: 0, w: LIVE_MIN_CARD_PX - 1, h: 80 }, frame)).toBeNull();
    expect(liveArtworkRegion({ x: 1100, y: 200, w: 400, h: 560 }, frame)).toBeNull(); // 45 % off the right edge
    const edge = liveArtworkRegion({ x: 1000, y: 200, w: 270, h: 378 }, frame)!;
    expect(edge.x + edge.w).toBeLessThanOrEqual(frame.w);
  });
});

describe('addLiveArtwork', () => {
  // The card at the middle of the frame is really sv01-057; the OCR read its name only and, by recency, picked base1-4.
  const middle: Box = { x: 490, y: 270, w: 300, h: 420 };
  const table = hashTableFrom(['sv01-057', 'base1-4'], [entryFor(middle), entryFor({ x: 40, y: 40, w: 300, h: 420 })]);

  it('turns a name-only read into the pictured card, keeping the track key and geometry', () => {
    const ocr = cand('base1-4', middle, ['sv01-057']);
    const [out] = addLiveArtwork([ocr], frame, table, lookup, sample);
    expect(out.card.id).toBe('sv01-057');
    expect(out.key).toBe('t-base1-4');
    expect(out.cardBox).toEqual(middle);
    expect(out.bbox).toEqual(ocr.bbox);
    expect(out.evidence.some((e) => /^artwork \d+$/.test(e))).toBe(true);
    expect(out.score).toBeGreaterThan(0.9);
    expect(out.alternatives.map((a) => a.card.id)).toContain('base1-4');
  });

  it('hashes only the cards nearest the middle and leaves the rest untouched', () => {
    // Distances to the frame centre (640, 480): middle 0, right ≈ 450, left ≈ 500. With LIVE_MAX_CARDS = 2 the left one is not hashed.
    const right = cand('base1-4', { x: 900, y: 460, w: 300, h: 420 });
    const left = cand('base1-4', { x: 40, y: 480, w: 300, h: 420 });
    const near = cand('base1-4', middle, ['sv01-057']);
    const out = addLiveArtwork([left, near, right], frame, table, lookup, sample, LIVE_MAX_CARDS);
    expect(out[0]).toBe(left);
    expect(out[1].card.id).toBe('sv01-057');
    expect(out[2].card.id).toBe('base1-4');
    expect(out[2].evidence.some((e) => e.startsWith('artwork'))).toBe(false); // hashed, but nothing in the table shows that region
  });

  it('skips outlines it cannot hash', () => {
    const tiny = cand('base1-4', { x: 600, y: 400, w: 40, h: 56 });
    expect(addLiveArtwork([tiny], frame, table, lookup, sample)[0]).toBe(tiny);
    expect(addLiveArtwork([], frame, table, lookup, sample)).toEqual([]);
  });
});
