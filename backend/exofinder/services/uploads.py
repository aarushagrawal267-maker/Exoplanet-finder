"""User-uploaded light curves (FITS or CSV/text).

Life cycle
----------
1. ``POST /api/uploads`` -> :func:`save_upload`: the file is streamed to
   ``<uploads_dir>/<upload_id>/<safe file name>`` (at most :data:`MAX_UPLOAD_BYTES`), checked, and
   described in ``meta.json``. FITS files are read immediately with
   :func:`exofinder.astro.io_fits.read_fits_lightcurve`; CSV/text files are parsed as a table so the
   UI can show the columns, a suggested column mapping (:func:`exofinder.astro.io_csv.detect_columns`)
   and preview rows for the user to confirm.
2. ``POST /api/uploads/{id}/parse`` -> :func:`parse_upload`: the confirmed mapping and time system
   are applied (CSV via :func:`exofinder.astro.io_csv.read_csv_lightcurve`; ``BJD`` is converted to
   BKJD by subtracting 2454833.0), the light curve is stored as ``parsed.npz`` and out-of-distribution
   warnings are recorded (the models only ever saw Kepler long-cadence PDCSAP data).
3. ``GET /api/uploads/{id}/lightcurve`` -> :func:`upload_lightcurve`: same payload as the catalogue
   light-curve endpoint.

Uploaded data is never mixed into the catalogue or into training data.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import IO, Any

import numpy as np

from exofinder.astro.errors import LightCurveFormatError
from exofinder.astro.io_csv import detect_columns, read_csv_lightcurve
from exofinder.astro.io_fits import read_fits_lightcurve
from exofinder.astro.types import LightCurve
from exofinder.config import BKJD_OFFSET, get_settings
from exofinder.data._util import replace_with_retry
from exofinder.db.models import utcnow
from exofinder.services.jsonutil import to_jsonable
from exofinder.services.sci_common import KEPLER_LONG_CADENCE_DAYS, finite
from exofinder.services.sci_errors import ServiceError, bad_request, conflict, not_found

#: Largest accepted upload (bytes).
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
FITS_SUFFIXES = (".fits", ".fit", ".fits.gz", ".fit.gz")
TEXT_SUFFIXES = (".csv", ".txt")
#: Time systems accepted by the parse step ("other" = relative days with an unknown zero point).
TIME_SYSTEMS = ("BKJD", "BJD", "BTJD", "other")
PREVIEW_ROWS = 10
META_FILE = "meta.json"
PARSED_FILE = "parsed.npz"
_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_CHUNK = 1 << 20
#: Windows device names: a file called e.g. ``con.csv`` or ``aux.txt`` would open the device instead
#: of a file on Windows 10, so stored names never start with one of these.
_WINDOWS_DEVICE_NAMES = frozenset(
    ["CON", "PRN", "AUX", "NUL"] + [f"{dev}{i}" for dev in ("COM", "LPT") for i in range(10)]
)

OOD_NOTICE = (
    "The models were trained only on Kepler long-cadence (29.4 min) PDCSAP light curves processed by "
    "this pipeline; scores on other data are out of distribution and unreliable."
)


# ------------------------------------------------------------------------------------------------
# paths and metadata
# ------------------------------------------------------------------------------------------------
def upload_dir(upload_id: str) -> Path:
    """Directory of one upload; rejects malformed ids (no path traversal)."""
    if not isinstance(upload_id, str) or not _ID_RE.match(upload_id):
        raise not_found("Upload", "upload_not_found", "Upload ids are 32-character hex strings.")
    return get_settings().uploads_dir / upload_id


def read_meta(upload_id: str) -> dict[str, Any]:
    """``meta.json`` of an upload (404 ``upload_not_found`` if missing)."""
    path = upload_dir(upload_id) / META_FILE
    if not path.is_file():
        raise not_found(f"Upload {upload_id}", "upload_not_found", "Upload the file again.")
    return json.loads(path.read_text("utf-8"))


def _write_meta(upload_id: str, meta: dict[str, Any]) -> None:
    path = upload_dir(upload_id) / META_FILE
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(to_jsonable(meta), indent=2, sort_keys=True), "utf-8")
    replace_with_retry(tmp, path)  # Windows: a concurrent reader can hold meta.json open briefly


def _kind_for(filename: str) -> str | None:
    name = filename.lower()
    if name.endswith(FITS_SUFFIXES):
        return "fits"
    if name.endswith(TEXT_SUFFIXES):
        return "csv"
    return None


def _safe_name(filename: str) -> str:
    base = Path(filename.replace("\\", "/")).name or "upload"
    safe = "".join(c if (c.isalnum() or c in "._-") else "_" for c in base).lstrip(".")
    safe = (safe or "upload")[:120]
    if safe.split(".", 1)[0].upper() in _WINDOWS_DEVICE_NAMES:
        safe = f"_{safe}"[:120]
    return safe


# ------------------------------------------------------------------------------------------------
# upload
# ------------------------------------------------------------------------------------------------
def save_upload(stream: IO[bytes], filename: str | None) -> dict[str, Any]:
    """Store an uploaded file and describe it (see module docstring). Returns the upload response."""
    filename = (filename or "").strip()
    if not filename:
        raise bad_request("The upload has no file name.", "invalid_upload", "Choose a file to upload.")
    kind = _kind_for(filename)
    if kind is None:
        raise bad_request(
            f"Unsupported file type: {filename}",
            "unsupported_file_type",
            "Upload a light curve as .fits / .fit / .fits.gz (Kepler, K2 or TESS) or .csv / .txt (columns "
            "for time and flux).",
        )
    upload_id = uuid.uuid4().hex
    directory = upload_dir(upload_id)
    directory.mkdir(parents=True, exist_ok=False)
    stored = directory / _safe_name(filename)
    sha = hashlib.sha256()
    size = 0
    try:
        with open(stored, "wb") as out:
            while True:
                chunk = stream.read(_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise ServiceError(
                        413,
                        f"The file is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.",
                        "file_too_large",
                        "Upload a single light-curve file (one Kepler quarter is about 0.5 MB).",
                    )
                sha.update(chunk)
                out.write(chunk)
        if size == 0:
            raise bad_request("The uploaded file is empty.", "invalid_upload")
        meta: dict[str, Any] = {
            "upload_id": upload_id,
            "filename": filename,
            "stored_name": stored.name,
            "kind": kind,
            "size_bytes": size,
            "sha256": sha.hexdigest(),
            "created_at": utcnow().isoformat(),
            "parsed": None,
        }
        if kind == "fits":
            meta.update(_describe_fits(stored))
        else:
            meta.update(_describe_csv(stored))
        _write_meta(upload_id, meta)
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    return upload_response(meta)


def upload_response(meta: dict[str, Any]) -> dict[str, Any]:
    """The ``POST /api/uploads`` response for stored ``meta``."""
    return {
        "upload_id": meta["upload_id"],
        "filename": meta["filename"],
        "kind": meta["kind"],
        "size_bytes": meta["size_bytes"],
        "n_rows": meta.get("n_rows", 0),
        "columns": meta.get("columns"),
        "suggested_mapping": meta.get("suggested_mapping"),
        "suggested_time_system": meta.get("suggested_time_system"),
        "preview_rows": meta.get("preview_rows") or [],
        "meta": meta.get("file_meta") or {},
        "parsed": meta.get("parsed"),
        "created_at": meta.get("created_at"),
    }


def _describe_fits(path: Path) -> dict[str, Any]:
    try:
        lc = read_fits_lightcurve(path)
    except LightCurveFormatError as exc:
        raise bad_request(
            str(exc), "invalid_file", "Check that the file is a complete FITS light curve (e.g. *_llc.fits)."
        ) from exc
    n = len(lc)
    rows = []
    for i in range(min(PREVIEW_ROWS, n)):
        rows.append(
            {
                "time": finite(lc.time[i]),
                "flux": finite(lc.flux[i]),
                "flux_err": None if lc.flux_err is None else finite(lc.flux_err[i]),
                "quality": None if lc.quality is None else int(lc.quality[i]),
            }
        )
    file_meta = to_jsonable(dict(lc.meta))
    return {
        "n_rows": n,
        "columns": None,
        "suggested_mapping": None,
        "suggested_time_system": file_meta.get("time_system")
        if file_meta.get("time_system") != "unknown"
        else None,
        "preview_rows": rows,
        "file_meta": file_meta,
    }


def _read_table(path: Path):
    """Parse a CSV/text table with the same rules as the CSV light-curve reader."""
    from exofinder.astro import io_csv

    return io_csv._parse_table(path.read_bytes())  # shared parser: delimiters, comments, encodings


def _describe_csv(path: Path) -> dict[str, Any]:
    try:
        df = _read_table(path)
    except LightCurveFormatError as exc:
        raise bad_request(str(exc), "invalid_file", "Upload a comma/tab/space separated table.") from exc
    suggested = detect_columns(df)
    preview = to_jsonable(df.head(PREVIEW_ROWS).to_dict("records"))
    suggested_ts = None
    tcol = suggested.get("time")
    if tcol is not None:
        import pandas as pd

        t = pd.to_numeric(df[tcol], errors="coerce").to_numpy(dtype=float)
        t = t[np.isfinite(t)]
        if t.size:
            med = float(np.median(t))
            suggested_ts = "BJD" if med > 2.0e6 else ("BKJD" if 0 <= med < 20000 else None)
    return {
        "n_rows": int(len(df)),
        "columns": [str(c) for c in df.columns],
        "suggested_mapping": {k: (None if v is None else str(v)) for k, v in suggested.items()},
        "suggested_time_system": suggested_ts,
        "preview_rows": preview,
        "file_meta": {"source": "csv", "n_columns": int(df.shape[1])},
    }


# ------------------------------------------------------------------------------------------------
# parse
# ------------------------------------------------------------------------------------------------
def ood_warnings(meta: dict[str, Any], lc: LightCurve) -> list[str]:
    """Out-of-distribution / usability warnings for a parsed upload."""
    warnings: list[str] = []
    lm = lc.meta
    mission = str(lm.get("mission") or "unknown")
    if meta.get("kind") == "csv":
        warnings.append("Uploaded table: its origin and processing are unknown to this app. " + OOD_NOTICE)
    elif mission != "Kepler":
        warnings.append(f"This is {mission} data, not Kepler. " + OOD_NOTICE)
    cad = finite(lm.get("cadence_days"))
    if cad is not None and abs(cad / KEPLER_LONG_CADENCE_DAYS - 1.0) > 0.1:
        warnings.append(
            f"The cadence is {cad * 1440:.1f} min, not Kepler long cadence (29.4 min): out of distribution."
        )
    ts = lm.get("time_system")
    if ts != "BKJD":
        warnings.append(
            f"Times are in {ts or 'an unknown system'}, not BKJD: Kepler catalogue ephemerides cannot be used "
            "with this light curve (enter an ephemeris in the same time system, or run BLS)."
        )
    t = lc.time[np.isfinite(lc.time)]
    span = float(t.max() - t.min()) if t.size else 0.0
    if span < 30:
        warnings.append(
            f"The light curve spans only {span:.1f} d: only periods shorter than ~{span / 2:.1f} d can show "
            "the two transits the pipeline requires."
        )
    if meta.get("kind") == "fits" and mission == "Kepler" and lm.get("kepid") is not None:
        warnings.append(
            f"This is one Kepler file of KIC {lm['kepid']}. The stitched multi-quarter light curve of this "
            "star (catalogue view) gives more transits and more reliable results."
        )
    return warnings


def parse_upload(
    upload_id: str, mapping: dict[str, str | None] | None, time_system: str | None
) -> dict[str, Any]:
    """Apply the confirmed column mapping / time system and store the parsed light curve."""
    meta = read_meta(upload_id)
    path = upload_dir(upload_id) / meta["stored_name"]
    if time_system is not None and time_system not in TIME_SYSTEMS:
        raise bad_request(
            f"Unknown time system '{time_system}'.",
            "invalid_time_system",
            f"Choose one of: {', '.join(TIME_SYSTEMS)}.",
        )
    notes: list[str] = []
    try:
        if meta["kind"] == "fits":
            lc = _parse_fits(path, mapping, time_system, notes)
        else:
            if time_system is None:
                time_system = meta.get("suggested_time_system") or "BKJD"
            reader_ts = "days" if time_system == "other" else time_system
            lc = read_csv_lightcurve(path, mapping=mapping or None, time_system=reader_ts)
    except LightCurveFormatError as exc:
        raise bad_request(
            str(exc), "invalid_lightcurve", "Check the column mapping and time system."
        ) from exc

    ok = np.isfinite(lc.time) & np.isfinite(lc.flux)
    n_points = int(ok.sum())
    if n_points < 100:
        raise bad_request(
            f"Only {n_points} cadences have a finite time and flux; at least 100 are needed.",
            "insufficient_data",
        )
    t = np.sort(lc.time[ok])
    d = np.diff(t)
    cadence = float(np.median(d[d > 0])) if np.any(d > 0) else None
    lc.meta["cadence_days"] = lc.meta.get("cadence_days") or cadence
    warnings = notes + ood_warnings(meta, lc)
    _save_parsed(upload_id, lc)
    parsed = {
        "mapping": lc.meta.get("columns")
        or ({"flux": lc.meta.get("flux_column")} if meta["kind"] == "fits" else None),
        "time_system": lc.meta.get("time_system"),
        "input_time_system": lc.meta.get("time_input_system", time_system or lc.meta.get("time_system")),
        "n_points": n_points,
        "time_span_days": float(t[-1] - t[0]),
        "time_start": float(t[0]),
        "time_end": float(t[-1]),
        "cadence_days": cadence,
        "mission": lc.meta.get("mission"),
        "kepid": lc.meta.get("kepid"),
        "warnings": warnings,
        "out_of_distribution": any("out of distribution" in w for w in warnings),
        "parsed_at": utcnow().isoformat(),
    }
    meta["parsed"] = parsed
    _write_meta(upload_id, meta)
    return {"upload_id": upload_id, **parsed}


def _parse_fits(
    path: Path, mapping: dict[str, str | None] | None, time_system: str | None, notes: list[str]
) -> LightCurve:
    flux_column = (mapping or {}).get("flux") or None
    lc = read_fits_lightcurve(path, flux_column=flux_column)
    declared = lc.meta.get("time_system")
    if declared in ("BKJD", "BTJD"):
        if time_system not in (None, declared):
            notes.append(
                f"The FITS header declares {declared} times; the requested time system '{time_system}' was ignored."
            )
        lc.meta["time_input_system"] = declared
        return lc
    requested = time_system or "other"
    lc.meta["time_input_system"] = requested
    med = float(np.nanmedian(lc.time)) if len(lc) else math.nan
    if requested == "BJD":
        if not med > 2.0e6:
            raise LightCurveFormatError(
                f"Time values (median {med:.1f}) are not full Julian dates; choose BKJD, BTJD or other."
            )
        lc.time = lc.time - BKJD_OFFSET
        lc.meta["time_system"] = "BKJD"
    elif requested in ("BKJD", "BTJD"):
        lc.meta["time_system"] = requested
    else:
        lc.meta["time_system"] = "unknown"
    return lc


def _save_parsed(upload_id: str, lc: LightCurve) -> Path:
    path = upload_dir(upload_id) / PARSED_FILE
    arrays = {
        "time": np.asarray(lc.time, dtype=np.float64),
        "flux": np.asarray(lc.flux, dtype=np.float64),
        "flux_err": np.asarray(lc.flux_err, dtype=np.float64) if lc.flux_err is not None else np.zeros(0),
        "quality": np.asarray(lc.quality, dtype=np.int64)
        if lc.quality is not None
        else np.zeros(0, np.int64),
        "segment": np.asarray(lc.segment, dtype=np.int64)
        if lc.segment is not None
        else np.zeros(0, np.int64),
        "meta": np.array(json.dumps(to_jsonable(dict(lc.meta)), sort_keys=True)),
    }
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp.npz")
    os.close(fd)
    try:
        np.savez_compressed(tmp, **arrays)
        replace_with_retry(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return path


def load_parsed(upload_id: str, missing_status: int = 409) -> tuple[LightCurve, dict[str, Any]]:
    """The parsed light curve of an upload and its ``meta.json`` (409/404 ``upload_not_parsed``)."""
    meta = read_meta(upload_id)
    path = upload_dir(upload_id) / PARSED_FILE
    if meta.get("parsed") is None or not path.is_file():
        err = conflict(
            f"Upload {upload_id} has not been parsed yet",
            "upload_not_parsed",
            "Confirm the column mapping and time system first (POST /api/uploads/{id}/parse).",
        )
        err.status_code = missing_status
        raise err
    with np.load(path, allow_pickle=False) as z:
        lm = json.loads(str(z["meta"]))
        lc = LightCurve(
            time=z["time"],
            flux=z["flux"],
            flux_err=z["flux_err"] if z["flux_err"].size else None,
            quality=z["quality"] if z["quality"].size else None,
            segment=z["segment"] if z["segment"].size else None,
            meta=lm,
        )
    return lc, meta
