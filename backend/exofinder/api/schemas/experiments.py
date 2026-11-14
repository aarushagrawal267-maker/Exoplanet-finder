"""Schemas for ``/api/experiments``."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from exofinder.api.schemas.evaluation import EvaluationOut
from exofinder.api.schemas.models import ModelVersionOut


class EpochOut(BaseModel):
    epoch: int
    train_loss: float | None = None
    val_loss: float | None = None
    val_pr_auc: float | None = None
    val_roc_auc: float | None = None
    val_accuracy: float | None = None
    lr: float | None = None
    elapsed_s: float | None = None


class ExperimentOut(BaseModel):
    id: int
    name: str
    model_type: str
    dataset_id: int
    dataset_name: str | None = None
    status: str
    seed: int
    device: str | None = None
    best_epoch: int | None = None
    epochs_run: int | None = None
    duration_s: float | None = None
    val_summary: dict[str, float | None] = {}
    threshold: float | None = None
    model_version_id: int | None = None
    is_active_model: bool = False
    is_fixture: bool = False
    test_metrics: dict[str, Any] = {}
    notes: str = ""
    tags: list[str] = []
    archived: bool = False
    job_id: str | None = None
    error: str | None = None
    created_at: datetime
    finished_at: datetime | None = None


class ExperimentDetailOut(ExperimentOut):
    config: dict[str, Any] = {}
    environment: dict[str, Any] = {}
    val_metrics: dict[str, Any] = {}
    epochs: list[EpochOut] = Field(
        [], description="Per-epoch metrics (ensemble members are numbered consecutively)"
    )
    history: list[dict[str, Any]] = Field(
        [], description="Full per-epoch records from the checkpoint (incl. member)"
    )
    model_version: ModelVersionOut | None = None
    evaluations: list[EvaluationOut] = []


class ExperimentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(None, max_length=128)
    notes: str | None = None
    tags: list[str] | None = None
    archived: bool | None = None


class ExperimentDeleteOut(BaseModel):
    deleted: bool
    experiment_id: int
    experiments: int = 0
    models: int = 0
    evaluations: int = 0
    predictions: int = 0


class ConfigDiffRow(BaseModel):
    key: str
    values: dict[str, Any]


class ExperimentCompareOut(BaseModel):
    experiments: list[ExperimentOut]
    config_diff: list[ConfigDiffRow]
    config_same: dict[str, Any] = {}
    curves: dict[str, list[EpochOut]]
    warnings: list[str] = []
