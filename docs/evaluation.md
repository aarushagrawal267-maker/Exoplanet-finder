# Evaluation

How Exoplanet Finder measures model quality, and how to read the numbers.

## Protocol
1. **Splits are made by star** when a dataset is built (80 / 10 / 10 %, stratified by class, fixed
   seed). All signals of a star are in the same split, so a model is never tested on a star whose other
   planets it saw in training. A leakage check runs on every dataset build.
2. **Training** uses only the training split. **Model selection** uses only the validation split:
   early stopping, decision threshold (F1-optimal), temperature calibration and baseline
   hyperparameters (via grouped cross-validation on train).
3. **Final evaluation** scores the held-out **test** split, ideally **once per model**. Every
   test evaluation is logged with a timestamp, and the Model Evaluation page shows how many times a
   model was evaluated on test. If you keep changing a model after looking at test results, the test
   set slowly turns into a validation set.
4. Reserved showcase systems (Kepler-90, Kepler-80, Kepler-11, Kepler-186, Kepler-452) are always
   placed in the test split, so demonstrations on them are genuinely unseen. They come *in addition
   to* the ordinary 10 % random test sample of the other stars, so the test split is slightly larger
   than 10 % and is not dominated by these multi-planet systems.

## Metrics
All metrics treat **planet-like (class 1)** as the positive class.

| Metric | Meaning | Notes |
|---|---|---|
| **Accuracy** | fraction of correct labels | misleading with class imbalance; read it alongside the others |
| **Precision** | of the signals called planet-like, the fraction that are | "how pure are my leads?" |
| **Recall / sensitivity** | of the planet-like signals, the fraction found | "how many do I miss?" |
| **Specificity** | of the false-positive-like signals, the fraction correctly rejected | |
| **F1** | harmonic mean of precision and recall | the threshold is chosen to maximise this on validation |
| **ROC-AUC** | probability that a random positive scores above a random negative | threshold-free |
| **PR-AUC** | area under the precision–recall curve (average precision) | threshold-free; the best single number under imbalance; the chance level equals the positive fraction |
| **Confusion matrix** | TP, FP, TN, FN counts at the threshold | |
| **Brier score** | mean squared error of the probabilities | lower is better; mixes calibration and discrimination |
| **ECE** | expected calibration error over 10 equal-width probability bins | 0 = perfectly calibrated |
| **Reliability diagram** | observed planet-like fraction against mean predicted probability per bin | points on the diagonal = calibrated |
| **Inference time** | ms per sample at batch size 1 and 64 (median), on the evaluation device | measured without uncertainty estimation |

Metrics are reported at the model's **validation-chosen threshold**, and also at 0.5 for
comparison.

## Confidence intervals
Every metric gets a **95 % bootstrap confidence interval** (1 000 resamples, percentile method).
Because signals of the same star are correlated, the bootstrap **resamples whole stars** rather than
individual signals. This gives wider, more honest intervals.

Read the intervals before comparing models. If two models' intervals overlap widely, the test set is
too small to tell them apart. With a Standard-tier dataset (≈300 test signals), PR-AUC intervals are
typically several percentage points wide.

## Error analysis
The Model Evaluation page lists the test examples in each cell of the confusion matrix (false
positives, false negatives, true positives, true negatives), with the probability, catalogue labels
and local view. Typical patterns to look for:

* **False negatives**: shallow or low-SNR transits, long periods with few transits, signals with
  data gaps around the transits.
* **False positives**: eclipsing binaries without a visible secondary, grazing V-shaped transits of
  real planets, and background blends that need centroid data (which the models do not see).
* **Label noise**: some catalogue labels are wrong or have changed. A confident "error" can be
  a mislabelled signal; check its KOI disposition and reason flags.

## Permutation feature importance (baselines)
For logistic regression and random forest, the evaluation page can compute **permutation
importance**: how much PR-AUC drops when one input group (a feature, or a block of view bins) is
randomly shuffled across the evaluated examples. It shows what a model relies on. It is computed on
the evaluated split, never on the training data.

## Comparing models
Comparisons are only meaningful on the **same dataset and split**. The comparison view refuses
mismatched evaluations or shows a warning. Use the experiment comparison report to export an aligned
table with confidence intervals.
