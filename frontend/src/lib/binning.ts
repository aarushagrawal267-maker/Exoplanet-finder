/**
 * Lightweight binning helpers for display only (the science pipeline's binning lives in the
 * Python backend; these never feed a model).
 */

export interface Binned {
  x: number[];
  y: number[];
  /** Number of finite samples in each returned bin. */
  count: number[];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mid = n >> 1;
  return n % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * Median-bin `y(x)` into `nBins` equal-width bins over [xMin, xMax] (defaults: data range).
 * Empty bins are dropped (not interpolated), so gaps stay visible. Non-finite samples are ignored.
 */
export function binMedian(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  { nBins = 100, xMin, xMax }: { nBins?: number; xMin?: number; xMax?: number } = {},
): Binned {
  const n = Math.min(x.length, y.length);
  let lo = xMin ?? Number.POSITIVE_INFINITY;
  let hi = xMax ?? Number.NEGATIVE_INFINITY;
  if (xMin === undefined || xMax === undefined) {
    for (let i = 0; i < n; i += 1) {
      const xi = x[i] as number;
      if (!Number.isFinite(xi)) continue;
      if (xMin === undefined && xi < lo) lo = xi;
      if (xMax === undefined && xi > hi) hi = xi;
    }
  }
  if (!(hi > lo) || nBins < 1) return { x: [], y: [], count: [] };
  const width = (hi - lo) / nBins;
  const buckets: number[][] = Array.from({ length: nBins }, () => []);
  for (let i = 0; i < n; i += 1) {
    const xi = x[i] as number;
    const yi = y[i] as number;
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || xi < lo || xi > hi) continue;
    const b = Math.min(nBins - 1, Math.floor((xi - lo) / width));
    (buckets[b] as number[]).push(yi);
  }
  const out: Binned = { x: [], y: [], count: [] };
  buckets.forEach((bucket, b) => {
    if (bucket.length === 0) return;
    out.x.push(lo + (b + 0.5) * width);
    out.y.push(median(bucket));
    out.count.push(bucket.length);
  });
  return out;
}

/** Evenly thin an array pair to at most `maxPoints` (display only; keeps first and last). */
export function thin<T>(values: readonly T[], maxPoints: number): T[] {
  if (values.length <= maxPoints || maxPoints < 2) return [...values];
  const step = (values.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => values[Math.round(i * step)] as T);
}
