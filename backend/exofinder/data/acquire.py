"""Light-curve acquisition: MAST download → stitched cache → ``Target.lc_*`` bookkeeping.

``acquire_lightcurve`` does the file work for one star and touches no database, so it is safe to
run in worker threads. ``ensure_lightcurve`` (single star, caller's session) and ``download_many``
(thread pool, database updates in the calling thread only — SQLAlchemy sessions are not
thread-safe) wrap it with database status updates.

Target ``lc_status`` life cycle: ``none`` → ``queued`` → ``downloading`` → ``available`` |
``no_data`` (MAST has no long-cadence file for the star) | ``error`` (network/format failure;
``lc_error`` has details). A cancelled download returns the target to ``none``.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from exofinder.astro.types import LightCurve
from exofinder.config import get_settings, kic9
from exofinder.data._util import is_cancelled
from exofinder.data.lightcurve_store import (
    build_from_fits,
    has_lightcurve,
    lightcurve_path,
    load_lightcurve,
    save_lightcurve,
)
from exofinder.data.mast import DownloadResult, download_kepler_lightcurves, remove_raw_files
from exofinder.db.models import Target, utcnow

log = logging.getLogger(__name__)

Downloader = Callable[..., DownloadResult]


class LightCurveUnavailableError(RuntimeError):
    """No light curve could be obtained for the star (``status`` says why)."""

    def __init__(self, kepid: int, status: str, message: str) -> None:
        super().__init__(f"KIC {kepid}: {message}")
        self.kepid = kepid
        self.status = status


class AcquisitionCancelled(RuntimeError):
    """The acquisition was cancelled before the light curve was complete."""


@dataclass
class AcquireOutcome:
    """Result of acquiring one star's light curve (no database involved)."""

    kepid: int
    status: str  # available | no_data | error | cancelled
    quarters: list[int] = field(default_factory=list)
    n_cadences: int | None = None
    path: str | None = None
    error: str | None = None
    from_cache: bool = False
    downloaded_files: int = 0
    missing_quarters: list[int] = field(default_factory=list)
    failed_quarters: list[int] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def raw_dir_for(kepid: int | str) -> Path:
    """Where raw FITS files of ``kepid`` are downloaded: ``<data>/raw/kepler/<kic9>/``."""
    return get_settings().raw_dir / kic9(kepid)


# Per-star locks: an API request (ensure_lightcurve) and a bulk download job (download_many) may
# ask for the same star at the same time. Without serialisation both download into the same raw
# directory and the first to finish deletes the FITS files the other is still stitching.
_STAR_LOCKS: dict[int, threading.Lock] = {}
_STAR_LOCKS_GUARD = threading.Lock()


@contextmanager
def _star_lock(kepid: int) -> Iterator[None]:
    with _STAR_LOCKS_GUARD:
        lock = _STAR_LOCKS.setdefault(kepid, threading.Lock())
    with lock:
        yield


def _partial_error(meta: dict[str, Any]) -> str | None:
    """Error text for a cache built from an incomplete download (recorded in its meta)."""
    errors = meta.get("acquisition_errors") or []
    if not errors and not meta.get("failed_quarters"):
        return None
    return ("partial download, failed quarters: " + "; ".join(str(e) for e in errors))[:2000]


def _outcome_from_cache(kepid: int, lc: LightCurve) -> AcquireOutcome:
    return AcquireOutcome(
        kepid=kepid,
        status="available",
        quarters=[int(q) for q in lc.meta.get("quarters", [])],
        n_cadences=len(lc),
        path=str(lightcurve_path(kepid)),
        error=_partial_error(lc.meta),
        from_cache=True,
        failed_quarters=[int(q) for q in lc.meta.get("failed_quarters", [])],
    )


def acquire_lightcurve(
    kepid: int,
    cancel: Any = None,
    *,
    force: bool = False,
    downloader: Downloader = download_kepler_lightcurves,
) -> AcquireOutcome:
    """Make sure the stitched cache for ``kepid`` exists (download + build if needed).

    Thread-safe: concurrent calls for the same ``kepid`` are serialised (the second one is then
    served from the cache the first built, unless ``force``). Raw FITS files are deleted after a
    successful cache build unless ``settings.keep_raw_fits`` is True. When some quarters failed
    (network errors) the cache is built from the others; the gap is recorded in the cache meta
    (``failed_quarters``, ``acquisition_errors``) and reported as ``error`` every time the cache
    is served, so it is never silently forgotten; ``force=True`` retries later.
    """
    kepid = int(kepid)
    with _star_lock(kepid):
        return _acquire_locked(kepid, cancel, force=force, downloader=downloader)


