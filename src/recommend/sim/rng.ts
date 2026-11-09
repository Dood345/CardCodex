/**
 * Seeded randomness for the playtest simulator. The whole state is one
 * unsigned 32-bit number, so a practice draw can carry it in plain data and a
 * game is reproduced from (seed, game number) alone.
 */

/** mulberry32: one step from `state`, returning [value in 0..1, next state]. */
export function stepRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** A mutable wrapper over the same generator, for the simulator's inner loop. */
export class Rng {
  s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    const s = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** 0..n-1. */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}

/** A 32-bit hash of a seed and a few integers (game number, seat), so each game draws from its own stream. */
export function mixSeed(seed: number, ...xs: number[]): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const x of [...xs, xs.length]) {
    h = Math.imul(h ^ (x >>> 0), 0x85ebca6b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h;
}

/** Fisher–Yates in place. */
export function shuffleInPlace<T>(a: T[], rng: Rng): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const x = a[i];
    a[i] = a[j];
    a[j] = x;
  }
}
