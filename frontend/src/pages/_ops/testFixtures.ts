/**
 * TEST FIXTURES — synthetic API payloads for the machine-learning operations unit tests and the
 * Playwright fixture specs. Every value is invented for testing; nothing here is a scientific
 * result and no page imports this file. Typed against the generated OpenAPI schema so the tests
 * break when the backend contract changes.
 */
import type { JobOut, ModelVersionOut } from "@/api/schemas";
import type {
  DatasetDetailOut,
  DatasetExamplePage,
  DatasetOut,
  EvaluationCompareOut,
  EvaluationDetailOut,
  EvaluationExamplePage,
  EvaluationOut,
  ExperimentCompareOut,
  ExperimentDetailOut,
  ExperimentOut,
  FeatureImportanceOut,
  ModelCardOut,
  TierOut,
} from "@/api/schemasOps";

const T0 = "2026-11-14T20:00:00";

export const fxDataset: DatasetOut = {
  id: 7,
  name: "Fixture Pilot",
  label_mode: "astronet_dr24",
  tier: "pilot",
  status: "ready",
  pipeline_version: "1.0",
  split_seed: 42,
  config: { split_fractions: [0.8, 0.1, 0.1], exclude_conflicts: true, pipeline: { detrend_method: "spline", global_bins: 2001, local_bins: 201 } },
  content_hash: "abc123def4567890abc123def4567890abc123def4567890abc123def4567890",
  path: "/data/datasets/7",
  parent_id: null,
  n_examples: 100,
  n_train: 80,
  n_val: 10,
  n_test: 10,
  n_excluded: 5,
  created_at: T0,
  job_id: "job-build-7",
  n_models: 0,
  error: null,
  is_synthetic: false,
  compatible: true,
};

export const fxDatasetDetail: DatasetDetailOut = {
  ...fxDataset,
  provenance: {
    catalogue_snapshots: [
      { id: 1, source: "dr24_tce", table: "q1_q17_dr24_tce", retrieved_at: "2026-01-01T00:00:00", rows: 100, sha256: "f".repeat(64) },
    ],
    lightcurves: { n_stars: 62, digests_sha256: "e".repeat(64), file: "lightcurves.json" },
  },
  stats: {
    per_split: {
      train: { n: 80, n_pos: 40, n_neg: 40, n_stars: 50 },
      val: { n: 10, n_pos: 5, n_neg: 5, n_stars: 6 },
      test: { n: 10, n_pos: 6, n_neg: 4, n_stars: 6 },
    },
    n_selected: 105,
    n_included: 100,
    n_excluded: 5,
    n_stars: 62,
    n_pos: 51,
    n_neg: 49,
    exclusions_by_reason: { label_conflict: 3, no_av_label: 2 },
    exclusion_examples: {},
    exclusion_reason_labels: { label_conflict: "Autovetter label and KOI disposition disagree (excluded on request)", no_av_label: "No DR24 TCE / Autovetter label for this signal" },
    quality_grades: { A: 90, B: 5, C: 5 },
    quality_issues: { depth_mismatch: 4 },
    period_hist: { log10_edges: [0, 1, 2, 3], counts: { planet_like: [10, 20, 21], false_positive_like: [30, 15, 4] }, unit: "days" },
    depth_hist: { log10_edges: [1, 2, 3, 4], counts: { planet_like: [5, 30, 16], false_positive_like: [10, 20, 19] }, unit: "ppm" },
    processing: null,
    downloads: {},
    reserved: [],
    warnings: [],
    synthetic: false,
    timings: { total_s: 12.5 },
    manifest: { arrays_sha256: "fedcba9876543210fedcba9876543210" },
  },
};

