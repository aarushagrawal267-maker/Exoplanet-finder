"""Catalogue signal -> processed model views, with an on-disk cache.

Shared by the dataset builder, predictions on catalogue signals and the Dataset Explorer. One signal is
processed with the versioned astro pipeline on its star's cached light curve, using the catalogue
ephemeris. The other signals on the same star are masked from the trend fit (their transits stay in
the data). Results are cached in ``data/views/v<pipeline>/<config-hash>/<signal_key>.npz`` and the
cache is invalidated when the star's light-curve cache changes (its SHA-256 is part of the entry).
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import math
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from exofinder.astro.features import FEATURE_NAMES
from exofinder.astro.pipeline import PipelineConfig, process_lightcurve
from exofinder.astro.types import Ephemeris, LightCurve
from exofinder.config import PIPELINE_VERSION, get_settings
from exofinder.data._util import replace_with_retry
from exofinder.data.lightcurve_store import cache_digest, load_lightcurve
from exofinder.db.models import Signal

log = logging.getLogger("exofinder.services.signal_views")

CACHE_FORMAT = 1


class SignalNotDownloadedError(RuntimeError):
    """The star's light curve is not in the local cache (download it first)."""

    def __init__(self, kepid: int) -> None:
        super().__init__(f"No light curve downloaded for KIC {kepid}")
        self.kepid = kepid


class SignalEphemerisError(ValueError):
    """The catalogue has no usable ephemeris for this signal (missing/invalid period, epoch or duration)."""


@dataclass
class SignalViews:
    signal_id: int
    signal_key: str
    kepid: int
    global_view: np.ndarray
    local_view: np.ndarray
    global_phase: np.ndarray
    local_phase: np.ndarray
    features: np.ndarray  # float32, order = feature_names
    feature_names: list[str]
    quality: dict[str, Any]  # QualityReport.to_dict()
    ephemeris: dict[str, Any]  # Ephemeris.to_dict()
    diagnostics: dict[str, Any] | None = None  # JSON-safe diagnostics bundle (None when loaded from cache)
    pipeline_version: str = PIPELINE_VERSION
    config_hash: str = ""
    lc_digest: str | None = None
    from_cache: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


def config_hash(config: PipelineConfig) -> str:
    """Short, stable hash of the processing configuration (part of the view-cache path)."""
    blob = json.dumps(config.to_dict(), sort_keys=True, default=str).encode()
    return hashlib.sha256(blob).hexdigest()[:12]


def _finite(x: float | None) -> bool:
    return x is not None and math.isfinite(float(x))


def ephemeris_for_signal(signal: Signal) -> Ephemeris:
    """Catalogue ephemeris (BKJD) of a signal; raises :class:`SignalEphemerisError` if incomplete."""
    p, t0, d = signal.period_days, signal.epoch_bkjd, signal.duration_hours
    if not (_finite(p) and _finite(t0) and _finite(d)) or p <= 0 or d <= 0:
        raise SignalEphemerisError(
            f"{signal.signal_key} has no complete catalogue ephemeris (period={p}, epoch={t0}, duration={d})"
        )
    if d / 24.0 >= p:
        raise SignalEphemerisError(
            f"{signal.signal_key}: duration {d} h is not shorter than the period {p} d"
        )
    return Ephemeris(
        period_days=float(p),
        epoch=float(t0),
        duration_hours=float(d),
        depth_ppm=float(signal.depth_ppm) if _finite(signal.depth_ppm) else None,
        source="catalogue",
        label=signal.signal_key,
    )


def sibling_ephemerides(session: Session, signal: Signal) -> list[Ephemeris]:
    """Usable ephemerides of the other (non-retired) signals on the same star."""
    others = session.scalars(
        select(Signal).where(
            Signal.kepid == signal.kepid, Signal.id != signal.id, Signal.category != "retired"
        )
    )
    out: list[Ephemeris] = []
    for o in others:
        try:
            out.append(ephemeris_for_signal(o))
        except SignalEphemerisError:
            continue
    return out


def _cache_path(signal_key: str, chash: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in signal_key)
    return get_settings().views_dir / chash / f"{safe}.npz"


def _load_cached(path: Path, lc_digest: str | None) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        with np.load(path, allow_pickle=False) as z:
            meta = json.loads(str(z["meta"]))
            if meta.get("format") != CACHE_FORMAT or meta.get("pipeline_version") != PIPELINE_VERSION:
                return None
            if lc_digest is not None and meta.get("lc_digest") != lc_digest:
                return None
            return {
                "global_view": z["global_view"].astype(np.float32),
                "local_view": z["local_view"].astype(np.float32),
                "global_phase": z["global_phase"].astype(np.float64),
                "local_phase": z["local_phase"].astype(np.float64),
                "features": z["features"].astype(np.float32),
                "meta": meta,
            }
    except Exception:  # corrupt/partial cache entries are simply recomputed
        return None


