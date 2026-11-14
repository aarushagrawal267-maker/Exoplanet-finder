"""Light-curve display payloads (Signal Explorer / Target page / uploads).

One function, :func:`build_payload`, turns a raw light curve into the ``/api/lightcurves`` payload:

* ``stages`` ``raw``, ``normalized``, ``trend`` and ``flat`` (each bin-averaged to at most
  ``max_points`` points for display; ``trend`` is the fitted trend model on the normalised curve);
* ``segments`` (Kepler quarters, or gap-based segments for uploads) and the ``cleaning`` report;
* with an ephemeris: predicted ``transit_times`` inside the data span and ``folded`` (phase in days,
  transit at 0) with a ``binned`` median curve over ``|phase| <= min(3 T14, P/2)``.

Processing uses the versioned astro pipeline: with a catalogue signal,
:func:`~exofinder.astro.pipeline.process_lightcurve` (its transits *and* the star's other known
signals are masked from the trend fit, exactly as for model views; a quality report is included);
otherwise :func:`~exofinder.astro.pipeline.preprocess_for_display` (a manual ephemeris is masked;
without an ephemeris nothing is masked). Results are kept in a small in-memory LRU cache keyed by the
light-curve file signature, detrending method, ephemeris and ``max_points``.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np
from sqlalchemy.orm import Session

from exofinder.astro.errors import InsufficientDataError
from exofinder.astro.fold import phase_fold
from exofinder.astro.pipeline import PipelineConfig, preprocess_for_display, process_lightcurve
from exofinder.astro.types import Ephemeris, LightCurve
from exofinder.config import PIPELINE_VERSION
from exofinder.db.models import Signal
from exofinder.services.sci_common import (
    FLUX_DIGITS,
    TIME_DIGITS,
    LruCache,
    binned_median,
    ephemeris_dict,
    ephemeris_key,
    make_ephemeris,
    predicted_transit_times,
    to_list,
    transit_window,
)
from exofinder.services.sci_errors import bad_request, not_found
from exofinder.services.sci_sources import SourceData, load_catalog_source, load_upload_source
from exofinder.services.signal_views import SignalEphemerisError, ephemeris_for_signal, sibling_ephemerides

DETREND_METHODS = ("spline", "savgol")
DEFAULT_MAX_POINTS = 20000
MAX_MAX_POINTS = 50000
BINNED_BINS = 120
_CACHE = LruCache(12)


def clear_cache() -> None:
    _CACHE.clear()


def _stage(stage: dict[str, Any] | None, xname: str = "time") -> dict[str, Any] | None:
    if not stage:
        return None
    return {
        xname: np.asarray(stage[xname], dtype=np.float64),
        "flux": np.asarray(stage["flux"], dtype=np.float64),
        "n_original": int(stage.get("n_original") or 0),
    }


def _segments(raw: LightCurve, flat: LightCurve) -> list[dict[str, Any]]:
    """Per-segment extent and cadence counts (raw cadences and cadences kept after processing)."""
    out = []
    seg_raw = raw.segment
    seg_flat = flat.segment
    ids = sorted(int(s) for s in np.unique(seg_raw)) if seg_raw is not None else (
        sorted(int(s) for s in np.unique(seg_flat)) if seg_flat is not None else []
    )
    for sid in ids:
        if sid < 0:
            continue
        in_raw = (seg_raw == sid) if seg_raw is not None else None
        in_flat = (seg_flat == sid) if seg_flat is not None else np.zeros(len(flat), dtype=bool)
        t = raw.time[in_raw] if in_raw is not None else flat.time[in_flat]
        t = t[np.isfinite(t)]
        if t.size == 0:
            continue
        out.append(
            {
                "id": sid,
                "t_start": float(t.min()),
                "t_end": float(t.max()),
                "n_cadences": int(in_raw.sum()) if in_raw is not None else int(in_flat.sum()),
                "n_used": int(in_flat.sum()),
            }
        )
    return out


def build_payload(
    src: SourceData,
    *,
    ephemeris: Ephemeris | None = None,
    other_ephemerides: list[Ephemeris] | None = None,
    catalogue_depth_ppm: float | None = None,
    detrend: str = "spline",
    max_points: int = DEFAULT_MAX_POINTS,
    use_cache: bool = True,
) -> dict[str, Any]:
    """Processed, display-ready (numpy) payload for ``src``; see module docstring."""
    if detrend not in DETREND_METHODS:
        raise bad_request(f"Unknown detrending method '{detrend}'", "invalid_parameters", "Use spline or savgol.")
    max_points = int(max(100, min(int(max_points), MAX_MAX_POINTS)))
    use_full = other_ephemerides is not None and ephemeris is not None
    key = (
        src.cache_key,
        detrend,
        max_points,
        ephemeris_key(ephemeris),
        tuple(ephemeris_key(e) for e in other_ephemerides or ()),
        use_full,
    )

    def compute() -> dict[str, Any]:
        return _compute(src, ephemeris, other_ephemerides, catalogue_depth_ppm, detrend, max_points, use_full)

    if not use_cache:
        payload, cached = compute(), False
    else:
        payload, cached = _CACHE.get_or_compute(key, compute)
    return {**payload, "cached": cached}


def _compute(
    src: SourceData,
    eph: Ephemeris | None,
    others: list[Ephemeris] | None,
    catalogue_depth_ppm: float | None,
    detrend: str,
    max_points: int,
    use_full: bool,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    raw = src.lc
    cfg = PipelineConfig(detrend_method=detrend, keep_stages=True, max_stage_points=max_points)
    quality = None
    try:
        if use_full and eph is not None:
            processed = process_lightcurve(
                raw, eph, cfg, catalogue_depth_ppm=catalogue_depth_ppm, other_ephemerides=others or ()
            )
            flat, stages, reports = processed.flat, processed.stages, processed.stages.get("reports", {})
            quality = processed.quality.to_dict()
        else:
            d = preprocess_for_display(raw, eph, cfg)
            flat, stages, reports = d["flat"], d["stages"], d["reports"]
    except InsufficientDataError as exc:
        raise bad_request(str(exc), "insufficient_data") from exc
    except ValueError as exc:
        raise bad_request(str(exc), "invalid_parameters") from exc
    assert flat is not None
    warnings = list(src.warnings)
    folded = None
    transit_times = None
    if eph is not None:
        phase = phase_fold(flat.time, eph.period_days, eph.epoch)
        fstage = _stage(stages.get("folded"), "phase")
        w = transit_window(eph)
        bx, by = binned_median(phase, flat.flux, -w, w, BINNED_BINS)
        if fstage is not None:
            folded = {
                **fstage,
                "binned": {"phase": bx, "flux": by, "window_days": w, "bin_width_days": 2 * w / BINNED_BINS},
            }
        t = flat.time[np.isfinite(flat.time)]
        transit_times = predicted_transit_times(float(t.min()), float(t.max()), eph) if t.size else []
        if not transit_times:
            warnings.append("No transit of this ephemeris falls inside the observed time span.")
        elif len(transit_times) < 2:
            warnings.append("Only one transit of this ephemeris falls inside the observed time span.")
    quarters = [int(q) for q in raw.meta.get("quarters") or []]
    if not quarters and src.kind == "catalog" and raw.segment is not None:
        quarters = sorted(int(q) for q in np.unique(raw.segment) if q >= 0)
    return {
        "source": src.describe(),
        "kepid": src.kepid,
        "upload_id": src.upload_id,
        "time_system": src.time_system,
        "mission": str(raw.meta.get("mission") or "unknown"),
        "n_cadences": len(raw),
        "n_points_final": len(flat),
        "quarters": quarters,
        "segments": _segments(raw, flat),
        "cleaning": reports,
        "stages": {name: _stage(stages.get(name)) for name in ("raw", "normalized", "trend", "flat")},
        "transit_times": transit_times,
        "folded": folded,
        "ephemeris": ephemeris_dict(eph, src.time_system) if eph is not None else None,
        "quality": quality,
        "detrend": detrend,
        "max_points": max_points,
        "pipeline_version": PIPELINE_VERSION,
        "config": cfg.to_dict(),
        "warnings": warnings,
        "processing_ms": (time.perf_counter() - t0) * 1000.0,
    }


def to_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Numpy payload -> JSON-ready dict with display rounding."""
    out = dict(payload)
    stages = {}
    for name, st in payload["stages"].items():
        stages[name] = (
            None
            if st is None
            else {
                "time": to_list(st["time"], TIME_DIGITS),
                "flux": to_list(st["flux"], FLUX_DIGITS),
                "n_original": st["n_original"],
            }
        )
    out["stages"] = stages
    f = payload.get("folded")
    if f is not None:
        out["folded"] = {
            "phase": to_list(f["phase"], TIME_DIGITS),
            "flux": to_list(f["flux"], FLUX_DIGITS),
            "n_original": f["n_original"],
            "binned": {
                "phase": to_list(f["binned"]["phase"], TIME_DIGITS),
                "flux": to_list(f["binned"]["flux"], FLUX_DIGITS),
                "window_days": f["binned"]["window_days"],
                "bin_width_days": f["binned"]["bin_width_days"],
            },
        }
    if payload.get("transit_times") is not None:
        out["transit_times"] = to_list(payload["transit_times"], TIME_DIGITS)
    return out


