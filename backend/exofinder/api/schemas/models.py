"""Schemas for ``/api/models``."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from exofinder.api.schemas.common import UtcDatetime


class ModelVersionOut(BaseModel):
    id: int
    name: str
    model_type: str
    model_type_name: str
    experiment_id: int | None = None
    dataset_id: int | None = None
    dataset_name: str | None = None
    pipeline_version: str
    compatible: bool = Field(description="Trained with the running pipeline version")
    checkpoint_path: str
    checkpoint_exists: bool
    threshold: float = Field(description="Decision threshold (F1-optimal on validation)")
    temperature: float
    ensemble_size: int
    n_params: int | None = None
    is_active: bool
    is_fixture: bool = Field(description="TEST FIXTURE trained on synthetic data: never a scientific result")
    val_metrics: dict[str, Any] = {}
    test_metrics: dict[str, Any] = Field(
        {}, description="Metrics of the latest test-set evaluation (empty if none)"
    )
    n_evaluations: int = 0
    n_test_evaluations: int = 0
    created_at: UtcDatetime


class ModelEvaluationRef(BaseModel):
    id: int
    split: str
    dataset_id: int
    threshold: float
    pr_auc: float | None = None
    roc_auc: float | None = None
    f1: float | None = None
    created_at: UtcDatetime


class TrainingSummary(BaseModel):
    experiment_name: str | None = None
    best_epoch: int | None = None
    epochs_run: int | None = None
    duration_s: float | None = None
    device: str | None = None
    seed: int | None = None


class ModelDetailOut(ModelVersionOut):
    model_card: dict[str, Any] = {}
    config: dict[str, Any] = {}
    bundle: dict[str, Any] = Field(
        {}, description="Selected checkpoint metadata (best params, CV results, top features...)"
    )
    bundle_error: str | None = None
    checkpoint_bytes: int = 0
    training: TrainingSummary
    evaluations: list[ModelEvaluationRef] = []


class ModelDeleteOut(BaseModel):
    deleted: bool
    model_id: int
    models: int = 0
    evaluations: int = 0
    predictions: int = 0
    active_model_id: int | None = None
