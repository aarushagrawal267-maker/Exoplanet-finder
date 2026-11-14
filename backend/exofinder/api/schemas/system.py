"""Schemas for the overview dashboard and diagnostics (``/api/system``)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from exofinder.api.schemas.common import JobOut
from exofinder.api.schemas.predictions import PredictionOut
from exofinder.api.schemas.settings import StorageOut


class CatalogSummary(BaseModel):
    n_signals: int
    n_targets: int
    by_category: dict[str, int]
    by_av_label: dict[str, int]
    by_koi_disposition: dict[str, int]
    label_conflicts: int
    last_refresh: datetime | None = None
    snapshot_ids: dict[str, int] = Field(description="Latest snapshot id per source")


class LightCurveSummary(BaseModel):
    available: int
    no_data: int
    error: int
    downloading: int
    queued: int
    not_downloaded: int
    disk_bytes: int


class DatasetBrief(BaseModel):
    id: int
    name: str
    status: str
    tier: str
    label_mode: str
    n_examples: int
    created_at: datetime


class DatasetSummary(BaseModel):
    count: int
    n_ready: int
    latest: DatasetBrief | None = None


class ModelBrief(BaseModel):
    id: int
    name: str
    model_type: str
    dataset_id: int | None = None
    dataset_name: str | None = None
    is_active: bool
    is_fixture: bool
    threshold: float | None = None
    val_metrics: dict[str, Any] = {}
    test_metrics: dict[str, Any] = {}
    created_at: datetime


class ModelSummary(BaseModel):
    count: int
    n_real: int = Field(description="Models that are not test fixtures")
    active: ModelBrief | None = None
    default_model_id: int | None = None
    default_for_predictions: ModelBrief | None = None


class PredictionSummary(BaseModel):
    count: int
    recent: list[PredictionOut]


class DeviceInfo(BaseModel):
    preference: str | None = None
    device: str | None = None
    cuda_available: bool | None = None
    cuda_device: str | None = None
    mps_available: bool | None = None
    torch: str | None = None
    cpu_count: int | None = None
    torch_num_threads: int | None = None
    platform: str | None = None
    python: str | None = None
    error: str | None = None


class StepAction(BaseModel):
    method: str
    path: str


class NextStep(BaseModel):
    key: str
    title: str
    description: str
    done: bool
    page: str = Field(description="UI area: catalog | targets | datasets | training | evaluation | predict")
    action: StepAction | None = None


class SystemSummaryOut(BaseModel):
    app_version: str
    pipeline_version: str
    catalog: CatalogSummary
    lightcurves: LightCurveSummary
    datasets: DatasetSummary
    models: ModelSummary
    predictions: PredictionSummary
    running_jobs: list[JobOut]
    device: DeviceInfo
    checklist: list[NextStep] = Field(description="All setup steps with done flags")
    next_steps: list[NextStep] = Field(description="Pending steps, in order")
    disclaimer: str


class PathInfo(BaseModel):
    path: str
    exists: bool
    writable: bool


class NetworkCheck(BaseModel):
    name: str
    url: str
    ok: bool
    status_code: int | None = None
    elapsed_ms: float
    error: str | None = None


class DiagnosticsOut(BaseModel):
    versions: dict[str, str | None]
    paths: dict[str, PathInfo]
    database_url: str
    storage: StorageOut
    device: DeviceInfo
    settings: dict[str, Any]
    network: list[NetworkCheck] | None = None
    network_checked: bool