def _save_cached(path: Path, sv: SignalViews) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "format": CACHE_FORMAT,
        "pipeline_version": sv.pipeline_version,
        "config_hash": sv.config_hash,
        "lc_digest": sv.lc_digest,
        "signal_key": sv.signal_key,
        "kepid": sv.kepid,
        "feature_names": sv.feature_names,
        "quality": sv.quality,
        "ephemeris": sv.ephemeris,
    }
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp.npz")
    os.close(fd)
    try:
        np.savez_compressed(
            tmp,
            global_view=sv.global_view,
            local_view=sv.local_view,
            global_phase=sv.global_phase,
            local_phase=sv.local_phase,
            features=sv.features,
            meta=np.array(json.dumps(meta, default=_json_default)),
        )
        # On Windows the replace fails (sharing violation) while another thread or a dataset-build
        # worker is reading the current entry with np.load. The cache is only an optimisation: retry
        # briefly, then keep the freshly computed views and leave the existing entry in place.
        replace_with_retry(tmp, path)
    except PermissionError as exc:
        log.warning("view cache %s is in use; not updated (%s)", path, exc)
    finally:
        if os.path.exists(tmp):
            with contextlib.suppress(OSError):
                os.unlink(tmp)


def _json_default(o: Any) -> Any:
    if isinstance(o, np.generic):
        return o.item()
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def compute_signal_views(
    session: Session,
    signal: Signal,
    *,
    config: PipelineConfig | None = None,
    lc: LightCurve | None = None,
    use_cache: bool = True,
    with_diagnostics: bool = False,
) -> SignalViews:
    """Process one catalogue signal into model views (cached).

    Raises :class:`SignalNotDownloadedError` when the light curve is not cached locally (callers that
    may download should call :func:`exofinder.data.acquire.ensure_lightcurve` first),
    :class:`SignalEphemerisError` for an unusable catalogue ephemeris, and the astro pipeline's
    ``InsufficientDataError`` / ``ValueError`` when the data cannot be processed.
    ``with_diagnostics=True`` bypasses the cache read so the full diagnostics bundle is returned.
    """
    cfg = config or PipelineConfig()
    chash = config_hash(cfg)
    eph = ephemeris_for_signal(signal)
    digest = cache_digest(signal.kepid)
    if digest is None and lc is None:
        raise SignalNotDownloadedError(signal.kepid)
    path = _cache_path(signal.signal_key, chash)
    if use_cache and not with_diagnostics:
        cached = _load_cached(path, digest)
        if cached is not None:
            m = cached["meta"]
            return SignalViews(
                signal_id=signal.id,
                signal_key=signal.signal_key,
                kepid=signal.kepid,
                global_view=cached["global_view"],
                local_view=cached["local_view"],
                global_phase=cached["global_phase"],
                local_phase=cached["local_phase"],
                features=cached["features"],
                feature_names=list(m["feature_names"]),
                quality=m["quality"],
                ephemeris=m["ephemeris"],
                config_hash=chash,
                lc_digest=digest,
                from_cache=True,
            )
    if lc is None:
        lc = load_lightcurve(signal.kepid)
        if lc is None:
            raise SignalNotDownloadedError(signal.kepid)
    processed = process_lightcurve(
        lc,
        eph,
        cfg,
        catalogue_depth_ppm=eph.depth_ppm,
        other_ephemerides=sibling_ephemerides(session, signal),
    )
    names = list(FEATURE_NAMES)
    feats = np.array([processed.features[n] for n in names], dtype=np.float32)
    views = processed.views
    sv = SignalViews(
        signal_id=signal.id,
        signal_key=signal.signal_key,
        kepid=signal.kepid,
        global_view=np.asarray(views.global_view, dtype=np.float32),
        local_view=np.asarray(views.local_view, dtype=np.float32),
        global_phase=np.asarray(views.global_phase, dtype=np.float64),
        local_phase=np.asarray(views.local_phase, dtype=np.float64),
        features=feats,
        feature_names=names,
        quality=processed.quality.to_dict(),
        ephemeris=eph.to_dict(),
        diagnostics=processed.stages.get("diagnostics"),
        config_hash=chash,
        lc_digest=digest,
        from_cache=False,
        extra={"processed": processed},
    )
    if use_cache and digest is not None:
        _save_cached(path, sv)
    return sv
