"""Helpers shared by the operations services (datasets, training, evaluation, reports).

* a small cache of loaded :class:`~exofinder.ml.dataset_arrays.DatasetArrays` (a full-tier
  ``arrays.npz`` takes seconds to decompress, and the Dataset Explorer asks for many views);
* the bin-centre phases of the AstroNet views (the arrays store only the binned flux);
* safe removal of artefact directories (only below the configured data/artifacts roots);
* small formatting helpers.
"""

from __future__ import annotations

import logging
import math
import shutil
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any

import numpy as np

from exofinder.astro.views import LOCAL_BIN_WIDTH_FACTOR
from exofinder.config import LOCAL_VIEW_NUM_DURATIONS, get_settings
from exofinder.ml.dataset_arrays import DatasetArrays, load_dataset_arrays

log = logging.getLogger("exofinder.services")

PLANET_LEAD_SENTENCE = (
    "Planet-like predictions are research leads, not discoveries: a high score means the light-curve "
    "shape resembles signals that NASA vetting classified as planet candidates, nothing more."
)

# --------------------------------------------------------------------------------------------------
# Dataset arrays cache
# --------------------------------------------------------------------------------------------------
_ARRAYS_CACHE: OrderedDict[tuple[str, float], DatasetArrays] = OrderedDict()
_ARRAYS_LOCK = threading.Lock()
_ARRAYS_CACHE_SIZE = 2


def load_arrays_cached(path: str | Path) -> DatasetArrays:
    """Load ``arrays.npz`` of a dataset directory, re-using the last two loads (keyed by mtime)."""
    p = Path(path)
    npz = p / "arrays.npz" if p.is_dir() else p
    key = (str(npz.resolve()), npz.stat().st_mtime)
    with _ARRAYS_LOCK:
        hit = _ARRAYS_CACHE.get(key)
        if hit is not None:
            _ARRAYS_CACHE.move_to_end(key)
            return hit
    arrays = load_dataset_arrays(npz.parent)
    with _ARRAYS_LOCK:
        _ARRAYS_CACHE[key] = arrays
        while len(_ARRAYS_CACHE) > _ARRAYS_CACHE_SIZE:
            _ARRAYS_CACHE.popitem(last=False)
    return arrays


def forget_arrays(path: str | Path) -> None:
    """Drop cached arrays of a dataset directory (after deleting it)."""
    prefix = str(Path(path).resolve())
    with _ARRAYS_LOCK:
        for key in [k for k in _ARRAYS_CACHE if k[0].startswith(prefix)]:
            _ARRAYS_CACHE.pop(key, None)


# --------------------------------------------------------------------------------------------------
# View geometry
# --------------------------------------------------------------------------------------------------
def _bin_centres(t_min: float, t_max: float, n: int, width: float) -> np.ndarray:
    """Bin centres exactly as :func:`exofinder.astro.views._median_bins` places them."""
    span = t_max - t_min
    if not width > 0 or width >= span:
        width = span / n
    spacing = (span - width) / (n - 1)
    return t_min + spacing * np.arange(n) + 0.5 * width


def view_phases(
    period_days: float,
    duration_hours: float,
    global_bins: int,
    local_bins: int,
    local_num_durations: float = LOCAL_VIEW_NUM_DURATIONS,
) -> tuple[np.ndarray, np.ndarray]:
    """Phases (days from transit centre) of the global and local view bins of a signal."""
    p = float(period_days)
    d = float(duration_hours) / 24.0
    g = _bin_centres(-0.5 * p, 0.5 * p, int(global_bins), p / int(global_bins))
    half = min(0.5 * p, 0.5 * float(local_num_durations) * d)
    loc = _bin_centres(-half, half, int(local_bins), LOCAL_BIN_WIDTH_FACTOR * d)
    return g, loc


# --------------------------------------------------------------------------------------------------
# Files
# --------------------------------------------------------------------------------------------------
def _allowed_roots() -> list[Path]:
    s = get_settings()
    return [s.data_path.resolve(), s.artifacts_path.resolve()]


def remove_tree(path: str | Path | None) -> bool:
    """Delete an artefact directory/file if it lies below the data or artifacts root.

    Refuses anything else (a corrupted ``path`` column must never delete unrelated files).
    """
    if not path:
        return False
    p = Path(path).resolve()
    if not any(root in p.parents for root in _allowed_roots()):
        log.warning("refusing to delete %s: outside the data/artifacts directories", p)
        return False
    if p.is_dir():
        shutil.rmtree(p, ignore_errors=True)
        return True
    if p.exists():
        p.unlink(missing_ok=True)
        return True
    return False


def dir_size_bytes(path: str | Path | None) -> int:
    if not path:
        return 0
    p = Path(path)
    if p.is_file():
        return p.stat().st_size
    if not p.is_dir():
        return 0
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


# --------------------------------------------------------------------------------------------------
# Small numeric helpers
# --------------------------------------------------------------------------------------------------
def finite_or_none(x: Any) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def log_histogram(
    values_by_class: dict[str, list[float]], n_bins: int = 20, unit: str = ""
) -> dict[str, Any] | None:
    """Histogram of log10(values) per class on shared edges; ``None`` when there is no positive value."""
    allv = [v for vs in values_by_class.values() for v in vs if v is not None and v > 0 and math.isfinite(v)]
    if not allv:
        return None
    logs = np.log10(np.asarray(allv, dtype=np.float64))
    lo, hi = float(logs.min()), float(logs.max())
    if hi - lo < 1e-9:
        lo, hi = lo - 0.5, hi + 0.5
    edges = np.linspace(lo, hi, n_bins + 1)
    counts = {}
    for cls, vs in values_by_class.items():
        arr = np.asarray([v for v in vs if v is not None and v > 0 and math.isfinite(v)], dtype=np.float64)
        counts[cls] = np.histogram(np.log10(arr), bins=edges)[0].astype(int).tolist() if arr.size else [0] * n_bins
    return {"log10_edges": edges.tolist(), "counts": counts, "unit": unit}