def _acquire_locked(kepid: int, cancel: Any, *, force: bool, downloader: Downloader) -> AcquireOutcome:
    settings = get_settings()
    if not force and has_lightcurve(kepid):
        lc = load_lightcurve(kepid)
        if lc is not None:
            return _outcome_from_cache(kepid, lc)
    if is_cancelled(cancel):
        return AcquireOutcome(kepid=kepid, status="cancelled")
    dest = raw_dir_for(kepid)
    try:
        result = downloader(kepid, dest, timeout=settings.http_timeout, cancel=cancel)
    except Exception as exc:  # noqa: BLE001 - one bad star must not abort a bulk job
        log.exception("KIC %s: download failed", kepid)
        return AcquireOutcome(kepid=kepid, status="error", error=f"{type(exc).__name__}: {exc}")
    outcome = AcquireOutcome(
        kepid=kepid,
        status="error",
        downloaded_files=result.downloaded,
        missing_quarters=list(result.missing_quarters),
        failed_quarters=list(result.failed_quarters),
    )
    if result.cancelled:
        outcome.status = "cancelled"
        return outcome  # completed files are kept so a later run resumes
    if not result.files:
        if result.errors:
            outcome.error = "; ".join(result.errors)[:2000]
        else:
            outcome.status = "no_data"
            outcome.error = "MAST has no Kepler long-cadence light curve for this star"
        return outcome
    try:
        lc = build_from_fits(kepid, [p for _, p in result.files])
        lc.meta["missing_quarters"] = sorted(int(q) for q in result.missing_quarters)
        if result.failed_quarters or result.errors:
            lc.meta["failed_quarters"] = sorted(int(q) for q in result.failed_quarters)
            lc.meta["acquisition_errors"] = list(result.errors)
        lc.meta["download_source"] = result.source
        path = save_lightcurve(kepid, lc)
    except Exception as exc:  # noqa: BLE001
        log.exception("KIC %s: building the light-curve cache failed", kepid)
        outcome.error = f"cache build failed: {type(exc).__name__}: {exc}"
        return outcome
    if not settings.keep_raw_fits:
        remove_raw_files([p for _, p in result.files])
    outcome.status = "available"
    outcome.quarters = [int(q) for q in lc.meta.get("quarters", [])]
    outcome.n_cadences = len(lc)
    outcome.path = str(path)
    outcome.error = _partial_error(lc.meta)
    return outcome


def _apply_outcome(target: Target, outcome: AcquireOutcome) -> None:
    now = utcnow()
    if outcome.status == "cancelled":
        if target.lc_status in ("queued", "downloading"):
            target.lc_status = "available" if has_lightcurve(target.kepid) else "none"
        target.lc_updated_at = now
        return
    target.lc_status = outcome.status
    target.lc_error = outcome.error
    target.lc_updated_at = now
    if outcome.status == "available":
        target.lc_quarters = list(outcome.quarters)
        target.lc_n_cadences = outcome.n_cadences
        target.lc_path = outcome.path
    elif outcome.status == "no_data":
        target.lc_quarters = []
        target.lc_n_cadences = 0
        target.lc_path = None


def _get_or_create_target(session: Session, kepid: int) -> Target:
    target = session.get(Target, kepid)
    if target is None:
        target = Target(kepid=kepid, lc_status="none", lc_quarters=[])
        session.add(target)
        session.flush()
    return target


