"""Detrending (transit preservation, masking, BIC knots, segments) and AstroNet views."""

from __future__ import annotations

import numpy as np
import pytest

from exofinder.astro._utils import mad_std
from exofinder.astro.cleaning import clean
from exofinder.astro.detrend import detrend
from exofinder.astro.diagnostics import snr
from exofinder.astro.fold import phase_fold
from exofinder.astro.inject import inject_transit
from exofinder.astro.normalize import normalize_segments
from exofinder.astro.types import Ephemeris, LightCurve
from exofinder.astro.views import global_view, local_view, make_views, normalize_view

INJ_DEPTH = 1000.0


def _prepared(lc: LightCurve) -> LightCurve:
    cleaned, _ = clean(lc)
    return normalize_segments(cleaned)


def _depth(lc: LightCurve, eph: Ephemeris | None, method: str, measure_eph: Ephemeris) -> float:
    flat, _, _ = detrend(_prepared(lc), eph, method)
    return snr(flat, measure_eph)["depth_ppm"]


@pytest.mark.parametrize("method", ["spline", "savgol"])
@pytest.mark.parametrize("seed", [0, 1, 2])
def test_detrend_preserves_injected_depth(synthetic_lc, method, seed):
    """Injected 1000 ppm, 5 h transits on a spotted star (0.5% / 6 d modulation, drifts, gaps)."""
    raw = synthetic_lc(seed=seed, var_amp=0.005, var_period=6.0, noise_ppm=100.0)
    eph = Ephemeris(period_days=4.1234, epoch=133.0, duration_hours=5.0)
    injected = inject_transit(raw, eph.period_days, eph.epoch, eph.duration_hours, INJ_DEPTH)
    d_inj = _depth(injected, eph, method, eph)
    d_none = _depth(raw, eph, method, eph)  # same star, same noise, no transit
    # the measured depth (incl. this noise realisation) is within 10% of the truth ...
    assert d_inj == pytest.approx(INJ_DEPTH, rel=0.10)
    # ... and the detrending itself does not alter the transit: the difference is the injected depth
    assert d_inj - d_none == pytest.approx(INJ_DEPTH, rel=0.02)


def test_masking_protects_long_transits(synthetic_lc):
    raw = synthetic_lc(seed=1, var_amp=0.004, var_period=9.0, noise_ppm=100.0)
    eph = Ephemeris(period_days=4.1234, epoch=133.0, duration_hours=10.0)
    injected = inject_transit(raw, eph.period_days, eph.epoch, eph.duration_hours, INJ_DEPTH)
    masked = _depth(injected, eph, "spline", eph) - _depth(raw, eph, "spline", eph)
    unmasked = _depth(injected, None, "spline", eph) - _depth(raw, None, "spline", eph)
    assert masked == pytest.approx(INJ_DEPTH, rel=0.01)
    assert unmasked < 0.97 * INJ_DEPTH  # an unmasked spline partially follows the 10-hour dip


def test_detrend_report_and_trend_quality(synthetic_lc):
    raw = synthetic_lc(seed=4, var_amp=0.004, var_period=9.0, noise_ppm=150.0)
    eph = Ephemeris(period_days=3.3, epoch=132.0, duration_hours=4.0)
    lc = _prepared(inject_transit(raw, eph.period_days, eph.epoch, eph.duration_hours, 500.0))
    flat, trend, rep = detrend(lc, eph)
    assert trend.shape == lc.flux.shape and np.isfinite(trend).all()
    assert flat.meta["detrended"] is True and flat.meta["synthetic"] is True
    np.testing.assert_array_equal(flat.time, lc.time)
    assert flat.time.dtype == np.float64
    phase = phase_fold(lc.time, eph.period_days, eph.epoch)
    assert rep["transit_masked"] is True
    assert rep["n_masked_in_transit"] == int(np.sum(np.abs(phase) < 0.75 * eph.duration_days))
    # knot spacing floor: max(0.5 d, 3 x T14), chosen by BIC within the grid
    assert rep["knot_spacing_days"] >= max(0.5, 3 * eph.duration_days) - 1e-12
    assert rep["knot_spacing_days"] in rep["knot_spacing_grid"]
    assert len(rep["bic"]) == len(rep["knot_spacing_grid"]) == 20
    # chunks: 2 quarters, each split by two ~1-day downlink gaps (random sub-0.75-d gaps do not split)
    assert rep["n_chunks"] >= 6
    oot = np.abs(phase) > eph.duration_days
    resid = flat.flux[oot] - 1.0
    assert abs(np.median(resid)) < 2e-5
    # 0.4% variability removed down to ~the 150 ppm white noise (robust scatter: spikes are not clipped yet)
    assert mad_std(resid) < 1.15 * 150e-6


def test_detrend_segments_and_validation():
    rng = np.random.default_rng(0)
    t = np.concatenate([np.arange(0, 20, 0.02), np.arange(20.5, 40, 0.02)])
    seg = np.where(t < 20.2, 1, 2)
    f = np.where(seg == 1, 1.0, 1.02) + 1e-4 * rng.standard_normal(t.size)  # flux step between segments
    flat, _, rep = detrend(LightCurve(t, f, segment=seg))
    for s in (1, 2):
        assert np.median(flat.flux[seg == s]) == pytest.approx(1.0, abs=2e-5)
    assert rep["n_chunks"] == 2 and rep["transit_masked"] is False
    with pytest.raises(TypeError):
        detrend(LightCurve(t, f), bogus_option=1)
    with pytest.raises(ValueError):
        detrend(LightCurve(t, f), method="median")
    _, _, rep_fixed = detrend(LightCurve(t, f, segment=seg), knot_spacing_days=2.0)
    assert rep_fixed["knot_spacing_grid"] == [2.0]