export const fxTiers: TierOut[] = [
  {
    tier: "pilot",
    label_mode: "astronet_dr24",
    n_signals: 300,
    n_unlabelled_reserved: 9,
    n_pos: 150,
    n_neg: 150,
    n_label_conflicts: 14,
    n_stars: 167,
    n_stars_downloaded: 167,
    n_stars_missing: 0,
    est_download_bytes: 0,
    est_download_minutes: 0,
    est_process_minutes: 2.7,
    est_minutes: 2.7,
    estimate_basis: "fixture",
    description: "About 300 labelled signals (fixture).",
  },
];

export const fxExamples: DatasetExamplePage = {
  total: 1,
  items: [
    {
      signal_id: 11,
      signal_key: "TCE-000000011-01",
      kepid: 11,
      label: 1,
      split: "train",
      included: true,
      exclusion_reason: null,
      exclusion_label: null,
      quality: { grade: "A" },
      quality_grade: "A",
      array_index: 0,
      period_days: 3.5,
      duration_hours: 2.1,
      depth_ppm: 500,
      model_snr: 20,
      kepoi_name: "K00011.01",
      kepler_name: null,
      category: "candidate",
      av_training_set: "PC",
      koi_disposition: "CANDIDATE",
      label_conflict: false,
      is_reserved: false,
    },
  ],
};

const cardBase = { inputs: ["Global view"], strengths: ["fast"], limitations: ["linear"], architecture: ["layer"], uncertainty: null, training: "fixture", reference: null };
export const fxModelCards: ModelCardOut[] = [
  { ...cardBase, type: "logreg", name: "Logistic regression", description: "Linear baseline (fixture).", default_config: { logreg_c_grid: [0.01, 0.1], logreg_max_iter: 5000, cv_folds: 3, seed: 42 }, n_params: null },
  { ...cardBase, type: "random_forest", name: "Random forest", description: "Tree ensemble (fixture).", default_config: { rf_n_estimators: 300, rf_max_depth_grid: [null, 16], rf_min_samples_leaf_grid: [1, 4], rf_max_features_grid: ["sqrt"], cv_folds: 3, seed: 42 }, n_params: null },
  { ...cardBase, type: "cnn_single", name: "Single-view CNN (global view)", description: "Global CNN (fixture).", default_config: { lr: 0.0001, batch_size: 64, max_epochs: 50, patience: 8, dropout: 0.3, fc_width: 512, fc_layers: 4, augment_flip: true, ensemble_size: 1, seed: 42, weight_decay: 0 }, n_params: 9177393 },
  { ...cardBase, type: "cnn_two_view", name: "Two-view CNN (AstroNet)", description: "Two-view CNN (fixture).", default_config: { lr: 0.0001, batch_size: 64, max_epochs: 50, patience: 8, dropout: 0.3, fc_width: 512, fc_layers: 4, augment_flip: true, ensemble_size: 1, seed: 42, weight_decay: 0 }, n_params: 9940193 },
];

export const fxModel: ModelVersionOut = {
  id: 21,
  name: "Fixture LR",
  model_type: "logreg",
  model_type_name: "Logistic regression",
  experiment_id: 31,
  dataset_id: 7,
  dataset_name: "Fixture Pilot",
  pipeline_version: "1.0",
  compatible: true,
  checkpoint_path: "/artifacts/models/21",
  checkpoint_exists: true,
  threshold: 0.42,
  temperature: 1.1,
  ensemble_size: 1,
  n_params: 418,
  is_active: true,
  is_fixture: false,
  val_metrics: { pr_auc: 0.91, roc_auc: 0.93, f1: 0.88 },
  test_metrics: {},
  n_evaluations: 1,
  n_test_evaluations: 0,
  created_at: T0,
};

export const fxEvaluation: EvaluationOut = {
  id: 41,
  model_version_id: 21,
  model_name: "Fixture LR",
  model_type: "logreg",
  experiment_id: 31,
  is_fixture: false,
  dataset_id: 7,
  dataset_name: "Fixture Pilot",
  split: "val",
  threshold: 0.42,
  n: 10,
  n_pos: 5,
  n_neg: 5,
  summary: { pr_auc: 0.91, roc_auc: 0.93, f1: 0.88, precision: 0.9, recall: 0.86, ece: 0.05 },
  test_evaluation_number: null,
  created_at: T0,
};

