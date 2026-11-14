"""Schemas for ``/api/training``."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from exofinder.api.schemas.common import JobOut

ModelType = Literal["logreg", "random_forest", "cnn_single", "cnn_two_view"]


class ModelCardOut(BaseModel):
    """Description of a model type (from :mod:`exofinder.ml.model_cards`)."""

    model_config = ConfigDict(extra="allow")

    type: ModelType
    name: str
    description: str
    inputs: list[str] = []
    strengths: list[str] = []
    limitations: list[str] = []
    architecture: list[str] = []
    uncertainty: str | None = None
    training: str | None = None
    default_config: dict[str, Any] = {}
    n_params: int | None = Field(
        None, description="Exact count for the default CNN geometry; None for baselines"
    )
    reference: str | None = None


class EstimateOut(BaseModel):
    """Measured training speed (a few real training steps on this machine)."""

    model_config = ConfigDict(extra="allow")

    model_type: str
    dataset_id: int
    n_train: int
    batches_per_epoch: int
    seconds_per_epoch: float | None = None
    seconds_per_batch: float | None = None
    num_threads: int | None = None
    device: str | None = None
    max_epochs: int | None = None
    ensemble_size: int = 1
    est_max_total_seconds: float | None = None
    note: str = ""


class TrainingConfigIn(BaseModel):
    """Training options (all optional; defaults from the model card). Unknown keys are rejected."""

    model_config = ConfigDict(extra="forbid")

    lr: float | None = Field(None, gt=0)
    batch_size: int | None = Field(None, ge=1)
    max_epochs: int | None = Field(None, ge=1)
    patience: int | None = Field(None, ge=1)
    min_delta: float | None = Field(None, ge=0)
    dropout: float | None = Field(None, ge=0, lt=1)
    fc_width: int | None = Field(None, ge=1)
    fc_layers: int | None = Field(None, ge=0)
    ensemble_size: int | None = Field(None, ge=1, le=10)
    seed: int | None = Field(None, ge=0)
    augment_flip: bool | None = None
    weight_decay: float | None = Field(None, ge=0)
    device: Literal["auto", "cpu", "cuda", "mps"] | None = None
    num_threads: int | None = Field(None, ge=1)
    cv_folds: int | None = Field(None, ge=2)
    logreg_c_grid: list[float] | None = None
    logreg_max_iter: int | None = Field(None, ge=1)
    rf_n_estimators: int | None = Field(None, ge=1)
    rf_max_depth_grid: list[int | None] | None = None
    rf_min_samples_leaf_grid: list[int] | None = None
    rf_max_features_grid: list[str | float] | None = None

    def as_dict(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True)


class TrainingRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(None, max_length=128, description="Defaults to '<model type> - <dataset name>'")
    model_type: ModelType
    dataset_id: int
    config: TrainingConfigIn = Field(default_factory=TrainingConfigIn)


class TrainingRunOut(BaseModel):
    experiment_id: int
    job: JobOut


class TrainingSuiteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: int
    name_prefix: str | None = Field(None, max_length=96)
    model_types: list[ModelType] | None = Field(
        None, description="Defaults to all four, in the order LR, RF, CNN, two-view CNN"
    )
    configs: dict[ModelType, TrainingConfigIn] = Field(
        default_factory=dict, description="Per-model-type options"
    )


class TrainingSuiteOut(BaseModel):
    experiment_ids: list[int]
    job: JobOut
