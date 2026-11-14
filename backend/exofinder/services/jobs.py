"""Job helpers shared by the operations services, the API and the CLI.

A service that starts long-running work returns a :class:`JobSpec` (kind, title, the function to run
and its parameters). The API hands it to the background :class:`~exofinder.jobs.runner.JobRunner`
with :func:`launch`; the CLI runs the very same function synchronously with :func:`run_inline`, which
records a ``jobs`` row exactly like the runner does, prints progress, and turns Ctrl+C into a
cooperative cancellation. Both paths therefore produce identical database rows and artefacts.
"""

from __future__ import annotations

import signal
import threading
import time
import traceback
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from exofinder.db.models import Job, utcnow
from exofinder.db.session import session_scope
from exofinder.jobs.runner import EventBus, JobCancelled, JobContext, get_runner
from exofinder.services.jsonutil import to_jsonable
from exofinder.services.ops_errors import conflict, not_found

JOB_STATUSES = ("queued", "running", "succeeded", "failed", "cancelled")
ACTIVE_STATUSES = ("queued", "running")


@dataclass
class JobSpec:
    """Everything needed to run one job, in the background or inline."""

    kind: str
    title: str
    fn: Callable[[JobContext], dict[str, Any] | None]
    params: dict[str, Any] = field(default_factory=dict)
    #: Called with the new job id once the ``jobs`` row exists (e.g. to link it to a dataset row).
    on_created: Callable[[str], None] | None = None


def launch(spec: JobSpec) -> str:
    """Submit ``spec`` to the background job runner; returns the job id."""
    job_id = get_runner().submit(spec.kind, spec.title, spec.fn, to_jsonable(spec.params))
    if spec.on_created is not None:
        spec.on_created(job_id)
    return job_id


# --------------------------------------------------------------------------------------------------
# Progress helper
# --------------------------------------------------------------------------------------------------
class ProgressRange:
    """Map the progress of one phase (0-1) onto the slice ``[lo, hi]`` of a job's progress bar."""

    def __init__(self, ctx: JobContext, lo: float, hi: float) -> None:
        self.ctx, self.lo, self.hi = ctx, float(lo), float(hi)

    def __call__(self, fraction: float, message: str | None = None) -> None:
        f = min(max(float(fraction), 0.0), 1.0)
        self.ctx.progress(self.lo + (self.hi - self.lo) * f, message)

    def sub(self, lo: float, hi: float) -> ProgressRange:
        """A nested range (fractions of this range)."""
        span = self.hi - self.lo
        return ProgressRange(self.ctx, self.lo + span * lo, self.lo + span * hi)


# --------------------------------------------------------------------------------------------------
# Inline (synchronous) execution for the CLI
# --------------------------------------------------------------------------------------------------
Echo = Callable[[str], None]


@dataclass
class InlineJobContext(JobContext):
    """A :class:`JobContext` that also echoes progress and log lines (CLI)."""

    echo: Echo | None = None
    _last_echo: float = 0.0
    _last_echo_msg: str = ""

    def progress(self, fraction: float, message: str | None = None) -> None:
        super().progress(fraction, message)
        if self.echo is None:
            return
        now = time.monotonic()
        msg = self._message
        if msg != self._last_echo_msg or now - self._last_echo > 5.0:
            self._last_echo, self._last_echo_msg = now, msg
            self.echo(f"  [{self._progress * 100:5.1f}%] {msg}")

    def log(self, line: str) -> None:
        super().log(line)
        if self.echo is not None:
            self.echo(f"  {line}")


@dataclass
class InlineResult:
    job_id: str
    status: str
    result: dict[str, Any] | None
    error: str | None


