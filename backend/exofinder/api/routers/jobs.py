"""Background jobs: ``/api/jobs`` (list, detail, cancel) and Server-Sent-Event streams.

SSE format: every message is ``event: <name>`` + ``data: <json>``. Event names: ``snapshot`` (sent
first: the job, or the list of active jobs for the global stream), ``progress``, ``log``, ``epoch``
(training metrics) and ``done`` (final status; the per-job stream closes after it). A comment line
(``: keep-alive``) is sent every 15 s so proxies keep the connection open.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from exofinder.api.deps import job_out
from exofinder.api.routers._ops_route import DbSession, OpsRoute, errors
from exofinder.api.schemas.common import JobOut
from exofinder.db.models import Job
from exofinder.db.session import session_scope
from exofinder.jobs.runner import get_runner
from exofinder.services import jobs as svc
from exofinder.services.jsonutil import to_jsonable

router = APIRouter(prefix="/api/jobs", tags=["jobs"], route_class=OpsRoute)

KEEPALIVE_S = 15.0
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"}


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(to_jsonable(data), separators=(',', ':'))}\n\n"


def _job_snapshot(job_id: str) -> dict[str, Any] | None:
    with session_scope() as s:
        job = s.get(Job, job_id)
        return job_out(job).model_dump(mode="json") if job is not None else None


def _active_snapshot() -> list[dict[str, Any]]:
    with session_scope() as s:
        return [
            job_out(j).model_dump(mode="json") for j in svc.list_jobs(s, status="queued,running", limit=100)
        ]


async def _event_stream(request: Request, job_id: str | None) -> AsyncIterator[str]:
    """Subscribe before taking the snapshot so no event is lost between the two."""
    bus = get_runner().bus
    sub = bus.subscribe(job_id)
    try:
        if job_id is not None:
            snap = _job_snapshot(job_id)
            yield _sse("snapshot", snap)
            if snap is None or snap["status"] not in svc.ACTIVE_STATUSES:
                if snap is not None:
                    yield _sse(
                        "done",
                        {
                            "job_id": job_id,
                            "status": snap["status"],
                            "result": snap.get("result"),
                            "error": snap.get("error"),
                        },
                    )
                return
        else:
            yield _sse("snapshot", {"jobs": _active_snapshot()})
        while True:
            if await request.is_disconnected():
                return
            try:
                msg = await asyncio.wait_for(sub.queue.get(), timeout=KEEPALIVE_S)
            except TimeoutError:
                yield ": keep-alive\n\n"
                continue
            data = dict(msg.get("data") or {})
            data["job_id"] = msg.get("job_id")
            yield _sse(msg.get("event", "message"), data)
            if job_id is not None and msg.get("event") == "done":
                return
    finally:
        bus.unsubscribe(sub)


@router.get("", response_model=list[JobOut], summary="List jobs (most recent first)")
def list_jobs(
    db: DbSession,
    status: str | None = Query(
        None, description="Comma-separated: queued,running,succeeded,failed,cancelled"
    ),
    kind: str | None = Query(None, description="Comma-separated job kinds, e.g. build_dataset,train"),
    limit: int = Query(50, ge=1, le=500),
) -> list[JobOut]:
    return [job_out(j) for j in svc.list_jobs(db, status, kind, limit)]


@router.get(
    "/stream",
    summary="SSE stream of all job updates (job tray)",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}, "description": "Server-Sent Events"}},
)
async def stream_all(request: Request) -> StreamingResponse:
    """First event ``snapshot`` = ``{jobs: JobOut[]}`` of queued/running jobs, then every
    ``progress``/``log``/``epoch``/``done`` event of every job (each with ``job_id``)."""
    return StreamingResponse(
        _event_stream(request, None), media_type="text/event-stream", headers=SSE_HEADERS
    )


@router.get(
    "/{job_id}",
    response_model=JobOut,
    summary="Job detail with the last 200 log lines",
    responses=errors((404, "job_not_found")),
)
def get_job(db: DbSession, job_id: str) -> JobOut:
    return job_out(svc.get_job(db, job_id), with_log=True)


@router.post(
    "/{job_id}/cancel",
    response_model=JobOut,
    summary="Request cooperative cancellation",
    responses=errors((404, "job_not_found"), (409, "job_not_active"), (409, "job_not_in_this_process")),
)
def cancel_job(db: DbSession, job_id: str) -> JobOut:
    """The job stops at its next checkpoint (between signals, mini-batches or downloads) and ends as
    ``cancelled``; partial artefacts are removed."""
    return job_out(svc.cancel_job(db, job_id), with_log=True)


@router.get(
    "/{job_id}/events",
    summary="SSE stream of one job",
    response_class=StreamingResponse,
    responses={
        200: {"content": {"text/event-stream": {}}, "description": "Server-Sent Events"},
        **errors((404, "job_not_found")),
    },
)
async def job_events(job_id: str, request: Request) -> StreamingResponse:
    """First event ``snapshot`` = JobOut, then ``progress``/``log``/``epoch`` events, and ``done``
    (after which the stream closes). For a finished job: ``snapshot`` + ``done``."""
    with session_scope() as s:
        svc.get_job(s, job_id)  # 404 before the stream starts
    return StreamingResponse(
        _event_stream(request, job_id), media_type="text/event-stream", headers=SSE_HEADERS
    )
