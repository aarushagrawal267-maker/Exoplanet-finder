"""End-to-end pipeline: synthetic injection-recovery, stages, configuration and errors."""

from __future__ import annotations

import numpy as np
import pytest

from exofinder.astro.bls import bls_ephemeris, run_bls
from exofinder.astro.errors import InsufficientDataError
from exofinder.astro.features import FEATURE_NAMES
from exofinder.astro.inject import inject_transit
from exofinder.astro.pipeline import PipelineConfig, preprocess_for_display, process_lightcurve
from exofinder.astro.types import Ephemeris, LightCurve, ProcessedSignal
from exofinder.config import PIPELINE_VERSION

CADENCE = 0.02043359821692


@pytest.mark.parametrize("seed", [10, 12])
def test_injection_recovery_end_to_end(synthetic_lc, seed):
    """Realistic noise, spot modulation, drifts, gaps, flags and spikes; blind BLS then full pipeline."""
    true = {"period": 3.5267, "epoch": 133.234, "duration_hours": 2.8, "depth_ppm": 1200.0}
    raw = synthetic_lc(seed=seed, noise_ppm=250.0)
    lc = inject_transit(
        raw, true["period"], true["epoch"], true["duration_hours"], true["depth_ppm"], exposure_days=CADENCE
    )
    found = run_bls(preprocess_for_display(lc)["flat"])
    eph = bls_ephemeris(found)
    ps = process_lightcurve(lc, eph)
    fit = ps.stages["diagnostics"]["transit_fit"]
    # period error accumulated over the baseline stays below T14/4 (a fixed rel=1e-3 would allow ~T14)
    assert abs(eph.period_days - true["period"]) * found["baseline_days"] / true["period"] < 0.25 * (
        true["duration_hours"] / 24.0
    )
    dt = (fit["epoch"] - true["epoch"] + true["period"] / 2) % true["period"] - true["period"] / 2
    assert abs(dt) * 24 < 0.1 * true["duration_hours"]
    assert fit["depth_ppm"] == pytest.approx(true["depth_ppm"], rel=0.10)
    assert fit["duration_hours"] == pytest.approx(true["duration_hours"], rel=0.15)
    assert ps.features["depth_ppm"] == pytest.approx(true["depth_ppm"], rel=0.10)
    assert ps.quality.ok and ps.quality.grade in ("A", "B")
    assert ps.flat is not None and ps.flat.meta["synthetic"] is True


def test_processed_signal_structure_and_stages(synthetic_lc):
    raw = inject_transit(synthetic_lc(seed=3), 2.9, 132.4, 3.0, 800.0)
    eph = Ephemeris(period_days=2.9, epoch=132.4, duration_hours=3.0, depth_ppm=800.0)
    cfg = PipelineConfig(max_stage_points=1000)
    ps = process_lightcurve(raw, eph, cfg, catalogue_depth_ppm=800.0)
    assert isinstance(ps, ProcessedSignal)
    assert ps.pipeline_version == PIPELINE_VERSION and ps.config == cfg.to_dict()
    assert ps.views.global_view.shape == (2001,) and ps.views.local_view.shape == (201,)
    assert ps.views.global_view.dtype == np.float32
    assert list(ps.features) == list(FEATURE_NAMES)
    assert ps.quality.depth_ratio_vs_catalogue == pytest.approx(1.0, abs=0.15)
    for name in ("raw", "normalized", "trend", "flat"):
        st = ps.stages[name]
        assert set(st) == {"time", "flux", "n_original"}
        assert st["time"].size == st["flux"].size <= 1000 and st["n_original"] > 1000
        assert np.all(np.diff(st["time"]) > 0)
    folded = ps.stages["folded"]
    assert folded["phase"].min() >= -1.45 and folded["phase"].max() < 1.45
    rep = ps.stages["reports"]
    assert rep["clean"]["n_quality_flagged"] > 0 and rep["n_upper_outliers_clipped"] > 0
    assert rep["detrend"]["transit_masked"] is True and rep["segments"] == [1, 2]
    assert len(ps.stages["diagnostics"]["individual_transits"]) == 40
    # the flattened curve has a baseline of 1 and no non-finite values
    assert np.isfinite(ps.flat.flux).all() and np.median(ps.flat.flux) == pytest.approx(1.0, abs=1e-4)


