"""Catalogue endpoints: ``/api/catalog``."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Body, Query

from exofinder.api.deps import get_job_or_404, job_out
from exofinder.api.routers._sci_route import DbSession, SciRoute
from exofinder.api.schemas.catalog import CatalogStatsOut, RefreshIn, SignalPage, SnapshotOut
from exofinder.api.schemas.common import ErrorOut, JobOut
from exofinder.services import catalog as svc

router = APIRouter(prefix="/api/catalog", tags=["catalogue"], route_class=SciRoute)


@router.post(
    "/refresh",
    response_model=JobOut,
    status_code=202,
    summary="Refresh the NASA catalogue (background job)",
    responses={409: {"model": ErrorOut, "description": "code=job_running"}},
)
def refresh(db: DbSession, body: Annotated[RefreshIn | None, Body()] = None) -> JobOut:
    """Downloads fresh snapshots from the NASA Exoplanet Archive and re-ingests the catalogue as a
    ``catalog_refresh`` job. If NASA is unreachable the job fails with a ``[nasa_unavailable]`` error."""
    job_id = svc.start_refresh(db, body.sources if body else None)
    return job_out(get_job_or_404(db, job_id))


@router.get("/snapshots", response_model=list[SnapshotOut], summary="Catalogue snapshots with provenance")
def snapshots(db: DbSession, source: str | None = Query(None)) -> list[dict]:
    return svc.list_snapshots(db, source)


@router.get("/signals", response_model=SignalPage, summary="Browse catalogue signals")
def signals(
    db: DbSession,
    search: str | None = Query(None, description="KIC id, KOI name, Kepler name, host name or signal key"),
    category: str | None = Query(None, description="Comma-separated categories"),
    av_label: str | None = Query(None, description="Comma-separated PC,AFP,NTP,UNK or 'none'"),
    koi_disposition: str | None = Query(None, description="Comma-separated, or 'none'"),
    has_lightcurve: bool | None = Query(None),
    conflict: bool | None = Query(None, description="Only label conflicts (true) / none (false)"),
    min_period: float | None = Query(None, ge=0),
    max_period: float | None = Query(None, ge=0),
    min_snr: float | None = Query(None),
    max_snr: float | None = Query(None),
    kepid: int | None = Query(None),
    sort: str = Query("signal_key", description=", ".join(svc.SORT_COLUMNS)),
    order: Literal["asc", "desc"] = Query("asc"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    return svc.list_signals(
        db,
        search=search,
        category=category,
        av_label=av_label,
        koi_disposition=koi_disposition,
        has_lightcurve=has_lightcurve,
        conflict=conflict,
        min_period=min_period,
        max_period=max_period,
        min_snr=min_snr,
        max_snr=max_snr,
        kepid=kepid,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
    )


@router.get("/stats", response_model=CatalogStatsOut, summary="Catalogue counts and histograms")
def stats(db: DbSession) -> dict:
    return svc.stats(db)
