"""Schemas for ``/api/evaluation``."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from exofinder.api.schemas.common import UtcDatetime


class EvaluationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_version_id: int
    split: Literal["val", "test"] = Field("test", description="Test evaluations are logged and counted")
    n_boot: int = Field(
        1000, ge=0, le=10000, description="Bootstrap resamples (whole stars) for the 95 % CIs"
    )
    seed: int = Field(0, ge=0)


class EvaluationOut(BaseModel):
    id: int
    model_version_id: int
    model_name: str | None = None
    model_type: str | None = None
    experiment_id: int | None = None
    is_fixture: bool = False
    dataset_id: int
    dataset_name: str | None = None
    split: str
    threshold: float
    n: int | None = None
    n_pos: int | None = None
    n_neg: int | None = None
    summary: dict[str, float | None] = {}
    test_evaluation_number: int | None = Field(
        None, description="1 for the first test evaluation of this model, ..."
    )
    created_at: UtcDatetime


class EvaluationDetailOut(EvaluationOut):
    metrics: dict[str, Any] = {}
    metrics_at_0_5: dict[str, Any] | None = None
    ci: dict[str, list[float] | None] = Field({}, description="{metric: [lo, hi]} 95 % percentile bootstrap")
    ci_method: dict[str, Any] | None = None
    curves: dict[str, list[dict[str, Any]]] = Field({}, description="roc, pr, calibration (downsampled)")
    confusion: dict[str, int] = {}
    timing: dict[str, Any] = {}
    per_example_available: bool = False


class EvaluationExampleOut(BaseModel):
    signal_id: int
    kepid: int
    signal_key: str | None = None
    label: int
    prob: float = Field(description="Calibrated probability of planet-like")
    raw_prob: float
    predicted_label: int
    uncertainty: float | None = None
    outcome: Literal["tp", "fp", "fn", "tn"]
    kepoi_name: str | None = None
    kepler_name: str | None = None
    category: str | None = None
    av_training_set: str | None = None
    koi_disposition: str | None = None
    period_days: float | None = None
    duration_hours: float | None = None
    depth_ppm: float | None = None
    local_view: list[float | None] | None = None
    local_phase: list[float | None] | None = None


class EvaluationExamplePage(BaseModel):
    total: int
    counts: dict[str, int]
    items: list[EvaluationExampleOut]


class CompareRow(BaseModel):
    metric: str
    values: dict[str, float | int | None]
    ci: dict[str, list[float] | None]
    best: str | None = Field(None, description="Evaluation id with the best value (None when not applicable)")


class EvaluationCompareOut(BaseModel):
    evaluations: list[EvaluationOut]
    metrics: list[CompareRow]
    comparable: bool
    warnings: list[str] = []


class FeatureImportanceRow(BaseModel):
    feature: str
    label: str
    n_columns: int
    importance_mean: float | None = None
    importance_std: float | None = None


class FeatureImportanceOut(BaseModel):
    evaluation_id: int
    model_version_id: int
    model_type: str
    split: str
    n_examples: int
    metric: str
    baseline_score: float | None = None
    n_repeats: int
    seed: int
    method: str
    features: list[FeatureImportanceRow]
    intrinsic: list[dict[str, Any]] = []
    intrinsic_meaning: str = ""
    is_fixture: bool = False
