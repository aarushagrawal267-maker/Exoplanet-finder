# Comparison of 4 experiments

> Planet-like predictions are research leads, not discoveries: a high score means the light-curve shape resembles signals that NASA vetting classified as planet candidates, nothing more.

Generated 2026-11-14T22:34:51+00:00 by Exoplanet Finder 1.0.0 (pipeline 1.0).

## Overview

| Experiment | Model type | Dataset | Status | Threshold | Epochs (best) | Training time (s) |
|---|---|---|---|---|---|---|
| #2 Standard DR24 - Logistic regression | logreg | #2 Standard DR24 | succeeded | 0.534 | 1 (1) | 9.4 |
| #3 Standard DR24 - Random forest | random_forest | #2 Standard DR24 | succeeded | 0.420 | 1 (1) | 17.9 |
| #4 Standard DR24 - Single-view CNN | cnn_single | #2 Standard DR24 | succeeded | 0.696 | 15 (7) | 179.3 |
| #5 Standard DR24 - Two-view CNN (AstroNet) | cnn_two_view | #2 Standard DR24 | succeeded | 0.296 | 26 (18) | 610.8 |

## Validation metrics (from training)

| Metric | #2 logreg | #3 random_forest | #4 cnn_single | #5 cnn_two_view |
|---|---|---|---|---|
| PR-AUC (average precision) | 0.974 | 0.980 | 0.973 | 0.983 |
| ROC-AUC | 0.978 | 0.986 | 0.978 | 0.986 |
| F1 | 0.942 | 0.966 | 0.948 | 0.959 |
| Precision | 0.926 | 0.947 | 0.939 | 0.934 |
| Recall / sensitivity | 0.958 | 0.986 | 0.958 | 0.986 |
| Specificity | 0.925 | 0.945 | 0.938 | 0.932 |
| Accuracy | 0.941 | 0.966 | 0.948 | 0.959 |
| Brier score (lower is better) | 0.051 | 0.037 | 0.046 | 0.037 |
| Expected calibration error (lower is better) | 0.025 | 0.034 | 0.025 | 0.021 |

## Test metrics (held-out stars) with 95 % CI

| Metric | #2 logreg | #3 random_forest | #4 cnn_single | #5 cnn_two_view |
|---|---|---|---|---|
| PR-AUC (average precision) | 0.976 [0.951, 0.992] | 0.988 [0.976, 0.995] | 0.963 [0.917, 0.991] | 0.971 [0.923, 0.997] |
| ROC-AUC | 0.977 [0.958, 0.992] | 0.987 [0.976, 0.995] | 0.976 [0.953, 0.992] | 0.986 [0.967, 0.996] |
| F1 | 0.942 [0.911, 0.966] | 0.966 [0.944, 0.984] | 0.963 [0.938, 0.981] | 0.961 [0.933, 0.980] |
| Precision | 0.922 [0.871, 0.964] | 0.946 [0.908, 0.977] | 0.951 [0.914, 0.980] | 0.930 [0.882, 0.964] |
| Recall / sensitivity | 0.963 [0.931, 0.988] | 0.988 [0.966, 1.000] | 0.975 [0.947, 0.994] | 0.994 [0.977, 1.000] |
| Specificity | 0.913 [0.864, 0.957] | 0.940 [0.894, 0.974] | 0.946 [0.909, 0.979] | 0.919 [0.868, 0.959] |
| Accuracy | 0.939 [0.911, 0.964] | 0.964 [0.941, 0.983] | 0.961 [0.938, 0.980] | 0.958 [0.932, 0.978] |
| Brier score (lower is better) | 0.051 [0.032, 0.072] | 0.037 [0.024, 0.054] | 0.035 [0.021, 0.053] | 0.031 [0.019, 0.047] |
| Expected calibration error (lower is better) | 0.027 [0.022, 0.063] | 0.035 [0.027, 0.060] | 0.028 [0.024, 0.055] | 0.016 [0.018, 0.044] |

## Configuration differences

| Option | #2 logreg | #3 random_forest | #4 cnn_single | #5 cnn_two_view |
|---|---|---|---|---|
| model_type | logreg | random_forest | cnn_single | cnn_two_view |

## Limitations

These results describe how well a model separates Kepler transit-like signals labelled planet-like from those labelled false-positive-like by published NASA vetting, on star-separated held-out data processed by this application's pipeline. Labels are expert/automated judgements and contain noise; class 0 mixes astrophysical false positives and non-transiting phenomena. Photometry alone cannot rule out background eclipsing binaries or contamination (no pixel or centroid data are used). Models are trained on Kepler long-cadence data only; other missions or cadences are out of distribution. Small datasets give wide confidence intervals, so differences between models inside overlapping intervals are not evidence of a real difference.

Planet-like predictions are research leads, not discoveries: a high score means the light-curve shape resembles signals that NASA vetting classified as planet candidates, nothing more.
