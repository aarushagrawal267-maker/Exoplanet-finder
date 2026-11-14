"""Readers for FITS light-curve files.

Kepler long-cadence ``*_llc.fits`` files (one per quarter) contain a ``LIGHTCURVE`` binary table with
``TIME`` (BKJD = BJD_TDB - 2454833.0, barycentric), ``SAP_FLUX`` (simple aperture photometry),
``PDCSAP_FLUX`` (Presearch Data Conditioning: SAP with instrumental systematics removed and crowding
corrected), their errors, and ``SAP_QUALITY`` bit flags. We use PDCSAP_FLUX, as AstroNet and the
Kepler pipeline's transit search do.

The readers are deliberately *faithful*: they return every cadence that has a time stamp, including
NaN fluxes and quality-flagged cadences, so that :func:`exofinder.astro.cleaning.clean` remains the
single place where data are filtered (and where the filtering is reported). The only rows dropped
here are those with a non-finite ``TIME``: Kepler writes NaN times for cadences with no observation
at all (e.g. during safe modes), so they carry no information; their count is recorded in
``meta["n_dropped_nan_time"]``.

Damaged input is refused rather than partially used: a file whose headers or data blocks end
before the size its headers declare (an interrupted download) raises
:class:`~exofinder.astro.errors.LightCurveFormatError`. Gzip-compressed FITS (``*.fits.gz``) is
decompressed transparently, up to :data:`MAX_DECOMPRESSED_BYTES`.
"""

from __future__ import annotations

import gzip
import io
import math
import os
import zlib
from pathlib import Path
from typing import IO, Any

import numpy as np
from astropy.io import fits

from ..config import BKJD_OFFSET
from .errors import LightCurveFormatError
from .types import LightCurve

#: TESS barycentric time reference: BTJD = BJD_TDB - 2457000.0
BTJD_OFFSET = 2457000.0

FitsSource = str | os.PathLike | bytes | bytearray | memoryview | IO[bytes]

#: Flux columns tried, in order, when ``flux_column`` is not given.
FLUX_COLUMN_PREFERENCE: tuple[str, ...] = ("PDCSAP_FLUX", "SAP_FLUX", "KSPSAP_FLUX", "FLUX")
_QUALITY_COLUMNS: tuple[str, ...] = ("SAP_QUALITY", "QUALITY")

#: Upper limit on the decompressed size of a gzip-compressed FITS file (guards against gzip bombs;
#: a Kepler quarter is ~0.5 MB and a TESS 20-s sector light curve ~10 MB).
MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024


def _hget(header: fits.Header | None, key: str) -> Any:
    """Header value or None when missing/undefined/blank."""
    if header is None or key not in header:
        return None
    value = header[key]
    if isinstance(value, fits.card.Undefined):
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _as_int(value: Any) -> int | None:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    try:
        v = None if value is None else float(value)
    except (TypeError, ValueError):
        return None
    return v if v is not None and math.isfinite(v) else None


def _read_source_bytes(source: FitsSource) -> tuple[bytes, str | None]:
    """Return the raw file content and a display name (basename) when known."""
    if isinstance(source, (bytes, bytearray, memoryview)):
        return bytes(source), None
    if hasattr(source, "read"):
        data = source.read()  # type: ignore[union-attr]
        if isinstance(data, str):
            raise LightCurveFormatError("FITS input must be opened in binary mode.")
        name = getattr(source, "name", None)
        return bytes(data), (Path(name).name if isinstance(name, str) else None)
    path = Path(os.fspath(source))
    try:
        return path.read_bytes(), path.name
    except OSError as exc:
        raise LightCurveFormatError(f"Cannot read FITS file '{path}': {exc}") from exc


def _maybe_gunzip(content: bytes, label: str) -> bytes:
    """Decompress gzip input (magic bytes 1f 8b); other content is returned unchanged."""
    if content[:2] != b"\x1f\x8b":
        return content
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(content)) as gz:
            data = gz.read(MAX_DECOMPRESSED_BYTES + 1)
    except (OSError, EOFError, zlib.error) as exc:
        raise LightCurveFormatError(f"Corrupt gzip-compressed FITS file{label}: {exc}") from exc
    if len(data) > MAX_DECOMPRESSED_BYTES:
        raise LightCurveFormatError(
            f"The gzip-compressed file{label} expands to more than {MAX_DECOMPRESSED_BYTES // 2**20} MB, "
            "which is far larger than any light-curve file."
        )
    return data