def run_inline(spec: JobSpec, echo: Echo | None = print, handle_sigint: bool = True) -> InlineResult:
    """Run ``spec`` synchronously in this thread, recording a ``jobs`` row like the runner does.

    Ctrl+C (SIGINT) requests a cooperative cancellation (a second Ctrl+C aborts immediately).
    """
    job_id = uuid.uuid4().hex
    params = to_jsonable(spec.params)
    with session_scope() as s:
        s.add(Job(id=job_id, kind=spec.kind, title=spec.title, status="queued", params=params, progress=0.0))
    if spec.on_created is not None:
        spec.on_created(job_id)
    ctx = InlineJobContext(job_id=job_id, kind=spec.kind, params=params, bus=EventBus(), echo=echo)

    previous_handler = None
    if handle_sigint and threading.current_thread() is threading.main_thread():

        def _on_sigint(signum: int, frame: Any) -> None:
            if ctx.cancel_event.is_set():
                raise KeyboardInterrupt
            ctx.cancel_event.set()
            if echo is not None:
                echo("  Cancellation requested - finishing the current step (Ctrl+C again to abort)...")

        previous_handler = signal.signal(signal.SIGINT, _on_sigint)

    _set_job(job_id, status="running", started_at=utcnow(), message="Started")
    ctx.log(f"Started: {spec.title}")
    status, result, error = "failed", None, None
    try:
        result = spec.fn(ctx) or {}
        ctx.progress(1.0, "Completed")
        status = "succeeded"
    except JobCancelled:
        status, error = "cancelled", "Cancelled by user"
    except KeyboardInterrupt:
        status, error = "cancelled", "Aborted by user (Ctrl+C)"
    except Exception as exc:  # noqa: BLE001 - every failure is recorded on the job row
        error = f"{type(exc).__name__}: {exc}"
        ctx.log(f"ERROR: {exc}")
        ctx._log_lines.append(traceback.format_exc())
    finally:
        if previous_handler is not None:
            signal.signal(signal.SIGINT, previous_handler)
    ctx.log(f"Finished with status: {status}" + (f" ({error})" if error else ""))
    _set_job(
        job_id,
        status=status,
        result=to_jsonable(result) if status == "succeeded" else None,
        error=error,
        finished_at=utcnow(),
        message={"succeeded": "Completed", "cancelled": "Cancelled", "failed": "Failed"}[status],
        progress=1.0 if status == "succeeded" else ctx._progress,
        log=ctx.log_text(),
    )
    return InlineResult(job_id=job_id, status=status, result=result, error=error)


def _set_job(job_id: str, **fields: Any) -> None:
    with session_scope() as s:
        job = s.get(Job, job_id)
        if job is not None:
            for k, v in fields.items():
                setattr(job, k, v)


# --------------------------------------------------------------------------------------------------
# Queries used by the jobs router
# --------------------------------------------------------------------------------------------------
def list_jobs(
    session: Session, status: str | None = None, kind: str | None = None, limit: int = 50
) -> list[Job]:
    """Most recent jobs first; ``status``/``kind`` accept comma-separated lists."""
    q = select(Job).order_by(Job.created_at.desc()).limit(max(1, min(int(limit), 500)))
    if status:
        q = q.where(Job.status.in_([s.strip() for s in status.split(",") if s.strip()]))
    if kind:
        q = q.where(Job.kind.in_([k.strip() for k in kind.split(",") if k.strip()]))
    return list(session.scalars(q))


def get_job(session: Session, job_id: str) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise not_found("Job", "job_not_found", "List jobs with GET /api/jobs.")
    return job


def cancel_job(session: Session, job_id: str) -> Job:
    """Request cooperative cancellation of a queued/running job (409 if it already finished)."""
    job = get_job(session, job_id)
    if job.status not in ACTIVE_STATUSES:
        raise conflict(
            f"Job is already {job.status}", "job_not_active", "Only queued or running jobs can be cancelled."
        )
    if not get_runner().cancel(job_id):
        # The row says active but this process does not run it (e.g. run by the CLI in another process).
        raise conflict(
            "This job is not running in the API server process",
            "job_not_in_this_process",
            "Jobs started from the command line are cancelled with Ctrl+C in that terminal.",
        )
    session.refresh(job)
    return job


def reconcile_orphans(session: Session) -> int:
    """Fix datasets/experiments whose job ended without updating them (e.g. the server stopped).

    At start-up the runner marks unfinished jobs as failed (``mark_interrupted_jobs``); the dataset
    still says ``building`` and the experiment ``queued``/``running``. Any such row whose job is no
    longer queued/running is marked ``failed`` (or ``cancelled``) with the job's error. Rows whose job
    is still active (here or in a CLI process) are left alone. Returns the number of rows fixed.
    """
    from exofinder.db.models import Dataset, Experiment

    fixed = 0
    rows: list[Any] = list(session.scalars(select(Dataset).where(Dataset.status == "building")))
    rows += list(session.scalars(select(Experiment).where(Experiment.status.in_(ACTIVE_STATUSES))))
    for row in rows:
        job = session.get(Job, row.job_id) if row.job_id else None
        if job is None or job.status in ACTIVE_STATUSES:
            continue
        status = "cancelled" if job.status == "cancelled" else "failed"
        error = job.error or f"The {job.kind} job ended ({job.status}) before this finished"
        if isinstance(row, Dataset):
            row.status, row.stats = status, {"error": error}
        else:
            row.status, row.error, row.finished_at = status, error, job.finished_at or utcnow()
        fixed += 1
    if fixed:
        session.commit()
    return fixed
