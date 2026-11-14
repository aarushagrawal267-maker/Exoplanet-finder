# Reference results (Standard DR24 tier)

These are **real results** produced with this application during development, on real NASA data,
following the protocol in [Methodology](methodology.md). You will get similar, but not
bit-identical, numbers when you train on your own machine: CPU thread scheduling and library versions
affect CNN training slightly. The full machine-generated comparison report is in
[`reference/standard-dr24-comparison.md`](reference/standard-dr24-comparison.md)
([HTML](reference/standard-dr24-comparison.html), [JSON](reference/standard-dr24-comparison.json)).

## Setup
| Item | Value |
|---|---|
| Catalogue | NASA Exoplanet Archive snapshots retrieved 2026-11-14 (`q1_q17_dr24_tce`, `cumulative`, `pscomppars`+`keplernames`, `keplerstellar`); SHA-256 of each recorded in the dataset manifest |
| Light curves | NASA MAST Kepler long cadence, Q0–Q17, PDCSAP flux; 1,976 stars for this tier, all downloaded without error |
| Labels | `astronet_dr24`: Autovetter PC → planet-like; AFP, NTP → false-positive-like; UNK and label conflicts excluded |
| Dataset | "Standard DR24": 3,009 signals selected (seed 42), **2,934 included**, 75 excluded (60 label conflicts, 8 without an Autovetter label, 1 UNK, 5 too few transits, 1 sparse local view) |
| Splits (by star) | train 2,335 (1,148 / 1,187) · val 290 (144 / 146) · test 309 (160 / 149), as planet-like / false-positive-like |
| Pipeline | version 1.0, spline detrending with transit masking, 2001/201-bin views; processing took 31.5 min on 3 worker processes |
| Hardware | 4-core cloud VM, CPU only, no GPU; other work was running at the same time |

The Standard tier is **class-balanced by design** (about 50 % planet-like). In the full DR24
labelled set, only about 23 % of signals are planet candidates. PR-AUC and precision depend on that
prevalence, so expect lower values on naturally imbalanced data.

## Training (validation split)
| Model | Training time | Epochs (best) | Val PR-AUC | Val ROC-AUC | Val F1 | Threshold |
|---|---|---|---|---|---|---|
| Logistic regression | 9.4 s | n/a | 0.974 | 0.978 | 0.942 | 0.534 |
| Random forest | 17.9 s | n/a | 0.980 | 0.986 | 0.966 | 0.420 |
| Single-view CNN | 3.0 min | 15 (7) | 0.973 | 0.978 | 0.948 | 0.696 |
| Two-view CNN | 10.2 min | 26 (18) | 0.983 | 0.986 | 0.959 | 0.296 |

The validation metrics are optimistic, because the threshold and calibration were tuned on this
split. Before any test evaluation, the **two-view CNN was chosen as the active model** (best validation
PR-AUC) and the four models were frozen. This decision is recorded in the development log.

## Held-out test results (309 signals on 192 stars, each model evaluated once)
95 % bootstrap confidence intervals, resampling whole stars (1 000 resamples).

| Model | PR-AUC | ROC-AUC | F1 | Precision | Recall | Specificity | Brier | ECE |
|---|---|---|---|---|---|---|---|---|
| Logistic regression | 0.976 [0.951, 0.992] | 0.977 [0.958, 0.992] | 0.942 | 0.922 | 0.963 | 0.913 | 0.051 | 0.027 |
| Random forest | **0.988** [0.976, 0.995] | **0.987** [0.976, 0.995] | **0.966** | 0.946 | 0.988 | 0.940 | 0.037 | 0.035 |
| Single-view CNN | 0.963 [0.917, 0.991] | 0.976 [0.953, 0.992] | 0.963 | **0.951** | 0.975 | **0.946** | 0.035 | 0.028 |
| Two-view CNN | 0.971 [0.923, 0.997] | 0.986 [0.967, 0.996] | 0.961 | 0.930 | **0.994** | 0.919 | **0.031** | **0.016** |

Confusion matrices at each model's validation-chosen threshold (TP / FP / FN / TN):
LR 154 / 13 / 6 / 136 · RF 158 / 9 / 2 / 140 · single-view CNN 156 / 8 / 4 / 141 ·
two-view CNN 159 / 12 / 1 / 137.

### How to read this
* **The models are not statistically distinguishable** on this test set. All PR-AUC intervals overlap
  widely. The random forest has the highest point estimates, the two-view CNN the best recall
  (1 missed planet-like signal of 160) and the best-calibrated probabilities (lowest Brier score
  and ECE). With about 300 test signals, differences of 1–2 points are noise.
* **Simple models do well here.** The baselines get the 15 physical features (SNR, depth, odd/even
  and secondary-eclipse significance…) measured by the pipeline. Many DR24 false positives
  (especially NTP, "not transit-like") are separable with those features alone. The CNNs learn from
  the views without them. On larger datasets the published AstroNet results favour the two-view CNN;
  the Full-tier study tests that with this application.
* **ECE note:** the expected calibration error is biased upward on small samples, so its bootstrap
  interval can lie slightly above the point estimate (two-view CNN: 0.016 vs [0.018, 0.044]). This is
  a known property of the statistic, not an error.
* **Labels are not ground truth.** Some "errors" are probably label noise. Inspect them on the Model
  Evaluation page (false positives and false negatives with their views and NASA dispositions).

## Showcase: Kepler-90 (unseen test star)
Kepler-90 (KIC 11442793) is reserved for the test split. The two-view CNN (active model), scoring
each of its eight planets with the catalogue ephemeris:

| Planet | Period (d) | Planet-like probability (± MC-dropout σ) | NASA |
|---|---|---|---|
| b | 7.008 | 0.957 ± 0.038 | KOI CONFIRMED |
| c | 8.720 | 0.947 ± 0.035 | KOI CONFIRMED |
| i | 14.449 | 0.988 ± 0.013 | confirmed planet, no DR24 TCE |
| d | 59.737 | 0.992 ± 0.010 | KOI CONFIRMED |
| e | 91.940 | 0.991 ± 0.010 | KOI CONFIRMED |
| f | 124.923 | 0.982 ± 0.017 | KOI CONFIRMED |
| g | 210.601 | 0.989 ± 0.012 | KOI CONFIRMED |
| h | 331.603 | 0.977 ± 0.020 | DR24 PC, KOI CONFIRMED |

Kepler-90 i is the planet found with AstroNet in 2018. It has no DR24 TCE, so it was not part of
any training label. The application scores it from its published ephemeris. All of these are
**known, confirmed planets**: the table shows that the model recognises real transits on a star it
never saw. It does not show the model discovering anything.

## Reproduce
```powershell
exofinder refresh-catalog
exofinder build-dataset --name "Standard DR24" --tier standard --seed 42
exofinder train-suite --dataset <id>
exofinder evaluate --model <id> --split test        # once per model
exofinder report --experiment <ids...> --format html
```
