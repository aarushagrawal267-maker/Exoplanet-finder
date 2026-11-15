"""Kepler long-cadence light-curve downloads from the MAST archive.

Every Kepler long-cadence light-curve file is named ``kplr<kic9>-<stamp>_llc.fits`` where
``<stamp>`` (``YYYYDDDHHMMSS``) identifies the data-processing timestamp of one observing quarter
and is the same for every star observed in that quarter. The file therefore has a deterministic
URL on the MAST download service::

    https://mast.stsci.edu/api/v0.1/Download/file?uri=mast:KEPLER/url/missions/kepler/lightcurves/
        <kic4>/<kic9>/kplr<kic9>-<stamp>_llc.fits

(``kic4`` = first four digits of the 9-digit zero-padded KIC id). Requesting every quarter's URL
needs no catalogue search (≈5 s per star with ``lightkurve.search_lightcurve``); an HTTP 404 simply
means the star was not observed in that quarter (it fell on a failed CCD module, was not selected
as a target, etc.).

The quarter → stamp table :data:`KEPLER_LC_QUARTER_STAMPS` (Data Release 25 reprocessing) was
verified empirically on 2026-11-14 by comparing it with the product file names returned by
``lightkurve.search_lightcurve(..., mission="Kepler", author="Kepler", cadence="long")`` for
KIC 11442793 (Kepler-90), 10666592 (Kepler-2), 6541920 (Kepler-11), 8311864 (Kepler-452),
4852528 (Kepler-80), 8120608 (Kepler-186) and 757450: every listed file used exactly these
stamps. Quarter 4 has two stamps: stars on CCD module 3, which failed on 2010-01-09 during Q4,
have a shorter file stamped ``2010009091648`` (Kepler-90 is one of them) and all others use
``2010078095331``. The table matches the one in the AstroNet reference code (Shallue &
Vanderburg 2018, ``kepler_io.py``).

Each file is validated (FITS magic bytes, parses with astropy, has a LIGHTCURVE table with TIME
and PDCSAP_FLUX, header KEPLERID equals the requested star, QUARTER equals the expected quarter)
before being moved atomically into place. If no deterministic URL yields a file (for example
because MAST changed its URL scheme), the downloader falls back to a ``lightkurve`` search.
"""

from __future__ import annotations

import io
import logging
import re
import tempfile
import time
import warnings
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

from exofinder.config import get_settings, kic9
from exofinder.data._util import (
    RETRYABLE_EXCEPTIONS,
    RETRYABLE_STATUS,
    atomic_write_bytes,
    backoff_delay,
    is_cancelled,
    parse_retry_after,
)

log = logging.getLogger(__name__)

USER_AGENT = "ExoplanetFinder/1.0 (+python-requests; research use)"

#: Kepler long-cadence (``_llc``) file timestamps per quarter (verified against MAST, see module doc).
KEPLER_LC_QUARTER_STAMPS: dict[int, list[str]] = {
    0: ["2009131105131"],
    1: ["2009166043257"],
    2: ["2009259160929"],
    3: ["2009350155506"],
    4: ["2010078095331", "2010009091648"],
    5: ["2010174085026"],
    6: ["2010265121752"],
    7: ["2010355172524"],
    8: ["2011073133259"],
    9: ["2011177032512"],
    10: ["2011271113734"],
    11: ["2012004120508"],
    12: ["2012088054726"],
    13: ["2012179063303"],
    14: ["2012277125453"],
    15: ["2013011073258"],
    16: ["2013098041711"],
    17: ["2013131215648"],
}

#: Every valid FITS file starts with this 80-character card prefix.
FITS_MAGIC = b"SIMPLE  ="
#: FITS files consist of whole 2880-byte logical records (FITS Standard 4.0, section 3.1).
FITS_BLOCK = 2880
_LLC_NAME = re.compile(r"^kplr(\d{9})-(\d{13})_llc\.fits$")


class DownloadCancelled(RuntimeError):
    """Raised by callers that prefer an exception to ``DownloadResult.cancelled``."""


class InvalidLightCurveFile(ValueError):
    """Downloaded bytes are not a valid Kepler long-cadence light-curve file for the request."""


