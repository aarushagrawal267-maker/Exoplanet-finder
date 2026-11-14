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
- [ ] P3  Frontend pages wired to API — IN PROGRESS: agent P3a (science pages + shell + typed API via openapi-typescript); P3b (Dataset Explorer, Model Training, Model Evaluation, Experiments, job tray) next
- [ ] P4  Real data: catalogue refresh, pilot + standard downloads, dataset builds
- [ ] P5  Real training of 4 models + final evaluation, reference report
- [ ] P6  Windows scripts, README, docs, research report template
- [ ] P7  QA: full test suites, Playwright e2e, review/fix loop, acceptance checklist
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
