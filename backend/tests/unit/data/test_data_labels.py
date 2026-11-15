"""Label modes: AstroNet DR24 Autovetter labels and KOI dispositions."""

from __future__ import annotations

import math

import pytest

from exofinder.data.labels import EXCLUSION_REASONS, LABEL_MODES, exclusion_reason, label_for
from exofinder.db.models import Signal


@pytest.mark.parametrize(
    ("av", "expected", "reason"),
    [
        ("PC", 1, None),
        ("AFP", 0, None),
        ("NTP", 0, None),
        ("UNK", None, "av_unknown"),
        (None, None, "no_av_label"),
        ("", None, "no_av_label"),
        (math.nan, None, "no_av_label"),
        (" pc ", 1, None),  # tolerant to whitespace / case from CSV parsing
        ("XYZ", None, "unexpected_value"),
    ],
)
def test_astronet_mode(av, expected, reason):
    sig = {"av_training_set": av, "koi_disposition": "CONFIRMED", "category": "confirmed"}
    assert label_for(sig, "astronet_dr24") == expected
    assert exclusion_reason(sig, "astronet_dr24") == reason


@pytest.mark.parametrize(
    ("disp", "expected", "reason"),
    [
        ("CONFIRMED", 1, None),
        ("FALSE POSITIVE", 0, None),
        ("CANDIDATE", None, "koi_candidate"),
        ("NOT DISPOSITIONED", None, "koi_not_dispositioned"),
        (None, None, "no_koi_disposition"),
    ],
)
def test_koi_mode(disp, expected, reason):
    sig = {"av_training_set": "PC", "koi_disposition": disp, "category": "candidate"}
    assert label_for(sig, "koi_disposition") == expected
    assert exclusion_reason(sig, "koi_disposition") == reason


def test_works_with_orm_objects():
    s = Signal(
        signal_key="TCE-000000001-01",
        kepid=1,
        primary_source="dr24_tce",
        period_days=1.0,
        epoch_bkjd=130.0,
        duration_hours=2.0,
        av_training_set="AFP",
        koi_disposition=None,
        category="false_positive",
        label_conflict=False,
    )
    assert label_for(s, "astronet_dr24") == 0
    assert label_for(s, "koi_disposition") is None
    assert exclusion_reason(s, "koi_disposition") == "no_koi_disposition"


def test_confirmed_planet_without_koi_is_not_labelled_in_koi_mode():
    # e.g. PL-Kepler-90_i: confirmed, but no KOI disposition and no Autovetter label
    sig = {"av_training_set": None, "koi_disposition": None, "category": "confirmed"}
    assert label_for(sig, "koi_disposition") is None and label_for(sig, "astronet_dr24") is None


def test_label_conflicts_kept_by_default_and_optionally_excluded():
    sig = {"av_training_set": "PC", "koi_disposition": "FALSE POSITIVE", "label_conflict": True}
    assert label_for(sig, "astronet_dr24") == 1
    assert label_for(sig, "koi_disposition") == 0
    assert label_for(sig, "astronet_dr24", exclude_label_conflicts=True) is None
    assert exclusion_reason(sig, "koi_disposition", exclude_label_conflicts=True) == "label_conflict"


def test_retired_signals_are_never_labelled():
    sig = {"av_training_set": "PC", "koi_disposition": "CONFIRMED", "category": "retired"}
    assert label_for(sig, "astronet_dr24") is None and exclusion_reason(sig, "koi_disposition") == "retired"


def test_scores_are_ignored():
    a = {
        "av_training_set": "PC",
        "koi_disposition": "CANDIDATE",
        "koi_score": 0.0,
        "fpflag_ss": 1,
        "koi_pdisposition": "FALSE POSITIVE",
    }
    b = {**a, "koi_score": 1.0, "fpflag_ss": 0, "koi_pdisposition": "CANDIDATE"}
    for mode in LABEL_MODES:
        assert label_for(a, mode) == label_for(b, mode)


def test_unknown_mode():
    with pytest.raises(ValueError, match="unknown label mode"):
        label_for({}, "nope")


def test_every_reason_is_documented():
    codes = (
        {r for m in LABEL_MODES.values() for r in m.excluded.values()}
        | {m.missing_reason for m in LABEL_MODES.values()}
        | {"unexpected_value", "label_conflict", "retired"}
    )
    assert codes <= set(EXCLUSION_REASONS)