@dataclass
class DownloadResult:
    """Outcome of :func:`download_kepler_lightcurves` for one star."""

    kepid: int
    files: list[tuple[int, Path]] = field(default_factory=list)  # (quarter, path), quarter order
    missing_quarters: list[int] = field(default_factory=list)  # every URL for the quarter was 404
    errors: list[str] = field(default_factory=list)  # quarters that failed for other reasons
    failed_quarters: list[int] = field(default_factory=list)
    reused: int = 0  # valid files already on disk (not downloaded again)
    downloaded: int = 0
    source: str = "mast"  # mast | lightkurve | none
    cancelled: bool = False

    @property
    def quarters(self) -> list[int]:
        return sorted({q for q, _ in self.files})

    def to_dict(self) -> dict[str, Any]:
        return {
            "kepid": self.kepid,
            "files": [(q, str(p)) for q, p in self.files],
            "quarters": self.quarters,
            "missing_quarters": list(self.missing_quarters),
            "failed_quarters": list(self.failed_quarters),
            "errors": list(self.errors),
            "reused": self.reused,
            "downloaded": self.downloaded,
            "source": self.source,
            "cancelled": self.cancelled,
        }


# ------------------------------------------------------------------------------------------------
# URLs
# ------------------------------------------------------------------------------------------------
def kepler_lc_filename(kepid: int | str, stamp: str) -> str:
    return f"kplr{kic9(kepid)}-{stamp}_llc.fits"


def kepler_lc_uri(kepid: int | str, stamp: str) -> str:
    k = kic9(kepid)
    return f"mast:KEPLER/url/missions/kepler/lightcurves/{k[:4]}/{k}/{kepler_lc_filename(kepid, stamp)}"


def kepler_lc_urls(kepid: int | str, base_url: str | None = None) -> list[tuple[int, str, str]]:
    """Deterministic MAST URLs for every possible long-cadence quarter file of ``kepid``.

    Returns ``[(quarter, url, filename), ...]`` in quarter order (both Q4 variants included).
    """
    base = base_url or get_settings().mast_download_url
    out: list[tuple[int, str, str]] = []
    for quarter in sorted(KEPLER_LC_QUARTER_STAMPS):
        for stamp in KEPLER_LC_QUARTER_STAMPS[quarter]:
            out.append(
                (quarter, f"{base}?uri={kepler_lc_uri(kepid, stamp)}", kepler_lc_filename(kepid, stamp))
            )
    return out


# ------------------------------------------------------------------------------------------------
# Validation
# ------------------------------------------------------------------------------------------------
def validate_lightcurve_bytes(data: bytes, kepid: int, quarter: int | None = None) -> dict[str, Any]:
    """Check that ``data`` is a Kepler light-curve FITS file of ``kepid`` (and ``quarter``).

    Returns a few header values; raises :class:`InvalidLightCurveFile` otherwise. Truncated
    downloads are caught anywhere in the file, including the trailing APERTURE image that follows
    the light-curve table: the size must be a whole number of 2880-byte FITS blocks, every HDU
    header is parsed, and the last HDU's data must end within the bytes received. (The files'
    CHECKSUM keywords cannot be used: they fail astropy verification even for pristine MAST files.)
    """
    if not data.startswith(FITS_MAGIC):
        raise InvalidLightCurveFile("not a FITS file (bad magic bytes)")
    if len(data) % FITS_BLOCK:
        raise InvalidLightCurveFile(
            f"truncated download: {len(data)} bytes is not a whole number of {FITS_BLOCK}-byte FITS blocks"
        )
    from astropy.io import fits

    try:
        with (
            warnings.catch_warnings(record=True) as caught,
            fits.open(io.BytesIO(data), memmap=False) as hdul,
        ):
            warnings.simplefilter("always")
            header = hdul[0].header
            n_hdus = len(hdul)  # parses every HDU header, not just up to LIGHTCURVE
            last = hdul.fileinfo(n_hdus - 1)
            end = int(last["datLoc"]) + int(last["datSpan"])
            if end > len(data):
                raise InvalidLightCurveFile(
                    f"truncated download: HDU {n_hdus - 1} ends at byte {end} but only {len(data)} received"
                )
            if "LIGHTCURVE" not in hdul:
                raise InvalidLightCurveFile("FITS file has no LIGHTCURVE extension")
            if "APERTURE" not in hdul:
                # Every Kepler llc product is PRIMARY + LIGHTCURVE + APERTURE (Kepler Archive Manual
                # sec. 2.3); a missing last HDU means the file was cut at an HDU boundary.
                raise InvalidLightCurveFile("truncated download: FITS file has no APERTURE extension")
            table = hdul["LIGHTCURVE"]
            names = set(table.columns.names)
            for col in ("TIME", "PDCSAP_FLUX", "SAP_QUALITY"):
                if col not in names:
                    raise InvalidLightCurveFile(f"LIGHTCURVE table lacks column {col}")
            n_rows = len(table.data)  # forces the table to be read
            file_kepid = int(header.get("KEPLERID", -1))
            file_quarter = header.get("QUARTER")
            truncated = [w for w in caught if "truncated" in str(w.message).lower()]
            if truncated:
                raise InvalidLightCurveFile(f"truncated download: {truncated[0].message}")
    except InvalidLightCurveFile:
        raise
    except Exception as exc:  # astropy raises many types for corrupt input
        raise InvalidLightCurveFile(f"FITS file could not be parsed: {exc}") from exc
    if file_kepid != int(kepid):
        raise InvalidLightCurveFile(f"file is for KIC {file_kepid}, expected {int(kepid)}")
    if quarter is not None and file_quarter is not None and int(file_quarter) != int(quarter):
        raise InvalidLightCurveFile(f"file is quarter {file_quarter}, expected {quarter}")
    return {
        "kepid": file_kepid,
        "quarter": None if file_quarter is None else int(file_quarter),
        "n_rows": n_rows,
    }


