"""Interactive analysis tools (``/api/analysis``): BLS search, transit analysis, injection–recovery.

Provenance rules
----------------
* Everything computed here from the light curve is ``measured`` (source: this pipeline version).
* Values copied from NASA tables are ``catalogue``.
* Quantities derived from measured + catalogue values under simplifying assumptions (planet radius
  from depth x stellar radius, a/R*, equilibrium temperature) are ``estimate`` and say which
  assumptions they make. They are never presented as measurements.
* The injection–recovery tool injects a **synthetic** transit into a copy of a real light curve; its
  response is flagged ``synthetic: true`` and nothing from it is stored.
"""

from __future__ import annotations

import math
import time
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from exofinder.astro.bls import bls_ephemeris, run_bls
from exofinder.astro.diagnostics import compute_diagnostics
from exofinder.astro.errors import InsufficientDataError
from exofinder.astro.fold import phase_fold
from exofinder.astro.inject import inject_transit
from exofinder.astro.pipeline import PipelineConfig, preprocess_for_display, process_lightcurve
from exofinder.astro.transit_fit import trapezoid_shape
from exofinder.astro.transit_mask import combined_transit_mask
from exofinder.astro.types import Ephemeris, LightCurve
from exofinder.config import PIPELINE_VERSION
from exofinder.db.models import Signal, Target
from exofinder.services.jsonutil import to_jsonable
from exofinder.services.sci_common import (
    FLUX_DIGITS,
    MEASURED_SOURCE,
    TIME_DIGITS,
    LruCache,
    binned_median,
    ephemeris_dict,
    ephemeris_key,
    finite,
    make_ephemeris,
    pv,
    to_list,
    transit_window,
)
from exofinder.services.sci_errors import bad_request, not_found
from exofinder.services.sci_sources import SourceData, load_catalog_source, load_source
from exofinder.services.signal_views import SignalEphemerisError, ephemeris_for_signal
from exofinder.services.targets import stellar_params

R_SUN_IN_R_EARTH = 6.957e8 / 6.3781e6  # IAU nominal solar radius / Earth equatorial radius
R_SUN_M = 6.957e8
M_SUN_KG = 1.98847e30
G_SI = 6.674e-11
AU_M = 1.495978707e11
ASSUMED_ALBEDO = 0.3
_FLAT_CACHE = LruCache(6)
_BLS_CACHE = LruCache(16)
_TRANSIT_CACHE = LruCache(16)
MAX_PEAKS = 5


def clear_caches() -> None:
    for c in (_FLAT_CACHE, _BLS_CACHE, _TRANSIT_CACHE):
        c.clear()


def _astro_errors(exc: Exception):
    if isinstance(exc, InsufficientDataError):
        return bad_request(
            str(exc), "insufficient_data", "The light curve has too little usable data for this."
        )
    return bad_request(str(exc), "invalid_parameters")


# ------------------------------------------------------------------------------------------------
# BLS
# ------------------------------------------------------------------------------------------------
def flat_for_bls(src: SourceData, detrend: str = "spline") -> LightCurve:
    """Flattened light curve without any transit mask (cached per source)."""

    def compute() -> LightCurve:
        try:
            return preprocess_for_display(
                src.lc, None, PipelineConfig(detrend_method=detrend, keep_stages=False)
            )["flat"]
        except (InsufficientDataError, ValueError) as exc:
            raise _astro_errors(exc) from exc

    flat, _ = _FLAT_CACHE.get_or_compute((src.cache_key, detrend), compute)
    return flat


