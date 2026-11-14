"""Tier selection: whole stars, class balance, reserved showcase systems, determinism.

The Signal rows inserted here are SYNTHETIC TEST ROWS (invented kepids/ephemerides), only used to
exercise the selection logic.
"""

from __future__ import annotations

import numpy as np
import pytest

from exofinder.data.labels import label_for
from exofinder.data.tiers import (
    RESERVED_SHOWCASE_KEPIDS,
    StarCounts,
    plan_tier_stars,
    select_signals_for_tier,
)
from exofinder.db.models import Signal, Target


def test_reserved_showcase_ids_verified_against_archive():
    # keplernames (NASA Exoplanet Archive), checked 2026-11-14
    assert RESERVED_SHOWCASE_KEPIDS == {
        11442793: "Kepler-90",
        4852528: "Kepler-80",
        6541920: "Kepler-11",
        8120608: "Kepler-186",
        8311864: "Kepler-452",
    }


class TestPlan:
    def _stars(self, n=400, seed=0):
        rng = np.random.default_rng(seed)
        out = []
        for k in range(1, n + 1):
            # skewed: ~20 % of stars planet-majority, multi-signal stars common
            n_pos = int(rng.random() < 0.2) * int(rng.integers(1, 4))
            n_neg = int(rng.integers(0, 3)) if n_pos == 0 else int(rng.integers(0, 2))
            if n_pos + n_neg == 0:
                n_neg = 1
            out.append(StarCounts(k, n_pos, n_neg))
        return out

    def test_balanced_and_near_target(self):
        plan = plan_tier_stars(self._stars(), target=150, seed=1)
        assert 150 <= plan.n_pos + plan.n_neg <= 150 + 4
        assert abs(plan.n_pos - plan.n_neg) <= 4
        assert len(set(plan.kepids)) == len(plan.kepids)

    def test_deterministic_and_seed_dependent(self):
        stars = self._stars()
        a = plan_tier_stars(stars, 100, seed=7)
        b = plan_tier_stars(list(reversed(stars)), 100, seed=7)  # input order must not matter
        c = plan_tier_stars(stars, 100, seed=8)
        assert a.kepids == b.kepids and a.kepids != c.kepids

    def test_full_takes_everything(self):
        stars = self._stars()
        plan = plan_tier_stars(stars, None)
        assert sorted(plan.kepids) == sorted(s.kepid for s in stars)
        assert plan.n_pos == sum(s.n_pos for s in stars)

    def test_reserved_always_first(self):
        stars = self._stars()
        plan = plan_tier_stars(stars, 10, seed=3, reserved=[5, 6, 999999])
        assert plan.kepids[:2] == [5, 6] and plan.reserved == [5, 6]

    def test_minority_class_exhausted(self):
        stars = [StarCounts(1, 1, 0)] + [StarCounts(k, 0, 1) for k in range(2, 50)]
        plan = plan_tier_stars(stars, 20, seed=0)
        assert plan.n_pos == 1 and plan.n_neg == 19


# --------------------------------------------------------------------------------------------------
# Database-backed selection
# --------------------------------------------------------------------------------------------------
def _add_star(session, kepid, labels):
    session.add(Target(kepid=kepid, lc_status="none", lc_quarters=[]))
    for i, av in enumerate(labels, start=1):
        session.add(
            Signal(
                signal_key=f"TCE-{kepid:09d}-{i:02d}",
                kepid=kepid,
                primary_source="dr24_tce",
                tce_plnt_num=i,
                period_days=1.0 + i,
                epoch_bkjd=131.0,
                duration_hours=2.0,
                av_training_set=av,
                koi_disposition={"PC": "CONFIRMED", "AFP": "FALSE POSITIVE"}.get(av),
                category="unknown",
                label_conflict=False,
                match_status="tce_only",
                provenance={"synthetic": True},
            )
        )


