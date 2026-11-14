"""Analysis tools: ``/api/analysis`` (BLS, transit analysis, injection–recovery)."""

from __future__ import annotations

from fastapi import APIRouter

from exofinder.api.routers._sci_route import DbSession, SciRoute
from exofinder.api.schemas.analysis import BlsIn, BlsOut, InjectionIn, InjectionOut, TransitIn, TransitOut
from exofinder.api.schemas.common import ErrorOut
from exofinder.services import analysis as svc

router = APIRouter(prefix="/api/analysis", tags=["analysis"], route_class=SciRoute)

_ERRORS = {
    400: {"model": ErrorOut, "description": "invalid_parameters / insufficient_data / invalid_ephemeris"},
    409: {"model": ErrorOut, "description": "not_downloaded / upload_not_parsed"},
}


@router.post("/bls", response_model=BlsOut, summary="Box Least Squares period search", responses=_ERRORS)
def bls(db: DbSession, body: BlsIn) -> dict:
    """BLS on the flattened light curve of a catalogue star or a parsed upload. All values are
    ``measured``. Several seconds for a full 4-year Kepler light curve (results are cached)."""
    return svc.bls(db, body.source.model_dump(), body.min_period, body.max_period)


@router.post(
    "/transit", response_model=TransitOut, summary="Transit diagnostics at an ephemeris", responses=_ERRORS
)
def transit(db: DbSession, body: TransitIn) -> dict:
    """Trapezoid fit, odd/even, secondary eclipse, individual transits, SNR, quality, folded/binned
    curve with the model, a catalogue-vs-measured-vs-estimate comparison and derived estimates."""
    return svc.transit(db, body.source.model_dump(), body.ephemeris.model_dump(), body.signal_id)


@router.post(
    "/injection",
    response_model=InjectionOut,
    summary="Injection–recovery test on a real light curve (synthetic)",
    responses=_ERRORS,
)
def injection(db: DbSession, body: InjectionIn) -> dict:
    """Injects a SYNTHETIC trapezoid transit into a copy of a real cached Kepler light curve and runs
    a blind BLS search. The response is flagged ``synthetic: true``; nothing is stored."""
    return svc.injection(
        db,
        body.kepid,
        body.period_days,
        body.depth_ppm,
        body.duration_hours,
        epoch=body.epoch,
        ingress_fraction=body.ingress_fraction,
    )
