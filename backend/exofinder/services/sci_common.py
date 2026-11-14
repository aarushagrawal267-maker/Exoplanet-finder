"""Small helpers shared by the science/interactive services (private module).

* JSON-friendly array conversion with display rounding (NaN/Inf -> ``None``).
* A tiny thread-safe LRU cache for expensive, deterministic results (processed light curves, BLS).
* Ephemeris validation that maps to user-facing :class:`~exofinder.services.sci_errors.ServiceError`.
* Provenance-tagged values (``{"value", "err", "unit", "provenance", "source"}``).
* Phase binning, predicted transit times and directory-size accounting.
"""

from __future__ import annotations

import math
import os
import threading
from collections import OrderedDict
from collections.abc import Callable, Hashable, Iterable
from pathlib import Path
from typing import Any, TypeVar

import numpy as np

from exofinder.astro.types import Ephemeris
from exofinder.config import PIPELINE_VERSION
from exofinder.services.sci_errors import bad_request

T = TypeVar("T")

#: Shown wherever a planet-like output is presented (UI banner text).
RESEARCH_LEAD_NOTICE = (
    "Planet-like scores are research leads for follow-up, not discoveries or confirmations: they say "
    "the folded light-curve shape resembles signals NASA vetting classified as planet candidates."
)

#: Display rounding (decimal places): time/phase in days (5 -> 0.9 s), relative flux (6 -> 1 ppm).
TIME_DIGITS = 5
FLUX_DIGITS = 6

#: Provenance source label for values measured by this application's pipeline.
MEASURED_SOURCE = f"Exoplanet Finder pipeline v{PIPELINE_VERSION}"

#: Kepler long cadence (29.4 min) in days.
KEPLER_LONG_CADENCE_DAYS = 0.0204336


# ------------------------------------------------------------------------------------------------
# arrays -> JSON
# ------------------------------------------------------------------------------------------------
def to_list(values: Any, digits: int | None = None) -> list[float | None]:
    """1-D numeric array -> list of floats rounded to ``digits`` decimals, non-finite -> ``None``."""
    a = np.asarray(values, dtype=np.float64).ravel()
    if digits is not None:
        a = np.round(a, digits)
    out = a.tolist()
    if not np.isfinite(a).all():
        out = [v if math.isfinite(v) else None for v in out]
    return out


def finite(value: Any) -> float | None:
    """``float(value)`` when finite, else ``None``."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


# ------------------------------------------------------------------------------------------------
# LRU cache
# ------------------------------------------------------------------------------------------------
class LruCache:
    """Thread-safe least-recently-used cache with a fixed number of entries.

    ``get_or_compute`` may compute the same key twice under contention (the computation runs outside
    the lock so one slow entry never blocks other keys); results are deterministic, so that is safe.
    """

    def __init__(self, max_entries: int) -> None:
        self.max_entries = int(max_entries)
        self._data: OrderedDict[Hashable, Any] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Hashable) -> Any | None:
        with self._lock:
            if key not in self._data:
                return None
            self._data.move_to_end(key)
            return self._data[key]

    def put(self, key: Hashable, value: Any) -> None:
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self.max_entries:
                self._data.popitem(last=False)

    def get_or_compute(self, key: Hashable, fn: Callable[[], T]) -> tuple[T, bool]:
        """Return ``(value, from_cache)``."""
        hit = self.get(key)
        if hit is not None:
            return hit, True
        value = fn()
        self.put(key, value)
        return value, False

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)


def file_signature(path: str | Path) -> tuple[int, int] | None:
    """``(mtime_ns, size)`` of a file, or ``None`` if it does not exist (cache-key ingredient)."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (int(st.st_mtime_ns), int(st.st_size))


# ------------------------------------------------------------------------------------------------
# Ephemerides
# ------------------------------------------------------------------------------------------------
def make_ephemeris(
    period_days: float | None,
    epoch: float | None,
    duration_hours: float | None,
    *,
    source: str = "manual",
    label: str = "Manual",
    depth_ppm: float | None = None,
) -> Ephemeris:
    """Validated :class:`Ephemeris` from user input; raises a 400 ``invalid_ephemeris`` otherwise."""
    p, t0, d = finite(period_days), finite(epoch), finite(duration_hours)
    if p is None or t0 is None or d is None:
        raise bad_request(
            "An ephemeris needs a period (days), an epoch (transit centre, same time system as the "
            "light curve) and a duration (hours).",
            "invalid_ephemeris",
            "Provide period_days, epoch and duration_hours, or run a BLS search to propose them.",
        )
    if p <= 0 or d <= 0:
        raise bad_request(
            f"Period ({p:g} d) and duration ({d:g} h) must be positive.",
            "invalid_ephemeris",
        )
    if d / 24.0 >= p:
        raise bad_request(
            f"The transit duration ({d:g} h) must be shorter than the period ({p:g} d).",
            "invalid_ephemeris",
            "Durations are in hours, periods in days.",
        )
    return Ephemeris(
        period_days=p,
        epoch=t0,
        duration_hours=d,
        depth_ppm=finite(depth_ppm),
        source=source,  # type: ignore[arg-type]
        label=label,
    )