def _valid_existing(path: Path, kepid: int, quarter: int) -> bool:
    try:
        validate_lightcurve_bytes(path.read_bytes(), kepid, quarter)
        return True
    except (OSError, InvalidLightCurveFile):
        return False


# ------------------------------------------------------------------------------------------------
# Download
# ------------------------------------------------------------------------------------------------
class _NotFound(Exception):
    pass


def _get_with_retries(
    http: requests.Session,
    url: str,
    timeout: float,
    max_retries: int,
    backoff_s: float,
    sleep: Callable[[float], None],
    cancel: Any,
) -> bytes:
    """GET ``url``; 404 → :class:`_NotFound`; transient errors retried; others raise RuntimeError."""
    last = ""
    for attempt in range(max_retries + 1):
        retry_after: float | None = None
        try:
            resp = http.get(url, timeout=timeout, headers={"User-Agent": USER_AGENT})
        except RETRYABLE_EXCEPTIONS as exc:
            last = f"{type(exc).__name__}: {exc}"
        except requests.RequestException as exc:  # e.g. invalid URL, too many redirects
            raise RuntimeError(f"{type(exc).__name__}: {exc}") from exc
        else:
            if resp.status_code == 404:
                raise _NotFound(url)
            if resp.status_code == 200:
                return resp.content
            if resp.status_code not in RETRYABLE_STATUS:
                raise RuntimeError(f"HTTP {resp.status_code}")
            last = f"HTTP {resp.status_code}"
            retry_after = parse_retry_after(resp.headers.get("Retry-After"))
        if attempt < max_retries:
            if is_cancelled(cancel):
                raise RuntimeError("cancelled")
            sleep(max(retry_after or 0.0, backoff_delay(attempt, backoff_s)))
    raise RuntimeError(f"failed after {max_retries + 1} attempts: {last}")


