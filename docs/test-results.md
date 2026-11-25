# Test results and acceptance checklist (release 1.0.0)

Recorded on 2026-11-14/15 in the development environment (final runs after all fixes on 2026-11-15). **Every number below was produced by
actually running the command shown.** Nothing here is estimated.

## Environment
Linux container, 4 vCPU, 15 GB RAM, no GPU · Python 3.11.18 · PyTorch 2.15.0 (CPU) ·
scikit-learn 1.9.1 · NumPy 2.4.6 · Astropy 8.0.2 · Lightkurve 2.6.0 · FastAPI 0.163.0 · Node 22.23.4 ·
Playwright Chromium.

## Automated tests
| Suite | Command | Result |
|---|---|---|
| Backend unit + API (offline) | `cd backend && ../.venv/bin/python -m pytest -q` | **423 passed**, 4 deselected (network) |
| Backend live NASA checks | `cd backend && ../.venv/bin/python -m pytest -q -m network` | **4 passed** (live TAP query, live KOI snapshot, quarter-stamp table vs Lightkurve search, live download of Kepler-2) |
| Backend lint/format | `ruff check exofinder tests && ruff format --check exofinder tests` | clean (171 files) |
| Frontend type check | `cd frontend && npm run typecheck` | pass |
| Frontend lint | `npm run lint` | pass |
| Frontend unit (Vitest + React Testing Library) | `npm test` | **232 passed** (32 files) |
| Frontend production build | `npm run build` | pass |
| End-to-end (Playwright, desktop 1440×900 + mobile 390×844) against the real app started with `scripts/start.sh` on :8000/:5173 with the real NASA data | `E2E_BASE_URL=http://localhost:5173 npx playwright test e2e/smoke.spec.ts e2e/science-pages.spec.ts e2e/detect-fixtures.spec.ts e2e/ops-pages.spec.ts e2e/ops-fixtures.spec.ts` | **88 passed** (re-run after the final fixes: 88 passed) |

Test data rules: the backend tests use real Kepler FITS files (`backend/tests/fixtures/`) plus
synthetic catalogue rows and light curves that are labelled as test data and live only in temporary
folders. Models trained in tests are flagged `is_fixture`.

## Real-data verification (end to end)
| Step | Result |
|---|---|
| NASA Exoplanet Archive snapshots | DR24 TCE 20 367 rows, KOI cumulative 9 564, confirmed planets 2 818, stellar 14 239; SHA-256 recorded; 0 validation warnings |
| Catalogue | 14 233 stars, 22 644 signals (2 760 confirmed, 14 114 false positive, 2 002 candidate, 3 768 unknown), 150 label conflicts flagged |
| MAST downloads | 9 866 stars (every star with a labelled DR24 signal), **0 errors**, 6.1 GB cache |
| Pipeline on Kepler-2 | grade A; depth 6 529 ppm vs catalogue 6 675; blind BLS period error 6.8 × 10⁻⁵ |
| Standard dataset | 2 934 examples (train 2 335 / val 290 / test 309), 75 exclusions with reasons, star-level split with leakage check |
| Full dataset | 15 539 examples (train 12 418 / val 1 553 / test 1 568; 22.4 % planet-like), 207 exclusions with reasons |
| Training (4 models × 2 tiers) | Standard 14 min, Full 28 min in total on 4 CPU cores |
| Held-out test evaluation (Full tier) | two-view CNN ROC-AUC 0.988, PR-AUC 0.965 [0.948, 0.977], F1 0.913; details in [reference results](reference-results.md) |
| Prediction on an unseen showcase star | all eight Kepler-90 planets scored planet-like by the two-view CNNs of both tiers |
| Inference speed (quiet CPU) | two-view CNN about 3 ms per signal (batch 1), 0.8 ms per signal (batch 64) |

## Reviews
* Each core package (astro, data, ML, frontend design system) was reviewed by an independent
  agent after it was built; the defects found were fixed with regression tests.