def ephemeris_dict(eph: Ephemeris, time_system: str = "BKJD") -> dict[str, Any]:
    """JSON form of an ephemeris (+ the time system of its epoch)."""
    return {
        "period_days": float(eph.period_days),
        "epoch": float(eph.epoch),
        "duration_hours": float(eph.duration_hours),
        "depth_ppm": finite(eph.depth_ppm),
        "source": eph.source,
        "label": eph.label,
        "time_system": time_system,
    }


def ephemeris_key(eph: Ephemeris | None) -> tuple | None:
    """Hashable identity of an ephemeris (cache keys)."""
    if eph is None:
        return None
    return (
        round(float(eph.period_days), 9),
        round(float(eph.epoch), 7),
        round(float(eph.duration_hours), 6),
        eph.source,
        eph.label,
    )


def predicted_transit_times(t_min: float, t_max: float, eph: Ephemeris, cap: int = 5000) -> list[float]:
    """Transit centres ``epoch + n * P`` inside ``[t_min, t_max]`` (at most ``cap``)."""
    if not (math.isfinite(t_min) and math.isfinite(t_max)) or t_max < t_min:
        return []
    p = float(eph.period_days)
    n0 = math.ceil((t_min - eph.epoch) / p)
    n1 = math.floor((t_max - eph.epoch) / p)
    if n1 < n0:
        return []
    n1 = min(n1, n0 + cap - 1)
    return [float(eph.epoch + n * p) for n in range(n0, n1 + 1)]


# ------------------------------------------------------------------------------------------------
# Provenance
# ------------------------------------------------------------------------------------------------
def pv(
    value: Any,
    unit: str,
    provenance: str,
    source: str = "",
    err: Any = None,
    **extra: Any,
) -> dict[str, Any]:
    """A provenance-tagged scientific value (``ProvenancedValue`` shape, plus optional extra keys)."""
    out = {
        "value": finite(value),
        "err": finite(err),
        "unit": unit,
        "provenance": provenance,
        "source": source,
    }
    out.update(extra)
    return out


# ------------------------------------------------------------------------------------------------
# Phase binning
# ------------------------------------------------------------------------------------------------
def binned_median(
    phase: np.ndarray, flux: np.ndarray, lo: float, hi: float, n_bins: int
) -> tuple[np.ndarray, np.ndarray]:
    """Median flux in ``n_bins`` equal bins of ``phase`` over ``[lo, hi)``; empty bins are dropped."""
    x = np.asarray(phase, dtype=np.float64)
    y = np.asarray(flux, dtype=np.float64)
    ok = np.isfinite(x) & np.isfinite(y) & (x >= lo) & (x < hi)
    x, y = x[ok], y[ok]
    if x.size == 0 or not hi > lo or n_bins < 1:
        return np.zeros(0), np.zeros(0)
    width = (hi - lo) / n_bins
    idx = np.minimum(((x - lo) / width).astype(np.int64), n_bins - 1)
    order = np.argsort(idx, kind="stable")
    idx, y = idx[order], y[order]
    bounds = np.searchsorted(idx, np.arange(n_bins + 1))
    centres, meds = [], []
    for b in range(n_bins):
        s, e = bounds[b], bounds[b + 1]
        if e > s:
            centres.append(lo + (b + 0.5) * width)
            meds.append(float(np.median(y[s:e])))
    return np.asarray(centres), np.asarray(meds)


def transit_window(eph: Ephemeris, n_durations: float = 3.0) -> float:
    """Half-width (days) of a zoom window around the transit: ``n_durations * T14``, at most P/2."""
    return float(min(0.5 * eph.period_days, n_durations * eph.duration_days))


# ------------------------------------------------------------------------------------------------
# Disk usage
# ------------------------------------------------------------------------------------------------
def dir_usage(path: str | Path) -> tuple[int, int]:
    """``(total bytes, number of files)`` below ``path`` (0, 0 if it does not exist)."""
    total, n = 0, 0
    stack = [str(path)]
    while stack:
        current = stack.pop()
        try:
            with os.scandir(current) as it:
                for entry in it:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        elif entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                            n += 1
                    except OSError:
                        continue
        except OSError:
            continue
    return total, n


def files_usage(paths: Iterable[str | Path]) -> tuple[int, int]:
    """``(total bytes, number of existing files)`` of individual files."""
    total, n = 0, 0
    for p in paths:
        try:
            total += os.stat(p).st_size
            n += 1
        except OSError:
            continue
    return total, n
