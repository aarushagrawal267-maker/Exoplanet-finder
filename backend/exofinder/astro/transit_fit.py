"""Trapezoid transit model and least-squares fit on the phase-folded light curve.

A trapezoid is a good, assumption-light approximation of a transit: flat bottom of depth ``delta``
between second and third contact, linear ingress/egress of duration ``tau`` and total duration
``T14`` (first to fourth contact). Its *shape ratio* ``tau / T14`` separates box/U-shaped planetary
transits (small ratio; a small planet crosses the limb quickly) from V-shaped grazing eclipses of
binary stars (ratio -> 0.5, no flat bottom). Conventions: phase in days (transit at 0), duration =
total T14, ``epoch`` = transit centre.

Kepler long-cadence exposures last 29.4 min, which smears ingress and egress; pass
``exposure_days`` to integrate the model over the exposure (supersampling) so that ``tau`` is the
astrophysical ingress duration rather than the smeared one.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.optimize import least_squares

from ._utils import finite_or_none, mad_std, validate_ephemeris
from .fold import phase_fold
from .types import Ephemeris


def trapezoid_shape(phase: np.ndarray, duration: float, ingress: float) -> np.ndarray:
    """Fractional transit profile in [0, 1]: 0 out of transit, 1 on the flat bottom.

    ``phase`` and ``duration`` (T14) and ``ingress`` (tau, clipped to (0, T14/2]) are in days. The
    model flux is ``baseline * (1 - depth * shape)`` or, additively, ``baseline - depth * shape``.
    """
    x = np.abs(np.asarray(phase, dtype=np.float64))
    half = 0.5 * float(duration)
    tau = min(max(float(ingress), 1e-9), half) if half > 0 else 1e-9
    return np.clip((half - x) / tau, 0.0, 1.0)


def _supersampled_shape(
    phase: np.ndarray, duration: float, ingress: float, offsets: np.ndarray
) -> np.ndarray:
    if offsets.size <= 1:
        return trapezoid_shape(phase, duration, ingress)
    acc = np.zeros(phase.shape)
    for off in offsets:
        acc += trapezoid_shape(phase + off, duration, ingress)
    return acc / offsets.size


def _failed(reason: str, n_points: int) -> dict[str, Any]:
    return {
        "depth_ppm": None,
        "depth_err_ppm": None,
        "duration_hours": None,
        "duration_err_hours": None,
        "ingress_hours": None,
        "epoch": None,
        "epoch_err": None,
        "chi2_red": None,
        "shape_ratio": None,
        "baseline": None,
        "n_points": n_points,
        "converged": False,
        "message": reason,
    }


def fit_trapezoid(
    time: np.ndarray,
    flux: np.ndarray,
    ephemeris: Ephemeris,
    exposure_days: float | None = None,
    window_durations: float = 3.0,
) -> dict[str, Any]:
    """Least-squares trapezoid fit to the folded flattened light curve (period held fixed).

    Fits baseline, depth, T14, ingress and a phase shift ``dt`` to cadences within
    ``+/- window_durations * T14`` of the transit, with uniform errors equal to the robust
    out-of-transit scatter. Returns ``{depth_ppm, depth_err_ppm, duration_hours, ingress_hours, epoch,
    epoch_err, chi2_red, shape_ratio}`` plus ``duration_err_hours``, ``baseline``, ``n_points``,
    ``converged`` and ``message``. ``epoch = ephemeris.epoch + dt``. Uncertainties come from the
    Jacobian, inflated by sqrt(chi2_red) when chi2_red > 1. When the fit is impossible (too few
    points) the numeric values are ``None`` and ``converged`` is False.
    """
    validate_ephemeris(ephemeris)
    t = np.asarray(time, dtype=np.float64)
    f = np.asarray(flux, dtype=np.float64)
    ok = np.isfinite(t) & np.isfinite(f)
    p, d = ephemeris.period_days, ephemeris.duration_days
    phase = phase_fold(t[ok], p, ephemeris.epoch)
    f = f[ok]
    half_window = min(0.5 * p, window_durations * d)
    win = np.abs(phase) < half_window
    x, y = phase[win], f[win]
    n_in = int(np.sum(np.abs(x) < 0.5 * d))
    if x.size < 10 or n_in < 3:
        return _failed("too few points in and around transit", int(x.size))

    oot = np.abs(x) > d
    b0 = float(np.median(y[oot])) if oot.sum() >= 5 else float(np.median(y))
    sigma = mad_std(y[oot]) if oot.sum() >= 5 else mad_std(y)
    if not (np.isfinite(sigma) and sigma > 0):
        sigma = float(np.std(y)) or 1e-6
    core = np.abs(x) < 0.25 * d
    depth0 = b0 - float(np.median(y[core])) if core.any() else sigma
    depth0 = float(np.clip(depth0, sigma * 0.1, 0.99))

    offsets = np.zeros(1)
    if exposure_days is not None and exposure_days > 0:
        n_sub = 7
        offsets = ((np.arange(n_sub) + 0.5) / n_sub - 0.5) * float(exposure_days)

    def model(params: np.ndarray) -> np.ndarray:
        base, depth, dur, s, dt = params
        return base - depth * _supersampled_shape(x - dt, dur, 0.5 * s * dur, offsets)

    def resid(params: np.ndarray) -> np.ndarray:
        return (model(params) - y) / sigma

    b_tol = max(0.01, 50.0 * sigma)
    max_dur = min(2.5 * d, 0.9 * p, 1.9 * half_window)
    lower = np.array([b0 - b_tol, 0.0, 0.2 * d, 0.02, -0.5 * d])
    upper = np.array([b0 + b_tol, 1.0, max_dur, 1.0, 0.5 * d])
    best = None
    for s0 in (0.2, 0.6, 0.95):
        x0 = np.clip(np.array([b0, depth0, d, s0, 0.0]), lower + 1e-12, upper - 1e-12)
        try:
            res = least_squares(resid, x0, bounds=(lower, upper), x_scale="jac", max_nfev=400)
        except (ValueError, np.linalg.LinAlgError):
            continue
        if best is None or res.cost < best.cost:
            best = res
    if best is None:
        return _failed("least-squares fit failed", int(x.size))

    base, depth, dur, s, dt = best.x
    n_free = 5
    dof = max(x.size - n_free, 1)
    chi2_red = float(2.0 * best.cost / dof)
    errs = np.full(5, np.nan)
    try:
        jac = best.jac
        cov = np.linalg.pinv(jac.T @ jac) * max(1.0, chi2_red)
        errs = np.sqrt(np.clip(np.diag(cov), 0, None))
    except (ValueError, np.linalg.LinAlgError):
        pass
    ingress = 0.5 * s * dur
    return {
        "depth_ppm": float(depth * 1e6),
        "depth_err_ppm": finite_or_none(errs[1] * 1e6),
        "duration_hours": float(dur * 24.0),
        "duration_err_hours": finite_or_none(errs[2] * 24.0),
        "ingress_hours": float(ingress * 24.0),
        "epoch": float(ephemeris.epoch + dt),
        "epoch_err": finite_or_none(errs[4]),
        "chi2_red": chi2_red if math.isfinite(chi2_red) else None,
        "shape_ratio": float(ingress / dur) if dur > 0 else None,
        "baseline": float(base),
        "n_points": int(x.size),
        "converged": bool(best.success),
        "message": str(best.message),
    }


__all__ = ["fit_trapezoid", "trapezoid_shape"]
