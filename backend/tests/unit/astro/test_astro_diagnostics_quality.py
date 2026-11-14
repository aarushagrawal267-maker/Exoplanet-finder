"""Vetting diagnostics, quality issue codes/grades and physical features."""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from exofinder.astro.diagnostics import (
    compute_diagnostics,
    count_transits,
    individual_transits,
    odd_even,
    secondary_eclipse,
    snr,
)
from exofinder.astro.features import FEATURE_NAMES, physical_features
from exofinder.astro.fold import phase_fold
from exofinder.astro.inject import inject_transit
from exofinder.astro.quality import assess_quality
from exofinder.astro.types import Ephemeris, LightCurve
from exofinder.astro.views import make_views

CADENCE = 0.02043359821692
P, E, DUR_H = 3.0, 100.5, 3.0
EPH = Ephemeris(period_days=P, epoch=E, duration_hours=DUR_H)


def _flat(noise_ppm: float = 100.0, span: float = 90.0, seed: int = 0) -> LightCurve:
    """Flattened (baseline 1) synthetic light curve with white noise only."""
    rng = np.random.default_rng(seed)
    t = np.arange(100.0, 100.0 + span, CADENCE)
    return LightCurve(t, 1.0 + noise_ppm * 1e-6 * rng.standard_normal(t.size), meta={"synthetic": True})


@pytest.fixture(scope="module")
def planet() -> LightCurve:
    return inject_transit(_flat(), P, E, DUR_H, 1000.0, exposure_days=CADENCE)


@pytest.fixture(scope="module")
def binary() -> LightCurve:
    """Eclipsing binary seen at half its period: alternating 3000/1500 ppm eclipses + 600 ppm secondary."""
    lc = inject_transit(_flat(seed=1), 2 * P, E, DUR_H, 3000.0, ingress_fraction=0.5)
    lc = inject_transit(lc, 2 * P, E + P, DUR_H, 1500.0, ingress_fraction=0.5)
    return lc


def test_count_transits_with_gap():
    t = np.arange(100.0, 130.0, CADENCE)
    expected, observed = count_transits(t, EPH)
    assert expected == 10 and observed == 10  # centres at 100.5, 103.5, ..., 127.5
    t_gap = t[~((t > 109.4) & (t < 109.6))]  # removes the transit at 109.5
    t_half = t_gap[~((t_gap > 112.5) & (t_gap < 112.54))]  # removes ~1/3 of the 112.5 transit
    t_most = t_half[~((t_half > 115.43) & (t_half < 115.6))]  # removes ~77% of the 115.5 transit
    assert count_transits(t_most, EPH) == (10, 8)


def test_snr_odd_even_secondary_for_planet(planet):
    s = snr(planet, EPH)
    assert s["depth_ppm"] == pytest.approx(1000.0, rel=0.05)
    assert s["n_transits"] == 30
    expected_snr = 1000.0 / (100.0 / np.sqrt(DUR_H / 24 / CADENCE)) * np.sqrt(30)
    assert s["snr"] == pytest.approx(expected_snr, rel=0.15)
    oe = odd_even(planet, EPH)
    assert oe["diff_sigma"] < 3.0
    assert oe["depth_odd_ppm"] == pytest.approx(oe["depth_even_ppm"], rel=0.05)
    sec = secondary_eclipse(planet, EPH)
    assert sec["significance_sigma"] < 4.0
    assert abs(sec["phase"] - 0.5) <= DUR_H / 24 / P + 1e-9


def test_odd_even_and_secondary_flag_binaries(binary):
    oe = odd_even(binary, EPH)
    assert oe["depth_even_ppm"] == pytest.approx(3000 * 0.75, rel=0.1)  # V-shaped: core mean = 3/4 depth
    assert oe["depth_odd_ppm"] == pytest.approx(1500 * 0.75, rel=0.1)
    assert oe["diff_sigma"] > 20
    eb = inject_transit(_flat(seed=2), P, E + P / 2, DUR_H, 600.0)  # occultation at phase 0.5
    eb = inject_transit(eb, P, E, DUR_H, 5000.0)
    sec = secondary_eclipse(eb, EPH)
    assert sec["significance_sigma"] > 10
    assert sec["phase"] == pytest.approx(0.5, abs=0.01)
    assert sec["depth_ppm"] == pytest.approx(600.0, rel=0.2)


def test_individual_transits(planet):
    events = individual_transits(planet, EPH)
    assert len(events) == 30
    assert [ev["index"] for ev in events] == list(range(30))
    for ev in events:
        assert ev["covered"] and ev["n_points"] >= 5
        assert ev["epoch"] == pytest.approx(E + ev["index"] * P)
        assert abs(ev["depth_ppm"] - 1000.0) < 5 * ev["err_ppm"]
    few = individual_transits(planet, EPH, max_events=5)
    assert [ev["index"] for ev in few] == [0, 7, 14, 22, 29]  # evenly spread over the baseline
    partial = planet.select(~((planet.time > E + 3 * P - 0.03) & (planet.time < E + 3 * P + 0.2)))
    ev3 = next(ev for ev in individual_transits(partial, EPH) if ev["index"] == 3)
    assert ev3["covered"] is False and ev3["coverage"] < 0.5