def download_kepler_lightcurves(
    kepid: int,
    dest_dir: str | Path,
    timeout: float | None = None,
    cancel: Any = None,
    *,
    http: requests.Session | None = None,
    base_url: str | None = None,
    max_retries: int = 3,
    backoff_s: float = 1.0,
    use_fallback: bool = True,
    fallback: Callable[[int, Path, float, Any], DownloadResult] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> DownloadResult:
    """Download every available long-cadence quarter of ``kepid`` into ``dest_dir``.

    Files already present in ``dest_dir`` and valid are reused (resumable downloads). Each new file
    is validated (see :func:`validate_lightcurve_bytes`) and written atomically; a corrupt or
    truncated download is retried like a transient network error. ``cancel`` (Event or callable) is
    checked between files; on cancellation the files completed so far are kept and
    ``result.cancelled`` is True.
    """
    kepid = int(kepid)
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    timeout = float(timeout if timeout is not None else get_settings().http_timeout)
    result = DownloadResult(kepid=kepid)
    own_http = http is None
    http = http or requests.Session()
    found_quarters: set[int] = set()
    not_found: dict[int, int] = {}
    failed: dict[int, str] = {}
    try:
        urls = kepler_lc_urls(kepid, base_url)
        n_per_quarter = {q: len(KEPLER_LC_QUARTER_STAMPS[q]) for q in KEPLER_LC_QUARTER_STAMPS}
        for quarter, url, filename in urls:
            if is_cancelled(cancel):
                result.cancelled = True
                break
            path = dest / filename
            if path.exists() and _valid_existing(path, kepid, quarter):
                result.files.append((quarter, path))
                result.reused += 1
                found_quarters.add(quarter)
                continue
            data: bytes | None = None
            error = ""
            for attempt in range(max_retries + 1):
                try:
                    raw = _get_with_retries(http, url, timeout, max_retries, backoff_s, sleep, cancel)
                    validate_lightcurve_bytes(raw, kepid, quarter)
                    data = raw
                    break
                except _NotFound:
                    not_found[quarter] = not_found.get(quarter, 0) + 1
                    break
                except InvalidLightCurveFile as exc:
                    # A truncated/corrupted transfer: download again (bounded).
                    error = f"Q{quarter} {filename}: invalid file ({exc})"
                    if attempt >= max_retries or is_cancelled(cancel):
                        break
                    sleep(backoff_delay(attempt, backoff_s))
                except RuntimeError as exc:
                    error = f"Q{quarter} {filename}: {exc}"
                    break
            if data is not None:
                atomic_write_bytes(path, data)
                result.files.append((quarter, path))
                result.downloaded += 1
                found_quarters.add(quarter)
            elif error:
                failed[quarter] = error
        if not result.cancelled:
            result.missing_quarters = sorted(
                q for q, n in not_found.items() if n == n_per_quarter[q] and q not in found_quarters
            )
        result.failed_quarters = sorted(q for q in failed if q not in found_quarters)
        result.errors = [failed[q] for q in result.failed_quarters]
    finally:
        if own_http:
            http.close()

    result.files.sort(key=lambda qp: (qp[0], qp[1].name))
    result.source = "mast" if result.files else "none"
    if not result.files and not result.cancelled and use_fallback:
        log.warning("KIC %s: no deterministic MAST URL succeeded; falling back to lightkurve search", kepid)
        fb = fallback or _lightkurve_fallback
        try:
            fb_result = fb(kepid, dest, timeout, cancel)
        except Exception as exc:  # noqa: BLE001 - report, never crash a bulk download
            result.errors.append(f"lightkurve fallback failed: {type(exc).__name__}: {exc}")
        else:
            fb_result.errors = result.errors + fb_result.errors
            return fb_result
    return result


def _lightkurve_fallback(kepid: int, dest: Path, timeout: float, cancel: Any) -> DownloadResult:
    """Search MAST with lightkurve and download the long-cadence files it lists (slow path)."""
    import lightkurve as lk  # imported lazily: slow import, only needed here

    result = DownloadResult(kepid=kepid, source="lightkurve")
    search = lk.search_lightcurve(f"KIC {kepid}", mission="Kepler", author="Kepler", cadence="long")
    if len(search) == 0:
        return result
    # ignore_cleanup_errors: on Windows a file still held open (lightkurve's returned object,
    # antivirus) must not turn a successful download into an exception at cleanup time.
    with tempfile.TemporaryDirectory(prefix="exof_lk_", ignore_cleanup_errors=True) as tmp:
        for i in range(len(search)):
            if is_cancelled(cancel):
                result.cancelled = True
                break
            row = search[i]
            filename = str(row.table["productFilename"][0])
            m = _LLC_NAME.match(filename)
            if not m:
                continue
            row.download(download_dir=tmp, quality_bitmask="none")
            matches = list(Path(tmp).rglob(filename))
            if not matches:
                result.errors.append(f"lightkurve did not produce {filename}")
                continue
            data = matches[0].read_bytes()
            try:
                info = validate_lightcurve_bytes(data, kepid)
            except InvalidLightCurveFile as exc:
                result.errors.append(f"{filename}: invalid file ({exc})")
                continue
            path = atomic_write_bytes(dest / filename, data)
            result.files.append((int(info["quarter"] if info["quarter"] is not None else -1), path))
            result.downloaded += 1
    result.files.sort(key=lambda qp: (qp[0], qp[1].name))
    return result


def remove_raw_files(paths: list[Path]) -> None:
    """Delete raw FITS files (and their directory when it becomes empty)."""
    dirs = set()
    for p in paths:
        try:
            Path(p).unlink(missing_ok=True)
            dirs.add(Path(p).parent)
        except OSError as exc:  # pragma: no cover - permissions etc.
            log.warning("could not delete %s: %s", p, exc)
    for d in dirs:
        try:
            if d.exists() and not any(d.iterdir()):
                d.rmdir()
        except OSError:  # pragma: no cover
            pass


__all__ = [
    "KEPLER_LC_QUARTER_STAMPS",
    "DownloadCancelled",
    "DownloadResult",
    "InvalidLightCurveFile",
    "download_kepler_lightcurves",
    "kepler_lc_filename",
    "kepler_lc_uri",
    "kepler_lc_urls",
    "remove_raw_files",
    "validate_lightcurve_bytes",
]
