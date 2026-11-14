"""Overview dashboard and diagnostics: ``/api/system`` (``/api/health`` lives in ``main.py``)."""

from __future__ import annotations

from fastapi import APIRouter, Query

from exofinder.api.deps import job_out
from exofinder.api.routers._sci_route import DbSession, SciRoute
from exofinder.api.schemas.system import DiagnosticsOut, SystemSummaryOut
from exofinder.services import system as svc

router = APIRouter(prefix="/api/system", tags=["system"], route_class=SciRoute)

# Importing torch to describe the compute device takes seconds: start it now, in the background.
svc.warm_device_info()


@router.get("/summary", response_model=SystemSummaryOut, summary="Overview dashboard payload")
def summary(db: DbSession) -> dict:
    """Catalogue, light-curve, dataset, model and prediction counts from the real database, running
    jobs, the compute device and the ``next_steps`` of a fresh install."""
    data = svc.summary(db)
    data["running_jobs"] = [job_out(j) for j in data["running_jobs"]]
    return data


@router.get("/diagnostics", response_model=DiagnosticsOut, summary="Versions, paths, disk, device, network")
def diagnostics(
    db: DbSession,
    check_network: bool = Query(False, description="Also ping the NASA Exoplanet Archive and MAST"),
) -> dict:
    return svc.diagnostics(db, check_network)
