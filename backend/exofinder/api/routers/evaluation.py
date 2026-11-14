"""Model evaluation: ``/api/evaluation``."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query

from exofinder.api.deps import get_job_or_404, job_out
from exofinder.api.routers._ops_route import DbSession, OpsRoute, errors, parse_ids
from exofinder.api.schemas.common import JobOut
from exofinder.api.schemas.evaluation import (
    EvaluationCompareOut,
    EvaluationCreate,
    EvaluationDetailOut,
    EvaluationExamplePage,
    EvaluationOut,
    FeatureImportanceOut,
)
from exofinder.services import evaluation as svc
from exofinder.services.jobs import launch

router = APIRouter(prefix="/api/evaluation", tags=["evaluation"], route_class=OpsRoute)


@router.post(
    "/runs",
    response_model=JobOut,
    status_code=202,
    summary="Evaluate a model on its validation or test split (background job)",
    responses=errors(
        (404, "model_not_found"),
        (409, "checkpoint_missing"),
        (409, "dataset_not_ready"),
        (409, "split_empty"),
    ),
)
def start_run(db: DbSession, body: EvaluationCreate) -> JobOut:
    """Test-set evaluations are logged and numbered (see ``test_evaluation_number``); their metrics are
    copied onto the model version. Iterate on the validation split."""
    spec = svc.start_evaluation(db, body.model_version_id, body.split, n_boot=body.n_boot, seed=body.seed)
    return job_out(get_job_or_404(db, launch(spec)))


@router.get("", response_model=list[EvaluationOut], summary="List evaluations")
def list_evaluations(
    db: DbSession,
    model_version_id: int | None = Query(None),
    dataset_id: int | None = Query(None),
    split: Literal["val", "test"] | None = Query(None),
) -> list[dict]:
    return svc.list_evaluations(db, model_version_id, dataset_id, split)


@router.get(
    "/compare",
    response_model=EvaluationCompareOut,
    summary="Compare evaluations side by side",
    responses=errors((400, "invalid_ids"), (404, "evaluation_not_found")),
)
def compare(
    db: DbSession, ids: str = Query(..., description="Comma-separated evaluation ids, e.g. 1,2,3")
) -> dict:
    """Aligned metric table with confidence intervals; ``warnings`` and ``comparable=false`` when the
    evaluations use different datasets or splits."""
    return svc.compare_evaluations(db, parse_ids(ids, "evaluation ids"))


@router.get(
    "/{evaluation_id}",
    response_model=EvaluationDetailOut,
    summary="Evaluation detail",
    responses=errors((404, "evaluation_not_found")),
)
def get_evaluation(db: DbSession, evaluation_id: int) -> dict:
    """Metrics (at the validation-chosen threshold and at 0.5), 95 % bootstrap CIs, ROC/PR/reliability
    curves, confusion matrix and inference timing."""
    return svc.evaluation_detail(db, evaluation_id)


@router.get(
    "/{evaluation_id}/examples",
    response_model=EvaluationExamplePage,
    summary="Scored examples by outcome",
    responses=errors((404, "evaluation_not_found"), (409, "per_example_missing")),
)
def examples(
    db: DbSession,
    evaluation_id: int,
    outcome: Literal["tp", "fp", "fn", "tn"] | None = Query(None),
    limit: int = Query(24, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    """Most confident first (highest score for predicted planet-like, lowest for predicted
    false-positive-like), with catalogue info and the local view."""
    return svc.evaluation_examples(db, evaluation_id, outcome=outcome, limit=limit, offset=offset)


@router.get(
    "/{evaluation_id}/feature-importance",
    response_model=FeatureImportanceOut,
    summary="Permutation feature importance (baselines only)",
    responses=errors(
        (404, "evaluation_not_found"), (409, "not_supported_for_cnn"), (409, "split_single_class")
    ),
)
def feature_importance(
    db: DbSession, evaluation_id: int, n_repeats: int = Query(5, ge=1, le=50), seed: int = Query(0, ge=0)
) -> dict:
    """Drop in PR-AUC when shuffling the global view, the local view or each physical feature on the
    evaluated split (logistic regression / random forest)."""
    return svc.feature_importance(db, evaluation_id, n_repeats=n_repeats, seed=seed)
