"""Box Least Squares (BLS) transit search (Kovacs, Zucker & Mazeh 2002) via astropy.

Used to propose an ephemeris when the user has none, and as an independent check of catalogue
periods. It runs on the *flattened* light curve (baseline 1.0).

Speed strategy (a 4-year Kepler curve has ~65,000 cadences)
----------------------------------------------------------
astropy's ``BoxLeastSquares`` costs roughly (number of trial periods) x (number of points), so:

1. **Binning** - the light curve is averaged into ``bin_minutes`` (30 min) bins. This mostly
   matters for short-cadence or TESS data; Kepler long cadence (29.4 min) is already at this scale.
2. **Physically motivated period/duration grid** - the period range is split into chunks
   (period ratio <= 1.6). In each chunk only plausible durations are tried: from 0.35x to 4x the
   central-transit duration of a Sun-like star, ``13 h * (P / 365.25 d)^(1/3)``, capped at 25% of the
   period (the 0.35x floor admits M dwarfs and grazing transits, the 4x ceiling evolved stars). The
   trial frequencies are uniform within a chunk, with step ``df = D_min / (oversample * T * P_max)``,
   so that over the full baseline ``T`` a transit drifts by at most ``D_min / oversample`` between
   neighbouring trial periods (``D_min`` = shortest duration tried in the chunk).
3. **Budget** - if this grid exceeds ``max_periods`` (default 40,000) trial periods, the frequency
   step is coarsened uniformly (``frequency_oversample_effective`` in the result says by how much).
   Measured in the dev container (2026): two Kepler quarters run at an effective oversample of ~1.7
   (ideal 3) in ~1 s; a 4-year, ~67,000-cadence curve runs at ~0.17 (about 17x coarser than ideal:
   between neighbouring trial periods a transit drifts by up to ~3 durations at the ends of the
   baseline) in ~4.5 s on 4 threads / ~15 s on one. Strong and moderate signals (SNR >~ 30) are still
   found and then refined (step 4), but weak short-period signals lose sensitivity; raise
   ``max_periods`` for a deeper search.
4. **Refinement** - the strongest peaks are re-searched on a fine local grid (4x the ideal
   density) with finer durations, which recovers the precise period, epoch and duration that the
   coarse grid may have straddled.
5. **Parallelism** - astropy's C kernel releases the GIL, so period sub-ranges run in threads. Each
   sub-range is independent, so results are identical (deterministic) whatever the thread count.

The periodogram objective is astropy's ``"likelihood"`` (delta log-likelihood of a box model vs a
constant, uniform per-point errors from the robust scatter). Its noise floor rises with period
(more phase trials per period), so peaks are ranked by the power *above the running median* of the
periodogram (block medians interpolated along the grid). The SDE-like ``sde`` (excess power divided
by the running robust scatter) is reported but not used for ranking: around a very strong signal,
its aliases inflate the local scatter and would make a harmonic look more significant than the
true period.
"""

from __future__ import annotations

import itertools
import math
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import numpy as np
from astropy.timeseries import BoxLeastSquares

from ._utils import bin_by_time, mad_std, median_cadence
from .diagnostics import count_transits
from .errors import InsufficientDataError
from .types import Ephemeris, LightCurve

#: Trial durations (hours) from which each period chunk takes its plausible subset.
DEFAULT_DURATIONS_HOURS: tuple[float, ...] = (
    1.0,
    1.5,
    2.0,
    2.5,
    3.0,
    4.0,
    5.0,
    6.0,
    7.5,
    9.0,
    11.0,
    13.5,
    16.0,
    20.0,
    24.0,
)
#: Upper limit of plotted periodogram points.
MAX_PERIODOGRAM_POINTS = 4000
_CHUNK_RATIO = 1.6
_TASK_SIZE = 2000
_N_REFINE = 3
_PHASE_OVERSAMPLE = 5  # astropy: phase bins per (shortest) duration in the coarse search
_MAX_DUTY_CYCLE = 0.25


def central_duration_hours(period_days: float | np.ndarray) -> float | np.ndarray:
    """Central-transit duration (hours) of a planet around a Sun-like star: 13 h (P/1 yr)^(1/3)."""
    return 13.0 * (np.asarray(period_days, dtype=np.float64) / 365.25) ** (1.0 / 3.0)


