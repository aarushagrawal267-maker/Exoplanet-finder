# REST API specification (`/api`)

FastAPI app `exofinder.api.main:app`, served on `http://localhost:8000`, OpenAPI at `/docs`.
All JSON. Errors: `{"detail": str, "code": str | null, "hint": str | null}` with proper HTTP status
(400 validation, 404 not found, 409 conflict/state, 422 pydantic, 503 upstream NASA unavailable).
Long work returns a `JobOut` immediately (HTTP 202) and runs in the job runner.

Numbers that are scientific values carry provenance where relevant:
`{"value": float | null, "err": float | null, "unit": str, "provenance": "catalogue" | "measured" | "estimate" | "manual", "source": str}`.

## System
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{status, version, pipeline_version}` |
| GET | `/api/system/summary` | Overview dashboard payload: catalogue counts (by category, by AV label, conflicts, last refresh), light-curve counts (available/no_data/error, disk bytes), datasets (count, latest), models (count, active model incl. test metrics), predictions (count, 5 recent), running jobs, device info, `next_steps` list for a fresh install |
| GET | `/api/system/diagnostics` | versions, paths, disk usage, device; `?check_network=true` pings NASA endpoints |

## Catalogue
| Method | Path | Notes |
|---|---|---|
| POST | `/api/catalog/refresh` | → JobOut (`catalog_refresh`) |
| GET | `/api/catalog/snapshots` | snapshot list with provenance |
| GET | `/api/catalog/signals` | filters: `search, category, av_label, koi_disposition, has_lightcurve, conflict, min_period, max_period, min_snr, kepid`; `sort, order, limit (≤500), offset` → `{total, items: SignalOut[]}` |
| GET | `/api/catalog/stats` | category counts, histograms (log period, log depth, snr) per category |

## Targets & light curves
| Method | Path | Notes |
|---|---|---|
| GET | `/api/targets/search?q=` | accepts "Kepler-90", "Kepler-90 h", "KIC 11442793", "11442793", "K00351", "K00351.01"; → `[{kepid, label, kepler_host_name, n_signals, lc_status, matched_on}]` (≤20) |
| GET | `/api/targets/{kepid}` | target, stellar params, signals[], dataset memberships `[{dataset_id, dataset_name, split}]`, recent predictions |
| POST | `/api/targets/{kepid}/download` | → JobOut (`download`), idempotent if already available |
| GET | `/api/lightcurves/{kepid}` | query: `signal_id?`, `period?, epoch?, duration_hours?`, `detrend=spline|savgol`, `max_points=20000`. → `{kepid, time_system, n_cadences, quarters, segments[], cleaning{...}, stages{raw, normalized, trend, flat}: {time[], flux[]}, transit_times[]?, folded?{phase[], flux[], binned{phase[], flux[]}}, ephemeris?}`. 404 `code=not_downloaded` if no cache |

## Uploads
| Method | Path | Notes |
|---|---|---|
| POST | `/api/uploads` | multipart `file` (.fits/.fit/.fits.gz/.csv/.txt, ≤ 200 MB) → `{upload_id, filename, kind, n_rows, columns?, suggested_mapping?, preview_rows?, meta}` |
| POST | `/api/uploads/{upload_id}/parse` | `{mapping?, time_system}` → `{upload_id, n_points, time_span_days, cadence_days, time_system, warnings[]}` |
| GET | `/api/uploads/{upload_id}/lightcurve` | same shape as `/api/lightcurves/{kepid}` |

## Analysis
| Method | Path | Notes |
|---|---|---|
| POST | `/api/analysis/bls` | `{source: {type:"catalog", kepid} | {type:"upload", upload_id}, min_period?, max_period?}` → `{periods[], power[], best{period, epoch, duration_hours, depth_ppm, snr, n_transits}, peaks[] (top 5)}` — all provenance `measured` |
| POST | `/api/analysis/transit` | `{source, ephemeris{period_days, epoch, duration_hours, source}, signal_id?}` → `{ephemeris, fit, odd_even, secondary, individual_transits[], snr, quality, folded{phase[], flux[], binned}, model_curve{phase[], flux[]}, comparison[{quantity, unit, catalogue, measured, estimate}], stellar{teff, radius, logg}, derived{planet_radius_re (estimate from depth × R*), a_over_rstar…}}` |
| POST | `/api/analysis/injection` | injection–recovery on a real light curve: `{kepid, period_days, depth_ppm, duration_hours}` → `{synthetic:true, injected{…}, recovered{…}, recovered_ok}` (clearly labelled synthetic) |

## Datasets
| Method | Path | Notes |
|---|---|---|
| GET | `/api/datasets/tiers?label_mode=` | `[{tier, n_signals, n_stars, n_pos, n_neg, est_download_bytes, est_minutes, description}]` from the live catalogue |
| GET | `/api/datasets` | DatasetOut[] |
| POST | `/api/datasets` | `{name, tier, label_mode, split_seed=42, exclude_conflicts=true, max_signals?, pipeline{detrend_method}, parent_id?}` → JobOut (`build_dataset`: downloads missing light curves, processes signals, splits, writes arrays) |
| GET | `/api/datasets/{id}` | DatasetOut + `stats{per_split{n, n_pos, n_neg, n_stars}, exclusions_by_reason{}, quality_grades{}, period_hist, depth_hist}` |
| GET | `/api/datasets/{id}/examples` | `split, label, included, limit, offset` → `{total, items[{signal_id, signal_key, kepid, label, split, included, exclusion_reason, quality, period_days, depth_ppm, …}]}` |
| GET | `/api/datasets/{id}/examples/{signal_id}/views` | `{global[], local[], global_phase[], local_phase[], label, quality}` |
| GET | `/api/datasets/{id}/gallery?per_class=6&seed=0` | sample of examples with views (global downsampled to 401) |
| DELETE | `/api/datasets/{id}` | 409 if models depend on it unless `?force=true` |

## Jobs
| Method | Path | Notes |
|---|---|---|
| GET | `/api/jobs?status=&kind=&limit=` | JobOut[] `{id, kind, title, status, progress, message, params, result, error, created_at, started_at, finished_at, eta_s}` |
| GET | `/api/jobs/{id}` | JobOut + `log_tail` |
| POST | `/api/jobs/{id}/cancel` | cooperative cancel |
| GET | `/api/jobs/{id}/events` | SSE: `progress`, `log`, `epoch` (training metrics), `done` |
| GET | `/api/jobs/stream` | SSE of all job updates (job tray) |

## Training & models
| Method | Path | Notes |
|---|---|---|
| GET | `/api/training/model-types` | model cards `[{type, name, description, inputs, strengths, default_config, n_params?}]` |
| GET | `/api/training/estimate?model_type&dataset_id` | rough seconds per epoch (measured micro-benchmark) |
| POST | `/api/training/runs` | `{name, model_type, dataset_id, config{lr, batch_size, max_epochs, patience, dropout, fc_width, ensemble_size, seed, augment_flip, weight_decay, …}}` → `{experiment_id, job: JobOut}` |
| POST | `/api/training/suite` | train all four model types on one dataset sequentially → `{experiment_ids[], job}` |
| GET | `/api/models` | ModelVersionOut[] (with val/test metrics, is_active, is_fixture, dataset name) |
| GET | `/api/models/{id}` | detail incl. model card + config |
| POST | `/api/models/{id}/activate` | set active model |
| DELETE | `/api/models/{id}` | removes checkpoint dir |

## Evaluation
| Method | Path | Notes |
|---|---|---|
| POST | `/api/evaluation/runs` | `{model_version_id, split:"test"|"val"}` → JobOut; test evaluations are logged and counted |
| GET | `/api/evaluation?model_version_id=&dataset_id=&split=` | EvaluationOut[] (summary) |
| GET | `/api/evaluation/{id}` | full: metrics, ci, curves{roc, pr, calibration}, confusion, timing |
| GET | `/api/evaluation/{id}/examples?outcome=fp|fn|tp|tn&limit=` | examples with prob, signal info, local view |
| GET | `/api/evaluation/compare?ids=` | aligned metric table; error if datasets/splits differ (or `warnings`) |
| GET | `/api/evaluation/{id}/feature-importance` | permutation importance (baselines) |

## Predictions
| Method | Path | Notes |
|---|---|---|
| POST | `/api/predictions` | `{model_version_ids[], source{type:"catalog", kepid, signal_id?} | {type:"upload", upload_id}, ephemeris?{period_days, epoch, duration_hours}, ephemeris_source:"catalog"|"bls"|"manual"}` → `{results: PredictionOut[], views{global[], local[], global_phase[], local_phase[]}, quality, ephemeris, warnings[]}`; PredictionOut `{id, model_version_id, model_name, model_type, probability, raw_probability, predicted_label, threshold, uncertainty, member_probabilities, seen_in_split, inference_ms, is_fixture_model}`; catalog labels for the signal; 409 `code=no_model` if no trained model |
| GET | `/api/predictions` | history, filters `kepid, model_version_id, source_type, limit, offset` |
| GET | `/api/predictions/{id}` | detail incl. views |
| POST | `/api/predictions/batch` | `{model_version_id, category="candidate", only_downloaded=true, limit?}` → JobOut |
| GET | `/api/predictions/candidates` | ranked candidates: latest score per signal per model, agreement across models, uncertainty, quality grade |

## Experiments & reports
| Method | Path | Notes |
|---|---|---|
| GET | `/api/experiments` | filters `model_type, dataset_id, status, archived` |
| GET | `/api/experiments/{id}` | config, environment, epochs[], model version, evaluations |
| PATCH | `/api/experiments/{id}` | `{name?, notes?, tags?, archived?}` |
| DELETE | `/api/experiments/{id}` | removes artefacts |
| GET | `/api/experiments/compare?ids=` | experiments + `config_diff` + epoch curves |
| GET | `/api/reports/experiments/{id}?format=md|html|json` | downloadable report (Content-Disposition) |
| GET | `/api/reports/comparison?ids=&format=` | multi-experiment report |

## Settings & docs
| Method | Path | Notes |
|---|---|---|
| GET | `/api/settings` | `{values, defaults, descriptions}` (device, download_workers, keep_raw_fits, default_model_id, default_threshold_mode, ui density, reduced_motion) |
| PUT | `/api/settings` | partial update (validated) |
| GET | `/api/settings/storage` | disk usage per category |
| POST | `/api/settings/storage/clear` | `{target: "raw_fits"|"uploads"|"views_cache"}` |
| GET | `/api/settings/backup` | SQLite backup file download |
| GET | `/api/docs/pages` | research documentation index (from repo `docs/*.md`) |
| GET | `/api/docs/pages/{slug}` | `{slug, title, markdown}` |
