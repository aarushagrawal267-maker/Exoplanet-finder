"""BLS search (recovery, determinism, 4-year speed) and the trapezoid transit fit."""

from __future__ import annotations

import time

import numpy as np
import pytest

from exofinder.astro.bls import MAX_PERIODOGRAM_POINTS, bls_ephemeris, run_bls
from exofinder.astro.errors import InsufficientDataError
from exofinder.astro.fold import phase_fold
from exofinder.astro.inject import inject_transit
from exofinder.astro.pipeline import preprocess_for_display
from exofinder.astro.transit_fit import fit_trapezoid, trapezoid_shape
from exofinder.astro.types import Ephemeris, LightCurve

CADENCE = 0.02043359821692
TRUE = {"period": 3.5267, "epoch": 133.234, "duration_hours": 2.8, "depth_ppm": 1200.0}


def _epoch_offset_days(measured: float, true: float, period: float) -> float:
    return float((measured - true + 0.5 * period) % period - 0.5 * period)


def assert_period_keeps_transits_aligned(res: dict, true_period: float, duration_hours: float) -> None:
    """The period error accumulated over the whole baseline must stay below T14/4.

    A loose relative tolerance (e.g. 1e-3) is not enough: over a 4-year baseline it would allow the
    predicted transit times to drift by ~10 transit durations, smearing the folded transit away.
    """
    n_cycles = res["baseline_days"] / true_period
    drift_days = abs(res["period"] - true_period) * n_cycles
    assert drift_days < 0.25 * duration_hours / 24.0, (res["period"], drift_days * 24.0)


@pytest.fixture(scope="module")
def recovered(synthetic_lc):
    """Two synthetic quarters with an injected transit, flattened without any ephemeris, then BLS."""
    raw = synthetic_lc(seed=11, noise_ppm=250.0)
    lc = inject_transit(
        raw, TRUE["period"], TRUE["epoch"], TRUE["duration_hours"], TRUE["depth_ppm"], exposure_days=CADENCE
    )
    flat = preprocess_for_display(lc)["flat"]
    return flat, run_bls(flat)


def test_bls_recovers_injected_transit(recovered):
    flat, res = recovered
    assert_period_keeps_transits_aligned(res, TRUE["period"], TRUE["duration_hours"])
    duration_days = TRUE["duration_hours"] / 24
    assert abs(_epoch_offset_days(res["epoch"], TRUE["epoch"], TRUE["period"])) < 0.25 * duration_days
    assert res["epoch"] >= flat.time.min() - duration_days  # first transit in the data
    assert 0.6 < res["duration_hours"] / TRUE["duration_hours"] < 1.5
    assert res["depth_ppm"] == pytest.approx(TRUE["depth_ppm"], rel=0.25)  # box depth of a trapezoid
    assert res["snr"] > 20
    assert res["n_transits"] >= 40 and res["n_transits"] <= res["n_transits_expected"]
    periods, power = res["periods"], res["power"]
    assert periods.shape == power.shape and periods.size <= MAX_PERIODOGRAM_POINTS
    assert np.all(np.diff(periods) > 0) and np.isfinite(power).all()
    assert res["power_peak"] >= power.max() * 0.999  # refined peak is at least the coarse maximum
    eph = bls_ephemeris(res)
    assert eph.source == "measured" and eph.label == "BLS" and eph.period_days == res["period"]


def test_bls_is_deterministic(recovered):
    """Identical results on repeated runs and whatever the number of threads."""
    flat, _ = recovered
    one = run_bls(flat, max_period=8.0, n_threads=1)
    many = run_bls(flat, max_period=8.0, n_threads=3)
    for key in ("period", "epoch", "duration_hours", "depth_ppm", "snr", "power_peak", "n_periods_searched"):
        assert one[key] == many[key]
    np.testing.assert_array_equal(one["periods"], many["periods"])
    np.testing.assert_array_equal(one["power"], many["power"])
    assert one["period"] == pytest.approx(TRUE["period"], rel=1e-3)


