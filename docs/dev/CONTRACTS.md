# Internal module contracts

This document fixes the interfaces between the backend packages so they can be built in parallel.
Shared types live in `backend/exofinder/astro/types.py` (`LightCurve`, `Ephemeris`, `Views`,
`QualityReport`, `ProcessedSignal`). Settings and constants live in `backend/exofinder/config.py`.
The database schema lives in `backend/exofinder/db/models.py`.

**Dependency rule:** `api → services → {data, astro, ml}`; `data → astro` (allowed); `ml → astro.types`
only; `astro` imports nothing from `data`, `ml`, `services` or `api`. No package imports `api`.

**Honesty rules (apply everywhere):**
* Never fabricate observations, labels or metrics. Synthetic light curves exist only in tests and
  in the clearly-labelled injection–recovery tool, and must carry `meta["synthetic"] = True`.
* Catalogue-derived scores (e.g. `koi_score`, `koi_pdisposition`, fp flags) are NEVER model features.
* Every catalogue/measured/estimated value exposed to the UI carries its provenance.

---

## 1. `exofinder.astro` — signal processing (pure numpy/scipy/astropy; no I/O except readers)

| Module | Public functions |
|---|---|
| `io_fits.py` | `read_kepler_fits(path_or_bytes) -> LightCurve` (one Kepler llc quarter: TIME, PDCSAP_FLUX, PDCSAP_FLUX_ERR, SAP_QUALITY; `segment` = QUARTER header; `meta` has kepid, quarter, mission, time_system="BKJD", flux_column, cadence_days). `read_fits_lightcurve(path_or_bytes, flux_column=None) -> LightCurve` generic: Kepler/K2/TESS-style BINTABLE with TIME + (PDCSAP_FLUX\|SAP_FLUX\|FLUX); records `meta["mission"]`, `meta["time_system"]` (BKJD/BTJD/unknown from TIMEREF/BJDREFI). |
| `io_csv.py` | `detect_columns(df) -> dict` suggestions `{time, flux, flux_err, quality}`; `read_csv_lightcurve(path_or_buffer, mapping=None, time_system="BKJD") -> LightCurve`; raises `LightCurveFormatError` (defined in `astro/errors.py`) with human-readable message for bad input (non-numeric, <100 points, non-monotonic after sort, all-NaN). Time systems accepted: `BKJD`, `BJD` (converted to BKJD by subtracting 2454833.0), `BTJD`, `days` (relative, unknown). |
| `cleaning.py` | `clean(lc, quality_bitmask="default") -> tuple[LightCurve, dict]` drops NaN/Inf and flagged cadences (Kepler "default" bitmask equivalent to lightkurve's default; `"hard"`, `"none"` accepted), sorts by time, returns report counts. `assign_segments(lc, gap_days=0.75) -> LightCurve` assigns segment ids at gaps when absent. |
| `normalize.py` | `normalize_segments(lc) -> LightCurve` divide each segment by its median. `stitch(list[LightCurve]) -> LightCurve` concatenates normalised quarters (sorted). |
| `transit_mask.py` | `transit_mask(time, period, epoch, duration_days, width_factor=1.5) -> bool array` True for in-transit cadences (\|phase\| < width_factor·duration/2 ... document exact convention). |
| `detrend.py` | `detrend(lc, ephemeris=None, method="spline", **kw) -> tuple[LightCurve, np.ndarray, dict]` returns (flattened lc with baseline 1.0, trend array, report). Spline: per segment, split at gaps >0.75 d, robust iterative fit with 3σ clipping, **in-transit cadences masked out of the fit** when ephemeris given, knot spacing ≥ max(0.5 d, 3×duration) chosen by BIC over a grid (AstroNet-style). Method `"savgol"` uses a window ≥ 3×duration with the same masking. |
| `outliers.py` | `clip_upper(lc, sigma=3.0) -> tuple[LightCurve, int]` removes only upward outliers (robust MAD sigma). |
| `fold.py` | `phase_fold(time, period, epoch) -> np.ndarray` returns phase in **days** in [-P/2, P/2) with transit at 0. |
| `views.py` | `global_view(time, flux, period, epoch, num_bins=2001)`, `local_view(time, flux, period, epoch, duration_days, num_bins=201, num_durations=4.0)` each returns `(binned_flux, bin_centres_days, empty_frac)` using median per bin and linear interpolation over empty bins; `normalize_view(view) -> np.ndarray` (subtract median, divide by \|min\|; guard zero); `make_views(flat_lc, ephemeris) -> Views` (float32). |
| `bls.py` | `run_bls(lc, min_period=0.5, max_period=None, durations_hours=None, oversample=…) -> dict` using `astropy.timeseries.BoxLeastSquares` on the flattened curve; returns `{period, epoch, duration_hours, depth_ppm, snr, power_peak, periods (downsampled ≤4000), power, n_transits}`; deterministic; must be fast enough for a 4-year Kepler curve (bin to 30 min, sensible period grid, ≤ ~30 s on a laptop). |
| `transit_fit.py` | `fit_trapezoid(time, flux, ephemeris) -> dict` least-squares trapezoid on the folded curve: `{depth_ppm, depth_err_ppm, duration_hours, ingress_hours, epoch, epoch_err, chi2_red, shape_ratio (ingress/duration: ~0 box/U, 0.5 V)}`. |
| `diagnostics.py` | `odd_even(flat, eph) -> {depth_odd_ppm, depth_even_ppm, err_odd, err_even, diff_sigma}`; `secondary_eclipse(flat, eph) -> {depth_ppm, err_ppm, significance_sigma, phase}` (search near phase 0.5 ± duration; report best depth); `individual_transits(flat, eph, max_events=40) -> list[{index, epoch, depth_ppm, err_ppm, n_points, covered}]`; `snr(flat, eph) -> {snr, depth_ppm, noise_ppm, n_transits}`; `count_transits(time, eph) -> (expected, observed)`. |
| `quality.py` | `assess_quality(flat, ephemeris, views, catalogue_depth_ppm=None) -> QualityReport`. Issue codes: `too_few_transits` (<2 observed), `low_transit_coverage`, `local_view_sparse` (>0.3 empty), `global_view_sparse` (>0.5 empty), `misaligned` (minimum offset > 0.5 durations from 0), `depth_mismatch` (ratio outside [0.33, 3] vs catalogue), `nan_in_views`, `period_too_long` (P > half baseline), `no_transit_signal` (local view has no dip, e.g. depth < 1σ). Grade A–D; `ok` False if any blocking issue (too_few_transits, local_view_sparse, nan_in_views, period_too_long). |
| `features.py` | `physical_features(flat, ephemeris, views) -> dict[str, float]` exactly these keys (order is `FEATURE_NAMES`): `depth_ppm, log_depth, duration_hours, duration_over_period, log_period, snr, n_transits_observed, odd_even_sigma, secondary_sigma, secondary_depth_ratio, shape_ratio, local_asymmetry, oot_scatter_ppm, local_view_min_width, global_secondary_min`. No catalogue values. NaN-free (fill with 0 and document). |
| `pipeline.py` | `PipelineConfig` dataclass (quality_bitmask, detrend_method, sigma_clip, knot params, keep_stages) with `to_dict()`; `process_lightcurve(raw: LightCurve, ephemeris: Ephemeris, config=None, catalogue_depth_ppm=None) -> ProcessedSignal`: clean → (assign segments) → normalise → detrend with transit mask → clip upper outliers → views → quality → features. Stages for display (downsampled ≤ 20k points each): `raw`, `normalized`, `trend`, `flat`, `folded` (phase, flux). `preprocess_for_display(raw, ephemeris=None)` same without views (for Signal Explorer when no ephemeris). |
| `inject.py` | `inject_transit(lc, period, epoch, duration_hours, depth_ppm) -> LightCurve` trapezoid injection; sets `meta["synthetic"]=True`. Used by tests and the injection–recovery tool only. |
| `errors.py` | `LightCurveFormatError(ValueError)`, `InsufficientDataError(ValueError)`. |

Implementation notes for `exofinder.astro` (backwards-compatible additions; see module docstrings):
* Conventions: time float64 days (BKJD for Kepler); epoch = transit centre; duration = total T14;
  phase in days in `[-P/2, P/2)` (only `secondary_eclipse()["phase"]` is an orbital-phase fraction,
  0.5 = half an orbit; `offset_days` gives it in days). Undefined diagnostic values are `None`.
* FITS readers drop only rows with non-finite TIME (`meta["n_dropped_nan_time"]`); NaN fluxes and
  flagged cadences are kept for `clean()`. TESS light curves use the TESS quality bitmasks.
* Transit mask: `|phase| < width_factor·T14/2` (default 1.5 → a window 1.5×T14 wide).
* Local view: ±2·T14 (`num_durations` is the total width), 201 overlapping bins 0.16·T14 wide
  (AstroNet bin width); global view: 2001 contiguous bins of width P/2001.
* Depth convention (diagnostics, quality, features): local baseline (median of `T14 ≤ |phase| < 3·T14`)
  minus the mean flux of the transit core `|phase| < T14/4`.
* Extra keyword arguments: `run_bls(..., bin_minutes=30, max_periods=40000, objective, n_threads)`
  (`periods`/`power` are float64 numpy arrays; extra keys such as `depth_err_ppm`, `sde`,
  `n_transits_expected`, `n_periods_searched`, `top_peaks`); `bls.bls_ephemeris(result)` →
  `Ephemeris(source="measured", label="BLS")`; `fit_trapezoid(..., exposure_days=None)` (failed fit →
  `converged=False`, values `None`); `assess_quality(..., diagnostics=None)` and
  `physical_features(..., diagnostics=None)` reuse `diagnostics.compute_diagnostics(flat, eph, ...)`;
  `process_lightcurve(..., other_ephemerides=())` also masks other known planets from the trend fit;
  `preprocess_for_display(raw, ephemeris=None, config=None)` returns
  `{flat, trend, stages, reports, pipeline_version, config}`; `inject_transit(..., ingress_fraction=0.1,
  exposure_days=None)`; `PipelineConfig.from_dict()`.
* `ProcessedSignal.stages` always holds `reports` and `diagnostics` (JSON-safe dicts); the display
  arrays (`raw`, `normalized`, `trend`, `flat` as `{time, flux, n_original}` and `folded` as
  `{phase, flux, n_original}`) are added only when `keep_stages=True`.
* Quality grades: A = no issue; B = only `low_transit_coverage`/`global_view_sparse`; C = any of
  `misaligned`, `depth_mismatch`, `no_transit_signal`; D = any blocking issue.
* `features.FEATURE_NAMES` is a tuple of the 15 names above. Because `ml` may only import `astro.types`,
  ML code should take feature names from the dataset manifest.
* Input errors (map to user messages): FITS readers also accept gzip (`*.fits.gz`) and raise
  `LightCurveFormatError` for truncated/corrupt files; the CSV reader accepts UTF-16 (BOM) and 8-bit
  encodings and refuses BKJD/BTJD values > 20,000 d (MJD-like); `process_lightcurve` and
  `preprocess_for_display` raise `InsufficientDataError` for constant flux; `PipelineConfig(...)` /
  `from_dict()` raise `ValueError` for invalid values; `run_bls` raises `ValueError` for
  `oversample <= 0`, `max_periods < 1` or a non-finite `max_period`.

## 2. `exofinder.data` — NASA data acquisition and catalogue ingestion

| Module | Public API |
|---|---|
| `archive.py` | `ArchiveClient(tap_url, timeout)` → `.query(adql) -> pd.DataFrame` (CSV format, retries with backoff). `fetch_snapshot(source) -> SnapshotResult` for sources `dr24_tce`, `koi_cumulative`, `confirmed` (pscomppars, `disc_facility like '%Kepler%'` or Kepler-named hosts, with kepid via `keplernames` if needed), `stellar` (keplerstellar, columns for kepids in our signals; may be chunked). Saves verbatim CSV to `data/catalogs/<source>_<UTCstamp>.csv`, computes sha256, validates required columns/ranges, records a `CatalogSnapshot` row. Exact ADQL text is stored. |
| `catalog.py` | `refresh_catalog(session, progress=None, sources=(...)) -> dict` downloads snapshots and ingests: upserts `Target` and `Signal` rows. TCE↔KOI linking via `koi_tce_plnt_num`, **verified** by \|ΔP\|/P < 1% and epoch agreement within 0.5·duration (mod P); failures → `match_status="match_conflict"` (KOI fields not merged, separate KOI row). Confirmed planets not matched to any KOI/TCE (by kepid+period within 1%) become `PL-` rows (epoch converted BJD→BKJD). `category`: confirmed (KOI CONFIRMED or confirmed table), false_positive (KOI FALSE POSITIVE, or AV AFP/NTP with no KOI), candidate (KOI CANDIDATE), unknown (AV UNK without KOI). `label_conflict` when AV label and KOI disposition disagree (PC vs FALSE POSITIVE, AFP/NTP vs CONFIRMED). Provenance dict per labelled field. `ingest_from_files(session, paths)` for offline/testing. |
| `labels.py` | `LABEL_MODES = {"astronet_dr24": ..., "koi_disposition": ...}`; `label_for(signal, mode) -> int | None` (None = excluded with reason); `exclusion_reason(signal, mode) -> str | None`. AstroNet: PC→1, AFP/NTP→0, UNK/None→excluded. KOI: CONFIRMED→1, FALSE POSITIVE→0, CANDIDATE→excluded. |
| `mast.py` | `KEPLER_LC_QUARTER_STAMPS: dict[int, list[str]]` (verified against MAST); `kepler_lc_urls(kepid) -> list[(quarter, url, filename)]`; `download_kepler_lightcurves(kepid, dest_dir, timeout, cancel=None) -> DownloadResult{kepid, files:[(quarter,path)], missing_quarters, errors}` — tries deterministic MAST URLs (`https://mast.stsci.edu/api/v0.1/Download/file?uri=mast:KEPLER/url/missions/kepler/lightcurves/<kic4>/<kic9>/kplr<kic9>-<stamp>_llc.fits`), 404 = quarter not observed; verifies FITS magic + parse; atomic write (tmp then rename); retries with backoff; falls back to `lightkurve.search_lightcurve` when deterministic URLs all fail. |
| `lightcurve_store.py` | Compact stitched cache `data/lightcurves/<kic9>.npz` (time float64, flux float32 normalised per quarter, flux_err float32, quarter int8, quality int32 of kept cadences, meta json). `save_lightcurve(kepid, lc)`, `load_lightcurve(kepid) -> LightCurve | None`, `has_lightcurve(kepid)`, `build_from_fits(kepid, fits_paths) -> LightCurve` (reads each quarter, keeps raw PDCSAP + quality so cleaning can be redone; stores **un-cleaned** flux with quality flags so the pipeline remains the single source of truth for filtering). |
| `acquire.py` | `ensure_lightcurve(session, kepid, cancel=None) -> LightCurve` (download if missing → build cache → optionally delete raw FITS per settings → update `Target.lc_*`). `download_many(kepids, workers, progress, cancel)` thread-pooled. |
| `tiers.py` | `select_signals_for_tier(session, tier, label_mode, seed, reserved_kepids) -> list[Signal]`: pilot ≈300 signals / standard ≈3000 / full = all labelled, class-balanced where possible, choosing **whole stars**; always includes `RESERVED_SHOWCASE_KEPIDS` (Kepler-90 = 11442793, Kepler-80 = 4852528, Kepler-11 = 6541920, Kepler-186 = 8120608, Kepler-452 = 8311864; verify ids against the catalogue) — those are forced into test split. |

Implementation notes for `exofinder.data` (backwards-compatible additions; see module docstrings):
* Showcase KIC ids and `KEPLER_LC_QUARTER_STAMPS` were verified live on 2026-11-14 (Q4 has two
  stamps: `2010078095331`, and `2010009091648` for CCD-module-3 stars such as Kepler-90).
* TCE↔KOI linking: if the `koi_tce_plnt_num` TCE fails verification, any other unlinked DR24 TCE on
  the star that passes the same period/epoch test is accepted (`provenance.match.method="ephemeris"`).
  Epoch tolerance uses the longer of the two durations.
* Categories: Autovetter PC with no KOI → `candidate`. Rows that vanish from a later refresh are
  deleted, or — if referenced by datasets/predictions — kept with `category="retired"`,
  `match_status="stale"` and never labelled. `label_conflict` also counts the confirmed-planet table
  as CONFIRMED. Non-transiting confirmed planets (`tran_flag=0`) never create `PL-` rows.
* `ensure_lightcurve` raises `LightCurveUnavailableError` (`.status` = `no_data` | `error`) or
  `AcquisitionCancelled`; it commits the caller's session at status transitions. `download_many`
  accepts an optional `session=` and returns `{total, available, no_data, error, cancelled, cached, results}`.
* `fetch_snapshot` / `refresh_catalog` take optional keyword `client=` (an `ArchiveClient`) and
  `session=`; `catalog.catalog_summary(session)` returns category/match-status/label counts.

## 3. `exofinder.ml` — machine learning

Arrays: `global` (N, 2001) float32, `local` (N, 201) float32, `features` (N, F) float32,
`labels` (N,) int64 {0,1}, `signal_ids` (N,) int64, `kepids` (N,) int64, `splits` (N,) str.

| Module | Public API |
|---|---|
| `splits.py` | `star_level_split(kepids, labels, fractions=(0.8,0.1,0.1), seed=42, forced_test=()) -> np.ndarray[str]` stratified by star-level majority label, grouped by kepid, deterministic. `assert_no_leakage(kepids, splits)`. |
| `dataset_arrays.py` | `DatasetArrays` dataclass + `load_dataset_arrays(path) / save_dataset_arrays(path, arrays)` (`arrays.npz` + `manifest.json`), `.subset(split)`. |
| `features.py` | `baseline_feature_matrix(global, local, physical) -> (X, names)`: global downsampled to 201 bins (mean of contiguous blocks) + local 201 + physical features. |
| `models/baselines.py` | `make_logreg(**hp)`, `make_random_forest(**hp)` sklearn `Pipeline`s (StandardScaler for LR; class_weight="balanced"). |
| `models/cnn.py` | `SingleViewCNN(global_bins=2001, fc_width=512, dropout=0.3)`, `TwoViewCNN(global_bins=2001, local_bins=201, fc_width=512, fc_layers=4, dropout=0.3)` — AstroNet columns (global: 5 blocks, filters 16·2^i, 2×Conv1d k=5 + ReLU, MaxPool(5, stride 2); local: 2 blocks, MaxPool(7, stride 2)); forward takes `(global, local)` tensors shaped (B, 1, L) (single-view ignores local); returns logits (B,). `count_parameters(model)`. |
| `device.py` | `resolve_device(pref="auto") -> torch.device`; `environment_info() -> dict`. |
| `train.py` | `TrainConfig` dataclass (model_type, lr=1e-4, batch_size=64, max_epochs=50, patience=8, weight_decay=0, dropout, fc_width, augment_flip=True, seed=42, ensemble_size=1, device="auto", baseline hyperparameters, num_threads). `train(config, arrays, out_dir, on_epoch=None, should_stop=None) -> TrainResult{model_dir, history:list[dict], best_epoch, epochs_run, val_metrics, threshold, temperature, n_params, duration_s, device}`. CNN: BCEWithLogitsLoss(pos_weight=neg/pos), Adam, random time-reversal augmentation, early stopping on val PR-AUC, `best.pt` + `last.pt` per ensemble member, temperature fitted on val, threshold = val-F1-optimal (also store 0.5 metrics). Baselines: grouped CV grid search on train only (GroupKFold by kepid), refit on train, val metrics; joblib. `should_stop()` polled each batch → raises `TrainingCancelled`. Fully deterministic given seed on CPU. |
| `checkpoint.py` | `save_model_bundle(dir, model_or_models, meta)`, `load_model_bundle(dir) -> LoadedModel` (meta.json includes model_type, config, pipeline_version, dataset_id, feature_names, threshold, temperature, ensemble_size, created_at, library versions). Torch weights via `torch.save(state_dict)`, loaded with `weights_only=True`. |
| `inference.py` | `Predictor.from_dir(dir, device="auto")`; `.predict(global, local, features) -> PredictionOutput{prob (calibrated), raw_prob, uncertainty, member_probs, logits}` for batches; uncertainty = ensemble std (K>1) else MC-dropout std over 20 passes for CNNs, tree-vote std for RF, None for LR; `.pipeline_version`; refuses mismatched pipeline version (`IncompatiblePipelineError`). |
| `metrics.py` | `classification_metrics(y, p, threshold) -> dict` (accuracy, precision, recall, sensitivity, specificity, f1, roc_auc, pr_auc, brier, ece, n, n_pos, n_neg, tp, fp, tn, fn, threshold); `roc_curve_points`, `pr_curve_points` (downsampled ≤ 200 points); `best_f1_threshold(y, p)`; `bootstrap_ci(y, p, threshold, n_boot=1000, seed=0) -> {metric: [lo, hi]}`. Handles single-class edge cases (NaN → None). |
| `calibration.py` | `fit_temperature(logits, y) -> float` (LBFGS on NLL, clamp [0.05, 20]); `apply_temperature(logits, T)`; `reliability_curve(y, p, n_bins=10) -> list[{bin_lo, bin_hi, mean_pred, frac_pos, count}]`; `expected_calibration_error`. |
| `evaluate.py` | `evaluate(predictor, arrays, split="test", threshold=None) -> EvaluationResult{metrics, ci, curves{roc, pr, calibration}, confusion, timing{ms_per_sample_batch1, ms_per_sample_batch64, device}, per_example (signal_id, label, prob)}`. |

Implementation notes for `exofinder.ml` (backwards-compatible additions; see module docstrings):
* Model types: `logreg`, `random_forest`, `cnn_single`, `cnn_two_view` (`exofinder.ml.MODEL_TYPES`).
  `model_cards.get_model_card(type)` / `list_model_cards()` give `{type, name, description, inputs,
  strengths, limitations, architecture, uncertainty, training, default_config, n_params, reference}`.
* `DatasetArrays` fields are `global_view`, `local_view`, `features`, `labels`, `signal_ids`, `kepids`,
  `splits`, `feature_names`, `meta` (npz keys stay `global`/`local`/...). `meta` should carry
  `pipeline_version` and `dataset_id`; `train()` refuses a dataset whose `pipeline_version` differs
  from the running one. `splits.split_summary()` gives per-split counts.
* `TrainConfig` adds `min_delta`, `fc_layers`, and baseline grids (`logreg_c_grid`, `rf_n_estimators`,
  `rf_max_depth_grid`, `rf_min_samples_leaf_grid`, `rf_max_features_grid`, `cv_folds`);
  `to_dict()/from_dict()`. `num_threads=None` = all cores (restored after training).
  `TrainResult` adds `val_metrics_at_0_5`, `member_best_epochs`, `member_epochs_run`, `meta`;
  `n_params` is the total over ensemble members. `on_epoch` records match `EpochMetric` columns plus
  `member`, `best_epoch`, `improved`, `progress`. Early stopping: PR-AUC ties broken by val loss.
  Baseline CV uses `StratifiedGroupKFold` (groups = kepid). Errors: `TrainingCancelled`,
  `TrainingDiverged`. `estimate_epoch_seconds(config, arrays)` times real training steps.
* Bundle layout: `meta.json`, `history.json`, `member_XX/{best,last}.pt` or `model.joblib`; weight
  sha256s are verified on load (`BundleError`). Ensemble logit = mean member logit.
* Calibration (all model types): calibrated `prob = sigmoid((z - logit_offset) / T)` where
  `logit_offset = log(n_neg / n_pos)` of the training split undoes the class weighting
  (`pos_weight` / `class_weight="balanced"`), and `T` is fitted on val on the corrected logits.
  `meta.json` and `TrainResult` carry `logit_offset` (absent in older bundles = 0);
  `calibration.apply_temperature(logits, T, offset=0.0)`, `prior_logit_offset(n_pos, n_neg)`.
  `fit_temperature` returns 1.0 when the val logits separate the classes by sign (T not identified).
* `train()` refuses physical-feature names that look catalogue-derived (`score`, `disposition`,
  `fpflag`, `av_training`, `av_pred`, `label`, `category`; `features.assert_no_catalogue_features`).
  `DatasetArrays` rejects unknown split names and duplicate `signal_ids`.
* `Predictor.predict(global, local, features, *, with_uncertainty=True, pipeline_version=None,
  batch_size=256)`; `PredictionOutput` adds `threshold`, `uncertainty_method`, `inference_ms`,
  `.predicted_label`. An empty batch returns empty arrays. MC-dropout uses 20 fixed masks from a
  private seeded generator shared by all examples (batch-independent, thread-safe; a `Predictor`
  may be shared between threads).
* `evaluate()` also takes `n_boot, seed, with_uncertainty, bootstrap_by_star=True, timing`; CIs
  resample whole stars; result adds `metrics_at_0_5`, `ci_method`, `to_dict()` (strict JSON).

## 4. Services, jobs and API

Built in the next phase on top of the above; documented in `docs/dev/API.md` once implemented.
