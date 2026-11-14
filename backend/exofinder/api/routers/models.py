"""Trained model versions: ``/api/models``."""

from __future__ import annotations

from fastapi import APIRouter, Query

from exofinder.api.routers._ops_route import DbSession, OpsRoute, errors
from exofinder.api.schemas.models import ModelDeleteOut, ModelDetailOut, ModelVersionOut
from exofinder.services import models as svc

router = APIRouter(prefix="/api/models", tags=["models"], route_class=OpsRoute)


@router.get("", response_model=list[ModelVersionOut], summary="List model versions")
def list_models(
    db: DbSession, include_fixtures: bool = Query(True, description="Include TEST FIXTURE models")
) -> list[dict]:
    """Newest first, with validation metrics, latest test metrics, active flag and dataset name."""
    return svc.list_models(db, include_fixtures=include_fixtures)


@router.get(
    "/{model_id}",
    response_model=ModelDetailOut,
    summary="Model detail with model card and configuration",
    responses=errors((404, "model_not_found")),
)
def get_model(db: DbSession, model_id: int) -> dict:
    return svc.model_detail(db, model_id)


@router.post(
    "/{model_id}/activate",
    response_model=ModelVersionOut,
    summary="Make this the active model",
    responses=errors((404, "model_not_found"), (409, "incompatible_pipeline"), (409, "checkpoint_missing")),
)
def activate(db: DbSession, model_id: int) -> dict:
    return svc.activate_model(db, model_id)


@router.delete(
    "/{model_id}",
    response_model=ModelDeleteOut,
    summary="Delete a model version and its checkpoint",
    responses=errors((404, "model_not_found"), (409, "model_is_active")),
)
def delete_model(
    db: DbSession,
    model_id: int,
    force: bool = Query(False, description="Allow deleting the only (active) model"),
) -> dict:
    """Removes the checkpoint directory, the model's evaluations and the predictions made with it. If
    it was active, the most recent remaining model becomes active."""
    return svc.delete_model(db, model_id, force=force)