def bls_result(
    src: SourceData, min_period: float | None = None, max_period: float | None = None
) -> tuple[dict, float, bool]:
    """Cached :func:`run_bls` result for a source: ``(result, compute_ms, from_cache)``."""
    lo = float(min_period) if min_period is not None else 0.5
    key = (src.cache_key, round(lo, 6), None if max_period is None else round(float(max_period), 6))

    def compute() -> tuple[dict, float]:
        flat = flat_for_bls(src)
        t0 = time.perf_counter()
        try:
            res = run_bls(flat, min_period=lo, max_period=max_period)
        except (InsufficientDataError, ValueError) as exc:
            raise _astro_errors(exc) from exc
        return res, (time.perf_counter() - t0) * 1000.0

    (res, ms), cached = _BLS_CACHE.get_or_compute(key, compute)
    return res, ms, cached


def _alias(p: float, best: float) -> str | None:
    for ratio, name in (
        (0.5, "P/2"),
        (2.0, "2P"),
        (1 / 3, "P/3"),
        (3.0, "3P"),
        (2 / 3, "2P/3"),
        (1.5, "3P/2"),
    ):
        if abs(p / best - ratio) < 0.01 * ratio:
            return name
    return None


def top_peaks(res: dict[str, Any], n: int = MAX_PEAKS) -> list[dict[str, Any]]:
    """Distinct periodogram peaks (> 1% apart): the best period first, then the other refined peaks,
    then local maxima of the normalised power."""
    best = float(res["period"])
    peaks: list[dict[str, Any]] = [
        {
            "period": best,
            "power": finite(res.get("power_peak")),
            "sde": finite(res.get("sde")),
            "refined": True,
        }
    ]

    def distinct(p: float) -> bool:
        return all(abs(p / q["period"] - 1.0) > 0.01 for q in peaks)

    for tp in sorted(res.get("top_peaks") or [], key=lambda d: -(finite(d.get("sde")) or -1e9)):
        p = float(tp["period"])
        if distinct(p):
            peaks.append(
                {"period": p, "power": finite(tp.get("power")), "sde": finite(tp.get("sde")), "refined": True}
            )
    periods = np.asarray(res["periods"], dtype=np.float64)
    norm = np.asarray(res.get("power_norm", res["power"]), dtype=np.float64)
    power = np.asarray(res["power"], dtype=np.float64)
    order = np.argsort(np.where(np.isfinite(norm), -norm, np.inf), kind="stable")
    for i in order:
        if len(peaks) >= n or not np.isfinite(norm[i]):
            break
        p = float(periods[i])
        if distinct(p):
            peaks.append({"period": p, "power": finite(power[i]), "sde": finite(norm[i]), "refined": False})
    peaks = peaks[:1] + sorted(peaks[1:], key=lambda d: -(d["sde"] if d["sde"] is not None else -1e9))
    for rank, pk in enumerate(peaks[:n], 1):
        pk["rank"] = rank
        pk["is_best"] = rank == 1
        pk["alias_of_best"] = None if rank == 1 else _alias(pk["period"], best)
    return peaks[:n]