def _chunk_durations(pa: float, pb: float, user: tuple[float, ...] | None) -> list[float]:
    """Durations (hours) tried for periods in [pa, pb]."""
    cap = _MAX_DUTY_CYCLE * pa * 24.0
    if user is not None:
        return sorted({d for d in user if 0 < d < cap})
    lo = 0.35 * float(central_duration_hours(pa))
    hi = min(4.0 * float(central_duration_hours(pb)), cap)
    ds = [d for d in DEFAULT_DURATIONS_HOURS if lo <= d <= hi]
    below = [d for d in DEFAULT_DURATIONS_HOURS if d < lo and d <= hi]
    if below and (not ds or ds[0] > lo):
        ds.insert(0, below[-1])  # always include a duration at or just below the plausible minimum
    if not ds:
        allowed = [d for d in DEFAULT_DURATIONS_HOURS if d <= cap] or [
            min(DEFAULT_DURATIONS_HOURS[0], cap * 0.9)
        ]
        ds = [allowed[-1]]
    return ds


def _running_stats(power: np.ndarray, block: int = 500) -> tuple[np.ndarray, np.ndarray]:
    """Running median and robust std of the periodogram, from block statistics interpolated along the grid."""
    n = power.size
    finite = np.isfinite(power)
    centres, meds, scales = [], [], []
    for b in range(max(1, math.ceil(n / block))):
        sl = slice(b * block, min(n, (b + 1) * block))
        v = power[sl][finite[sl]]
        if v.size < 5:
            continue
        centres.append(0.5 * (sl.start + sl.stop - 1))
        meds.append(float(np.median(v)))
        scales.append(mad_std(v))
    if not centres:
        return np.zeros(n), np.ones(n)
    idx = np.arange(n, dtype=np.float64)
    med = np.interp(idx, centres, meds)
    scale = np.interp(idx, centres, scales)
    floor = max(float(np.median(scales)) * 1e-3, 1e-300)
    return med, np.maximum(scale, floor)


def _downsample_peaks(
    periods: np.ndarray, *series: np.ndarray, key: np.ndarray, max_points: int
) -> list[np.ndarray]:
    """Keep, in each of <= max_points contiguous blocks, the point where ``key`` is largest."""
    n = periods.size
    if n <= max_points:
        return [periods.copy(), *[s.copy() for s in series]]
    edges = np.linspace(0, n, max_points + 1).astype(np.int64)
    k = np.where(np.isfinite(key), key, -np.inf)
    pick = np.array([edges[i] + int(np.argmax(k[edges[i] : edges[i + 1]])) for i in range(max_points)])
    return [periods[pick], *[s[pick] for s in series]]


def _run_tasks(
    t: np.ndarray,
    y: np.ndarray,
    dy: np.ndarray,
    tasks: list[tuple[np.ndarray, np.ndarray]],
    objective: str,
    phase_oversample: int,
    n_threads: int,
) -> list[Any]:
    def one(task: tuple[np.ndarray, np.ndarray]) -> Any:
        periods, durations = task
        return BoxLeastSquares(t, y, dy=dy).power(
            periods, durations, objective=objective, oversample=phase_oversample
        )

    if n_threads <= 1 or len(tasks) <= 1:
        return [one(task) for task in tasks]
    with ThreadPoolExecutor(max_workers=n_threads) as pool:
        return list(pool.map(one, tasks))


