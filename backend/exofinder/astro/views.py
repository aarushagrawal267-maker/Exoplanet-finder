"""AstroNet "global" and "local" views (Shallue & Vanderburg 2018).

The flattened light curve is phase-folded and median-binned into fixed-length 1-D arrays that a CNN
can read:

* **Global view** - the whole orbit, ``[-P/2, P/2)``, in ``GLOBAL_VIEW_BINS`` (2001) contiguous bins
  of width P/2001. It shows secondary eclipses, phase variations and out-of-transit behaviour.
* **Local view** - a zoom on the transit spanning ``num_durations`` (4) transit durations in total,
  i.e. **+/-2 T14** around the centre (note: AstroNet's code spans +/-4 T14 with its
  ``num_durations=4``; this project defines ``num_durations`` as the *total* width, see
  ``LOCAL_VIEW_NUM_DURATIONS`` in :mod:`exofinder.config`), in ``LOCAL_VIEW_BINS`` (201) bins. As in
  AstroNet, local bins are 0.16 T14 wide and overlap (bin spacing 4 T14 / 200 = 0.02 T14), which
  keeps bins populated when only a few transits were observed.

Each bin holds the **median** flux of the cadences falling in it (robust to residual outliers).
Bins with no data are filled by linear interpolation between the nearest non-empty bins (periodic
interpolation for the global view, edge values held for the local view); the fraction of empty bins
is returned so that quality control can reject poorly covered signals.

Normalisation (:func:`normalize_view`): subtract the median and divide by the absolute value of the
minimum, so the baseline is ~0 and the transit bottom is -1. ``Views.raw_depth`` keeps the depth
before normalisation (as a fraction).
"""

from __future__ import annotations

import numpy as np

from ..config import GLOBAL_VIEW_BINS, LOCAL_VIEW_BINS, LOCAL_VIEW_NUM_DURATIONS
from ._utils import validate_ephemeris
from .fold import phase_fold
from .types import Ephemeris, LightCurve, Views

#: AstroNet local-view bin width in units of the transit duration.
LOCAL_BIN_WIDTH_FACTOR = 0.16


def _median_bins(
    phase: np.ndarray, flux: np.ndarray, t_min: float, t_max: float, num_bins: int, bin_width: float
) -> tuple[np.ndarray, np.ndarray]:
    """Median of ``flux`` in ``num_bins`` equally spaced bins of width ``bin_width`` within [t_min, t_max].

    Bin ``i`` covers ``[t_min + i*s, t_min + i*s + bin_width)`` with ``s = (t_max - t_min - bin_width)
    / (num_bins - 1)`` (as in AstroNet's ``generate_view``). Returns (values with NaN for empty bins,
    bin centres).
    """
    if num_bins < 2:
        raise ValueError("num_bins must be >= 2")
    span = t_max - t_min
    if not bin_width > 0 or bin_width >= span:
        bin_width = span / num_bins
    spacing = (span - bin_width) / (num_bins - 1)
    lo = t_min + spacing * np.arange(num_bins)
    centres = lo + 0.5 * bin_width
    order = np.argsort(phase, kind="stable")
    xs, ys = phase[order], flux[order]
    i0 = np.searchsorted(xs, lo, side="left")
    i1 = np.searchsorted(xs, lo + bin_width, side="left")
    out = np.full(num_bins, np.nan)
    for i in np.nonzero(i1 > i0)[0]:
        out[i] = np.median(ys[i0[i] : i1[i]])
    return out, centres


def _fill_empty(values: np.ndarray, centres: np.ndarray, period: float | None) -> tuple[np.ndarray, float]:
    """Linearly interpolate NaN bins; returns (filled, empty_fraction). All-empty stays all-NaN."""
    empty = ~np.isfinite(values)
    frac = float(empty.mean())
    if not empty.any() or empty.all():
        return values.copy(), frac
    good = ~empty
    filled = values.copy()
    if period is not None:
        filled[empty] = np.interp(centres[empty], centres[good], values[good], period=period)
    else:
        filled[empty] = np.interp(centres[empty], centres[good], values[good])
    return filled, frac


def _prepare(
    time: np.ndarray, flux: np.ndarray, period: float, epoch: float
) -> tuple[np.ndarray, np.ndarray]:
    t = np.asarray(time, dtype=np.float64)
    f = np.asarray(flux, dtype=np.float64)
    if t.shape != f.shape:
        raise ValueError("time and flux must have the same shape")
    ok = np.isfinite(t) & np.isfinite(f)
    return phase_fold(t[ok], period, epoch), f[ok]