* An independent backend correctness/methodology review checked leakage, labels, calibration,
  evaluation and predictions. Four defects were fixed (e.g. predictions now use the training
  dataset's preprocessing), and two policy issues were resolved: candidate ranking excludes
  training-seen stars, and signals failing the training quality gate are not scored.
* An independent Windows-compatibility review found 17 issues, all fixed. Examples: process-id
  reuse in `stop.ps1`, locked-file handling, cp1252 console output, the Node version check, and the
  Visual C++ runtime check for PyTorch.

## Acceptance checklist
| Requirement | Status | Evidence |
|---|---|---|
| React + TypeScript + Vite + Tailwind + Recharts + Plotly.js + Lucide | ✅ | `frontend/package.json` |
| FastAPI + Uvicorn + Pydantic + SQLAlchemy + SQLite | ✅ | `backend/exofinder/api`, `db/` |
| PyTorch, NumPy, Pandas, SciPy, scikit-learn | ✅ | `backend/exofinder/ml`, `astro`, `data` |
| Lightkurve, Astropy, Astroquery, FITS | ✅ | Astropy for FITS, BLS and time; Lightkurve (which uses Astroquery's MAST client) as the download fallback; Exoplanet Archive via its TAP service |
| Pytest, Vitest, React Testing Library, Playwright | ✅ | results above |
| Real NASA MAST + Exoplanet Archive integration | ✅ | live tests + 9 866 real downloads |
| Four models: LR, RF, single-view CNN, two-view AstroNet-style CNN | ✅ | `ml/models/`; trained on real data |
| Real training and evaluation with all listed metrics | ✅ | accuracy, precision, recall, specificity, F1, ROC-AUC, PR-AUC, confusion matrix, Brier, ECE, reliability, inference time, bootstrap CIs |
| Star-level splits, no leakage | ✅ | grouped split + leakage assertion; no catalogue-score features (enforced); validation-only model selection |
| All 13 pages functional | ✅ | e2e tests on the real backend |
| SQLite experiment management + downloadable reports (md/html/json) | ✅ | Experiments page, `/api/reports/*`, `exofinder report` |
| Windows `setup.ps1`, `start.ps1`, `stop.ps1` | ⚠️ written for Windows PowerShell 5.1 and statically reviewed; **not executed on Windows** (no Windows machine available) | Linux/macOS equivalents in `scripts/` were executed |
| `README.md`, `requirements.txt`, `.env.example` | ✅ | repository root |
| `localhost:5173`, `:8000`, `:8000/docs` | ✅ | verified with `scripts/start.sh` |
| Automated tests + documentation | ✅ | this file; `docs/` |
| No fabricated data/metrics; fixture outputs never presented as real | ✅ | fixture flags in UI, reports and predictions |
| Planet-like predictions presented as research leads | ✅ | disclaimer in every prediction, report and the Candidate Explorer |
| No paid services or API keys | ✅ | public NASA services only |

## Known limitations of this verification
* The PowerShell scripts could not be run here. If `setup.ps1` or `start.ps1` fails on your machine,
  the error output and `logs\backend.log` / `logs\frontend.log` will show why (see README →
  Troubleshooting).
* GPU (CUDA) training was not tested; all results are CPU-only.
* Timing numbers were measured on a shared 4-core VM while other work was running.

## Clean-clone verification (2026-11-24)
A fresh clone of the repository was installed and run from scratch in a Linux container
(4 vCPU, no GPU, Python 3.12, CPU PyTorch 2.15.0, Node 22), with the built web app served by the
backend (`EXOF_FRONTEND_DIST`, the single-server / Docker mode). Every number was produced by the run.

| Check | Result |
|---|---|
| `pytest -q` (backend, offline) | **423 passed**, 4 deselected (network); after adding the hosted-mode tests: **429 passed** |
| `ruff check` / `ruff format --check` | clean |
| `npm run typecheck`, `npx vitest run`, `npm run build` | pass, **232 passed** (32 files), pass |
| Playwright (desktop + mobile) against the single-server app with real NASA data | **88 passed** (`smoke`, `science-pages`, `detect-fixtures`, `ops-pages`, `ops-fixtures`) |
| Catalogue refresh (via the API) | 22 644 signals, 14 233 stars; 6.0 min through this environment's proxy |
| Pilot dataset build (downloads included) | 284 examples (train 213 / val 28 / test 43), 25 exclusions; 5.8 min |
| Training suite on Pilot | 4 models in 5.3 min |
| One-time test evaluation on Pilot (43 signals, 18 stars) | two-view CNN accuracy 0.884, F1 0.921, ROC-AUC 0.892, PR-AUC 0.939; single-view CNN 0.860 / 0.906 / 0.869 / 0.924; random forest 0.860 / 0.906 / 0.916 / 0.949; logistic regression 0.837 / 0.892 / 0.926 / 0.963 |
| Kepler-90 (held-out showcase star), all 8 signals × 4 Pilot models | all 32 scores planet-like |

The Pilot test set is tiny (43 signals), so these numbers have wide confidence intervals and are
**not** comparable with the Standard/Full [reference results](reference-results.md); they only prove
that the full flow works from a clean clone.

Bug fixed during this verification: in the single-server mode, FastAPI's Swagger UI occupied `/docs`, so opening
the Research Docs page directly (or reloading it) showed the API documentation instead of the app. The
API documentation now moves to `/api/docs` in that mode (the local two-server mode keeps
`http://localhost:8000/docs`), and the app's "API docs" link follows it.

## Independent re-verification (2026-11-24, second pass)
A second, independent check of the same branch, again from a clean install (`scripts/setup.sh` with
CPU PyTorch, Python 3.12, Node 22, 4 vCPU, no GPU). Every number below was produced by this run.

| Check | Result |
|---|---|
| `pytest -q` (backend, offline) | **430 passed**, 4 deselected (one new regression test, see below) |
| `pytest -q -m network` (live NASA) | **4 passed** |
| `ruff check` / `ruff format --check` | clean |
| `npm run typecheck`, `npx vitest run`, `npm run build` | pass, **232 passed** (32 files), pass |
| CLI flow: `refresh-catalog` → `build-dataset --tier pilot` → `train-suite` → `evaluate --split test` → `predict --kepid 11442793` | all succeeded: 22 644 signals on 14 233 stars (3.5 min); Pilot dataset 284 examples (5.3 min, 164 stars downloaded); 4 models trained (2.5 min); two-view CNN test accuracy 0.884, F1 0.921, ROC-AUC 0.892, PR-AUC 0.939 (identical to the first pass); all 8 Kepler-90 signals planet-like |
| Upload flow (API): Kepler-2 Q3 FITS fixture → parse → BLS → 4 models | BLS period 2.2055 d (Kepler-2 b), quality grade A, 4 predictions stored |
| Playwright against the single-server app with this data | **88 passed** (`smoke`, `science-pages`, `detect-fixtures`, `ops-pages`, `ops-fixtures`) + **1 passed** for the opt-in write flow `ops-live` (`E2E_OPS_WRITE=1`, a "UI check" dataset) |
| `docker build` of the root `Dockerfile` | **built** (with the environment's proxy CA added in a throw-away copy of the Dockerfile); the container served the app on `/`, the Research Docs on `/docs` and Swagger on `/api/docs`; `exofinder doctor` OK inside it; Playwright `smoke.spec.ts` against the container: **34 passed** |

Bug fixed during this pass: during a catalogue refresh, the first downloaded snapshot row opened a
SQLite write transaction that stayed open through the following downloads (minutes). Meanwhile every
other write failed after 30 s with `database is locked`: the job's progress and heartbeat updates
(the refresh showed no progress) and any API write made at the same time. `refresh_catalog` now
commits each snapshot row as soon as it is recorded, and the ingested catalogue before its final
progress report; `tests/unit/data/test_data_catalog.py::TestRefreshCatalog::test_database_stays_writable_during_downloads`
covers it. Also: `scripts/test.sh` / `scripts/test.ps1` now install the test tools
(`requirements-dev.txt`: pytest, Ruff) on first use, since setup installs only the runtime packages.

## Metric audit (2026-11-25, third pass)
An independent check that every published metric matches what the code produces. Linux, 4 vCPU, no
GPU, Python 3.12, CPU PyTorch 2.15.0. Every number below was produced by this run.

| Check | Result |
|---|---|
| Every Standard/Full number in [reference results](reference-results.md) and the README against the machine-generated reports in `docs/reference/*.json` | all match (PR-AUC, ROC-AUC, F1, precision, recall, specificity, accuracy, Brier, ECE, confidence intervals, confusion matrices, thresholds, training times, split sizes) |
| Internal consistency of those reports | precision, recall, specificity, accuracy and F1 recomputed from each confusion matrix, and ECE recomputed from each stored reliability curve: all equal the stored values |
| Metric code (`exofinder/ml/metrics.py`, `calibration.py`) | PR-AUC is average precision, ROC-AUC is Mann-Whitney U, ECE uses 10 equal-width bins, bootstrap resamples whole stars; threshold and temperature are fitted on validation only; baseline hyper-parameters use grouped CV on train only; splits are by star with a leakage check; catalogue scores and dispositions are refused as features |
| CLI flow from an empty data folder: `refresh-catalog` → `build-dataset --tier pilot --seed 42` → `train-suite` → `evaluate --split test` (×4) → `predict --kepid 11442793` | 22 644 signals on 14 233 stars (1.1 min); Pilot 284 examples (train 213 / val 28 / test 43), 25 exclusions (6.1 min including downloads); 4 models (7.7 min); test accuracy / F1 / ROC-AUC / PR-AUC: two-view CNN 0.884 / 0.921 / 0.892 / 0.939, single-view CNN 0.860 / 0.906 / 0.869 / 0.924, random forest 0.860 / 0.906 / 0.916 / 0.949, logistic regression 0.837 / 0.892 / 0.926 / 0.963, **identical to both earlier passes**; all 8 Kepler-90 signals planet-like |
| Catalogue label conflicts (README: "150") | 150 of 22 644 signals flagged (110 DR24 PC, 40 AFP) |
| `pytest -q` (backend, offline) | **430 passed**, 4 deselected |

**How to read the Pilot numbers.** The Pilot test set has 43 signals on 18 stars, 29 of them
planet-like (67 %). Simply calling every signal planet-like would score accuracy 0.674, F1 0.806 and
PR-AUC 0.674 (the chance level). The two-view CNN's 95 % star-bootstrap intervals are wide: F1
[0.79, 0.98], ROC-AUC [0.71, 0.99], PR-AUC [0.82, 1.00]. All four models recall all 29 planet-like
signals and differ only by 5–7 false positives. The Pilot tier proves that the flow works; it cannot
rank the models.

Documentation corrected in this pass: the reference-results summary no longer calls the two-view CNN
"the best-calibrated model" without qualification (its ECE interval overlaps those of logistic
regression and the single-view CNN; only the random forest is clearly worse), and it now says that the
random forest reaches the same ROC-AUC and PR-AUC. Chance levels (prevalence and majority-class
accuracy) were added, as were a note that no paired model-comparison test is run, and a note on the
random forest's under-confident mid-range probabilities on the Full tier. The README no longer says that every score
comes with an uncertainty (logistic regression has none), and the limitations page explains how class
balance changes PR-AUC between tiers.
