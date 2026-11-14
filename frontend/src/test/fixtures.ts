/**
 * TEST FIXTURES — API responses typed with the generated OpenAPI schema (src/api/schema.d.ts), so a
 * backend change that breaks these shapes breaks the build. Values are taken from real responses
 * of the local backend (Kepler-2 = KIC 10666592, Kepler-90 = KIC 11442793) and trimmed; they are
 * used only by unit tests and Playwright interception tests, never by the app.
 */
import type {
  BlsOut,
  CandidatePage,
  CatalogStatsOut,
  DiagnosticsOut,
  DocPage,
  DocPageSummary,
  InjectionOut,
  JobOut,
  LightCurveOut,
  ModelVersionOut,
  PredictionDetailOut,
  PredictionOut,
  PredictionPage,
  PredictResponse,
  QualityOut,
  SettingsOut,
  SignalOut,
  SignalPage,
  StorageOut,
  SystemSummaryOut,
  TargetDetailOut,
  TargetSearchResult,
  TransitOut,
  UploadOut,
} from "@/api/schemas";

const SNAP = "NASA Exoplanet Archive keplerstellar (q1_q17_dr25_stellar), snapshot #4 retrieved 2026-11-14";

export const qualityA: QualityOut = {
  ok: true,
  grade: "A",
  n_transits_expected: 208,
  n_transits_observed: 156,
  in_transit_points: 1197,
  global_empty_frac: 0,
  local_empty_frac: 0,
  alignment_offset_durations: 0.0096,
  depth_ratio_vs_catalogue: 0.96,
  issues: [],
  messages: [],
};

export const job = (over: Partial<JobOut> = {}): JobOut => ({
  id: "job-1",
  kind: "catalog_refresh",
  title: "Refresh NASA catalogue",
  status: "running",
  progress: 0.4,
  message: "Downloading koi_cumulative",
  params: {},
  result: null,
  error: null,
  created_at: "2026-11-14T21:00:00",
  started_at: "2026-11-14T21:00:01",
  finished_at: null,
  eta_s: 12,
  log_tail: null,
  ...over,
});

export const kepler90b: SignalOut = {
  id: 41,
  signal_key: "KOI-K00351.06",
  kepid: 11442793,
  primary_source: "koi",
  tce_plnt_num: null,
  kepoi_name: "K00351.06",
  kepler_name: "Kepler-90 b",
  period_days: 7.00821787,
  epoch_bkjd: 137.67164,
  duration_hours: 3.812,
  depth_ppm: 116.4,
  model_snr: 19.2,
  planet_radius_re: 1.29,
  av_training_set: null,
  koi_disposition: "CONFIRMED",
  koi_pdisposition: "CANDIDATE",
  koi_score: 0.916,
  fpflags: { nt: 0, ss: 0, co: 0, ec: 0 },
  category: "confirmed",
  label_conflict: false,
  match_status: "koi_only",
  kepler_host_name: "Kepler-90",
  lc_status: "available",
  provenance: { period_days: { table: "cumulative", column: "koi_period", snapshot_id: 2, value: 7.00821787 } },
};

export const kepler2b: SignalOut = {
  ...kepler90b,
  id: 19997,
  signal_key: "TCE-010666592-01",
  kepid: 10666592,
  primary_source: "tce",
  tce_plnt_num: 1,
  kepoi_name: "K00002.01",
  kepler_name: "Kepler-2 b",
  period_days: 2.20474,
  epoch_bkjd: 132.381,
  duration_hours: 3.86,
  depth_ppm: 6704,
  model_snr: 3715,
  planet_radius_re: 16.1,
  av_training_set: "PC",
  koi_score: 1,
  kepler_host_name: "Kepler-2",
  provenance: null,
};

