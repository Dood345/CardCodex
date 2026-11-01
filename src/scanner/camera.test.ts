import { describe, expect, it } from 'vitest';
import { coverTransform, mapBox } from './camera';
import { updateTracks, type Track } from './tracker';
import type { ScanCandidate } from './types';
import { fixtureCatalog } from './fixtures.test-util';

describe('coverTransform', () => {
  it('crops the sides of a landscape frame in a portrait element', () => {
    // 1280×720 frame in a 360×640 element: height-limited, scale 640/720.
    const t = coverTransform(1280, 720, 360, 640);
    expect(t.scale).toBeCloseTo(640 / 720);
    expect(t.offsetY).toBeCloseTo(0);
    expect(t.offsetX).toBeCloseTo((360 - 1280 * (640 / 720)) / 2); // ≈ -388.9
    // Frame centre maps to element centre.
    const c = mapBox({ x: 640, y: 360, w: 0, h: 0 }, t);
    expect(c.x).toBeCloseTo(180);
    expect(c.y).toBeCloseTo(320);
  });

  it('crops top/bottom of a frame wider-than-tall element', () => {
    const t = coverTransform(1280, 720, 1000, 300);
    expect(t.scale).toBeCloseTo(1000 / 1280);
    expect(t.offsetX).toBeCloseTo(0);
    expect(t.offsetY).toBeCloseTo((300 - 720 * (1000 / 1280)) / 2);
  });

  it('is identity for an exact fit and scales boxes', () => {
    expect(coverTransform(640, 480, 640, 480)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    const t = coverTransform(640, 480, 1280, 960);
    expect(mapBox({ x: 10, y: 20, w: 30, h: 40 }, t)).toEqual({ x: 20, y: 40, w: 60, h: 80 });
  });

  it('survives an unknown frame size', () => {
    expect(coverTransform(0, 0, 100, 100)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });
});

describe('updateTracks', () => {
  const [base1] = fixtureCatalog.sets;
  const sv01 = fixtureCatalog.sets[1];
  const cand = (cardId: string, x: number, score: number): ScanCandidate => {
    const card = fixtureCatalog.cards.find((c) => c.id === cardId)!;
    const set = card.set === 'base1' ? base1 : sv01;
    const box = { x, y: 0, w: 300, h: 420 };
    return { key: cardId, card, set, score, margin: 0.2, confident: false, evidence: [], bbox: box, cardBox: box, alternatives: [] };
  };

  it('keeps a stable track id, holds for 2 s, and resists a one-frame flip', () => {
    let tracks: Track[] = [];
    tracks = updateTracks(tracks, [cand('sv01-057', 0, 0.9)], 0);
    const id = tracks[0].id;
    tracks = updateTracks(tracks, [cand('sv01-057', 10, 0.9)], 900);
    // One frame reads a different card at the same place: identity holds.
    tracks = updateTracks(tracks, [cand('base1-4', 12, 0.6)], 1800);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(id);
    expect(tracks[0].shown.card.id).toBe('sv01-057');
    expect(tracks[0].shown.key).toBe(id);
    expect(tracks[0].shown.cardBox.x).toBe(12); // latest geometry
    expect(tracks[0].shown.alternatives[0].card.id).toBe('base1-4');
    // Not seen for > 2 s: dropped.
    expect(updateTracks(tracks, [], 1800 + 1999)).toHaveLength(1);
    expect(updateTracks(tracks, [], 1800 + 2001)).toHaveLength(0);
  });

  it('keeps the track id across slow (Tesseract-speed) frames when hold is stretched', () => {
    // useCardScanner passes hold = max(2000, 2.5 × avg recognition time).
    const hold = 2.5 * 2700;
    let tracks = updateTracks([], [cand('sv01-057', 0, 0.9)], 0, hold);
    const id = tracks[0].id;
    tracks = updateTracks(tracks, [cand('sv01-057', 5, 0.9)], 2700, hold);
    tracks = updateTracks(tracks, [cand('sv01-057', 9, 0.9)], 5400, hold);
    expect(tracks.map((t) => t.id)).toEqual([id]);
    // With the plain 2 s hold the same timing would lose the track.
    const t0 = updateTracks([], [cand('sv01-057', 0, 0.9)], 0, 2000);
    expect(updateTracks(t0, [cand('sv01-057', 5, 0.9)], 2700, 2000)[0].id).not.toBe(t0[0].id);
  });

  it('keeps two cards apart', () => {
    const tracks = updateTracks([], [cand('sv01-057', 0, 0.9), cand('base1-4', 400, 0.9)], 0);
    expect(tracks.map((t) => t.shown.card.id)).toEqual(['sv01-057', 'base1-4']);
  });
});
