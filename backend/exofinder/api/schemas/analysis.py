"""Schemas for the analysis tools (``/api/analysis``)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from exofinder.api.schemas.common import Provenance
from exofinder.api.schemas.lightcurves import BinnedSeries, EphemerisOut, FoldedOut, QualityOut, SourceOut


class CatalogSource(BaseModel):
    type: Literal["catalog"] = "catalog"
    kepid: int


class UploadSource(BaseModel):
    type: Literal["upload"] = "upload"
    upload_id: str


AnalysisSource = Annotated[CatalogSource | UploadSource, Field(discriminator="type")]


class PValue(BaseModel):
    """Provenance-tagged value (``ProvenancedValue`` plus an optional note on assumptions)."""

    value: float | None
    err: float | None = None
    unit: str = ""
    provenance: Provenance
    source: str = ""
    note: str | None = None


# ---- BLS ---------------------------------------------------------------------------------------
class BlsIn(BaseModel):
    source: AnalysisSource
    min_period: float | None = Field(None, gt=0, description="days (default 0.5)")
    max_period: float | None = Field(None, gt=0, description="days (default half the baseline)")


class BlsBest(BaseModel):
    period: float
    epoch: float
    duration_hours: float
    depth_ppm: float | None = None
    depth_err_ppm: float | None = None
    snr: float | None = None
    sde: float | None = None
    power: float | None = None
    n_transits: int
    n_transits_expected: int
    provenance: Literal["measured"] = "measured"
    source: str


class BlsPeak(BaseModel):
    rank: int
    period: float
    power: float | None = None
    sde: float | None = Field(None, description="Power above the running median / running scatter")
    refined: bool = Field(description="True for peaks re-searched on a fine grid")
    is_best: bool
    alias_of_best: str | None = Field(
        None, description="e.g. P/2, 2P when the peak is an alias of the best period"
    )


class BlsSearch(BaseModel):
    min_period: float | None = None
    max_period: float | None = None
    baseline_days: float | None = None
    n_periods_searched: int
    frequency_oversample_effective: float | None = None
    bin_minutes: float | None = None
    n_points: int
    objective: str | None = None


class BlsOut(BaseModel):
    source: SourceOut
    provenance: Literal["measured"] = "measured"
    periods: list[float | None] = Field(description="Periodogram periods (downsampled, keeps local maxima)")
    power: list[float | None]
    power_norm: list[float | None] = Field(description="Normalised power (SDE-like) for plotting")
    best: BlsBest
    peaks: list[BlsPeak] = Field(description="Top distinct peaks (<= 5)")
    ephemeris: EphemerisOut = Field(
        description="Best-period ephemeris, ready for transit analysis / predictions"
    )
    search: BlsSearch
    warnings: list[str] = []
    compute_ms: float
    cached: bool = False
    pipeline_version: str


# ---- transit analysis ---------------------------------------------------------------------------
class TransitEphemerisIn(BaseModel):
    period_days: float = Field(gt=0)
    epoch: float
    duration_hours: float = Field(gt=0)
    source: Provenance = Field("manual", description="Where this ephemeris came from")
    label: str | None = None


class TransitIn(BaseModel):
    source: AnalysisSource
    ephemeris: TransitEphemerisIn
    signal_id: int | None = Field(None, description="Catalogue signal for the comparison table")


class ComparisonRow(BaseModel):
    quantity: str
    unit: str
    catalogue: PValue | None = None
    measured: PValue | None = None
    estimate: PValue | None = None


class ModelCurve(BaseModel):
    phase: list[float | None]
    flux: list[float | None]
    model: str


class StellarOut(BaseModel):
    teff: PValue
    radius: PValue
    logg: PValue
    mass: PValue
    kepmag: PValue


class TransitOut(BaseModel):
    source: SourceOut
    signal_id: int | None = None
    ephemeris: EphemerisOut
    fit: dict[str, Any] = Field(
        description="Trapezoid fit: depth_ppm, duration_hours, ingress_hours, epoch, shape_ratio, chi2_red, converged..."
    )
    odd_even: dict[str, Any]
    secondary: dict[str, Any]
    individual_transits: list[dict[str, Any]]
    snr: dict[str, Any]
    transit_count: dict[str, Any]
    noise: dict[str, Any]
    quality: QualityOut
    folded: FoldedOut
    model_curve: ModelCurve | None = None
    comparison: list[ComparisonRow]
    stellar: StellarOut | None = None
    derived: dict[str, PValue] = Field(description="Estimates (never measurements): planet radius, a/R*, ...")
    masked_other_signals: list[EphemerisOut] = []
    warnings: list[str] = []
    pipeline_version: str
    compute_ms: float
    cached: bool = False


# ---- injection-recovery ------------------------------------------------------------------------
class InjectionIn(BaseModel):
    kepid: int
    period_days: float = Field(gt=0)
    depth_ppm: float = Field(gt=0, lt=1e6)
    duration_hours: float = Field(gt=0)
    epoch: float | None = Field(None, description="BKJD; default: data start + 0.37 P")
    ingress_fraction: float = Field(0.1, gt=0, le=0.5)


class InjectedOut(BaseModel):
    period_days: float
    epoch: float
    duration_hours: float
    depth_ppm: float
    ingress_fraction: float
    model: str
    n_transits_in_data: int
    snr_at_injected_ephemeris: float | None = None


class RecoveredOut(BaseModel):
    period_days: float
    epoch: float
    duration_hours: float
    depth_ppm: float | None = None
    depth_err_ppm: float | None = None
    snr: float | None = None
    sde: float | None = None
    n_transits: int
    method: str
    provenance: Literal["measured"] = "measured"


class InjectionCriteria(BaseModel):
    period_rel_tol: float
    epoch_tol_hours: float
    period_match: bool
    epoch_match: bool
    epoch_offset_hours: float
    alias_of_injected: str | None = None
    matches_known_signal: str | None = Field(
        None, description="Set when a failed search locked onto a known signal of the star"
    )
    depth_ratio: float | None = None


class Periodogram(BaseModel):
    periods: list[float | None]
    power: list[float | None]


class InjectionOut(BaseModel):
    synthetic: Literal[True] = True
    label: str
    kepid: int
    injected: InjectedOut
    recovered: RecoveredOut
    recovered_ok: bool
    criteria: InjectionCriteria
    masked_known_signals: list[EphemerisOut]
    warnings: list[str] = []
    n_cadences_masked: int
    periodogram: Periodogram
    folded_injected: BinnedSeries
    pipeline_version: str
    compute_ms: float
