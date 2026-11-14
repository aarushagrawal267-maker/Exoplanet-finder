/**
 * Training-configuration form model: defaults from the model card, parsing of the list fields
 * (baseline grids) and validation that mirrors the API's limits (`TrainingConfigIn`), so the user
 * sees problems before the request is sent.
 */
import type { ModelTypeId, TrainingConfigIn } from "@/api/schemasOps";

export interface CnnForm {
  lr: number | null;
  batch_size: number | null;
  max_epochs: number | null;
  patience: number | null;
  dropout: number | null;
  fc_width: number | null;
  fc_layers: number | null;
  ensemble_size: number | null;
  seed: number | null;
  augment_flip: boolean;
  weight_decay: number | null;
}

export interface LogregForm {
  logreg_c_grid: string;
  logreg_max_iter: number | null;
  cv_folds: number | null;
  seed: number | null;
}

export interface ForestForm {
  rf_n_estimators: number | null;
  rf_max_depth_grid: string;
  rf_min_samples_leaf_grid: string;
  rf_max_features_grid: string;
  cv_folds: number | null;
  seed: number | null;
}

export type FormState = { kind: "cnn"; v: CnnForm } | { kind: "logreg"; v: LogregForm } | { kind: "forest"; v: ForestForm };

const num = (v: unknown, fallback: number | null = null): number | null => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const list = (v: unknown): string => (Array.isArray(v) ? v.map((x) => (x === null ? "none" : String(x))).join(", ") : "");

/** Form state from a model card's `default_config` (falls back to the documented defaults). */
export function defaultForm(type: ModelTypeId, defaults: Record<string, unknown> = {}): FormState {
  if (type === "logreg") {
    return {
      kind: "logreg",
      v: {
        logreg_c_grid: list(defaults.logreg_c_grid) || "0.001, 0.01, 0.1, 1",
        logreg_max_iter: num(defaults.logreg_max_iter, 5000),
        cv_folds: num(defaults.cv_folds, 3),
        seed: num(defaults.seed, 42),
      },
    };
  }
  if (type === "random_forest") {
    return {
      kind: "forest",
      v: {
        rf_n_estimators: num(defaults.rf_n_estimators, 300),
        rf_max_depth_grid: list(defaults.rf_max_depth_grid) || "none, 16",
        rf_min_samples_leaf_grid: list(defaults.rf_min_samples_leaf_grid) || "1, 4",
        rf_max_features_grid: list(defaults.rf_max_features_grid) || "sqrt",
        cv_folds: num(defaults.cv_folds, 3),
        seed: num(defaults.seed, 42),
      },
    };
  }
  return {
    kind: "cnn",
    v: {
      lr: num(defaults.lr, 1e-4),
      batch_size: num(defaults.batch_size, 64),
      max_epochs: num(defaults.max_epochs, 50),
      patience: num(defaults.patience, 8),
      dropout: num(defaults.dropout, 0.3),
      fc_width: num(defaults.fc_width, 512),
      fc_layers: num(defaults.fc_layers, 4),
      ensemble_size: num(defaults.ensemble_size, 1),
      seed: num(defaults.seed, 42),
      augment_flip: typeof defaults.augment_flip === "boolean" ? defaults.augment_flip : true,
      weight_decay: num(defaults.weight_decay, 0),
    },
  };
}

/** "0.001, 0.01 1e-1" → numbers; null when any token is not a finite number. */
export function parseNumberList(text: string): number[] | null {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return null;
  const out = tokens.map(Number);
  return out.every(Number.isFinite) ? out : null;
}

/** Depth grid: positive integers or "none" (unlimited depth). */
export function parseDepthGrid(text: string): Array<number | null> | null {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return null;
  const out: Array<number | null> = [];
  for (const t of tokens) {
    if (/^(none|null|unlimited)$/i.test(t)) out.push(null);
    else {
      const n = Number(t);
      if (!Number.isInteger(n) || n < 1) return null;
      out.push(n);
    }
  }
  return out;
}

/** Max-features grid: "sqrt", "log2", a fraction in (0, 1] or a whole number of features ≥ 1. */
export function parseMaxFeatures(text: string): Array<string | number> | null {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return null;
  const out: Array<string | number> = [];
  for (const t of tokens) {
    if (/^(sqrt|log2)$/i.test(t)) out.push(t.toLowerCase());
    else {
      const n = Number(t);
      if (!Number.isFinite(n) || n <= 0 || (n > 1 && !Number.isInteger(n))) return null;
      out.push(n);
    }
  }
  return out;
}

export type FieldErrors = Partial<Record<string, string>>;
export interface Validation {
  errors: FieldErrors;
  warnings: FieldErrors;
  config: TrainingConfigIn | null;
}

const isInt = (v: number | null): v is number => v !== null && Number.isInteger(v);

function intIn(errors: FieldErrors, key: string, v: number | null, min: number, max?: number) {
  if (!isInt(v) || v < min || (max !== undefined && v > max)) {
    errors[key] = max !== undefined ? `A whole number from ${min} to ${max}.` : `A whole number ≥ ${min}.`;
  }
}

