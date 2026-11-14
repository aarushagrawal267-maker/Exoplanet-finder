"""Phase-fold convention, transit masks, upward-only outlier clipping and injection."""

from __future__ import annotations

import numpy as np
import pytest

from exofinder.astro.fold import phase_fold, transit_number
from exofinder.astro.inject import inject_transit
from exofinder.astro.outliers import clip_upper
from exofinder.astro.transit_mask import combined_transit_mask, transit_mask
from exofinder.astro.types import Ephemeris, LightCurve


def test_phase_fold_convention():
    p, e = 3.0, 100.25
    t = np.array([e, e + 0.1, e - 0.1, e + 7 * p, e - 5 * p + 0.2, e + 1.5, e - 1.5, e + 1.4999])
    ph = phase_fold(t, p, e)
    np.testing.assert_allclose(ph[:5], [0.0, 0.1, -0.1, 0.0, 0.2], atol=1e-9)  # days, transit at 0
    assert ph[5] == pytest.approx(-1.5)  # +P/2 wraps to -P/2: range is [-P/2, P/2)
    assert ph[6] == pytest.approx(-1.5)
    assert ph[7] == pytest.approx(1.4999)
    rng = np.random.default_rng(0)
    many = rng.uniform(-1000, 3000, 100000)
    phm = phase_fold(many, p, e)
    assert phm.min() >= -p / 2 and phm.max() < p / 2
    n = transit_number(many, p, e)
    np.testing.assert_allclose(many, e + n * p + phm, atol=1e-9)
    # any transit centre can serve as epoch
    np.testing.assert_allclose(phase_fold(many, p, e + 11 * p), phm, atol=1e-9)
    assert np.isnan(phase_fold(np.array([np.nan]), p, e)[0])
    with pytest.raises(ValueError):
        phase_fold(t, 0.0, e)


def test_transit_mask_convention():
    p, e, d = 5.0, 10.0, 0.2
    t = e + np.array([0.0, 0.149, 0.151, -0.149, -0.151, 0.099, 0.101, p + 0.05])
    m = transit_mask(t, p, e, d)  # width_factor 1.5 -> |phase| < 0.15 d
    assert m.tolist() == [True, True, False, True, False, True, True, True]
    assert transit_mask(t, p, e, d, width_factor=1.0).tolist() == [
        True,
        False,
        False,
        False,
        False,
        True,
        False,
        True,
    ]
    eph2 = Ephemeris(period_days=7.0, epoch=e + 0.15, duration_hours=2.4)
    both = combined_transit_mask(t, [Ephemeris(p, e, d * 24), eph2])
    assert both[2]  # 0.151 d after e is inside the second planet's mask


def test_clip_upper_removes_only_high_points():
    rng = np.random.default_rng(3)
    n = 5000
    f = 1.0 + 1e-4 * rng.standard_normal(n)
    high = rng.choice(n, 25, replace=False)
    rest = np.setdiff1d(np.arange(n), high)
    low = rng.choice(rest, 25, replace=False)
    f[high] += 2e-3
    f[low] -= 5e-3  # transit-like low points must survive
    lc = LightCurve(np.arange(n) * 0.02, f, meta={"synthetic": True})
    out, n_removed = clip_upper(lc, sigma=3.0)
    assert n_removed >= 25
    assert not np.isin(f[high], out.flux).any()
    assert np.isin(f[low], out.flux).all()
    med = np.median(f)
    assert np.all(f[np.isin(f, out.flux, invert=True)] > med)  # every removed point is above the median
    flat_lc = LightCurve(np.arange(10.0), np.ones(10))
    assert clip_upper(flat_lc)[1] == 0


def test_inject_transit_trapezoid_and_metadata():
    t = np.arange(0, 20, 0.01)
    lc = LightCurve(t, np.full(t.size, 2.0), meta={"kepid": 1})
    out = inject_transit(
        lc, period=4.0, epoch=1.0, duration_hours=4.8, depth_ppm=1000.0, ingress_fraction=0.25
    )
    assert out.meta["synthetic"] is True and out.meta["injections"][0]["depth_ppm"] == 1000.0
    assert lc.meta.get("synthetic") is None  # input untouched
    ph = phase_fold(t, 4.0, 1.0)
    rel = out.flux / lc.flux
    np.testing.assert_allclose(rel[np.abs(ph) < 0.05], 1 - 1e-3)  # flat bottom (|ph| < T14/2 - tau)
    np.testing.assert_allclose(rel[np.abs(ph) > 0.1], 1.0)  # out of transit (T14/2 = 0.1 d)
    ingress = (np.abs(ph) > 0.05) & (np.abs(ph) < 0.1)
    assert np.all((rel[ingress] > 1 - 1e-3 - 1e-12) & (rel[ingress] < 1.0 + 1e-12))
    with pytest.raises(ValueError):
        inject_transit(lc, 4.0, 1.0, 200.0, 100.0)


def test_inject_transit_rejects_invalid_epoch_and_exposure():
    """A NaN epoch used to turn every flux value into NaN without any error."""
    t = np.arange(0, 20, 0.01)
    lc = LightCurve(t, np.ones_like(t), meta={"synthetic": True})
    for epoch in (np.nan, np.inf):
        with pytest.raises(ValueError, match="epoch"):
            inject_transit(lc, 4.0, epoch, 3.0, 500.0)
    with pytest.raises(ValueError, match="exposure_days"):
        inject_transit(lc, 4.0, 1.0, 3.0, 500.0, exposure_days=-0.02)
    out = inject_transit(lc, 4.0, 1.0, 3.0, 500.0, exposure_days=0.0)  # zero exposure = instantaneous
    assert np.isfinite(out.flux).all()
