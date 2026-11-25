# Reference results (Standard and Full DR24 tiers)

These are **real results** produced with this application during development, on real NASA data,
following the protocol in [Methodology](methodology.md). You will get similar, but not
bit-identical, numbers when you train on your own machine: CPU thread scheduling and library versions
affect CNN training slightly. The machine-generated comparison reports are in `docs/reference/`:
Standard tier ([MD](reference/standard-dr24-comparison.md), [HTML](reference/standard-dr24-comparison.html),
[JSON](reference/standard-dr24-comparison.json)) and Full tier
([MD](reference/full-dr24-comparison.md), [HTML](reference/full-dr24-comparison.html),
[JSON](reference/full-dr24-comparison.json)).

**Summary.** On the Full DR24 tier (15 539 signals, natural class balance, 1 568 held-out test
signals), the two-view CNN reaches test ROC-AUC 0.988 [0.983, 0.993], PR-AUC 0.965 [0.948, 0.977] and
F1 0.913. The random forest baseline reaches the same ROC-AUC and PR-AUC, and the two cannot be told
apart on this test set; both score above logistic regression (PR-AUC 0.937). The two-view CNN has the
lowest Brier score and ECE; its ECE interval [0.012, 0.028] lies below the random forest's
[0.036, 0.057] but overlaps those of logistic regression and the single-view CNN. On the
smaller, class-balanced Standard tier the four models cannot be told apart statistically.

**Chance levels** (to read the numbers against): ROC-AUC 0.5 for any test set; PR-AUC equal to the
test set's planet-like fraction (0.518 on Standard, 0.232 on Full); accuracy of always answering
"false-positive-like" 0.482 on Standard and **0.768 on Full**. On the imbalanced Full tier, accuracy
therefore says little on its own; PR-AUC, F1 and recall are the informative numbers.

## Standard DR24 tier: class-balanced

### Setup
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

### Training (validation split)
| Model | Training time | Epochs (best) | Val PR-AUC | Val ROC-AUC | Val F1 | Threshold |
|---|---|---|---|---|---|---|
| Logistic regression | 9.4 s | n/a | 0.974 | 0.978 | 0.942 | 0.534 |
| Random forest | 17.9 s | n/a | 0.980 | 0.986 | 0.966 | 0.420 |
| Single-view CNN | 3.0 min | 15 (7) | 0.973 | 0.978 | 0.948 | 0.696 |
| Two-view CNN | 10.2 min | 26 (18) | 0.983 | 0.986 | 0.959 | 0.296 |

The validation metrics are optimistic, because the threshold and calibration were tuned on this
split. Before any test evaluation, the **two-view CNN was chosen as the active model** (best validation
PR-AUC) and the four models were frozen. This decision is recorded in the development log.

### Held-out test results (309 signals on 192 stars, each model evaluated once)
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
  the views without them. With more data the picture changes:
  see the Full-tier results below, where the two-view CNN leads and logistic regression falls behind.
* **ECE note:** the expected calibration error is biased upward on small samples, so its bootstrap
  interval can lie slightly above the point estimate (two-view CNN: 0.016 vs [0.018, 0.044]). This is
  a known property of the statistic, not an error.
* **Labels are not ground truth.** Some "errors" are probably label noise. Inspect them on the Model
  Evaluation page (false positives and false negatives with their views and NASA dispositions).

### Showcase: Kepler-90 (unseen test star)
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

## Full DR24 tier: natural class balance

### Setup
| Item | Value |
|---|---|
| Light curves | 9 866 stars (every star with a labelled DR24 signal), downloaded from MAST without error |
| Dataset | "Full DR24": 15 746 signals selected, **15 539 included**, 207 excluded (150 label conflicts, 44 too few transits, 8 without an Autovetter label, 4 sparse local views, 1 UNK) |
| Splits (by star) | train 12 418 (2 779 / 9 639) · val 1 553 (348 / 1 205) · test 1 568 (363 / 1 205), as planet-like / false-positive-like |
| Class balance | 22.4 % planet-like (the natural DR24 Autovetter proportion) |
| Processing | 15 596 signals; the first build was interrupted at 88 % by a time limit of the development session and rebuilt from the per-signal view cache (6.4 min) |

### Training (validation split)
| Model | Training time | Epochs (best) | Val PR-AUC | Val ROC-AUC | Val F1 | Threshold |
|---|---|---|---|---|---|---|
| Logistic regression | 14 s | n/a | 0.919 | 0.978 | 0.863 | 0.488 |
| Random forest | 83 s | n/a | 0.951 | 0.988 | 0.910 | 0.238 |
| Single-view CNN | 16.3 min | 24 (16) | 0.949 | 0.986 | 0.906 | 0.559 |
| Two-view CNN | 10.2 min | 14 (6) | 0.960 | 0.988 | 0.915 | 0.655 |

Before any Full test evaluation, the two-view CNN was made the **active model** (best validation
PR-AUC on the largest dataset).

