# Models

Exoplanet Finder trains four model types **from scratch, on your computer**, on identical
star-separated splits, so they can be compared fairly. They range from a simple linear model to the
AstroNet-style two-view CNN, which shows how much each step in complexity actually buys.

| Type id | Name | Inputs | Trainable parameters |
|---|---|---|---|
| `logreg` | Logistic regression | downsampled global view (201) + local view (201) + 15 physical features | 418 (417 weights + bias) |
| `random_forest` | Random forest | same as logistic regression | 300 trees |
| `cnn_single` | Single-view CNN | global view (2001 bins) | 9 177 393 |
| `cnn_two_view` | Two-view CNN (AstroNet-style) | global view (2001) + local view (201) | 9 940 193 |

The **Model Training** page shows a model card for each type (description, inputs, strengths,
limitations, architecture and default configuration). The same cards are available from
`GET /api/training/model-types`.

## Baselines
* **Logistic regression**: `StandardScaler` followed by an L2-regularised logistic regression with
  `class_weight="balanced"`. It weighs each input bin and feature independently, so it shows how much
  of the problem can be solved without learned shape detectors.
* **Random forest**: 300 trees with `class_weight="balanced"`. It captures non-linear interactions
  between features (e.g. "deep **and** V-shaped") and gives an uncertainty estimate from the spread
  of the tree votes.
* The global view is reduced from 2001 to 201 bins by averaging blocks. The local view is used as is.
  The 15 physical features are measured from the light curve (see [Pipeline](pipeline.md)); catalogue
  scores are never used.
* **Hyperparameters** (C for logistic regression; maximum depth and minimum leaf size for the random
  forest) are chosen by 3-fold cross-validation on the **training split only**, with folds grouped by
  star (`StratifiedGroupKFold`), and the model is then refitted on the whole training split.

## Convolutional networks
The CNNs follow Shallue & Vanderburg (2018):

* **Global column** (2001 bins): five blocks of two 1-D convolutions (kernel 5, ReLU), with
  16, 32, 64, 128 and 256 filters, each block followed by max-pooling (window 5, stride 2).
* **Local column** (201 bins): two blocks with 16 and 32 filters, each followed by max-pooling
  (window 7, stride 2).
* **Head**: the flattened columns are concatenated and passed through four fully connected layers of
  512 units (ReLU, dropout 0.3), then one output logit.
* The **single-view CNN** is the same network with only the global column. Comparing it with the
  two-view CNN measures the value of the zoomed-in transit shape.
* Weights use He initialisation, which suits ReLU networks. With PyTorch's default initialisation, this
  depth of network barely trained at the AstroNet learning rate.

## Training (defaults)
| Setting | CNNs | Baselines |
|---|---|---|
| Loss | binary cross-entropy with `pos_weight = n_neg / n_pos` | `class_weight="balanced"` |
| Optimiser | Adam, learning rate 1e-4, batch 64 | lbfgs (LR) |
| Epochs | up to 50, early stopping after 8 epochs without val PR-AUC improvement | n/a |
| Augmentation | random time reversal of both views (a transit is symmetric) | none |
| Model selection | best validation PR-AUC (ties broken by validation loss) | grouped CV on train |
| Ensemble | optional: N networks with different seeds, logits averaged | n/a |
| Seed | 42 (deterministic on CPU) | 42 |

All settings can be changed on the Model Training page or in `POST /api/training/runs`.

## Calibration and decision threshold
Class weighting makes raw scores systematically too high for the minority class. After training:

1. The known prior shift is removed: `z' = z − log(n_neg / n_pos)` (training-split counts).
2. A **temperature** `T` is fitted on the **validation** split: `p = sigmoid(z' / T)`.
3. The **decision threshold** is chosen on the validation split to maximise F1. Metrics at 0.5 are
   stored as well, and in Settings you can switch the default threshold to a fixed 0.5.

Reported validation metrics are therefore slightly optimistic, because the threshold and the
temperature were tuned on that set. Only the **test-set evaluation** is unbiased.

## Uncertainty
| Model | Uncertainty |
|---|---|
| CNN ensemble (N > 1) | standard deviation of member probabilities |
| Single CNN | Monte-Carlo dropout: 20 fixed dropout masks in the fully connected head |
| Random forest | spread of the individual tree probabilities |
| Logistic regression | none (shown as "not available") |

A prediction is shown as **Uncertain** when its uncertainty band crosses the decision threshold.
Signals that fail the training data-quality gate are not scored at all (see [Predictions](prediction.md)).

## Model bundles
Each trained model is stored in `artifacts/models/<id>/`: `meta.json` (type, configuration,
architecture, dataset id, pipeline version, threshold, temperature, prior offset, metrics, weight
hashes), `history.json` (per-epoch metrics) and the weights (`member_XX/best.pt` for CNNs,
`model.joblib` for baselines). Weights are loaded with PyTorch's safe `weights_only` mode and their
SHA-256 is checked. Scikit-learn bundles use pickle (joblib), so only load bundles created by this app.

## Reference
Shallue, C. J. & Vanderburg, A. (2018). *Identifying Exoplanets with Deep Learning: A Five-planet
Resonant Chain around Kepler-80 and an Eighth Planet around Kepler-90.* AJ 155, 94.