def _manual_ephemeris(
    period: float | None, epoch: float | None, duration_hours: float | None
) -> Ephemeris | None:
    given = [v is not None for v in (period, epoch, duration_hours)]
    if not any(given):
        return None
    if not all(given):
        raise bad_request(
            "A manual ephemeris needs period, epoch and duration_hours together.",
            "invalid_ephemeris",
            "Pass all three query parameters, or a signal_id to use the catalogue ephemeris.",
        )
    return make_ephemeris(period, epoch, duration_hours, source="manual", label="Manual")


def catalog_lightcurve(
    session: Session,
    kepid: int,
    *,
    signal_id: int | None = None,
    period: float | None = None,
    epoch: float | None = None,
    duration_hours: float | None = None,
    detrend: str = "spline",
    max_points: int = DEFAULT_MAX_POINTS,
) -> dict[str, Any]:
    """``GET /api/lightcurves/{kepid}`` (404 ``not_downloaded`` when the star is not cached)."""
    src = load_catalog_source(session, kepid, missing_status=404)
    eph = _manual_ephemeris(period, epoch, duration_hours)
    others = None
    depth = None
    if signal_id is not None:
        if eph is not None:
            raise bad_request(
                "Give either signal_id or a manual ephemeris, not both.", "invalid_ephemeris"
            )
        signal = session.get(Signal, int(signal_id))
        if signal is None:
            raise not_found(f"Signal {signal_id}", "signal_not_found")
        if signal.kepid != int(kepid):
            raise bad_request(
                f"Signal {signal.signal_key} belongs to KIC {signal.kepid}, not KIC {kepid}.", "signal_mismatch"
            )
        try:
            eph = ephemeris_for_signal(signal)
        except SignalEphemerisError as exc:
            raise bad_request(str(exc), "no_ephemeris") from exc
        others = sibling_ephemerides(session, signal)
        depth = signal.depth_ppm
    payload = build_payload(
        src,
        ephemeris=eph,
        other_ephemerides=others,
        catalogue_depth_ppm=depth,
        detrend=detrend,
        max_points=max_points,
    )
    if signal_id is not None:
        payload["signal_id"] = int(signal_id)
    return to_response(payload)


def upload_lightcurve(
    session: Session,
    upload_id: str,
    *,
    period: float | None = None,
    epoch: float | None = None,
    duration_hours: float | None = None,
    detrend: str = "spline",
    max_points: int = DEFAULT_MAX_POINTS,
) -> dict[str, Any]:
    """``GET /api/uploads/{id}/lightcurve`` (409 ``upload_not_parsed`` before parsing)."""
    src = load_upload_source(session, upload_id, missing_status=409)
    eph = _manual_ephemeris(period, epoch, duration_hours)
    return to_response(build_payload(src, ephemeris=eph, detrend=detrend, max_points=max_points))
