"""Persistent background job runner.

Long-running work (catalogue refresh, downloads, dataset builds, training, evaluation, batch
prediction) runs as *jobs*. Each job is a row in the ``jobs`` table (so history survives restarts)
plus an in-memory execution context that provides progress reporting, logging, custom events
(e.g. per-epoch training metrics) and cooperative cancellation.

Two worker pools are used so that quick network jobs are not stuck behind a long training run:

* ``light`` (2 workers): catalog_refresh, download
* ``heavy`` (1 worker):  build_dataset, train, train_suite, evaluate, batch_predict

Events are fanned out to Server-Sent-Event subscribers through :class:`EventBus`, which is safe to
publish to from worker threads.

Usage::

    from exofinder.jobs.runner import get_runner

    def work(ctx: JobContext) -> dict:
        for i in range(10):
            ctx.check_cancelled()
            ctx.progress((i + 1) / 10, f"step {i + 1}/10")
        return {"answer": 42}

    job_id = get_runner().submit("download", "Download KIC 11442793", work, params={"kepid": 11442793})
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import threading
import time
import traceback
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from exofinder.db.models import Job, utcnow
from exofinder.db.session import session_scope

log = logging.getLogger("exofinder.jobs")

HEAVY_KINDS = {"build_dataset", "train", "train_suite", "evaluate", "batch_predict"}
MAX_LOG_LINES = 2000


class JobCancelled(Exception):
    """Raised inside a job function when the user cancels the job."""


# --------------------------------------------------------------------------------------------------
# Event bus (thread-safe publish → asyncio subscribers)
# --------------------------------------------------------------------------------------------------
@dataclass
class _Subscriber:
    queue: asyncio.Queue
    loop: asyncio.AbstractEventLoop
    job_id: str | None  # None = all jobs


class EventBus:
    def __init__(self) -> None:
        self._subs: list[_Subscriber] = []
        self._lock = threading.Lock()

    def subscribe(self, job_id: str | None = None, maxsize: int = 1000) -> _Subscriber:
        sub = _Subscriber(asyncio.Queue(maxsize=maxsize), asyncio.get_running_loop(), job_id)
        with self._lock:
            self._subs.append(sub)
        return sub

    def unsubscribe(self, sub: _Subscriber) -> None:
        with self._lock:
            if sub in self._subs:
                self._subs.remove(sub)

    def publish(self, job_id: str, event: str, data: dict[str, Any]) -> None:
        payload = {"job_id": job_id, "event": event, "data": data}
        with self._lock:
            subs = list(self._subs)
        for sub in subs:
            if sub.job_id is not None and sub.job_id != job_id:
                continue

            def _put(s: _Subscriber = sub) -> None:
                try:
                    s.queue.put_nowait(payload)
                except asyncio.QueueFull:  # slow consumer: drop oldest
                    try:
                        s.queue.get_nowait()
                        s.queue.put_nowait(payload)
                    except Exception:  # pragma: no cover
                        pass

            try:
                sub.loop.call_soon_threadsafe(_put)
            except RuntimeError:  # loop closed
                self.unsubscribe(sub)


# --------------------------------------------------------------------------------------------------
# Job context
# --------------------------------------------------------------------------------------------------
@dataclass
class JobContext:
    job_id: str
    kind: str
    params: dict[str, Any]
    bus: EventBus
    cancel_event: threading.Event = field(default_factory=threading.Event)
    _log_lines: list[str] = field(default_factory=list)
    _last_flush: float = 0.0
    _progress: float = 0.0
    _message: str = ""
    _started: float = field(default_factory=time.monotonic)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    # ---- reporting -----------------------------------------------------------------------------
    def progress(self, fraction: float, message: str | None = None) -> None:
        """Report progress in [0, 1] with an optional status message."""
        self._progress = float(min(max(fraction, 0.0), 1.0))
        if message is not None:
            self._message = message
        eta = self.eta_seconds()
        self.bus.publish(
            self.job_id,
            "progress",
            {"progress": self._progress, "message": self._message, "status": "running", "eta_s": eta},
        )
        self._maybe_flush()

    def log(self, line: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        text = f"[{stamp}] {line}"
        with self._lock:
            self._log_lines.append(text)
            if len(self._log_lines) > MAX_LOG_LINES:
                del self._log_lines[: len(self._log_lines) - MAX_LOG_LINES]
        log.info("job %s: %s", self.job_id[:8], line)
        self.bus.publish(self.job_id, "log", {"line": text})
        self._maybe_flush()

    def event(self, name: str, data: dict[str, Any]) -> None:
        """Publish a custom event (e.g. ``epoch`` with training metrics)."""
        self.bus.publish(self.job_id, name, data)

    # ---- cancellation --------------------------------------------------------------------------
    def cancelled(self) -> bool:
        return self.cancel_event.is_set()

    def check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise JobCancelled()

    # ---- helpers -------------------------------------------------------------------------------
    def eta_seconds(self) -> float | None:
        elapsed = time.monotonic() - self._started
        if self._progress <= 0.02 or elapsed < 3:
            return None
        return max(0.0, elapsed * (1.0 - self._progress) / self._progress)

    def log_text(self) -> str:
        with self._lock:
            return "\n".join(self._log_lines)

    def _maybe_flush(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_flush < 1.0:
            return
        self._last_flush = now
        try:
            with session_scope() as s:
                job = s.get(Job, self.job_id)
                if job is not None:
                    job.progress = self._progress
                    job.message = self._message
                    job.log = self.log_text()
        except Exception:  # pragma: no cover - never let progress reporting kill a job
            log.exception("failed to flush job progress")


JobFn = Callable[[JobContext], dict[str, Any] | None]


# --------------------------------------------------------------------------------------------------
# Liveness heartbeat
# --------------------------------------------------------------------------------------------------
#: How often an owning process refreshes ``Job.heartbeat_at`` for its queued/running jobs.
HEARTBEAT_SECONDS = 15.0
#: A queued/running job whose heartbeat is older than this is considered orphaned (owner died).
STALE_AFTER_SECONDS = 90.0

_hb_lock = threading.Lock()
_hb_jobs: set[str] = set()
_hb_thread: threading.Thread | None = None
_hb_stop = threading.Event()


def process_owner(role: str) -> str:
    """Identifier of this process stored on job rows (informational)."""
    return f"{role}:{socket.gethostname()}:{os.getpid()}"[:128]


def _write_heartbeats(job_ids: list[str], owner: str | None = None) -> None:
    if not job_ids:
        return
    try:
        with session_scope() as s:
            now = utcnow()
            for job in s.query(Job).filter(Job.id.in_(job_ids)).all():
                job.heartbeat_at = now
                if owner is not None:
                    job.owner = owner
    except Exception:  # pragma: no cover - liveness bookkeeping must never break a job
        log.exception("failed to write job heartbeats")


def _heartbeat_loop() -> None:
    while not _hb_stop.wait(HEARTBEAT_SECONDS):
        with _hb_lock:
            ids = list(_hb_jobs)
        _write_heartbeats(ids)


def heartbeat_register(job_id: str, role: str = "api") -> None:
    """Start refreshing the heartbeat of ``job_id`` from this process (until unregistered)."""
    global _hb_thread
    with _hb_lock:
        _hb_jobs.add(job_id)
        if _hb_thread is None or not _hb_thread.is_alive():
            _hb_stop.clear()
            _hb_thread = threading.Thread(target=_heartbeat_loop, name="job-heartbeat", daemon=True)
            _hb_thread.start()
    _write_heartbeats([job_id], owner=process_owner(role))


def heartbeat_unregister(job_id: str) -> None:
    with _hb_lock:
        _hb_jobs.discard(job_id)


# --------------------------------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------------------------------
class JobRunner:
    def __init__(self, light_workers: int = 2, heavy_workers: int = 1) -> None:
        self.bus = EventBus()
        self._light = ThreadPoolExecutor(max_workers=light_workers, thread_name_prefix="job-light")
        self._heavy = ThreadPoolExecutor(max_workers=heavy_workers, thread_name_prefix="job-heavy")
        self._contexts: dict[str, JobContext] = {}
        self._lock = threading.Lock()

    # ---- public API ----------------------------------------------------------------------------
    def submit(self, kind: str, title: str, fn: JobFn, params: dict[str, Any] | None = None) -> str:
        """Create a job row and schedule ``fn(ctx)``. Returns the job id."""
        job_id = uuid.uuid4().hex
        params = params or {}
        with session_scope() as s:
            # heartbeat from the start: another process must never see a fresh row as orphaned
            s.add(
                Job(
                    id=job_id,
                    kind=kind,
                    title=title,
                    status="queued",
                    params=params,
                    progress=0.0,
                    heartbeat_at=utcnow(),
                    owner=process_owner("api"),
                )
            )
        ctx = JobContext(job_id=job_id, kind=kind, params=params, bus=self.bus)
        with self._lock:
            self._contexts[job_id] = ctx
        heartbeat_register(job_id, "api")
        pool = self._heavy if kind in HEAVY_KINDS else self._light
        pool.submit(self._run, ctx, fn, title)
        self.bus.publish(job_id, "progress", {"progress": 0.0, "message": "Queued", "status": "queued"})
        return job_id

    def cancel(self, job_id: str) -> bool:
        """Request cancellation. Returns False if the job is not active in this process."""
        with self._lock:
            ctx = self._contexts.get(job_id)
        if ctx is None:
            return False
        ctx.cancel_event.set()
        ctx.log("Cancellation requested")
        return True

    def context(self, job_id: str) -> JobContext | None:
        with self._lock:
            return self._contexts.get(job_id)

    def is_active(self, job_id: str) -> bool:
        return self.context(job_id) is not None

    def shutdown(self, wait: bool = False) -> None:
        with self._lock:
            for ctx in self._contexts.values():
                ctx.cancel_event.set()
        self._light.shutdown(wait=wait, cancel_futures=True)
        self._heavy.shutdown(wait=wait, cancel_futures=True)

    # ---- internals -----------------------------------------------------------------------------
    def _set_status(self, job_id: str, **fields: Any) -> None:
        with session_scope() as s:
            job = s.get(Job, job_id)
            if job is None:
                return
            for k, v in fields.items():
                setattr(job, k, v)

    def _run(self, ctx: JobContext, fn: JobFn, title: str) -> None:
        if ctx.cancelled():
            self._finish(ctx, "cancelled", None, "Cancelled before start")
            return
        ctx._started = time.monotonic()
        self._set_status(ctx.job_id, status="running", started_at=utcnow(), message="Started")
        self.bus.publish(ctx.job_id, "progress", {"progress": 0.0, "message": "Started", "status": "running"})
        ctx.log(f"Started: {title}")
        try:
            result = fn(ctx) or {}
            ctx.progress(1.0, "Completed")
            self._finish(ctx, "succeeded", result, None)
        except JobCancelled:
            self._finish(ctx, "cancelled", None, "Cancelled by user")
        except Exception as exc:  # noqa: BLE001 - surface every failure to the user
            ctx.log(f"ERROR: {exc}")
            ctx.log(traceback.format_exc())
            self._finish(ctx, "failed", None, f"{type(exc).__name__}: {exc}")

    def _finish(self, ctx: JobContext, status: str, result: dict | None, error: str | None) -> None:
        ctx.log(f"Finished with status: {status}" + (f" ({error})" if error else ""))
        message = {"succeeded": "Completed", "cancelled": "Cancelled", "failed": "Failed"}[status]
        self._set_status(
            ctx.job_id,
            status=status,
            result=_jsonable(result) if result is not None else None,
            error=error if status != "succeeded" else None,
            finished_at=utcnow(),
            message=message,
            progress=1.0 if status == "succeeded" else ctx._progress,
            log=ctx.log_text(),
        )
        self.bus.publish(
            ctx.job_id,
            "done",
            {"status": status, "result": _jsonable(result), "error": error, "message": message},
        )
        heartbeat_unregister(ctx.job_id)
        with self._lock:
            self._contexts.pop(ctx.job_id, None)


def _jsonable(obj: Any) -> Any:
    """Convert numpy scalars/arrays and other simple types to JSON-serialisable values."""
    try:
        import numpy as np
    except ImportError:  # pragma: no cover
        np = None  # type: ignore
    if obj is None or isinstance(obj, (str, bool, int)):
        return obj
    if isinstance(obj, float):
        return obj if obj == obj and obj not in (float("inf"), float("-inf")) else None
    if np is not None:
        if isinstance(obj, np.generic):
            return _jsonable(obj.item())
        if isinstance(obj, np.ndarray):
            return [_jsonable(x) for x in obj.tolist()]
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, datetime):
        return obj.isoformat()
    return str(obj)


def mark_interrupted_jobs(stale_after: float = STALE_AFTER_SECONDS) -> int:
    """Mark queued/running jobs whose owning process has died as failed.

    Called at server start-up and again whenever jobs, datasets or experiments are listed (so a
    command-line job whose terminal was closed does not stay "running" until the next restart).
    A job is orphaned when its heartbeat is missing or older than ``stale_after`` seconds. Jobs owned
    by another live process (e.g. a dataset build started from the command line) keep refreshing
    their heartbeat and are left alone, and jobs owned by this process are never touched.
    """
    n = 0
    cutoff = utcnow() - timedelta(seconds=stale_after)
    with _hb_lock:
        own = set(_hb_jobs)
    with session_scope() as s:
        for job in s.query(Job).filter(Job.status.in_(["queued", "running"])).all():
            if job.id in own or (job.heartbeat_at is not None and job.heartbeat_at >= cutoff):
                continue
            job.status = "failed"
            job.error = (
                "Interrupted: the process running this job (server or command line) stopped before it "
                "finished. Start it again."
            )
            job.finished_at = utcnow()
            job.message = "Interrupted"
            n += 1
    return n


_runner: JobRunner | None = None
_runner_lock = threading.Lock()


def get_runner() -> JobRunner:
    global _runner
    with _runner_lock:
        if _runner is None:
            _runner = JobRunner()
        return _runner


def reset_runner_for_tests() -> None:
    global _runner
    with _hb_lock:
        _hb_jobs.clear()
    with _runner_lock:
        if _runner is not None:
            _runner.shutdown(wait=False)
        _runner = None
