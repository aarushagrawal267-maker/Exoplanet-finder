"""User uploads: ``/api/uploads`` (FITS or CSV/text light curves)."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, File, Query, UploadFile

from exofinder.api.routers._sci_route import DbSession, SciRoute
from exofinder.api.schemas.common import ErrorOut
from exofinder.api.schemas.lightcurves import LightCurveOut
from exofinder.api.schemas.uploads import ParseIn, ParseOut, UploadOut
from exofinder.services import lightcurves as lc_svc
from exofinder.services import uploads as svc

router = APIRouter(prefix="/api/uploads", tags=["uploads"], route_class=SciRoute)


@router.post(
    "",
    response_model=UploadOut,
    summary="Upload a light-curve file",
    responses={
        400: {"model": ErrorOut, "description": "unsupported_file_type / invalid_file"},
        413: {"model": ErrorOut, "description": "file_too_large (> 200 MB)"},
    },
)
def upload(
    file: Annotated[UploadFile, File(description=".fits/.fit/.fits.gz or .csv/.txt, <= 200 MB")],
) -> dict:
    """Store the file and describe it: FITS header facts, or the CSV columns, a suggested column
    mapping and preview rows to confirm before parsing."""
    try:
        return svc.save_upload(file.file, file.filename)
    finally:
        file.file.close()


@router.get("/{upload_id}", response_model=UploadOut, summary="Upload details")
def get_upload(upload_id: str) -> dict:
    return svc.upload_response(svc.read_meta(upload_id))


@router.post(
    "/{upload_id}/parse",
    response_model=ParseOut,
    summary="Parse an upload with a confirmed column mapping and time system",
    responses={400: {"model": ErrorOut}, 404: {"model": ErrorOut}},
)
def parse(upload_id: str, body: ParseIn) -> dict:
    """BJD times are converted to BKJD (BJD - 2454833.0). The response lists warnings, e.g. that
    non-Kepler-long-cadence data is out of distribution for the models."""
    mapping = body.mapping.model_dump() if body.mapping is not None else None
    if mapping is not None and not any(mapping.values()):
        mapping = None
    return svc.parse_upload(upload_id, mapping, body.time_system)


@router.get(
    "/{upload_id}/lightcurve",
    response_model=LightCurveOut,
    summary="Processed light curve of a parsed upload",
    responses={409: {"model": ErrorOut, "description": "code=upload_not_parsed"}},
)
def upload_lightcurve(
    db: DbSession,
    upload_id: str,
    period: float | None = Query(None, gt=0),
    epoch: float | None = Query(None),
    duration_hours: float | None = Query(None, gt=0),
    detrend: Literal["spline", "savgol"] = Query("spline"),
    max_points: int = Query(20000, ge=100, le=50000),
) -> dict:
    """Same payload as ``GET /api/lightcurves/{kepid}``."""
    return lc_svc.upload_lightcurve(
        db,
        upload_id,
        period=period,
        epoch=epoch,
        duration_hours=duration_hours,
        detrend=detrend,
        max_points=max_points,
    )
