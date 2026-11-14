"""Overview dashboard and diagnostics (``/api/system``).

Everything in the summary is counted from the real database and disk; nothing is estimated. The
``next_steps`` list is derived from that state so a fresh install shows what to do first.
Device information needs torch, whose import is slow, so it is computed once in a background
thread started when the router is imported and cached for the life of the process.
"""

from __future__ import annotations

import platform
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from importlib import metadata
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from exofinder import __version__
from exofinder.config import PIPELINE_VERSION, get_settings
from exofinder.db.models import (
    CatalogSnapshot,
    Dataset,
    Evaluation,
    Job,
    ModelVersion,
    Prediction,
    Signal,
    Target,
)
from exofinder.services import app_settings
from exofinder.services.sci_common import LruCache, dir_usage

_device_lock = threading.Lock()
_device_info: dict[str, Any] | None = None
_device_thread: threading.Thread | None = None
_disk_cache = LruCache(4)
_DISK_TTL_S = 30.0


# ------------------------------------------------------------------------------------------------
# device
# ------------------------------------------------------------------------------------------------
def _compute_device_info() -> dict[str, Any]:
    global _device_info
    try:
        from exofinder.ml.device import environment_info, resolve_device

        env = environment_info()
        pref = get_settings().device
        info = {
            "preference": pref,
            "device": str(resolve_device(pref)),
            "cuda_available": env.get("cuda_available"),
            "cuda_device": env.get("cuda_device"),
            "mps_available": env.get("mps_available"),
            "torch": env.get("torch"),
            "cpu_count": env.get("cpu_count"),
            "torch_num_threads": env.get("torch_num_threads"),
            "platform": env.get("platform"),
            "python": env.get("python"),
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001 - report, never fail the dashboard
        info = {"preference": get_settings().device, "device": None, "error": f"{type(exc).__name__}: {exc}"}
    with _device_lock:
        _device_info = info
    return info


def warm_device_info() -> None:
    """Start computing device info in a daemon thread (idempotent)."""
    global _device_thread
    with _device_lock:
        if _device_info is not None or (_device_thread is not None and _device_thread.is_alive()):
            return
        _device_thread = threading.Thread(target=_compute_device_info, name="exof-device-info", daemon=True)
        _device_thread.start()


def device_info(wait_s: float = 15.0) -> dict[str, Any]:
    """Cached device info; waits for the warm-up thread (or computes it) on first use."""
    with _device_lock:
        if _device_info is not None:
            info = dict(_device_info)
            info["preference"] = get_settings().device
            return info
        thread = _device_thread
    if thread is not None:
        thread.join(wait_s)
        with _device_lock:
            if _device_info is not None:
                return dict(_device_info)
        return {"preference": get_settings().device, "device": None, "error": "still detecting the device"}
    return _compute_device_info()


# ------------------------------------------------------------------------------------------------
# summary
# ------------------------------------------------------------------------------------------------
def _counts(session: Session, col) -> dict[str, int]:
    return {
        ("none" if k is None else str(k)): int(n)
        for k, n in session.execute(select(col, func.count()).group_by(col)).all()
    }


def _disk_bytes(path) -> int:
    key = str(path)
    hit = _disk_cache.get(key)
    now = time.monotonic()
    if hit is not None and now - hit[0] < _DISK_TTL_S:
        return hit[1]
    size, _ = dir_usage(path)
    _disk_cache.put(key, (now, size))
    return size


def _model_dict(m: ModelVersion | None, dataset_names: dict[int, str]) -> dict[str, Any] | None:
    if m is None:
        return None
    return {
        "id": m.id,
        "name": m.name,
        "model_type": m.model_type,
        "dataset_id": m.dataset_id,
        "dataset_name": dataset_names.get(m.dataset_id) if m.dataset_id is not None else None,
        "is_active": bool(m.is_active),
        "is_fixture": bool(m.is_fixture),
        "threshold": m.threshold,
        "val_metrics": m.val_metrics or {},
        "test_metrics": m.test_metrics or {},
        "created_at": m.created_at,
    }


def summary(session: Session) -> dict[str, Any]:
    """Dashboard payload (``running_jobs`` holds Job rows; the router serialises them)."""
    from exofinder.services.predictions import default_model, prediction_summaries

    s = get_settings()
    n_signals = int(session.scalar(select(func.count()).select_from(Signal)) or 0)
    n_targets = int(session.scalar(select(func.count()).select_from(Target)) or 0)
    latest_snaps = {}
    for snap in session.scalars(select(CatalogSnapshot).order_by(CatalogSnapshot.retrieved_at.desc())):
        latest_snaps.setdefault(snap.source, snap)
    last_refresh = max((sn.retrieved_at for sn in latest_snaps.values()), default=None)
    catalog = {
        "n_signals": n_signals,
        "n_targets": n_targets,
        "by_category": _counts(session, Signal.category),
        "by_av_label": _counts(session, Signal.av_training_set),
        "by_koi_disposition": _counts(session, Signal.koi_disposition),
        "label_conflicts": int(
            session.scalar(select(func.count()).select_from(Signal).where(Signal.label_conflict.is_(True)))
            or 0
        ),
        "last_refresh": last_refresh,
        "snapshot_ids": {src: sn.id for src, sn in sorted(latest_snaps.items())},
    }
    lc_counts = _counts(session, Target.lc_status)
    lightcurves = {
        "available": lc_counts.get("available", 0),
        "no_data": lc_counts.get("no_data", 0),
        "error": lc_counts.get("error", 0),
        "downloading": lc_counts.get("downloading", 0),
        "queued": lc_counts.get("queued", 0),
        "not_downloaded": lc_counts.get("none", 0),
        "disk_bytes": _disk_bytes(s.lightcurves_dir),
    }
    n_datasets = int(session.scalar(select(func.count()).select_from(Dataset)) or 0)
    latest_ds = session.scalars(select(Dataset).order_by(Dataset.id.desc())).first()
    dataset_names = dict(session.execute(select(Dataset.id, Dataset.name)).all())
    datasets = {
        "count": n_datasets,
        "n_ready": int(
            session.scalar(select(func.count()).select_from(Dataset).where(Dataset.status == "ready")) or 0
        ),
        "latest": None
        if latest_ds is None
        else {
            "id": latest_ds.id,
            "name": latest_ds.name,
            "status": latest_ds.status,
            "tier": latest_ds.tier,
            "label_mode": latest_ds.label_mode,
            "n_examples": latest_ds.n_examples,
            "created_at": latest_ds.created_at,
        },
    }
    n_models = int(session.scalar(select(func.count()).select_from(ModelVersion)) or 0)
    n_real_models = int(
        session.scalar(
            select(func.count()).select_from(ModelVersion).where(ModelVersion.is_fixture.is_(False))
        )
        or 0
    )
    active = session.scalars(
        select(ModelVersion).where(ModelVersion.is_active.is_(True)).order_by(ModelVersion.id.desc())
    ).first()
    try:
        default = default_model(session) if n_models else None
    except Exception:  # noqa: BLE001 - no default is a normal state
        default = None
    models = {
        "count": n_models,
        "n_real": n_real_models,
        "active": _model_dict(active, dataset_names),
        "default_model_id": app_settings.get_value("default_model_id", session),
        "default_for_predictions": _model_dict(default, dataset_names),
    }
    n_preds = int(session.scalar(select(func.count()).select_from(Prediction)) or 0)
    recent = list(session.scalars(select(Prediction).order_by(Prediction.id.desc()).limit(5)))
    predictions = {"count": n_preds, "recent": prediction_summaries(session, recent)}
    jobs = list(
        session.scalars(
            select(Job).where(Job.status.in_(("queued", "running"))).order_by(Job.created_at.desc())
        )
    )
    n_evals = int(session.scalar(select(func.count()).select_from(Evaluation)) or 0)
    steps = _next_steps(
        n_signals=n_signals,
        n_available=lightcurves["available"],
        n_ready=datasets["n_ready"],
        n_real_models=n_real_models,
        n_evals=n_evals,
        n_preds=n_preds,
    )
    return {
        "app_version": __version__,
        "pipeline_version": PIPELINE_VERSION,
        "catalog": catalog,
        "lightcurves": lightcurves,
        "datasets": datasets,
        "models": models,
        "predictions": predictions,
        "running_jobs": jobs,
        "device": device_info(),
        "checklist": steps,
        "next_steps": [st for st in steps if not st["done"]],
        "disclaimer": (
            "Exoplanet Finder classifies transit-like signals as planet-like or false-positive-like. "
            "Planet-like scores are research leads, not discoveries."
        ),
    }


def _next_steps(
    *, n_signals: int, n_available: int, n_ready: int, n_real_models: int, n_evals: int, n_preds: int
) -> list[dict[str, Any]]:
    return [
        {
            "key": "refresh_catalog",
            "title": "Refresh the NASA catalogue",
            "description": "Download Kepler DR24 TCEs, KOIs, confirmed planets and stellar parameters from the NASA Exoplanet Archive.",
            "done": n_signals > 0,
            "page": "catalog",
            "action": {"method": "POST", "path": "/api/catalog/refresh"},
        },
        {
            "key": "download_lightcurves",
            "title": "Download light curves",
            "description": "Fetch Kepler long-cadence light curves from NASA MAST (a star's page, or a dataset build).",
            "done": n_available > 0,
            "page": "targets",
            "action": None,
        },
        {
            "key": "build_dataset",
            "title": "Build a dataset",
            "description": "Process labelled signals into global/local views with star-level train/val/test splits.",
            "done": n_ready > 0,
            "page": "datasets",
            "action": {"method": "POST", "path": "/api/datasets"},
        },
        {
            "key": "train_model",
            "title": "Train a model",
            "description": "Train logistic regression, random forest and the AstroNet-style CNNs on your dataset.",
            "done": n_real_models > 0,
            "page": "training",
            "action": {"method": "POST", "path": "/api/training/runs"},
        },
        {
            "key": "evaluate_model",
            "title": "Evaluate on the test set",
            "description": "Measure accuracy, precision/recall, ROC/PR-AUC and calibration once on held-out stars.",
            "done": n_evals > 0,
            "page": "evaluation",
            "action": {"method": "POST", "path": "/api/evaluation/runs"},
        },
        {
            "key": "run_prediction",
            "title": "Score a signal",
            "description": "Run a model on a catalogue signal or an uploaded light curve (results are research leads).",
            "done": n_preds > 0,
            "page": "predict",
            "action": {"method": "POST", "path": "/api/predictions"},
        },
    ]


# ------------------------------------------------------------------------------------------------
# diagnostics
# ------------------------------------------------------------------------------------------------
_PACKAGES = (
    "numpy",
    "scipy",
    "pandas",
    "astropy",
    "scikit-learn",
    "torch",
    "fastapi",
    "starlette",
    "pydantic",
    "sqlalchemy",
    "requests",
    "lightkurve",
    "uvicorn",
)


def _versions() -> dict[str, str | None]:
    out: dict[str, str | None] = {
        "exofinder": __version__,
        "pipeline": PIPELINE_VERSION,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
    }
    for pkg in _PACKAGES:
        try:
            out[pkg] = metadata.version(pkg)
        except metadata.PackageNotFoundError:
            out[pkg] = None
    return out


def _path_info(path) -> dict[str, Any]:
    import os

    p = str(path)
    return {
        "path": p,
        "exists": os.path.exists(p),
        "writable": os.access(p, os.W_OK) if os.path.exists(p) else False,
    }


def _check(name: str, url: str, timeout: float, ok_fn) -> dict[str, Any]:
    import requests

    t0 = time.perf_counter()
    try:
        with requests.get(
            url, timeout=timeout, stream=True, headers={"User-Agent": "ExoplanetFinder/1.0 (diagnostics)"}
        ) as r:
            head = next(r.iter_content(256), b"") if r.status_code == 200 else b""
            ok = bool(ok_fn(r.status_code, head))
            return {
                "name": name,
                "url": url,
                "ok": ok,
                "status_code": r.status_code,
                "elapsed_ms": (time.perf_counter() - t0) * 1000.0,
                "error": None if ok else f"Unexpected response (HTTP {r.status_code})",
            }
    except Exception as exc:  # noqa: BLE001 - every failure is a diagnostic result
        return {
            "name": name,
            "url": url,
            "ok": False,
            "status_code": None,
            "elapsed_ms": (time.perf_counter() - t0) * 1000.0,
            "error": f"{type(exc).__name__}: {exc}",
        }


def network_checks(timeout: float = 8.0) -> list[dict[str, Any]]:
    """Ping the Exoplanet Archive TAP service and the MAST download service (in parallel)."""
    from urllib.parse import urlencode

    from exofinder.data.mast import kepler_lc_urls

    s = get_settings()
    tap = f"{s.archive_tap_url}?{urlencode({'query': 'SELECT TOP 1 kepid FROM cumulative', 'format': 'csv'})}"
    mast = next(url for q, url, _ in kepler_lc_urls(11442793) if q == 3)
    checks = [
        (
            "NASA Exoplanet Archive (TAP)",
            tap,
            lambda code, head: code == 200 and head.lower().startswith(b"kepid"),
        ),
        (
            "NASA MAST (Kepler light-curve download)",
            mast,
            lambda code, head: code == 200 and head.startswith(b"SIMPLE"),
        ),
    ]
    with ThreadPoolExecutor(max_workers=len(checks)) as pool:
        futures = [pool.submit(_check, name, url, timeout, fn) for name, url, fn in checks]
        return [f.result() for f in futures]


def diagnostics(session: Session, check_network: bool = False) -> dict[str, Any]:
    from exofinder.services.settings import storage

    s = get_settings()
    db_url = s.database_url
    return {
        "versions": _versions(),
        "paths": {
            "repo_data_dir": _path_info(s.data_path),
            "artifacts_dir": _path_info(s.artifacts_path),
            "catalogs_dir": _path_info(s.catalogs_dir),
            "raw_dir": _path_info(s.raw_dir),
            "lightcurves_dir": _path_info(s.lightcurves_dir),
            "views_dir": _path_info(s.views_dir),
            "datasets_dir": _path_info(s.datasets_dir),
            "uploads_dir": _path_info(s.uploads_dir),
            "models_dir": _path_info(s.models_dir),
            "reports_dir": _path_info(s.reports_dir),
        },
        "database_url": db_url,
        "storage": storage(),
        "device": device_info(),
        "settings": app_settings.get_all(session),
        "network": network_checks() if check_network else None,
        "network_checked": bool(check_network),
    }
