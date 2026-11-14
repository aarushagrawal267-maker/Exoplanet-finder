# Light-curve processing pipeline

Every signal, whether from the catalogue, a dataset build, or one of your uploads, passes through the
same versioned pipeline (`exofinder.astro`, pipeline version **1.0**). The version and the full
configuration are stored with every processed signal, dataset and model. A model refuses inputs
processed with a different pipeline version.

## 1. Reading the data
* **Kepler FITS** (`astro.io_fits`): `TIME` (BKJD = BJD − 2 454 833), `PDCSAP_FLUX`, `PDCSAP_FLUX_ERR`
  and `SAP_QUALITY` from the `LIGHTCURVE` extension. Truncated or corrupt files are rejected with a
  clear message, and gzip-compressed files are accepted. K2 and TESS files (TESS time is BTJD =
  BJD − 2 457 000) can be read, but they are out of distribution for the models, and the app warns
  you.
* **CSV / text uploads** (`astro.io_csv`): time, flux, optional error and quality columns are
  detected from their names. You can override the mapping. At least 100 valid rows are required.
* **Stitching** (`astro.normalize.stitch`): quarters are normalised separately (divided by their
  median) and joined. Each quarter becomes a *segment*, so detrending never fits across a quarter
  boundary.

## 2. Cleaning
* Cadences flagged by the default Kepler quality bitmask (value 1130799, the same as Lightkurve's
  `default`: attitude tweaks, safe modes, coarse pointing, desaturation events, argabrightening and
  similar spacecraft events) are removed, together with non-finite values. Every removal is counted
  by reason.
* Gaps longer than **0.75 days** split a segment, so the trend is never interpolated across a gap.

## 3. Detrending (transits protected)
Stellar variability and instrumental drifts are removed by dividing by a smooth trend:

* **Robust cubic spline** (default): least-squares B-spline per segment, with knot spacing chosen by
  the Bayesian Information Criterion between max(0.5 d, 3 × T14) and 20 d. Iterative 3σ clipping inside
  the fit ignores flares and residual outliers.
* **Savitzky–Golay** (option): a sliding polynomial filter with the same masking.
* **Transit masking:** when the ephemeris is known, every cadence within 1.5 × T14 of a transit centre
  of this signal **and of the other known signals on the same star** is excluded from the trend fit,
  so the trend cannot absorb the transit. On synthetic tests with identical noise, the masked
  pipeline preserves the injected depth; without masking, 3–7 % of a transit's depth is lost.
* For uploads with no ephemeris (before BLS), nothing can be masked. The robust clipping still
  rejects most in-transit points of deep transits.

## 4. Outlier removal
Upward outliers (above 3σ, using a median-absolute-deviation estimate) are removed from the flattened
light curve. **Downward points are never clipped**, because transits are downward.

## 5. Phase folding and views
Time is folded on the period, with the transit centre at phase 0 (phase in days in [−P/2, P/2)).

| View | Bins | Span | Bin width | Purpose |
|---|---|---|---|---|
| **Global** | 2001 | the whole orbit | P / 2001 | secondary eclipses, out-of-transit variability, context |
| **Local** | 201 | ±2 transit durations | 0.16 × T14 (bins overlap) | detailed transit shape (U vs V, ingress/egress) |

Each bin is the **median** of its points. Empty bins are filled by interpolation, and the fraction of
empty bins is recorded. Each view is then normalised to **median 0 and minimum −1**, following
Shallue & Vanderburg (2018). The original depth is kept separately.

## 6. Diagnostics (measured from the light curve)
* **BLS** (`astro.bls`): Box Least Squares period search (astropy) over a grid that takes the duty cycle
  into account, with refinement of the strongest peaks. Used for uploads and to check ephemerides.
* **Trapezoid transit fit** (`astro.transit_fit`): depth, total duration, ingress/egress shape ratio and
  epoch with uncertainties, supersampled over the 29.4-min exposure.
* **SNR**: core depth divided by the combined differential photometric precision at the transit
  duration, × √N transits, with a red-noise factor.
* **Odd/even test**: depths of odd and even transits compared (a significant difference suggests an
  eclipsing binary at twice the period).
* **Secondary eclipse search** near phase 0.5.
* **Individual transits**: depth and coverage of each event.

## 7. Quality gates
Each processed signal gets a quality report with machine-readable **issue codes** and a **grade**:

| Code | Meaning | Blocking? |
|---|---|---|
| `too_few_transits` | fewer than 2 transits observed (≥ 50 % in-transit coverage) | yes |
| `period_too_long` | period longer than half the observing baseline | yes |
| `local_view_sparse` | more than 30 % of local-view bins empty | yes |
| `nan_in_views` | a view contains NaN or infinity | yes |
| `low_transit_coverage` | fewer than half of the predicted transits observed | no (grade B) |
| `global_view_sparse` | more than 50 % of global-view bins empty | no (grade B) |
| `misaligned` | the dip is more than 0.5 T14 from phase 0 | no (grade C) |
| `depth_mismatch` | measured depth / catalogue depth outside [0.33, 3] | no (grade C) |
| `no_transit_signal` | no measurable dip (SNR < 1) | no (grade C) |

**Grades:** A = no issue; B = mild issues only; C = misaligned, depth mismatch or no signal; D = any
blocking issue.

Only **blocking** issues exclude a signal from a dataset, and every exclusion is counted by reason.
Grade C signals are kept on purpose. Many genuine false positives (for example "not transit-like"
NTP signals) have no clean dip, and dropping them would remove exactly the cases the model must learn
to reject. In predictions, grade C and D results are flagged as unreliable.

## 8. Physical features (for the baseline models)
Fifteen features are measured from the processed light curve only: depth, log depth, duration,
duration/period, log period, SNR, number of observed transits, odd/even significance, secondary
significance, secondary depth ratio, trapezoid shape ratio, local-view asymmetry, out-of-transit
scatter, local-view minimum width and global-view secondary minimum. **Catalogue-derived scores
(e.g. `koi_score`, disposition scores) are never used as features.** The ML layer enforces this with
an explicit check.

## Verification on real data
Kepler-2 (KIC 10666592, Q2+Q3, catalogue ephemeris): grade A, 78 of 82 predicted transits observed,
measured core depth 6 529 ppm vs catalogue 6 675 ppm, odd/even difference 0.47σ, blind BLS period
2.204886 d vs catalogue 2.204735 d (6.8 × 10⁻⁵ relative error). These values come from the
pipeline's own tests on real NASA FITS files in `backend/tests/fixtures/`.
