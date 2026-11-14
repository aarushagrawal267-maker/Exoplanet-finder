# Architecture (developer guide)

Exoplanet Finder is a single-user local application: a FastAPI backend with a SQLite database and a
background job runner, plus a React single-page frontend. Everything runs on `127.0.0.1`.

```
┌──────────────────────────── Browser (http://localhost:5173) ─────────────────────────────┐
│ React + TypeScript (Vite) · TanStack Query · Recharts · Plotly.js · Tailwind              │
│ pages/ ── api/endpoints/* (typed hooks, generated from OpenAPI) ── api/client.ts          │
└───────────────────────────────┬──────────────────────────────────────────────────────────┘
                                │  /api (Vite dev proxy → 127.0.0.1:8000), SSE for live jobs
┌───────────────────────────────▼──────────────────────────────────────────────────────────┐
│ FastAPI (exofinder.api)  routers/*.py ── schemas/*.py (Pydantic v2) ── errors.py          │
│            │                                                                              │
│ services/ (application logic, shared by API and CLI) ── jobs/runner.py (thread pools,     │
│            │                                            progress, cancel, EventBus → SSE) │
│ ┌──────────┼───────────────┬───────────────────────┬────────────────────────┐             │
│ │ astro/   │ data/         │ ml/                   │ db/ (SQLAlchemy 2)     │             │
│ │ pipeline │ archive (TAP) │ splits, datasets      │ SQLite data/app.db     │             │
│ │ BLS, fit │ MAST download │ models, train, eval   │                        │             │
│ │ quality  │ catalogue     │ calibration, predict  │                        │             │
│ └──────────┴───────────────┴───────────────────────┴────────────────────────┘             │
└──────────────────────────────────────────────────────────────────────────────────────────┘
        NASA Exoplanet Archive (TAP)          NASA MAST (Kepler FITS)
```

## Layers and dependency rule
| Package | Responsibility | May import |
|---|---|---|
| `exofinder.astro` | pure signal processing on `LightCurve`/`Ephemeris` (no I/O except file readers) | numpy, scipy, astropy |
| `exofinder.data` | NASA clients, catalogue ingestion, labels, light-curve cache, tiers | `astro.types`, `db` |
| `exofinder.ml` | splits, dataset arrays, models, training, calibration, evaluation, inference | `astro.types` only (feature names come from the dataset manifest) |
| `exofinder.services` | use cases: build dataset, train, evaluate, predict, analyse, reports, settings | all of the above |
| `exofinder.api` | HTTP: routing, validation, response models, error mapping | `services` |
| `exofinder.cli` | command line: same services, jobs run synchronously | `services` |

Services raise `ServiceError` subclasses (`services/ops_errors.py`, `services/sci_errors.py`). The
routers convert them to the HTTP error body `{detail, code, hint}` (`api/routers/_ops_route.py`,
`_sci_route.py`). Services never import the API layer.

## Key modules
* `config.py`: settings from environment / `.env` (`EXOF_*`), paths, constants (pipeline version, view sizes).
* `db/models.py`: tables `catalog_snapshots`, `targets`, `signals`, `datasets`, `dataset_examples`,
  `jobs`, `experiments`, `epoch_metrics`, `model_versions`, `evaluations`, `predictions`, `settings`.
* `jobs/runner.py`: `JobRunner` with a *light* pool (2 threads: catalogue refresh, downloads) and a
  *heavy* pool (1 thread: dataset builds, training, evaluation, batch prediction), so heavy jobs never
  compete for the CPU. Each job has a persistent row with progress, log tail, result and error.
  `JobContext` gives `progress()`, `log()`, `event()` and cooperative cancellation. An `EventBus`
  pushes events thread-safely to SSE subscribers. On start-up, jobs left running by a previous
  process are marked failed.
* `services/signal_views.py`: catalogue signal → processed views with an on-disk cache keyed by
  pipeline version, configuration hash and light-curve SHA-256.
* `services/datasets.py` + `ops_dataset_worker.py`: dataset builds. Signals are processed in a
  spawn-safe process pool (CPU cores − 1 workers) with cancellation and per-signal exclusion
  reasons.
* `services/predictions.py`: thread-safe `Predictor` cache, seen-in-split lookup, warnings, batch
  scoring, candidate ranking.

## Data on disk
See [Data sources: local storage layout](data-sources.md#local-storage-layout). All writes of cached
files are atomic (temporary file + rename). Model bundles carry SHA-256 hashes of their weights.

## Frontend
* `src/api/schema.d.ts` is generated from the backend's OpenAPI (`npm run gen:api`, which imports the
  FastAPI app without starting a server). `src/api/endpoints/*.ts` wrap each API area in typed
  TanStack Query hooks. Job progress uses SSE (`useSSE`, with reconnect and polling fallback).
* `src/components/` contains the design system: UI primitives, charts (Plotly lazy-loaded), science
  components (verdict panel, quality report, provenance table) and the layout (sidebar, top bar,
  command palette, job tray).
* `src/pages/<Page>/` holds one folder per page; routes are in `src/App.tsx`.
* Colours and typography come from `src/styles/tokens.ts` and feed both Tailwind and the charts.

## Adding things
* **An API endpoint:** add a service function, then a router function with a Pydantic response model
  in `api/routers/<area>.py` (routers are discovered automatically), then run `npm run gen:api` in
  `frontend/` and add a hook in `src/api/endpoints/`.
* **A model type:** implement it in `ml/models/`, register it in `ml/train.py` and
  `ml/model_cards.py`, and make it loadable by `ml/checkpoint.py` and `ml/inference.py`.
* **A pipeline change** that alters numeric output must bump `PIPELINE_VERSION` in `config.py`.
  Datasets and models from older versions are then refused rather than mixed.
