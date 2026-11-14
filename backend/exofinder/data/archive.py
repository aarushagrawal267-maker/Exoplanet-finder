"""NASA Exoplanet Archive TAP client and verbatim catalogue snapshots.

Every catalogue value the application uses comes from a *snapshot*: one retrieval of an
Exoplanet Archive table, saved byte-for-byte to ``data/catalogs/<source>_<UTCstamp>.csv`` together
with its SHA-256 digest, the exact ADQL text, the request URL and a validation report
(:class:`~exofinder.db.models.CatalogSnapshot`). Ingestion (:mod:`exofinder.data.catalog`) reads
only from these files, so every number shown in the UI can be traced back to a file whose hash
proves it has not been altered since download.

Sources (all public, no API key):

``dr24_tce``
    Kepler Q1–Q17 Data Release 24 Threshold-Crossing Events (table ``q1_q17_dr24_tce``, 20 367
    rows). ``av_training_set`` holds the Autovetter training labels (PC = planet candidate,
    AFP = astrophysical false positive, NTP = non-transiting phenomenon, UNK = unknown) used by
    Shallue & Vanderburg (2018, AstroNet). Times are BKJD (BJD − 2454833), durations hours,
    depths ppm.
``koi_cumulative``
    The cumulative Kepler Objects of Interest table (``cumulative``): dispositions CONFIRMED /
    CANDIDATE / FALSE POSITIVE, false-positive flags, and ``koi_tce_plnt_num`` which links a KOI
    to the TCE it was promoted from (in the TCE delivery named by ``koi_tce_delivname``).
    ``koi_score`` and the fp flags are stored for display only; they are never model features.
``confirmed``
    The Planetary Systems Composite Parameters table (``pscomppars``) joined to ``keplernames``
    on ``pl_name``. ``pscomppars`` has no KIC id; ``keplernames`` maps every confirmed planet on a
    Kepler target to its ``kepid`` (and KOI name when one exists). The inner join therefore keeps
    exactly the confirmed planets that orbit KIC targets, whatever facility announced them (e.g.
    HAT-P-7 b = Kepler-2 b was discovered by HATNet; Kepler-90 i by a neural network search of
    Kepler data and never had a KOI). Verified live on 2026-11-14: 2 784 of the 2 787
    ``disc_facility = 'Kepler'`` planets join; the remainder have no KIC id. ``pl_tranmid`` is a
    (B)JD and is converted to BKJD at ingestion.
``stellar``
    Kepler stellar properties (``keplerstellar``) restricted to the DR25 delivery
    (``st_delivname = 'q1_q17_dr25_stellar'``, one row per KIC id), for the kepids present in the
    signal catalogue. Fetched in chunks of :data:`STELLAR_CHUNK_SIZE` ids with HTTP POST; the chunk
    responses are concatenated verbatim (the repeated CSV header line is dropped).
"""

from __future__ import annotations

import io
import logging
import re
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import numpy as np
import pandas as pd
import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from exofinder.config import Settings, get_settings
from exofinder.data._util import (
    RETRYABLE_EXCEPTIONS,
    RETRYABLE_STATUS,
    atomic_write_bytes,
    backoff_delay,
    parse_retry_after,
    sha256_bytes,
)
from exofinder.db.models import CatalogSnapshot, utcnow

log = logging.getLogger(__name__)

USER_AGENT = "ExoplanetFinder/1.0 (+python-requests; research use)"
#: Number of KIC ids per ``stellar`` chunk query (≈9 kB of ADQL; ~5 s per chunk, measured).
STELLAR_CHUNK_SIZE = 1000
#: DR25 stellar delivery: one row per KIC id (the ``keplerstellar`` table holds 5 deliveries).
STELLAR_DELIVERY = "q1_q17_dr25_stellar"


# ------------------------------------------------------------------------------------------------
# Errors
# ------------------------------------------------------------------------------------------------
class ArchiveError(RuntimeError):
    """Base class for Exoplanet Archive failures."""


class ArchiveQueryError(ArchiveError):
    """The archive rejected the query (ADQL error, firewall block, malformed response).

    Not retried: repeating the same request would fail the same way.
    """

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class ArchiveUnavailableError(ArchiveError):
    """Transient failures persisted after all retries (network down, 5xx, rate limiting)."""