def _check_complete(hdul: fits.HDUList, n_bytes: int, label: str) -> None:
    """Raise if any HDU's data block ends beyond the end of the file (truncated file).

    The data size follows the FITS standard (v4.0, eq. 2): ``|BITPIX|/8 * GCOUNT * (PCOUNT +
    NAXIS1 * ... * NAXISn)`` bytes from the start of the data block; trailing padding to a multiple
    of 2880 bytes is not required. astropy only warns about truncation and would return the
    missing rows as garbage or fail later with an unrelated error.
    """
    for i, hdu in enumerate(hdul):
        h = hdu.header
        naxis = int(h.get("NAXIS", 0) or 0)
        if naxis == 0:
            continue
        n_elem = 1
        for k in range(1, naxis + 1):
            n_elem *= int(h.get(f"NAXIS{k}", 0) or 0)
        bytes_per_value = abs(int(h.get("BITPIX", 8))) // 8
        size = bytes_per_value * int(h.get("GCOUNT", 1) or 1) * (int(h.get("PCOUNT", 0) or 0) + n_elem)
        info = hdul.fileinfo(i)
        if info is None or size == 0:
            continue
        if int(info["datLoc"]) + size > n_bytes:
            raise LightCurveFormatError(
                f"The FITS file{label} is truncated: extension {i} ({hdu.name or 'unnamed'}) needs "
                f"{int(info['datLoc']) + size} bytes but the file has only {n_bytes}. "
                "The download or upload was probably interrupted; please fetch the file again."
            )


def _find_lightcurve_hdu(hdul: fits.HDUList) -> fits.BinTableHDU:
    for hdu in hdul[1:]:
        if isinstance(hdu, fits.BinTableHDU) and hdu.columns is not None:
            names = {n.upper() for n in hdu.columns.names}
            if "TIME" in names:
                return hdu
    raise LightCurveFormatError(
        "No light-curve table found: the FITS file has no binary-table extension with a TIME column."
    )


def _column(hdu: fits.BinTableHDU, name: str) -> np.ndarray:
    """Column by case-insensitive name, as a native-endian float64 array."""
    for n in hdu.columns.names:
        if n.upper() == name.upper():
            return np.array(hdu.data[n], dtype=np.float64)
    raise KeyError(name)


def _has_column(hdu: fits.BinTableHDU, name: str) -> bool:
    return name.upper() in {n.upper() for n in hdu.columns.names}


def _detect_mission(h0: fits.Header, h1: fits.Header) -> str:
    mission = str(_hget(h0, "MISSION") or "").strip().upper()
    telescope = str(_hget(h0, "TELESCOP") or _hget(h1, "TELESCOP") or "").strip().upper()
    if mission == "TESS" or telescope == "TESS":
        return "TESS"
    if mission == "K2" or (
        telescope == "KEPLER" and _hget(h0, "CAMPAIGN") is not None and _hget(h0, "QUARTER") is None
    ):
        return "K2"
    if mission == "KEPLER" or telescope == "KEPLER":
        return "Kepler"
    return mission or telescope or "unknown"


def _detect_time_system(h1: fits.Header) -> tuple[str, float | None]:
    """Time system name from the reference-epoch keywords (BJDREFI + BJDREFF, TIMEREF, TIMEUNIT)."""
    refi = _as_float(_hget(h1, "BJDREFI"))
    reff = _as_float(_hget(h1, "BJDREFF")) or 0.0
    timeref = str(_hget(h1, "TIMEREF") or "SOLARSYSTEM").strip().upper()
    unit = str(_hget(h1, "TIMEUNIT") or "d").strip().lower()
    if refi is None:
        return "unknown", None
    ref = refi + reff
    if unit not in ("d", "day", "days") or timeref != "SOLARSYSTEM":
        return "unknown", ref
    if abs(ref - BKJD_OFFSET) < 1e-6:
        return "BKJD", ref
    if abs(ref - BTJD_OFFSET) < 1e-6:
        return "BTJD", ref
    return "unknown", ref


