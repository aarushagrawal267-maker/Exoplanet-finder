/**
 * ============================================================================================
 *  SYNTHETIC DEMO DATA — FOR THE /design UI PREVIEW ONLY.
 *  Nothing here is an observation, a catalogue value, a label or a model metric. It is generated
 *  from a seeded pseudo-random generator so the design-system page renders every component
 *  deterministically. No real page imports this module, and every place that renders it is
 *  labelled "Demo data — for UI preview only".
 * ============================================================================================
 */
import type { JobOut, QualityReportData } from "@/api/types";
import { binMedian } from "@/lib/binning";

export const DEMO_LABEL = "Demo data — for UI preview only";
export const DEMO_META = { synthetic: true } as const;

/** Mulberry32: tiny deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal deviates (Box–Muller). */
function gauss(rand: () => number): () => number {
  return () => {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Synthetic ephemeris used by every demo chart. */
export const DEMO_EPHEMERIS = { period: 3.5234, epoch: 133.418, durationHours: 3.1, depthPpm: 2400 } as const;

/** Trapezoid transit profile (fractional depth) at phase dt (days from mid-transit). */
function transitProfile(dt: number, durationDays: number, depth: number, ingressFrac = 0.15): number {
  const half = durationDays / 2;
  const ingress = durationDays * ingressFrac;
  const a = Math.abs(dt);
  if (a >= half) return 0;
  if (a <= half - ingress) return depth;
  return depth * ((half - a) / ingress);
}

function foldDays(t: number, period: number, epoch: number): number {
  const p = (((t - epoch) / period + 0.5) % 1 + 1) % 1 - 0.5;
  return p * period;
}

export interface DemoLightCurve {
  time: number[];
  raw: number[];
  trend: number[];
  flat: number[];
}

/** Two "quarters" of 29.4-min cadence with a gap, slow variability and a periodic transit. */
export function demoLightCurve(seed = 7): DemoLightCurve {
  const rand = rng(seed);
  const g = gauss(rand);
  const cadence = 0.0204; // days (29.4 min)
  const segments: Array<[number, number, number]> = [
    [131.5, 163.8, 1.0],
    [168.9, 199.6, 0.9935],
  ];
  const { period, epoch, durationHours, depthPpm } = DEMO_EPHEMERIS;
  const out: DemoLightCurve = { time: [], raw: [], trend: [], flat: [] };
  for (const [t0, t1, level] of segments) {
    for (let t = t0; t < t1; t += cadence) {
      const trend = level * (1 + 0.0026 * Math.sin((2 * Math.PI * t) / 11.3) + 0.0011 * Math.sin((2 * Math.PI * t) / 4.7 + 1.3) + 0.00004 * (t - t0));
      const dip = transitProfile(foldDays(t, period, epoch), durationHours / 24, depthPpm * 1e-6);
      const noise = 1 + 210e-6 * g();
      const flat = (1 - dip) * noise;
      out.time.push(t);
      out.trend.push(trend);
      out.flat.push(flat);
      out.raw.push(flat * trend);
    }
  }
  return out;
}

/** Fold the flattened demo curve: phase in days. */
export function demoFolded(lc: DemoLightCurve): { phase: number[]; flux: number[] } {
  const { period, epoch } = DEMO_EPHEMERIS;
  return { phase: lc.time.map((t) => foldDays(t, period, epoch)), flux: lc.flat };
}

function fillGaps(values: Array<number | null>): number[] {
  const out = [...values];
  const idx = out.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (!idx.length) return out.map(() => 0);
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] !== null) continue;
    const prev = [...idx].reverse().find((j) => j < i);
    const next = idx.find((j) => j > i);
    const pv = prev !== undefined ? (out[prev] as number) : (out[next as number] as number);
    const nv = next !== undefined ? (out[next] as number) : pv;
    const w = prev !== undefined && next !== undefined ? (i - prev) / (next - prev) : 0;
    out[i] = pv + (nv - pv) * w;
  }
  return out as number[];
}

