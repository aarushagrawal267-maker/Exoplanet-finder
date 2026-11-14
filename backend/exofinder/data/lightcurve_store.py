"""Compact on-disk cache of stitched Kepler light curves: ``data/lightcurves/<kic9>.npz``.

One file per star holds every downloaded long-cadence quarter, concatenated in time order:

========== ======= ====================================================================
array      dtype   meaning
========== ======= ====================================================================
time       float64 BKJD (BJD − 2454833.0) of each cadence, days
flux       float32 PDCSAP flux divided by the median of its quarter (≈ 1.0)
flux_err   float32 PDCSAP flux uncertainty divided by the same median
quarter    int8    Kepler quarter (0–17) of each cadence
quality    int32   SAP_QUALITY bit flags, unchanged
meta       str     JSON metadata (kepid, quarters, per-quarter medians, source files, ...)
========== ======= ====================================================================

Why these choices:

* **Un-cleaned data.** Cadences are *not* filtered by quality flags or NaN flux here; only cadences
  without a valid timestamp (TIME = NaN, typically during spacecraft safe modes) are dropped,
  because they cannot be placed in time at all. The astro pipeline (:mod:`exofinder.astro.cleaning`)
  stays the single source of truth for which cadences are used, and can be re-run with another
  quality bitmask without downloading again.
* **Per-quarter normalisation before float32.** PDCSAP fluxes are ~10⁴–10⁷ e⁻/s; float32 keeps
  ~7 significant digits, which is marginal for 10-ppm transits at raw scale but leaves a
  resolution of ~0.06 ppm once each quarter is divided by its median. The divisor is the median
  of finite fluxes on cadences with ``SAP_QUALITY == 0`` (all finite fluxes if fewer than 10 such
  cadences), recorded per quarter in ``meta["quarter_medians"]``. The pipeline's own per-segment
  normalisation then divides by ≈1.0, so the cache does not change its output.
* **Atomic writes** (temporary file + rename) so a crash never leaves a truncated cache file.
"""

from __future__ import annotations

import io
import json
import logging
import os
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import numpy as np

from exofinder.astro.types import LightCurve
from exofinder.config import get_settings, kic9
from exofinder.data._util import atomic_write_bytes, sha256_file

log = logging.getLogger(__name__)

CACHE_FORMAT_VERSION = 1
FLUX_COLUMN = "PDCSAP_FLUX"
FLUX_ERR_COLUMN = "PDCSAP_FLUX_ERR"
QUALITY_COLUMN = "SAP_QUALITY"
#: Minimum number of good cadences required to use the quality-0 median for normalisation.
MIN_GOOD_FOR_MEDIAN = 10
#: Meta key listing optional arrays (``flux_err``, ``quality``) that were ``None`` when saved; the
#: file stores placeholders for them, and :func:`load_lightcurve` restores ``None``.
_ABSENT_KEY = "absent_arrays"


def lightcurve_path(kepid: int | str) -> Path:
    """Cache file location for ``kepid``."""
    return get_settings().lightcurves_dir / f"{kic9(kepid)}.npz"


def has_lightcurve(kepid: int | str) -> bool:
    return lightcurve_path(kepid).is_file()


