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
