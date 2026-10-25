/**
 * Single mean-shift changepoint on a daily rating series, located with CUSUM
 * and scored with a two-sample z statistic. Pure, deterministic, no deps.
 */
export interface DailyPoint { date: string; sum: number; sumSq: number; n: number }
export interface Changepoint {
  date: string;          // first day of the "after" segment
  index: number;
  meanBefore: number;
  meanAfter: number;
  delta: number;         // after - before (negative = drop)
  z: number;             // |delta| / standard error
  significant: boolean;
}

export function dailySeries(reviews: { date: string; rating: number }[]): DailyPoint[] {
  const by = new Map<string, DailyPoint>();
  for (const r of reviews) {
    const p = by.get(r.date) ?? { date: r.date, sum: 0, sumSq: 0, n: 0 };
    p.sum += r.rating; p.sumSq += r.rating * r.rating; p.n += 1;
    by.set(r.date, p);
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const agg = (pts: DailyPoint[]) => pts.reduce((a, p) => ({ sum: a.sum + p.sum, sumSq: a.sumSq + p.sumSq, n: a.n + p.n }), { sum: 0, sumSq: 0, n: 0 });

/**
 * CUSUM over review-weighted deviations from the global mean; the changepoint is the
 * split that maximises |S_k|. Requires `minSegment` days on each side.
 */
export function detectChangepoint(series: DailyPoint[], opts: { minSegment?: number; zThreshold?: number } = {}): Changepoint | null {
  const minSeg = opts.minSegment ?? 3;
  const zThr = opts.zThreshold ?? 3;
  if (series.length < minSeg * 2) return null;
  const all = agg(series);
  if (all.n === 0) return null;
  const mu = all.sum / all.n;

  let s = 0, best = -1, bestAbs = -1;
  for (let k = 0; k < series.length - 1; k++) {
    s += series[k].sum - mu * series[k].n;
    if (k + 1 < minSeg || series.length - (k + 1) < minSeg) continue;
    if (Math.abs(s) > bestAbs) { bestAbs = Math.abs(s); best = k + 1; }
  }
  if (best < 0) return null;

  const a = agg(series.slice(0, best)), b = agg(series.slice(best));
  const m1 = a.sum / a.n, m2 = b.sum / b.n;
  const v1 = Math.max(a.sumSq / a.n - m1 * m1, 1e-6), v2 = Math.max(b.sumSq / b.n - m2 * m2, 1e-6);
  const se = Math.sqrt(v1 / a.n + v2 / b.n);
  const z = Math.abs(m2 - m1) / se;
  return {
    date: series[best].date, index: best,
    meanBefore: round(m1), meanAfter: round(m2), delta: round(m2 - m1), z: round(z),
    significant: z >= zThr && Math.abs(m2 - m1) >= 0.25,
  };
}

export const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
