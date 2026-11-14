"""Synthetic transit injection (for tests and the clearly labelled injection-recovery tool only).

Injected light curves are **synthetic** and are always marked ``meta["synthetic"] = True`` with the
injected parameters appended to ``meta["injections"]``, so they can never be mistaken for real
observations downstream.

The transit is multiplicative: ``flux_new = flux * (1 - depth * shape(phase))`` where ``shape`` is
the trapezoid profile of :func:`exofinder.astro.transit_fit.trapezoid_shape`. Multiplying (rather than
subtracting) is physically correct: the planet blocks a fraction of the star's light, whatever the
star's instantaneous brightness, so stellar variability and quarter-to-quarter flux levels are
preserved.
"""

from __future__ import annotations

import math

import numpy as np

from .fold import phase_fold
from .transit_fit import trapezoid_shape
from .types import LightCurve


def inject_transit(
    lc: LightCurve,
    period: float,
    epoch: float,
    duration_hours: float,
    depth_ppm: float,
    ingress_fraction: float = 0.1,
    exposure_days: float | None = None,
) -> LightCurve:
    """Return a copy of ``lc`` with a trapezoid transit injected (``meta["synthetic"] = True``).

    ``duration_hours`` is the total duration T14, ``depth_ppm`` the flat-bottom depth and
    ``ingress_fraction`` the ingress duration as a fraction of T14 (0 < f <= 0.5; 0.5 is a V shape).
    If ``exposure_days`` is given the profile is averaged over the exposure (like real integrations).
    """
    if not (math.isfinite(period) and period > 0):
        raise ValueError("period must be positive")
    if not math.isfinite(epoch):
        raise ValueError("epoch must be finite")  # a NaN epoch would silently turn every flux into NaN
    if exposure_days is not None and not (math.isfinite(exposure_days) and exposure_days >= 0):
        raise ValueError("exposure_days must be a non-negative number of days")
    if not (math.isfinite(duration_hours) and 0 < duration_hours / 24.0 < period):
        raise ValueError("duration must be positive and shorter than the period")
    if not (math.isfinite(depth_ppm) and 0 <= depth_ppm < 1e6):
        raise ValueError("depth_ppm must be in [0, 1e6)")
    if not 0 < ingress_fraction <= 0.5:
        raise ValueError("ingress_fraction must be in (0, 0.5]")
    dur = duration_hours / 24.0
    ingress = ingress_fraction * dur
    phase = phase_fold(lc.time, period, epoch)
    if exposure_days:
        n_sub = 7
        offsets = ((np.arange(n_sub) + 0.5) / n_sub - 0.5) * float(exposure_days)
        shape = np.mean([trapezoid_shape(phase + o, dur, ingress) for o in offsets], axis=0)
    else:
        shape = trapezoid_shape(phase, dur, ingress)
    out = lc.copy()
    out.flux = lc.flux * (1.0 - depth_ppm * 1e-6 * shape)
    out.meta = dict(lc.meta)
    out.meta["synthetic"] = True
    injections = list(out.meta.get("injections", []))
    injections.append(
        {
            "period_days": float(period),
            "epoch": float(epoch),
            "duration_hours": float(duration_hours),
            "depth_ppm": float(depth_ppm),
            "ingress_fraction": float(ingress_fraction),
            "model": "trapezoid",
        }
    )
    out.meta["injections"] = injections
    return out


__all__ = ["inject_transit"]