/** Validate a form and build the request config (null when invalid). */
export function validateForm(form: FormState): Validation {
  const errors: FieldErrors = {};
  const warnings: FieldErrors = {};
  if (form.kind === "cnn") {
    const v = form.v;
    if (v.lr === null || !(v.lr > 0) || v.lr > 1) errors.lr = "A learning rate above 0 and at most 1.";
    else if (v.lr > 0.01) warnings.lr = "Rates above 0.01 often make the CNN diverge; 1e-4 is the AstroNet default.";
    intIn(errors, "batch_size", v.batch_size, 1, 4096);
    intIn(errors, "max_epochs", v.max_epochs, 1, 1000);
    intIn(errors, "patience", v.patience, 1, 1000);
    if (isInt(v.patience) && isInt(v.max_epochs) && v.patience >= v.max_epochs) warnings.patience = "Patience ≥ max epochs: early stopping will never trigger.";
    if (v.dropout === null || v.dropout < 0 || v.dropout >= 1) errors.dropout = "Between 0 (inclusive) and 1 (exclusive).";
    intIn(errors, "fc_width", v.fc_width, 1, 8192);
    intIn(errors, "fc_layers", v.fc_layers, 0, 16);
    intIn(errors, "ensemble_size", v.ensemble_size, 1, 10);
    intIn(errors, "seed", v.seed, 0);
    if (v.weight_decay === null || v.weight_decay < 0) errors.weight_decay = "0 or more.";
    if (Object.keys(errors).length) return { errors, warnings, config: null };
    return {
      errors,
      warnings,
      config: {
        lr: v.lr,
        batch_size: v.batch_size,
        max_epochs: v.max_epochs,
        patience: v.patience,
        dropout: v.dropout,
        fc_width: v.fc_width,
        fc_layers: v.fc_layers,
        ensemble_size: v.ensemble_size,
        seed: v.seed,
        augment_flip: v.augment_flip,
        weight_decay: v.weight_decay,
      },
    };
  }
  if (form.kind === "logreg") {
    const v = form.v;
    const grid = parseNumberList(v.logreg_c_grid);
    if (!grid || grid.some((c) => c <= 0)) errors.logreg_c_grid = "One or more positive numbers, separated by commas.";
    intIn(errors, "logreg_max_iter", v.logreg_max_iter, 1, 1_000_000);
    intIn(errors, "cv_folds", v.cv_folds, 2, 20);
    intIn(errors, "seed", v.seed, 0);
    if (Object.keys(errors).length || !grid) return { errors, warnings, config: null };
    return { errors, warnings, config: { logreg_c_grid: grid, logreg_max_iter: v.logreg_max_iter, cv_folds: v.cv_folds, seed: v.seed } };
  }
  const v = form.v;
  const depth = parseDepthGrid(v.rf_max_depth_grid);
  const leaf = parseNumberList(v.rf_min_samples_leaf_grid);
  const feats = parseMaxFeatures(v.rf_max_features_grid);
  intIn(errors, "rf_n_estimators", v.rf_n_estimators, 1, 5000);
  if (!depth) errors.rf_max_depth_grid = "Whole numbers ≥ 1, or “none” for unlimited depth.";
  if (!leaf || leaf.some((x) => !Number.isInteger(x) || x < 1)) errors.rf_min_samples_leaf_grid = "Whole numbers ≥ 1.";
  if (!feats) errors.rf_max_features_grid = "“sqrt”, “log2”, a fraction in (0, 1] or a whole number of features.";
  intIn(errors, "cv_folds", v.cv_folds, 2, 20);
  intIn(errors, "seed", v.seed, 0);
  const grid = (depth?.length ?? 1) * (leaf?.length ?? 1) * (feats?.length ?? 1);
  if (grid > 24) warnings.rf_max_depth_grid = `${grid} grid combinations × ${v.cv_folds ?? "?"} folds: this search can take a while.`;
  if (Object.keys(errors).length || !depth || !leaf || !feats) return { errors, warnings, config: null };
  return {
    errors,
    warnings,
    config: {
      rf_n_estimators: v.rf_n_estimators,
      rf_max_depth_grid: depth,
      rf_min_samples_leaf_grid: leaf,
      rf_max_features_grid: feats,
      cv_folds: v.cv_folds,
      seed: v.seed,
    },
  };
}

/** Upper bound of the training time: measured s/epoch × max epochs × ensemble members. */
export function maxTrainingSeconds(secondsPerEpoch: number | null | undefined, form: FormState): number | null {
  if (form.kind !== "cnn" || secondsPerEpoch === null || secondsPerEpoch === undefined || !Number.isFinite(secondsPerEpoch)) return null;
  const epochs = form.v.max_epochs ?? 0;
  const members = form.v.ensemble_size ?? 1;
  return secondsPerEpoch * epochs * members;
}
