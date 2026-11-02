import { describe, expect, it } from 'vitest';
import { fixtureCatalog } from './fixtures.test-util';
import { focusTracks, onCard } from './focus';
import type { Box, ScanCandidate } from './types';

const frame = { w: 1000, h: 1400 };

function cand(id: string, box: Box): ScanCandidate {
  const card = fixtureCatalog.cards.find((c) => c.id === id)!;
  const set = fixtureCatalog.sets.find((s) => s.id === card.set)!;
  return { key: id, card, set, score: 0.5, margin: 0.1, confident: false, evidence: [], bbox: box, cardBox: box, alternatives: [] };
}

describe('focusTracks', () => {
  it('shows only the card under the middle of the frame, even when the card below it is just as big', () => {
    // A binder column seen in single-card mode: the aimed-at card spans the middle, the next one starts below it.
    const centred = cand('sv01-057', { x: 200, y: 350, w: 600, h: 840 });
    const below = cand('base1-4', { x: 200, y: 1220, w: 600, h: 840 });
    expect(focusTracks([below, centred], frame).map((c) => c.card.id)).toEqual(['sv01-057']);
    expect(focusTracks([centred, below], frame).map((c) => c.card.id)).toEqual(['sv01-057']);
  });

  it('prefers the bigger, better-centred outline when two cover the middle', () => {
    const big = cand('sv01-057', { x: 150, y: 300, w: 700, h: 980 });
    const tall = cand('base1-4', { x: 300, y: 650, w: 300, h: 420 }); // also contains (500, 700)
    expect(focusTracks([tall, big], frame).map((c) => c.card.id)).toEqual(['sv01-057']);
  });

  it('falls back to the largest card nearest the middle, with a second one only when nearly as big', () => {
    const left = cand('sv01-057', { x: 20, y: 400, w: 400, h: 560 });
    const right = cand('base1-4', { x: 580, y: 400, w: 400, h: 560 });
    const tiny = cand('sv01-057', { x: 900, y: 1300, w: 60, h: 84 });
    const shown = focusTracks([tiny, right, left], frame).map((c) => c.card.id);
    expect(shown).toHaveLength(2);
    expect(shown).toContain('sv01-057');
    expect(shown).toContain('base1-4');
  });

  it('passes a single result and an unknown frame size through', () => {
    const one = [cand('sv01-057', { x: 0, y: 0, w: 100, h: 140 })];
    expect(focusTracks(one, frame)).toEqual(one);
    const two = [cand('sv01-057', { x: 0, y: 0, w: 100, h: 140 }), cand('base1-4', { x: 500, y: 0, w: 100, h: 140 })];
    expect(focusTracks(two, { w: 0, h: 0 })).toHaveLength(2);
  });

  it('onCard allows a little slack around the outline', () => {
    const b = { x: 100, y: 100, w: 200, h: 280 };
    expect(onCard(b, 200, 240)).toBe(true);
    expect(onCard(b, 95, 240)).toBe(true); // 5 px outside, 4 % of 200 is 8
    expect(onCard(b, 80, 240)).toBe(false);
  });
});