export const kepler2Secondary: SignalOut = {
  ...kepler2b,
  id: 19998,
  signal_key: "TCE-010666592-02",
  tce_plnt_num: 2,
  kepoi_name: null,
  kepler_name: null,
  period_days: 2.20475,
  epoch_bkjd: 133.479,
  duration_hours: 4.5,
  depth_ppm: 48.74,
  category: "false_positive",
  av_training_set: "AFP",
  koi_disposition: null,
  label_conflict: true,
};

export const signalPage: SignalPage = { total: 22644, limit: 50, offset: 0, items: [kepler2b, kepler2Secondary, kepler90b] };

export const catalogStats: CatalogStatsOut = {
  total: 22644,
  categories: { candidate: 2002, confirmed: 2760, false_positive: 14114, unknown: 3768 },
  av_labels: { none: 2277, AFP: 9596, NTP: 2541, PC: 3600, UNK: 4630 },
  koi_dispositions: { none: 13080, CANDIDATE: 1977, CONFIRMED: 2748, "FALSE POSITIVE": 4839 },
  label_conflicts: 150,
  with_lightcurve: 11315,
  histograms: [
    {
      key: "log10_period",
      label: "log10 period",
      unit: "log10(days)",
      edges: [-1, 0, 1, 2, 3],
      counts: { candidate: [10, 900, 800, 292], confirmed: [5, 1500, 1100, 155], false_positive: [200, 9000, 4000, 914], unknown: [1, 2000, 1500, 267] },
      n_missing: { candidate: 0, confirmed: 0, false_positive: 0, unknown: 0 },
    },
  ],
  snapshots_retrieved_at: { dr24_tce: "2026-11-14T19:17:13", koi_cumulative: "2026-11-14T19:17:16" },
  note: "Values are catalogue values (DR24 TCE / KOI / confirmed tables) exactly as published.",
};

export const modelLR: ModelVersionOut = {
  id: 1,
  name: "Pilot DR24 v1 - Logistic regression",
  model_type: "logreg",
  model_type_name: "Logistic regression",
  experiment_id: 1,
  dataset_id: 1,
  dataset_name: "Pilot DR24 v1",
  pipeline_version: "1.0",
  compatible: true,
  checkpoint_path: "/data/artifacts/models/1",
  checkpoint_exists: true,
  threshold: 0.37,
  temperature: 1.1,
  ensemble_size: 1,
  n_params: 16,
  is_active: true,
  is_fixture: false,
  val_metrics: { pr_auc: 0.82, roc_auc: 0.9, f1: 0.86, precision: 0.8, recall: 0.92, n: 29 },
  test_metrics: { pr_auc: 0.79, roc_auc: 0.88, f1: 0.81, precision: 0.77, recall: 0.86, n: 31 },
  n_evaluations: 2,
  n_test_evaluations: 1,
  created_at: "2026-11-14T21:39:50",
};

export const modelFixture: ModelVersionOut = {
  ...modelLR,
  id: 9,
  name: "Fixture CNN",
  model_type: "cnn_two_view",
  model_type_name: "Two-view CNN",
  is_active: false,
  is_fixture: true,
  ensemble_size: 5,
  test_metrics: {},
};

const brief = {
  id: modelLR.id,
  name: modelLR.name,
  model_type: modelLR.model_type,
  dataset_id: 1,
  dataset_name: "Pilot DR24 v1",
  is_active: true,
  is_fixture: false,
  threshold: 0.37,
  val_metrics: modelLR.val_metrics,
  test_metrics: modelLR.test_metrics,
  created_at: modelLR.created_at,
};