# --------------------------------------------------------------------------------------------------
def _box_lc(period=3.0, epoch=0.7, dur_h=3.0, depth=1e-3, noise=5e-5, span=60.0, seed=0) -> LightCurve:
    rng = np.random.default_rng(seed)
    t = np.arange(0.0, span, 0.0204)
    f = 1.0 + noise * rng.standard_normal(t.size)
    f[np.abs(phase_fold(t, period, epoch)) < dur_h / 48.0] -= depth
    return LightCurve(t, f, meta={"synthetic": True})


def test_view_shapes_normalisation_and_centering():
    eph = Ephemeris(period_days=3.0, epoch=0.7, duration_hours=3.0)
    lc = _box_lc()
    views = make_views(lc, eph)
    assert views.global_view.shape == (2001,) and views.local_view.shape == (201,)
    assert views.global_view.dtype == np.float32 and views.local_view.dtype == np.float32
    for v in (views.global_view, views.local_view):
        assert np.median(v) == pytest.approx(0.0, abs=1e-6)
        assert v.min() == pytest.approx(-1.0, abs=1e-6)
    # the flat-bottomed dip (bins below half depth) is centred on the middle bin
    assert np.mean(np.nonzero(views.local_view < -0.5)[0]) == pytest.approx(100, abs=2)
    assert np.mean(np.nonzero(views.global_view < -0.5)[0]) == pytest.approx(1000, abs=2)
    # dip width ~ T14: the local view has 50 bins per T14 (4 T14 / 200), the global view 2001 * T14 / P
    assert 46 <= np.sum(views.local_view < -0.5) <= 56
    assert abs(np.sum(views.global_view < -0.5) - 2001 * 0.125 / 3.0) <= 4
    assert views.raw_depth == pytest.approx(1e-3, rel=0.05)
    assert views.global_empty_frac == 0.0 and views.local_empty_frac == 0.0
    # bin centres: symmetric, middle bin at phase 0, local view spans +/-2 durations
    gp, lp = views.global_phase, views.local_phase
    assert gp[1000] == pytest.approx(0.0, abs=1e-12) and gp[0] == pytest.approx(-gp[-1])
    assert gp[0] > -1.5 and gp[-1] < 1.5
    d = eph.duration_days
    assert lp[100] == pytest.approx(0.0, abs=1e-12)
    assert lp[0] == pytest.approx(-2 * d + 0.08 * d) and lp[-1] == pytest.approx(2 * d - 0.08 * d)


def test_views_empty_bins_are_interpolated():
    p, e = 3.0, 0.7
    lc = _box_lc(period=p, epoch=e)
    phase = phase_fold(lc.time, p, e)
    keep = ~((phase > 0.6) & (phase < 0.9))  # a 0.3-day hole = 10% of the orbit
    g, centres, empty = global_view(lc.time[keep], lc.flux[keep], p, e)
    assert empty == pytest.approx(0.1, abs=0.003)
    assert np.isfinite(g).all()
    hole = (centres > 0.62) & (centres < 0.88)
    left = g[np.searchsorted(centres, 0.6) - 1]
    right = g[np.searchsorted(centres, 0.9)]
    assert np.all(g[hole] >= min(left, right) - 1e-12) and np.all(g[hole] <= max(left, right) + 1e-12)
    # local view: remove the first half of the transit window from the data
    keep2 = ~((phase > -0.25) & (phase < -0.05))
    loc, _, lempty = local_view(lc.time[keep2], lc.flux[keep2], p, e, 0.125)
    assert 0.3 < lempty < 0.7 and np.isfinite(loc).all()


def test_views_all_empty_and_normalize_guard():
    t = np.arange(0.0, 10.0, 0.02)
    f = np.ones_like(t)
    loc, _, empty = local_view(t, f, period=100.0, epoch=50.0, duration_days=0.2)
    assert empty == 1.0 and np.isnan(loc).all()
    flat = normalize_view(np.ones(201))
    assert np.all(flat == 0.0)  # no division by zero
    v = normalize_view(np.array([1.0, 1.0, 0.5, 1.0, 1.0]))
    np.testing.assert_allclose(v, [0, 0, -1, 0, 0])
    assert np.isnan(normalize_view(np.full(5, np.nan))).all()


@pytest.mark.parametrize(
    "option", ["min_knot_spacing_days", "max_knot_spacing_days", "knot_spacing_days", "window_days"]
)
def test_detrend_rejects_non_positive_spacings(option):
    """A zero knot spacing used to raise ZeroDivisionError deep inside the knot placement."""
    t = np.arange(0.0, 10.0, 0.02)
    lc = LightCurve(t, 1.0 + 1e-4 * np.sin(t), meta={"synthetic": True})
    for value in (0.0, -1.0, float("nan")):
        with pytest.raises(ValueError, match=option):
            detrend(lc, **{option: value})