def bls(
    session: Session, source: dict[str, Any], min_period: float | None, max_period: float | None
) -> dict[str, Any]:
    """``POST /api/analysis/bls``."""
    src = load_source(session, source, missing_status=409)
    if min_period is not None and max_period is not None and max_period <= min_period:
        raise bad_request("max_period must be larger than min_period", "invalid_parameters")
    res, ms, cached = bls_result(src, min_period, max_period)
    eph = bls_ephemeris(res)
    warnings = list(src.warnings)
    warnings.append(
        "BLS proposes the strongest box-shaped periodic dip; it can lock onto aliases (P/2, 2P) or onto "
        "another planet of the same star. Inspect the folded light curve before using the ephemeris."
    )
    if (res.get("n_transits") or 0) < 2:
        warnings.append("Fewer than two transits are covered at the best period.")
    best = {
        "period": float(res["period"]),
        "epoch": float(res["epoch"]),
        "duration_hours": float(res["duration_hours"]),
        "depth_ppm": finite(res["depth_ppm"]),
        "depth_err_ppm": finite(res.get("depth_err_ppm")),
        "snr": finite(res["snr"]),
        "sde": finite(res.get("sde")),
        "power": finite(res.get("power_peak")),
        "n_transits": int(res.get("n_transits") or 0),
        "n_transits_expected": int(res.get("n_transits_expected") or 0),
        "provenance": "measured",
        "source": f"BLS, {MEASURED_SOURCE}",
    }
    return to_jsonable(
        {
            "source": src.describe(),
            "provenance": "measured",
            "periods": to_list(res["periods"], 7),
            "power": to_list(res["power"], 4),
            "power_norm": to_list(res.get("power_norm", []), 4),
            "best": best,
            "peaks": top_peaks(res),
            "ephemeris": ephemeris_dict(eph, src.time_system),
            "search": {
                "min_period": finite(res.get("min_period")),
                "max_period": finite(res.get("max_period")),
                "baseline_days": finite(res.get("baseline_days")),
                "n_periods_searched": int(res.get("n_periods_searched") or 0),
                "frequency_oversample_effective": finite(res.get("frequency_oversample_effective")),
                "bin_minutes": finite(res.get("bin_minutes")),
                "n_points": int(res.get("n_points") or 0),
                "objective": res.get("objective"),
            },
            "warnings": warnings,
            "compute_ms": ms,
            "cached": cached,
            "pipeline_version": PIPELINE_VERSION,
        }
    )


# ------------------------------------------------------------------------------------------------
# transit analysis
# ------------------------------------------------------------------------------------------------
def known_ephemerides(session: Session, kepid: int | None) -> list[Ephemeris]:
    """Usable catalogue ephemerides of every (non-retired) signal of a star."""
    return [e for _, e in _star_ephemerides(session, kepid)]


def same_signal(a: Ephemeris, b: Ephemeris) -> bool:
    """True when two ephemerides describe the same transits: periods within 1% and epochs within half
    the longer duration (modulo the period), as in the catalogue's TCE/KOI matching."""
    if abs(a.period_days / b.period_days - 1.0) > 0.01:
        return False
    dt = (a.epoch - b.epoch) % b.period_days
    dt = min(dt, b.period_days - dt)
    return dt <= 0.5 * max(a.duration_days, b.duration_days)


def other_known_ephemerides(
    session: Session, kepid: int | None, eph: Ephemeris, exclude_signal_id: int | None = None
) -> list[Ephemeris]:
    """Catalogue ephemerides of the star's *other* signals: everything except ``exclude_signal_id``
    and rows describing the same transits as ``eph`` (a secondary eclipse at the same period but
    half a period later is another signal and is included)."""
    return [
        e
        for sig_id, e in _star_ephemerides(session, kepid)
        if sig_id != exclude_signal_id and not same_signal(e, eph)
    ]


def _star_ephemerides(session: Session, kepid: int | None) -> list[tuple[int, Ephemeris]]:
    if kepid is None:
        return []
    out = []
    for sig in session.scalars(
        select(Signal).where(Signal.kepid == int(kepid), Signal.category != "retired")
    ):
        try:
            out.append((sig.id, ephemeris_for_signal(sig)))
        except SignalEphemerisError:
            continue
    return out


def _model_curve(
    fit: dict[str, Any], eph: Ephemeris, window: float, exposure: float | None
) -> dict[str, Any] | None:
    if not fit.get("converged") or fit.get("depth_ppm") is None:
        return None
    depth = fit["depth_ppm"] * 1e-6
    dur = fit["duration_hours"] / 24.0
    ingress = (fit.get("ingress_hours") or 0.0) / 24.0
    base = fit.get("baseline") or 1.0
    dt = (fit.get("epoch") or eph.epoch) - eph.epoch
    x = np.linspace(-window, window, 801)
    if exposure:
        offs = ((np.arange(7) + 0.5) / 7 - 0.5) * exposure
        shape = np.mean([trapezoid_shape(x - dt + o, dur, ingress) for o in offs], axis=0)
    else:
        shape = trapezoid_shape(x - dt, dur, ingress)
    return {
        "phase": to_list(x, TIME_DIGITS),
        "flux": to_list(base - depth * shape, FLUX_DIGITS),
        "model": "trapezoid (least squares on the folded light curve)"
        + (", exposure-averaged" if exposure else ""),
    }