export const fxEvaluationDetail: EvaluationDetailOut = {
  ...fxEvaluation,
  metrics: { pr_auc: 0.91, roc_auc: 0.93, f1: 0.88, precision: 0.9, recall: 0.86, specificity: 0.9, accuracy: 0.88, brier: 0.09, ece: 0.05, n: 10, n_pos: 5, n_neg: 5, tp: 4, fp: 1, tn: 4, fn: 1, threshold: 0.42 },
  metrics_at_0_5: { precision: 1, recall: 0.6, f1: 0.75, specificity: 1, accuracy: 0.8, tp: 3, fp: 0, tn: 5, fn: 2 },
  ci: { pr_auc: [0.8, 0.98], roc_auc: [0.82, 0.99], f1: [0.7, 0.95] },
  ci_method: { n_boot: 1000, method: "percentile", resample: "star" },
  curves: {
    roc: [
      { fpr: 0, tpr: 0, threshold: null },
      { fpr: 0.2, tpr: 0.8, threshold: 0.5 },
      { fpr: 1, tpr: 1, threshold: 0.01 },
    ],
    pr: [
      { recall: 0, precision: 1, threshold: null },
      { recall: 0.8, precision: 0.8, threshold: 0.5 },
      { recall: 1, precision: 0.5, threshold: 0.01 },
    ],
    calibration: [
      { bin_lo: 0, bin_hi: 0.5, mean_pred: 0.2, frac_pos: 0.25, count: 4 },
      { bin_lo: 0.5, bin_hi: 1, mean_pred: 0.8, frac_pos: 0.83, count: 6 },
    ],
  },
  confusion: { tp: 4, fp: 1, tn: 4, fn: 1 },
  timing: { ms_per_sample_batch1: 0.4, ms_per_sample_batch64: 0.02, device: "cpu" },
  per_example_available: true,
};

export const fxEvaluationExamples: EvaluationExamplePage = {
  total: 1,
  counts: { tp: 4, fp: 1, tn: 4, fn: 1 },
  items: [
    {
      signal_id: 12,
      kepid: 12,
      signal_key: "TCE-000000012-01",
      label: 0,
      prob: 0.71,
      raw_prob: 0.66,
      predicted_label: 1,
      uncertainty: null,
      outcome: "fp",
      kepoi_name: null,
      kepler_name: null,
      category: "false_positive",
      av_training_set: "AFP",
      koi_disposition: "FALSE POSITIVE",
      period_days: 1.2,
      duration_hours: 1.5,
      depth_ppm: 9000,
      local_view: [0, -0.2, -1, -0.2, 0],
      local_phase: [-0.1, -0.05, 0, 0.05, 0.1],
    },
  ],
};

export const fxFeatureImportance: FeatureImportanceOut = {
  evaluation_id: 41,
  model_version_id: 21,
  model_type: "logreg",
  split: "val",
  n_examples: 10,
  metric: "pr_auc",
  baseline_score: 0.91,
  n_repeats: 5,
  seed: 0,
  method: "grouped permutation importance (fixture)",
  features: [
    { feature: "local_view", label: "Local view (all bins)", n_columns: 201, importance_mean: 0.2, importance_std: 0.05 },
    { feature: "snr", label: "snr", n_columns: 1, importance_mean: 0.01, importance_std: 0.005 },
  ],
  intrinsic: [{ name: "global_100", weight: -0.02 }],
  intrinsic_meaning: "coefficients on standardised inputs",
  is_fixture: false,
};