export const prediction = (over: Partial<PredictionOut> = {}): PredictionOut => ({
  id: 7,
  created_at: "2026-11-14T21:50:00",
  model_version_id: 1,
  model_name: modelLR.name,
  model_type: "logreg",
  is_fixture_model: false,
  probability: 0.874,
  raw_probability: 0.81,
  predicted_label: 1,
  predicted_class: "planet-like",
  threshold: 0.37,
  threshold_mode: "validation_f1",
  uncertainty: 0.05,
  uncertainty_method: "ensemble_std",
  member_probabilities: [0.83, 0.86, 0.88, 0.9, 0.91],
  seen_in_split: null,
  inference_ms: 4,
  source_type: "catalog",
  kepid: 11442793,
  signal_id: 41,
  signal_key: "KOI-K00351.06",
  input_name: "Kepler-90 (KIC 11442793)",
  ephemeris: { period_days: 7.00821787, epoch: 137.67164, duration_hours: 3.812, depth_ppm: 116.4, source: "catalogue", label: "KOI-K00351.06", time_system: "BKJD" },
  quality_grade: "A",
  quality_ok: true,
  catalog_labels: { signal_key: "KOI-K00351.06", kepler_name: "Kepler-90 b", kepoi_name: "K00351.06", av_training_set: null, koi_disposition: "CONFIRMED", category: "confirmed", label_conflict: false },
  batch_job_id: null,
  pipeline_version: "1.0",
  ...over,
});

export const systemSummary = (over: Partial<SystemSummaryOut> = {}): SystemSummaryOut => ({
  app_version: "1.0.0",
  pipeline_version: "1.0",
  catalog: {
    n_signals: 22644,
    n_targets: 14233,
    by_category: { candidate: 2002, confirmed: 2760, false_positive: 14114, unknown: 3768 },
    by_av_label: { none: 2277, AFP: 9596, NTP: 2541, PC: 3600, UNK: 4630 },
    by_koi_disposition: { none: 13080, CANDIDATE: 1977, CONFIRMED: 2748, "FALSE POSITIVE": 4839 },
    label_conflicts: 150,
    last_refresh: "2026-11-14T19:17:20",
    snapshot_ids: { confirmed: 3, dr24_tce: 1, koi_cumulative: 2, stellar: 4 },
  },
  lightcurves: { available: 6365, no_data: 0, error: 0, downloading: 0, queued: 3501, not_downloaded: 4367, disk_bytes: 4167267846 },
  datasets: { count: 1, n_ready: 1, latest: { id: 1, name: "Pilot DR24 v1", status: "ready", tier: "pilot", label_mode: "astronet_dr24", n_examples: 295, created_at: "2026-11-14T21:36:51" } },
  models: { count: 1, n_real: 1, active: brief, default_model_id: null, default_for_predictions: brief },
  predictions: { count: 1, recent: [prediction()] },
  running_jobs: [],
  device: { preference: "auto", device: "cpu", cuda_available: false, cuda_device: null, mps_available: false, torch: "2.15.0", cpu_count: 4, torch_num_threads: 4, platform: "Linux", python: "3.11", error: null },
  checklist: [
    { key: "refresh_catalog", title: "Refresh the NASA catalogue", description: "Download Kepler DR24 TCEs, KOIs…", done: true, page: "catalog", action: { method: "POST", path: "/api/catalog/refresh" } },
    { key: "download_lightcurves", title: "Download light curves", description: "Fetch Kepler long-cadence light curves…", done: true, page: "targets", action: null },
    { key: "build_dataset", title: "Build a dataset", description: "Process labelled signals…", done: true, page: "datasets", action: { method: "POST", path: "/api/datasets" } },
    { key: "train_model", title: "Train a model", description: "Train logistic regression…", done: true, page: "training", action: { method: "POST", path: "/api/training/runs" } },
    { key: "evaluate_model", title: "Evaluate on the test set", description: "Measure accuracy…", done: false, page: "evaluation", action: { method: "POST", path: "/api/evaluation/runs" } },
    { key: "run_prediction", title: "Score a signal", description: "Run a model on a catalogue signal…", done: true, page: "predict", action: { method: "POST", path: "/api/predictions" } },
  ],
  next_steps: [{ key: "evaluate_model", title: "Evaluate on the test set", description: "Measure accuracy…", done: false, page: "evaluation", action: { method: "POST", path: "/api/evaluation/runs" } }],
  disclaimer: "Exoplanet Finder classifies transit-like signals as planet-like or false-positive-like. Planet-like scores are research leads, not discoveries.",
  ...over,
});