# --------------------------------------------------------------------------------------------------
def test_quality_good_signal(planet):
    views = make_views(planet, EPH)
    q = assess_quality(planet, EPH, views, catalogue_depth_ppm=1000.0)
    assert q.ok and q.grade == "A" and q.issues == []
    assert q.n_transits_observed == q.n_transits_expected == 30
    assert q.alignment_offset_durations < 0.05
    assert q.depth_ratio_vs_catalogue == pytest.approx(1.0, abs=0.05)
    assert q.in_transit_points > 100


def test_quality_issue_codes(planet):
    views = make_views(planet, EPH)
    # depth mismatch is not blocking
    q = assess_quality(planet, EPH, views, catalogue_depth_ppm=10000.0)
    assert q.issues == ["depth_mismatch"] and q.ok and q.grade == "C"
    # misaligned: epoch off by 1.5 transit durations
    shifted = dataclasses.replace(EPH, epoch=E + 1.5 * DUR_H / 24)
    q = assess_quality(planet, shifted, make_views(planet, shifted))
    assert "misaligned" in q.issues and q.grade in ("C", "D")
    # sparse / NaN views (constructed directly to exercise each code)
    q = assess_quality(planet, EPH, dataclasses.replace(views, local_empty_frac=0.4, global_empty_frac=0.6))
    assert {"local_view_sparse", "global_view_sparse"} <= set(q.issues) and not q.ok and q.grade == "D"
    bad = views.local_view.copy()
    bad[5] = np.nan
    q = assess_quality(planet, EPH, dataclasses.replace(views, local_view=bad))
    assert "nan_in_views" in q.issues and not q.ok
    assert len(q.messages) == len(q.issues)


def test_quality_too_few_transits_and_no_signal():
    lc = inject_transit(_flat(span=30.0), 25.0, 110.0, 6.0, 2000.0)
    eph = Ephemeris(period_days=25.0, epoch=110.0, duration_hours=6.0)
    q = assess_quality(lc, eph, make_views(lc, eph))
    assert {"too_few_transits", "period_too_long"} <= set(q.issues)
    assert not q.ok and q.grade == "D" and q.n_transits_observed == 1
    noise = _flat(seed=7)
    q = assess_quality(noise, EPH, make_views(noise, EPH))
    assert "no_transit_signal" in q.issues and q.grade in ("C", "D")


# --------------------------------------------------------------------------------------------------
def test_physical_features_planet_vs_binary(planet, binary):
    fp = physical_features(planet, EPH, make_views(planet, EPH))
    fb = physical_features(binary, EPH, make_views(binary, EPH))
    for f in (fp, fb):
        assert list(f) == list(FEATURE_NAMES)
        assert all(isinstance(v, float) and np.isfinite(v) for v in f.values())
    assert fp["depth_ppm"] == pytest.approx(1000.0, rel=0.05)
    assert fp["log_depth"] == pytest.approx(np.log10(fp["depth_ppm"]))
    assert fp["duration_hours"] == DUR_H and fp["duration_over_period"] == pytest.approx(DUR_H / 24 / P)
    assert fp["log_period"] == pytest.approx(np.log10(P))
    assert fp["n_transits_observed"] == 30 and fp["snr"] > 50
    assert fp["oot_scatter_ppm"] == pytest.approx(100.0, rel=0.1)
    assert 0.0 < fp["shape_ratio"] < 0.2 and fb["shape_ratio"] > 0.3  # box-like vs V-shaped
    assert 0.8 < fp["local_view_min_width"] < 1.1 and fb["local_view_min_width"] < fp["local_view_min_width"]
    assert fp["odd_even_sigma"] < 3 < fb["odd_even_sigma"]
    assert fp["local_asymmetry"] < 0.2
    assert fp["global_secondary_min"] > -0.3


def test_physical_features_nan_free_without_signal():
    lc = _flat(span=20.0)
    eph = Ephemeris(period_days=60.0, epoch=150.0, duration_hours=5.0)  # no data near any transit
    f = physical_features(lc, eph, make_views(lc, eph))
    assert list(f) == list(FEATURE_NAMES)
    assert all(np.isfinite(v) for v in f.values())
    assert f["depth_ppm"] == 0.0 and f["snr"] == 0.0 and f["n_transits_observed"] == 0.0


def test_compute_diagnostics_bundle(planet):
    d = compute_diagnostics(planet, EPH, exposure_days=CADENCE)
    assert set(d) == {
        "snr",
        "odd_even",
        "secondary",
        "individual_transits",
        "transit_count",
        "noise",
        "transit_fit",
    }
    assert d["transit_fit"]["depth_ppm"] == pytest.approx(1000.0, rel=0.05)
    assert d["noise"]["red_noise_beta"] == pytest.approx(1.0, abs=0.15)
    ph = phase_fold(planet.time, P, E)
    assert d["transit_count"] == {"expected": 30, "observed": 30} and np.any(np.abs(ph) < 0.01)
