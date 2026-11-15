# Development progress log (Stage 2)

Single source of truth for resuming work. Updated at the end of every phase.
Branch: `claude/hopeful-edison-jbmnjq`.

## Decisions taken (user did not answer the Stage-1 questions; defaults applied)
- Ship a reference build: real dataset + trained checkpoints produced in the dev environment.
- Assume CPU-only laptop (CUDA supported automatically when present).
- README includes Python/Node installation walkthrough.
- Keep the extra pages (Target Dossier, Prediction History).
- All models are trained from scratch locally (user explicitly wants their own trained AI) — no external AI services.

## Phases
- [x] P0  Foundation: repo skeleton, config, DB schema, shared types, contracts (docs/dev/CONTRACTS.md)
- [x] P1  Backend core: astro pipeline, data acquisition, ML engine (+ unit tests) — commit 89cd2c6
- [x] P1b Frontend design system + app shell — commit 89cd2c6
- [x] P2  Services, job runner, FastAPI routers, CLI (+ API tests) -> docs/dev/API.md — DONE (two agents: ops = datasets/jobs/training/models/evaluation/experiments/reports/CLI; sci = system/catalog/targets/lightcurves/uploads/analysis/predictions/settings/docs). Shared helpers committed: services/{jsonutil,app_settings,signal_views}.py, tests/api/conftest.py
- [x] P3  Frontend pages wired to API (all 13 pages + job tray; typed client generated from OpenAPI)
- [x] P4  Real data: catalogue refresh, pilot + standard + full downloads (9,866 stars, 0 errors), pilot + standard datasets built; full dataset building
- [x] P5  Real training of 4 models + final evaluation, reference report (docs/reference-results.md); Full-tier study pending
- [x] P6  Windows scripts, README, docs, research report template
- [ ] P7  QA: IN PROGRESS — 88/88 Playwright vs real app on 8000/5173; independent backend-correctness and Windows-compat reviews running
- [ ] P8  Delivery summary

## Environment notes
- Dev container: Linux, 4 CPU, 15 GB RAM, no GPU. venv at .venv (Python 3.11), `pip install -e backend`.
- MAST deterministic download URL works through the proxy; lightkurve search ~5 s/target.

## Status notes
- P1 results (real data): Kepler-2 grade A, depth 6529 vs 6675 ppm catalogue, blind BLS P rel. err 6.8e-5.
  Catalogue in data/app.db: 14,233 targets, 22,644 signals (confirmed 2,760; FP 14,114; candidate 2,002;
  unknown 3,768), 150 label conflicts. astronet_dr24 labels: 3,600 pos / 12,137 neg.
  Tiers (seed 42): pilot 309 signals / 167 stars; standard 3,009 signals / 1,976 stars.
- Downloads: pilot complete; standard running (script in scratchpad, log logs/download_tiers.log, ~2.4 stars/s).
- Test counts at P1 commit: backend 323 passed; frontend vitest 119, playwright 34 (backend offline).
- README timing claims (pilot "a few minutes", suite "30-90 minutes") MUST be replaced by measured values in P5.
- Ruff rule set pinned in backend/pyproject.toml (E,F,W,I,B,UP,SIM; ignore E501,SIM300).
- Vite proxy now targets http://127.0.0.1:8000.
- P2 fix: forced showcase test stars no longer consume the 10% test quota (ml/splits.py); the first pilot
  build had all 17 test positives from 4 showcase systems. Dataset 1 + models 1-2 deleted; pilot and
  standard rebuilt via CLI (log logs/build_datasets.log). Docs corrected (quality gates exclude blocking
  issues only; grade C kept on purpose).
- Parallel dataset processing: 3 worker processes, measured 2.74x speed-up (1.79 s -> 0.65 s per signal).
- Full-tier download running (logs/download_full.log).
- P5 Standard DR24 (dataset 2: 2,934 examples; train 2,335 / val 290 / test 309): suite trained
  (models 2 LR, 3 RF, 4 cnn_single, 7 cnn_two_view). Decisions recorded BEFORE any test evaluation:
  (a) final Standard models = 2,3,4,7, each evaluated on test exactly once;
  (b) active model = two-view CNN (#7), chosen by best validation PR-AUC (0.983);
  (c) one additional study on the Full tier with default suite settings; no configuration changes
      to the Standard models after their test results are seen.
- Fixes from QA so far: job heartbeat (API start no longer fails CLI jobs; additive DB migration), UTC
  timestamps, dataset provenance in API/UI, delete guard for CLI builds, feature-importance grouping,
  setup.ps1 first-run abort (stderr + Stop), start.ps1 VITE_API_URL, safe stop scripts, start.sh pid bug,
  UI density / reduced-motion settings wired.
- Full DR24 build (dataset 4) started 22:38 UTC by CLI; heartbeat kept fresh by scratchpad hb_keeper.py
  (restart it if it stops while the build runs). Then: train suite on dataset 4, evaluate on test once.
- Full DR24 (dataset 3 after id reuse): first build was stopped at 88% by the 2-hour limit on
  background commands; rebuilt from the view cache in 6.4 min: 15,539 examples (train 12,418 / val 1,553 /
  test 1,568; 22% planet-like = natural DR24 prevalence), 207 exclusions. Training split into two runs
  (LR+RF+single-view CNN, then two-view CNN) to stay under the limit; default configs, decided before
  any Full test evaluation.
- Full DR24 suite trained (models 8 LR, 9 RF, 10 cnn_single, 11 cnn_two_view; val PR-AUC 0.919 / 0.951 /
  0.949 / 0.960). Decision BEFORE Full test evaluation: active model = Full two-view CNN (#11), best
  validation PR-AUC on the largest dataset; each Full model evaluated on test exactly once.
