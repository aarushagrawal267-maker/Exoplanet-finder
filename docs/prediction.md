# Predictions: how to read a score

The **Planet Detection** page (and `POST /api/predictions`) scores one transit-like signal with
one or more of your trained models. This page explains what you get back and how to interpret it.

> A planet-like score is a **research lead, not a discovery**. It says the folded light curve
> *looks like* signals that NASA vetting classified as planet candidates. It cannot rule out
> background eclipsing binaries, it does not measure a mass, and it is not a statistical validation.

## Inputs
* **A catalogue signal**: choose a star and one of its signals. The catalogue ephemeris (period,
  epoch, duration) is used by default. If the star's light curve is not downloaded yet, it is
  downloaded first (one star takes a few seconds).
* **A BLS ephemeris**: instead of the catalogue ephemeris, run a BLS period search on the light curve
  and score the strongest periodic signal. You get a warning if BLS finds a period other than the
  catalogue's, or a possible alias (P/2, 2P).
* **Your own light curve**: upload a FITS or CSV/TXT file. Map the columns, set the time system
  (BKJD, BJD, BTJD), and give an ephemeris or let BLS find one.

The signal goes through exactly the same pipeline as the training data (detrending with transits
masked, folding, 2001/201-bin views, quality gates). The other known signals of the star are also
masked from the trend fit.

## Outputs, per model
| Field | Meaning |
|---|---|
| **Probability** | calibrated probability of class 1 (planet-like): prior correction plus temperature fitted on validation |
| **Raw probability** | uncalibrated network output (for reference) |
| **Predicted label** | planet-like if the probability ≥ the model's threshold (F1-optimal on validation, or 0.5 if you chose that in Settings) |
| **Uncertainty** | ensemble spread, Monte-Carlo dropout or tree spread (see [Models](models.md)); logistic regression has none |
| **Member probabilities** | individual scores of ensemble members |
| **Seen in split** | whether this **star** was in the model's training, validation or test split (splits are by star) |
| **Inference time** | milliseconds for this prediction |
| **Fixture model** | true only for test models trained on synthetic data; never used for real results |

Beside the scores, the page shows NASA's own labels for the signal (DR24 Autovetter label, KOI
disposition, category, label conflict), the model input views, the ephemeris used and the data-quality
report.

## Warnings you may see
| Warning | What it means |
|---|---|
| *was in the TRAINING set* | The model has seen this star, so the score is not an unbiased test. Use a star from the test split or an uncatalogued signal. |
| *was in the VALIDATION set* | The star influenced early stopping, the threshold and calibration, so the score is not fully independent. |
| *Data-quality grade C/D* | Misalignment, depth mismatch, no clear dip, too few transits or sparse views. Treat the score with caution. |
| *NASA labels disagree* | DR24 Autovetter and the KOI disposition conflict for this signal. |
| *Ephemeris from a BLS search* | Check that the period is not an alias or another planet of the same star. |
| *not Kepler long cadence / out of distribution* | Uploaded data with a different cadence, mission or time span. The models were trained only on Kepler 29.4-min data. |
| *TEST FIXTURE* | The model was trained on synthetic data for testing; its scores are meaningless. |

A result is shown as **Uncertain** when the uncertainty band crosses the decision threshold or the
quality grade is D.

## Unscorable signals
If the views have empty bins (no data around the transit, for example a single transit inside a data
gap), the signal cannot be scored and the app says so (`unscorable_signal`). It never fills the gap
with an invented score.

## Candidate Explorer and batch scoring
**Candidate Explorer** scores NASA's unconfirmed KOI candidates in bulk (a background job) and ranks
them by mean probability, agreement between models, uncertainty and data quality. These rankings are
**leads for follow-up**, nothing more: candidates were never used for training, and later NASA
dispositions may disagree with any model.

## Prediction history
Every prediction is stored with its model, input, ephemeris, quality and scores (including its input
views), so you can revisit or compare it later on the **Prediction History** page.