def _parse(content: bytes, name: str | None, flux_column: str | None) -> LightCurve:
    """Parse FITS bytes; every failure on bad input surfaces as :class:`LightCurveFormatError`."""
    label = f" ({name})" if name else ""
    content = _maybe_gunzip(content, label)
    try:
        # lazy_load_hdus=False reads every header now, so a truncated or corrupt header fails here
        # instead of later, from inside the table lookup, with a raw OSError.
        hdul = fits.open(io.BytesIO(content), memmap=False, lazy_load_hdus=False)
    except Exception as exc:  # astropy raises OSError/TypeError/ValueError for corrupt input
        raise LightCurveFormatError(f"Not a valid FITS file{label}: {exc}") from exc
    try:
        with hdul:
            _check_complete(hdul, len(content), label)
            return _parse_hdul(hdul, name, flux_column)
    except LightCurveFormatError:
        raise
    except (OSError, ValueError, TypeError, KeyError, IndexError) as exc:
        raise LightCurveFormatError(f"Cannot read the light-curve table{label}: {exc}") from exc


def _parse_hdul(hdul: fits.HDUList, name: str | None, flux_column: str | None) -> LightCurve:
    """Build the :class:`LightCurve` (and its provenance ``meta``) from an opened, complete file."""
    h0 = hdul[0].header
    hdu = _find_lightcurve_hdu(hdul)
    h1 = hdu.header
    available = list(hdu.columns.names)

    if flux_column is None:
        chosen = next((c for c in FLUX_COLUMN_PREFERENCE if _has_column(hdu, c)), None)
        if chosen is None:
            raise LightCurveFormatError(
                "No flux column found (looked for "
                f"{', '.join(FLUX_COLUMN_PREFERENCE)}); columns present: {', '.join(available)}"
            )
    else:
        if not _has_column(hdu, flux_column):
            raise LightCurveFormatError(
                f"Flux column '{flux_column}' not found; columns present: {', '.join(available)}"
            )
        chosen = flux_column.upper()

    try:
        time = _column(hdu, "TIME")
        flux = _column(hdu, chosen)
    except (TypeError, ValueError) as exc:
        raise LightCurveFormatError(f"TIME/{chosen} columns are not numeric: {exc}") from exc

    err_name = next(
        (c for c in (f"{chosen}_ERR", "FLUX_ERR" if chosen == "FLUX" else "") if c and _has_column(hdu, c)),
        None,
    )
    flux_err = _column(hdu, err_name) if err_name else None
    qual_name = next((c for c in _QUALITY_COLUMNS if _has_column(hdu, c)), None)
    quality = None
    if qual_name is not None:
        q = _column(hdu, qual_name)
        quality = np.where(np.isfinite(q), q, 0).astype(np.int64)

    mission = _detect_mission(h0, h1)
    time_system, bjd_ref = _detect_time_system(h1)

    segment_value: int | None = None
    segment_key: str | None = None
    for key in ("QUARTER", "CAMPAIGN", "SECTOR"):
        v = _as_int(_hget(h0, key))
        if v is not None:
            segment_value, segment_key = v, key
            break

    good_time = np.isfinite(time)
    n_file = int(time.size)
    cadence = _as_float(_hget(h1, "TIMEDEL"))
    if cadence is None and good_time.sum() > 1:
        d = np.diff(np.sort(time[good_time]))
        d = d[d > 0]
        cadence = float(np.median(d)) if d.size else None

    meta: dict[str, Any] = {
        "source": "fits",
        "filename": name,
        "mission": mission,
        "time_system": time_system,
        "bjd_reference": bjd_ref,
        "flux_column": chosen,
        "flux_err_column": err_name,
        "quality_column": qual_name,
        "cadence_days": cadence,
        "object": _hget(h0, "OBJECT"),
        "n_cadences_file": n_file,
        "n_dropped_nan_time": int(n_file - good_time.sum()),
    }
    kepid = _as_int(_hget(h0, "KEPLERID"))
    if kepid is not None:
        meta["kepid"] = kepid
    tic = _as_int(_hget(h0, "TICID"))
    if tic is not None:
        meta["ticid"] = tic
    if segment_key is not None:
        meta[segment_key.lower()] = segment_value
    for key, out in (("OBSMODE", "obsmode"), ("DATA_REL", "data_release"), ("CHANNEL", "channel")):
        v = _hget(h0, key)
        if v is not None:
            meta[out] = v if isinstance(v, (int, float, str)) else str(v)
    for key, out in (("RA_OBJ", "ra"), ("DEC_OBJ", "dec"), ("KEPMAG", "kepmag"), ("TESSMAG", "tessmag")):
        v = _as_float(_hget(h0, key))
        if v is not None:
            meta[out] = v
    for key, out in (("CROWDSAP", "crowdsap"), ("FLFRCSAP", "flfrcsap"), ("CDPP3_0", "cdpp3_0_ppm")):
        v = _as_float(_hget(h1, key))
        if v is not None:
            meta[out] = v

    segment = None
    if segment_value is not None:
        segment = np.full(int(good_time.sum()), segment_value, dtype=np.int64)
    return LightCurve(
        time=time[good_time],
        flux=flux[good_time],
        flux_err=None if flux_err is None else flux_err[good_time],
        quality=None if quality is None else quality[good_time],
        segment=segment,
        meta=meta,
    )


