# NASA data sources

Exoplanet Finder uses only **public NASA data**. No account, API key or paid service is required.

## Overview

| Source | What we take from it | How |
|---|---|---|
| **NASA Exoplanet Archive**: table `q1_q17_dr24_tce` | Kepler DR24 Threshold Crossing Events: period, epoch, duration, depth, SNR, and the **Autovetter training label** `av_training_set` (PC / AFP / NTP / UNK) | TAP service (`https://exoplanetarchive.ipac.caltech.edu/TAP/sync`), ADQL, CSV |
| **NASA Exoplanet Archive**: table `cumulative` | Kepler Objects of Interest (KOIs): `koi_disposition` (CONFIRMED / CANDIDATE / FALSE POSITIVE), false-positive reason flags, KOI ephemerides, link to the originating TCE | TAP |
| **NASA Exoplanet Archive**: `pscomppars` / `keplernames` | Confirmed planets and their Kepler names, including planets found after DR24 (e.g. Kepler-90 i) | TAP |
| **NASA Exoplanet Archive**: `keplerstellar` | Stellar parameters (Teff, log g, radius, mass, Kepler magnitude) | TAP |
| **NASA MAST** | Kepler long-cadence (29.4 min) light curves: one FITS file per quarter (Q0–Q17) with `TIME` (BKJD), `PDCSAP_FLUX`, `PDCSAP_FLUX_ERR`, `SAP_QUALITY` | MAST download API, with Lightkurve/Astroquery search as a fallback |

## Labels and categories

The app keeps three categories strictly separate:

* **Confirmed planets**: KOI disposition `CONFIRMED`, or listed in the confirmed-planets table.
* **False positives**: KOI disposition `FALSE POSITIVE` (with its reason flags: not transit-like,
  stellar eclipse, centroid offset, ephemeris match), or DR24 Autovetter `AFP` / `NTP` for
  signals that never became KOIs.
* **Candidates**: KOI disposition `CANDIDATE` (plus Autovetter PC signals that never became KOIs).
  These are *uncertain*. In the `koi_disposition` label mode they are never used for training. In the
  default `astronet_dr24` mode, the Autovetter label decides, so a CANDIDATE labelled PC is a
  planet-like training example (as in AstroNet). The Candidate Explorer scores candidates as research
  leads and, by default, hides those whose star was in a model's training or validation split.

> **Note on "certified false positives".** The Kepler False Positive Working Group's certified-FP
> table is not available through the Archive's programmatic (TAP) interface. This app therefore
> labels false positives as *archive-dispositioned* (KOI `FALSE POSITIVE` or DR24 AFP/NTP) and
> never calls them "certified".

### Label modes

| Mode | Class 1 | Class 0 | Excluded |
|---|---|---|---|
| `astronet_dr24` (default) | `av_training_set = PC` | `AFP`, `NTP` | `UNK`, missing |
| `koi_disposition` | `CONFIRMED` | `FALSE POSITIVE` | `CANDIDATE`, no KOI |

A **label conflict** is recorded when the two sources disagree (e.g. DR24 `PC` but KOI
`FALSE POSITIVE`). Conflicted signals are excluded from training by default.

## Matching observations to labels

* Every signal is keyed by the Kepler Input Catalog ID (`kepid`) plus the TCE planet number.
* Light curves are keyed by `kepid` (one star can host several signals).
* KOIs are linked to their TCE through `koi_tce_plnt_num`, and the link is **verified**: periods
  must agree within 1 % and epochs within half a transit duration (modulo the period). Failed
  checks are stored as `match_conflict` and not merged.
* Times: Kepler uses BKJD = BJD − 2 454 833.0. Archive transit midpoints given in BJD are
  converted to BKJD.

## How much data

Measured: one Kepler long-cadence quarter file is about 0.47 MB, and a star observed for the full
mission has up to 18 files (about 7–8 MB raw).

| Tier | Signals | Purpose |
|---|---|---|
| Pilot | ~300 | Verify the complete pipeline quickly |
| Standard | ~3 000 | Main experiments on a laptop |
| Full | all 15 737 labelled DR24 TCEs (9 865 stars, ~70 GB raw) | Full AstroNet-scale reproduction (resumable, overnight) |

Raw FITS files are converted into a compact stitched light curve per star
(`data/lightcurves/<kic>.npz`) and per-signal model views (`data/views/…`). By default the raw FITS
files are then deleted to save disk space (setting **Keep raw FITS**).

## Local storage layout

```
data/
  app.db                    SQLite: metadata, provenance, experiments, predictions
  catalogs/                 verbatim CSV snapshots of every Archive query (+ SHA-256 in DB)
  raw/kepler/<kic9>/        raw FITS (only if "keep raw FITS" is on)
  lightcurves/<kic9>.npz    stitched light curve per star (quality flags kept)
  views/v<pipeline>/        processed global/local views per signal
  datasets/<id>/            consolidated training arrays + manifest.json
  uploads/                  user-uploaded FITS/CSV files
artifacts/
  models/<id>/              checkpoints + meta.json
  reports/                  generated experiment reports
```

## Data quality verification

* Snapshot checks: required columns present, row counts, value ranges (period > 0, duration > 0),
  duplicate keys.
* File checks: FITS magic bytes and successful parse; atomic writes (no half-written files).
* Missing data: stars with no long-cadence data are marked `no_data`; failed quarters are recorded
  per file.
* Signal checks (see the pipeline docs): at least two observed transits, view coverage, transit
  alignment, measured depth consistent with the catalogue depth, and no NaNs. Every exclusion is
  counted by reason in the Dataset Explorer.
