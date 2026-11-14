# Testing (developer guide)

## Running everything
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1           # Windows
```
```bash
scripts/test.sh                                                        # macOS / Linux
```
Options: `-SkipE2E` / `--skip-e2e` skips the browser tests; `-Network` / `--network` adds the live NASA checks.

## Backend (pytest)
```bash
cd backend
../.venv/bin/python -m pytest                 # all offline tests (default: -m "not network")
../.venv/bin/python -m pytest -m network      # live NASA Exoplanet Archive + MAST checks
../.venv/bin/python -m pytest tests/unit/astro -q
../.venv/bin/ruff check exofinder tests && ../.venv/bin/ruff format --check exofinder tests
```
On Windows use `..\.venv\Scripts\python`.

| Folder | What it covers |
|---|---|
| `tests/unit/astro` | FITS/CSV readers (incl. truncated and gzip files), cleaning, detrending with depth preservation, folding, views, BLS recovery, trapezoid fit, diagnostics, quality gates, full pipeline on **real Kepler-2 and Kepler-90 FITS files** |
| `tests/unit/data` | TAP client (retries, errors), snapshot validation, catalogue linking (TCE↔KOI verification), labels, MAST downloads (truncation, resume, races), light-curve cache, tiers |
| `tests/unit/ml` | star-level splits and leakage checks, dataset arrays, features (catalogue-feature guard), CNN shapes and initialisation, training (determinism, early stopping, cancellation, divergence), calibration, metrics vs scikit-learn, bootstrap CIs, checkpoints, inference, evaluation |
| `tests/api` | every REST endpoint through FastAPI's `TestClient` against a temporary database: happy paths, error codes, jobs and SSE, cancellation, a full flow (build dataset → train → evaluate → report), CLI `init`/`doctor`/`status` |
| `tests/integration` | `-m network`: live TAP query, live KOI snapshot, quarter-stamp table vs Lightkurve search, live download of Kepler-2 |

### Test data rules
* `tests/fixtures/` holds **real NASA Kepler FITS files** (Kepler-2 Q2/Q3, Kepler-90 Q3).
* Catalogue rows and light curves made up for tests are **synthetic and labelled as test data** in
  the module that defines them. They only ever live in temporary folders.
* Models trained in tests are marked `is_fixture = true`. The UI and reports flag such models
  prominently, and they never appear in the real database.
* Every test uses a temporary data directory and database (`tests/api/conftest.py`,
  `tests/unit/data/conftest.py`), never your `data/app.db`.

## Frontend
```bash
cd frontend
npm run typecheck        # strict TypeScript
npm run lint
npm test                 # Vitest + React Testing Library (jsdom)
npm run build            # production build
npx playwright install chromium
npm run test:e2e         # Playwright, desktop 1440×900 and mobile 390×844
```
* Unit tests mock `fetch` with responses typed against the generated OpenAPI types.
* End-to-end tests start the Vite dev server automatically (or use `E2E_BASE_URL`). Tests that need a
  running backend use the real API; states that are slow to reach (for example a finished evaluation)
  intercept the API with fixtures that are labelled as test fixtures.
* After changing the backend API, run `npm run gen:api` to regenerate `src/api/schema.d.ts`; the type
  check then shows where the frontend must adapt.

## Recorded results
The results of the full QA run for this release are in [test-results.md](test-results.md).