def test_pipeline_config_options(synthetic_lc):
    raw = inject_transit(synthetic_lc(seed=5), 3.1, 133.0, 3.0, 900.0)
    eph = Ephemeris(period_days=3.1, epoch=133.0, duration_hours=3.0)
    lean = process_lightcurve(raw, eph, PipelineConfig(keep_stages=False, detrend_method="savgol"))
    assert set(lean.stages) == {"reports", "diagnostics"}
    assert lean.stages["reports"]["detrend"]["method"] == "savgol"
    other = Ephemeris(period_days=7.3, epoch=135.0, duration_hours=4.0)
    ps = process_lightcurve(raw, eph, PipelineConfig(keep_stages=False), other_ephemerides=[other])
    assert ps.stages["reports"]["detrend"]["n_excluded_extra"] > 0
    cfg = PipelineConfig(sigma_clip=4.0, knot_spacing_days=1.5)
    assert PipelineConfig.from_dict(cfg.to_dict()) == cfg
    with pytest.raises(TypeError, match="bogus"):
        PipelineConfig.from_dict({"bogus": 1})


def test_preprocess_for_display_without_ephemeris(synthetic_lc):
    out = preprocess_for_display(synthetic_lc(seed=6))
    assert set(out) == {"flat", "trend", "stages", "reports", "pipeline_version", "config"}
    assert "folded" not in out["stages"] and out["reports"]["detrend"]["transit_masked"] is False
    assert isinstance(out["flat"], LightCurve) and np.isfinite(out["flat"].flux).all()
    with_eph = preprocess_for_display(synthetic_lc(seed=6), Ephemeris(3.0, 133.0, 3.0))
    assert "folded" in with_eph["stages"]


def test_pipeline_errors():
    t = np.arange(0.0, 0.5, 0.02)
    with pytest.raises(InsufficientDataError):
        process_lightcurve(LightCurve(t, np.ones_like(t)), Ephemeris(1.0, 0.2, 2.0))
    t = np.arange(0.0, 30.0, 0.02)
    lc = LightCurve(t, np.ones_like(t))
    with pytest.raises(ValueError, match="period"):
        process_lightcurve(lc, Ephemeris(-1.0, 0.2, 2.0))
    with pytest.raises(ValueError, match="shorter than the orbital period"):
        process_lightcurve(lc, Ephemeris(0.05, 0.2, 2.0))


def test_constant_flux_is_refused():
    """A constant series has no noise; diagnostics on it would only measure floating-point round-off."""
    t = np.arange(100.0, 190.0, CADENCE)
    const = LightCurve(t, np.full(t.size, 1234.5), segment=np.where(t < 145, 1, 2), meta={"synthetic": True})
    eph = Ephemeris(period_days=3.0, epoch=101.0, duration_hours=3.0)
    with pytest.raises(InsufficientDataError, match="constant"):
        process_lightcurve(const, eph)
    with pytest.raises(InsufficientDataError, match="constant"):
        preprocess_for_display(const)
    # per-segment levels differ but each segment is constant: still no information
    steps = LightCurve(
        t, np.where(t < 145, 1000.0, 2000.0), segment=np.where(t < 145, 1, 2), meta={"synthetic": True}
    )
    with pytest.raises(InsufficientDataError, match="constant"):
        process_lightcurve(steps, eph)


@pytest.mark.parametrize(
    "bad",
    [
        {"detrend_method": "median"},
        {"quality_bitmask": "strict"},
        {"max_stage_points": 0},
        {"global_bins": 1},
        {"sigma_clip": 0.0},
        {"gap_days": -1.0},
        {"local_num_durations": float("nan")},
        {"max_individual_transits": -1},
        {"knot_spacing_days": 0.0},
        {"savgol_window_days": -1.0},
    ],
)
def test_pipeline_config_rejects_invalid_values(bad):
    """Invalid settings fail when the config is built (e.g. from stored JSON), not mid-pipeline."""
    with pytest.raises(ValueError):
        PipelineConfig(**bad)
    with pytest.raises(ValueError):
        PipelineConfig.from_dict(bad)


def test_other_ephemerides_are_validated(synthetic_lc):
    raw = synthetic_lc(seed=7)
    eph = Ephemeris(period_days=3.1, epoch=133.0, duration_hours=3.0)
    broken = Ephemeris(period_days=0.1, epoch=133.0, duration_hours=5.0)  # T14 longer than the period
    with pytest.raises(ValueError, match="shorter than the orbital period"):
        process_lightcurve(raw, eph, PipelineConfig(keep_stages=False), other_ephemerides=[broken])
