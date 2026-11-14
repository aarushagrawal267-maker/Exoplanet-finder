"""Light-curve endpoints: ``/api/lightcurves``."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from exofinder.api.deps import get_db
from exofinder.api.routers._sci_route import SciRoute
from exofinder.api.schemas.common import ErrorOut
from exofinder.api.schemas.lightcurves import LightCurveOut
from exofinder.services import lightcurves as svc

router = APIRouter(prefix="/api/lightcurves", tags=["light curves"], route_class=SciRoute)


@router.get(
    "/{kepid}",
    response_model=LightCurveOut,
    summary="Processed light curve of a catalogue star",
    responses={404: {"model": ErrorOut, "description": "code=not_downloaded: download the star first"}},
)
def get_lightcurve(
    kepid: int,
    signal_id: int | None = Query(None, description="Use this catalogue signal's ephemeris (BKJD)"),
    period: float | None = Query(None, gt=0, description="Manual ephemeris: period, days"),
    epoch: float | None = Query(None, description="Manual ephemeris: transit centre, BKJD"),
    duration_hours: float | None = Query(None, gt=0, description="Manual ephemeris: T14, hours"),
    detrend: Literal["spline", "savgol"] = Query("spline"),
    max_points: int = Query(20000, ge=100, le=50000, description="Display points per stage"),
    db: Session = Depends(get_db),
) -> dict:
    """Stages raw/normalized/trend/flat (downsampled for display), segments, cleaning report and,
    when an ephemeris is known (``signal_id`` or ``period``+``epoch``+``duration_hours``), the
    predicted transit times and the folded + binned light curve."""
    return svc.catalog_lightcurve(
        db,
        kepid,
        signal_id=signal_id,
        period=period,
        epoch=epoch,
        duration_hours=duration_hours,
        detrend=detrend,
        max_points=max_points,
    )
