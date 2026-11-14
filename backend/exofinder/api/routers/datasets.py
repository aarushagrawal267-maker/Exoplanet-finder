"""Training datasets: ``/api/datasets`` (tiers, build job, Dataset Explorer, delete)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query

from exofinder.api.deps import get_job_or_404, job_out
from exofinder.api.routers._ops_route import DbSession, OpsRoute, errors
from exofinder.api.schemas.common import JobOut
from exofinder.api.schemas.datasets import (
    DatasetCreate,
    DatasetDeleteOut,
    DatasetDetailOut,
    DatasetExamplePage,
    DatasetOut,
    ExampleViewsOut,
    GalleryOut,
    TierOut,
)
from exofinder.services import datasets as svc
from exofinder.services.jobs import launch

router = APIRouter(prefix="/api/datasets", tags=["datasets"], route_class=OpsRoute)


@router.get(
    "/tiers",
    response_model=list[TierOut],
    summary="Dataset tiers in the live catalogue",
    responses=errors((400, "invalid_label_mode")),
)
def tiers(
    db: DbSession, label_mode: Literal["astronet_dr24", "koi_disposition"] = Query("astronet_dr24")
) -> list[dict]:
    """Signal, star and class counts per tier (pilot / standard / full) with download-size and time
    estimates. Empty when the catalogue has not been downloaded yet."""
    return svc.list_tiers(db, label_mode)


@router.get("", response_model=list[DatasetOut], summary="List datasets")
def list_datasets(db: DbSession) -> list[dict]:
    return svc.list_datasets(db)


@router.post(
    "",
    response_model=JobOut,
    status_code=202,
    summary="Build a dataset (background job)",
    responses=errors(
        (400, "invalid_tier"),
        (400, "invalid_pipeline_config"),
        (404, "dataset_not_found"),
        (409, "catalog_empty"),
        (409, "dataset_not_ready"),
    ),
)
def create_dataset(db: DbSession, body: DatasetCreate) -> JobOut:
    """Creates the dataset (status ``building``) and starts a ``build_dataset`` job that downloads
    missing light curves, processes every signal, records exclusions, splits by star and writes the
    arrays. The new dataset id is in ``params.dataset_id`` of the returned job."""
    ds, spec = svc.create_dataset(
        db,
        name=body.name,
        tier=body.tier,
        label_mode=body.label_mode,
        split_seed=body.split_seed,
        exclude_conflicts=body.exclude_conflicts,
        max_signals=body.max_signals,
        pipeline=body.pipeline.model_dump(),
        parent_id=body.parent_id,
        download_missing=body.download_missing,
    )
    job_id = launch(spec)
    return job_out(get_job_or_404(db, job_id))


@router.get(
    "/{dataset_id}",
    response_model=DatasetDetailOut,
    summary="Dataset detail with statistics",
    responses=errors((404, "dataset_not_found")),
)
def get_dataset(db: DbSession, dataset_id: int) -> dict:
    """``stats`` (ready datasets only): per-split counts, exclusions by reason (with examples and
    explanations), quality grades and issues, period/depth histograms per class, processing timings."""
    return svc.dataset_detail(db, dataset_id)


@router.get(
    "/{dataset_id}/examples",
    response_model=DatasetExamplePage,
    summary="Browse dataset examples",
    responses=errors((404, "dataset_not_found")),
)
def examples(
    db: DbSession,
    dataset_id: int,
    split: Literal["train", "val", "test"] | None = Query(None),
    label: Literal[0, 1] | None = Query(None),
    included: bool | None = Query(None),
    reason: str | None = Query(None, description="Exclusion reason code, e.g. quality:too_few_transits"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    return svc.dataset_examples(
        db, dataset_id, split=split, label=label, included=included, reason=reason, limit=limit, offset=offset
    )


@router.get(
    "/{dataset_id}/examples/{signal_id}/views",
    response_model=ExampleViewsOut,
    summary="Model views of one example",
    responses=errors((404, "dataset_not_found"), (404, "example_not_found"), (409, "views_unavailable")),
)
def example_views(db: DbSession, dataset_id: int, signal_id: int) -> dict:
    """Included examples: exactly the arrays the models see. Excluded examples: recomputed from the
    view cache when their light curve is available."""
    return svc.example_views(db, dataset_id, signal_id)


@router.get(
    "/{dataset_id}/gallery",
    response_model=GalleryOut,
    summary="Random sample of views per class",
    responses=errors((404, "dataset_not_found"), (409, "dataset_not_ready")),
)
def gallery(
    db: DbSession, dataset_id: int, per_class: int = Query(6, ge=1, le=50), seed: int = Query(0, ge=0)
) -> dict:
    return svc.gallery(db, dataset_id, per_class=per_class, seed=seed)


@router.delete(
    "/{dataset_id}",
    response_model=DatasetDeleteOut,
    summary="Delete a dataset",
    responses=errors((404, "dataset_not_found"), (409, "dataset_in_use"), (409, "dataset_building")),
)
def delete_dataset(
    db: DbSession,
    dataset_id: int,
    force: bool = Query(False, description="Also delete the experiments/models trained on it"),
) -> dict:
    return svc.delete_dataset(db, dataset_id, force=force)