class _TruncatedResponse(Exception):
    """A CSV body that stops mid-line: the connection closed early without a transport error."""


class SnapshotValidationError(ArchiveError):
    """A downloaded table failed validation (missing columns, empty, duplicate keys...)."""

    def __init__(self, message: str, validation: dict[str, Any]) -> None:
        super().__init__(message)
        self.validation = validation


# ------------------------------------------------------------------------------------------------
# Source specifications
# ------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class SourceSpec:
    """How to query and validate one catalogue source."""

    name: str
    table_name: str
    description: str
    columns: tuple[str, ...]  # column names as they appear in the CSV output
    key_columns: tuple[str, ...]  # must be unique per row
    duplicate_keys_fatal: bool
    expected_min_rows: int  # sanity threshold for a *live* snapshot (warning when below)
    #: ``{column: (lo, hi)}``; values outside the open interval are counted as range violations.
    #: ``None`` bounds are open. Missing values are counted separately.
    ranges: dict[str, tuple[float | None, float | None]] = field(default_factory=dict)
    #: Columns whose values must be non-missing for a row to be usable (counted, not fatal).
    required_values: tuple[str, ...] = ()
    #: ``{column: allowed values}`` for categorical columns (unexpected values → warning).
    allowed_values: dict[str, frozenset[str]] = field(default_factory=dict)


TCE_COLUMNS = (
    "kepid",
    "tce_plnt_num",
    "tce_period",
    "tce_period_err",
    "tce_time0bk",
    "tce_time0bk_err",
    "tce_duration",
    "tce_duration_err",
    "tce_depth",
    "tce_depth_err",
    "tce_model_snr",
    "tce_prad",
    "tce_num_transits",
    "ra",
    "dec",
    "av_training_set",
)

KOI_COLUMNS = (
    "kepid",
    "kepoi_name",
    "kepler_name",
    "koi_disposition",
    "koi_pdisposition",
    "koi_score",
    "koi_fpflag_nt",
    "koi_fpflag_ss",
    "koi_fpflag_co",
    "koi_fpflag_ec",
    "koi_disp_prov",
    "koi_vet_stat",
    "koi_vet_date",
    "koi_period",
    "koi_period_err1",
    "koi_time0bk",
    "koi_time0bk_err1",
    "koi_duration",
    "koi_duration_err1",
    "koi_depth",
    "koi_depth_err1",
    "koi_model_snr",
    "koi_prad",
    "koi_tce_plnt_num",
    "koi_tce_delivname",
    "ra",
    "dec",
    "koi_kepmag",
)

#: (table alias, column) pairs for the confirmed-planet join; output names are the bare columns.
CONFIRMED_SELECT = (
    ("k", "kepid"),
    ("k", "kepler_name"),
    ("k", "koi_name"),
    ("p", "pl_name"),
    ("p", "hostname"),
    ("p", "pl_letter"),
    ("p", "pl_orbper"),
    ("p", "pl_orbpererr1"),
    ("p", "pl_tranmid"),
    ("p", "pl_tranmiderr1"),
    ("p", "pl_tranmid_systemref"),
    ("p", "pl_trandur"),
    ("p", "pl_trandep"),
    ("p", "pl_rade"),
    ("p", "tran_flag"),
    ("p", "disc_facility"),
    ("p", "discoverymethod"),
    ("p", "disc_year"),
    ("p", "ra"),
    ("p", "dec"),
    ("p", "sy_kepmag"),
)

STELLAR_COLUMNS = (
    "kepid",
    "teff",
    "logg",
    "feh",
    "radius",
    "mass",
    "dens",
    "kepmag",
    "ra",
    "dec",
    "prov_sec",
    "st_delivname",
)

