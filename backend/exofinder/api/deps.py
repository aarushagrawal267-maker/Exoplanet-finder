"""Shared FastAPI dependencies."""

from __future__ import annotations

from exofinder.api.errors import not_found
from exofinder.api.schemas.common import JobOut
from exofinder.db import get_db  # noqa: F401  (re-export for routers)
from exofinder.db.models import Job
from exofinder.jobs.runner import get_runner


def job_out(job: Job, with_log: bool = False) -> JobOut:
    """Serialise a Job row, adding live ETA from the runner when the job is active."""
    out = JobOut.model_validate(job)
    ctx = get_runner().context(job.id)
    if ctx is not None:
        out.eta_s = ctx.eta_seconds()
        # live values are fresher than the throttled DB copy
        out.progress = max(out.progress, ctx._progress)
        out.message = ctx._message or out.message
    if with_log:
        text = ctx.log_text() if ctx is not None else (job.log or "")
        out.log_tail = "\n".join(text.splitlines()[-200:])
    return out


def get_job_or_404(db, job_id: str) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise not_found("Job")
    return job