def ensure_lightcurve(
    session: Session,
    kepid: int,
    cancel: Any = None,
    *,
    force: bool = False,
    downloader: Downloader = download_kepler_lightcurves,
) -> LightCurve:
    """Return the stitched light curve of ``kepid``, downloading and caching it if necessary.

    Updates (and commits, so other requests can see progress) the ``Target.lc_*`` fields.
    Raises :class:`AcquisitionCancelled` on cancellation and :class:`LightCurveUnavailableError`
    when no light curve could be obtained.
    """
    kepid = int(kepid)
    target = _get_or_create_target(session, kepid)
    if not force and has_lightcurve(kepid):
        lc = load_lightcurve(kepid)
        if lc is not None:
            if target.lc_status != "available" or not target.lc_path:
                _apply_outcome(target, _outcome_from_cache(kepid, lc))
                session.commit()
            return lc
    target.lc_status = "downloading"
    target.lc_updated_at = utcnow()
    session.commit()
    outcome = acquire_lightcurve(kepid, cancel, force=force, downloader=downloader)
    target = _get_or_create_target(session, kepid)
    _apply_outcome(target, outcome)
    session.commit()
    if outcome.status == "cancelled":
        raise AcquisitionCancelled(f"KIC {kepid}: light-curve download cancelled")
    if outcome.status != "available":
        raise LightCurveUnavailableError(kepid, outcome.status, outcome.error or outcome.status)
    lc = load_lightcurve(kepid)
    if lc is None:  # pragma: no cover - cache vanished between save and load
        raise LightCurveUnavailableError(kepid, "error", "cache file missing after build")
    return lc


def download_many(
    kepids: Iterable[int],
    workers: int | None = None,
    progress: Callable[[int, int, str], None] | None = None,
    cancel: Any = None,
    *,
    session: Session | None = None,
    force: bool = False,
    downloader: Downloader = download_kepler_lightcurves,
) -> dict[str, Any]:
    """Acquire light curves for many stars with a thread pool.

    Network and file work runs in ``workers`` threads (default ``settings.download_workers``);
    every database update happens in the calling thread, through ``session`` if given or a fresh
    :func:`~exofinder.db.session.session_scope` per update otherwise (committed immediately so
    status is visible to the API). ``progress(done, total, message)`` is called after each star.
    On cancellation, stars not yet started are skipped and returned to ``lc_status="none"``.
    """
    ids = list(dict.fromkeys(int(k) for k in kepids))
    total = len(ids)
    workers = max(1, int(workers or get_settings().download_workers))
    counts = {"available": 0, "no_data": 0, "error": 0, "cancelled": 0, "cached": 0}
    results: dict[int, dict[str, Any]] = {}

    def with_db(fn: Callable[[Session], None]) -> None:
        if session is not None:
            fn(session)
            session.commit()
            return
        from exofinder.db.session import session_scope

        with session_scope() as s:
            fn(s)

    to_fetch = [k for k in ids if force or not has_lightcurve(k)]

    def mark_queued(s: Session) -> None:
        for k in to_fetch:
            t = _get_or_create_target(s, k)
            t.lc_status = "queued"
            t.lc_updated_at = utcnow()

    if to_fetch:
        with_db(mark_queued)

    done = 0
    lock = threading.Lock()

    def work(kepid: int) -> AcquireOutcome:
        if is_cancelled(cancel):
            return AcquireOutcome(kepid=kepid, status="cancelled")
        return acquire_lightcurve(kepid, cancel, force=force, downloader=downloader)

    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="exof-dl") as pool:
        futures: dict[Future[AcquireOutcome], int] = {pool.submit(work, k): k for k in ids}
        for fut in as_completed(futures):
            kepid = futures[fut]
            try:
                outcome = fut.result()
            except Exception as exc:  # noqa: BLE001 - defensive; work() already catches
                outcome = AcquireOutcome(kepid=kepid, status="error", error=f"{type(exc).__name__}: {exc}")
            with lock:
                done += 1
                key = "cached" if outcome.from_cache else outcome.status
                counts[key] = counts.get(key, 0) + 1
                results[kepid] = outcome.to_dict()

            def update(s: Session, outcome: AcquireOutcome = outcome) -> None:
                _apply_outcome(_get_or_create_target(s, outcome.kepid), outcome)

            with_db(update)
            if progress is not None:
                progress(
                    done, total, f"KIC {kepid}: {outcome.status}{' (cached)' if outcome.from_cache else ''}"
                )
    return {
        "total": total,
        **counts,
        "cancelled_requested": is_cancelled(cancel),
        # input order, not thread completion order, so the result is reproducible
        "results": {k: results[k] for k in ids if k in results},
    }
