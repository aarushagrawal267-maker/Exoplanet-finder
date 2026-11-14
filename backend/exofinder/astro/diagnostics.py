"""Transit vetting diagnostics measured on the flattened light curve.

These are the classic tests used to tell planets from false positives (cf. Kepler DV reports):

* **SNR** - how significant the transit is: ``depth / CDPP(T14) * sqrt(N_transits)``.
* **Odd/even depths** - an eclipsing binary with two similar eclipses detected at half its true
  period shows alternating ("odd" vs "even") depths; a planet does not.
* **Secondary eclipse** - a significant dip near phase 0.5 suggests a self-luminous companion (an
  eclipsing binary), although hot Jupiters can show a weak occultation (e.g. Kepler-2 b).
* **Individual transits** - depths transit by transit, to spot single-event artefacts.
* **Transit counting** - how many predicted transits fall in the data and how many are covered.

Measurement conventions (all in the flattened, baseline~1 light curve)
--------------------------------------------------------------------
* phase in days (:mod:`exofinder.astro.fold`), ``D`` = total duration T14 (days).
* *Depth* = local baseline - mean flux of the transit **core** ``|phase| < D/4`` (central half of
  the transit, i.e. the flat bottom for typical ingress durations), so it approximates the depth at
  minimum that catalogues quote (e.g. ``koi_depth``), not the box-averaged depth.
* *Local baseline* = median flux in the annulus ``D <= |phase| < min(3D, P/2)``.
* *Noise*: ``sigma`` = robust (MAD) per-cadence scatter of out-of-transit data (``|phase| >= 0.75 D``,
  i.e. outside the 1.5 x T14 detrending mask). Correlated ("red") noise is accounted for with a factor
  ``beta >= 1`` = (measured scatter of T14-long window averages) / (white-noise expectation).
  The error of a mean over ``n`` cadences is ``beta * sigma / sqrt(n)``; ``CDPP(T14)`` is the noise of
  one transit-duration average.

Undefined quantities (e.g. no data in transit) are returned as ``None`` (JSON-friendly).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from ._utils import bin_by_time, finite_or_none, mad_std, median_cadence, validate_ephemeris
from .fold import phase_fold, transit_number
from .types import Ephemeris, LightCurve

#: Fraction of a transit's expected in-transit cadences that must be present to count it as observed.
MIN_TRANSIT_COVERAGE = 0.5


@dataclass
class _Context:
    """Quantities shared by the diagnostics (computed once per light curve and ephemeris)."""

    t: np.ndarray
    f: np.ndarray
    phase: np.ndarray
    n: np.ndarray
    period: float
    epoch: float
    dur: float
    cadence: float
    baseline: float
    sigma: float
    beta: float
    cdpp_dur: float


def _context(flat: LightCurve, eph: Ephemeris) -> _Context:
    validate_ephemeris(eph)
    ok = np.isfinite(flat.time) & np.isfinite(flat.flux)
    t, f = flat.time[ok], flat.flux[ok]
    order = np.argsort(t, kind="stable")
    t, f = t[order], f[order]
    p, e, d = float(eph.period_days), float(eph.epoch), float(eph.duration_days)
    phase = phase_fold(t, p, e)
    n = transit_number(t, p, e)
    cadence = median_cadence(t)
    if not np.isfinite(cadence):
        cadence = d / 10.0

    abs_ph = np.abs(phase)
    ann = (abs_ph >= d) & (abs_ph < min(3.0 * d, 0.5 * p))
    oot = abs_ph >= 0.75 * d
    if ann.sum() >= 10:
        baseline = float(np.median(f[ann]))
    elif oot.any():
        baseline = float(np.median(f[oot]))
    else:
        baseline = 1.0
    sigma = mad_std(f[oot]) if oot.sum() >= 3 else mad_std(f)

    beta = 1.0
    expected = max(d / cadence, 1.0)
    if oot.sum() > 20 and np.isfinite(sigma) and sigma > 0:
        _, fb, cnt = bin_by_time(t[oot], f[oot], d)
        full = cnt >= 0.5 * expected
        if full.sum() >= 10:
            white = sigma / math.sqrt(float(np.median(cnt[full])))
            sig_win = mad_std(fb[full])
            if np.isfinite(sig_win) and white > 0:
                beta = max(1.0, sig_win / white)
    cdpp = beta * sigma / math.sqrt(expected) if np.isfinite(sigma) else float("nan")
    return _Context(t, f, phase, n, p, e, d, cadence, baseline, sigma, beta, cdpp)


def _mean_depth(
    ctx: _Context, sel: np.ndarray, baseline: float | None = None
) -> tuple[float | None, float | None, int]:
    """(depth, error) as fractions for the mean of the selected cadences, and the number used."""
    k = int(sel.sum())
    if k == 0 or not np.isfinite(ctx.sigma):
        return None, None, k
    base = ctx.baseline if baseline is None else baseline
    depth = base - float(np.mean(ctx.f[sel]))
    err = ctx.beta * ctx.sigma / math.sqrt(k)
    return depth, err, k


# --------------------------------------------------------------------------------------------------
def _count(ctx: _Context) -> tuple[int, int]:
    if ctx.t.size == 0:
        return 0, 0
    n_first = math.ceil((ctx.t[0] - ctx.epoch) / ctx.period)
    n_last = math.floor((ctx.t[-1] - ctx.epoch) / ctx.period)
    expected = max(0, n_last - n_first + 1)
    if expected == 0:
        return 0, 0
    in_win = (np.abs(ctx.phase) < 0.5 * ctx.dur) & (ctx.n >= n_first) & (ctx.n <= n_last)
    counts = np.bincount(ctx.n[in_win] - n_first, minlength=expected)
    need = MIN_TRANSIT_COVERAGE * max(ctx.dur / ctx.cadence, 1.0)
    return expected, int(np.sum(counts >= need))


def count_transits(time: np.ndarray, eph: Ephemeris) -> tuple[int, int]:
    """``(expected, observed)`` transit counts.

    *expected*: transit centres ``epoch + n*P`` within ``[min(time), max(time)]``. *observed*: those
    with at least ``MIN_TRANSIT_COVERAGE`` (50%) of the expected in-transit cadences
    (``|phase| < T14/2``, expected number = T14 / median cadence) present in ``time``.
    """
    t = np.asarray(time, dtype=np.float64)
    lc = LightCurve(time=t, flux=np.ones_like(t))
    return _count(_context(lc, eph))


def _snr(ctx: _Context) -> dict[str, Any]:
    core = np.abs(ctx.phase) < 0.25 * ctx.dur
    depth, _, _ = _mean_depth(ctx, core)
    _, observed = _count(ctx)
    snr_val = None
    if depth is not None and observed > 0 and np.isfinite(ctx.cdpp_dur) and ctx.cdpp_dur > 0:
        snr_val = depth / ctx.cdpp_dur * math.sqrt(observed)
    return {
        "snr": finite_or_none(snr_val),
        "depth_ppm": finite_or_none(None if depth is None else depth * 1e6),
        "noise_ppm": finite_or_none(ctx.cdpp_dur * 1e6),
        "n_transits": observed,
    }


def snr(flat: LightCurve, eph: Ephemeris) -> dict[str, Any]:
    """Transit SNR: ``{snr, depth_ppm, noise_ppm, n_transits}``.

    ``depth_ppm`` is the core depth (see module docstring), ``noise_ppm`` the CDPP over one transit
    duration (white noise x red-noise factor), ``n_transits`` the number of observed transits and
    ``snr = depth / noise * sqrt(n_transits)``.
    """
    return _snr(_context(flat, eph))


def _ppm(fraction: float | None) -> float | None:
    return finite_or_none(None if fraction is None else fraction * 1e6)


def _odd_even(ctx: _Context) -> dict[str, Any]:
    core = np.abs(ctx.phase) < 0.25 * ctx.dur
    odd = np.mod(ctx.n, 2) == 1
    d_odd, e_odd, k_odd = _mean_depth(ctx, core & odd)
    d_even, e_even, k_even = _mean_depth(ctx, core & ~odd)
    diff_sigma = None
    if d_odd is not None and d_even is not None and e_odd and e_even:
        diff_sigma = abs(d_odd - d_even) / math.hypot(e_odd, e_even)
    return {
        "depth_odd_ppm": _ppm(d_odd),
        "depth_even_ppm": _ppm(d_even),
        "err_odd": _ppm(e_odd),
        "err_even": _ppm(e_even),
        "diff_sigma": finite_or_none(diff_sigma),
        "n_odd_points": k_odd,
        "n_even_points": k_even,
    }


def odd_even(flat: LightCurve, eph: Ephemeris) -> dict[str, Any]:
    """Odd vs even transit core depths: ``{depth_odd_ppm, depth_even_ppm, err_odd, err_even, diff_sigma}``.

    Transit number parity follows :func:`exofinder.astro.fold.transit_number` (the epoch transit is
    even). Errors are in ppm. ``diff_sigma = |odd - even| / sqrt(err_odd^2 + err_even^2)``; values
    above ~3 indicate an eclipsing binary detected at half its period.
    """
    return _odd_even(_context(flat, eph))


def _secondary(ctx: _Context) -> dict[str, Any]:
    p, d = ctx.period, ctx.dur
    primary_free = np.abs(ctx.phase) >= 0.75 * d
    step = d / 8.0
    offsets = 0.5 * p + np.arange(-8, 9) * step
    best: tuple[float, float, float, float, int] | None = None  # (sig, depth, err, offset, n)
    for off in offsets:
        ph2 = phase_fold(ctx.t, p, ctx.epoch + off)
        a2 = np.abs(ph2)
        inside = (a2 < 0.5 * d) & primary_free
        ann = (a2 >= d) & (a2 < min(3.0 * d, 0.5 * p)) & primary_free
        if inside.sum() < 3 or ann.sum() < 10:
            continue
        depth, err, k = _mean_depth(ctx, inside, baseline=float(np.median(ctx.f[ann])))
        if depth is None or not err:
            continue
        sig = depth / err
        if best is None or sig > best[0]:
            best = (sig, depth, err, float(off), k)
    if best is None:
        return {
            "depth_ppm": None,
            "err_ppm": None,
            "significance_sigma": None,
            "phase": None,
            "offset_days": None,
            "n_points": 0,
        }
    sig, depth, err, off, k = best
    return {
        "depth_ppm": finite_or_none(depth * 1e6),
        "err_ppm": finite_or_none(err * 1e6),
        "significance_sigma": finite_or_none(sig),
        "phase": float((off / p) % 1.0),
        "offset_days": off,
        "n_points": k,
    }


def secondary_eclipse(flat: LightCurve, eph: Ephemeris) -> dict[str, Any]:
    """Best secondary-eclipse candidate near phase 0.5: ``{depth_ppm, err_ppm, significance_sigma, phase}``.

    Trial eclipse centres span ``P/2 +/- T14`` in steps of T14/8; for each, the mean flux within
    ``+/- T14/2`` (a flat-bottomed occultation of the same duration as the transit) is compared with
    the median of the surrounding annulus ``T14 <= |dt| < 3 T14`` (primary-transit cadences excluded).
    The trial with the highest significance (depth / error) is reported. ``phase`` is the **orbital
    phase as a fraction of the period** (0.5 for a circular orbit), ``offset_days`` the same in days
    after the primary transit. Because the best of several trials is reported, pure noise typically
    yields ~1-2 sigma.
    """
    return _secondary(_context(flat, eph))


def _individual(ctx: _Context, max_events: int) -> list[dict[str, Any]]:
    d = ctx.dur
    abs_ph = np.abs(ctx.phase)
    in_full = abs_ph < 0.5 * d
    events = np.unique(ctx.n[in_full])
    if events.size > max_events:
        pick = np.unique(np.round(np.linspace(0, events.size - 1, max_events)).astype(np.int64))
        events = events[pick]
    near = abs_ph < min(3.0 * d, 0.5 * ctx.period)
    expected_pts = max(d / ctx.cadence, 1.0)
    out = []
    for n in events:
        sel = near & (ctx.n == n)
        ph = ctx.phase[sel]
        a = np.abs(ph)
        local_ann = a >= 0.75 * d
        idx = np.nonzero(sel)[0]
        base = float(np.median(ctx.f[idx[local_ann]])) if local_ann.sum() >= 5 else ctx.baseline
        core = np.zeros_like(sel)
        core[idx[a < 0.25 * d]] = True
        depth, err, _ = _mean_depth(ctx, core, baseline=base)
        n_points = int(np.sum(a < 0.5 * d))
        coverage = n_points / expected_pts
        out.append(
            {
                "index": int(n),
                "epoch": float(ctx.epoch + int(n) * ctx.period),
                "depth_ppm": finite_or_none(None if depth is None else depth * 1e6),
                "err_ppm": finite_or_none(None if err is None else err * 1e6),
                "n_points": n_points,
                "coverage": float(min(coverage, 1.0)),
                "covered": bool(coverage >= MIN_TRANSIT_COVERAGE),
            }
        )
    return out


def individual_transits(flat: LightCurve, eph: Ephemeris, max_events: int = 40) -> list[dict[str, Any]]:
    """Per-transit measurements: ``[{index, epoch, depth_ppm, err_ppm, n_points, covered}, ...]``.

    One entry per transit with at least one in-transit cadence, in time order; when there are more
    than ``max_events``, an evenly spaced (deterministic) subset spanning the whole baseline is
    returned. ``epoch`` is that transit's predicted centre, depth uses a per-transit local baseline
    (``0.75 T14 <= |dt| < 3 T14``), ``n_points`` counts cadences within ``+/- T14/2`` and ``covered``
    is True when at least 50% of the expected in-transit cadences are present (``coverage`` gives the
    fraction).
    """
    if max_events < 1:
        return []
    return _individual(_context(flat, eph), max_events)


def compute_diagnostics(
    flat: LightCurve,
    eph: Ephemeris,
    exposure_days: float | None = None,
    max_events: int = 40,
    include_transit_fit: bool = True,
) -> dict[str, Any]:
    """All diagnostics in one pass (shared phase folding and noise model).

    Returns ``{snr, odd_even, secondary, individual_transits, transit_count{expected, observed},
    noise{oot_scatter_ppm, red_noise_beta, cdpp_duration_ppm, baseline}, transit_fit}``.
    """
    from .transit_fit import fit_trapezoid

    ctx = _context(flat, eph)
    expected, observed = _count(ctx)
    out: dict[str, Any] = {
        "snr": _snr(ctx),
        "odd_even": _odd_even(ctx),
        "secondary": _secondary(ctx),
        "individual_transits": _individual(ctx, max_events) if max_events > 0 else [],
        "transit_count": {"expected": expected, "observed": observed},
        "noise": {
            "oot_scatter_ppm": finite_or_none(ctx.sigma * 1e6),
            "red_noise_beta": float(ctx.beta),
            "cdpp_duration_ppm": finite_or_none(ctx.cdpp_dur * 1e6),
            "baseline": float(ctx.baseline),
        },
    }
    if include_transit_fit:
        out["transit_fit"] = fit_trapezoid(ctx.t, ctx.f, eph, exposure_days=exposure_days)
    return out


__all__ = [
    "MIN_TRANSIT_COVERAGE",
    "compute_diagnostics",
    "count_transits",
    "individual_transits",
    "odd_even",
    "secondary_eclipse",
    "snr",
]
