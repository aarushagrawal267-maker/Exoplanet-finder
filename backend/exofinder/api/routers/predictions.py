"""Model predictions: ``/api/predictions``."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query

from exofinder.api.deps import get_job_or_404, job_out
from exofinder.api.routers._sci_route import DbSession, SciRoute
from exofinder.api.schemas.common import ErrorOut, JobOut
from exofinder.api.schemas.predictions import (
    BatchIn,
    CandidatePage,
    PredictIn,
    PredictionDetailOut,
    PredictionPage,
    PredictResponse,
)
from exofinder.services import predictions as svc

router = APIRouter(prefix="/api/predictions", tags=["predictions"], route_class=SciRoute)


@router.post(
    "",
    response_model=PredictResponse,
    summary="Score one signal with one or more models",
    responses={
        400: {"model": ErrorOut, "description": "signal_required / invalid_ephemeris / insufficient_data"},
        404: {"model": ErrorOut, "description": "signal_not_found / model_not_found / upload_not_found"},
        409: {
            "model": ErrorOut,
            "description": "no_model / not_downloaded / upload_not_parsed / model_unavailable",
        },
    },
)
def predict(db: DbSession, body: PredictIn) -> dict:
    """Builds the views (catalogue, BLS or manual ephemeris), runs each model and stores one
    prediction per model, including ``seen_in_split`` and warnings. Catalogue stars that are not
    downloaded yet are downloaded synchronously unless ``download_if_missing`` is false."""
    req = body.model_dump()
    return svc.predict(db, req)


@router.get("", response_model=PredictionPage, summary="Prediction history")
def history(
    db: DbSession,
    kepid: int | None = Query(None),
    model_version_id: int | None = Query(None),
    source_type: Literal["catalog", "fits", "csv"] | None = Query(None),
    signal_id: int | None = Query(None),
    batch_job_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    return svc.list_predictions(
        db,
        kepid=kepid,
        model_version_id=model_version_id,
        source_type=source_type,
        signal_id=signal_id,
        batch_job_id=batch_job_id,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/batch",
    response_model=JobOut,
    status_code=202,
    summary="Score many catalogue signals (background job)",
    responses={409: {"model": ErrorOut, "description": "no_model / nothing_to_score"}},
)
def batch(db: DbSession, body: BatchIn) -> JobOut:
    job_id = svc.start_batch(
        db,
        body.model_version_id,
        category=body.category,
        only_downloaded=body.only_downloaded,
        limit=body.limit,
        skip_existing=body.skip_existing,
    )
    return job_out(get_job_or_404(db, job_id))


@router.get("/candidates", response_model=CandidatePage, summary="Ranked candidate signals (research leads)")
def candidates(
    db: DbSession,
    category: str = Query("candidate", description="Signal category (comma-separated) or 'all'"),
    model_version_id: int | None = Query(None),
    min_probability: float | None = Query(None, ge=0, le=1),
    sort: Literal["mean_probability", "max_probability", "agreement", "uncertainty"] = Query(
        "mean_probability"
    ),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    """Latest catalogue-ephemeris score per signal per model, with agreement across models,
    uncertainty and quality grade. These are leads for follow-up, not discoveries."""
    return svc.candidates(
        db,
        category=category,
        model_version_id=model_version_id,
        min_probability=min_probability,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{prediction_id}",
    response_model=PredictionDetailOut,
    summary="Prediction detail incl. views",
    responses={404: {"model": ErrorOut, "description": "code=prediction_not_found"}},
)
def detail(db: DbSession, prediction_id: int) -> dict:
    return svc.get_prediction(db, prediction_id)
