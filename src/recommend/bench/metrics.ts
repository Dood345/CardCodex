/** The statistics the deck benchmarks report. Pure arithmetic, no cards. */

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Share of pairs (a[i], b[i]) in which a rates higher; a tie counts half. */
export function pairedWins(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let wins = 0;
  for (let i = 0; i < n; i++) wins += a[i] > b[i] ? 1 : a[i] === b[i] ? 0.5 : 0;
  return wins / n;
}

/** Chance that a random member of `good` rates above a random member of `bad` (ties half): the area under the ROC curve. */
export function auc(good: readonly number[], bad: readonly number[]): number {
  if (!good.length || !bad.length) return 0;
  let wins = 0;
  for (const g of good) for (const b of bad) wins += g > b ? 1 : g === b ? 0.5 : 0;
  return wins / (good.length * bad.length);
}

/** Ranks from 1, equal values sharing the mean of their ranks. */
export function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation, -1..1; 0 when either side is constant or shorter than two. */
export function spearman(x: readonly number[], y: readonly number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const rx = ranks(x.slice(0, n));
  const ry = ranks(y.slice(0, n));
  const mx = mean(rx);
  const my = mean(ry);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
