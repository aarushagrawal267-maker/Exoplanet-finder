"""Model training: ``/api/training`` (model types, time estimate, runs and suites)."""

from __future__ import annotations

from fastapi import APIRouter

from exofinder.api.deps import get_job_or_404, job_out
from exofinder.api.routers._ops_route import DbSession, OpsRoute, errors
from exofinder.api.schemas.training import (
    EstimateOut,
    ModelCardOut,
    ModelType,
    TrainingRunCreate,
    TrainingRunOut,
    TrainingSuiteCreate,
    TrainingSuiteOut,
)
from exofinder.services import training as svc
from exofinder.services.jobs import launch

router = APIRouter(prefix="/api/training", tags=["training"], route_class=OpsRoute)


@router.get("/model-types", response_model=list[ModelCardOut], summary="Model cards of the four model types")
def model_types() -> list[dict]:
    return svc.model_types()


@router.get(
    "/estimate",
    response_model=EstimateOut,
    summary="Measured seconds per training epoch",
    responses=errors((404, "dataset_not_found"), (409, "dataset_not_ready")),
)
def estimate(db: DbSession, model_type: ModelType, dataset_id: int) -> dict:
    """Times a few real training steps of a throw-away network on the dataset's examples (takes a few
    seconds for CNNs). Baselines have no epochs (``seconds_per_epoch`` is null)."""
    return svc.estimate(db, model_type, dataset_id)


@router.post(
    "/runs",
    response_model=TrainingRunOut,
    status_code=202,
    summary="Train one model (background job)",
    responses=errors(
        (400, "invalid_config"),
        (404, "dataset_not_found"),
        (409, "dataset_not_ready"),
        (409, "incompatible_pipeline"),
    ),
)
def start_run(db: DbSession, body: TrainingRunCreate) -> dict:
    """Creates an experiment and a ``train`` job. Progress events include ``epoch`` records
    (train/val loss, val PR-AUC/ROC-AUC/accuracy). The first successful model becomes active if no
    model is active."""
    exp, spec = svc.start_training(
        db,
        model_type=body.model_type,
        dataset_id=body.dataset_id,
        name=body.name,
        config=body.config.as_dict(),
    )
    job_id = launch(spec)
    return {"experiment_id": exp.id, "job": job_out(get_job_or_404(db, job_id))}


@router.post(
    "/suite",
    response_model=TrainingSuiteOut,
    status_code=202,
    summary="Train all four model types sequentially (one job)",
    responses=errors((400, "invalid_config"), (404, "dataset_not_found"), (409, "dataset_not_ready")),
)
def start_suite(db: DbSession, body: TrainingSuiteCreate) -> dict:
    """One experiment per model type (logistic regression, random forest, single-view CNN, two-view
    CNN) on the same dataset and splits, trained one after the other in a ``train_suite`` job."""
    exps, spec = svc.start_suite(
        db,
        dataset_id=body.dataset_id,
        name_prefix=body.name_prefix,
        configs={k: v.as_dict() for k, v in body.configs.items()},
        model_types=body.model_types,
    )
    job_id = launch(spec)
    return {"experiment_ids": [e.id for e in exps], "job": job_out(get_job_or_404(db, job_id))}