export const searchResults: TargetSearchResult[] = [
  { kepid: 11442793, label: "Kepler-90 (KIC 11442793)", kepler_host_name: "Kepler-90", n_signals: 8, lc_status: "available", matched_on: "kepler_host_name", matched_signal_id: null, matched_signal_key: null, matched_name: null, rank: 0 },
  { kepid: 11442793, label: "Kepler-90 (KIC 11442793)", kepler_host_name: "Kepler-90", n_signals: 8, lc_status: "available", matched_on: "kepler_name", matched_signal_id: 41, matched_signal_key: "KOI-K00351.06", matched_name: "Kepler-90 b", rank: 1 },
];

const pv = (value: number, unit: string) => ({ value, err: null, unit, provenance: "catalogue" as const, source: SNAP, note: null });

export const targetDetail = (over: Partial<TargetDetailOut> = {}): TargetDetailOut => ({
  target: {
    kepid: 11442793,
    label: "Kepler-90 (KIC 11442793)",
    kepler_host_name: "Kepler-90",
    ra: 284.4335,
    dec: 49.305161,
    kepmag: 13.804,
    lc_status: "available",
    lc_quarters: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17],
    lc_n_cadences: 52553,
    lc_error: null,
    lc_updated_at: "2026-11-14T21:02:17",
    lc_cached: true,
    lc_cache_bytes: 549343,
  },
  stellar: { teff: pv(5970, "K"), radius: pv(1.2, "R_sun"), logg: pv(4.317, "log10(cm s^-2)"), mass: pv(1.089, "M_sun"), kepmag: pv(13.804, "mag") },
  signals: [kepler90b],
  datasets: [
    { dataset_id: 1, dataset_name: "Pilot DR24 v1", dataset_status: "ready", split: "test", n_signals: 1 },
    { dataset_id: 1, dataset_name: "Pilot DR24 v1", dataset_status: "ready", split: null, n_signals: 7 },
  ],
  recent_predictions: [prediction()],
  reserved_showcase: true,
  ...over,
});

export const kepler2Detail: TargetDetailOut = targetDetail({
  target: { ...targetDetail().target, kepid: 10666592, label: "Kepler-2 (KIC 10666592)", kepler_host_name: "Kepler-2" },
  signals: [kepler2b, kepler2Secondary],
  recent_predictions: [],
  datasets: [],
  reserved_showcase: false,
});

const series = (n: number, t0: number, f: (i: number) => number) => ({ time: Array.from({ length: n }, (_, i) => t0 + i * 0.5), flux: Array.from({ length: n }, (_, i) => f(i)), n_original: n * 10 });

export const lightCurve = (over: Partial<LightCurveOut> = {}): LightCurveOut => ({
  source: { type: "catalog", kepid: 11442793, upload_id: null, upload_kind: null, input_name: "Kepler-90 (KIC 11442793)", time_system: "BKJD", n_cadences: 52553 },
  kepid: 11442793,
  upload_id: null,
  signal_id: 41,
  time_system: "BKJD",
  mission: "Kepler",
  n_cadences: 52553,
  n_points_final: 51230,
  quarters: [1, 2],
  segments: [
    { id: 1, t_start: 131.5, t_end: 165, n_cadences: 1639, n_used: 1610 },
    { id: 2, t_start: 169.5, t_end: 258.5, n_cadences: 4194, n_used: 4042 },
  ],
  cleaning: {},
  stages: { raw: series(20, 131.5, () => 1), normalized: series(20, 131.5, () => 1), trend: series(20, 131.5, () => 1), flat: series(20, 131.5, (i) => (i === 7 ? 0.9999 : 1)) },
  transit_times: [137.67164, 144.67986],
  folded: { phase: [-0.1, 0, 0.1, null], flux: [1, 0.9999, 1, null], n_original: 51230, binned: { phase: [-0.1, 0, 0.1], flux: [1, 0.99989, 1], window_days: 0.4765, bin_width_days: 0.0079 } },
  ephemeris: { period_days: 7.00821787, epoch: 137.67164, duration_hours: 3.812, depth_ppm: 116.4, source: "catalogue", label: "KOI-K00351.06", time_system: "BKJD" },
  quality: qualityA,
  detrend: "spline",
  max_points: 10000,
  pipeline_version: "1.0",
  config: {},
  warnings: [],
  processing_ms: 1436,
  cached: false,
  ...over,
});

