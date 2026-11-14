"""Reader for user-supplied CSV/text light curves.

Uploaded tables vary a lot (column names, delimiters, comment lines, time systems), so this module
(1) suggests a column mapping with :func:`detect_columns`, which the UI shows to the user for
confirmation, and (2) validates the table strictly in :func:`read_csv_lightcurve`, raising
:class:`~exofinder.astro.errors.LightCurveFormatError` with a message that says what is wrong and how
to fix it. No value is invented: invalid rows are reported, never silently repaired, except exact
duplicate rows, which are dropped and counted in ``meta``.

Time systems
------------
``BKJD``  Kepler barycentric Julian date, BJD - 2454833.0 (kept as is)
``BJD``   full barycentric Julian date (converted to BKJD by subtracting 2454833.0)
``BTJD``  TESS barycentric Julian date, BJD - 2457000.0 (kept as is; ``meta["time_system"]="BTJD"``)
``days``  relative days with unknown zero point (kept as is; ``meta["time_system"]="unknown"``)
"""

from __future__ import annotations

import csv
import io
import os
import re
from pathlib import Path
from typing import IO, Any

import numpy as np
import pandas as pd

from ..config import BKJD_OFFSET
from .errors import LightCurveFormatError
from .types import LightCurve

CsvSource = str | os.PathLike | bytes | bytearray | IO[str] | IO[bytes]

#: Minimum number of valid (finite time and flux) rows for a usable light curve.
MIN_VALID_ROWS = 100

TIME_SYSTEMS: tuple[str, ...] = ("BKJD", "BJD", "BTJD", "days")

#: Largest plausible BKJD/BTJD value (days): 20,000 d after the reference epochs is after 2050.
MAX_MISSION_DAY = 20000.0

_TIME_NAMES = (
    "time",
    "bkjd",
    "time_bkjd",
    "bjd",
    "time_bjd",
    "bjd_tdb",
    "btjd",
    "time_btjd",
    "jd",
    "hjd",
    "mjd",
    "times",
    "timestamp",
    "date",
    "t",
    "days",
)
_FLUX_NAMES = (
    "pdcsap_flux",
    "flux",
    "sap_flux",
    "kspsap_flux",
    "rel_flux",
    "relative_flux",
    "norm_flux",
    "normalized_flux",
    "normalised_flux",
    "flux_norm",
    "det_flux",
    "f",
    "brightness",
    "intensity",
)
_ERR_NAMES = (
    "pdcsap_flux_err",
    "flux_err",
    "flux_error",
    "sap_flux_err",
    "kspsap_flux_err",
    "fluxerr",
    "flux_unc",
    "e_flux",
    "err",
    "error",
    "unc",
    "uncertainty",
    "sigma",
    "dy",
    "df",
)
_QUALITY_NAMES = ("sap_quality", "quality", "qual", "quality_flag", "quality_flags", "flag", "flags", "q")

_NA_TOKENS = {"", "nan", "na", "n/a", "null", "none", "-nan", "+nan"}


def _norm(name: Any) -> str:
    """Normalise a header: lower case, units in brackets removed, separators -> underscore."""
    s = str(name).strip().lower()
    s = re.sub(r"[\(\[\{].*?[\)\]\}]", "", s)  # "time [d]" -> "time"
    s = re.sub(r"[\s\-\./]+", "_", s).strip("_")
    return s


def _is_numeric_like(series: pd.Series, min_frac: float = 0.9) -> bool:
    if pd.api.types.is_numeric_dtype(series):
        return True
    converted = pd.to_numeric(series, errors="coerce")
    nonnull = series.notna().sum()
    return nonnull > 0 and converted.notna().sum() >= min_frac * nonnull