/** AstroNet-style global (2001) and local (201) views from the demo fold. */
export function demoViews(seed = 9): { global: number[]; local: number[] } {
  // Dense synthetic fold (~ a 4-year mission's worth of cadences) so bins are well populated.
  const rand = rng(seed);
  const g = gauss(rand);
  const { period, durationHours, depthPpm } = DEMO_EPHEMERIS;
  const phase: number[] = [];
  const flux: number[] = [];
  for (let i = 0; i < 70000; i += 1) {
    const ph = (rand() - 0.5) * period;
    phase.push(ph);
    flux.push((1 - transitProfile(ph, durationHours / 24, depthPpm * 1e-6)) * (1 + 210e-6 * g()));
  }
  const dur = durationHours / 24;
  const bin = (xs: number[], ys: number[], n: number, lo: number, hi: number) => {
    const b = binMedian(xs, ys, { nBins: n, xMin: lo, xMax: hi });
    const width = (hi - lo) / n;
    const arr: Array<number | null> = Array.from({ length: n }, () => null);
    b.x.forEach((x, i) => {
      arr[Math.min(n - 1, Math.floor((x - lo) / width))] = b.y[i] as number;
    });
    return fillGaps(arr);
  };
  const norm = (v: number[]) => {
    const sorted = [...v].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] as number;
    const centred = v.map((x) => x - med);
    const mn = Math.abs(Math.min(...centred)) || 1;
    return centred.map((x) => x / mn);
  };
  const global = norm(bin(phase.map((p) => p / period), flux, 2001, -0.5, 0.5));
  const local = norm(bin(phase.map((p) => p / dur), flux, 201, -2, 2));
  return { global, local };
}

/** A BLS-like power spectrum with a peak at the demo period and weaker aliases. */
export function demoPeriodogram(seed = 3): { periods: number[]; power: number[] } {
  const rand = rng(seed);
  const n = 2400;
  const periods: number[] = [];
  const power: number[] = [];
  const lo = Math.log10(0.5);
  const hi = Math.log10(40);
  const P = DEMO_EPHEMERIS.period;
  const peak = (p: number, c: number, h: number, w: number) => h * Math.exp(-0.5 * (Math.log(p / c) / w) ** 2);
  for (let i = 0; i < n; i += 1) {
    const p = 10 ** (lo + ((hi - lo) * i) / (n - 1));
    const floor = 0.06 + 0.035 * Math.log10(p + 1) + 0.03 * rand();
    power.push(floor + peak(p, P, 1, 0.0028) + peak(p, P / 2, 0.42, 0.0028) + peak(p, 2 * P, 0.55, 0.0028) + peak(p, 3 * P, 0.22, 0.003));
    periods.push(p);
  }
  return { periods, power };
}

// ---------------------------------------------------------------------------------------------
// Synthetic classifier outputs (internally consistent ROC / PR / calibration / confusion).
// ---------------------------------------------------------------------------------------------

