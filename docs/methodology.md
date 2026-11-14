# Research methodology

Exoplanet Finder classifies **transit-like signals** found in NASA Kepler photometry as either
**planet-like (class 1)** or **false-positive-like (class 0)**. This page explains the science and
the research protocol the application follows. A planet-like score is a *research lead*, never a
confirmed discovery.

## 1. The transit method

When a planet crosses the disc of its host star (a *transit*), it blocks a small fraction of the
starlight. To first order the fractional dip in brightness is

$$\delta \approx \left(\frac{R_p}{R_\star}\right)^2,$$

so an Earth-size planet around a Sun-like star produces a dip of about 84 parts per million (ppm),
and a Jupiter about 1 %. The dip repeats every orbital period $P$ and lasts a few hours. Its total
duration $T_{14}$ (first to fourth contact) depends on the period, the stellar density and the
impact parameter.

A transit's **shape** carries information:

* **Ingress/egress**: the planet's disc takes time to fully cover the stellar limb. Small planets
  give short ingress and a flat-bottomed ("U-shaped") dip, darkened at the edges by limb darkening.
* **Grazing and stellar eclipses** tend to look **V-shaped**.
* **Eclipsing binaries** often show a **secondary eclipse** near phase 0.5 and **odd/even depth
  differences** (the two stars have different surface brightness).

## 2. Why detection and vetting are hard

| Challenge | Effect |
|---|---|
| Photon and instrument noise | Shallow transits can be at or below the per-point noise |
| Stellar variability (spots, rotation, granulation, pulsation, flares) | Trends and dips larger than the transit itself |
| Spacecraft systematics (quarterly rolls, thermal settling, pointing jitter, momentum dumps, cosmic rays) | Spurious dips and discontinuities |
| Data gaps | Missed transits; partial events |
| Astrophysical false positives (eclipsing binaries, background blends, hierarchical triples) | Transit-like signals that are not planets |
| Detrending | Can erase or distort a real transit if not done carefully |
| Label uncertainty | Catalogue dispositions evolve; "candidate" ≠ "planet" |

The Kepler pipeline produced tens of thousands of **Threshold Crossing Events (TCEs)**: periodic
signals above a detection threshold. Most are not planets. Separating them is the vetting problem.

## 3. Why machine learning helps

Human vetters look at **phase-folded light curves**: all transits stacked using the period, so the
repeated signal emerges from the noise. Much of their judgement is about *shape*. Deep 1D
convolutional networks can learn the same visual cues directly from binned, folded light curves.

Shallue & Vanderburg (2018, *AJ* 155, 94) showed that a **two-view** CNN works especially well:

* a **global view**: the whole orbit folded into 2001 bins, which shows secondary eclipses,
  out-of-transit variability and the overall context;
* a **local view**: a zoom of ±2 transit durations in 201 bins, which shows the detailed transit
  shape.

Their model (AstroNet) was trained on Kepler DR24 Autovetter labels and was used to discover
Kepler-90 i and Kepler-80 g. Exoplanet Finder reproduces this approach from scratch on locally
downloaded data and compares it with simpler baselines.

## 4. Research protocol in this application

1. **Data provenance.** Labels and ephemerides are retrieved from the NASA Exoplanet Archive
   (snapshots stored verbatim with timestamp, exact query and SHA-256). Light curves come from
   NASA MAST (Kepler long-cadence PDCSAP flux). See [Data sources](data-sources.md).
2. **Labels.** The default label set is the DR24 Autovetter training set (PC → 1; AFP and NTP → 0;
   UNK excluded). An alternative mode uses KOI dispositions (CONFIRMED → 1; FALSE POSITIVE → 0;
   CANDIDATE excluded). Signals where the two sources disagree are flagged as *label conflicts*.
3. **Preprocessing.** Every signal passes through one versioned pipeline: quality-flag filtering,
   per-quarter normalisation, robust spline detrending **with in-transit cadences masked**,
   upward-only outlier clipping, phase folding, and global/local view generation.
4. **Quality gates.** Signals with fewer than two observed transits, sparse views, misalignment or
   NaNs are excluded, and every exclusion is counted by reason.
5. **Leakage control.** Train/validation/test splits are made **by star** (all signals of a star go
   to the same split), stratified by class and fixed at dataset creation. Catalogue-derived scores
   (e.g. `koi_score`) are never used as features. Famous systems (e.g. Kepler-90) are reserved for
   the test set so demonstrations are genuinely unseen.
6. **Models.** Logistic regression and random forest (on light-curve-derived features and
   downsampled views), a single-view CNN (global view only) and a two-view CNN (AstroNet-style),
   all trained on identical splits.
7. **Model selection** uses only the validation set: early stopping on validation PR-AUC, the
   decision threshold (F1-optimal on validation), and temperature-scaling calibration.
8. **Final evaluation** happens once per model on the held-out test set: accuracy, precision,
   recall/sensitivity, specificity, F1, ROC-AUC, PR-AUC, confusion matrix, Brier score, expected
   calibration error, reliability diagram, inference time, and 95 % bootstrap confidence
   intervals. Test-set evaluations are logged.
9. **Interpretation.** Each prediction reports a calibrated probability, an uncertainty estimate
   (ensemble spread or Monte-Carlo dropout), data quality, whether the target was seen during
   training, and NASA's own classification beside it.

## 5. What a "planet-like" score does and does not mean

It means the folded light-curve shape resembles signals that NASA vetting classified as planet
candidates, given this model and this data. It does **not** rule out background eclipsing binaries
(which need centroid analysis), it does not measure mass (which needs radial velocities), and it is
not a statistical validation. Treat high scores as **leads for follow-up**.

## References

* Shallue, C. J. & Vanderburg, A. (2018). *Identifying Exoplanets with Deep Learning: A Five-planet
  Resonant Chain around Kepler-80 and an Eighth Planet around Kepler-90.* AJ 155, 94.
* Coughlin, J. L. et al. (2016). *Planetary Candidates Observed by Kepler. VII. The First Fully
  Uniform Catalog Based on the Entire 48-month Data Set (Q1–Q17 DR24).* ApJS 224, 12.
* Catanzarite, J. H. (2015). *Autovetter Planet Candidate Catalog for Q1–Q17 Data Release 24.*
  KSCI-19090-001.
* Thompson, S. E. et al. (2018). *Planetary Candidates Observed by Kepler. VIII. A Fully Automated
  Catalog with Measured Completeness and Reliability Based on Data Release 25.* ApJS 235, 38.
* Kovács, G., Zucker, S. & Mazeh, T. (2002). *A box-fitting algorithm in the search for periodic
  transits.* A&A 391, 369.
* Lightkurve Collaboration (2018). *Lightkurve: Kepler and TESS time series analysis in Python.*
  ASCL 1812.013.
