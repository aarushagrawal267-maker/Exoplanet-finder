# Exoplanet Finder

**Train your own AI to vet planet signals in real NASA Kepler data, on your own computer.**

Exoplanet Finder is a local research application. It downloads public NASA Kepler data, processes
light curves into the "global" and "local" views used by the AstroNet research model, trains four
machine-learning models from scratch, and scores transit-like signals as

* **class 1, planet-like**, or
* **class 0, false-positive-like** (eclipsing binaries, background blends, instrumental artefacts…).

Everything runs on your machine: no accounts, no API keys, no paid or external AI services. The
models are trained on your computer from NASA data that you download.

> **A planet-like score is a research lead, not a discovery.** Confirming a planet needs independent
> follow-up (centroid analysis, imaging, radial velocities, statistical validation). See
> [Limitations](docs/limitations.md).

---

## Contents
1. [What you can do](#what-you-can-do)
2. [Installation (Windows)](#installation-windows)
3. [Start and stop](#start-and-stop)
4. [Your first research session](#your-first-research-session)
5. [The pages](#the-pages)
6. [Command line](#command-line)
7. [How it works](#how-it-works)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)
10. [Project layout](#project-layout)
11. [Documentation](#documentation)
12. [Credits and data acknowledgement](#credits-and-data-acknowledgement)

---

## What you can do
* **Explore NASA's Kepler catalogue**: about 20 000 Threshold Crossing Events (DR24), 9 500 Kepler Objects of
  Interest and every confirmed Kepler planet, with labels shown side by side and conflicts flagged.
* **Download real light curves** from NASA MAST (Kepler long cadence, quarters Q0–Q17). Downloads are
  resumable and verified.
* **Inspect any star**: raw, normalised, detrended and phase-folded light curves; a BLS period search;
  transit fitting; odd/even and secondary-eclipse tests; injection–recovery experiments.
* **Build datasets** at three sizes (Pilot ≈300, Standard ≈3 000, Full ≈15 700 signals). Train,
  validation and test sets are split **by star**, so the same star never appears in two splits, and
  famous systems such as Kepler-90 are kept for the test set.
* **Train four models** and compare them on identical data:
  logistic regression, random forest, a single-view CNN and a two-view CNN (AstroNet-style).
* **Evaluate honestly** on the held-out test set: accuracy, precision, recall, specificity, F1, ROC-AUC,
  PR-AUC, confusion matrix, Brier score, calibration (ECE and reliability diagram), inference time, and
  95 % bootstrap confidence intervals.
* **Score signals** from the catalogue or from your own uploaded FITS/CSV light curves. Each score comes
  with a calibrated probability, an uncertainty, a data-quality grade, and a note on whether the star was
  part of training.
* **Track experiments** in a local database and download reports (Markdown, HTML, JSON).

---

## Installation (Windows)

You need **Windows 10 or 11 (64-bit)**, about **25 GB of free disk** for the Standard tier (more for
Full), and an internet connection for NASA downloads. An NVIDIA GPU is optional; it is used
automatically if present.

### Step 1: Install Python 3.12
1. Go to <https://www.python.org/downloads/windows/> and download the **Windows installer (64-bit)**
   for Python **3.12** (3.11 and 3.13 also work).
2. Run it. On the first screen, **tick "Add python.exe to PATH"**, then click **Install Now**.
3. Open a new **PowerShell** window (Start menu, type *PowerShell*) and check:
   ```powershell
   py --version
   ```
   It should print `Python 3.12.x`.

### Step 2: Install Node.js 22 LTS
1. Go to <https://nodejs.org/> and download the **LTS** Windows installer (`.msi`, version 20 or newer).
2. Run it with the default options.
3. In a **new** PowerShell window:
   ```powershell
   node --version
   ```

### Step 3: Get the project
* With Git: `git clone <repository-url> Exoplanet-finder`
* Or download the ZIP from GitHub (**Code → Download ZIP**) and extract it, for example to
  `C:\Users\<you>\Exoplanet-finder`.

### Step 4: Run the setup script
Open PowerShell **in the project folder** (in File Explorer, open the folder, then type
`powershell` in the address bar and press Enter) and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

The script:
* creates a private Python environment in `.venv`;
* installs PyTorch (the CUDA build if `nvidia-smi` finds an NVIDIA GPU, otherwise CPU; use
  `-Cpu` to force CPU);
* installs the Python packages from `requirements.txt` and the frontend packages;
* creates `.env` from `.env.example` and the `data/` folders;
* runs `exofinder doctor` to check the installation.

It takes 5–15 minutes, mostly downloading PyTorch. You only need to run it once, or again after an
update.

---

## Start and stop

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

This starts the backend and the web interface, waits until they respond, and opens your browser:

| What | Address |
|---|---|
| Web application | <http://localhost:5173> |
| Backend API | <http://localhost:8000> |
| Interactive API documentation | <http://localhost:8000/docs> |

To stop everything:

```powershell
powershell -ExecutionPolicy Bypass -File .\stop.ps1
```

Logs are written to `logs\backend.log` and `logs\frontend.log`. Use `.\start.ps1 -NoBrowser` to
start without opening the browser.

> **macOS / Linux:** use `scripts/setup.sh`, `scripts/start.sh` and `scripts/stop.sh`, which do the same.

---

## Your first research session

The **Overview** page always shows the next step for your installation. A typical first session:

1. **Load the NASA catalogue.** Overview → *Refresh catalogue* (about 1 minute). This downloads the
   DR24 TCE table, the KOI table, the confirmed-planet list and stellar parameters from the NASA
   Exoplanet Archive. Each snapshot is stored with its query, timestamp and SHA-256.
2. **Look at a famous system.** Search for `Kepler-90` (Ctrl+K). The **Target Dossier** shows its
   eight planets with NASA's labels. Click *Download light curve* (about 18 quarter files, around 8 MB).
3. **Explore the signal.** In **Signal Explorer** and **Transit Analysis**, view the light curve at
   each processing stage, fold it on a planet's period, run BLS, and fit the transit.
4. **Build a dataset.** In **Dataset Explorer**, choose the *Pilot* tier for a quick end-to-end run
   (≈300 signals on 167 stars) or *Standard* for real experiments (≈3 000 signals on 1 976 stars).
   Missing light curves are downloaded automatically. Each star is about 8 MB of FITS data (raw files
   are deleted after conversion; the stored cache is about 0.7 MB per star). The Standard tier
   therefore downloads about 16 GB, which takes roughly 15 minutes on a fast connection and longer on
   a home connection. Downloads resume if interrupted.
5. **Train.** In **Model Training**, train one model or the whole suite (all four models on the same
   dataset). Training curves update live.

   *Measured on a 4-core CPU (no GPU), with other work running:* building the Standard dataset took
   31 minutes of processing; training the suite took 14 minutes (logistic regression 9 s, random
   forest 18 s, single-view CNN 3 min, two-view CNN 10 min). A Pilot dataset is processed in about
   2–3 minutes. Results: [Reference results](docs/reference-results.md).
6. **Evaluate.** In **Model Evaluation**, run the final evaluation on the held-out **test** set and
   compare models. The test set is used only here; model choices are made on the validation set.
7. **Detect.** In **Planet Detection**, score a catalogue signal or upload your own light curve.
   **Candidate Explorer** ranks NASA's unconfirmed KOI candidates by model score.
8. **Report.** In **Experiments**, compare runs and download a report.

---

## The pages

| Page | Purpose |
|---|---|
| **Overview** | Status of catalogue, data, datasets, models and jobs; next steps |
| **Signal Explorer** | Browse and filter all catalogue signals; light-curve viewer with every processing stage |
| **Transit Analysis** | BLS periodogram, folded transit, trapezoid fit, odd/even and secondary-eclipse tests, injection–recovery |
| **Planet Detection** | Score a catalogue signal or an uploaded FITS/CSV light curve with one or more models |
| **Candidate Explorer** | Rank KOI candidates by model score, agreement between models, uncertainty and data quality |
| **Prediction History** | Every prediction made, with model, inputs and data quality |
| **Dataset Explorer** | Download tiers, build datasets, inspect class balance, splits, exclusions and example views |
| **Model Training** | Model cards, configuration, live training curves, training suite |
| **Model Evaluation** | Test/validation metrics with confidence intervals, ROC/PR curves, calibration, confusion matrix, error analysis |
| **Experiments** | Experiment log, comparison, notes and tags, downloadable reports |
| **Target Dossier** | Everything about one star: stellar parameters, signals, labels, light curve, predictions |
| **Research Docs** | Methodology, data sources and limitations, inside the app |
| **Settings** | Device, download workers, storage use and clean-up, database backup |

---

## Command line

Everything in the interface is also available from the command line. Open PowerShell in the project
folder and activate the environment first:

```powershell
.\.venv\Scripts\Activate.ps1
```

| Command | What it does |
|---|---|
| `exofinder doctor` | Check the installation (add `--no-network` to skip NASA checks) |
| `exofinder refresh-catalog` | Download the NASA catalogue snapshots |
| `exofinder download --tier pilot` | Download light curves for a tier (or `--kepid 11442793`) |
| `exofinder build-dataset --tier standard --name "Standard DR24"` | Build a dataset |
| `exofinder train-suite --dataset 1` | Train all four models |
| `exofinder evaluate --model 3 --split test` | Final test evaluation |
| `exofinder predict --kepid 11442793` | Score the signals of a star with the active model |
| `exofinder status` | Summary of data, datasets, models and jobs |

Run `exofinder <command> --help` for all options.

---

## How it works

```
NASA Exoplanet Archive (TAP) ──► catalogue snapshots (labels, ephemerides, stellar parameters)
NASA MAST ──► Kepler long-cadence FITS ──► stitched light curve per star
        │
        ▼
quality flags ─► per-quarter normalisation ─► spline detrending (transits masked)
        ─► outlier clipping ─► phase folding ─► global view (2001 bins) + local view (201 bins)
        │
        ▼
quality gates ─► star-level train/val/test split ─► LR · RF · 1-view CNN · 2-view CNN
        │
        ▼
calibration (validation) ─► one-time test evaluation ─► predictions with uncertainty
```

* **Labels** (default): the DR24 Autovetter training set, PC → planet-like; AFP and NTP →
  false-positive-like. An alternative mode uses KOI dispositions (CONFIRMED vs FALSE POSITIVE).
  KOI candidates are never used for training.
* **No leakage:** splits by star; catalogue scores such as `koi_score` are never model inputs;
  thresholds and calibration use only the validation set.
* Full details: [Methodology](docs/methodology.md), [Data sources](docs/data-sources.md),
  [Pipeline](docs/pipeline.md), [Models](docs/models.md), [Evaluation](docs/evaluation.md).

**Technology:** FastAPI, SQLAlchemy and SQLite; PyTorch, scikit-learn, NumPy, SciPy and pandas;
Astropy, Astroquery and Lightkurve; React, TypeScript, Vite, Tailwind, Recharts, Plotly.js and Lucide.

---

## Testing

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

This runs the backend tests (pytest), frontend unit tests (Vitest and React Testing Library) and
end-to-end browser tests (Playwright). Individually:

```powershell
cd backend;  ..\.venv\Scripts\python -m pytest            # backend unit + API tests (offline)
cd backend;  ..\.venv\Scripts\python -m pytest -m network  # live NASA checks (needs internet)
cd frontend; npm test                                      # frontend unit tests
cd frontend; npx playwright install chromium; npm run test:e2e   # browser tests
```

Tests use temporary folders and never touch your data. Synthetic light curves used in tests are
labelled as test data and never shown as real results.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `running scripts is disabled on this system` | Use `powershell -ExecutionPolicy Bypass -File .\start.ps1` as shown above |
| `py` or `python` not found | Reinstall Python with **Add python.exe to PATH** ticked, then open a new PowerShell window |
| Setup says Python version unsupported | Install Python 3.11, 3.12 or 3.13 (64-bit) |
| `Port 8000 is already in use` | Run `.\stop.ps1`; if that does not help, another program uses the port: restart Windows or change `EXOF_PORT` in `.env` |
| The page shows "API offline" | Check `logs\backend.log`; run `.\.venv\Scripts\exofinder doctor` |
| NASA downloads fail | Check your internet connection or proxy; the NASA services are sometimes down for maintenance. Downloads resume where they stopped |
| Training is slow | Use the Pilot or Standard tier; close other heavy programs; a CUDA GPU is used automatically when available |
| Disk full | Settings → Storage: clear raw FITS files and caches; or keep fewer tiers |
| Something else | Run `exofinder doctor`, then open an issue with the output and `logs\backend.log` |

---

## Project layout

```
backend/exofinder/
  astro/      light-curve processing, BLS, transit fitting, diagnostics, quality gates
  data/       NASA Exoplanet Archive and MAST clients, catalogue, labels, download tiers
  ml/         splits, datasets, models, training, calibration, evaluation, inference
  services/   application logic used by the API and the CLI
  api/        FastAPI routers and schemas
  jobs/       background job runner (progress, cancellation, live events)
  db/         SQLAlchemy models (SQLite)
  cli.py      command-line interface
backend/tests/  unit, API and integration tests (+ real NASA FITS fixtures)
frontend/       React + TypeScript web application
docs/           research and developer documentation
data/           your downloaded data and database (created on first run, not in git)
artifacts/      trained models and reports (created on first run)
setup.ps1, start.ps1, stop.ps1   Windows scripts
```

---

## Documentation
* [Methodology](docs/methodology.md): the science and the research protocol
* [Data sources](docs/data-sources.md): NASA tables, labels, storage
* [Pipeline](docs/pipeline.md): light-curve processing and quality gates
* [Models](docs/models.md) and [Training](docs/training.md)
* [Evaluation](docs/evaluation.md): metrics, confidence intervals, calibration
* [Reference results](docs/reference-results.md): real results of the four models on the Standard tier
* [Predictions](docs/prediction.md): how to read a score
* [Experiments and reports](docs/experiments.md)
* [Limitations](docs/limitations.md)
* [Research report template](docs/research-report-template.md)
* [Architecture](docs/architecture.md) and [Testing](docs/testing.md) for developers

---

## Credits and data acknowledgement
This research tool uses the NASA Exoplanet Archive, which is operated by the California Institute of
Technology under contract with the National Aeronautics and Space Administration under the Exoplanet
Exploration Program, and data from the Mikulski Archive for Space Telescopes (MAST). Kepler was
funded by the NASA Science Mission Directorate.

The two-view CNN follows Shallue & Vanderburg (2018), *AJ* 155, 94. This project is an independent
re-implementation and is not affiliated with NASA or the original authors.
