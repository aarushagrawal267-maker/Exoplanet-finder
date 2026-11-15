"""Metrics against scikit-learn and hand calculations; calibration (temperature, ECE, reliability)."""

from __future__ import annotations

import numpy as np
import pytest
from sklearn import metrics as skm

from exofinder.ml.calibration import (
    apply_temperature,
    expected_calibration_error,
    fit_temperature,
    logit,
    prior_logit_offset,
    reliability_curve,
    sigmoid,
)
from exofinder.ml.metrics import (
    best_f1_threshold,
    bootstrap_ci,
    classification_metrics,
    confusion,
    pr_curve_points,
    roc_curve_points,
)

# Hand case: predictions at threshold 0.5 -> TP=3, FP=1, TN=3, FN=1
Y = np.array([0, 0, 1, 1, 1, 0, 1, 0])
P = np.array([0.1, 0.4, 0.35, 0.8, 0.7, 0.2, 0.9, 0.6])


def test_hand_case_values() -> None:
    m = classification_metrics(Y, P, 0.5)
    assert (m["tp"], m["fp"], m["tn"], m["fn"]) == (3, 1, 3, 1)
    assert (m["n"], m["n_pos"], m["n_neg"]) == (8, 4, 4)
    for k in ("accuracy", "precision", "recall", "sensitivity", "specificity", "f1"):
        assert m[k] == pytest.approx(0.75)
    assert m["roc_auc"] == pytest.approx(14 / 16)  # 14 of 16 positive/negative pairs ordered correctly
    assert m["pr_auc"] == pytest.approx((1 + 1 + 1 + 4 / 6) / 4)  # precision at each positive
    assert m["brier"] == pytest.approx(1.1325 / 8)
    assert m["threshold"] == 0.5
    assert confusion(Y, P, 0.5) == {"tn": 3, "fp": 1, "fn": 1, "tp": 3}


def test_matches_sklearn_including_ties() -> None:
    rng = np.random.default_rng(0)
    for _ in range(50):
        n = int(rng.integers(6, 80))
        y = rng.integers(0, 2, n)
        if y.min() == y.max():
            continue
        p = np.round(rng.random(n), 1)  # many ties
        thr = float(rng.choice([0.3, 0.5, 0.7]))
        m = classification_metrics(y, p, thr)
        pred = (p >= thr).astype(int)
        assert m["roc_auc"] == pytest.approx(skm.roc_auc_score(y, p), abs=1e-12)
        assert m["pr_auc"] == pytest.approx(skm.average_precision_score(y, p), abs=1e-12)
        assert m["accuracy"] == pytest.approx(skm.accuracy_score(y, pred))
        assert m["f1"] == pytest.approx(skm.f1_score(y, pred, zero_division=0))
        assert m["recall"] == pytest.approx(skm.recall_score(y, pred))
        assert m["specificity"] == pytest.approx(skm.recall_score(1 - y, 1 - pred))
        assert m["brier"] == pytest.approx(skm.brier_score_loss(y, p))
        if pred.sum():
            assert m["precision"] == pytest.approx(skm.precision_score(y, pred))
        else:
            assert m["precision"] is None


def test_single_class_edge_cases() -> None:
    y = np.zeros(5, dtype=int)
    p = np.array([0.1, 0.2, 0.3, 0.4, 0.45])
    m = classification_metrics(y, p, 0.5)
    assert m["roc_auc"] is None and m["pr_auc"] is None
    assert m["recall"] is None and m["sensitivity"] is None
    assert m["precision"] is None  # nothing predicted positive
    assert m["f1"] is None  # no positives anywhere
    assert m["specificity"] == 1.0 and m["accuracy"] == 1.0
    m1 = classification_metrics(np.ones(3, dtype=int), np.array([0.2, 0.7, 0.9]), 0.5)
    assert m1["specificity"] is None and m1["roc_auc"] is None
    assert m1["pr_auc"] == pytest.approx(1.0)
    empty = classification_metrics([], [], 0.5)
    assert empty["n"] == 0 and empty["accuracy"] is None and empty["ece"] is None
    assert roc_curve_points(y, p) == [] and pr_curve_points(y, p) == []
    assert best_f1_threshold(y, p) == 0.5


def test_best_f1_threshold_hand_case() -> None:
    y = np.array([0, 1, 1, 0, 1])
    p = np.array([0.1, 0.9, 0.6, 0.55, 0.3])
    # F1 by cut: >=0.9 0.5, >=0.6 0.8, >=0.55 0.667, >=0.3 0.857 (best), >=0.1 0.75
    thr = best_f1_threshold(y, p)
    assert thr == pytest.approx(0.2)  # midpoint between the optimal cut 0.3 and the next score 0.1
    assert classification_metrics(y, p, thr)["f1"] == pytest.approx(6 / 7)


def test_curves_downsampled_and_ordered() -> None:
    rng = np.random.default_rng(3)
    y = rng.integers(0, 2, 3000)
    p = np.clip(0.3 * y + 0.7 * rng.random(3000), 0, 1)
    roc = roc_curve_points(y, p)
    pr = pr_curve_points(y, p)
    assert 2 < len(roc) <= 200 and 2 < len(pr) <= 200
    assert roc[0] == {"fpr": 0.0, "tpr": 0.0, "threshold": None}
    assert roc[-1]["fpr"] == 1.0 and roc[-1]["tpr"] == 1.0
    fpr = [pt["fpr"] for pt in roc]
    assert fpr == sorted(fpr)
    rec = [pt["recall"] for pt in pr]
    assert rec == sorted(rec) and pr[0]["threshold"] is None


