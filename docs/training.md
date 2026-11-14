# Training your own models

All models in Exoplanet Finder are trained **from scratch on your computer**, on Kepler data you
downloaded from NASA. No pre-trained weights and no external AI services are involved.

## Before you train
1. **Catalogue loaded** (Overview → Refresh catalogue).
2. **A dataset is built** (Dataset Explorer). The dataset fixes everything the models see: the label
   mode, the processed views, the quality exclusions and the star-level train/val/test split. Every
   model trained on the same dataset is comparable.

## Training in the app
**Model Training** page:

1. Choose a dataset and a model type. The model card explains its inputs, strengths, limitations and
   default configuration.
2. Adjust the configuration if you want. The defaults reproduce the AstroNet setup for the CNNs.
   The page shows a measured estimate of seconds per epoch on your device.
3. Start one run, or **Train suite** to train logistic regression, random forest, the single-view CNN
   and the two-view CNN one after another on the same dataset.
4. Watch the run live: training and validation loss, validation PR-AUC and ROC-AUC per epoch,
   progress, ETA and the log. You can cancel at any time.

When a run finishes:
* a **model version** is stored in `artifacts/models/<id>/`, with the validation-chosen threshold and
  calibration;
* an **experiment** records the configuration, seed, device, software versions, per-epoch metrics and
  validation metrics;
* the first successful model becomes the **active** model, used by default for predictions. You can
  activate another on the Model Training page.

Then go to **Model Evaluation** for the held-out test evaluation.

## Training from the command line
```powershell
.\.venv\Scripts\Activate.ps1
exofinder build-dataset --name "Standard DR24" --tier standard
exofinder train-suite --dataset 2
exofinder train --model-type cnn_two_view --dataset 2 --set ensemble_size=3 --set max_epochs=60
exofinder evaluate --model 4 --split test
exofinder report --experiment 1 2 3 4 --format html
```

`--set KEY=VALUE` changes any training option (repeatable); `--config` takes a JSON object.

## Configuration reference
| Option | Default | Applies to | Meaning |
|---|---|---|---|
| `lr` | 1e-4 | CNNs | Adam learning rate |
| `batch_size` | 64 | CNNs | examples per optimisation step |
| `max_epochs` | 50 | CNNs | upper limit of passes over the training split |
| `patience` | 8 | CNNs | stop after this many epochs without validation PR-AUC improvement |
| `min_delta` | 1e-4 | CNNs | smallest change that counts as an improvement |
| `dropout` | 0.3 | CNNs | dropout in the fully connected head (also used for MC-dropout uncertainty) |
| `fc_width` / `fc_layers` | 512 / 4 | CNNs | fully connected head |
| `weight_decay` | 0 | CNNs | L2 penalty |
| `augment_flip` | true | CNNs | random time reversal of both views |
| `ensemble_size` | 1 | CNNs | number of networks with different seeds (averaged logits) |
| `seed` | 42 | all | random seed; CPU training is deterministic for a given seed |
| `device` | auto | CNNs | `auto` uses CUDA when available (Settings → Device) |
| `cv_folds` | 3 | baselines | grouped cross-validation folds on the training split |
| `logreg_c_grid` | 0.001, 0.01, 0.1, 1 | logistic regression | inverse regularisation strengths tried |
| `rf_n_estimators` | 300 | random forest | number of trees |
| `rf_max_depth_grid` / `rf_min_samples_leaf_grid` | (none, 16) / (1, 4) | random forest | grid searched by CV |

## Good practice
* **Change one thing at a time** and compare experiments on the same dataset (Experiments → Compare).
* **Do not tune on the test set.** Choose configurations by validation metrics. Evaluate on test once
  per final model; the app counts test evaluations.
* **Report uncertainty.** With a few hundred validation or test examples, metric differences of a
  few points are often within the confidence intervals.
* **Seeds matter for CNNs.** Run two or three seeds (or an ensemble) before concluding that one
  configuration is better.
* **GPU:** if you have an NVIDIA GPU, run `setup.ps1` again (it installs the CUDA build of PyTorch
  when `nvidia-smi` is present) and set Device to `auto` or `cuda`.