def _derived(
    depth_ppm: float | None, depth_err: float | None, eph: Ephemeris, target: Target | None
) -> dict[str, Any]:
    """Estimates from measured depth/duration + catalogue stellar parameters (never measurements)."""
    est = "estimate"
    rstar = finite(target.radius) if target is not None else None
    mstar = finite(target.mass) if target is not None else None
    teff = finite(target.teff) if target is not None else None
    logg = finite(target.logg) if target is not None else None
    if mstar is None and rstar is not None and logg is not None:
        g = 10**logg / 100.0  # cgs -> SI
        mstar = g * (rstar * R_SUN_M) ** 2 / G_SI / M_SUN_KG
    out: dict[str, Any] = {}
    rp_note = (
        "Rp = sqrt(measured depth) x catalogue R*; ignores limb darkening, light from other stars "
        "(dilution) and the stellar-radius uncertainty. V-shaped/grazing signals give a lower limit."
    )
    if depth_ppm is not None and depth_ppm > 0 and rstar is not None:
        k = math.sqrt(depth_ppm * 1e-6)
        rp = k * rstar * R_SUN_IN_R_EARTH
        err = rp * 0.5 * (depth_err / depth_ppm) if depth_err else None
        out["planet_radius_re"] = pv(
            rp, "R_earth", est, "measured depth x catalogue stellar radius", err, note=rp_note
        )
        out["radius_ratio"] = pv(
            k, "Rp/R*", est, "sqrt(measured depth)", None, note="Assumes a non-grazing transit."
        )
    else:
        out["planet_radius_re"] = pv(
            None, "R_earth", est, "", None, note="Needs a measured depth and a catalogue stellar radius."
        )
        out["radius_ratio"] = pv(
            math.sqrt(depth_ppm * 1e-6) if depth_ppm and depth_ppm > 0 else None,
            "Rp/R*",
            est,
            "sqrt(measured depth)",
        )
    p_s = eph.period_days * 86400.0
    if mstar is not None and rstar is not None:
        a = (G_SI * mstar * M_SUN_KG * p_s**2 / (4 * math.pi**2)) ** (1 / 3)
        a_rs = a / (rstar * R_SUN_M)
        out["a_over_rstar"] = pv(
            a_rs,
            "",
            est,
            "Kepler's third law with catalogue M* and R*",
            None,
            note="Circular orbit, planet mass neglected."
            + (
                " M* from catalogue log g and R*."
                if target is not None and finite(target.mass) is None
                else ""
            ),
        )
        out["semi_major_axis_au"] = pv(a / AU_M, "AU", est, "Kepler's third law with catalogue M*", None)
        if teff is not None:
            teq = teff * math.sqrt(1.0 / (2.0 * a_rs)) * (1 - ASSUMED_ALBEDO) ** 0.25
            out["equilibrium_temp_k"] = pv(
                teq,
                "K",
                est,
                "catalogue Teff and a/R*",
                None,
                note=f"Bond albedo {ASSUMED_ALBEDO} assumed, full heat redistribution.",
            )
        else:
            out["equilibrium_temp_k"] = pv(None, "K", est, "", None, note="Needs a catalogue Teff.")
    else:
        out["a_over_rstar"] = pv(
            None, "", est, "", None, note="Needs catalogue stellar mass/radius (or log g and radius)."
        )
        out["semi_major_axis_au"] = pv(None, "AU", est, "")
        out["equilibrium_temp_k"] = pv(None, "K", est, "")
    out["a_over_rstar_from_duration"] = pv(
        eph.period_days / (math.pi * eph.duration_days),
        "",
        est,
        "period and T14 of the ephemeris",
        None,
        note="P / (pi T14): assumes a central transit (b = 0), circular orbit and Rp << R*.",
    )
    return out