def read_fits_lightcurve(path_or_bytes: FitsSource, flux_column: str | None = None) -> LightCurve:
    """Read a Kepler/K2/TESS-style FITS light curve (first BINTABLE extension with a TIME column).

    The flux column is ``flux_column`` if given, else the first present of PDCSAP_FLUX, SAP_FLUX,
    KSPSAP_FLUX, FLUX. Its ``*_ERR`` column and SAP_QUALITY/QUALITY are read when present.
    ``meta["mission"]`` is Kepler/K2/TESS (from MISSION/TELESCOP) and ``meta["time_system"]`` is BKJD
    or BTJD when BJDREFI+BJDREFF equals 2454833 or 2457000 with barycentric (SOLARSYSTEM) times in
    days, else ``"unknown"``. ``segment`` is the QUARTER/CAMPAIGN/SECTOR number when present.

    Raises :class:`LightCurveFormatError` for unreadable files or missing columns.
    """
    content, name = _read_source_bytes(path_or_bytes)
    return _parse(content, name, flux_column)


def read_kepler_fits(path_or_bytes: FitsSource) -> LightCurve:
    """Read one Kepler prime-mission light-curve quarter (``kplr<kic9>-<stamp>_llc.fits``).

    Returns TIME (BKJD), PDCSAP_FLUX, PDCSAP_FLUX_ERR and SAP_QUALITY; ``segment`` is the QUARTER
    number for every cadence. ``meta`` contains ``kepid``, ``quarter``, ``mission="Kepler"``,
    ``time_system="BKJD"``, ``flux_column="PDCSAP_FLUX"``, ``cadence_days`` (TIMEDEL, 0.02043 d =
    29.4 min for long cadence) plus provenance such as ``filename``, ``obsmode`` and ``data_release``.

    Raises :class:`LightCurveFormatError` if the file is not a Kepler quarter light curve.
    """
    content, name = _read_source_bytes(path_or_bytes)
    lc = _parse(content, name, None)  # prefers PDCSAP_FLUX when present
    meta = lc.meta
    problems = []
    if meta.get("flux_column") != "PDCSAP_FLUX":
        problems.append("no PDCSAP_FLUX column")
    if meta.get("mission") != "Kepler":
        problems.append(f"mission is {meta.get('mission')!r}, expected 'Kepler'")
    if meta.get("quarter") is None:
        problems.append("no QUARTER keyword")
    if meta.get("kepid") is None:
        problems.append("no KEPLERID keyword")
    if meta.get("quality_column") != "SAP_QUALITY":
        problems.append("no SAP_QUALITY column")
    if meta.get("time_system") != "BKJD":
        problems.append(f"time reference is {meta.get('bjd_reference')!r}, expected BJD 2454833.0 (BKJD)")
    if problems:
        raise LightCurveFormatError(
            "Not a Kepler quarter light-curve file (" + "; ".join(problems) + "). "
            "Use the generic FITS reader for K2/TESS or other files."
        )
    return lc


__all__ = ["BTJD_OFFSET", "FLUX_COLUMN_PREFERENCE", "read_fits_lightcurve", "read_kepler_fits"]
