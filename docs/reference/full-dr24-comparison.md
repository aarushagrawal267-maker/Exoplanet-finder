# Comparison of 4 experiments

> Planet-like predictions are research leads, not discoveries: a high score means the light-curve shape resembles signals that NASA vetting classified as planet candidates, nothing more.

Generated 2026-11-15T01:13:17+00:00 by Exoplanet Finder 1.0.0 (pipeline 1.0).

## Overview

| Experiment | Model type | Dataset | Status | Threshold | Epochs (best) | Training time (s) |
|---|---|---|---|---|---|---|
| #6 Full DR24 - Logistic regression | logreg | #3 Full DR24 | succeeded | 0.488 | 1 (1) | 13.6 |
| #7 Full DR24 - Random forest | random_forest | #3 Full DR24 | succeeded | 0.238 | 1 (1) | 82.8 |
| #8 Full DR24 - Single-view CNN | cnn_single | #3 Full DR24 | succeeded | 0.559 | 24 (16) | 980.9 |
| #9 Full DR24 - Two-view CNN (AstroNet) | cnn_two_view | #3 Full DR24 | succeeded | 0.655 | 14 (6) | 612.8 |

## Validation metrics (from training)

| Metric | #6 logreg | #7 random_forest | #8 cnn_single | #9 cnn_two_view |
|---|---|---|---|---|
| PR-AUC (average precision) | 0.919 | 0.951 | 0.949 | 0.960 |
| ROC-AUC | 0.978 | 0.988 | 0.986 | 0.988 |
| F1 | 0.863 | 0.910 | 0.906 | 0.915 |
| Precision | 0.858 | 0.892 | 0.870 | 0.887 |
| Recall / sensitivity | 0.868 | 0.928 | 0.945 | 0.945 |
| Specificity | 0.959 | 0.968 | 0.959 | 0.965 |
| Accuracy | 0.938 | 0.959 | 0.956 | 0.961 |
| Brier score (lower is better) | 0.047 | 0.042 | 0.034 | 0.034 |
| Expected calibration error (lower is better) | 0.016 | 0.045 | 0.006 | 0.023 |

## Test metrics (held-out stars) with 95 % CI

| Metric | #6 logreg | #7 random_forest | #8 cnn_single | #9 cnn_two_view |
|---|---|---|---|---|
| PR-AUC (average precision) | 0.937 [0.913, 0.957] | 0.965 [0.948, 0.978] | 0.955 [0.936, 0.971] | 0.965 [0.948, 0.977] |
| ROC-AUC | 0.980 [0.974, 0.986] | 0.988 [0.983, 0.993] | 0.985 [0.978, 0.991] | 0.988 [0.983, 0.993] |
| F1 | 0.870 [0.840, 0.896] | 0.904 [0.876, 0.926] | 0.897 [0.873, 0.919] | 0.913 [0.889, 0.933] |
| Precision | 0.873 [0.834, 0.909] | 0.904 [0.867, 0.934] | 0.907 [0.874, 0.937] | 0.905 [0.871, 0.934] |
| Recall / sensitivity | 0.868 [0.831, 0.901] | 0.904 [0.872, 0.932] | 0.887 [0.856, 0.917] | 0.920 [0.890, 0.946] |
| Specificity | 0.962 [0.951, 0.973] | 0.971 [0.961, 0.981] | 0.973 [0.963, 0.981] | 0.971 [0.960, 0.980] |
| Accuracy | 0.940 [0.928, 0.952] | 0.955 [0.944, 0.966] | 0.953 [0.943, 0.963] | 0.959 [0.949, 0.969] |
| Brier score (lower is better) | 0.045 [0.037, 0.052] | 0.043 [0.036, 0.051] | 0.035 [0.029, 0.042] | 0.033 [0.027, 0.040] |
| Expected calibration error (lower is better) | 0.020 [0.015, 0.033] | 0.046 [0.036, 0.057] | 0.021 [0.016, 0.032] | 0.017 [0.012, 0.028] |

## Configuration differences

| Option | #6 logreg | #7 random_forest | #8 cnn_single | #9 cnn_two_view |
|---|---|---|---|---|
| model_type | logreg | random_forest | cnn_single | cnn_two_view |

## Limitations

These results describe how well a model separates Kepler transit-like signals labelled planet-like from those labelled false-positive-like by published NASA vetting, on star-separated held-out data processed by this application's pipeline. Labels are expert/automated judgements and contain noise; class 0 mixes astrophysical false positives and non-transiting phenomena. Photometry alone cannot rule out background eclipsing binaries or contamination (no pixel or centroid data are used). Models are trained on Kepler long-cadence data only; other missions or cadences are out of distribution. Small datasets give wide confidence intervals, so differences between models inside overlapping intervals are not evidence of a real difference.

Planet-like predictions are research leads, not discoveries: a high score means the light-curve shape resembles signals that NASA vetting classified as planet candidates, nothing more.