# ------------------------------------------------------------------------------------------------
# FITS reading
# ------------------------------------------------------------------------------------------------
def read_kepler_quarter(path: str | Path) -> dict[str, Any]:
    """Read one Kepler ``_llc.fits`` quarter file (raw values, no filtering except TIME = NaN).

    Returns ``{kepid, quarter, time, flux, flux_err, quality, n_nan_time, header...}`` with flux in
    e⁻/s exactly as in the PDCSAP_FLUX column.
    """
    from astropy.io import fits

    path = Path(path)
    with fits.open(path, memmap=False) as hdul:
        primary = hdul[0].header
        lc_hdu = hdul["LIGHTCURVE"]
        hdr = lc_hdu.header
        data = lc_hdu.data
        time = np.asarray(data["TIME"], dtype=np.float64)
        flux = np.asarray(data[FLUX_COLUMN], dtype=np.float64)
        flux_err = np.asarray(data[FLUX_ERR_COLUMN], dtype=np.float64)
        quality = np.asarray(data[QUALITY_COLUMN], dtype=np.int64)
        bjdrefi = hdr.get("BJDREFI")
        bjdreff = hdr.get("BJDREFF", 0.0)
        info = {
            "kepid": int(primary.get("KEPLERID")),
            "quarter": int(primary.get("QUARTER")),
            "season": primary.get("SEASON"),
            "module": primary.get("MODULE"),
            "channel": primary.get("CHANNEL"),
            "data_release": primary.get("DATA_REL"),
            "kepmag": primary.get("KEPMAG"),
            "timedel": hdr.get("TIMEDEL"),
            "timeref": hdr.get("TIMEREF"),
            "timesys": hdr.get("TIMESYS"),
            "bjdref": None if bjdrefi is None else float(bjdrefi) + float(bjdreff or 0.0),
        }
    ok = np.isfinite(time)
    info.update(
        time=time[ok],
        flux=flux[ok],
        flux_err=flux_err[ok],
        quality=quality[ok],
        n_nan_time=int((~ok).sum()),
        file=path.name,
    )
    if info["bjdref"] is not None and abs(info["bjdref"] - 2454833.0) > 1e-9:
        raise ValueError(
            f"{path.name}: unexpected BJDREF {info['bjdref']} (expected BKJD reference 2454833.0)"
        )
    return info


def _quarter_median(flux: np.ndarray, quality: np.ndarray) -> float:
    finite = np.isfinite(flux)
    good = finite & (quality == 0)
    sel = good if good.sum() >= MIN_GOOD_FOR_MEDIAN else finite
    if not sel.any():
        return float("nan")
    return float(np.median(flux[sel]))


def build_from_fits(kepid: int | str, fits_paths: Iterable[str | Path]) -> LightCurve:
    """Stitch Kepler quarter files of one star into a single un-cleaned, per-quarter-normalised curve.

    Quarters are concatenated in time order; ``segment`` holds the quarter number. Quarters whose
    flux has no positive finite median are dropped (listed in ``meta["dropped_quarters"]``).
    Raises ``ValueError`` if a file belongs to another star or no usable quarter remains.
    """
    kepid = int(kepid)
    parts = [read_kepler_quarter(p) for p in sorted({Path(p) for p in fits_paths}, key=lambda p: p.name)]
    if not parts:
        raise ValueError(f"no FITS files given for KIC {kepid}")
    times, fluxes, errs, quals, quarters = [], [], [], [], []
    medians: dict[str, float] = {}
    dropped: list[int] = []
    sources: list[str] = []
    n_nan_time = 0
    release: set[Any] = set()
    timedel: list[float] = []
    for part in sorted(parts, key=lambda d: (d["quarter"], float(d["time"][0]) if len(d["time"]) else 0.0)):
        if part["kepid"] != kepid:
            raise ValueError(f"{part['file']} is for KIC {part['kepid']}, not {kepid}")
        q = part["quarter"]
        med = _quarter_median(part["flux"], part["quality"])
        if not np.isfinite(med) or med <= 0:
            dropped.append(q)
            log.warning("KIC %s Q%s: no usable flux (median=%s); quarter dropped", kepid, q, med)
            continue
        key = str(q)
        if key in medians:  # two files for one quarter (Q4 module-3 split): keep both, per-file median
            key = f"{q}:{part['file']}"
        medians[key] = med
        times.append(part["time"])
        fluxes.append(part["flux"] / med)
        errs.append(part["flux_err"] / med)
        quals.append(part["quality"])
        quarters.append(np.full(part["time"].shape, q, dtype=np.int64))
        sources.append(part["file"])
        n_nan_time += part["n_nan_time"]
        if part["data_release"] is not None:
            release.add(part["data_release"])
        if part["timedel"]:
            timedel.append(float(part["timedel"]))
    if not times:
        raise ValueError(f"KIC {kepid}: no quarter with usable flux")
    time = np.concatenate(times)
    order = np.argsort(time, kind="mergesort")
    meta = {
        "kepid": kepid,
        "mission": "Kepler",
        "time_system": "BKJD",
        "flux_column": FLUX_COLUMN,
        "cadence_days": float(np.median(timedel)) if timedel else None,
        "quarters": sorted({int(q) for q in np.concatenate(quarters)}),
        "quarter_medians": medians,
        "normalization": "per-quarter median of finite PDCSAP flux on SAP_QUALITY==0 cadences",
        "cleaned": False,
        "dropped_quarters": sorted(dropped),
        "n_nan_time_dropped": n_nan_time,
        "source_files": sources,
        "data_release": sorted(release),
        "cache_format": CACHE_FORMAT_VERSION,
    }
    return LightCurve(
        time=time[order],
        flux=np.concatenate(fluxes)[order],
        flux_err=np.concatenate(errs)[order],
        quality=np.concatenate(quals)[order],
        segment=np.concatenate(quarters)[order],
        meta=meta,
    )