export const fxExperiment: ExperimentOut = {
  id: 31,
  name: "Fixture LR run",
  model_type: "logreg",
  dataset_id: 7,
  dataset_name: "Fixture Pilot",
  status: "succeeded",
  seed: 42,
  device: "cpu",
  best_epoch: 1,
  epochs_run: 1,
  duration_s: 4.2,
  val_summary: { pr_auc: 0.91, roc_auc: 0.93, f1: 0.88, ece: 0.05 },
  threshold: 0.42,
  model_version_id: 21,
  is_active_model: true,
  is_fixture: false,
  test_metrics: {},
  notes: "",
  tags: ["baseline"],
  archived: false,
  job_id: "job-train-31",
  error: null,
  created_at: T0,
  finished_at: T0,
};

export const fxExperimentCnn: ExperimentOut = {
  ...fxExperiment,
  id: 32,
  name: "Fixture CNN run",
  model_type: "cnn_two_view",
  best_epoch: 2,
  epochs_run: 3,
  duration_s: 60,
  val_summary: { pr_auc: 0.85, roc_auc: 0.9, f1: 0.8, ece: 0.07 },
  model_version_id: 22,
  is_active_model: false,
  tags: [],
};

export const fxExperimentDetail: ExperimentDetailOut = {
  ...fxExperiment,
  config: { model_type: "logreg", logreg_c_grid: [0.01, 0.1], logreg_max_iter: 5000, cv_folds: 3, seed: 42, lr: 0.0001 },
  environment: { python: "3.11", torch: "2.x", default_device: "cpu" },
  val_metrics: { pr_auc: 0.91, roc_auc: 0.93, f1: 0.88, precision: 0.9, recall: 0.86, ece: 0.05 },
  epochs: [{ epoch: 1, train_loss: 0.4, val_loss: 0.45, val_pr_auc: 0.91, val_roc_auc: 0.93 }],
  history: [],
  model_version: fxModel,
  evaluations: [fxEvaluation],
};

export const fxExperimentCompare: ExperimentCompareOut = {
  experiments: [fxExperiment, fxExperimentCnn],
  config_diff: [{ key: "model_type", values: { "31": "logreg", "32": "cnn_two_view" } }],
  config_same: { seed: 42 },
  curves: {
    "31": [{ epoch: 1, train_loss: 0.4, val_loss: 0.45, val_pr_auc: 0.91, val_roc_auc: 0.93 }],
    "32": [
      { epoch: 1, train_loss: 0.6, val_loss: 0.6, val_pr_auc: 0.7, val_roc_auc: 0.8 },
      { epoch: 2, train_loss: 0.4, val_loss: 0.5, val_pr_auc: 0.85, val_roc_auc: 0.9 },
      { epoch: 3, train_loss: 0.3, val_loss: 0.52, val_pr_auc: 0.84, val_roc_auc: 0.89 },
    ],
  },
  warnings: [],
};

export const fxEvaluationCompare: EvaluationCompareOut = {
  evaluations: [fxEvaluation, { ...fxEvaluation, id: 42, model_version_id: 22, model_name: "Fixture CNN", model_type: "cnn_two_view", dataset_id: 8, dataset_name: "Other" }],
  metrics: [
    { metric: "pr_auc", values: { "41": 0.91, "42": 0.85 }, ci: { "41": [0.8, 0.98], "42": [0.7, 0.95] }, best: "41" },
    { metric: "roc_auc", values: { "41": 0.93, "42": 0.9 }, ci: { "41": null, "42": null }, best: "41" },
  ],
  comparable: false,
  warnings: ["Evaluations use different datasets ([7, 8]): metrics are not directly comparable."],
};

export function fxJob(over: Partial<JobOut> = {}): JobOut {
  return {
    id: "job-1",
    kind: "build_dataset",
    title: "Build dataset 'Fixture Pilot' (pilot, astronet_dr24)",
    status: "running",
    progress: 0.4,
    message: "Processing signals 40/100",
    params: { dataset_id: 7 },
    result: null,
    error: null,
    created_at: T0,
    started_at: T0,
    finished_at: null,
    eta_s: 30,
    ...over,
  };
}
