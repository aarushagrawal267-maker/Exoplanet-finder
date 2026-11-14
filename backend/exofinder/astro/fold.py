"""Phase folding.

Convention used throughout :mod:`exofinder.astro`
------------------------------------------------
* ``phase`` is measured in **days** (not in units of the period) relative to the nearest transit
  centre, and lies in ``[-P/2, P/2)``. A transit centre is at phase 0; negative phases are before
  mid-transit (ingress side), positive phases after it (egress side).
* ``epoch`` is the time of *a* transit centre, in the same time system as the light curve (BKJD
  for Kepler). Any transit centre works: phases do not depend on which one is given.
* The transit number ``n`` of a cadence is the integer such that ``time = epoch + n*P + phase``;
  it is used to separate odd and even transits.

All arithmetic is float64: at Kepler times (~1500 d) this leaves sub-millisecond precision.
"""

from __future__ import annotations

import math

import numpy as np


def _check_period(period: float) -> float:
    p = float(period)
    if not (math.isfinite(p) and p > 0):
        raise ValueError(f"period must be a positive finite number of days (got {period!r})")
    return p


def phase_fold(time: np.ndarray, period: float, epoch: float) -> np.ndarray:
    """Return the orbital phase of each time stamp in days, in ``[-P/2, P/2)``, transit at 0.

    ``phase = ((time - epoch + P/2) mod P) - P/2``. Non-finite times give NaN phases.
    """
    p = _check_period(period)
    t = np.asarray(time, dtype=np.float64)
    half = 0.5 * p
    phase = np.mod(t - float(epoch) + half, p) - half
    # np.mod can round a tiny negative argument up to exactly P, which would give +P/2.
    phase = np.where(phase >= half, phase - p, phase)
    return phase


def transit_number(time: np.ndarray, period: float, epoch: float) -> np.ndarray:
    """Integer transit number ``n`` of the transit nearest to each time (``epoch`` has ``n = 0``).

    Consistent with :func:`phase_fold`: ``time = epoch + n*P + phase``. Non-finite times map to a
    large negative sentinel (``np.iinfo(int64).min``) so they never match a real transit.
    """
    p = _check_period(period)
    t = np.asarray(time, dtype=np.float64)
    x = np.floor((t - float(epoch)) / p + 0.5)
    out = np.full(t.shape, np.iinfo(np.int64).min, dtype=np.int64)
    ok = np.isfinite(x)
    out[ok] = x[ok].astype(np.int64)
    return out


__all__ = ["phase_fold", "transit_number"]
