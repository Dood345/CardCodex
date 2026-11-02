/**
 * Pure cross-frame tracking used by useCardScanner: merges each frame's
 * candidates into persistent tracks so chips don't flicker.
 *
 * - A new candidate joins an existing track when it names a card already in
 *   the track's pool or its card outline overlaps the track's (IoU ≥ 0.3 —
 *   the same physical card moved a little or was re-read differently).
 * - Each track keeps a POOL of cards with decaying weights. Every frame adds
 *   the read's score to its card and a share of each alternative's score to
 *   that alternative (less the further it trails the read), so a card the
 *   matcher keeps listing a close second still accumulates weight. The chip shows the pool leader, and the leader only
 *   changes when a challenger is clearly ahead (SWITCH_RATIO), so two cards
 *   the OCR keeps flipping between cannot make the chip flip with them.
 * - `stability` (0..1) is the leader's share of the pool, ramped in over the
 *   first frames: the UI draws it as a confidence bar that fills while the
 *   reads agree and shrinks when they do not.
 * - A track survives `holdMs` (default 2 s) after it was last seen.
 */
import type { CatalogCard, CatalogSet } from '../data/types';
import type { ScanAlternative, ScanCandidate } from './types';
import { iou } from './ocr-normalize';

export interface PoolEntry {
  card: CatalogCard;
  set: CatalogSet;
  weight: number;
  /** Evidence from the most recent frame that mentioned this card. */
  evidence: string[];
  /** Score the card had in that frame (0..1). */
  score: number;
}

export interface Track {
  id: string;
  /** Candidate pool, by card id. */
  pool: Map<string, PoolEntry>;
  /** Latest full candidate per card id (when that card was a frame's best read). */
  byCard: Map<string, ScanCandidate>;
  /** Card id the chip currently shows. */
  shownId: string;
  /** What the UI shows (pool leader, latest geometry). */
  shown: ScanCandidate;
  /** Frames in which this track was read. */
  frames: number;
  firstSeen: number;
  lastSeen: number;
}

/** Weight decay per frame: an established lead takes ~3 contrary frames to overturn. */
const VOTE_DECAY = 0.7;
/** Share of an alternative's score that goes into the pool. */
const ALT_WEIGHT = 0.5;
/**
 * An alternative counts in full only when its score is close to the read's;
 * its share fades to nothing ALT_GAP below it. A name-only read (0.45) lists
 * a dozen printings at 0.45 and they all count (the read IS ambiguous), but
 * once the picture or the number lifts one card to ~1 the same printings at
 * 0.45 no longer dilute its stability.
 */
const ALT_GAP = 0.3;
/** A read the matcher itself calls confident (number + set agree) weighs this much more. */
const CONFIDENT_BOOST = 1.5;
/** A challenger must lead the shown card by this factor before the chip switches. */
const SWITCH_RATIO = 1.5;
/** Pool entries below this weight are forgotten. */
const PRUNE_WEIGHT = 0.02;
/** Stability ramps in over this many frames. */
const RAMP_FRAMES = 3;
/** Shown as confident once the pool agrees this strongly, even if no single frame was. */
const SURE_STABILITY = 0.8;
const MERGE_IOU = 0.3;

let trackCounter = 0;

function addWeight(t: Track, card: CatalogCard, set: CatalogSet, weight: number, score: number, evidence: string[]): void {
  const e = t.pool.get(card.id);
  if (e) {
    e.weight += weight;
    e.score = score;
    e.evidence = evidence;
  } else {
    t.pool.set(card.id, { card, set, weight, score, evidence });
  }
}

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
      live.find((x) => !touched.has(x) && x.pool.has(r.card.id) && iou(x.shown.cardBox, r.cardBox) > 0) ??
      live.find((x) => !touched.has(x) && iou(x.shown.cardBox, r.cardBox) >= MERGE_IOU);
    if (t && r.confident && !t.pool.has(r.card.id) && !r.alternatives.some((a) => t!.pool.has(a.card.id))) {
      // A confident read of a card that shares nothing with the pool at this
      // spot: the user swapped cards, not the OCR. Retire the old track at
      // once instead of making the new card fight the hysteresis.
      live.splice(live.indexOf(t), 1);
      t = undefined;
    }
    if (!t) {
      t = {
        id: `t${++trackCounter}`,
        pool: new Map(),
        byCard: new Map(),
        shownId: r.card.id,
        shown: r,
        frames: 0,
        firstSeen: now,
        lastSeen: now,
      };
      live.push(t);
    }
    touched.add(t);
    for (const e of t.pool.values()) e.weight *= VOTE_DECAY;
    addWeight(t, r.card, r.set, r.score * (r.confident ? CONFIDENT_BOOST : 1), r.score, r.evidence);
    for (const a of r.alternatives) {
      const rel = Math.max(0, 1 - (r.score - a.score) / ALT_GAP);
      if (rel > 0) addWeight(t, a.card, a.set, a.score * ALT_WEIGHT * rel, a.score, a.evidence);
    }
    for (const [id, e] of t.pool) if (e.weight < PRUNE_WEIGHT) t.pool.delete(id);
    t.byCard.set(r.card.id, r);
    t.lastSeen = now;
    t.frames++;

    // Leader with hysteresis.
    let top: PoolEntry | undefined;
    let total = 0;
    for (const e of t.pool.values()) {
      total += e.weight;
      if (!top || e.weight > top.weight) top = e;
    }
    const current = t.pool.get(t.shownId);
    const leader = current && top && top.weight < current.weight * SWITCH_RATIO ? current : (top ?? current)!;
    t.shownId = leader.card.id;

    const share = total > 0 ? leader.weight / total : 1;
    const stability = share * Math.min(1, t.frames / RAMP_FRAMES);
    const latest = t.byCard.get(leader.card.id);
    const alternatives: ScanAlternative[] = [...t.pool.values()]
      .filter((e) => e.card.id !== leader.card.id)
      .sort((a, b) => b.weight - a.weight)
      .map((e) => ({ card: e.card, set: e.set, score: total > 0 ? e.weight / total : 0, evidence: e.evidence }));
    // Latest geometry, pool-leading identity.
    t.shown = {
      key: t.id,
      card: leader.card,
      set: leader.set,
      score: latest?.score ?? leader.score,
      margin: latest?.margin ?? 0,
      confident: ((latest?.confident ?? false) && stability >= 0.5) || stability >= SURE_STABILITY,
      evidence: leader.evidence,
      bbox: r.bbox,
      cardBox: r.cardBox,
      alternatives,
      stability,
      frames: t.frames,
    };
  }
  return live;
}