export const blsOut: BlsOut = {
  source: { type: "catalog", kepid: 10666592, upload_id: null, upload_kind: null, input_name: "Kepler-2 (KIC 10666592)", time_system: "BKJD", n_cadences: 66864 },
  provenance: "measured",
  periods: [0.5, 1.1023, 2.2047, 4.4095],
  power: [875, 7523100, 14661495, 6946016],
  power_norm: [4.9, 13530.8, 16190.4, 12740.4],
  best: { period: 2.204729639, epoch: 121.36119, duration_hours: 3.366, depth_ppm: 6055.2, depth_err_ppm: 1.16, snr: 5238.2, sde: 16190.4, power: 14661495, n_transits: 618, n_transits_expected: 667, provenance: "measured", source: "BLS, Exoplanet Finder pipeline v1.0" },
  peaks: [
    { rank: 1, period: 2.204729639, power: 14661495, sde: 16190.4, refined: true, is_best: true, alias_of_best: null },
    { rank: 2, period: 1.1023, power: 7523100, sde: 13530.8, refined: true, is_best: false, alias_of_best: "P/2" },
  ],
  ephemeris: { period_days: 2.204729639, epoch: 121.36119, duration_hours: 3.366, depth_ppm: 6055.2, source: "measured", label: "BLS", time_system: "BKJD" },
  search: { min_period: 0.5, max_period: 735.2, baseline_days: 1470.5, n_periods_searched: 39992, frequency_oversample_effective: 0.17, bin_minutes: 30, n_points: 65140, objective: "likelihood" },
  warnings: ["BLS proposes the strongest box-shaped periodic dip; it can lock onto aliases (P/2, 2P)."],
  compute_ms: 6160,
  cached: false,
  pipeline_version: "1.0",
};

const meas = (value: number, err: number | null, unit: string) => ({ value, err, unit, provenance: "measured" as const, source: "trapezoid fit, Exoplanet Finder pipeline v1.0", note: null });

