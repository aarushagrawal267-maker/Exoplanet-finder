"""End-to-end processing of one signal: raw light curve + ephemeris -> views, quality, features.

Steps (each implemented in its own module):

1. :func:`~exofinder.astro.cleaning.clean` - drop NaN/flagged cadences (quality bitmask), sort.
2. :func:`~exofinder.astro.cleaning.assign_segments` - gap-based segments when none are present.
3. :func:`~exofinder.astro.normalize.normalize_segments` - divide each segment by its median.
4. :func:`~exofinder.astro.detrend.detrend` - robust spline (or Savitzky-Golay) trend fitted with the
   in-transit cadences masked, then ``flux / trend``.
5. :func:`~exofinder.astro.outliers.clip_upper` - remove upward outliers only.
6. :func:`~exofinder.astro.views.make_views` - AstroNet global (2001) and local (201) views.
7. :func:`~exofinder.astro.diagnostics.compute_diagnostics`, then
   :func:`~exofinder.astro.quality.assess_quality` and :func:`~exofinder.astro.features.physical_features`.

``ProcessedSignal.stages`` always contains ``reports`` (cleaning, detrending and clipping reports) and
``diagnostics`` (SNR, odd/even, secondary eclipse, individual transits, trapezoid fit, noise). When
``config.keep_stages`` is True it also holds display arrays, each downsampled to at most
``config.max_stage_points`` (20,000) points by bin-averaging: ``raw``, ``normalized``, ``trend``,
``flat`` as ``{"time", "flux", "n_original"}`` (for ``trend``, ``flux`` is the trend model) and
``folded`` as ``{"phase", "flux", "n_original"}`` (phase in days, transit at 0).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import asdict, dataclass, fields
from typing import Any

import numpy as np

from ..config import GLOBAL_VIEW_BINS, LOCAL_VIEW_BINS, LOCAL_VIEW_NUM_DURATIONS, PIPELINE_VERSION
from ._utils import downsample_xy, to_builtin, validate_ephemeris
from .cleaning import DEFAULT_GAP_DAYS, assign_segments, clean, resolve_bitmask
from .detrend import METHODS, detrend
from .diagnostics import compute_diagnostics
from .errors import InsufficientDataError
from .features import physical_features
from .fold import phase_fold
from .normalize import normalize_segments
from .outliers import clip_upper
from .quality import assess_quality
from .transit_mask import combined_transit_mask
from .types import Ephemeris, LightCurve, ProcessedSignal
from .views import make_views

#: Minimum number of cadences left after cleaning for processing to be attempted.
MIN_CLEAN_POINTS = 50
#: Peak-to-peak range (relative flux, after per-segment normalisation) at or below which a light
#: curve is considered constant: 1e-12 = 1e-6 ppm, far below any photometric precision.
CONSTANT_FLUX_TOLERANCE = 1e-12


@dataclass
class PipelineConfig:
    """Processing parameters. ``to_dict()`` is stored with every processed signal and model."""

    quality_bitmask: str | int = "default"
    gap_days: float = DEFAULT_GAP_DAYS
    detrend_method: str = "spline"
    mask_width_factor: float = 1.5
    knot_spacing_days: float | None = None  # fixed spline knot spacing; None = choose by BIC
    min_knot_spacing_days: float = 0.5
    max_knot_spacing_days: float = 20.0
    n_knot_grid: int = 20
    savgol_window_days: float | None = None
    fit_clip_sigma: float = 3.0  # robust clipping inside the trend fit (does not remove data)
    sigma_clip: float = 3.0  # upward outlier removal from the flattened light curve
    global_bins: int = GLOBAL_VIEW_BINS
    local_bins: int = LOCAL_VIEW_BINS
    local_num_durations: float = LOCAL_VIEW_NUM_DURATIONS
    keep_stages: bool = True
    max_stage_points: int = 20000
    max_individual_transits: int = 40

    def __post_init__(self) -> None:
        """Reject invalid settings up front (configs may come from API requests or stored JSON), so
        they fail with a clear ``ValueError`` instead of mid-pipeline (e.g. a zero division)."""
        resolve_bitmask(self.quality_bitmask)
        if self.detrend_method not in METHODS:
            raise ValueError(
                f"detrend_method must be one of {', '.join(METHODS)} (got {self.detrend_method!r})"
            )
        for name in ("gap_days", "mask_width_factor", "fit_clip_sigma", "sigma_clip", "local_num_durations"):
            value = getattr(self, name)
            if not (math.isfinite(value) and value > 0):
                raise ValueError(f"PipelineConfig.{name} must be positive (got {value!r})")
        for name in (
            "min_knot_spacing_days",
            "max_knot_spacing_days",
            "knot_spacing_days",
            "savgol_window_days",
        ):
            value = getattr(self, name)
            if value is not None and not (math.isfinite(value) and value > 0):
                raise ValueError(f"PipelineConfig.{name} must be a positive number of days (got {value!r})")
        for name in ("global_bins", "local_bins", "max_stage_points"):
            if int(getattr(self, name)) < 2:
                raise ValueError(f"PipelineConfig.{name} must be at least 2 (got {getattr(self, name)!r})")
        if int(self.max_individual_transits) < 0:
            raise ValueError("PipelineConfig.max_individual_transits must be >= 0")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> PipelineConfig:
        """Build from a dict; unknown keys raise ``TypeError`` so typos are not silently ignored."""
        data = dict(data or {})
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise TypeError(f"Unknown PipelineConfig field(s): {', '.join(sorted(unknown))}")
        return cls(**data)

    def detrend_kwargs(self) -> dict[str, Any]:
        kw: dict[str, Any] = {
            "gap_days": self.gap_days,
            "mask_width_factor": self.mask_width_factor,
            "clip_sigma": self.fit_clip_sigma,
        }
        if self.detrend_method == "spline":
            kw.update(
                knot_spacing_days=self.knot_spacing_days,
                min_knot_spacing_days=self.min_knot_spacing_days,
                max_knot_spacing_days=self.max_knot_spacing_days,
                n_knot_grid=self.n_knot_grid,
            )
        else:
            kw["window_days"] = self.savgol_window_days
        return kw


def _stage(x: np.ndarray, y: np.ndarray, max_points: int, xname: str = "time") -> dict[str, Any]:
    xs, ys = downsample_xy(x, y, max_points)
    return {xname: xs, "flux": ys, "n_original": int(np.sum(np.isfinite(x) & np.isfinite(y)))}


def _preprocess(
    raw: LightCurve,
    ephemeris: Ephemeris | None,
    cfg: PipelineConfig,
    other_ephemerides: Sequence[Ephemeris] = (),
) -> dict[str, Any]:
    cleaned, clean_report = clean(raw, cfg.quality_bitmask)
    if len(cleaned) < MIN_CLEAN_POINTS:
        raise InsufficientDataError(
            f"Only {len(cleaned)} usable cadences remain after removing NaN and quality-flagged data "
            f"(at least {MIN_CLEAN_POINTS} are needed)."
        )
    segmented = assign_segments(cleaned, cfg.gap_days)
    normalized = normalize_segments(segmented)
    if float(np.ptp(normalized.flux)) <= CONSTANT_FLUX_TOLERANCE:
        # Real photometry always scatters (Kepler's best is ~10 ppm per cadence); a constant series is
        # a placeholder or corrupted export, and every noise-based statistic on it would only measure
        # floating-point round-off (e.g. odd/even "significances" of ~1-2 sigma).
        raise InsufficientDataError(
            "The flux is constant within each segment (no measurable variation), so it cannot be analysed."
        )
    kw = cfg.detrend_kwargs()
    if other_ephemerides:
        kw["exclude_mask"] = combined_transit_mask(normalized.time, other_ephemerides, cfg.mask_width_factor)
    flat, trend, detrend_report = detrend(normalized, ephemeris, cfg.detrend_method, **kw)
    clipped, n_clipped = clip_upper(flat, cfg.sigma_clip)
    finite = np.isfinite(clipped.flux)
    n_nonfinite = int((~finite).sum())
    final = clipped.select(finite) if n_nonfinite else clipped
    if len(final) < MIN_CLEAN_POINTS:
        raise InsufficientDataError(f"Only {len(final)} cadences remain after detrending.")

    reports = {
        "clean": clean_report,
        "detrend": detrend_report,
        "n_upper_outliers_clipped": n_clipped,
        "n_nonfinite_after_detrend": n_nonfinite,
        "n_points_final": len(final),
        "segments": sorted(int(s) for s in np.unique(final.segment)) if final.segment is not None else [],
    }
    stages: dict[str, Any] = {}
    if cfg.keep_stages:
        m = cfg.max_stage_points
        stages["raw"] = _stage(raw.time, raw.flux, m)
        stages["normalized"] = _stage(normalized.time, normalized.flux, m)
        stages["trend"] = _stage(normalized.time, trend, m)
        stages["flat"] = _stage(final.time, final.flux, m)
        if ephemeris is not None:
            phase = phase_fold(final.time, ephemeris.period_days, ephemeris.epoch)
            stages["folded"] = _stage(phase, final.flux, m, xname="phase")
    return {"flat": final, "trend": trend, "normalized": normalized, "reports": reports, "stages": stages}


def process_lightcurve(
    raw: LightCurve,
    ephemeris: Ephemeris,
    config: PipelineConfig | None = None,
    catalogue_depth_ppm: float | None = None,
    other_ephemerides: Sequence[Ephemeris] = (),
) -> ProcessedSignal:
    """Run the full pipeline for one signal (see module docstring).

    ``ephemeris`` must be in the light curve's time system (BKJD for Kepler). ``catalogue_depth_ppm``
    is only used by the quality check (``depth_mismatch``), never as a feature.
    ``other_ephemerides`` (e.g. the other planets of the star) are additionally masked from the trend
    fit; their transits are not removed from the data.

    Raises :class:`InsufficientDataError` if too few cadences survive cleaning, and ``ValueError`` for
    an invalid ephemeris.
    """
    cfg = config or PipelineConfig()
    validate_ephemeris(ephemeris)
    for other in other_ephemerides:
        validate_ephemeris(other)  # e.g. duration >= period would mask every cadence from the trend fit
    pre = _preprocess(raw, ephemeris, cfg, other_ephemerides)
    flat: LightCurve = pre["flat"]
    views = make_views(flat, ephemeris, cfg.global_bins, cfg.local_bins, cfg.local_num_durations)
    exposure = raw.meta.get("cadence_days")
    diag = compute_diagnostics(
        flat,
        ephemeris,
        exposure_days=float(exposure) if exposure else None,
        max_events=cfg.max_individual_transits,
        include_transit_fit=True,
    )
    quality = assess_quality(flat, ephemeris, views, catalogue_depth_ppm, diagnostics=diag)
    features = physical_features(flat, ephemeris, views, diagnostics=diag)
    stages = dict(pre["stages"])
    stages["reports"] = to_builtin(pre["reports"])
    stages["diagnostics"] = to_builtin(diag)
    return ProcessedSignal(
        ephemeris=ephemeris,
        views=views,
        quality=quality,
        features=features,
        flat=flat,
        stages=stages,
        pipeline_version=PIPELINE_VERSION,
        config=cfg.to_dict(),
    )


def preprocess_for_display(
    raw: LightCurve, ephemeris: Ephemeris | None = None, config: PipelineConfig | None = None
) -> dict[str, Any]:
    """Clean, normalise, detrend and clip a light curve without building views (Signal Explorer).

    Without an ephemeris nothing is masked from the trend fit (the robust 3-sigma clipping inside the
    fit still rejects most points of deep transits). Returns ``{"flat": LightCurve, "trend": ndarray,
    "stages": {...}, "reports": {...}, "pipeline_version": str, "config": dict}``; ``stages`` follows the
    same layout as :func:`process_lightcurve` (``folded`` only when an ephemeris is given). The
    ``flat`` light curve can be passed to :func:`exofinder.astro.bls.run_bls`.
    """
    cfg = config or PipelineConfig()
    if ephemeris is not None:
        validate_ephemeris(ephemeris)
    pre = _preprocess(raw, ephemeris, cfg)
    return {
        "flat": pre["flat"],
        "trend": pre["trend"],
        "stages": pre["stages"],
        "reports": to_builtin(pre["reports"]),
        "pipeline_version": PIPELINE_VERSION,
        "config": cfg.to_dict(),
    }


__all__ = [
    "CONSTANT_FLUX_TOLERANCE",
    "MIN_CLEAN_POINTS",
    "PipelineConfig",
    "preprocess_for_display",
    "process_lightcurve",
]
