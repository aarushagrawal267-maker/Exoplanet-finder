"""Schemas for model predictions (``/api/predictions``).

Planet-like scores are research leads, not discoveries: every scoring response carries a
``disclaimer`` the UI should show next to the numbers.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from exofinder.api.schemas.catalog import SignalOut
from exofinder.api.schemas.common import UtcDatetime
from exofinder.api.schemas.lightcurves import EphemerisIn, QualityOut, SourceOut, ViewsOut


class CatalogPredictionSource(BaseModel):
    type: Literal["catalog"] = "catalog"
    kepid: int
    signal_id: int | None = Field(None, description="Required with ephemeris_source 'catalog'")


class UploadPredictionSource(BaseModel):
    type: Literal["upload"] = "upload"
    upload_id: str


PredictionSource = Annotated[CatalogPredictionSource | UploadPredictionSource, Field(discriminator="type")]


class PredictIn(BaseModel):
    model_version_ids: list[int] | None = Field(
        None, description="Models to run (default: settings default_model_id, else the active model)"
    )
    source: PredictionSource
    ephemeris: EphemerisIn | None = Field(None, description="Required with ephemeris_source 'manual'")
    ephemeris_source: Literal["catalog", "bls", "manual"] = "catalog"
    download_if_missing: bool = Field(
        True,
        description="Catalogue stars only: download the light curve synchronously if it is not cached "
        "(otherwise 409 code=not_downloaded)",
    )


class CatalogLabels(BaseModel):
    """NASA's own classification of the signal, shown beside the model score."""

    signal_key: str | None = None
    kepler_name: str | None = None
    kepoi_name: str | None = None
    av_training_set: str | None = None
    koi_disposition: str | None = None
    category: str | None = None
    label_conflict: bool = False


class PredictionOut(BaseModel):
    id: int
    created_at: UtcDatetime
    model_version_id: int
    model_name: str
    model_type: str | None = None
    is_fixture_model: bool = Field(description="True: a synthetic test fixture, never a real result")
    probability: float = Field(description="Calibrated P(planet-like)")
    raw_probability: float = Field(description="Uncalibrated model probability")
    predicted_label: int = Field(description="1 planet-like, 0 false-positive-like (at `threshold`)")
    predicted_class: str
    threshold: float | None = None
    threshold_mode: str | None = Field(None, description="validation_f1 | fixed_0.5")
    uncertainty: float | None = Field(
        None, description="Std of probabilities (ensemble / MC dropout / tree votes)"
    )
    uncertainty_method: str | None = None
    member_probabilities: list[float] = []
    seen_in_split: Literal["train", "val", "test"] | None = Field(
        None, description="Split of this star in the model's dataset; null = not in it"
    )
    inference_ms: float | None = None
    source_type: str = Field(description="catalog | fits | csv")
    kepid: int | None = None
    signal_id: int | None = None
    signal_key: str | None = None
    input_name: str
    ephemeris: dict[str, Any] | None = None
    quality_grade: str | None = None
    quality_ok: bool | None = None
    catalog_labels: CatalogLabels | None = None
    batch_job_id: str | None = None
    pipeline_version: str | None = None


class PredictResponse(BaseModel):
    results: list[PredictionOut]
    views: ViewsOut
    quality: QualityOut
    ephemeris: dict[str, Any]
    features: dict[str, float | None] = Field(description="Physical features measured from the light curve")
    catalog_labels: CatalogLabels | None = None
    signal: SignalOut | None = None
    source: SourceOut
    warnings: list[str] = []
    disclaimer: str
    pipeline_version: str


class PredictionPage(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[PredictionOut]


class PredictionDetailOut(PredictionOut):
    views: ViewsOut | None = None
    views_source: str | None = None
    features: dict[str, float | None] | None = None
    quality: dict[str, Any] = {}
    signal: SignalOut | None = None
    warnings: list[str] = []
    disclaimer: str


class BatchIn(BaseModel):
    model_version_id: int | None = Field(
        None, description="Default: settings default model, else active model"
    )
    category: str = Field("candidate", description="Signal category (comma-separated) or 'all'")
    only_downloaded: bool = Field(True, description="False: download missing light curves first")
    limit: int | None = Field(None, ge=1)
    skip_existing: bool = Field(False, description="Skip signals this model has already scored")


class CandidateScore(BaseModel):
    prediction_id: int
    model_version_id: int
    model_name: str
    model_type: str | None = None
    is_fixture_model: bool
    probability: float
    uncertainty: float | None = None
    predicted_label: int
    seen_in_split: str | None = None
    created_at: UtcDatetime


class Agreement(BaseModel):
    n_models: int
    n_planet_like: int
    fraction_planet_like: float
    consensus: Literal["planet-like", "false-positive-like", "split"]


class CandidateOut(BaseModel):
    rank: int
    signal_id: int
    signal_key: str
    kepid: int
    kepler_host_name: str | None = None
    kepler_name: str | None = None
    kepoi_name: str | None = None
    category: str
    koi_disposition: str | None = None
    av_training_set: str | None = None
    label_conflict: bool
    period_days: float | None = None
    depth_ppm: float | None = None
    duration_hours: float | None = None
    planet_radius_re: float | None = None
    scores: list[CandidateScore]
    mean_probability: float
    max_probability: float
    min_probability: float
    agreement: Agreement
    uncertainty: float | None = None
    quality_grade: str | None = None
    quality_ok: bool | None = None
    seen_in_training: bool = Field(description="Some model saw this star in its train/val split")
    has_fixture_model_scores: bool


class CandidateModel(BaseModel):
    id: int
    name: str
    model_type: str
    is_fixture: bool


class CandidatePage(BaseModel):
    total: int
    limit: int
    offset: int
    include_seen: bool = False
    n_hidden_seen: int = Field(
        0, description="Signals hidden because their star was in a model's train/val split"
    )
    items: list[CandidateOut]
    models: list[CandidateModel]
    disclaimer: str