export const transitOut: TransitOut = {
  source: blsOut.source,
  signal_id: 19997,
  ephemeris: { period_days: 2.20474, epoch: 132.381, duration_hours: 3.86, depth_ppm: null, source: "catalogue", label: "TCE-010666592-01", time_system: "BKJD" },
  fit: { depth_ppm: 6443.4, depth_err_ppm: 2.19, duration_hours: 4.039, duration_err_hours: 0.0018, ingress_hours: 0.656, epoch: 121.3586, shape_ratio: 0.162, chi2_red: 3.51, converged: true, provenance: "measured", source: "trapezoid least squares" },
  odd_even: { depth_odd_ppm: 6562.3, depth_even_ppm: 6558, err_odd: 2.75, err_even: 2.75, diff_sigma: 1.11, provenance: "measured" },
  secondary: { depth_ppm: 77.9, err_ppm: 1.38, significance_sigma: 56.3, phase: 0.5, provenance: "measured" },
  individual_transits: [
    { index: 0, epoch: 121.3585, depth_ppm: 6516.8, err_ppm: 47.7, n_points: 8, coverage: 1, covered: true },
    { index: 1, epoch: 123.5633, depth_ppm: 6601.2, err_ppm: 47.7, n_points: 8, coverage: 1, covered: true },
  ],
  snr: { snr: 4807.6, depth_ppm: 6560.2, noise_ppm: 33.9, n_transits: 618, provenance: "measured" },
  transit_count: { expected: 667, observed: 618 },
  noise: { oot_scatter_ppm: 64.6, red_noise_beta: 1.48, cdpp_duration_ppm: 33.9, baseline: 1 },
  quality: { ...qualityA, n_transits_expected: 667, n_transits_observed: 618 },
  folded: { phase: [-0.1, 0, 0.1], flux: [1, 0.9935, 1], n_original: 65168, binned: { phase: [-0.1, 0, 0.1], flux: [1, 0.9935, 1], window_days: 0.485, bin_width_days: 0.008 } },
  model_curve: { phase: [-0.1, 0, 0.1], flux: [1, 0.9936, 1], model: "trapezoid (least squares on the folded light curve)" },
  comparison: [
    { quantity: "Period", unit: "d", catalogue: { ...pv(2.20474, "d") }, measured: null, estimate: null },
    { quantity: "Depth", unit: "ppm", catalogue: pv(6704, "ppm"), measured: meas(6443.4, 2.19, "ppm"), estimate: null },
    { quantity: "Planet radius", unit: "R_earth", catalogue: pv(16.1, "R_earth"), measured: null, estimate: { value: 17.09, err: 0.003, unit: "R_earth", provenance: "estimate", source: "measured depth x catalogue stellar radius", note: "Ignores limb darkening and dilution." } },
  ],
  stellar: targetDetail().stellar,
  derived: {
    planet_radius_re: { value: 17.09, err: 0.003, unit: "R_earth", provenance: "estimate", source: "measured depth x catalogue stellar radius", note: "Ignores limb darkening and dilution." },
  },
  masked_other_signals: [{ period_days: 2.20475, epoch: 133.479, duration_hours: 4.5, depth_ppm: 48.74, source: "catalogue", label: "TCE-010666592-02", time_system: "BKJD" }],
  warnings: [],
  pipeline_version: "1.0",
  compute_ms: 1970,
  cached: false,
};

export const injectionOut: InjectionOut = {
  synthetic: true,
  label: "SYNTHETIC injection-recovery test on real Kepler-2 (KIC 10666592) data. The injected transit is artificial; this result is not an observation and is never stored.",
  kepid: 10666592,
  injected: { period_days: 5.3, epoch: 122.4998, duration_hours: 3, depth_ppm: 500, ingress_fraction: 0.1, model: "trapezoid", n_transits_in_data: 194, snr_at_injected_ephemeris: 196.7 },
  recovered: { period_days: 5.30001, epoch: 122.4991, duration_hours: 2.754, depth_ppm: 460, depth_err_ppm: 2, snr: 235.8, sde: 5083, n_transits: 200, method: "blind BLS on the detrended injected light curve", provenance: "measured" },
  recovered_ok: true,
  criteria: { period_rel_tol: 0.01, epoch_tol_hours: 1.5, period_match: true, epoch_match: true, epoch_offset_hours: 0.0165, alias_of_injected: null, matches_known_signal: null, depth_ratio: 0.92 },
  masked_known_signals: [],
  warnings: [],
  n_cadences_masked: 15461,
  periodogram: { periods: [1, 5.3, 10.6], power: [100, 3000, 1400] },
  folded_injected: { phase: [-0.1, 0, 0.1], flux: [1, 0.9995, 1], window_days: 0.375, bin_width_days: 0.006 },
  pipeline_version: "1.0",
  compute_ms: 7838,
};

