"""Small numerical helpers shared by the astronomy modules (private)."""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .types import Ephemeris

#: Scale factor turning a median absolute deviation into a Gaussian-equivalent standard deviation.
MAD_TO_SIGMA = 1.482602218505602


def mad_std(values: np.ndarray) -> float:
    """Robust standard deviation (1.4826 x median absolute deviation) of the finite values.

    Returns NaN for an empty input. Insensitive to the transit points and outliers that would
    inflate an ordinary standard deviation.
    """
    x = np.asarray(values, dtype=np.float64)
    x = x[np.isfinite(x)]
    if x.size == 0:
        return float("nan")
    med = np.median(x)
    return float(MAD_TO_SIGMA * np.median(np.abs(x - med)))


def median_cadence(time: np.ndarray) -> float:
    """Median positive spacing between consecutive (sorted) finite time stamps, in days (NaN if <2)."""
    t = np.asarray(time, dtype=np.float64)
    t = np.sort(t[np.isfinite(t)])
    if t.size < 2:
        return float("nan")
    d = np.diff(t)
    d = d[d > 0]
    return float(np.median(d)) if d.size else float("nan")


def bin_by_time(
    time: np.ndarray, flux: np.ndarray, bin_width: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Average ``flux`` in contiguous time bins of ``bin_width`` days.

    Returns ``(mean_time, mean_flux, counts)`` for the non-empty bins only, ordered in time. The
    returned time is the mean time of the points in each bin (not the bin centre), which preserves
    timing precision for sparse bins.
    """
    t = np.asarray(time, dtype=np.float64)
    f = np.asarray(flux, dtype=np.float64)
    if t.size == 0:
        return t.copy(), f.copy(), np.zeros(0, dtype=np.int64)
    idx = np.floor((t - t.min()) / bin_width).astype(np.int64)
    counts = np.bincount(idx)
    sum_t = np.bincount(idx, weights=t)
    sum_f = np.bincount(idx, weights=f)
    keep = counts > 0
    counts = counts[keep]
    return sum_t[keep] / counts, sum_f[keep] / counts, counts.astype(np.int64)


def downsample_xy(x: np.ndarray, y: np.ndarray, max_points: int) -> tuple[np.ndarray, np.ndarray]:
    """Reduce an (x, y) series to at most ``max_points`` points for display.

    Points are averaged in equal-width bins of ``x`` (empty bins are dropped), so short features
    such as transits are smoothed rather than skipped as plain decimation would. Series that already
    fit are returned (as copies) unchanged, sorted by ``x``.
    """
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    ok = np.isfinite(x) & np.isfinite(y)
    x, y = x[ok], y[ok]
    order = np.argsort(x, kind="stable")
    x, y = x[order], y[order]
    if x.size <= max_points or x.size == 0:
        return x.copy(), y.copy()
    span = x[-1] - x[0]
    if span <= 0:
        return x[:max_points].copy(), y[:max_points].copy()
    width = span / max_points * (1.0 + 1e-9)
    xb, yb, _ = bin_by_time(x, y, width)
    return xb, yb


def validate_ephemeris(ephemeris: Ephemeris) -> None:
    """Raise ``ValueError`` if the ephemeris cannot be used to fold a light curve."""
    p = float(ephemeris.period_days)
    e = float(ephemeris.epoch)
    d = float(ephemeris.duration_hours)
    if not (math.isfinite(p) and p > 0):
        raise ValueError(f"Ephemeris period must be a positive number of days (got {p!r}).")
    if not math.isfinite(e):
        raise ValueError(f"Ephemeris epoch must be finite (got {e!r}).")
    if not (math.isfinite(d) and d > 0):
        raise ValueError(f"Ephemeris duration must be a positive number of hours (got {d!r}).")
    if d / 24.0 >= p:
        raise ValueError(f"Transit duration ({d:.3g} h) must be shorter than the orbital period ({p:.4g} d).")


def to_builtin(value: Any) -> Any:
    """Convert numpy scalars (recursively inside dicts/lists) to plain Python types for JSON."""
    if isinstance(value, dict):
        return {str(k): to_builtin(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_builtin(v) for v in value]
    if isinstance(value, np.generic):
        return value.item()
    return value


def finite_or_none(value: float | None) -> float | None:
    """``float(value)`` if finite, else ``None`` (JSON-friendly representation of 'undefined')."""
    if value is None:
        return None
    v = float(value)
    return v if math.isfinite(v) else None
