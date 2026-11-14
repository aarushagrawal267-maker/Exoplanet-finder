"""Schemas for light-curve payloads, plus small types shared by the science routers.

Array conventions: ``time`` in days in the light curve's ``time_system`` (BKJD = BJD - 2454833.0 for
Kepler); ``phase`` in days in ``[-P/2, P/2)`` with the transit centre at 0; ``flux`` relative
(baseline ~1). Non-finite values are ``null``. Display arrays are bin-averaged (never decimated) to at
most ``max_points`` points and rounded to 1e-5 d / 1e-6 relative flux.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from exofinder.api.schemas.common import Provenance

TimeSystem = str  # BKJD | BTJD | unknown


class EphemerisIn(BaseModel):
    """An ephemeris supplied by the user (same time system as the light curve)."""

    period_days: float = Field(gt=0, description="Orbital period, days")
    epoch: float = Field(description="Time of a transit centre (BKJD for Kepler data)")
    duration_hours: float = Field(gt=0, description="Total transit duration T14, hours")


class EphemerisOut(BaseModel):
    period_days: float
    epoch: float
    duration_hours: float
    depth_ppm: float | None = None
    source: Provenance = Field(description="catalogue | measured (e.g. BLS) | manual")
    label: str = Field("", description="e.g. TCE-010666592-01, BLS, Manual")
    time_system: TimeSystem = "BKJD"


class QualityOut(BaseModel):
    """Signal-level data-quality report (``ok`` False: do not trust a score on this signal)."""

    ok: bool
    grade: Literal["A", "B", "C", "D"]
    n_transits_expected: int = 0
    n_transits_observed: int = 0
    in_transit_points: int = 0
    global_empty_frac: float | None = 0.0
    local_empty_frac: float | None = 0.0
    alignment_offset_durations: float | None = None
    depth_ratio_vs_catalogue: float | None = None
    issues: list[str] = []
    messages: list[str] = []


class Series(BaseModel):
    time: list[float | None]
    flux: list[float | None]
    n_original: int = Field(0, description="Number of points before display downsampling")


class PhaseSeries(BaseModel):
    phase: list[float | None]
    flux: list[float | None]


class BinnedSeries(PhaseSeries):
    window_days: float = Field(description="Binned range is |phase| <= window_days")
    bin_width_days: float


class FoldedOut(BaseModel):
    phase: list[float | None]
    flux: list[float | None]
    n_original: int = 0
    binned: BinnedSeries


class StagesOut(BaseModel):
    raw: Series | None = Field(None, description="Cached flux (per-quarter normalised), before cleaning")
    normalized: Series | None = Field(None, description="Cleaned, each segment divided by its median")
    trend: Series | None = Field(None, description="Fitted trend model on the normalised curve")
    flat: Series | None = Field(None, description="Detrended (normalised / trend), upper outliers clipped")


class SegmentOut(BaseModel):
    id: int = Field(description="Kepler quarter, or gap-based segment id for uploads")
    t_start: float
    t_end: float
    n_cadences: int
    n_used: int = Field(description="Cadences kept after cleaning/detrending")


class SourceOut(BaseModel):
    type: Literal["catalog", "upload"]
    kepid: int | None = None
    upload_id: str | None = None
    upload_kind: str | None = None
    input_name: str
    time_system: str
    n_cadences: int


class LightCurveOut(BaseModel):
    """Processed light curve for display (catalogue star or parsed upload)."""

    source: SourceOut
    kepid: int | None = None
    upload_id: str | None = None
    signal_id: int | None = None
    time_system: TimeSystem
    mission: str
    n_cadences: int = Field(description="Cadences in the stored light curve (before cleaning)")
    n_points_final: int = Field(description="Cadences after cleaning, detrending and clipping")
    quarters: list[int]
    segments: list[SegmentOut]
    cleaning: dict[str, Any] = Field(description="clean/detrend/clip reports from the pipeline")
    stages: StagesOut
    transit_times: list[float | None] | None = Field(
        None, description="Predicted transit centres inside the data span (when an ephemeris is known)"
    )
    folded: FoldedOut | None = None
    ephemeris: EphemerisOut | None = None
    quality: QualityOut | None = Field(None, description="Only when a catalogue signal is given")
    detrend: str
    max_points: int
    pipeline_version: str
    config: dict[str, Any]
    warnings: list[str] = []
    processing_ms: float
    cached: bool = False


class ViewsOut(BaseModel):
    """AstroNet-style model inputs (baseline ~0, transit minimum ~-1); phases in days."""

    model_config = ConfigDict(populate_by_name=True)

    global_: list[float | None] = Field(alias="global", description="Global view (2001 bins)")
    local: list[float | None] = Field(description="Local view (201 bins, +/-2 T14)")
    global_phase: list[float | None]
    local_phase: list[float | None]