export const predictResponse = (over: Partial<PredictResponse> = {}): PredictResponse => ({
  results: [prediction(), prediction({ id: 8, model_version_id: 9, model_name: "Fixture CNN", model_type: "cnn_two_view", is_fixture_model: true, probability: 0.31, seen_in_split: "train", predicted_label: 0 })],
  views: { global: [0, -0.2, -1, -0.2, 0], local: [0, -0.5, -1, -0.5, 0], global_phase: [-3.5, -1.75, 0, 1.75, 3.5], local_phase: [-0.3, -0.15, 0, 0.15, 0.3] },
  quality: qualityA,
  ephemeris: { period_days: 7.00821787, epoch: 137.67164, duration_hours: 3.812, depth_ppm: 116.4, source: "catalogue", label: "KOI-K00351.06", time_system: "BKJD" },
  features: { depth_ppm: 112, snr: 19, odd_even_sigma: 0.78 },
  catalog_labels: prediction().catalog_labels,
  signal: kepler90b,
  source: { type: "catalog", kepid: 11442793, upload_id: null, upload_kind: null, input_name: "Kepler-90 (KIC 11442793)", time_system: "BKJD", n_cadences: 52553 },
  warnings: ["This star is a reserved showcase system: it is never used for training."],
  disclaimer: "Planet-like scores are research leads for follow-up, not discoveries or confirmations.",
  pipeline_version: "1.0",
  ...over,
});

export const predictionPage: PredictionPage = { total: 2, limit: 50, offset: 0, items: [prediction(), prediction({ id: 3, source_type: "csv", kepid: null, signal_id: null, signal_key: null, input_name: "my_star.csv", catalog_labels: null, probability: 0.12, predicted_label: 0, uncertainty: null })] };

export const predictionDetail: PredictionDetailOut = {
  ...prediction(),
  views: predictResponse().views,
  views_source: "stored with the prediction",
  features: { depth_ppm: 112, snr: 19 },
  quality: qualityA,
  signal: kepler90b,
  warnings: ["Stored warning: reserved showcase star."],
  disclaimer: "Planet-like scores are research leads, not discoveries.",
};

export const candidatePage: CandidatePage = {
  total: 1,
  limit: 50,
  offset: 0,
  items: [
    {
      rank: 1,
      signal_id: 5001,
      signal_key: "KOI-K00752.02",
      kepid: 10797460,
      kepler_host_name: null,
      kepler_name: null,
      kepoi_name: "K00752.02",
      category: "candidate",
      koi_disposition: "CANDIDATE",
      av_training_set: "PC",
      label_conflict: false,
      period_days: 54.418,
      depth_ppm: 874.8,
      duration_hours: 4.507,
      planet_radius_re: 2.83,
      scores: [{ prediction_id: 11, model_version_id: 1, model_name: modelLR.name, model_type: "logreg", is_fixture_model: false, probability: 0.93, uncertainty: null, predicted_label: 1, seen_in_split: null, created_at: "2026-11-14T22:00:00" }],
      mean_probability: 0.93,
      max_probability: 0.93,
      min_probability: 0.93,
      agreement: { n_models: 1, n_planet_like: 1, fraction_planet_like: 1, consensus: "planet-like" },
      uncertainty: null,
      quality_grade: "B",
      quality_ok: true,
      seen_in_training: false,
      has_fixture_model_scores: false,
    },
  ],
  models: [{ id: 1, name: modelLR.name, model_type: "logreg", is_fixture: false }],
  disclaimer: "These rankings are research leads for follow-up, not discoveries.",
};

export const settingsOut: SettingsOut = {
  values: { device: "auto", download_workers: 4, keep_raw_fits: false, default_model_id: null, default_threshold_mode: "validation_f1", ui_density: "comfortable", reduced_motion: "system" },
  defaults: { device: "auto", download_workers: 4, keep_raw_fits: false, default_model_id: null, default_threshold_mode: "validation_f1", ui_density: "comfortable", reduced_motion: "system" },
  descriptions: {
    device: { description: "Compute device for training and inference.", kind: "choice", choices: ["auto", "cpu", "cuda", "mps"], minimum: null, maximum: null },
    download_workers: { description: "Parallel downloads from NASA MAST (be polite: 2-8).", kind: "int", choices: null, minimum: 1, maximum: 16 },
    keep_raw_fits: { description: "Keep raw FITS files after caching.", kind: "bool", choices: null, minimum: null, maximum: null },
    default_model_id: { description: "Model version used by default for predictions.", kind: "optional_int", choices: null, minimum: null, maximum: null },
  },
};

