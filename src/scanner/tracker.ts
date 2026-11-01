/**
 * Pure cross-frame tracking used by useCardScanner: merges each frame's
 * candidates into persistent tracks so chips don't flicker.
 *
 * - A new candidate joins an existing track when it names the same card or
 *   its card outline overlaps the track's (IoU ≥ 0.3 — the same physical card
 *   moved a little or was re-read as a different printing).
 * - Each track keeps decaying votes per card id; the chip shows the card with
 *   the most votes, so one bad frame cannot flip a stable guess.
 * - A track survives `holdMs` (default 2 s) after it was last seen.
 */
import type { ScanCandidate } from './types';
import { iou } from './ocr-normalize';

export interface Track {
  id: string;
  /** Latest candidate per card id seen on this track. */
  byCard: Map<string, ScanCandidate>;
  votes: Map<string, number>;
  /** What the UI shows (best-voted card, latest geometry). */
  shown: ScanCandidate;
  firstSeen: number;
  lastSeen: number;
}

/** Vote decay per frame; 0.7 means a guess must win ~2 frames to overtake. */
const VOTE_DECAY = 0.7;
const MERGE_IOU = 0.3;

let trackCounter = 0;

/**
 * Merge one frame's `results` into `tracks` (returns a new array; tracks are
 * mutated in place for cheapness). Expired tracks are dropped.
 */
export function updateTracks(
  tracks: readonly Track[],
  results: readonly ScanCandidate[],
  now: number,
  holdMs = 2000,
): Track[] {
  const live = tracks.filter((t) => now - t.lastSeen <= holdMs);
  const touched = new Set<Track>();
  for (const r of results) {
    let t =
      live.find((x) => !touched.has(x) && x.byCard.has(r.card.id) && iou(x.shown.cardBox, r.cardBox) > 0) ??
      live.find((x) => !touched.has(x) && iou(x.shown.cardBox, r.cardBox) >= MERGE_IOU);
    if (!t) {
      t = {
        id: `t${++trackCounter}`,
        byCard: new Map(),
        votes: new Map(),
        shown: r,
        firstSeen: now,
        lastSeen: now,
      };
      live.push(t);
    }
    touched.add(t);
    for (const [k, v] of t.votes) t.votes.set(k, v * VOTE_DECAY);
    t.votes.set(r.card.id, (t.votes.get(r.card.id) ?? 0) + r.score);
    t.byCard.set(r.card.id, r);
    t.lastSeen = now;
    let bestId = r.card.id;
    for (const [k, v] of t.votes) if (v > (t.votes.get(bestId) ?? 0)) bestId = k;
    const best = t.byCard.get(bestId) ?? r;
    // Latest geometry, best-voted identity. Alternatives: the latest frame's
    // list plus the current read if it lost the vote, deduped.
    const alts = [...r.alternatives];
    if (best.card.id !== r.card.id) alts.unshift({ card: r.card, set: r.set, score: r.score, evidence: r.evidence });
    const seen = new Set<string>([best.card.id]);
    t.shown = {
      ...best,
      key: t.id,
      bbox: r.bbox,
      cardBox: r.cardBox,
      alternatives: alts.filter((a) => !seen.has(a.card.id) && (seen.add(a.card.id), true)),
    };
  }
  return live;
}