def detect_columns(df: pd.DataFrame) -> dict[str, str | None]:
    """Suggest which columns hold time, flux, flux error and quality flags.

    Returns ``{"time": ..., "flux": ..., "flux_err": ..., "quality": ...}`` with column names (as
    they appear in ``df``) or ``None``. Matching is by known names first (case-insensitive, units in
    brackets ignored, e.g. ``"TIME [BJD-2454833]"``, ``"PDCSAP_FLUX"``, ``"flux_err"``), then by
    keywords, then, for time and flux only, by position among numeric columns (first increasing
    numeric column = time, next numeric column = flux). These are suggestions for the user to confirm.
    """
    cols = list(df.columns)
    normed = {c: _norm(c) for c in cols}
    used: set[Any] = set()

    def by_names(names: tuple[str, ...]) -> Any:
        for wanted in names:
            for c in cols:
                if c not in used and normed[c] == wanted:
                    return c
        return None

    def by_keyword(pred) -> Any:
        for c in cols:
            if c not in used and pred(normed[c]):
                return c
        return None

    time_col = by_names(_TIME_NAMES) or by_keyword(
        lambda s: any(k in s for k in ("time", "bjd", "bkjd", "btjd", "jd", "date"))
    )
    if time_col is not None:
        used.add(time_col)
    # error columns before flux so "flux_err" is not taken as the flux
    err_col = by_names(_ERR_NAMES) or by_keyword(
        lambda s: any(k in s for k in ("err", "unc", "sigma")) and "time" not in s
    )
    if err_col is not None:
        used.add(err_col)
    flux_col = by_names(_FLUX_NAMES) or by_keyword(lambda s: "flux" in s)
    if flux_col is not None:
        used.add(flux_col)
    qual_col = by_names(_QUALITY_NAMES) or by_keyword(lambda s: "quality" in s or "flag" in s)
    if qual_col is not None:
        used.add(qual_col)

    if time_col is None or flux_col is None:
        numeric = [c for c in cols if c not in used and _is_numeric_like(df[c])]
        if time_col is None:
            for c in numeric:
                v = pd.to_numeric(df[c], errors="coerce").to_numpy(dtype=float)
                v = v[np.isfinite(v)]
                if v.size > 2 and np.mean(np.diff(v) > 0) > 0.95:
                    time_col = c
                    break
            if time_col is not None:
                used.add(time_col)
                numeric = [c for c in numeric if c != time_col]
        if flux_col is None and numeric:
            flux_col = numeric[0]
            used.add(flux_col)
        if err_col is not None and flux_col is None:
            err_col = None

    return {"time": time_col, "flux": flux_col, "flux_err": err_col, "quality": qual_col}


def _source_bytes(source: CsvSource) -> tuple[bytes, str | None]:
    if isinstance(source, (bytes, bytearray)):
        return bytes(source), None
    if hasattr(source, "read"):
        data = source.read()  # type: ignore[union-attr]
        name = getattr(source, "name", None)
        raw = data.encode("utf-8") if isinstance(data, str) else bytes(data)
        return raw, (Path(name).name if isinstance(name, str) else None)
    path = Path(os.fspath(source))
    try:
        return path.read_bytes(), path.name
    except OSError as exc:
        raise LightCurveFormatError(f"Cannot read file '{path}': {exc}") from exc


def _first_row_is_data(content: bytes, read_kw: dict[str, Any]) -> bool:
    """True if the first non-comment line is all numbers, i.e. the file has no header row.

    The raw tokens are inspected: checking the column names of a default ``read_csv`` would miss a
    first data row with repeated values, because pandas renames duplicate names (``"1.0"``,
    ``"1.0.1"``) and that row would silently be lost as a header.
    """
    try:
        first = pd.read_csv(
            io.BytesIO(content),
            comment="#",
            header=None,
            nrows=1,
            dtype=str,
            skipinitialspace=True,
            **read_kw,
        )
    except (ValueError, csv.Error):
        return False
    if first.empty:
        return False
    tokens = [str(v).strip() for v in first.iloc[0].tolist() if isinstance(v, str) and v.strip()]
    if len(tokens) < 2:
        return False
    try:
        [float(tok) for tok in tokens]
    except ValueError:
        return False
    return True


def _to_utf8(content: bytes) -> bytes:
    """Re-encode text as UTF-8: UTF-16 with a byte-order mark (Excel "Unicode text" exports) and
    legacy 8-bit encodings (e.g. a Windows-1252 "e-/s" header) are converted; UTF-8 is unchanged."""
    if content.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return content.decode("utf-16").encode("utf-8")
        except UnicodeDecodeError as exc:
            raise LightCurveFormatError(
                f"The file starts like UTF-16 text but cannot be decoded: {exc}"
            ) from exc
    try:
        content.decode("utf-8")
    except UnicodeDecodeError:
        if b"\x00" in content[:4096]:
            return content  # binary; rejected with a clear message by the caller
        return content.decode("latin-1").encode("utf-8")
    return content


def _parse_table(content: bytes) -> pd.DataFrame:
    """Parse comma, tab, semicolon or whitespace delimited text; '#' starts a comment."""
    content = _to_utf8(content)
    if not content.strip():
        raise LightCurveFormatError("The file is empty.")
    text_head = content[:4096]
    if text_head.startswith(b"SIMPLE  =") or b"\x00" in text_head:
        raise LightCurveFormatError("This looks like a binary (e.g. FITS) file, not a CSV/text table.")
    attempts: list[dict[str, Any]] = [
        {"sep": ","},
        {"sep": "\t"},
        {"sep": ";"},
        {"sep": r"\s+", "engine": "python"},
    ]
    last_error: Exception | None = None
    for kw in attempts:
        try:
            df = pd.read_csv(io.BytesIO(content), comment="#", skipinitialspace=True, **kw)
        except (ValueError, csv.Error) as exc:  # pandas ParserError/EmptyDataError are ValueErrors
            last_error = exc
            continue
        if df.shape[1] >= 2:
            if _first_row_is_data(content, kw):
                df = pd.read_csv(io.BytesIO(content), comment="#", header=None, skipinitialspace=True, **kw)
                df.columns = [f"col_{i}" for i in range(df.shape[1])]
            df.columns = [str(c).strip() for c in df.columns]
            return df
    msg = "Could not parse the file as a table with at least two columns (time and flux)."
    if last_error is not None:
        msg += f" Parser error: {last_error}"
    raise LightCurveFormatError(msg)