SOURCES: dict[str, SourceSpec] = {
    "dr24_tce": SourceSpec(
        name="dr24_tce",
        table_name="q1_q17_dr24_tce",
        description="Kepler Q1-Q17 DR24 Threshold-Crossing Events with Autovetter training labels",
        columns=TCE_COLUMNS,
        key_columns=("kepid", "tce_plnt_num"),
        duplicate_keys_fatal=True,
        expected_min_rows=20000,  # DR24 is a frozen release of 20 367 TCEs
        ranges={
            "kepid": (0, None),
            "tce_plnt_num": (0, None),
            "tce_period": (0, None),
            "tce_duration": (0, None),
        },
        required_values=("kepid", "tce_plnt_num", "tce_period", "tce_time0bk", "tce_duration"),
        allowed_values={"av_training_set": frozenset({"PC", "AFP", "NTP", "UNK"})},
    ),
    "koi_cumulative": SourceSpec(
        name="koi_cumulative",
        table_name="cumulative",
        description="Cumulative Kepler Objects of Interest table (dispositions, fp flags, TCE link)",
        columns=KOI_COLUMNS,
        key_columns=("kepoi_name",),
        duplicate_keys_fatal=True,
        expected_min_rows=9000,
        ranges={"kepid": (0, None), "koi_period": (0, None), "koi_duration": (0, None)},
        required_values=("kepid", "kepoi_name", "koi_period", "koi_time0bk", "koi_duration"),
        allowed_values={
            "koi_disposition": frozenset({"CONFIRMED", "CANDIDATE", "FALSE POSITIVE", "NOT DISPOSITIONED"}),
            "koi_pdisposition": frozenset({"CANDIDATE", "FALSE POSITIVE", "NOT DISPOSITIONED"}),
        },
    ),
    "confirmed": SourceSpec(
        name="confirmed",
        table_name="pscomppars+keplernames",
        description="Confirmed planets on Kepler (KIC) targets: pscomppars joined to keplernames",
        columns=tuple(c for _, c in CONFIRMED_SELECT),
        key_columns=("kepler_name",),
        duplicate_keys_fatal=False,
        expected_min_rows=2500,
        ranges={"kepid": (0, None), "pl_orbper": (0, None), "pl_trandur": (0, None)},
        required_values=("kepid", "kepler_name"),
    ),
    "stellar": SourceSpec(
        name="stellar",
        table_name="keplerstellar",
        description=f"Kepler stellar properties, {STELLAR_DELIVERY} delivery",
        columns=STELLAR_COLUMNS,
        key_columns=("kepid",),
        duplicate_keys_fatal=False,
        expected_min_rows=1,
        ranges={"kepid": (0, None), "teff": (1000, 100000), "radius": (0, None), "logg": (-1, 9)},
        required_values=("kepid",),
    ),
}

ALL_SOURCES: tuple[str, ...] = ("dr24_tce", "koi_cumulative", "confirmed", "stellar")


def build_query(source: str, kepids: Iterable[int] | None = None) -> list[str]:
    """Return the ADQL statement(s) for ``source``.

    Only ``stellar`` with ``kepids`` produces more than one statement (one per chunk). Queries are
    ordered so that repeated snapshots of an unchanged table are byte-identical.
    """
    spec = _spec(source)
    if source == "dr24_tce":
        return [f"SELECT {', '.join(spec.columns)} FROM {spec.table_name} ORDER BY kepid, tce_plnt_num"]
    if source == "koi_cumulative":
        return [f"SELECT {', '.join(spec.columns)} FROM {spec.table_name} ORDER BY kepoi_name"]
    if source == "confirmed":
        cols = ", ".join(f"{a}.{c}" for a, c in CONFIRMED_SELECT)
        return [
            f"SELECT {cols} FROM pscomppars p JOIN keplernames k ON p.pl_name = k.pl_name "
            "ORDER BY k.kepid, k.kepler_name"
        ]
    if source == "stellar":
        base = (
            f"SELECT {', '.join(spec.columns)} FROM keplerstellar WHERE st_delivname = '{STELLAR_DELIVERY}'"
        )
        if kepids is None:
            return [f"{base} ORDER BY kepid"]
        ids = sorted({int(k) for k in kepids})
        if not ids:
            raise ValueError("stellar snapshot requested for an empty kepid list")
        chunks = [ids[i : i + STELLAR_CHUNK_SIZE] for i in range(0, len(ids), STELLAR_CHUNK_SIZE)]
        return [
            f"{base} AND kepid IN ({', '.join(str(k) for k in chunk)}) ORDER BY kepid" for chunk in chunks
        ]
    raise ValueError(f"unknown catalogue source {source!r}")  # pragma: no cover - guarded by _spec


