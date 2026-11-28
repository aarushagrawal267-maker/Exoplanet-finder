# Pilot DR24 reference run (2026-11-28)

Model files and held-out test predictions of one complete run of the application on the **Pilot** tier,
made on 2026-11-28 on a shared 4-core cloud VM (CPU only) with the project's own commands:

```bash
exofinder refresh-catalog                                    # NASA Exoplanet Archive snapshots of 2026-11-28
exofinder build-dataset --tier pilot --name "Pilot DR24" --workers 2
exofinder train-suite --dataset 1 --name-prefix "Pilot DR24"
# active model chosen on validation PR-AUC before any test evaluation: the two-view CNN (0.950)
exofinder evaluate --model <1..4> --split test               # once per model
```

The run took about 20 minutes of compute: catalogue 1.5 min; dataset 7.9 min (145 stars downloaded from
MAST in 171 s, 295 signals processed in 303 s on 2 worker processes); training 10.4 min for the four
models; test evaluation 20 s.

| Folder | Model | Files |
|---|---|---|
| `models/1-logistic-regression/` | logistic regression on the 15 pipeline features | `model.joblib`, `meta.json`, `history.json` |
| `models/2-random-forest/` | random forest on the same features | `model.joblib`, `meta.json`, `history.json` |
| `models/4-two-view-cnn/` | two-view CNN (AstroNet-style), **the active model** | `member_00/best.pt` (38 MB), `meta.json`, `history.json` |
| `test-predictions/model-<id>.csv` | every held-out test signal: label, calibrated probability, raw probability, prediction, uncertainty | for all four models |

The single-view CNN (model 3, another 38 MB) is not committed, to keep the repository small; its test
predictions and metrics are included. `meta.json` holds each model's threshold, calibration (temperature
and prior offset), training configuration, library versions and the SHA-256 of its weight files. A
bundle loads with `exofinder.ml.checkpoint.load_model_bundle(<folder>)`.

These files cannot be imported into a fresh install's database on their own (the database ties a model to
its dataset and catalogue snapshot). Train your own with the commands above, or browse this run's
results online: <https://huggingface.co/spaces/agrawalaarush08/exoplanet-finder>.

## Results on the held-out test stars

43 test signals on 18 stars (29 planet-like, 14 false-positive-like; chance PR-AUC 0.674). 95 % bootstrap
intervals, 1 000 resamples of whole stars. Full report: [docs/reference/pilot-dr24-comparison.md](../../../docs/reference/pilot-dr24-comparison.md).

| Model | PR-AUC | ROC-AUC | F1 | Accuracy | Val PR-AUC |
|---|---|---|---|---|---|
| Logistic regression | 0.963 [0.846, 0.996] | 0.926 [0.781, 0.990] | 0.892 | 0.837 | 0.920 |
| Random forest | 0.949 [0.791, 0.996] | 0.916 [0.764, 0.989] | 0.906 | 0.860 | 0.933 |
| Single-view CNN | 0.924 [0.803, 0.988] | 0.869 [0.710, 0.969] | 0.906 | 0.860 | 0.915 |
| Two-view CNN (active) | 0.939 [0.820, 0.995] | 0.892 [0.710, 0.986] | 0.921 | 0.884 | 0.950 |

All four models find every planet-like test signal (recall 1.000) and differ in how many false positives
they let through (5 to 7 of 14). With 43 test signals the intervals are wide and overlap: the models
cannot be told apart on this run, and the numbers are well below the [Standard and Full tier reference
results](../../../docs/reference-results.md). A planet-like score is a research lead, not a discovery.
