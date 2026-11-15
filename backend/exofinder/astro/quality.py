"""Signal-level data-quality assessment.

Decides whether the views of a signal can be trusted (for training, or for showing a prediction
without caveats). Each problem is a machine-readable *issue code* plus a human-readable message.

Issue codes
-----------
Blocking (``ok = False``):

* ``too_few_transits``   fewer than 2 transits observed (>= 50% of in-transit cadences present).
* ``period_too_long``    period > half the baseline: at most one transit can be guaranteed.
* ``local_view_sparse``  > 30% of local-view bins were empty before interpolation.
* ``nan_in_views``       a view contains NaN/inf (e.g. no data in the folded window at all).

Non-blocking:

* ``low_transit_coverage`` fewer than half of the predicted transits are observed.
* ``global_view_sparse``   > 50% of global-view bins were empty before interpolation.
* ``misaligned``           the local-view dip (centre of the half-depth region around the smoothed
  minimum) is > 0.5 T14 from phase 0: the ephemeris does not line up with the dip (wrong
  epoch/period, or a different event dominates).
* ``depth_mismatch``       measured core depth / catalogue depth outside [0.33, 3].
* ``no_transit_signal``    no dip: measured depth below 1 sigma (SNR < 1, or depth <= 0).

Grades
------
``A`` no issue; ``B`` only mild issues (``low_transit_coverage``, ``global_view_sparse``);
``C`` any of ``misaligned``, ``depth_mismatch``, ``no_transit_signal`` (but nothing blocking);
``D`` any blocking issue.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .diagnostics import compute_diagnostics
from .fold import phase_fold
from .types import Ephemeris, LightCurve, QualityReport, Views

BLOCKING_ISSUES = frozenset({"too_few_transits", "local_view_sparse", "nan_in_views", "period_too_long"})
MILD_ISSUES = frozenset({"low_transit_coverage", "global_view_sparse"})
SERIOUS_ISSUES = frozenset({"misaligned", "depth_mismatch", "no_transit_signal"})

LOCAL_SPARSE_LIMIT = 0.3
GLOBAL_SPARSE_LIMIT = 0.5
MISALIGNED_LIMIT_DURATIONS = 0.5
DEPTH_RATIO_RANGE = (0.33, 3.0)
MIN_TRANSITS = 2


def _local_min_offset(views: Views, duration_days: float) -> float | None:
    """Offset of the local-view dip from phase 0, in units of T14.

    The view is smoothed over ~T14/4, then the dip location is the centre of the contiguous region
    around the minimum that lies below half of the minimum. For flat-bottomed transits this is far
    more stable than the arg-min itself, which wanders anywhere along the flat bottom with noise.
    """
    v = np.asarray(views.local_view, dtype=np.float64)
    if v.size == 0 or not np.isfinite(v).all():
        return None
    phase = views.local_phase
    if phase is None or len(phase) != v.size:
        return None
    phase = np.asarray(phase, dtype=np.float64)
    spacing = float(np.median(np.diff(phase))) if phase.size > 1 else duration_days
    width = max(1, round(0.25 * duration_days / spacing))
    if width > 1:
        kernel = np.ones(width) / width
        padded = np.pad(v, (width // 2, width - 1 - width // 2), mode="edge")
        v = np.convolve(padded, kernel, mode="valid")
    i_min = int(np.argmin(v))
    half = 0.5 * float(v[i_min])
    if not half < 0:
        return float(abs(phase[i_min]) / duration_days)
    lo, hi = i_min, i_min
    while lo > 0 and v[lo - 1] < half:
        lo -= 1
    while hi < v.size - 1 and v[hi + 1] < half:
        hi += 1
    return float(abs(0.5 * (phase[lo] + phase[hi])) / duration_days)


def assess_quality(
    flat: LightCurve,
    ephemeris: Ephemeris,
    views: Views,
    catalogue_depth_ppm: float | None = None,
    diagnostics: dict[str, Any] | None = None,
) -> QualityReport:
    """Assess whether a signal's data support a trustworthy classification.

    ``diagnostics`` may pass a precomputed :func:`exofinder.astro.diagnostics.compute_diagnostics`
    result to avoid recomputation. See the module docstring for issue codes and grades.
    """
    diag = diagnostics or compute_diagnostics(flat, ephemeris, max_events=0, include_transit_fit=False)
    expected = int(diag["transit_count"]["expected"])
    observed = int(diag["transit_count"]["observed"])
    d = ephemeris.duration_days
    p = ephemeris.period_days

    t = flat.time[np.isfinite(flat.time) & np.isfinite(flat.flux)]
    baseline = float(t.max() - t.min()) if t.size else 0.0
    in_transit_points = 0
    if t.size:
        in_transit_points = int(np.sum(np.abs(phase_fold(t, p, ephemeris.epoch)) < 0.5 * d))

    issues: list[str] = []
    messages: list[str] = []

    def add(code: str, message: str) -> None:
        issues.append(code)
        messages.append(message)

    if observed < MIN_TRANSITS:
        add("too_few_transits", f"Only {observed} transit(s) observed; at least {MIN_TRANSITS} are needed.")
    if p > 0.5 * baseline:
        add(
            "period_too_long",
            f"The period ({p:.3g} d) exceeds half of the data span ({baseline:.3g} d), so repeated "
            "transits cannot be confirmed.",
        )
    if expected > 0 and observed < 0.5 * expected:
        add("low_transit_coverage", f"Only {observed} of {expected} predicted transits have data coverage.")
    if views.local_empty_frac > LOCAL_SPARSE_LIMIT:
        add(
            "local_view_sparse",
            f"{views.local_empty_frac:.0%} of the local-view bins had no data "
            f"(limit {LOCAL_SPARSE_LIMIT:.0%}).",
        )
    if views.global_empty_frac > GLOBAL_SPARSE_LIMIT:
        add(
            "global_view_sparse",
            f"{views.global_empty_frac:.0%} of the global-view bins had no data "
            f"(limit {GLOBAL_SPARSE_LIMIT:.0%}).",
        )
    nan_views = not (np.isfinite(views.global_view).all() and np.isfinite(views.local_view).all())
    if nan_views:
        add("nan_in_views", "A view contains missing values (no data around the folded transit).")

    offset = None if nan_views else _local_min_offset(views, d)
    if offset is not None and offset > MISALIGNED_LIMIT_DURATIONS:
        add(
            "misaligned",
            f"The deepest point of the local view is {offset:.2f} transit durations from the predicted "
            "transit centre; the ephemeris may be wrong.",
        )

    depth_ppm = diag["snr"]["depth_ppm"]
    ratio = None
    has_catalogue = (
        catalogue_depth_ppm is not None and math.isfinite(catalogue_depth_ppm) and catalogue_depth_ppm > 0
    )
    if has_catalogue and depth_ppm is not None:
        ratio = float(depth_ppm / catalogue_depth_ppm)
        lo, hi = DEPTH_RATIO_RANGE
        if not lo <= ratio <= hi:
            add(
                "depth_mismatch",
                f"Measured depth ({depth_ppm:.0f} ppm) differs from the catalogue depth "
                f"({catalogue_depth_ppm:.0f} ppm) by a factor {ratio:.2f}.",
            )
    snr_val = diag["snr"]["snr"]
    if depth_ppm is None or depth_ppm <= 0 or snr_val is None or snr_val < 1.0:
        add("no_transit_signal", "No dip is detected at the predicted transit times (depth below 1 sigma).")

    blocking = [i for i in issues if i in BLOCKING_ISSUES]
    if blocking:
        grade = "D"
    elif any(i in SERIOUS_ISSUES for i in issues):
        grade = "C"
    elif issues:
        grade = "B"
    else:
        grade = "A"
    return QualityReport(
        ok=not blocking,
        grade=grade,  # type: ignore[arg-type]
        n_transits_expected=expected,
        n_transits_observed=observed,
        in_transit_points=in_transit_points,
        global_empty_frac=float(views.global_empty_frac),
        local_empty_frac=float(views.local_empty_frac),
        alignment_offset_durations=offset,
        depth_ratio_vs_catalogue=ratio,
        issues=issues,
        messages=messages,
    )


__all__ = ["BLOCKING_ISSUES", "MILD_ISSUES", "SERIOUS_ISSUES", "assess_quality"]
