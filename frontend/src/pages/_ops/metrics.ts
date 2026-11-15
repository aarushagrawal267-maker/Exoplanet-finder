/**
 * Shared helpers for the machine-learning operations pages: metric vocabulary, safe accessors for
 * the loosely-typed metric dictionaries the API returns, model-type names and API time parsing.
 */
import { parseApiTime } from "@/api/endpoints/jobStream";
import { MODEL_PALETTE } from "@/components/charts/theme";
import type { ModelType } from "@/api/types";
import { EMPTY, formatNumber, isFiniteNumber } from "@/lib/format";

export interface MetricInfo {
  label: string;
  help: string;
  /** Lower is better (Brier score, ECE). */
  lowerIsBetter?: boolean;
}

/** Metrics in display order. Planet-like (class 1) is the positive class throughout. */
export const METRICS: Record<string, MetricInfo> = {
  pr_auc: { label: "PR-AUC", help: "Area under the precision–recall curve (average precision). Chance level = the planet-like fraction." },
  roc_auc: { label: "ROC-AUC", help: "Probability that a random planet-like signal scores above a random false-positive-like one." },
  f1: { label: "F1", help: "Harmonic mean of precision and recall at the decision threshold." },
  precision: { label: "Precision", help: "Of the signals called planet-like, the fraction that are (purity of leads)." },
  recall: { label: "Recall", help: "Of the planet-like signals, the fraction found (sensitivity)." },
  specificity: { label: "Specificity", help: "Of the false-positive-like signals, the fraction correctly rejected." },
  accuracy: { label: "Accuracy", help: "Fraction of correct labels; misleading under class imbalance." },
  brier: { label: "Brier score", help: "Mean squared error of the probabilities (lower is better).", lowerIsBetter: true },
  ece: { label: "ECE", help: "Expected calibration error over 10 probability bins (0 = perfectly calibrated).", lowerIsBetter: true },
};

export const HEADLINE_METRICS = ["pr_auc", "roc_auc", "f1", "precision", "recall", "specificity", "accuracy", "brier", "ece"] as const;

/** A finite number from an untyped metrics dictionary, else null. */
export function metricOf(m: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = m?.[key];
  return isFiniteNumber(v) ? v : null;
}

/** A [lo, hi] interval from an untyped CI dictionary, else null. */
export function ciOf(ci: Record<string, unknown> | null | undefined, key: string): [number, number] | null {
  const v = ci?.[key];
  if (Array.isArray(v) && v.length === 2 && isFiniteNumber(v[0]) && isFiniteNumber(v[1])) return [v[0], v[1]];
  return null;
}

/** "0.912" (3 decimals) or "—". */
export function fmtMetric(v: number | null | undefined, digits = 3): string {
  return formatNumber(v, { digits });
}

/** "0.871–0.944" or "" when no interval. */
export function fmtCi(ci: [number, number] | null, digits = 3): string {
  if (!ci) return "";
  return `${formatNumber(ci[0], { digits })}–${formatNumber(ci[1], { digits })}`;
}

export const MODEL_TYPES: ModelType[] = ["logreg", "random_forest", "cnn_single", "cnn_two_view"];

export function modelTypeLabel(type: string | null | undefined): string {
  if (!type) return EMPTY;
  return (MODEL_PALETTE as Record<string, { label: string }>)[type]?.label ?? type.replace(/_/g, " ");
}

export const isBaseline = (type: string | null | undefined) => type === "logreg" || type === "random_forest";

/** Parse an API timestamp (naive UTC) to a Date. */
export function apiDate(value: string | null | undefined): Date | null {
  const t = parseApiTime(value);
  return t ? new Date(t) : null;
}

/** Split names as shown to people. */
export const SPLIT_LABEL: Record<string, string> = { train: "Train", val: "Validation", test: "Test" };

/** Parse "1,2, 3" (URL params) into unique positive integers. */
export function parseIdList(value: string | null | undefined): number[] {
  if (!value) return [];
  const out: number[] = [];
  for (const part of value.split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Parse one positive integer URL param. */
export function parseId(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Best value of a metric among several (max, or min for lower-is-better metrics). */
export function bestOf(key: string, values: Array<number | null>): number | null {
  const finite = values.filter(isFiniteNumber);
  if (!finite.length) return null;
  return METRICS[key]?.lowerIsBetter ? Math.min(...finite) : Math.max(...finite);
}

/** Human summary of a training config value (lists, nulls, booleans). */
export function formatConfigValue(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
  if (Array.isArray(v)) return v.map((x) => formatConfigValue(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Config keys that matter for each model type (the stored config also carries unused defaults). */
export const CONFIG_KEYS: Record<string, string[]> = {
  logreg: ["logreg_c_grid", "logreg_max_iter", "cv_folds", "seed"],
  random_forest: ["rf_n_estimators", "rf_max_depth_grid", "rf_min_samples_leaf_grid", "rf_max_features_grid", "cv_folds", "seed"],
  cnn_single: ["lr", "batch_size", "max_epochs", "patience", "min_delta", "dropout", "fc_width", "fc_layers", "ensemble_size", "augment_flip", "weight_decay", "seed", "device", "num_threads"],
  cnn_two_view: ["lr", "batch_size", "max_epochs", "patience", "min_delta", "dropout", "fc_width", "fc_layers", "ensemble_size", "augment_flip", "weight_decay", "seed", "device", "num_threads"],
};

export const CONFIG_LABEL: Record<string, string> = {
  lr: "Learning rate",
  batch_size: "Batch size",
  max_epochs: "Max epochs",
  patience: "Early-stopping patience",
  min_delta: "Min improvement (PR-AUC)",
  dropout: "Dropout",
  fc_width: "FC width",
  fc_layers: "FC layers",
  ensemble_size: "Ensemble size",
  augment_flip: "Time-reversal augmentation",
  weight_decay: "Weight decay",
  seed: "Seed",
  device: "Device",
  num_threads: "CPU threads",
  cv_folds: "CV folds (grouped by star)",
  logreg_c_grid: "C grid (inverse regularisation)",
  logreg_max_iter: "Max iterations",
  rf_n_estimators: "Trees",
  rf_max_depth_grid: "Max depth grid",
  rf_min_samples_leaf_grid: "Min samples per leaf grid",
  rf_max_features_grid: "Max features grid",
  model_type: "Model type",
};
