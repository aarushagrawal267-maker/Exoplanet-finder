"""Process-pool worker for dataset builds (spawn-safe).

Processing one catalogue signal (clean, detrend, fold, views, quality, features) is CPU-bound and
takes ~1-2 s for a 4-year Kepler light curve, so a dataset build fans signals out to a
:class:`concurrent.futures.ProcessPoolExecutor` using the ``spawn`` start method (the only one that is
safe in a multi-threaded server and the default on Windows).

Everything here is a top-level function taking and returning plain data (ints, strings, dicts and
numpy arrays), so it can be pickled to a fresh interpreter. Each task opens its own short read-only
database session and calls :func:`exofinder.services.signal_views.compute_signal_views`, the same
code the API uses for single predictions, so a dataset row and a later prediction on the same signal
use identical views (and share the on-disk view cache).
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

import numpy as np

#: Environment variables passed to worker processes so they use the parent's data/database paths.
ENV_KEYS = ("EXOF_DATA_DIR", "EXOF_ARTIFACTS_DIR", "EXOF_DB_URL")


def init_worker(env: dict[str, str]) -> None:
    """Pool initializer: adopt the parent's paths and keep each worker single-threaded."""
    os.environ.update(env)
    try:  # one BLAS/OpenMP thread per worker: the pool itself provides the parallelism
        from threadpoolctl import threadpool_limits

        threadpool_limits(1)
    except Exception:  # pragma: no cover - threadpoolctl ships with scikit-learn
        pass
    from exofinder.config import get_settings
    from exofinder.db import session as db_session

    get_settings.cache_clear()
    db_session.get_engine.cache_clear()
    db_session._session_factory.cache_clear()


def lightcurve_is_synthetic(kepid: int) -> bool:
    """True if the cached light curve of ``kepid`` is flagged ``meta["synthetic"]`` (test data).

    Only the small ``meta`` member of the ``.npz`` is read, so this is cheap.
    """
    from exofinder.data.lightcurve_store import lightcurve_path

    path = lightcurve_path(kepid)
    if not path.is_file():
        return False
    try:
        with np.load(path, allow_pickle=False) as z:
            meta = json.loads(str(z["meta"]))
    except Exception:  # noqa: BLE001 - unreadable caches are reported by the processing step
        return False
    return bool(meta.get("synthetic"))


def process_signal_task(task: dict[str, Any]) -> dict[str, Any]:
    """Compute the model views of one signal.

    ``task`` = ``{"signal_id": int, "pipeline": dict (PipelineConfig.to_dict())}``. Returns
    ``{"signal_id", "status": "ok"|"error", "elapsed_s", ...}``; on success also ``global_view``,
    ``local_view``, ``features`` (float32 arrays), ``feature_names``, ``quality``, ``lc_digest``,
    ``from_cache`` and ``synthetic``; on failure ``error_kind`` (``no_lightcurve``, ``no_ephemeris``,
    ``insufficient_data``, ``invalid_input``, ``processing_error``) and ``message``.
    """
    from exofinder.astro.errors import InsufficientDataError
    from exofinder.astro.pipeline import PipelineConfig
    from exofinder.db.models import Signal
    from exofinder.db.session import session_scope
    from exofinder.services.signal_views import (
        SignalEphemerisError,
        SignalNotDownloadedError,
        compute_signal_views,
    )

    t0 = time.perf_counter()
    signal_id = int(task["signal_id"])
    out: dict[str, Any] = {"signal_id": signal_id, "status": "error", "pid": os.getpid()}
    try:
        cfg = PipelineConfig.from_dict(task.get("pipeline") or {})
        with session_scope() as session:
            sig = session.get(Signal, signal_id)
            if sig is None:
                raise LookupError(f"signal {signal_id} no longer exists in the catalogue")
            sv = compute_signal_views(session, sig, config=cfg)
        out.update(
            status="ok",
            global_view=np.asarray(sv.global_view, dtype=np.float32),
            local_view=np.asarray(sv.local_view, dtype=np.float32),
            features=np.asarray(sv.features, dtype=np.float32),
            feature_names=list(sv.feature_names),
            quality=sv.quality,
            lc_digest=sv.lc_digest,
            from_cache=bool(sv.from_cache),
            synthetic=lightcurve_is_synthetic(sv.kepid),
        )
    except SignalNotDownloadedError as exc:
        out.update(error_kind="no_lightcurve", message=str(exc))
    except SignalEphemerisError as exc:
        out.update(error_kind="no_ephemeris", message=str(exc))
    except InsufficientDataError as exc:
        out.update(error_kind="insufficient_data", message=str(exc))
    except ValueError as exc:  # e.g. ephemeris rejected by the pipeline's own validation
        out.update(error_kind="invalid_input", message=f"{type(exc).__name__}: {exc}")
    except Exception as exc:  # noqa: BLE001 - one bad signal must not abort the build
        out.update(error_kind="processing_error", message=f"{type(exc).__name__}: {exc}")
    out["elapsed_s"] = time.perf_counter() - t0
    return out