def transit(
    session: Session,
    source: dict[str, Any],
    ephemeris: dict[str, Any],
    signal_id: int | None = None,
) -> dict[str, Any]:
    """``POST /api/analysis/transit``: full diagnostics at a given ephemeris."""
    src = load_source(session, source, missing_status=409)
    signal = None
    if signal_id is not None:
        signal = session.get(Signal, int(signal_id))
        if signal is None:
            raise not_found(f"Signal {signal_id}", "signal_not_found")
        if src.kind != "catalog" or signal.kepid != src.kepid:
            raise bad_request(
                f"Signal {signal.signal_key} does not belong to this light curve (KIC {signal.kepid}).",
                "signal_mismatch",
            )
    eph_source = ephemeris.get("source") or "manual"
    if eph_source not in ("catalogue", "measured", "manual"):
        eph_source = "manual"
    eph = make_ephemeris(
        ephemeris.get("period_days"),
        ephemeris.get("epoch"),
        ephemeris.get("duration_hours"),
        source=eph_source,
        label=ephemeris.get("label")
        or {"catalogue": "Catalogue", "measured": "BLS", "manual": "Manual"}[eph_source],
    )
    key = (src.cache_key, ephemeris_key(eph), signal.id if signal is not None else None)
    payload, cached = _TRANSIT_CACHE.get_or_compute(key, lambda: _transit_compute(session, src, eph, signal))
    return {**payload, "cached": cached}