@pytest.fixture()
def synthetic_catalogue(db_session):
    rng = np.random.default_rng(123)
    for kepid in range(2000001, 2000301):
        n = int(rng.integers(1, 4))
        labels = list(rng.choice(["PC", "AFP", "NTP", "UNK"], size=n, p=[0.2, 0.5, 0.15, 0.15]))
        _add_star(db_session, kepid, labels)
    # reserved showcase star: one labelled + one unlabelled signal
    _add_star(db_session, 11442793, ["PC", "UNK"])
    retired = Signal(
        signal_key="TCE-002000999-01",
        kepid=11442793,
        primary_source="dr24_tce",
        period_days=3.0,
        epoch_bkjd=131.0,
        duration_hours=2.0,
        av_training_set="PC",
        category="retired",
        label_conflict=False,
        provenance={},
    )
    db_session.add(retired)
    db_session.flush()
    return db_session


def test_selection_takes_whole_stars(synthetic_catalogue):
    s = synthetic_catalogue
    sel = select_signals_for_tier(s, "custom", "astronet_dr24", seed=42, target_size=120)
    chosen = {x.kepid for x in sel}
    all_labelled = [x for x in s.query(Signal).all() if label_for(x, "astronet_dr24") is not None]
    for x in all_labelled:
        if x.kepid in chosen:
            assert x in sel, f"partial star {x.kepid}: {x.signal_key} missing"


def test_selection_balance_reserved_and_order(synthetic_catalogue):
    s = synthetic_catalogue
    sel = select_signals_for_tier(s, "custom", "astronet_dr24", seed=42, target_size=120)
    labels = [label_for(x, "astronet_dr24") for x in sel]
    n_pos, n_neg = labels.count(1), labels.count(0)
    assert 120 <= n_pos + n_neg <= 126 and abs(n_pos - n_neg) <= 4
    keys = [x.signal_key for x in sel]
    assert "TCE-011442793-01" in keys and "TCE-011442793-02" in keys  # unlabelled reserved signal kept
    assert "TCE-002000999-01" not in keys  # retired never selected
    assert keys == [x.signal_key for x in sorted(sel, key=lambda x: (x.kepid, x.signal_key))]
    again = select_signals_for_tier(s, "custom", "astronet_dr24", seed=42, target_size=120)
    assert [x.id for x in again] == [x.id for x in sel]


def test_reserved_unlabelled_can_be_dropped(synthetic_catalogue):
    sel = select_signals_for_tier(
        synthetic_catalogue, "custom", "astronet_dr24", target_size=50, include_unlabelled_reserved=False
    )
    keys = {x.signal_key for x in sel}
    assert "TCE-011442793-01" in keys and "TCE-011442793-02" not in keys


def test_full_tier_is_all_labelled(synthetic_catalogue):
    s = synthetic_catalogue
    sel = select_signals_for_tier(s, "full", "astronet_dr24", reserved_kepids=[])
    expected = {
        x.id
        for x in s.query(Signal).all()
        if x.category != "retired" and label_for(x, "astronet_dr24") is not None
    }
    assert {x.id for x in sel} == expected


def test_koi_mode_uses_koi_labels(synthetic_catalogue):
    sel = select_signals_for_tier(synthetic_catalogue, "full", "koi_disposition", reserved_kepids=[])
    assert sel and all(x.koi_disposition in ("CONFIRMED", "FALSE POSITIVE") for x in sel)


def test_bad_arguments(synthetic_catalogue):
    with pytest.raises(ValueError, match="tier"):
        select_signals_for_tier(synthetic_catalogue, "huge", "astronet_dr24")
    with pytest.raises(ValueError, match="target_size"):
        select_signals_for_tier(synthetic_catalogue, "custom", "astronet_dr24")
    with pytest.raises(ValueError, match="label mode"):
        select_signals_for_tier(synthetic_catalogue, "pilot", "nope")
    for bad in (0, -5, 2.5):  # used to return only the reserved stars without complaint
        with pytest.raises(ValueError, match="positive integer"):
            select_signals_for_tier(synthetic_catalogue, "custom", "astronet_dr24", target_size=bad)