def _spec(source: str) -> SourceSpec:
    try:
        return SOURCES[source]
    except KeyError:
        raise ValueError(f"unknown catalogue source {source!r}; expected one of {sorted(SOURCES)}") from None


# ------------------------------------------------------------------------------------------------
# TAP client
# ------------------------------------------------------------------------------------------------
_VOTABLE_ERROR = re.compile(
    rb'<INFO[^>]*name="QUERY_STATUS"[^>]*value="ERROR"[^>]*>(.*?)</INFO>', re.S | re.I
)


class ArchiveClient:
    """Minimal synchronous TAP client for the NASA Exoplanet Archive.

    Queries are sent with HTTP POST (``query`` + ``format=csv``) so long ADQL statements (chunked
    ``kepid IN (...)`` lists) are not limited by URL length. Transient failures (connection errors,
    timeouts, HTTP 408/425/429/5xx, a CSV body cut off mid-line) are retried with deterministic
    exponential backoff, honouring ``Retry-After`` (capped). ADQL errors (HTTP 400 with a VOTable
    ``QUERY_STATUS=ERROR``) and HTML pages (e.g. a web-application-firewall challenge) raise
    :class:`ArchiveQueryError` immediately.
    """

    def __init__(
        self,
        tap_url: str | None = None,
        timeout: float | None = None,
        *,
        max_retries: int = 4,
        backoff_s: float = 2.0,
        http: requests.Session | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        settings = get_settings()
        self.tap_url = tap_url or settings.archive_tap_url
        self.timeout = float(timeout if timeout is not None else settings.http_timeout)
        self.max_retries = int(max_retries)
        self.backoff_s = float(backoff_s)
        self._http = http
        self._sleep = sleep

    # -- public API -------------------------------------------------------------------------------
    def query(self, adql: str) -> pd.DataFrame:
        """Run ``adql`` and return the result as a DataFrame (parsed from the CSV response)."""
        return parse_csv_bytes(self.query_bytes(adql))

    def query_text(self, adql: str) -> str:
        return self.query_bytes(adql).decode("utf-8")

    def query_bytes(self, adql: str) -> bytes:
        """Run ``adql`` and return the raw CSV response body exactly as served."""
        http = self._http or requests.Session()
        try:
            return self._query_with_retries(http, adql)
        finally:
            if self._http is None:
                http.close()

    def get_url(self, adql: str) -> str:
        """Equivalent HTTP GET URL for ``adql`` (stored with snapshots for reproducibility)."""
        return f"{self.tap_url}?{urlencode({'query': adql, 'format': 'csv'})}"

    # -- internals --------------------------------------------------------------------------------
    def _query_with_retries(self, http: requests.Session, adql: str) -> bytes:
        last_error: str = ""
        for attempt in range(self.max_retries + 1):
            retry_after: float | None = None
            try:
                resp = http.post(
                    self.tap_url,
                    data={"query": adql, "format": "csv"},
                    timeout=self.timeout,
                    headers={"User-Agent": USER_AGENT, "Accept": "text/csv, text/plain, */*"},
                )
            except RETRYABLE_EXCEPTIONS as exc:
                last_error = f"{type(exc).__name__}: {exc}"
            else:
                if resp.status_code in RETRYABLE_STATUS:
                    last_error = f"HTTP {resp.status_code}"
                    retry_after = parse_retry_after(resp.headers.get("Retry-After"))
                else:
                    try:
                        return self._check_response(resp)
                    except _TruncatedResponse as exc:
                        last_error = str(exc)
            if attempt < self.max_retries:
                delay = max(retry_after or 0.0, backoff_delay(attempt, self.backoff_s))
                log.warning(
                    "TAP query failed (%s); retry %d/%d in %.1fs",
                    last_error,
                    attempt + 1,
                    self.max_retries,
                    delay,
                )
                self._sleep(delay)
        raise ArchiveUnavailableError(
            f"NASA Exoplanet Archive unavailable after {self.max_retries + 1} attempts: {last_error}"
        )

    @staticmethod
    def _check_response(resp: requests.Response) -> bytes:
        body = resp.content or b""
        head = body.lstrip()[:512].lower()
        match = _VOTABLE_ERROR.search(body[:20000])
        if match:
            msg = match.group(1).decode("utf-8", "replace").strip()
            raise ArchiveQueryError(
                f"Archive rejected the query (HTTP {resp.status_code}): {msg}", resp.status_code
            )
        if head.startswith(b"<!doctype html") or head.startswith(b"<html"):
            raise ArchiveQueryError(
                f"Archive returned an HTML page instead of CSV (HTTP {resp.status_code}); "
                "the request may have been blocked by a firewall",
                resp.status_code,
            )
        if resp.status_code != 200:
            raise ArchiveQueryError(f"Archive returned HTTP {resp.status_code}", resp.status_code)
        if head.startswith(b"<?xml") or head.startswith(b"<votable"):
            raise ArchiveQueryError("Archive returned XML instead of CSV", resp.status_code)
        if not body.strip():
            raise ArchiveQueryError("Archive returned an empty response", resp.status_code)
        if not body.endswith(b"\n"):
            # The archive terminates every CSV record (header included) with a newline. A body
            # that stops mid-line was cut off by a connection closed without a transport error
            # (no chunked framing / Content-Length to detect it). Ingesting it would silently
            # drop catalogue rows -- and write_catalog deletes signals missing from a snapshot.
            raise _TruncatedResponse(f"CSV response of {len(body)} bytes ends mid-line (transfer cut off)")
        return body


def parse_csv_bytes(data: bytes) -> pd.DataFrame:
    """Parse an archive CSV payload (quoted strings, empty fields = missing)."""
    return pd.read_csv(io.BytesIO(data), low_memory=False)


# ------------------------------------------------------------------------------------------------
# Validation
# ------------------------------------------------------------------------------------------------
def validate_snapshot(source: str, df: pd.DataFrame, *, live: bool = True) -> dict[str, Any]:
    """Validate a parsed snapshot. Returns a JSON-serialisable report.

    ``ok`` is False (and ingestion must refuse the snapshot) when required columns are missing,
    the table is empty, or the primary key is duplicated for sources where that is fatal. Range
    and categorical violations are reported as counts (rows with unusable ephemerides are skipped,
    and counted, by the ingester). ``live`` enables the row-count sanity check that only makes sense
    for full downloads (not for small offline/test files).
    """
    spec = _spec(source)
    errors: list[str] = []
    warnings: list[str] = []
    checks: dict[str, int] = {}
    cols = [str(c) for c in df.columns]
    missing = [c for c in spec.columns if c not in cols]
    if missing:
        errors.append(f"missing required columns: {', '.join(missing)}")
    n = int(len(df))
    if n == 0:
        errors.append("snapshot has no rows")
    if live and 0 < n < spec.expected_min_rows:
        warnings.append(f"row count {n} below expected minimum {spec.expected_min_rows}")

    if not missing and n:
        dup = int(df.duplicated(subset=list(spec.key_columns), keep=False).sum())
        checks["duplicate_key_rows"] = dup
        if dup:
            text = f"{dup} rows share a key {spec.key_columns}"
            (errors if spec.duplicate_keys_fatal else warnings).append(text)
        for col in spec.required_values:
            n_missing = int(df[col].isna().sum())
            checks[f"missing_{col}"] = n_missing
            if n_missing:
                if col in spec.key_columns or col == "kepid":
                    errors.append(f"{n_missing} rows have no {col}")
                else:
                    warnings.append(f"{n_missing} rows have no {col}")
        for col, (lo, hi) in spec.ranges.items():
            vals = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float)
            finite = np.isfinite(vals)
            bad = np.zeros(n, dtype=bool)
            if lo is not None:
                bad |= finite & (vals <= lo)
            if hi is not None:
                bad |= finite & (vals >= hi)
            non_numeric = int((~finite & df[col].notna().to_numpy()).sum())
            checks[f"out_of_range_{col}"] = int(bad.sum()) + non_numeric
            if bad.sum() or non_numeric:
                warnings.append(f"{int(bad.sum()) + non_numeric} rows have {col} outside ({lo}, {hi})")
        for col, allowed in spec.allowed_values.items():
            vals = df[col].dropna().astype(str).str.strip()
            unexpected = sorted(set(vals) - set(allowed))
            checks[f"unexpected_{col}"] = int(vals.isin(unexpected).sum())
            if unexpected:
                warnings.append(f"unexpected {col} values: {unexpected[:10]}")
    return {
        "ok": not errors,
        "row_count": n,
        "columns": cols,
        "missing_columns": missing,
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
        "live": live,
    }