def test_bls_four_year_curve_is_fast(synthetic_lc):
    """A 17-quarter (~4-year) curve with ~65,000 cadences must be searched well under 30 s."""
    raw = synthetic_lc(seed=21, n_quarters=17, quarter_days=85.0, noise_ppm=200.0, n_random_gaps=2)
    lc = inject_transit(raw, 13.17, 135.3, 3.6, 400.0, exposure_days=CADENCE)
    flat = preprocess_for_display(lc)["flat"]
    assert 60000 <= len(flat) <= 70000
    t0 = time.perf_counter()
    res = run_bls(flat)
    elapsed = time.perf_counter() - t0
    assert elapsed < 30.0, f"BLS took {elapsed:.1f} s"
    assert_period_keeps_transits_aligned(res, 13.17, 3.6)
    assert abs(_epoch_offset_days(res["epoch"], 135.3, 13.17)) < 0.25 * 3.6 / 24
    assert res["max_period"] == pytest.approx(0.5 * res["baseline_days"])
    assert res["n_periods_searched"] <= 40000


def test_bls_rejects_invalid_search_parameters(recovered):
    """Non-positive oversampling used to collapse the grid to 3 periods per chunk without an error."""
    flat, _ = recovered
    for kw in ({"oversample": 0.0}, {"oversample": -3.0}, {"max_periods": 0}, {"max_period": float("nan")}):
        with pytest.raises(ValueError):
            run_bls(flat, **kw)


def test_bls_rejects_short_curves():
    t = np.arange(0, 0.8, 0.02)
    with pytest.raises(InsufficientDataError):
        run_bls(LightCurve(t, np.ones_like(t)))
    t = np.arange(0, 0.9, 0.005)
    rng = np.random.default_rng(0)
    with pytest.raises(InsufficientDataError, match="too short"):
        run_bls(LightCurve(t, 1 + 1e-4 * rng.standard_normal(t.size)), min_period=0.5)


# --------------------------------------------------------------------------------------------------
def test_trapezoid_shape():
    ph = np.array([-1.0, -0.1, -0.075, -0.05, 0.0, 0.05, 0.075, 0.1, 1.0])
    s = trapezoid_shape(ph, duration=0.2, ingress=0.05)
    np.testing.assert_allclose(s, [0, 0, 0.5, 1, 1, 1, 0.5, 0, 0])
    v = trapezoid_shape(ph, duration=0.2, ingress=1.0)  # ingress clipped to T14/2: V shape
    np.testing.assert_allclose(v[[4, 3, 2]], [1.0, 0.5, 0.25])


@pytest.mark.parametrize("ingress_fraction, shape_range", [(0.1, (0.05, 0.15)), (0.5, (0.4, 0.5))])
def test_fit_trapezoid_recovers_parameters(ingress_fraction, shape_range):
    rng = np.random.default_rng(5)
    t = np.arange(100.0, 190.0, CADENCE)
    base = LightCurve(t, 1.0 + 150e-6 * rng.standard_normal(t.size), meta={"synthetic": True})
    p, e, dur_h, depth = 2.75, 101.1, 3.2, 2000.0
    lc = inject_transit(base, p, e, dur_h, depth, ingress_fraction=ingress_fraction, exposure_days=CADENCE)
    guess = Ephemeris(period_days=p, epoch=e + 0.01, duration_hours=dur_h * 1.15)  # slightly off guesses
    fit = fit_trapezoid(lc.time, lc.flux, guess, exposure_days=CADENCE)
    assert fit["converged"]
    assert fit["depth_ppm"] == pytest.approx(depth, rel=0.05)
    assert fit["duration_hours"] == pytest.approx(dur_h, rel=0.05)
    assert abs(fit["epoch"] - e) * 1440 < 5.0  # minutes
    assert shape_range[0] <= fit["shape_ratio"] <= shape_range[1]
    assert 0.8 < fit["chi2_red"] < 1.3
    assert fit["depth_err_ppm"] > 0 and fit["epoch_err"] > 0


def test_fit_trapezoid_too_few_points():
    t = np.arange(0.0, 1.0, 0.1)
    fit = fit_trapezoid(t, np.ones_like(t), Ephemeris(period_days=50.0, epoch=25.0, duration_hours=3.0))
    assert fit["converged"] is False and fit["depth_ppm"] is None and fit["shape_ratio"] is None


def test_injection_uses_bkjd_phase_convention():
    t = np.arange(0.0, 10.0, 0.001)
    lc = inject_transit(LightCurve(t, np.ones_like(t)), 2.0, 0.5, 2.4, 500.0)
    i_min = np.argmin(lc.flux[(t > 2.0) & (t < 3.0)])
    centre = t[(t > 2.0) & (t < 3.0)][i_min]
    assert abs(phase_fold(np.array([centre]), 2.0, 0.5)[0]) < 0.05  # minimum inside the flat bottom