def _transit_compute(
    session: Session, src: SourceData, eph: Ephemeris, signal: Signal | None
) -> dict[str, Any]:
    t0 = time.perf_counter()
    others = (
        other_known_ephemerides(session, src.kepid, eph, signal.id if signal else None)
        if src.kind == "catalog"
        else []
    )
    cat_period = finite(signal.period_days) if signal is not None else None
    same_as_catalogue = cat_period is not None and abs(eph.period_days / cat_period - 1.0) < 0.01
    cfg = PipelineConfig(keep_stages=True, max_stage_points=10000)
    try:
        processed = process_lightcurve(
            src.lc,
            eph,
            cfg,
            catalogue_depth_ppm=signal.depth_ppm if same_as_catalogue else None,
            other_ephemerides=others,
        )
    except (InsufficientDataError, ValueError) as exc:
        raise _astro_errors(exc) from exc
    diag = processed.stages.get("diagnostics") or {}
    fit = diag.get("transit_fit") or {}
    snr = diag.get("snr") or {}
    flat = processed.flat
    assert flat is not None
    window = transit_window(eph)
    phase = phase_fold(flat.time, eph.period_days, eph.epoch)
    bx, by = binned_median(phase, flat.flux, -window, window, 120)
    fstage = processed.stages.get("folded") or {"phase": [], "flux": [], "n_original": 0}
    exposure = finite(src.lc.meta.get("cadence_days"))
    m_src = MEASURED_SOURCE
    target = src.target
    depth_meas = fit.get("depth_ppm") if fit.get("converged") else snr.get("depth_ppm")
    depth_err = fit.get("depth_err_ppm") if fit.get("converged") else None
    cat = signal is not None
    cat_src = f"NASA catalogue ({signal.signal_key})" if cat else ""
    prov = signal.provenance if cat and signal.provenance else {}

    def cpv(value: Any, unit: str, field: str) -> dict[str, Any] | None:
        if not cat:
            return None
        p = prov.get(field) or {}
        src_txt = f"{p.get('table', 'NASA Exoplanet Archive')}.{p.get('column', field)}" if p else cat_src
        return pv(value, unit, "catalogue", src_txt)

    oe = diag.get("odd_even") or {}
    sec = diag.get("secondary") or {}
    derived = _derived(finite(depth_meas), finite(depth_err), eph, target)
    comparison = [
        {
            "quantity": "Period",
            "unit": "d",
            "catalogue": cpv(signal.period_days if cat else None, "d", "period_days"),
            "measured": pv(eph.period_days, "d", "measured", f"BLS, {m_src}")
            if eph.source == "measured"
            else None,
            "estimate": None,
        },
        {
            "quantity": "Epoch (transit centre)",
            "unit": src.time_system,
            "catalogue": cpv(signal.epoch_bkjd if cat else None, "BKJD", "epoch_bkjd"),
            "measured": pv(
                fit.get("epoch"), src.time_system, "measured", f"trapezoid fit, {m_src}", fit.get("epoch_err")
            ),
            "estimate": None,
        },
        {
            "quantity": "Duration T14",
            "unit": "h",
            "catalogue": cpv(signal.duration_hours if cat else None, "h", "duration_hours"),
            "measured": pv(
                fit.get("duration_hours"),
                "h",
                "measured",
                f"trapezoid fit, {m_src}",
                fit.get("duration_err_hours"),
            ),
            "estimate": None,
        },
        {
            "quantity": "Depth",
            "unit": "ppm",
            "catalogue": cpv(signal.depth_ppm if cat else None, "ppm", "depth_ppm"),
            "measured": pv(
                depth_meas,
                "ppm",
                "measured",
                f"{'trapezoid fit' if fit.get('converged') else 'transit-core depth'}, {m_src}",
                depth_err,
            ),
            "estimate": None,
        },
        {
            "quantity": "Signal-to-noise ratio",
            "unit": "",
            "catalogue": cpv(signal.model_snr if cat else None, "", "model_snr"),
            "measured": pv(snr.get("snr"), "", "measured", f"depth / CDPP(T14) x sqrt(N), {m_src}"),
            "estimate": None,
        },
        {
            "quantity": "Planet radius",
            "unit": "R_earth",
            "catalogue": cpv(signal.planet_radius_re if cat else None, "R_earth", "planet_radius_re"),
            "measured": None,
            "estimate": derived["planet_radius_re"],
        },
        {
            "quantity": "Ingress / T14 (shape)",
            "unit": "",
            "catalogue": None,
            "measured": pv(fit.get("shape_ratio"), "", "measured", f"trapezoid fit, {m_src}"),
            "estimate": None,
        },
        {
            "quantity": "Odd/even depth difference",
            "unit": "sigma",
            "catalogue": None,
            "measured": pv(oe.get("diff_sigma"), "sigma", "measured", m_src),
            "estimate": None,
        },
        {
            "quantity": "Secondary eclipse depth",
            "unit": "ppm",
            "catalogue": None,
            "measured": pv(sec.get("depth_ppm"), "ppm", "measured", m_src, sec.get("err_ppm")),
            "estimate": None,
        },
    ]
    warnings = list(src.warnings)
    q = processed.quality.to_dict()
    if q["grade"] in ("C", "D"):
        warnings.append(
            f"Data-quality grade {q['grade']}: " + "; ".join(q.get("messages") or q.get("issues") or [])
        )
    if signal is not None and not same_as_catalogue:
        warnings.append(
            f"The ephemeris period differs from the catalogue period of {signal.signal_key} by more than 1%."
        )
    folded_out = {
        "phase": to_list(fstage["phase"], TIME_DIGITS),
        "flux": to_list(fstage["flux"], FLUX_DIGITS),
        "n_original": int(fstage.get("n_original") or 0),
        "binned": {
            "phase": to_list(bx, TIME_DIGITS),
            "flux": to_list(by, FLUX_DIGITS),
            "window_days": window,
            "bin_width_days": 2 * window / 120,
        },
    }
    return to_jsonable(
        {
            "source": src.describe(),
            "signal_id": signal.id if signal else None,
            "ephemeris": ephemeris_dict(eph, src.time_system),
            "fit": {**fit, "provenance": "measured", "source": f"trapezoid least squares, {m_src}"},
            "odd_even": {**oe, "provenance": "measured"},
            "secondary": {**sec, "provenance": "measured"},
            "individual_transits": diag.get("individual_transits") or [],
            "snr": {**snr, "provenance": "measured"},
            "transit_count": diag.get("transit_count") or {},
            "noise": diag.get("noise") or {},
            "quality": q,
            "folded": folded_out,
            "model_curve": _model_curve(fit, eph, window, exposure),
            "comparison": comparison,
            "stellar": stellar_params(session, target),
            "derived": derived,
            "masked_other_signals": [ephemeris_dict(e, src.time_system) for e in others],
            "warnings": warnings,
            "pipeline_version": PIPELINE_VERSION,
            "compute_ms": (time.perf_counter() - t0) * 1000.0,
        }
    )


