"""Experiment tracking: ``/api/experiments``."""

from __future__ import annotations

from fastapi import APIRouter, Query

from exofinder.api.routers._ops_route import DbSession, OpsRoute, errors, parse_ids
from exofinder.api.schemas.experiments import (
    ExperimentCompareOut,
    ExperimentDeleteOut,
    ExperimentDetailOut,
    ExperimentOut,
    ExperimentPatch,
)
from exofinder.services import experiments as svc

router = APIRouter(prefix="/api/experiments", tags=["experiments"], route_class=OpsRoute)


@router.get("", response_model=list[ExperimentOut], summary="List experiments")
def list_experiments(
    db: DbSession,
    model_type: str | None = Query(None),
    dataset_id: int | None = Query(None),
    status: str | None = Query(None, description="Comma-separated statuses"),
    archived: bool | None = Query(None),
) -> list[dict]:
    return svc.list_experiments(
        db, model_type=model_type, dataset_id=dataset_id, status=status, archived=archived
    )


@router.get(
    "/compare",
    response_model=ExperimentCompareOut,
    summary="Compare experiments (configuration diff + epoch curves)",
    responses=errors((400, "invalid_ids"), (404, "experiment_not_found")),
)
def compare(db: DbSession, ids: str = Query(..., description="Comma-separated experiment ids")) -> dict:
    return svc.compare_experiments(db, parse_ids(ids, "experiment ids"))


@router.get(
    "/{experiment_id}",
    response_model=ExperimentDetailOut,
    summary="Experiment detail",
    responses=errors((404, "experiment_not_found")),
)
def get_experiment(db: DbSession, experiment_id: int) -> dict:
    """Configuration, environment, per-epoch metrics, model version and evaluations."""
    return svc.experiment_detail(db, experiment_id)


@router.patch(
    "/{experiment_id}",
    response_model=ExperimentDetailOut,
    summary="Edit name, notes, tags or archived flag",
    responses=errors((404, "experiment_not_found")),
)
def patch_experiment(db: DbSession, experiment_id: int, body: ExperimentPatch) -> dict:
    return svc.patch_experiment(
        db, experiment_id, name=body.name, notes=body.notes, tags=body.tags, archived=body.archived
    )


@router.delete(
    "/{experiment_id}",
    response_model=ExperimentDeleteOut,
    summary="Delete an experiment and its artefacts",
    responses=errors((404, "experiment_not_found"), (409, "experiment_running")),
)
def delete_experiment(db: DbSession, experiment_id: int) -> dict:
    """Removes the experiment, its epoch metrics, its model version(s) with checkpoints, their
    evaluations and the predictions made with them."""
    return svc.delete_experiment(db, experiment_id)
