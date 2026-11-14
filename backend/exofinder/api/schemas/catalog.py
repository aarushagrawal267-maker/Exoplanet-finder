"""Schemas for the catalogue endpoints (``/api/catalog``)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from exofinder.api.schemas.common import UtcDatetime


class RefreshIn(BaseModel):
    sources: list[str] | None = Field(
        None,
        description="Subset of dr24_tce, koi_cumulative, confirmed, stellar (default: all). Others reuse "
        "their latest snapshot.",
    )


class SnapshotOut(BaseModel):
    """One verbatim retrieval of a NASA Exoplanet Archive table (provenance record)."""

    id: int
    source: str = Field(description="dr24_tce | koi_cumulative | confirmed | stellar")
    table_name: str
    query: str = Field(description="Exact ADQL text")
    url: str = Field(description="Equivalent TAP GET URL")
    retrieved_at: UtcDatetime
    row_count: int
    sha256: str
    file_path: str
    validation: dict[str, Any] = {}


class FpFlags(BaseModel):
    nt: int | None = None
    ss: int | None = None
    co: int | None = None
    ec: int | None = None


class SignalOut(BaseModel):
    """A catalogue transit-like signal. All values are catalogue values exactly as published."""

    id: int
    signal_key: str = Field(description="TCE-<kic9>-<nn> | KOI-<kepoi_name> | PL-<Kepler name>")
    kepid: int
    primary_source: str
    tce_plnt_num: int | None = None
    kepoi_name: str | None = None
    kepler_name: str | None = None
    period_days: float | None = None
    epoch_bkjd: float | None = None
    duration_hours: float | None = None
    depth_ppm: float | None = None
    model_snr: float | None = None
    planet_radius_re: float | None = None
    av_training_set: str | None = Field(None, description="DR24 Autovetter label: PC | AFP | NTP | UNK")
    koi_disposition: str | None = Field(None, description="CONFIRMED | CANDIDATE | FALSE POSITIVE")
    koi_pdisposition: str | None = None
    koi_score: float | None = Field(None, description="Display only; never a model feature")
    fpflags: FpFlags = FpFlags()
    category: str = Field(description="confirmed | candidate | false_positive | unknown | retired")
    label_conflict: bool = False
    match_status: str | None = None
    kepler_host_name: str | None = None
    lc_status: str | None = Field(None, description="Light-curve status of the star")
    provenance: dict[str, Any] | None = Field(None, description="Per-field provenance (detail views only)")


class SignalPage(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[SignalOut]


class HistogramOut(BaseModel):
    key: str = Field(description="log10_period | log10_depth | log10_snr")
    label: str
    unit: str
    edges: list[float]
    counts: dict[str, list[int]] = Field(description="category -> counts per bin")
    n_missing: dict[str, int] = Field(description="category -> signals without a positive value")


class CatalogStatsOut(BaseModel):
    total: int
    categories: dict[str, int]
    av_labels: dict[str, int]
    koi_dispositions: dict[str, int]
    label_conflicts: int
    with_lightcurve: int
    histograms: list[HistogramOut]
    snapshots_retrieved_at: dict[str, UtcDatetime | None]
    note: str
