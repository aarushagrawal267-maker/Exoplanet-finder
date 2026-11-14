"""In-transit cadence masks.

Masking the transits out of the trend fit is what keeps detrending from "eating" the transit: the
trend is fitted to out-of-transit data only and then interpolated across the transit.

Convention
----------
A cadence is *in transit* when ``|phase| < width_factor * duration / 2`` where ``phase`` is the
folded time in days (see :mod:`exofinder.astro.fold`) and ``duration`` is the total transit duration
T14 (first to fourth contact) in days. With the default ``width_factor = 1.5`` the mask is 1.5 x T14
wide, i.e. it extends a quarter of a transit duration beyond ingress and egress, which absorbs small
ephemeris errors and the smearing of the 29.4-minute Kepler long-cadence integrations.
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np

from .fold import phase_fold
from .types import Ephemeris


def transit_mask(
    time: np.ndarray,
    period: float,
    epoch: float,
    duration_days: float,
    width_factor: float = 1.5,
) -> np.ndarray:
    """Boolean array, True for cadences with ``|phase| < width_factor * duration_days / 2``."""
    if not duration_days > 0:
        raise ValueError(f"duration_days must be positive (got {duration_days!r})")
    if not width_factor > 0:
        raise ValueError(f"width_factor must be positive (got {width_factor!r})")
    phase = phase_fold(time, period, epoch)
    with np.errstate(invalid="ignore"):
        return np.abs(phase) < 0.5 * float(width_factor) * float(duration_days)


def combined_transit_mask(
    time: np.ndarray, ephemerides: Iterable[Ephemeris], width_factor: float = 1.5
) -> np.ndarray:
    """Union of :func:`transit_mask` over several ephemerides (e.g. all known planets of a star)."""
    t = np.asarray(time, dtype=np.float64)
    mask = np.zeros(t.shape, dtype=bool)
    for eph in ephemerides:
        mask |= transit_mask(t, eph.period_days, eph.epoch, eph.duration_days, width_factor)
    return mask


__all__ = ["combined_transit_mask", "transit_mask"]