def run_bls(
    lc: LightCurve,
    min_period: float = 0.5,
    max_period: float | None = None,
    durations_hours: list[float] | tuple[float, ...] | None = None,
    oversample: float = 3.0,
    bin_minutes: float | None = 30.0,
    max_periods: int = 40000,
    objective: str = "likelihood",
    n_threads: int | None = None,
) -> dict[str, Any]:
    """BLS period search on a flattened light curve.

    Parameters: ``min_period``/``max_period`` in days (default max = half the baseline, so that at
    least two transits are possible); ``durations_hours`` overrides the period-dependent duration
    grid; ``oversample`` is the frequency oversampling factor (see module docstring); ``bin_minutes``
    the binning (None = no binning); ``max_periods`` the coarse-grid budget.

    Returns ``{period, epoch, duration_hours, depth_ppm, snr, power_peak, periods, power, n_transits}``
    where ``epoch`` is the first predicted transit centre at or after the start of the data, ``depth_ppm``
    the box depth, ``snr`` its signal-to-noise ratio (box depth / error, white noise), ``power_peak`` the
    refined peak delta-log-likelihood, ``periods``/``power`` the coarse periodogram as float64 numpy
    arrays (downsampled to <= 4000 points keeping local maxima) and ``n_transits`` the number of
    observed transits (:func:`exofinder.astro.diagnostics.count_transits`). Extra keys document the
    search: ``depth_err_ppm``, ``sde`` (normalised peak power), ``power_norm`` (normalised periodogram),
    ``n_transits_expected``, ``baseline_days``, ``min_period``, ``max_period``, ``n_periods_searched``,
    ``frequency_oversample_effective``, ``bin_minutes``, ``n_points``, ``objective``, ``top_peaks``.
    """
    if objective not in ("likelihood", "snr"):
        raise ValueError("objective must be 'likelihood' or 'snr'")
    # A non-positive oversample would otherwise give a negative grid size that silently collapses
    # to 3 trial periods per chunk; zero would divide by zero.
    if not (math.isfinite(oversample) and oversample > 0):
        raise ValueError(f"oversample must be a positive number (got {oversample!r})")
    if int(max_periods) < 1:
        raise ValueError(f"max_periods must be at least 1 (got {max_periods!r})")
    if max_period is not None and not (math.isfinite(max_period) and max_period > 0):
        raise ValueError(f"max_period must be a positive number of days (got {max_period!r})")
    ok = np.isfinite(lc.time) & np.isfinite(lc.flux)
    t, f = lc.time[ok], lc.flux[ok]
    order = np.argsort(t, kind="stable")
    t, f = t[order], f[order]
    if t.size < 50:
        raise InsufficientDataError(f"BLS needs at least 50 valid cadences (got {t.size}).")
    baseline = float(t[-1] - t[0])
    if not min_period > 0:
        raise ValueError("min_period must be positive")
    if max_period is None:
        max_period = 0.5 * baseline
    max_period = float(min(max_period, baseline))
    if max_period <= min_period:
        raise InsufficientDataError(
            f"The light curve spans {baseline:.2f} d, too short to search periods from {min_period:g} d "
            "(at least two transits are needed)."
        )

    sigma = mad_std(f - np.median(f))
    if not (np.isfinite(sigma) and sigma > 0):
        raise InsufficientDataError("The light curve has no measurable scatter (constant flux?).")
    cadence = median_cadence(t)
    if bin_minutes and np.isfinite(cadence) and cadence < 0.9 * bin_minutes / 1440.0:
        tb, fb, cnt = bin_by_time(t, f, bin_minutes / 1440.0)
    else:
        tb, fb, cnt = t, f, np.ones(t.size, dtype=np.int64)
    dy = sigma / np.sqrt(cnt)

    # ---- coarse grid --------------------------------------------------------------------------
    user = tuple(float(d) for d in durations_hours) if durations_hours is not None else None
    n_chunks = max(1, math.ceil(math.log(max_period / min_period) / math.log(_CHUNK_RATIO)))
    edges = np.geomspace(min_period, max_period, n_chunks + 1)
    chunks = []
    for pa, pb in itertools.pairwise(edges):
        ds = _chunk_durations(float(pa), float(pb), user)
        if not ds:
            continue
        df = (min(ds) / 24.0) / (oversample * baseline * pb)
        n_c = math.ceil((1.0 / pa - 1.0 / pb) / df) + 1
        chunks.append((float(pa), float(pb), np.asarray(ds) / 24.0, n_c))
    if not chunks:
        raise ValueError("No trial duration is shorter than 25% of the trial periods; check durations_hours.")
    ideal = sum(c[3] for c in chunks)
    scale = max(1.0, ideal / float(max_periods))
    tasks: list[tuple[np.ndarray, np.ndarray]] = []
    for i, (pa, pb, ds, n_c) in enumerate(chunks):
        n_use = max(3, math.ceil(n_c / scale))
        periods = 1.0 / np.linspace(1.0 / pa, 1.0 / pb, n_use)
        if i > 0:
            periods = periods[1:]  # pa equals the previous chunk's pb
        for start in range(0, periods.size, _TASK_SIZE):
            tasks.append((periods[start : start + _TASK_SIZE], ds))

    if n_threads is None:
        n_threads = min(8, os.cpu_count() or 1)
    results = _run_tasks(tb, fb, dy, tasks, objective, _PHASE_OVERSAMPLE, n_threads)
    periods = np.concatenate([task[0] for task in tasks])
    power = np.concatenate([np.asarray(r.power, dtype=np.float64) for r in results])
    task_durations = [task[1] for task in tasks]
    coarse_duration = np.concatenate([np.asarray(r.duration, dtype=np.float64) for r in results])
    task_of = np.concatenate([np.full(task[0].size, i) for i, task in enumerate(tasks)])
    power = np.where(np.isfinite(power), power, np.nan)
    run_med, run_scale = _running_stats(power)
    excess = power - run_med
    norm = excess / run_scale
    if not np.isfinite(excess).any():
        raise InsufficientDataError("BLS found no valid trial (too few points in transit for every period).")

    # ---- pick distinct peaks and refine -------------------------------------------------------
    ranked = np.argsort(np.where(np.isfinite(excess), -excess, np.inf), kind="stable")
    picked: list[int] = []
    for i in ranked:
        if not np.isfinite(excess[i]):
            break
        if all(abs(periods[i] / periods[j] - 1.0) > 0.01 for j in picked):
            picked.append(int(i))
        if len(picked) >= _N_REFINE:
            break
    step = np.gradient(periods) if periods.size > 1 else np.asarray([periods[0] * 1e-3])
    refine_tasks = []
    for i in picked:
        p0 = float(periods[i])
        best_dur = float(coarse_duration[i])
        half_w = max(3.0 * abs(float(step[i])), 1e-6 * p0)
        dp_fine = p0 * p0 * (best_dur / (4.0 * oversample * baseline * p0))
        n_fine = int(np.clip(math.ceil(2 * half_w / max(dp_fine, 1e-12)) + 1, 21, 601))
        fine_periods = np.linspace(p0 - half_w, p0 + half_w, n_fine)
        fine_periods = fine_periods[fine_periods > 0]
        cand = set(np.round(np.asarray(task_durations[task_of[i]]) * 24.0, 6).tolist())
        cand |= {round(best_dur * 24.0 * r, 6) for r in (0.6, 0.7, 0.8, 0.9, 1.0, 1.12, 1.25, 1.4, 1.6)}
        fine_d = (
            np.asarray(sorted(d for d in cand if 0 < d < _MAX_DUTY_CYCLE * fine_periods.min() * 24.0)) / 24.0
        )
        if fine_d.size == 0:
            fine_d = np.asarray([best_dur])
        refine_tasks.append((fine_periods, fine_d))
    refined = _run_tasks(tb, fb, dy, refine_tasks, objective, 10, n_threads)

    # rank refined candidates by their power above the running median of the coarse periodogram
    best: dict[str, Any] | None = None
    top_peaks = []
    for i, (task, res) in enumerate(zip(refine_tasks, refined, strict=True)):
        rp = np.asarray(res.power, dtype=np.float64)
        rp = np.where(np.isfinite(rp), rp, -np.inf)
        j = int(np.argmax(rp))
        k = picked[i]
        excess_j = float(rp[j] - run_med[k])
        sde = excess_j / float(run_scale[k])
        entry = {
            "period": float(task[0][j]),
            "power": float(rp[j]),
            "sde": sde,
            "excess": excess_j,
            "grid_index": k,
            "duration_hours": float(np.asarray(res.duration)[j] * 24.0),
            "transit_time": float(np.asarray(res.transit_time)[j]),
            "depth": float(np.asarray(res.depth)[j]),
            "depth_err": float(np.asarray(res.depth_err)[j]),
            "depth_snr": float(np.asarray(res.depth_snr)[j]),
        }
        top_peaks.append({"period": entry["period"], "power": entry["power"], "sde": entry["sde"]})
        if best is None or entry["excess"] > best["excess"]:
            best = entry
    if best is None:  # pragma: no cover - picked is never empty when excess has a finite value
        raise InsufficientDataError("BLS refinement failed.")

    # final zoom on the winner: 10x finer periods and durations, finer phase bins
    p_best, d_best = best["period"], best["duration_hours"] / 24.0
    dp_zoom = p_best * d_best / (40.0 * oversample * baseline)
    zoom_periods = np.linspace(p_best - 30 * dp_zoom, p_best + 30 * dp_zoom, 61)
    zoom_d = np.asarray(
        [
            d_best * r
            for r in (0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.18)
            if d_best * r < _MAX_DUTY_CYCLE * zoom_periods.min()
        ]
    )
    if zoom_d.size == 0:
        zoom_d = np.asarray([d_best])
    zres = _run_tasks(tb, fb, dy, [(zoom_periods, zoom_d)], objective, 20, 1)[0]
    zp = np.where(np.isfinite(np.asarray(zres.power)), np.asarray(zres.power, dtype=np.float64), -np.inf)
    j = int(np.argmax(zp))
    if zp[j] >= best["power"]:
        k = best["grid_index"]
        best.update(
            period=float(zoom_periods[j]),
            power=float(zp[j]),
            excess=float(zp[j] - run_med[k]),
            sde=float((zp[j] - run_med[k]) / run_scale[k]),
            duration_hours=float(np.asarray(zres.duration)[j] * 24.0),
            transit_time=float(np.asarray(zres.transit_time)[j]),
            depth=float(np.asarray(zres.depth)[j]),
            depth_err=float(np.asarray(zres.depth_err)[j]),
            depth_snr=float(np.asarray(zres.depth_snr)[j]),
        )

    period = best["period"]
    dur_days = best["duration_hours"] / 24.0
    tt = best["transit_time"]
    k0 = math.ceil((t[0] - 0.5 * dur_days - tt) / period)
    epoch = tt + k0 * period
    eph = Ephemeris(
        period_days=period,
        epoch=epoch,
        duration_hours=best["duration_hours"],
        depth_ppm=best["depth"] * 1e6,
        source="measured",
        label="BLS",
    )
    expected, observed = count_transits(t, eph)
    p_ds, pow_ds, norm_ds = _downsample_peaks(
        periods, power, norm, key=excess, max_points=MAX_PERIODOGRAM_POINTS
    )
    return {
        "period": period,
        "epoch": float(epoch),
        "duration_hours": best["duration_hours"],
        "depth_ppm": best["depth"] * 1e6,
        "depth_err_ppm": best["depth_err"] * 1e6,
        "snr": best["depth_snr"],
        "power_peak": best["power"],
        "sde": best["sde"],
        "periods": p_ds,
        "power": pow_ds,
        "power_norm": norm_ds,
        "n_transits": observed,
        "n_transits_expected": expected,
        "baseline_days": baseline,
        "min_period": float(min_period),
        "max_period": float(max_period),
        "n_periods_searched": int(periods.size),
        "frequency_oversample_effective": float(oversample / scale),
        "bin_minutes": float(bin_minutes) if bin_minutes else None,
        "n_points": int(tb.size),
        "objective": objective,
        "top_peaks": top_peaks,
    }


def bls_ephemeris(result: dict[str, Any]) -> Ephemeris:
    """Ephemeris (``source="measured"``, ``label="BLS"``) from a :func:`run_bls` result."""
    return Ephemeris(
        period_days=float(result["period"]),
        epoch=float(result["epoch"]),
        duration_hours=float(result["duration_hours"]),
        depth_ppm=float(result["depth_ppm"]),
        source="measured",
        label="BLS",
    )


__all__ = [
    "DEFAULT_DURATIONS_HOURS",
    "MAX_PERIODOGRAM_POINTS",
    "bls_ephemeris",
    "central_duration_hours",
    "run_bls",
]