# ------------------------------------------------------------------------------------------------
# Cache I/O
# ------------------------------------------------------------------------------------------------
def _json_safe(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, float) and not np.isfinite(obj):
        return None
    return obj


def save_lightcurve(kepid: int | str, lc: LightCurve) -> Path:
    """Write ``lc`` to the compact cache (atomic). Returns the cache path."""
    n = len(lc)
    if lc.segment is not None and len(lc.segment) and (lc.segment.min() < -128 or lc.segment.max() > 127):
        raise ValueError("segment ids do not fit the int8 quarter column")
    arrays = {
        "time": np.asarray(lc.time, dtype=np.float64),
        "flux": np.asarray(lc.flux, dtype=np.float32),
        "flux_err": (
            np.full(n, np.nan, dtype=np.float32)
            if lc.flux_err is None
            else np.asarray(lc.flux_err, dtype=np.float32)
        ),
        "quarter": np.full(n, -1, dtype=np.int8)
        if lc.segment is None
        else np.asarray(lc.segment, dtype=np.int8),
        "quality": np.zeros(n, dtype=np.int32)
        if lc.quality is None
        else np.asarray(lc.quality, dtype=np.int32),
    }
    meta = {k: v for k, v in dict(lc.meta).items() if k not in ("cache_path", _ABSENT_KEY)}
    meta["kepid"] = int(kepid)
    # Placeholder columns (NaN errors, zero flags) must come back as None: the cleaning step drops
    # every cadence whose flux_err is non-finite, so an all-NaN placeholder would erase the curve.
    absent = [name for name, arr in (("flux_err", lc.flux_err), ("quality", lc.quality)) if arr is None]
    if absent:
        meta[_ABSENT_KEY] = absent
    arrays["meta"] = np.array(json.dumps(_json_safe(meta), sort_keys=True))
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrays)
    path = lightcurve_path(kepid)
    atomic_write_bytes(path, buf.getvalue())
    return path


def load_lightcurve(kepid: int | str) -> LightCurve | None:
    """Load the cached light curve of ``kepid``; ``None`` if absent.

    A corrupt cache file is reported (logged) and treated as absent so it gets rebuilt.
    """
    path = lightcurve_path(kepid)
    if not path.is_file():
        return None
    try:
        with np.load(path, allow_pickle=False) as z:
            meta = json.loads(str(z["meta"]))
            absent = set(meta.pop(_ABSENT_KEY, []))
            quarter = z["quarter"].astype(np.int64)
            lc = LightCurve(
                time=z["time"],
                flux=z["flux"].astype(np.float64),
                flux_err=None if "flux_err" in absent else z["flux_err"].astype(np.float64),
                quality=None if "quality" in absent else z["quality"].astype(np.int64),
                segment=None if (quarter.size and (quarter < 0).all()) else quarter,
                meta=meta,
            )
    except Exception as exc:  # noqa: BLE001 - zip/json/format errors
        log.error("light-curve cache %s is unreadable (%s); ignoring it", path, exc)
        return None
    lc.meta["cache_path"] = str(path)
    return lc


def delete_lightcurve(kepid: int | str) -> bool:
    path = lightcurve_path(kepid)
    try:
        os.remove(path)
        return True
    except FileNotFoundError:
        return False


def cache_digest(kepid: int | str) -> str | None:
    """SHA-256 of the cache file (for dataset manifests), or None if absent."""
    path = lightcurve_path(kepid)
    return sha256_file(path) if path.is_file() else None
