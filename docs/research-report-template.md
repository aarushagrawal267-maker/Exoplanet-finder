# Research report template

Copy this template (or download an auto-filled experiment report from **Experiments → Download
report**) and complete each section. Replace everything in angle brackets.

---

## Title
<Short descriptive title, e.g. "Two-view CNN classification of Kepler DR24 TCEs: standard-tier
reproduction">

**Author:** <name> · **Date:** <date> · **Exoplanet Finder version:** <version> ·
**Pipeline version:** <version>

## 1. Research question
<What are you testing? e.g. "Does adding the local view improve PR-AUC over a global-view-only CNN
on star-separated held-out data?">

## 2. Data
* **Catalogue snapshots:** <source tables, retrieval timestamps, SHA-256 (from the Dataset page)>
* **Label mode:** <astronet_dr24 | koi_disposition> · **Conflicts excluded:** <yes/no>
* **Dataset:** <name, id, tier> · **Examples:** <n> (<n_pos> planet-like / <n_neg> false-positive-like)
* **Splits (by star):** train <n> / val <n> / test <n> · **Split seed:** <seed>
* **Reserved test targets:** <list>
* **Exclusions by reason:** <table from the Dataset Explorer>

## 3. Preprocessing
<Detrending method and parameters, quality bitmask, view sizes. Note any deviations from the
defaults.>

## 4. Models and training
| Model | Key hyperparameters | Parameters | Epochs (best) | Training time | Device |
|---|---|---|---|---|---|
| <...> | | | | | |

## 5. Results (held-out test set)
| Model | ROC-AUC [95 % CI] | PR-AUC [95 % CI] | Precision | Recall | Specificity | F1 | Brier | ECE |
|---|---|---|---|---|---|---|---|---|
| <...> | | | | | | | | |

* Decision threshold: <value, and how it was chosen: F1-optimal on validation>
* Confusion matrices: <attach>
* Calibration: <reliability diagram, temperature>
* Inference time: <ms/sample at batch 1 and 64>

## 6. Case studies
<Individual targets (e.g. Kepler-90 planets): catalogue classification vs model score,
uncertainty, data quality, transit diagnostics (odd/even, secondary eclipse).>

## 7. Error analysis
<Look through the false positives and false negatives in Model Evaluation. Which signal types fail?
(e.g. shallow transits, long periods, grazing eclipsing binaries)>

## 8. Limitations and threats to validity
<Label noise, class balance, dataset size, star-level leakage checks, domain shift (Kepler long
cadence only), what photometry alone cannot rule out.>

## 9. Conclusions
<Answer the research question. State clearly that planet-like scores are research leads, not
discoveries.>

## 10. Reproducibility
* Experiment ids: <...> · Model version ids: <...>
* Commit / version: <...> · Environment: <Python, PyTorch, scikit-learn versions>
* How to reproduce: <CLI commands or UI steps>

## References
* Shallue & Vanderburg (2018), AJ 155, 94.
* NASA Exoplanet Archive: cite each table you used with the DOI listed on its archive page,
  following the archive's acknowledgement policy.
* <others>