def test_bootstrap_ci_deterministic_and_sane() -> None:
    rng = np.random.default_rng(1)
    y = rng.integers(0, 2, 300)
    p = np.clip(0.4 * y + 0.6 * rng.random(300), 0, 1)
    a = bootstrap_ci(y, p, 0.5, n_boot=200, seed=0)
    b = bootstrap_ci(y, p, 0.5, n_boot=200, seed=0)
    assert a == b
    point = classification_metrics(y, p, 0.5)
    for k, (lo, hi) in a.items():
        assert lo <= hi, k
        assert lo - 1e-9 <= point[k] <= hi + 1e-9, k
    groups = np.repeat(np.arange(100), 3)
    c = bootstrap_ci(y, p, 0.5, n_boot=100, seed=0, groups=groups)
    assert c["roc_auc"] is not None
    tiny = bootstrap_ci(np.array([0, 1]), np.array([0.2, 0.8]), 0.5, n_boot=5)
    assert tiny["roc_auc"] is None  # too few defined resamples


def test_temperature_recovers_known_scaling() -> None:
    rng = np.random.default_rng(42)
    z_true = rng.normal(0.0, 2.0, 40_000)
    y = (rng.random(z_true.size) < sigmoid(z_true)).astype(int)
    T = fit_temperature(3.0 * z_true, y)  # logits 3x over-confident
    assert T == pytest.approx(3.0, rel=0.05)
    T_under = fit_temperature(0.5 * z_true, y)  # under-confident -> T < 1
    assert T_under == pytest.approx(0.5, rel=0.05)


def test_temperature_edge_cases_and_application() -> None:
    assert fit_temperature(np.array([1.0, 2.0]), np.array([1, 1])) == 1.0  # single class
    assert fit_temperature(np.zeros(10), np.array([0, 1] * 5)) == 1.0
    # anti-correlated logits: the NLL minimum is at a finite T > 0 or at the upper clamp
    assert 0.05 <= fit_temperature(np.array([-50.0, 50.0] * 5), np.array([1, 0] * 5)) <= 20.0
    # separable by sign: NLL -> 0 as T -> 0, T is not identified -> no rescaling (not the 0.05 clamp)
    assert fit_temperature(np.array([-0.6, -0.4, 0.3, 0.5]), np.array([0, 0, 1, 1])) == 1.0
    assert fit_temperature(np.array([-0.6, 0.0, 0.3, 0.5]), np.array([0, 0, 1, 1])) == 1.0
    with pytest.raises(ValueError, match="0 or 1"):
        fit_temperature(np.array([0.1, 0.2]), np.array([0, 2]))
    np.testing.assert_allclose(apply_temperature(np.array([0.0, 2.0]), 2.0), sigmoid(np.array([0.0, 1.0])))
    np.testing.assert_allclose(apply_temperature(np.array([1.0]), 2.0, offset=0.4), sigmoid(np.array([0.3])))
    assert prior_logit_offset(25, 75) == pytest.approx(np.log(3.0))
    assert prior_logit_offset(0, 10) == 0.0
    with pytest.raises(ValueError):
        apply_temperature(np.array([1.0]), 0.0)


def test_reliability_and_ece_hand_case() -> None:
    y = np.array([0, 1, 1, 0])
    p = np.array([0.05, 0.95, 0.65, 0.62])
    assert expected_calibration_error(y, p) == pytest.approx((0.05 + 0.05 + 0.27) / 4)
    curve = reliability_curve(y, p, n_bins=10)
    assert len(curve) == 10
    assert (
        curve[6]["count"] == 2
        and curve[6]["mean_pred"] == pytest.approx(0.635)
        and curve[6]["frac_pos"] == 0.5
    )
    assert curve[3]["count"] == 0 and curve[3]["mean_pred"] is None
    assert curve[9]["bin_hi"] == 1.0
    assert classification_metrics(y, p, 0.5)["ece"] == pytest.approx(0.0925)


def test_rejects_bad_inputs() -> None:
    with pytest.raises(ValueError):
        classification_metrics([0, 1], [0.5])
    with pytest.raises(ValueError):
        classification_metrics([0, 2], [0.5, 0.5])
    with pytest.raises(ValueError):
        classification_metrics([0, 1], [0.5, np.nan])


def test_prior_correction_fixes_class_weighting_bias() -> None:
    """SYNTHETIC simulation (test only): a class_weight="balanced" model inflates P(positive) by
    the factor n_neg/n_pos in odds; temperature scaling alone cannot remove a shift, the prior
    correction does. Held-out ECE must improve substantially."""
    from exofinder.ml.models.baselines import make_logreg, positive_proba

    rng = np.random.default_rng(0)

    def draw(n: int) -> tuple[np.ndarray, np.ndarray]:
        y = (rng.random(n) < 0.22).astype(int)
        return rng.normal(size=(n, 10)) + 0.6 * y[:, None] * np.linspace(1, 0.1, 10), y

    (x_tr, y_tr), (x_va, y_va), (x_te, y_te) = draw(3000), draw(400), draw(20000)
    model = make_logreg().fit(x_tr, y_tr)
    z_va, z_te = logit(positive_proba(model, x_va)), logit(positive_proba(model, x_te))
    offset = prior_logit_offset(int(y_tr.sum()), int((y_tr == 0).sum()))
    t_only = fit_temperature(z_va, y_va)
    t_corr = fit_temperature(z_va - offset, y_va)
    ece_temp_only = expected_calibration_error(y_te, apply_temperature(z_te, t_only))
    ece_corrected = expected_calibration_error(y_te, apply_temperature(z_te, t_corr, offset))
    assert ece_corrected < 0.05 < ece_temp_only
    assert apply_temperature(z_te, t_corr, offset).mean() == pytest.approx(y_te.mean(), abs=0.03)
