"""Core data types shared by the astronomy pipeline, the ML engine and the API layer.

These are the module contracts: change them only deliberately (and bump PIPELINE_VERSION if the
numeric output of processing changes).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

import numpy as np

ValueProvenance = Literal["catalogue", "measured", "estimate", "manual"]


@dataclass
class LightCurve:
    """A time series of stellar brightness.

    ``time`` is in days. For Kepler data it is BKJD (BJD - 2454833.0); ``meta['time_system']``
    records which system applies. ``segment`` identifies contiguous observing blocks (Kepler
    quarter number for MAST data; gap-derived ids for uploads).
    """

    time: np.ndarray
    flux: np.ndarray
    flux_err: np.ndarray | None = None
    quality: np.ndarray | None = None
    segment: np.ndarray | None = None
    meta: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.time = np.asarray(self.time, dtype=np.float64)
        self.flux = np.asarray(self.flux, dtype=np.float64)
        n = self.time.shape[0]
        if self.flux.shape[0] != n:
            raise ValueError("time and flux must have the same length")
        if self.flux_err is not None:
            self.flux_err = np.asarray(self.flux_err, dtype=np.float64)
        if self.quality is not None:
            self.quality = np.asarray(self.quality, dtype=np.int64)
        if self.segment is not None:
            self.segment = np.asarray(self.segment, dtype=np.int64)

    def __len__(self) -> int:
        return int(self.time.shape[0])

    def select(self, mask: np.ndarray) -> LightCurve:
        """Return a new LightCurve containing only rows where ``mask`` is True."""
        return LightCurve(
            time=self.time[mask],
            flux=self.flux[mask],
            flux_err=None if self.flux_err is None else self.flux_err[mask],
            quality=None if self.quality is None else self.quality[mask],
            segment=None if self.segment is None else self.segment[mask],
            meta=dict(self.meta),
        )

    def copy(self) -> LightCurve:
        return self.select(np.ones(len(self), dtype=bool))


@dataclass
class Ephemeris:
    """Orbital ephemeris of a transit-like signal (same time system as the light curve)."""

    period_days: float
    epoch: float  # time of a transit centre
    duration_hours: float
    depth_ppm: float | None = None
    source: ValueProvenance = "catalogue"
    label: str = ""  # e.g. "DR24 TCE", "BLS", "Manual"

    @property
    def duration_days(self) -> float:
        return self.duration_hours / 24.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Views:
    """AstroNet-style model inputs. Both views: baseline ~0, transit minimum normalised to -1."""

    global_view: np.ndarray  # shape (GLOBAL_VIEW_BINS,), float32
    local_view: np.ndarray  # shape (LOCAL_VIEW_BINS,), float32
    global_empty_frac: float = 0.0  # fraction of bins with no data before interpolation
    local_empty_frac: float = 0.0
    raw_depth: float | None = None  # depth (fraction) before view normalisation
    global_phase: np.ndarray | None = None  # bin centres in days (for plotting)
    local_phase: np.ndarray | None = None


@dataclass
class QualityReport:
    """Signal-level data-quality assessment. ``ok`` False means: do not train on / trust this signal."""

    ok: bool
    grade: Literal["A", "B", "C", "D"]
    n_transits_expected: int = 0
    n_transits_observed: int = 0
    in_transit_points: int = 0
    global_empty_frac: float = 0.0
    local_empty_frac: float = 0.0
    alignment_offset_durations: float | None = None  # |phase of minimum| / duration
    depth_ratio_vs_catalogue: float | None = None  # measured depth / catalogue depth
    issues: list[str] = field(default_factory=list)  # machine-readable reason codes
    messages: list[str] = field(default_factory=list)  # human-readable explanations

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProcessedSignal:
    """Everything produced by running one signal through the pipeline.

    ``stages`` holds arrays for visualisation (raw, cleaned, trend, flattened) and is optional so
    that bulk dataset building can skip storing them.
    """

    ephemeris: Ephemeris
    views: Views
    quality: QualityReport
    features: dict[str, float]  # physical features computed from the light curve only
    flat: LightCurve | None = None  # detrended, normalised light curve (baseline 1.0)
    stages: dict[str, Any] = field(default_factory=dict)
    pipeline_version: str = ""
    config: dict[str, Any] = field(default_factory=dict)