# ------------------------------------------------------------------------------------------------
# Snapshots
# ------------------------------------------------------------------------------------------------
@dataclass
class SnapshotResult:
    """Outcome of :func:`fetch_snapshot` (or of registering an offline file)."""

    source: str
    table_name: str
    query: str
    url: str
    path: Path
    sha256: str
    row_count: int
    retrieved_at: datetime
    validation: dict[str, Any]
    snapshot_id: int | None = None
    frame: pd.DataFrame | None = field(default=None, repr=False)

    def summary(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "snapshot_id": self.snapshot_id,
            "rows": self.row_count,
            "sha256": self.sha256,
            "path": str(self.path),
            "retrieved_at": self.retrieved_at.isoformat(),
            "warnings": list(self.validation.get("warnings", [])),
        }


def fetch_snapshot(
    source: str,
    *,
    client: ArchiveClient | None = None,
    session: Session | None = None,
    kepids: Iterable[int] | None = None,
    settings: Settings | None = None,
) -> SnapshotResult:
    """Download ``source`` from the archive, save it verbatim, validate it and record it.

    Steps: run the ADQL (POST, CSV) → write the response bytes unchanged to
    ``<data>/catalogs/<source>_<UTC stamp>.csv`` (atomic) → SHA-256 of those bytes → parse and
    :func:`validate_snapshot` → insert a :class:`CatalogSnapshot` row (via ``session`` when given,
    otherwise in its own transaction). A snapshot that fails validation is kept on disk for
    diagnosis but is **not** recorded, and :class:`SnapshotValidationError` is raised.
    """
    spec = _spec(source)
    settings = settings or get_settings()
    client = client or ArchiveClient()
    queries = build_query(source, kepids)
    retrieved_at = utcnow()

    parts: list[bytes] = []
    header: bytes | None = None
    for i, adql in enumerate(queries):
        body = client.query_bytes(adql)
        if i == 0:
            parts.append(body)
            header = body.split(b"\n", 1)[0].rstrip(b"\r")
            continue
        first, _, rest = body.partition(b"\n")
        if first.rstrip(b"\r") != header:
            raise ArchiveQueryError(f"chunk {i + 1} of {source} returned a different CSV header")
        if parts and not parts[-1].endswith(b"\n"):
            parts.append(b"\n")
        parts.append(rest)
    data = b"".join(parts)

    path = _snapshot_path(settings, source, retrieved_at)
    atomic_write_bytes(path, data)
    digest = sha256_bytes(data)
    frame = parse_csv_bytes(data)
    validation = validate_snapshot(source, frame, live=True)
    validation["n_queries"] = len(queries)
    if not validation["ok"]:
        raise SnapshotValidationError(
            f"{source} snapshot failed validation: {'; '.join(validation['errors'])} (kept at {path})",
            validation,
        )
    if len(queries) == 1:
        query_text, url = queries[0], client.get_url(queries[0])
    else:
        query_text = ";\n".join(f"-- chunk {i + 1}/{len(queries)}\n{q}" for i, q in enumerate(queries))
        url = f"{client.tap_url} (HTTP POST, format=csv, {len(queries)} chunks)"
    result = SnapshotResult(
        source=source,
        table_name=spec.table_name,
        query=query_text,
        url=url,
        path=path,
        sha256=digest,
        row_count=int(len(frame)),
        retrieved_at=retrieved_at,
        validation=validation,
        frame=frame,
    )
    result.snapshot_id = _record_snapshot(result, session, settings)
    log.info("snapshot %s: %d rows, sha256 %s, %s", source, result.row_count, digest[:12], path)
    return result


