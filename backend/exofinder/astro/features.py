"""Physical (hand-crafted) features of a transit-like signal, for the baseline classifiers.

Every feature is computed from the light curve and the signal's ephemeris (period, epoch and
duration, which *define* the signal; AstroNet uses them too). No catalogue-derived disposition,
score or flag (``koi_score``, ``fpflag_*``, ``koi_pdisposition`` ...) is ever used, and depths/SNR are
re-measured rather than copied from catalogues.

Features (order = :data:`FEATURE_NAMES`)
---------------------------------------
``depth_ppm``              core transit depth (diagnostics convention), ppm.
``log_depth``              log10(max(depth_ppm, 1)).
``duration_hours``         ephemeris T14, hours.
``duration_over_period``   duty cycle T14 / P.
``log_period``             log10(P / 1 d).
``snr``                    transit SNR = depth / CDPP(T14) x sqrt(N_transits).
``n_transits_observed``    transits with >= 50% in-transit coverage.
``odd_even_sigma``         |odd - even| core depth difference in sigma (EBs at half period).
``secondary_sigma``        significance of the best secondary-eclipse candidate near phase 0.5 (signed).
``secondary_depth_ratio``  secondary depth / primary depth, clipped to [-10, 10].
``shape_ratio``            trapezoid ingress / T14 (~0 box/U, 0.5 V-shaped).
``local_asymmetry``        mean |v(x) - v(-x)| of the normalised local view within |x| <= T14.
``oot_scatter_ppm``        robust per-cadence out-of-transit scatter, ppm.
``local_view_min_width``   width of the normalised local-view dip below -0.5 (half depth), in T14.
``global_secondary_min``   minimum of the normalised global view for |phase| > 2 T14 (deep -> EB-like).

The result is NaN-free: any quantity that cannot be measured (no data, failed fit, zero depth) is
filled with **0.0**; the quality report flags such signals separately.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .diagnostics import compute_diagnostics
from .types import Ephemeris, LightCurve, Views

FEATURE_NAMES: tuple[str, ...] = (
    "depth_ppm",
    "log_depth",
    "duration_hours",
    "duration_over_period",
    "log_period",
    "snr",
    "n_transits_observed",
    "odd_even_sigma",
    "secondary_sigma",
    "secondary_depth_ratio",
    "shape_ratio",
    "local_asymmetry",
    "oot_scatter_ppm",
    "local_view_min_width",
    "global_secondary_min",
)


def _num(value: Any) -> float:
    """Finite float or 0.0."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.0
    return v if math.isfinite(v) else 0.0


def _local_phase(views: Views, n: int, duration_days: float) -> np.ndarray:
    if views.local_phase is not None and len(views.local_phase) == n:
        return np.asarray(views.local_phase, dtype=np.float64)
    return np.linspace(-2.0 * duration_days, 2.0 * duration_days, n)


def _view_shape_features(views: Views, eph: Ephemeris) -> dict[str, float]:
    d = eph.duration_days
    out = {"local_asymmetry": 0.0, "local_view_min_width": 0.0, "global_secondary_min": 0.0}
    v = np.asarray(views.local_view, dtype=np.float64)
    if v.size >= 3 and np.isfinite(v).all():
        phase = _local_phase(views, v.size, d)
        mirrored = v[::-1]
        sel = np.abs(phase) <= d
        if sel.any():
            out["local_asymmetry"] = float(np.mean(np.abs(v[sel] - mirrored[sel])))
        i_min = int(np.argmin(v))
        if v[i_min] < -0.5:
            lo = i_min
            while lo > 0 and v[lo - 1] < -0.5:
                lo -= 1
            hi = i_min
            while hi < v.size - 1 and v[hi + 1] < -0.5:
                hi += 1
            spacing = float(np.median(np.diff(phase)))
            out["local_view_min_width"] = float((hi - lo + 1) * spacing / d)
    g = np.asarray(views.global_view, dtype=np.float64)
    if g.size and np.isfinite(g).all():
        gp = views.global_phase
        if gp is None or len(gp) != g.size:
            p = eph.period_days
            gp = -0.5 * p + (np.arange(g.size) + 0.5) * p / g.size
        sel = np.abs(np.asarray(gp, dtype=np.float64)) > 2.0 * d
        if sel.any():
            out["global_secondary_min"] = float(np.min(g[sel]))
    return out


def physical_features(
    flat: LightCurve,
    ephemeris: Ephemeris,
    views: Views,
    diagnostics: dict[str, Any] | None = None,
) -> dict[str, float]:
    """Compute the :data:`FEATURE_NAMES` features (dict in that order, all finite floats).

    ``diagnostics`` may pass a precomputed :func:`exofinder.astro.diagnostics.compute_diagnostics`
    result (must include ``transit_fit``) to avoid recomputation.
    """
    diag = diagnostics
    if diag is None or "transit_fit" not in diag:
        diag = compute_diagnostics(flat, ephemeris, max_events=0, include_transit_fit=True)
    p = ephemeris.period_days
    dur_h = ephemeris.duration_hours
    depth = _num(diag["snr"]["depth_ppm"])
    sec = diag["secondary"]
    sec_depth = sec.get("depth_ppm")
    ratio = 0.0
    if sec_depth is not None and depth > 0:
        ratio = float(np.clip(sec_depth / depth, -10.0, 10.0))
    values: dict[str, float] = {
        "depth_ppm": depth,
        "log_depth": math.log10(max(depth, 1.0)),
        "duration_hours": _num(dur_h),
        "duration_over_period": _num(ephemeris.duration_days / p),
        "log_period": _num(math.log10(p)),
        "snr": _num(diag["snr"]["snr"]),
        "n_transits_observed": _num(diag["transit_count"]["observed"]),
        "odd_even_sigma": _num(diag["odd_even"]["diff_sigma"]),
        "secondary_sigma": _num(sec.get("significance_sigma")),
        "secondary_depth_ratio": _num(ratio),
        "shape_ratio": _num(diag["transit_fit"].get("shape_ratio")),
        "oot_scatter_ppm": _num(diag["noise"]["oot_scatter_ppm"]),
    }
    values.update(_view_shape_features(views, ephemeris))
    return {name: _num(values[name]) for name in FEATURE_NAMES}


__all__ = ["FEATURE_NAMES", "physical_features"]