export interface DemoModelEval {
  id: string;
  label: string;
  modelType: "cnn_two_view" | "random_forest" | "logreg" | "cnn_single";
  roc: Array<{ fpr: number; tpr: number }>;
  pr: Array<{ recall: number; precision: number }>;
  rocAuc: number;
  prAuc: number;
  bins: Array<{ bin_lo: number; bin_hi: number; mean_pred: number | null; frac_pos: number | null; count: number }>;
  ece: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
  f1: number;
  recall: number;
  ci: Record<string, [number, number]>;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function evaluateScores(y: number[], p: number[], threshold = 0.5) {
  const order = p.map((_, i) => i).sort((a, b) => (p[b] as number) - (p[a] as number));
  const nPos = y.filter((v) => v === 1).length;
  const nNeg = y.length - nPos;
  let tp = 0;
  let fp = 0;
  const roc = [{ fpr: 0, tpr: 0 }];
  const pr: Array<{ recall: number; precision: number }> = [];
  let rocAuc = 0;
  let prAuc = 0;
  let prevRecall = 0;
  order.forEach((i) => {
    if (y[i] === 1) tp += 1;
    else fp += 1;
    const tpr = tp / nPos;
    const fpr = fp / nNeg;
    const last = roc[roc.length - 1] as { fpr: number; tpr: number };
    rocAuc += (fpr - last.fpr) * (tpr + last.tpr) * 0.5;
    roc.push({ fpr, tpr });
    const precision = tp / (tp + fp);
    prAuc += (tpr - prevRecall) * precision;
    prevRecall = tpr;
    pr.push({ recall: tpr, precision });
  });
  const thin = <T,>(a: T[], n: number) => (a.length <= n ? a : Array.from({ length: n }, (_, k) => a[Math.round((k * (a.length - 1)) / (n - 1))] as T));
  const bins = Array.from({ length: 10 }, (_, b) => {
    const lo = b / 10;
    const hi = (b + 1) / 10;
    const idx = p.map((v, i) => ({ v, i })).filter(({ v }) => v >= lo && (b === 9 ? v <= hi : v < hi));
    const count = idx.length;
    return {
      bin_lo: lo,
      bin_hi: hi,
      mean_pred: count ? idx.reduce((s, { v }) => s + v, 0) / count : null,
      frac_pos: count ? idx.filter(({ i }) => y[i] === 1).length / count : null,
      count,
    };
  });
  const ece = bins.reduce((s, b) => s + (b.count && b.mean_pred !== null && b.frac_pos !== null ? (b.count / y.length) * Math.abs(b.mean_pred - b.frac_pos) : 0), 0);
  const confusion = { tp: 0, fp: 0, tn: 0, fn: 0 };
  p.forEach((v, i) => {
    const pred = v >= threshold ? 1 : 0;
    if (pred === 1 && y[i] === 1) confusion.tp += 1;
    else if (pred === 1) confusion.fp += 1;
    else if (y[i] === 1) confusion.fn += 1;
    else confusion.tn += 1;
  });
  const precision = confusion.tp / Math.max(1, confusion.tp + confusion.fp);
  const recall = confusion.tp / Math.max(1, confusion.tp + confusion.fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  return { roc: thin(roc, 120), pr: thin(pr, 120), rocAuc, prAuc, bins, ece, confusion, f1, recall };
}

export function demoModelEvals(): DemoModelEval[] {
  const specs: Array<Pick<DemoModelEval, "id" | "label" | "modelType"> & { sep: number; temp: number; seed: number }> = [
    { id: "demo-cnn2", label: "Two-view CNN (demo)", modelType: "cnn_two_view", sep: 3.4, temp: 1.0, seed: 11 },
    { id: "demo-rf", label: "Random forest (demo)", modelType: "random_forest", sep: 2.7, temp: 0.8, seed: 12 },
    { id: "demo-lr", label: "Logistic regression (demo)", modelType: "logreg", sep: 1.9, temp: 1.25, seed: 13 },
  ];
  return specs.map((s) => {
    const rand = rng(s.seed);
    const g = gauss(rand);
    const y: number[] = [];
    const p: number[] = [];
    for (let i = 0; i < 900; i += 1) {
      const label = rand() < 0.3 ? 1 : 0;
      const logit = (label ? s.sep / 2 : -s.sep / 2) + g() - 0.85;
      y.push(label);
      p.push(sigmoid(logit * s.temp));
    }
    const ev = evaluateScores(y, p);
    const w = 0.012 + 0.008 * (3.4 - s.sep);
    return {
      id: s.id,
      label: s.label,
      modelType: s.modelType,
      ...ev,
      ci: {
        prAuc: [Math.max(0, ev.prAuc - 2 * w), Math.min(1, ev.prAuc + 2 * w)],
        rocAuc: [Math.max(0, ev.rocAuc - w), Math.min(1, ev.rocAuc + w)],
        f1: [Math.max(0, ev.f1 - 2.5 * w), Math.min(1, ev.f1 + 2.5 * w)],
        recall: [Math.max(0, ev.recall - 3 * w), Math.min(1, ev.recall + 3 * w)],
      },
    };
  });
}

/** Synthetic learning curves for 34 of 50 epochs (early stopping not yet triggered). */
export function demoTrainingHistory(): { history: Array<{ epoch: number; train_loss: number; val_loss: number; val_pr_auc: number }>; best: number } {
  const rand = rng(21);
  const history = Array.from({ length: 34 }, (_, i) => {
    const e = i + 1;
    const train = 0.62 * Math.exp(-e / 9) + 0.11 + 0.008 * (rand() - 0.5);
    const val = 0.6 * Math.exp(-e / 8) + 0.19 + 0.0009 * Math.max(0, e - 20) ** 1.6 + 0.012 * (rand() - 0.5);
    const prauc = 0.93 - 0.55 * Math.exp(-e / 5.5) - 0.0004 * Math.max(0, e - 22) ** 1.5 + 0.01 * (rand() - 0.5);
    return { epoch: e, train_loss: train, val_loss: val, val_pr_auc: Math.min(0.99, prauc) };
  });
  const best = history.reduce((b, h) => (h.val_pr_auc > b.val_pr_auc ? h : b), history[0] as (typeof history)[number]).epoch;
  return { history, best };
}

export interface DemoSignalRow {
  id: string;
  period: number | undefined;
  depth: number | undefined;
  duration: number | undefined;
  snr: number | undefined;
  probability: number | undefined;
  grade: "A" | "B" | "C" | "D";
}

/** 240 synthetic table rows (enough to exercise virtualisation), some with missing values. */
export function demoSignalRows(n = 240): DemoSignalRow[] {
  const rand = rng(5);
  const grades = ["A", "A", "A", "B", "B", "C", "D"] as const;
  return Array.from({ length: n }, (_, i) => {
    const period = 10 ** (Math.log10(0.6) + rand() * (Math.log10(300) - Math.log10(0.6)));
    const missing = i % 17 === 5;
    return {
      id: `DEMO-${String(i + 1).padStart(4, "0")}`,
      period,
      depth: missing ? undefined : 10 ** (1.6 + rand() * 2.6),
      duration: 1 + rand() * 9,
      snr: i % 23 === 7 ? undefined : 7.1 + rand() * 60,
      probability: i % 13 === 3 ? undefined : rand(),
      grade: grades[Math.floor(rand() * grades.length)] as DemoSignalRow["grade"],
    };
  });
}

export const DEMO_QUALITY: QualityReportData = {
  grade: "C",
  ok: true,
  issues: [
    { code: "misaligned", blocking: false },
    { code: "low_transit_coverage", blocking: false },
  ],
  n_transits_expected: 19,
  n_transits_observed: 14,
  local_empty_frac: 0.04,
  global_empty_frac: 0.11,
};

/** Demo jobs for the job tray preview. Timestamps are relative to "now". */
export function demoJobs(now = Date.now()): JobOut[] {
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  return [
    {
      id: "demo-job-1",
      kind: "train",
      title: "Train two-view CNN (demo)",
      status: "running",
      progress: 0.62,
      message: "Epoch 31 / 50 · val PR-AUC 0.91",
      created_at: iso(15 * 60e3),
      started_at: iso(14 * 60e3),
      eta_s: 512,
    },
    {
      id: "demo-job-2",
      kind: "download",
      title: "Download light curves (demo)",
      status: "queued",
      progress: 0,
      created_at: iso(60e3),
    },
    {
      id: "demo-job-3",
      kind: "build_dataset",
      title: "Build pilot dataset (demo)",
      status: "succeeded",
      progress: 1,
      message: "Finished",
      created_at: iso(3 * 3600e3),
      started_at: iso(3 * 3600e3),
      finished_at: iso(2.6 * 3600e3),
    },
    {
      id: "demo-job-4",
      kind: "catalog_refresh",
      title: "Refresh catalogue (demo)",
      status: "failed",
      progress: 0.3,
      error: "Demo error: upstream service unavailable (HTTP 503).",
      created_at: iso(26 * 3600e3),
    },
  ];
}
