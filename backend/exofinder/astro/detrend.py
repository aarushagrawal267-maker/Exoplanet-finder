"""Removal of stellar variability and residual instrumental trends ("flattening").

Method (spline, default) - follows Shallue & Vanderburg (2018, AstroNet), who adapted Vanderburg &
Johnson (2014):

1. The light curve is split into *chunks*: each segment (Kepler quarter) is split further wherever
   consecutive cadences are more than ``gap_days`` (0.75 d) apart, because the spacecraft's thermal
   settling after gaps produces discontinuities that a smooth function must not bridge.
2. In each chunk a cubic least-squares B-spline with uniformly spaced interior knots is fitted to the
   flux. The fit is *robust*: after each fit, points more than ``clip_sigma`` (3) robust standard
   deviations from the spline are excluded and the spline is refitted (up to ``max_iter`` times).
   This clipping only affects the *trend fit*; no data are removed from the light curve here.
3. **Transits are masked from the fit.** When an ephemeris is given, cadences with
   ``|phase| < mask_width_factor * T14 / 2`` (1.5 x T14 by default, see
   :mod:`exofinder.astro.transit_mask`) are excluded from the fit, and the spline is only
   *evaluated* there. The trend therefore interpolates smoothly under the transit and dividing by it
   preserves the transit depth and shape. Without masking, a flexible spline partially follows the
   dip and makes transits shallower.
4. The knot spacing is chosen by the Bayesian Information Criterion over a logarithmic grid between
   ``max(0.5 d, 3 x T14)`` and 20 d (AstroNet uses 0.5-20 d). The 3 x T14 floor guarantees that a
   knot interval is always much longer than the masked transit window, so the spline cannot bend
   into the transit. BIC = chi^2 + k ln(n), with chi^2 computed against the white-noise level
   estimated from point-to-point differences, k the total number of spline coefficients and n the
   number of fitted points. Small spacing fits variability better but costs parameters.

Method ``"savgol"``: a Savitzky-Golay filter (polynomial order 2) on a uniform time grid with a window
of at least 3 x T14 (default ``max(3 x T14, 0.5 d)``); masked/clipped cadences are bridged by
linear interpolation before filtering, with the same masking and iterative clipping as above.

The flattened light curve is ``flux / trend`` (baseline 1.0). Its time array is untouched (float64).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.interpolate import LSQUnivariateSpline
from scipy.signal import savgol_filter

from ._utils import mad_std, median_cadence, validate_ephemeris
from .cleaning import DEFAULT_GAP_DAYS
from .transit_mask import transit_mask
from .types import Ephemeris, LightCurve

METHODS = ("spline", "savgol")

#: Minimum points between consecutive knots (keeps the Schoenberg-Whitney condition satisfied).
_MIN_POINTS_PER_KNOT_INTERVAL = 5
#: Chunks with fewer usable points than this are modelled by their median (constant trend).
_MIN_SPLINE_POINTS = 8


@dataclass
class DetrendOptions:
    """Tunable parameters of :func:`detrend` (passed as keyword arguments)."""

    gap_days: float = DEFAULT_GAP_DAYS
    mask_width_factor: float = 1.5
    clip_sigma: float = 3.0
    max_iter: int = 5
    knot_spacing_days: float | None = None  # fixed spacing (skips the BIC search)
    min_knot_spacing_days: float = 0.5
    max_knot_spacing_days: float = 20.0
    n_knot_grid: int = 20
    window_days: float | None = None  # Savitzky-Golay window; default max(3 x T14, 0.5 d)
    polyorder: int = 2
    exclude_mask: np.ndarray | None = None  # extra cadences to exclude from the fit (e.g. other planets)

    @classmethod
    def from_kwargs(cls, kw: dict[str, Any]) -> DetrendOptions:
        allowed = set(cls.__dataclass_fields__)
        unknown = set(kw) - allowed
        if unknown:
            raise TypeError(f"detrend() got unexpected keyword argument(s): {', '.join(sorted(unknown))}")
        opts = cls(**kw)
        if opts.clip_sigma <= 0 or opts.max_iter < 1 or opts.gap_days <= 0:
            raise ValueError("clip_sigma and gap_days must be positive and max_iter >= 1")
        # Spacings and windows divide time spans: zero gives ZeroDivisionError, negatives nonsense.
        for name in ("min_knot_spacing_days", "max_knot_spacing_days", "knot_spacing_days", "window_days"):
            value = getattr(opts, name)
            if value is not None and not (math.isfinite(value) and value > 0):
                raise ValueError(f"{name} must be a positive number of days (got {value!r})")
        if opts.polyorder < 0:
            raise ValueError("polyorder must be >= 0")
        return opts


def _chunks(time: np.ndarray, segment: np.ndarray | None, gap_days: float) -> list[np.ndarray]:
    """Index arrays (time-sorted) of contiguous chunks: per segment, split at gaps > gap_days."""
    finite = np.isfinite(time)
    seg = segment if segment is not None else np.zeros(time.size, dtype=np.int64)
    out: list[tuple[float, np.ndarray]] = []
    for s in np.unique(seg[finite]):
        idx = np.nonzero(finite & (seg == s))[0]
        idx = idx[np.argsort(time[idx], kind="stable")]
        breaks = np.nonzero(np.diff(time[idx]) > gap_days)[0] + 1
        for part in np.split(idx, breaks):
            if part.size:
                out.append((float(time[part[0]]), part))
    out.sort(key=lambda x: x[0])
    return [p for _, p in out]


def _interior_knots(tt: np.ndarray, spacing: float) -> np.ndarray:
    """Uniform interior knots with spacing >= ``spacing``, pruned so every knot interval holds data.

    Masked transits and small gaps can leave knot intervals (nearly) empty, which makes the
    least-squares spline singular; such knots are dropped (merging intervals).
    """
    t0, t1 = float(tt[0]), float(tt[-1])
    n_int = math.floor((t1 - t0) / spacing)
    if n_int < 2:
        return np.empty(0)
    cand = np.linspace(t0, t1, n_int + 1)[1:-1]
    pos = np.searchsorted(tt, cand, side="left")
    kept: list[float] = []
    last = 0
    for c, p in zip(cand, pos, strict=True):
        if p - last >= _MIN_POINTS_PER_KNOT_INTERVAL:
            kept.append(float(c))
            last = int(p)
    while kept and tt.size - int(np.searchsorted(tt, kept[-1], side="left")) < _MIN_POINTS_PER_KNOT_INTERVAL:
        kept.pop()
    return np.asarray(kept, dtype=np.float64)


def _lsq_spline(tt: np.ndarray, ff: np.ndarray, knots: np.ndarray) -> tuple[LSQUnivariateSpline, np.ndarray]:
    """Cubic LSQ spline; on a singular configuration retries with every other knot removed."""
    k = knots
    for _ in range(12):
        try:
            return LSQUnivariateSpline(tt, ff, k, k=3, ext=3), k
        except ValueError:
            if k.size == 0:
                break
            k = k[1::2] if k.size > 1 else np.empty(0)
    raise ValueError("spline fit failed")


def _fit_chunk_spline(
    tc: np.ndarray, fc: np.ndarray, okc: np.ndarray, spacing: float, opts: DetrendOptions
) -> tuple[np.ndarray, np.ndarray, int]:
    """Robust iterative spline fit of one chunk. Returns (model, used_mask, n_params)."""
    use = okc.copy()
    model: np.ndarray | None = None
    used = np.zeros_like(okc)
    n_params = 0
    for _ in range(opts.max_iter):
        if use.sum() < _MIN_SPLINE_POINTS:
            break
        tt, ff = tc[use], fc[use]
        try:
            spl, knots = _lsq_spline(tt, ff, _interior_knots(tt, spacing))
        except ValueError:
            break
        model = spl(tc)
        used = use.copy()
        n_params = int(knots.size) + 4
        resid = fc - model
        s = mad_std(resid[use])
        if not (np.isfinite(s) and s > 0):
            break
        with np.errstate(invalid="ignore"):
            new_use = okc & (np.abs(resid) <= opts.clip_sigma * s)
        if np.array_equal(new_use, use):
            break
        use = new_use
    if model is None:
        return _constant_model(fc, okc)
    return model, used, n_params


def _constant_model(fc: np.ndarray, okc: np.ndarray) -> tuple[np.ndarray, np.ndarray, int]:
    vals = fc[okc]
    if vals.size == 0:
        return np.full(fc.size, np.nan), np.zeros(fc.size, dtype=bool), 0
    return np.full(fc.size, float(np.median(vals))), okc.copy(), 1


def _fit_chunk_savgol(
    tc: np.ndarray, fc: np.ndarray, okc: np.ndarray, window_days: float, dt: float, opts: DetrendOptions
) -> tuple[np.ndarray, np.ndarray, int]:
    """Robust iterative Savitzky-Golay trend of one chunk on a uniform grid of step ``dt``."""
    use = okc.copy()
    model: np.ndarray | None = None
    used = np.zeros_like(okc)
    grid = np.arange(tc[0], tc[-1] + 0.5 * dt, dt) if tc[-1] > tc[0] else np.asarray([tc[0]])
    wl = round(window_days / dt)
    wl += 1 - wl % 2  # odd
    wl = min(wl, grid.size if grid.size % 2 else grid.size - 1)
    if wl <= opts.polyorder + 1:
        return _constant_model(fc, okc)
    for _ in range(opts.max_iter):
        if use.sum() < _MIN_SPLINE_POINTS:
            break
        yg = np.interp(grid, tc[use], fc[use])
        smooth = savgol_filter(yg, wl, opts.polyorder, mode="interp")
        model = np.interp(tc, grid, smooth)
        used = use.copy()
        resid = fc - model
        s = mad_std(resid[use])
        if not (np.isfinite(s) and s > 0):
            break
        with np.errstate(invalid="ignore"):
            new_use = okc & (np.abs(resid) <= opts.clip_sigma * s)
        if np.array_equal(new_use, use):
            break
        use = new_use
    if model is None:
        return _constant_model(fc, okc)
    return model, used, math.ceil((tc[-1] - tc[0]) / window_days) * (opts.polyorder + 1)


def _white_noise(f: np.ndarray, fit_ok: np.ndarray, chunks: list[np.ndarray]) -> float:
    """Gaussian white-noise level from point-to-point differences (insensitive to slow trends)."""
    diffs = []
    for idx in chunks:
        v = f[idx][fit_ok[idx]]
        if v.size > 2:
            diffs.append(np.diff(v))
    if not diffs:
        return float("nan")
    return mad_std(np.concatenate(diffs)) / math.sqrt(2.0)


def detrend(
    lc: LightCurve, ephemeris: Ephemeris | None = None, method: str = "spline", **kw: Any
) -> tuple[LightCurve, np.ndarray, dict[str, Any]]:
    """Flatten a (normalised) light curve; returns ``(flat_lc, trend, report)``.

    ``flat_lc.flux = lc.flux / trend`` (baseline 1.0), ``trend`` has the same length as ``lc``.
    When ``ephemeris`` is given, its in-transit cadences are excluded from the trend fit (see module
    docstring). Keyword options are the fields of :class:`DetrendOptions`. ``report`` records the
    method, the masking, the number of chunks, the chosen knot spacing with the BIC grid (spline) or
    the window (savgol), and how many cadences the robust fit ignored.
    """
    if method not in METHODS:
        raise ValueError(f"Unknown detrending method {method!r}; use one of {', '.join(METHODS)}")
    opts = DetrendOptions.from_kwargs(kw)
    t, f = lc.time, lc.flux
    n = len(lc)
    finite = np.isfinite(t) & np.isfinite(f)

    in_transit = np.zeros(n, dtype=bool)
    duration_days: float | None = None
    if ephemeris is not None:
        validate_ephemeris(ephemeris)
        duration_days = ephemeris.duration_days
        in_transit = transit_mask(
            t, ephemeris.period_days, ephemeris.epoch, duration_days, opts.mask_width_factor
        )
    excluded = np.zeros(n, dtype=bool)
    if opts.exclude_mask is not None:
        excluded = np.asarray(opts.exclude_mask, dtype=bool)
        if excluded.shape != (n,):
            raise ValueError("exclude_mask must be a boolean array with one entry per cadence")
    fit_ok = finite & ~in_transit & ~excluded
    chunks = _chunks(t, lc.segment, opts.gap_days)

    trend = np.full(n, np.nan)
    used = np.zeros(n, dtype=bool)
    report: dict[str, Any] = {
        "method": method,
        "transit_masked": ephemeris is not None,
        "mask_width_factor": opts.mask_width_factor if ephemeris is not None else None,
        "n_masked_in_transit": int((finite & in_transit).sum()),
        "n_excluded_extra": int((finite & excluded & ~in_transit).sum()),
        "n_chunks": len(chunks),
        "gap_days": opts.gap_days,
        "clip_sigma": opts.clip_sigma,
    }
    sigma_w = _white_noise(f, fit_ok, chunks)
    report["white_noise_ppm"] = float(sigma_w * 1e6) if np.isfinite(sigma_w) else None

    if method == "spline":
        min_spacing = max(opts.min_knot_spacing_days, 3.0 * duration_days if duration_days else 0.0)
        if opts.knot_spacing_days is not None:
            grid = np.asarray([max(float(opts.knot_spacing_days), min_spacing)])
        else:
            max_spacing = max(opts.max_knot_spacing_days, 2.0 * min_spacing)
            grid = np.geomspace(min_spacing, max_spacing, max(1, int(opts.n_knot_grid)))
        bics: list[float | None] = []
        best_bic = math.inf
        for spacing in grid:
            tr = np.full(n, np.nan)
            us = np.zeros(n, dtype=bool)
            n_params = 0
            for idx in chunks:
                model, u, k = _fit_chunk_spline(t[idx], f[idx], fit_ok[idx], float(spacing), opts)
                tr[idx] = model
                us[idx] = u
                n_params += k
            n_used = int(us.sum())
            if n_used > 0 and np.isfinite(sigma_w) and sigma_w > 0:
                chi2 = float(np.sum(((f[us] - tr[us]) / sigma_w) ** 2))
                bic = chi2 + n_params * math.log(n_used)
            else:
                bic = math.inf
            bics.append(bic if math.isfinite(bic) else None)
            if bic < best_bic or not np.isfinite(trend).any():
                best_bic, trend, used = bic, tr, us
                report["knot_spacing_days"] = float(spacing)
                report["n_spline_params"] = n_params
        report["knot_spacing_grid"] = [float(x) for x in grid]
        report["bic"] = bics
    else:
        dt = median_cadence(t[finite]) if finite.sum() > 1 else float("nan")
        window = opts.window_days
        if window is None:
            window = max(3.0 * duration_days if duration_days else 0.0, 0.5)
        elif duration_days:
            window = max(window, 3.0 * duration_days)
        report["window_days"] = float(window)
        if np.isfinite(dt) and dt > 0:
            for idx in chunks:
                model, u, _ = _fit_chunk_savgol(t[idx], f[idx], fit_ok[idx], float(window), dt, opts)
                trend[idx] = model
                used[idx] = u

    # chunks without any usable point (e.g. entirely in transit): use the segment's median baseline
    missing = np.isfinite(t) & ~np.isfinite(trend)
    if missing.any():
        seg = lc.segment if lc.segment is not None else np.zeros(n, dtype=np.int64)
        global_ref = (
            float(np.median(f[fit_ok]))
            if fit_ok.any()
            else (float(np.median(f[finite])) if finite.any() else 1.0)
        )
        for s in np.unique(seg[missing]):
            ref_mask = fit_ok & (seg == s)
            trend[missing & (seg == s)] = float(np.median(f[ref_mask])) if ref_mask.any() else global_ref
    report["n_cadences_constant_fallback"] = int(missing.sum())
    report["n_clipped_in_fit"] = int((fit_ok & ~used).sum())

    with np.errstate(invalid="ignore", divide="ignore"):
        good_trend = np.isfinite(trend) & (trend > 0)
        flat_flux = np.where(good_trend, f / np.where(good_trend, trend, 1.0), np.nan)
        flat_err = None
        if lc.flux_err is not None:
            flat_err = np.where(good_trend, lc.flux_err / np.where(good_trend, trend, 1.0), np.nan)
    meta = dict(lc.meta)
    meta["detrended"] = True
    meta["detrend_method"] = method
    flat = LightCurve(
        time=t.copy(),
        flux=flat_flux,
        flux_err=flat_err,
        quality=None if lc.quality is None else lc.quality.copy(),
        segment=None if lc.segment is None else lc.segment.copy(),
        meta=meta,
    )
    return flat, trend, report


__all__ = ["METHODS", "DetrendOptions", "detrend"]