# ------------------------------------------------------------------------------------------------
# injection-recovery
# ------------------------------------------------------------------------------------------------
def injection(
    session: Session,
    kepid: int,
    period_days: float,
    depth_ppm: float,
    duration_hours: float,
    epoch: float | None = None,
    ingress_fraction: float = 0.1,
) -> dict[str, Any]:
    """Inject a synthetic trapezoid transit into a copy of a real cached light curve, search it blind
    with BLS (the star's known catalogue signals are masked first) and report what was recovered."""
    t_start = time.perf_counter()
    src = load_catalog_source(session, kepid, missing_status=409)
    raw = src.lc
    t = raw.time[np.isfinite(raw.time)]
    baseline = float(t.max() - t.min())
    if not (period_days > 0 and 0 < duration_hours / 24.0 < period_days):
        raise bad_request("The duration must be positive and shorter than the period.", "invalid_parameters")
    if period_days > baseline / 2:
        raise bad_request(
            f"Period {period_days:g} d is longer than half the {baseline:.0f}-d baseline: fewer than two "
            "transits could be observed.",
            "invalid_parameters",
            f"Use a period below {baseline / 2:.1f} d.",
        )
    if not (0 < depth_ppm < 1e6):
        raise bad_request("depth_ppm must be between 0 and 1,000,000.", "invalid_parameters")
    if not (0 < ingress_fraction <= 0.5):
        raise bad_request("ingress_fraction must be in (0, 0.5].", "invalid_parameters")
    if epoch is None:
        epoch = float(t.min()) + 0.37 * period_days  # deterministic, away from the data start
    exposure = finite(raw.meta.get("cadence_days"))
    injected = inject_transit(
        raw,
        period_days,
        float(epoch),
        duration_hours,
        depth_ppm,
        ingress_fraction=ingress_fraction,
        exposure_days=exposure,
    )
    assert injected.meta.get("synthetic") is True
    inj_eph = Ephemeris(
        period_days, float(epoch), duration_hours, depth_ppm, source="manual", label="Injected (synthetic)"
    )
    try:
        flat = preprocess_for_display(injected, None, PipelineConfig(keep_stages=False))["flat"]
    except (InsufficientDataError, ValueError) as exc:
        raise _astro_errors(exc) from exc
    known = known_ephemerides(session, kepid)
    warnings = list(src.warnings)
    clash = [e.label for e in known if abs(e.period_days / period_days - 1.0) < 0.01]
    if clash:
        warnings.append(
            f"The injected period is within 1% of known signal(s) {', '.join(clash)}; their transits are masked, "
            "which may also hide injected transits."
        )
    masked = 0
    if known:
        mask = combined_transit_mask(flat.time, known, 1.5)
        masked = int(mask.sum())
        flat = flat.select(~mask)
    min_p = min(0.5, 0.8 * period_days)
    try:
        res = run_bls(flat, min_period=min_p)
    except (InsufficientDataError, ValueError) as exc:
        raise _astro_errors(exc) from exc
    rec_p, rec_t0 = float(res["period"]), float(res["epoch"])
    period_ok = abs(rec_p / period_days - 1.0) < 0.01
    dt = (rec_t0 - float(epoch)) % period_days
    dt = min(dt, period_days - dt)
    epoch_tol = max(0.5 * duration_hours / 24.0, 1.0 / 24.0)
    epoch_ok = dt <= epoch_tol
    recovered_ok = bool(period_ok and epoch_ok)
    alias = None if period_ok else _alias(rec_p, period_days)
    known_match = None
    if not recovered_ok:
        for e in known:
            rel = _alias(rec_p, e.period_days) or ("P" if abs(rec_p / e.period_days - 1) < 0.01 else None)
            if rel:
                known_match = e.label if rel == "P" else f"{e.label} ({rel})"
                warnings.append(
                    f"The search locked onto the period of known signal {known_match} (P = {e.period_days:.5f} d): "
                    "residual variability at that period (e.g. ingress/egress or a phase curve outside the "
                    "masked windows) outweighs the injected transit."
                )
                break
    diag = compute_diagnostics(flat, inj_eph, include_transit_fit=False, max_events=0)
    phase = phase_fold(flat.time, period_days, float(epoch))
    w = transit_window(inj_eph)
    bx, by = binned_median(phase, flat.flux, -w, w, 120)
    rec_depth = finite(res["depth_ppm"])
    label = src.input_name
    return to_jsonable(
        {
            "synthetic": True,
            "label": (
                f"SYNTHETIC injection-recovery test on real {label} data. The injected transit is artificial; "
                "this result is not an observation and is never stored."
            ),
            "kepid": int(kepid),
            "injected": {
                "period_days": float(period_days),
                "epoch": float(epoch),
                "duration_hours": float(duration_hours),
                "depth_ppm": float(depth_ppm),
                "ingress_fraction": float(ingress_fraction),
                "model": "trapezoid, multiplicative" + (", exposure-averaged" if exposure else ""),
                "n_transits_in_data": int((diag.get("transit_count") or {}).get("observed") or 0),
                "snr_at_injected_ephemeris": finite((diag.get("snr") or {}).get("snr")),
            },
            "recovered": {
                "period_days": rec_p,
                "epoch": rec_t0,
                "duration_hours": float(res["duration_hours"]),
                "depth_ppm": rec_depth,
                "depth_err_ppm": finite(res.get("depth_err_ppm")),
                "snr": finite(res["snr"]),
                "sde": finite(res.get("sde")),
                "n_transits": int(res.get("n_transits") or 0),
                "method": "blind BLS on the detrended injected light curve (known catalogue signals masked)",
                "provenance": "measured",
            },
            "recovered_ok": recovered_ok,
            "criteria": {
                "period_rel_tol": 0.01,
                "epoch_tol_hours": epoch_tol * 24.0,
                "period_match": period_ok,
                "epoch_match": epoch_ok,
                "epoch_offset_hours": dt * 24.0,
                "alias_of_injected": alias,
                "matches_known_signal": known_match,
                "depth_ratio": (rec_depth / depth_ppm) if rec_depth is not None else None,
            },
            "masked_known_signals": [ephemeris_dict(e) for e in known],
            "warnings": warnings,
            "n_cadences_masked": masked,
            "periodogram": {
                "periods": to_list(res["periods"], 7),
                "power": to_list(res.get("power_norm", res["power"]), 4),
            },
            "folded_injected": {
                "phase": to_list(bx, TIME_DIGITS),
                "flux": to_list(by, FLUX_DIGITS),
                "window_days": w,
                "bin_width_days": 2 * w / 120,
            },
            "pipeline_version": PIPELINE_VERSION,
            "compute_ms": (time.perf_counter() - t_start) * 1000.0,
        }
    )