def register_snapshot_file(
    source: str,
    path: str | Path,
    *,
    session: Session | None = None,
    settings: Settings | None = None,
    query: str | None = None,
    url: str | None = None,
    live: bool = False,
) -> SnapshotResult:
    """Validate an existing CSV file (offline import / tests) and record it as a snapshot.

    The file is used in place (not copied); its SHA-256 is recorded so later reads can verify it.
    """
    spec = _spec(source)
    settings = settings or get_settings()
    path = Path(path).resolve()
    data = path.read_bytes()
    frame = parse_csv_bytes(data)
    validation = validate_snapshot(source, frame, live=live)
    validation["offline_import"] = True
    if not validation["ok"]:
        raise SnapshotValidationError(
            f"{source} file {path} failed validation: {'; '.join(validation['errors'])}", validation
        )
    result = SnapshotResult(
        source=source,
        table_name=spec.table_name,
        query=query or f"-- offline import of {path.name}",
        url=url or path.as_uri(),
        path=path,
        sha256=sha256_bytes(data),
        row_count=int(len(frame)),
        retrieved_at=utcnow(),
        validation=validation,
        frame=frame,
    )
    result.snapshot_id = _record_snapshot(result, session, settings)
    return result


def latest_snapshot(session: Session, source: str) -> CatalogSnapshot | None:
    """Most recent recorded snapshot of ``source`` whose file still exists, or None."""
    settings = get_settings()
    rows = session.scalars(
        select(CatalogSnapshot)
        .where(CatalogSnapshot.source == source)
        .order_by(CatalogSnapshot.retrieved_at.desc(), CatalogSnapshot.id.desc())
    )
    for row in rows:
        if resolve_snapshot_path(row.file_path, settings).exists():
            return row
    return None