def _to_numeric(df: pd.DataFrame, col: str, role: str) -> np.ndarray:
    """Convert a column to float, raising a clear error for any non-numeric token."""
    series = df[col]
    values = pd.to_numeric(series, errors="coerce")
    bad = values.isna() & series.notna()
    if bad.any():
        tokens = series[bad].astype(str).str.strip()
        real_bad = ~tokens.str.lower().isin(_NA_TOKENS)
        if real_bad.any():
            first = tokens[real_bad].index[0]
            n_bad = int(real_bad.sum())
            raise LightCurveFormatError(
                f"The {role} column '{col}' contains non-numeric values: {n_bad} row(s), e.g. "
                f"'{tokens[first]}' in data row {int(first) + 1}. Remove or fix these rows, or choose a "
                "different column."
            )
    return values.to_numpy(dtype=np.float64)


def read_csv_lightcurve(
    path_or_buffer: CsvSource,
    mapping: dict[str, str | None] | None = None,
    time_system: str = "BKJD",
) -> LightCurve:
    """Read and validate a CSV/text light curve.

    ``mapping`` maps roles (``time``, ``flux``, optional ``flux_err``, ``quality``) to column names;
    when omitted, :func:`detect_columns` is used. ``time_system`` is one of ``BKJD``, ``BJD``,
    ``BTJD``, ``days`` (see module docstring). Rows with non-finite time or flux are dropped (the
    pipeline's cleaning step would drop them anyway); exact duplicate rows are dropped and counted.
    The result is sorted by time; ``segment`` is None (assigned later from gaps).

    Raises :class:`LightCurveFormatError` when: columns are missing; a used column contains
    non-numeric values; time or flux is entirely NaN; fewer than 100 valid rows remain; the time
    column is not strictly increasing after sorting (duplicate time stamps with different fluxes);
    values are inconsistent with ``time_system`` (e.g. full JDs, or MJDs above
    :data:`MAX_MISSION_DAY`, declared as BKJD); the flux median is
    not positive (magnitudes or zero-centred fluxes); or a flux error is not positive.
    """
    if time_system not in TIME_SYSTEMS:
        raise LightCurveFormatError(
            f"Unknown time system '{time_system}'. Choose one of: {', '.join(TIME_SYSTEMS)}."
        )
    content, name = _source_bytes(path_or_buffer)
    df = _parse_table(content)
    n_rows_file = len(df)

    detected = detect_columns(df)
    if mapping is None:
        mapping = detected
    else:
        mapping = {k: (v if v not in ("", None) else None) for k, v in mapping.items()}
    unknown_roles = set(mapping) - {"time", "flux", "flux_err", "quality"}
    if unknown_roles:
        raise LightCurveFormatError(f"Unknown column role(s) in mapping: {', '.join(sorted(unknown_roles))}.")
    cols = list(df.columns)
    for role in ("time", "flux"):
        if mapping.get(role) is None:
            raise LightCurveFormatError(
                f"Could not identify the {role} column. Columns found: {', '.join(map(str, cols))}. "
                "Please select the columns manually."
            )
    for role, col in mapping.items():
        if col is not None and col not in df.columns:
            raise LightCurveFormatError(
                f"Column '{col}' (mapped to {role}) is not in the file. "
                f"Columns found: {', '.join(map(str, cols))}."
            )
    if mapping["time"] == mapping["flux"]:
        raise LightCurveFormatError("The time and flux columns must be different columns.")

    time = _to_numeric(df, mapping["time"], "time")  # type: ignore[arg-type]
    flux = _to_numeric(df, mapping["flux"], "flux")  # type: ignore[arg-type]
    err_col, qual_col = mapping.get("flux_err"), mapping.get("quality")
    flux_err = _to_numeric(df, err_col, "flux error") if err_col else None
    quality_f = _to_numeric(df, qual_col, "quality") if qual_col else None

    if not np.isfinite(time).any():
        raise LightCurveFormatError(
            f"The time column '{mapping['time']}' contains no numeric values (all NaN)."
        )
    if not np.isfinite(flux).any():
        raise LightCurveFormatError(
            f"The flux column '{mapping['flux']}' contains no numeric values (all NaN)."
        )

    valid = np.isfinite(time) & np.isfinite(flux)
    n_valid = int(valid.sum())
    if n_valid < MIN_VALID_ROWS:
        raise LightCurveFormatError(
            f"Only {n_valid} rows have a finite time and flux; at least {MIN_VALID_ROWS} are needed "
            "to analyse a light curve."
        )
    time, flux = time[valid], flux[valid]
    flux_err = None if flux_err is None else flux_err[valid]
    quality = None
    if quality_f is not None:
        q = quality_f[valid]
        q = np.where(np.isfinite(q), q, 0.0)
        if np.any(q != np.round(q)) or np.any(q < 0):
            raise LightCurveFormatError(
                f"The quality column '{qual_col}' must contain non-negative integer bit flags."
            )
        quality = q.astype(np.int64)

    # sort by time, drop exact duplicate rows, refuse conflicting duplicates
    order = np.argsort(time, kind="stable")
    time, flux = time[order], flux[order]
    flux_err = None if flux_err is None else flux_err[order]
    quality = None if quality is None else quality[order]
    same_t = np.concatenate([[False], np.diff(time) == 0])
    same_f = np.concatenate([[False], np.diff(flux) == 0])
    exact_dup = same_t & same_f
    n_exact_dup = int(exact_dup.sum())
    if n_exact_dup:
        keep = ~exact_dup
        time, flux = time[keep], flux[keep]
        flux_err = None if flux_err is None else flux_err[keep]
        quality = None if quality is None else quality[keep]
        if time.size < MIN_VALID_ROWS:
            raise LightCurveFormatError(
                f"Only {time.size} distinct rows remain after removing {n_exact_dup} exact duplicate "
                f"row(s); at least {MIN_VALID_ROWS} are needed to analyse a light curve."
            )
    n_conflict = int(np.sum(np.diff(time) <= 0))
    if n_conflict:
        raise LightCurveFormatError(
            f"The time column is not strictly increasing after sorting: {n_conflict} time stamp(s) appear "
            "more than once with different flux values. Check that the right column is used for time."
        )

    med_t = float(np.median(time))
    if time_system in ("BKJD", "BTJD", "days") and med_t > 2.0e6:
        raise LightCurveFormatError(
            f"Time values look like full Julian dates (median {med_t:.1f}); choose the 'BJD' time system."
        )
    if time_system in ("BKJD", "BTJD") and med_t > MAX_MISSION_DAY:
        # BKJD/BTJD of 20,000 d is after the year 2050; such values are reduced or modified Julian
        # dates (e.g. MJD ~ 55,000) whose zero point differs by ~54,833 d, so catalogue ephemerides
        # would fold the data at meaningless phases.
        raise LightCurveFormatError(
            f"Time values (median {med_t:.1f}) are too large for {time_system} (Kepler data span ~120-1600, "
            "TESS ~1300-5000); they look like MJD or BJD-2400000. Convert them to BJD and choose 'BJD', "
            "or choose 'days' if the zero point is unknown."
        )
    if time_system == "BJD":
        if med_t < 2.0e6:
            raise LightCurveFormatError(
                f"Time values (median {med_t:.1f}) are not full Julian dates; "
                "choose 'BKJD', 'BTJD' or 'days'."
            )
        time = time - BKJD_OFFSET

    med_f = float(np.median(flux))
    if not med_f > 0:
        raise LightCurveFormatError(
            f"The flux median is {med_f:.4g}, but a positive flux is required (relative flux around 1, or "
            "counts). Magnitudes and zero-centred flux differences are not supported."
        )
    if flux_err is not None:
        bad_err = np.isfinite(flux_err) & (flux_err <= 0)
        if bad_err.any():
            raise LightCurveFormatError(
                f"The flux error column '{err_col}' contains {int(bad_err.sum())} non-positive values; "
                "errors must be positive (or leave the error column unmapped)."
            )

    d = np.diff(time)
    meta: dict[str, Any] = {
        "source": "csv",
        "filename": name,
        "mission": "unknown",
        "time_system": {"BKJD": "BKJD", "BJD": "BKJD", "BTJD": "BTJD", "days": "unknown"}[time_system],
        "time_input_system": time_system,
        "columns": {k: (None if v is None else str(v)) for k, v in mapping.items()},
        "detected_columns": {k: (None if v is None else str(v)) for k, v in detected.items()},
        "flux_column": str(mapping["flux"]),
        "n_rows_file": n_rows_file,
        "n_rows_invalid": int(n_rows_file - n_valid),
        "n_exact_duplicates_dropped": n_exact_dup,
        "cadence_days": float(np.median(d[d > 0])) if np.any(d > 0) else None,
    }
    return LightCurve(time=time, flux=flux, flux_err=flux_err, quality=quality, segment=None, meta=meta)


__all__ = ["MAX_MISSION_DAY", "MIN_VALID_ROWS", "TIME_SYSTEMS", "detect_columns", "read_csv_lightcurve"]
