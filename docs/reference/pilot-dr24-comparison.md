# Comparison of 4 experiments

> Planet-like predictions are research leads, not discoveries: a high score means the light-curve shape resembles signals that NASA vetting classified as planet candidates, nothing more.

Generated 2026-11-28T09:43:39+00:00 by Exoplanet Finder 1.0.0 (pipeline 1.0).

## Overview

| Experiment | Model type | Dataset | Status | Threshold | Epochs (best) | Training time (s) |
|---|---|---|---|---|---|---|
| #1 Pilot DR24 - Logistic regression | logreg | #1 Pilot DR24 | succeeded | 0.301 | 1 (1) | 20.3 |
| #2 Pilot DR24 - Random forest | random_forest | #1 Pilot DR24 | succeeded | 0.249 | 1 (1) | 10.8 |
| #3 Pilot DR24 - Single-view CNN | cnn_single | #1 Pilot DR24 | succeeded | 0.546 | 21 (13) | 417.0 |
| #4 Pilot DR24 - Two-view CNN (AstroNet) | cnn_two_view | #1 Pilot DR24 | succeeded | 0.658 | 24 (16) | 172.4 |

## Validation metrics (from training)

| Metric | #1 logreg | #2 random_forest | #3 cnn_single | #4 cnn_two_view |
|---|---|---|---|---|
| PR-AUC (average precision) | 0.920 | 0.933 | 0.915 | 0.950 |
| ROC-AUC | 0.928 | 0.938 | 0.928 | 0.954 |
| F1 | 0.897 | 0.897 | 0.897 | 0.897 |
| Precision | 0.812 | 0.812 | 0.812 | 0.812 |
| Recall / sensitivity | 1.000 | 1.000 | 1.000 | 1.000 |
| Specificity | 0.800 | 0.800 | 0.800 | 0.800 |
| Accuracy | 0.893 | 0.893 | 0.893 | 0.893 |
| Brier score (lower is better) | 0.116 | 0.108 | 0.127 | 0.104 |
| Expected calibration error (lower is better) | 0.192 | 0.139 | 0.163 | 0.136 |

## Test metrics (held-out stars) with 95 % CI

| Metric | #1 logreg | #2 random_forest | #3 cnn_single | #4 cnn_two_view |
|---|---|---|---|---|
| PR-AUC (average precision) | 0.963 [0.846, 0.996] | 0.949 [0.791, 0.996] | 0.924 [0.803, 0.988] | 0.939 [0.820, 0.995] |
| ROC-AUC | 0.926 [0.781, 0.990] | 0.916 [0.764, 0.989] | 0.869 [0.710, 0.969] | 0.892 [0.710, 0.986] |
| F1 | 0.892 [0.739, 0.966] | 0.906 [0.764, 0.974] | 0.906 [0.775, 0.973] | 0.921 [0.792, 0.982] |
| Precision | 0.806 [0.586, 0.933] | 0.829 [0.618, 0.949] | 0.829 [0.633, 0.947] | 0.853 [0.655, 0.966] |
| Recall / sensitivity | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] |
| Specificity | 0.500 [0.250, 0.727] | 0.571 [0.273, 0.818] | 0.571 [0.286, 0.824] | 0.643 [0.375, 0.909] |
| Accuracy | 0.837 [0.686, 0.941] | 0.860 [0.714, 0.957] | 0.860 [0.722, 0.957] | 0.884 [0.750, 0.975] |
| Brier score (lower is better) | 0.105 [0.051, 0.186] | 0.092 [0.044, 0.172] | 0.119 [0.047, 0.226] | 0.113 [0.045, 0.215] |
| Expected calibration error (lower is better) | 0.118 [0.083, 0.237] | 0.081 [0.056, 0.216] | 0.118 [0.062, 0.292] | 0.093 [0.046, 0.262] |

## Configuration differences

| Option | #1 logreg | #2 random_forest | #3 cnn_single | #4 cnn_two_view |
|---|---|---|---|---|
| model_type | logreg | random_forest | cnn_single | cnn_two_view |

## Limitations

These results describe how well a model separates Kepler transit-like signals labelled planet-like from those labelled false-positive-like by published NASA vetting, on star-separated held-out data processed by this application's pipeline. Labels are expert/automated judgements and contain noise; class 0 mixes astrophysical false positives and non-transiting phenomena. Photometry alone cannot rule out background eclipsing binaries or contamination (no pixel or centroid data are used). Models are trained on Kepler long-cadence data only; other missions or cadences are out of distribution. Small datasets give wide confidence intervals, so differences between models inside overlapping intervals are not evidence of a real difference.

Planet-like predictions are research leads, not discoveries: a high score means the light-curve shape resembles signals that NASA vetting classified as planet candidates, nothing more.
