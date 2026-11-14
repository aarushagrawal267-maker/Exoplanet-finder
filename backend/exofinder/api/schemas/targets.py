"""Schemas for targets (Kepler stars): ``/api/targets``."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from exofinder.api.schemas.analysis import StellarOut
from exofinder.api.schemas.catalog import SignalOut
from exofinder.api.schemas.predictions import PredictionOut


class TargetSearchResult(BaseModel):
    kepid: int
    label: str = Field(description='e.g. "Kepler-90 (KIC 11442793)"')
    kepler_host_name: str | None = None
    n_signals: int
    lc_status: str
    matched_on: str = Field(
        description="kepid | kepid_prefix | kepoi_name | kepler_name | kepler_host_name | signal_key"
    )
    matched_signal_id: int | None = Field(None, description="Signal named by the query (e.g. 'Kepler-90 h')")
    matched_signal_key: str | None = None
    matched_name: str | None = None
    rank: int = Field(description="0 = exact identifier match; larger = weaker match")


class TargetOut(BaseModel):
    kepid: int
    label: str
    kepler_host_name: str | None = None
    ra: float | None = None
    dec: float | None = None
    kepmag: float | None = None
    lc_status: str = Field(description="none | queued | downloading | available | no_data | error")
    lc_quarters: list[int] = []
    lc_n_cadences: int | None = None
    lc_error: str | None = None
    lc_updated_at: datetime | None = None
    lc_cached: bool = False
    lc_cache_bytes: int | None = None


class DatasetMembership(BaseModel):
    dataset_id: int
    dataset_name: str
    dataset_status: str | None = None
    split: str | None = Field(None, description="train | val | test, or null when excluded")
    n_signals: int


class TargetDetailOut(BaseModel):
    target: TargetOut
    stellar: StellarOut | None = None
    signals: list[SignalOut]
    datasets: list[DatasetMembership]
    recent_predictions: list[PredictionOut]
    reserved_showcase: bool = Field(
        description="Reserved showcase system (forced into test splits, never trained on)"
    )
