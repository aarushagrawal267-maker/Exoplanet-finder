"""Schemas for ``/api/datasets``."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

DatasetStatus = Literal["building", "ready", "failed", "cancelled"]
Tier = Literal["pilot", "standard", "full", "custom"]
LabelMode = Literal["astronet_dr24", "koi_disposition"]


class TierOut(BaseModel):
    """Size of a dataset tier in the live catalogue, with rough download/processing estimates."""

    tier: str
    label_mode: str
    n_signals: int = Field(description="Labelled signals (before label-conflict exclusion)")
    n_unlabelled_reserved: int = Field(
        description="Unlabelled signals of reserved showcase stars (kept, not trained on)"
    )
    n_pos: int
    n_neg: int
    n_label_conflicts: int
    n_stars: int
    n_stars_downloaded: int
    n_stars_missing: int
    est_download_bytes: int
    est_download_minutes: float
    est_process_minutes: float
    est_minutes: float
    estimate_basis: str
    description: str


class PipelineOptions(BaseModel):
    """Preprocessing options a user may change for a dataset build."""

    model_config = ConfigDict(extra="forbid")

    detrend_method: Literal["spline", "savgol"] = "spline"


class DatasetCreate(BaseModel):
    """Request to build a dataset (``POST /api/datasets``)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    tier: Tier = "pilot"
    label_mode: LabelMode = "astronet_dr24"
    split_seed: int = Field(
        42, ge=0, description="Seeds both the tier's star selection and the star-level split"
    )
    exclude_conflicts: bool = Field(
        True, description="Exclude signals whose Autovetter label and KOI disposition disagree"
    )
    max_signals: int | None = Field(
        None, ge=1, description="Target number of labelled signals (required for tier 'custom')"
    )
    pipeline: PipelineOptions = Field(default_factory=PipelineOptions)
    parent_id: int | None = Field(None, description="Expand this dataset: its stars keep their split")
    download_missing: bool = Field(
        True, description="Download missing light curves from NASA MAST during the build"
    )


class SplitCounts(BaseModel):
    n: int
    n_pos: int
    n_neg: int
    n_stars: int


class Histogram(BaseModel):
    """Histogram of log10(value) per class on shared edges."""

    log10_edges: list[float]
    counts: dict[str, list[int]]
    unit: str = ""


class ProcessingStats(BaseModel):
    mode: str
    workers: int
    n_signals: int
    n_computed: int
    n_from_cache: int
    n_errors: int
    wall_s: float
    sum_task_s: float
    mean_task_s: float | None = None
    effective_speedup: float | None = Field(
        None, description="Sum of per-signal processing times / wall time"
    )
    worker_pids: int = 0
    fallback_reason: str | None = None


class ReservedStar(BaseModel):
    kepid: int
    name: str | None = None
    n_signals: int
    n_included: int


class DatasetStats(BaseModel):
    model_config = ConfigDict(extra="allow")

    per_split: dict[str, SplitCounts] = {}
    n_selected: int = 0
    n_included: int = 0
    n_excluded: int = 0
    n_stars: int = 0
    n_pos: int = 0
    n_neg: int = 0
    exclusions_by_reason: dict[str, int] = {}
    exclusion_examples: dict[str, list[str]] = {}
    exclusion_reason_labels: dict[str, str | None] = {}
    quality_grades: dict[str, int] = {}
    quality_issues: dict[str, int] = {}
    period_hist: Histogram | None = None
    depth_hist: Histogram | None = None
    processing: ProcessingStats | None = None
    downloads: dict[str, Any] = {}
    reserved: list[ReservedStar] = []
    warnings: list[str] = []
    synthetic: bool = False
    timings: dict[str, float] = {}
    manifest: dict[str, Any] = {}


class DatasetOut(BaseModel):
    id: int
    name: str
    label_mode: str
    tier: str
    status: DatasetStatus
    pipeline_version: str
    split_seed: int
    config: dict[str, Any] = {}
    content_hash: str | None = None
    path: str | None = None
    parent_id: int | None = None
    n_examples: int = 0
    n_train: int = 0
    n_val: int = 0
    n_test: int = 0
    n_excluded: int | None = None
    created_at: datetime
    job_id: str | None = None
    n_models: int = 0
    error: str | None = None
    is_synthetic: bool = Field(False, description="Built from synthetic TEST light curves")
    compatible: bool = Field(True, description="Built with the running pipeline version")


class DatasetDetailOut(DatasetOut):
    stats: DatasetStats | None = None


class DatasetExampleOut(BaseModel):
    signal_id: int
    signal_key: str
    kepid: int
    label: int | None = None
    split: str | None = None
    included: bool
    exclusion_reason: str | None = None
    exclusion_label: str | None = None
    quality: dict[str, Any] = {}
    quality_grade: str | None = None
    array_index: int | None = None
    period_days: float | None = None
    duration_hours: float | None = None
    depth_ppm: float | None = None
    model_snr: float | None = None
    kepoi_name: str | None = None
    kepler_name: str | None = None
    category: str | None = None
    av_training_set: str | None = None
    koi_disposition: str | None = None
    label_conflict: bool = False
    is_reserved: bool = False


class DatasetExamplePage(BaseModel):
    total: int
    items: list[DatasetExampleOut]


class ExampleViewsOut(BaseModel):
    """Model views of one example (flux normalised: baseline 0, transit minimum -1)."""

    model_config = ConfigDict(populate_by_name=True)

    signal_id: int
    signal_key: str
    kepid: int
    label: int | None = None
    split: str | None = None
    included: bool
    exclusion_reason: str | None = None
    global_view: list[float | None] = Field(alias="global")
    local_view: list[float | None] = Field(alias="local")
    global_phase: list[float | None] = Field(description="Bin centres, days from transit centre")
    local_phase: list[float | None]
    quality: dict[str, Any] = {}
    source: Literal["dataset_arrays", "view_cache"]


class GalleryItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    signal_id: int
    signal_key: str
    kepid: int
    label: int
    split: str
    period_days: float | None = None
    depth_ppm: float | None = None
    kepler_name: str | None = None
    global_view: list[float | None] = Field(alias="global", description="Global view downsampled to 401 bins")
    local_view: list[float | None] = Field(alias="local")


class GalleryOut(BaseModel):
    dataset_id: int
    per_class: int
    seed: int
    classes: dict[str, list[GalleryItem]] = Field(description="Keys: planet_like, false_positive_like")


class DatasetDeleteOut(BaseModel):
    deleted: bool
    dataset_id: int
    examples: int = 0
    experiments: int = 0
    models: int = 0
    evaluations: int = 0
    predictions: int = 0