def load_snapshot_frame(snapshot: CatalogSnapshot, *, verify: bool = True) -> pd.DataFrame:
    """Read a recorded snapshot file, verifying its SHA-256 against the recorded digest."""
    path = resolve_snapshot_path(snapshot.file_path)
    data = path.read_bytes()  # read once: the bytes verified are exactly the bytes parsed
    if verify:
        digest = sha256_bytes(data)
        if digest != snapshot.sha256:
            raise ArchiveError(
                f"snapshot {snapshot.id} ({path}) has been modified: "
                f"sha256 {digest} != recorded {snapshot.sha256}"
            )
    return parse_csv_bytes(data)


def resolve_snapshot_path(stored: str, settings: Settings | None = None) -> Path:
    """Resolve a stored snapshot path (relative paths are relative to the data directory)."""
    p = Path(stored)
    if p.is_absolute():
        return p
    return (settings or get_settings()).data_path / p


def _stored_path(path: Path, settings: Settings) -> str:
    """Store paths inside the data directory relative to it, so the folder can be moved."""
    try:
        return path.resolve().relative_to(settings.data_path.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def _snapshot_path(settings: Settings, source: str, when: datetime) -> Path:
    settings.catalogs_dir.mkdir(parents=True, exist_ok=True)
    stamp = when.replace(tzinfo=UTC).strftime("%Y%m%dT%H%M%SZ")
    path = settings.catalogs_dir / f"{source}_{stamp}.csv"
    n = 1
    while path.exists():
        n += 1
        path = settings.catalogs_dir / f"{source}_{stamp}_{n}.csv"
    return path


def _record_snapshot(result: SnapshotResult, session: Session | None, settings: Settings) -> int:
    row = CatalogSnapshot(
        source=result.source,
        table_name=result.table_name,
        query=result.query,
        url=result.url,
        retrieved_at=result.retrieved_at,
        row_count=result.row_count,
        sha256=result.sha256,
        file_path=_stored_path(result.path, settings),
        validation=result.validation,
    )
    if session is not None:
        session.add(row)
        session.flush()
        return int(row.id)
    from exofinder.db.session import session_scope

    with session_scope() as s:
        s.add(row)
        s.flush()
        return int(row.id)