### Held-out test results (1 568 signals on 981 stars, each model evaluated once)
| Model | PR-AUC | ROC-AUC | F1 | Precision | Recall | Specificity | Accuracy | Brier | ECE |
|---|---|---|---|---|---|---|---|---|---|
| Logistic regression | 0.937 [0.913, 0.957] | 0.980 [0.974, 0.986] | 0.870 | 0.873 | 0.868 | 0.962 | 0.940 | 0.045 | 0.020 |
| Random forest | **0.965** [0.948, 0.978] | **0.988** [0.983, 0.993] | 0.904 | 0.904 | 0.904 | 0.971 | 0.955 | 0.043 | 0.046 |
| Single-view CNN | 0.955 [0.936, 0.971] | 0.985 [0.978, 0.991] | 0.897 | **0.907** | 0.887 | **0.973** | 0.953 | 0.035 | 0.021 |
| Two-view CNN | **0.965** [0.948, 0.977] | **0.988** [0.983, 0.993] | **0.913** [0.889, 0.933] | 0.905 | **0.920** | 0.971 | **0.959** | **0.033** | **0.017** |

Confusion matrices (TP / FP / FN / TN): LR 315 / 46 / 48 / 1 159 · RF 328 / 35 / 35 / 1 170 ·
single-view CNN 322 / 33 / 41 / 1 172 · two-view CNN 334 / 35 / 29 / 1 170.

### How to read this
* With more data and the natural class balance, the ranking becomes clearer. The **two-view CNN
  and the random forest** lead with identical ROC-AUC and PR-AUC. The two-view CNN has the highest
  point estimates for F1, recall, accuracy and calibration (Brier 0.033, ECE 0.017), but these leads
  are inside the confidence intervals (F1 0.913 [0.889, 0.933] against 0.904 [0.876, 0.926]), so
  this test set does not show that it is better than the random forest. **Logistic regression is
  weaker** (PR-AUC 0.937 [0.913, 0.957], F1 0.870), and its PR-AUC interval lies mostly below
  the leaders' ([0.948, 0.978] and [0.948, 0.977]). The single-view CNN sits in between: the zoomed local view adds information.
* The intervals are computed separately for each model. No paired test of the differences
  between models (same test stars resampled together) was run, so treat "overlapping" and
  "almost separate" as rough guides, not significance tests.
* **Random-forest probabilities are under-confident in the middle range.** Its reliability curve
  on the Full test set shows 36 %, 52 % and 79 % planet-like signals in the bins where it predicts
  about 15 %, 25 % and 35 % (50, 29 and 24 signals), hence its ECE of 0.046, the highest of the four.
  Its ranking (ROC-AUC, PR-AUC) is unaffected, but read its probabilities between 0.1 and 0.5 as
  "uncertain", not as literal odds. The single-view CNN shows a milder version (28 %, 36 % and 57 %
  observed where it predicts about 13 %, 26 % and 35 %; 18, 14 and 21 signals). Logistic regression
  and the two-view CNN do not show it.
* PR-AUC and precision are lower than on the Standard tier because only 22 % of signals are
  planet-like here, not 50 %. These Full-tier numbers are the realistic ones.
* **Comparison with the literature (indicative only).** Shallue & Vanderburg (2018) are reported to
  have reached test AUC 0.988 and about 96 % accuracy on a DR24 test set of 1 523 TCEs (figures
  as reported in secondary sources: Malik et al. 2020, arXiv:2011.14135; Shallue & Vanderburg
  conference slides, NExScI 2017). This re-implementation obtains ROC-AUC 0.988 and accuracy 0.959
  on a different, star-separated split, with current catalogue labels and a single CPU-trained
  network. Similar numbers suggest the reproduction works, but the experiments are not identical,
  so this is not a like-for-like comparison.

### Kepler-90 with the Full-tier two-view CNN (unseen test star)
| Planet | b | c | i | d | e | f | g | h |
|---|---|---|---|---|---|---|---|---|
| Planet-like probability | 0.975 | 0.942 | 0.910 | 0.988 | 0.978 | 0.944 | 0.979 | 0.971 |
| MC-dropout σ | 0.021 | 0.037 | 0.049 | 0.012 | 0.019 | 0.035 | 0.019 | 0.022 |

All eight known planets are scored planet-like, including Kepler-90 i (no DR24 label; scored from its
published ephemeris).

## Inference speed
Measured on a quiet 4-core CPU (PyTorch with 4 threads), on validation-split inputs, median of 50
single calls and of 10 batches of 64, without uncertainty estimation:

| Model | ms per signal, batch 1 | ms per signal, batch 64 |
|---|---|---|
| Logistic regression | 0.35 | 0.014 |
| Random forest (300 trees) | 14.5–14.8 | 0.27–0.29 |
| Single-view CNN | 2.7–3.7 | 0.63–0.69 |
| Two-view CNN | 2.9–3.3 | 0.72–0.84 |

The timings stored with the test evaluations were taken while other heavy jobs were running
(for example the single-view CNN showed 112 ms at batch 1 there), so use the table above.
Uncertainty estimation adds about 20 extra passes of the fully connected head for single CNNs
(MC dropout).

## Reproduce
```powershell
exofinder refresh-catalog
exofinder build-dataset --name "Standard DR24" --tier standard --seed 42   # or --tier full
exofinder train-suite --dataset <id>
exofinder evaluate --model <id> --split test        # once per model
exofinder report --experiment <ids...> --format html
```