def global_view(
    time: np.ndarray, flux: np.ndarray, period: float, epoch: float, num_bins: int = GLOBAL_VIEW_BINS
) -> tuple[np.ndarray, np.ndarray, float]:
    """Median-binned flux over the full orbit; returns ``(binned_flux, bin_centres_days, empty_frac)``.

    ``num_bins`` contiguous bins of width P/num_bins over ``[-P/2, P/2)``; the middle bin is centred on
    the transit (phase 0). Empty bins are filled by periodic linear interpolation.
    """
    phase, f = _prepare(time, flux, period, epoch)
    p = float(period)
    vals, centres = _median_bins(phase, f, -0.5 * p, 0.5 * p, num_bins, p / num_bins)
    filled, frac = _fill_empty(vals, centres, p)
    return filled, centres, frac


def local_view(
    time: np.ndarray,
    flux: np.ndarray,
    period: float,
    epoch: float,
    duration_days: float,
    num_bins: int = LOCAL_VIEW_BINS,
    num_durations: float = LOCAL_VIEW_NUM_DURATIONS,
    bin_width_factor: float = LOCAL_BIN_WIDTH_FACTOR,
) -> tuple[np.ndarray, np.ndarray, float]:
    """Median-binned flux around the transit; returns ``(binned_flux, bin_centres_days, empty_frac)``.

    Spans ``+/- num_durations/2 * duration_days`` (clipped to +/-P/2) with ``num_bins`` bins of width
    ``bin_width_factor * duration_days``. Empty bins are filled by linear interpolation (edge values
    are held constant beyond the first/last non-empty bin).
    """
    if not duration_days > 0:
        raise ValueError("duration_days must be positive")
    phase, f = _prepare(time, flux, period, epoch)
    half = min(0.5 * float(period), 0.5 * float(num_durations) * float(duration_days))
    vals, centres = _median_bins(phase, f, -half, half, num_bins, bin_width_factor * float(duration_days))
    filled, frac = _fill_empty(vals, centres, None)
    return filled, centres, frac


def normalize_view(view: np.ndarray) -> np.ndarray:
    """Subtract the median and divide by ``|min|`` so the baseline is ~0 and the minimum is -1.

    If the view is flat (``min == median``) only the median is subtracted (no division by zero).
    NaN entries propagate (an all-NaN view stays all-NaN).
    """
    v = np.asarray(view, dtype=np.float64)
    finite = np.isfinite(v)
    if not finite.any():
        return v.copy()
    centred = v - np.median(v[finite])
    scale = abs(float(np.min(centred[finite])))
    if not np.isfinite(scale) or scale <= 1e-12:
        return centred
    return centred / scale


def make_views(
    flat_lc: LightCurve,
    ephemeris: Ephemeris,
    num_global_bins: int = GLOBAL_VIEW_BINS,
    num_local_bins: int = LOCAL_VIEW_BINS,
    num_durations: float = LOCAL_VIEW_NUM_DURATIONS,
) -> Views:
    """Build normalised float32 global and local views from a flattened light curve.

    ``raw_depth`` is ``median - min`` of the un-normalised local view (fractional depth of the binned
    transit), ``None`` if undefined. Phases of the bin centres (days) are included for plotting.
    """
    validate_ephemeris(ephemeris)
    p, e, d = ephemeris.period_days, ephemeris.epoch, ephemeris.duration_days
    g, g_c, g_empty = global_view(flat_lc.time, flat_lc.flux, p, e, num_global_bins)
    loc, l_c, l_empty = local_view(flat_lc.time, flat_lc.flux, p, e, d, num_local_bins, num_durations)
    raw_depth = None
    if np.isfinite(loc).any():
        raw_depth = float(np.median(loc[np.isfinite(loc)]) - np.min(loc[np.isfinite(loc)]))
    return Views(
        global_view=normalize_view(g).astype(np.float32),
        local_view=normalize_view(loc).astype(np.float32),
        global_empty_frac=float(g_empty),
        local_empty_frac=float(l_empty),
        raw_depth=raw_depth,
        global_phase=g_c,
        local_phase=l_c,
    )


__all__ = ["LOCAL_BIN_WIDTH_FACTOR", "global_view", "local_view", "make_views", "normalize_view"]