export const storageOut: StorageOut = {
  categories: [
    { key: "raw_fits", label: "Raw FITS downloads", path: "/data/raw/kepler", bytes: 31455360, n_files: 72, clearable: true, description: "Original MAST quarter files." },
    { key: "lightcurves", label: "Light-curve cache", path: "/data/lightcurves", bytes: 4193929825, n_files: 6405, clearable: false, description: "Stitched light curve per star." },
    { key: "uploads", label: "Uploads", path: "/data/uploads", bytes: 0, n_files: 0, clearable: true, description: "Files you uploaded." },
  ],
  total_bytes: 4225385185,
  disk: { path: "/data", total: 270553174016, used: 24969490432, free: 16314044416 },
};

export const diagnosticsOut = (network: DiagnosticsOut["network"] = null): DiagnosticsOut => ({
  versions: { exofinder: "1.0.0", pipeline: "1.0", python: "3.11.18", torch: "2.15.0" },
  paths: { repo_data_dir: { path: "/data", exists: true, writable: true } },
  database_url: "sqlite:////data/app.db",
  storage: storageOut,
  device: systemSummary().device,
  settings: settingsOut.values,
  network,
  network_checked: network !== null,
});

export const docPages: DocPageSummary[] = [
  { slug: "limitations", title: "Known limitations", size_bytes: 3077, updated_at: "2026-11-14T18:57:25" },
  { slug: "methodology", title: "Research methodology", size_bytes: 6994, updated_at: "2026-11-14T18:56:40" },
];

export const docMethodology: DocPage = {
  slug: "methodology",
  title: "Research methodology",
  markdown: [
    "# Research methodology",
    "",
    "Exoplanet Finder classifies **transit-like signals**.",
    "",
    "## 1. The transit method",
    "",
    "$$\\delta \\approx \\left(\\frac{R_p}{R_\\star}\\right)^2,$$",
    "",
    "The dip repeats every period $P$ and lasts $T_{14}$. See [Data sources](data-sources.md).",
    "",
    "| Challenge | Effect |",
    "|---|---|",
    "| Data gaps | Missed transits |",
  ].join("\n"),
};

export const uploadCsv: UploadOut = {
  upload_id: "f6e3a817cadc42e687ca11e2941a0931",
  filename: "synthetic_lc.csv",
  kind: "csv",
  size_bytes: 132387,
  n_rows: 4412,
  columns: ["time", "flux", "flux_err", "quality"],
  suggested_mapping: { time: "time", flux: "flux", flux_err: "flux_err", quality: "quality" },
  suggested_time_system: "BKJD",
  preview_rows: [{ time: 130, flux: 1.0005153, flux_err: 0.0004, quality: 0 }],
  meta: {},
  parsed: null,
  created_at: "2026-11-14T21:39:46",
};

export const uploadCsvParsed: UploadOut = {
  ...uploadCsv,
  parsed: {
    mapping: { time: "time", flux: "flux", flux_err: "flux_err", quality: "quality" },
    time_system: "BKJD",
    input_time_system: "BKJD",
    n_points: 4412,
    time_span_days: 89.98,
    time_start: 130,
    time_end: 219.98,
    cadence_days: 0.0204,
    mission: "unknown",
    kepid: null,
    warnings: ["Uploaded table: its origin and processing are unknown to this app."],
    out_of_distribution: true,
    parsed_at: "2026-11-14T21:39:46",
  },
};
