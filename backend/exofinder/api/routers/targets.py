"""Targets (Kepler stars): ``/api/targets``."""

from __future__ import annotations

from fastapi import APIRouter, Query, Response

from exofinder.api.deps import get_job_or_404, job_out
from exofinder.api.routers._sci_route import DbSession, SciRoute
from exofinder.api.schemas.common import ErrorOut, JobOut
from exofinder.api.schemas.targets import TargetDetailOut, TargetOut, TargetSearchResult
from exofinder.services import targets as svc

router = APIRouter(prefix="/api/targets", tags=["targets"], route_class=SciRoute)


@router.get("/search", response_model=list[TargetSearchResult], summary="Find a star by name or id")
def search(
    db: DbSession,
    q: str = Query(
        ..., min_length=1, description='"Kepler-90", "Kepler-90 h", "KIC 11442793", "K00351.01"...'
    ),
    limit: int = Query(20, ge=1, le=20),
) -> list[dict]:
    return svc.search(db, q, limit)


@router.get(
    "/{kepid}",
    response_model=TargetDetailOut,
    summary="Target dossier",
    responses={404: {"model": ErrorOut, "description": "code=target_not_found"}},
)
def detail(db: DbSession, kepid: int) -> dict:
    """Target, stellar parameters (with provenance), signals with labels, dataset memberships and
    recent predictions."""
    return svc.detail(db, kepid)


@router.post(
    "/{kepid}/download",
    response_model=None,
    summary="Download the star's Kepler light curves (idempotent)",
    responses={
        200: {"model": TargetOut, "description": "Already available: the target, no job"},
        202: {"model": JobOut, "description": "Download job started (or already running)"},
        404: {"model": ErrorOut, "description": "code=target_not_found"},
    },
)
def download(db: DbSession, kepid: int, response: Response) -> TargetOut | JobOut:
    """Returns 200 with the target when the light curve is already cached, otherwise 202 with the
    ``download`` job (an already running download for the same star is returned, not duplicated)."""
    kind, value = svc.download(db, kepid)
    if kind == "available":
        response.status_code = 200
        return TargetOut.model_validate(value)
    response.status_code = 202
    return job_out(get_job_or_404(db, value))
