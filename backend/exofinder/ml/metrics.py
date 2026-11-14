"""Classification metrics for planet-like (1) vs false-positive-like (0) scoring.

Conventions
-----------
* ``p`` is the model's probability of class 1; an example is predicted positive when
  ``p >= threshold`` (the same convention as :func:`sklearn.metrics.roc_curve`).
* **Sensitivity** = recall = TP / (TP + FN): the fraction of planet-like signals recovered.
* **Specificity** = TN / (TN + FP): the fraction of false positives correctly rejected.
* **PR-AUC** is the *average precision* (step-wise area, identical to
  :func:`sklearn.metrics.average_precision_score`), the headline metric for an imbalanced problem
  where positives are rare. **ROC-AUC** is computed with the Mann-Whitney U statistic (ties count
  one half), identical to :func:`sklearn.metrics.roc_auc_score`.
* **Brier score** = mean (p - y)^2; **ECE** = expected calibration error over 10 equal-width bins.
* Undefined values are ``None`` (never NaN and never silently 0): e.g. precision with no predicted
  positives, specificity with no negatives, ROC-AUC/PR-AUC when only one class is present.
  F1 = 2TP / (2TP + FP + FN) is defined whenever the labels or predictions contain a positive.

The metric code is vectorised and self-contained so that the bootstrap (1000 resamples) is fast
and uses exactly the same definitions as the point estimates.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.stats import rankdata

from .calibration import expected_calibration_error

#: Metrics that get bootstrap confidence intervals.
CI_METRICS: tuple[str, ...] = (
    "accuracy",
    "precision",
    "recall",
    "sensitivity",
    "specificity",
    "f1",
    "roc_auc",
    "pr_auc",
    "brier",
    "ece",
)


def _prepare(y: Any, p: Any) -> tuple[np.ndarray, np.ndarray]:
    yy = np.asarray(y).ravel()
    pp = np.asarray(p, dtype=np.float64).ravel()
    if yy.shape != pp.shape:
        raise ValueError(f"y and p have different lengths ({yy.size} vs {pp.size})")
    if yy.size and not np.isin(yy, (0, 1)).all():
        raise ValueError("labels must be 0 or 1")
    if not np.isfinite(pp).all():
        raise ValueError("probabilities contain NaN or Inf")
    return yy.astype(np.int64), pp


def _none(v: float) -> float | None:
    return None if v is None or not math.isfinite(v) else float(v)


def roc_auc(y: Any, p: Any) -> float | None:
    """ROC-AUC via the Mann-Whitney U statistic (``None`` if only one class is present)."""
    yy, pp = _prepare(y, p)
    return _none(_roc_auc(yy, pp))


def _roc_auc(y: np.ndarray, p: np.ndarray) -> float:
    n_pos = int(y.sum())
    n_neg = y.size - n_pos
    if n_pos == 0 or n_neg == 0:
        return math.nan
    ranks = rankdata(p)  # average ranks for ties -> ties count 1/2
    return float((ranks[y == 1].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def average_precision(y: Any, p: Any) -> float | None:
    """Average precision (PR-AUC), sklearn definition; ``None`` without positives."""
    yy, pp = _prepare(y, p)
    return _none(_average_precision(yy, pp))


def _average_precision(y: np.ndarray, p: np.ndarray) -> float:
    n_pos = int(y.sum())
    if n_pos == 0 or y.size == 0:
        return math.nan
    order = np.argsort(-p, kind="mergesort")
    ps, ys = p[order], y[order]
    # last index of every block of tied scores = the operating points of the PR curve
    cut = np.r_[np.flatnonzero(np.diff(ps)), ps.size - 1]
    tps = np.cumsum(ys)[cut].astype(np.float64)
    fps = (cut + 1) - tps
    precision = tps / (tps + fps)
    recall = tps / n_pos
    return float(np.sum(np.diff(np.r_[0.0, recall]) * precision))


def _counts(y: np.ndarray, p: np.ndarray, threshold: float) -> tuple[int, int, int, int]:
    pred = p >= threshold
    pos = y == 1
    tp = int(np.count_nonzero(pred & pos))
    fp = int(np.count_nonzero(pred & ~pos))
    fn = int(np.count_nonzero(~pred & pos))
    tn = int(y.size - tp - fp - fn)
    return tp, fp, tn, fn


def _div(a: float, b: float) -> float:
    return a / b if b > 0 else math.nan


def _point_metrics(y: np.ndarray, p: np.ndarray, threshold: float, n_bins: int = 10) -> dict[str, float]:
    """All CI metrics as floats (NaN = undefined)."""
    n = y.size
    tp, fp, tn, fn = _counts(y, p, threshold)
    recall = _div(tp, tp + fn)
    ece = expected_calibration_error(y, p, n_bins) if n else None
    return {
        "accuracy": _div(tp + tn, n),
        "precision": _div(tp, tp + fp),
        "recall": recall,
        "sensitivity": recall,
        "specificity": _div(tn, tn + fp),
        "f1": _div(2 * tp, 2 * tp + fp + fn),
        "roc_auc": _roc_auc(y, p),
        "pr_auc": _average_precision(y, p),
        "brier": float(np.mean((p - y) ** 2)) if n else math.nan,
        "ece": math.nan if ece is None else ece,
    }


def confusion(y: Any, p: Any, threshold: float = 0.5) -> dict[str, int]:
    """Confusion-matrix counts ``{tn, fp, fn, tp}`` at ``threshold``."""
    yy, pp = _prepare(y, p)
    tp, fp, tn, fn = _counts(yy, pp, threshold)
    return {"tn": tn, "fp": fp, "fn": fn, "tp": tp}


def classification_metrics(y: Any, p: Any, threshold: float = 0.5, n_bins: int = 10) -> dict[str, Any]:
    """Point metrics at ``threshold`` (see module docstring); undefined values are ``None``."""
    yy, pp = _prepare(y, p)
    tp, fp, tn, fn = _counts(yy, pp, threshold)
    out: dict[str, Any] = {k: _none(v) for k, v in _point_metrics(yy, pp, threshold, n_bins).items()}
    n_pos = int(yy.sum())
    out.update(
        {
            "n": int(yy.size),
            "n_pos": n_pos,
            "n_neg": int(yy.size - n_pos),
            "tp": tp,
            "fp": fp,
            "tn": tn,
            "fn": fn,
            "threshold": float(threshold),
        }
    )
    return out


def _downsample_idx(n: int, max_points: int) -> np.ndarray:
    if n <= max_points:
        return np.arange(n)
    return np.unique(np.round(np.linspace(0, n - 1, max_points)).astype(np.int64))


def _thr(v: float) -> float | None:
    return float(v) if math.isfinite(v) else None


def roc_curve_points(y: Any, p: Any, max_points: int = 200) -> list[dict[str, float | None]]:
    """ROC curve ``[{fpr, tpr, threshold}]`` (<= ``max_points``, endpoints kept); ``[]`` if one class.

    The first point (threshold above every score, nothing predicted positive) has ``threshold=None``.
    """
    from sklearn.metrics import roc_curve

    yy, pp = _prepare(y, p)
    if yy.size == 0 or yy.min() == yy.max():
        return []
    fpr, tpr, thr = roc_curve(yy, pp, drop_intermediate=True)
    idx = _downsample_idx(fpr.size, max_points)
    return [{"fpr": float(fpr[i]), "tpr": float(tpr[i]), "threshold": _thr(thr[i])} for i in idx]


def pr_curve_points(y: Any, p: Any, max_points: int = 200) -> list[dict[str, float | None]]:
    """Precision-recall curve ``[{recall, precision, threshold}]`` ordered by increasing recall.

    The start point (recall 0, precision 1) has ``threshold=None``. Returns ``[]`` when the labels
    contain no positives.
    """
    from sklearn.metrics import precision_recall_curve

    yy, pp = _prepare(y, p)
    if yy.size == 0 or yy.sum() == 0:
        return []
    precision, recall, thr = precision_recall_curve(yy, pp)
    thr_full = np.r_[thr, np.inf]
    # sklearn orders by increasing threshold (decreasing recall); reverse for plotting
    precision, recall, thr_full = precision[::-1], recall[::-1], thr_full[::-1]
    idx = _downsample_idx(recall.size, max_points)
    return [
        {"recall": float(recall[i]), "precision": float(precision[i]), "threshold": _thr(thr_full[i])}
        for i in idx
    ]


def best_f1_threshold(y: Any, p: Any) -> float:
    """Threshold maximising F1 on ``(y, p)`` (used on the validation set only).

    Every distinct score is a candidate cut (predict positive when ``p >= cut``). Any threshold in
    the half-open gap between the optimal cut and the next lower distinct score gives the same F1
    on these data; the midpoint of that gap is returned (a max-margin choice that generalises
    better than sitting exactly on a validation score). Ties in F1 prefer the higher threshold
    (fewer false alarms). Returns ``0.5`` when the labels contain a single class (F1-optimality is
    then undefined).
    """
    yy, pp = _prepare(y, p)
    n_pos = int(yy.sum())
    if yy.size == 0 or n_pos == 0 or n_pos == yy.size:
        return 0.5
    order = np.argsort(-pp, kind="mergesort")
    ps, ys = pp[order], yy[order]
    cut = np.r_[np.flatnonzero(np.diff(ps)), ps.size - 1]
    tps = np.cumsum(ys)[cut].astype(np.float64)
    fps = (cut + 1) - tps
    fns = n_pos - tps
    f1 = 2 * tps / (2 * tps + fps + fns)
    best = int(np.flatnonzero(f1 == f1.max())[0])  # first = highest threshold among ties
    hi = float(ps[cut[best]])
    if best + 1 < cut.size:
        lo = float(ps[cut[best + 1]])
        return (hi + lo) / 2.0
    return hi


def bootstrap_ci(
    y: Any,
    p: Any,
    threshold: float = 0.5,
    n_boot: int = 1000,
    seed: int = 0,
    alpha: float = 0.05,
    groups: Any = None,
    n_bins: int = 10,
) -> dict[str, list[float] | None]:
    """Percentile bootstrap ``(1 - alpha)`` confidence intervals ``{metric: [lo, hi]}``.

    Examples are resampled with replacement ``n_boot`` times (seeded, deterministic). If ``groups``
    (e.g. kepids) is given, whole groups are resampled instead (cluster bootstrap), which accounts
    for correlated signals of the same star. Resamples where a metric is undefined (e.g. no
    positives drawn) are skipped for that metric; a metric with fewer than 10 defined resamples gets
    ``None``. The threshold is held fixed (it was chosen on the validation set).
    """
    yy, pp = _prepare(y, p)
    out: dict[str, list[float] | None] = {k: None for k in CI_METRICS}
    n = yy.size
    if n == 0 or n_boot <= 0:
        return out
    rng = np.random.default_rng(seed)
    if groups is not None:
        g = np.asarray(groups).ravel()
        if g.size != n:
            raise ValueError("groups must have one entry per example")
        _, inverse = np.unique(g, return_inverse=True)
        members = [np.flatnonzero(inverse == k) for k in range(inverse.max() + 1)]
    samples = np.full((n_boot, len(CI_METRICS)), np.nan)
    for b in range(n_boot):
        if groups is None:
            idx = rng.integers(0, n, size=n)
        else:
            pick = rng.integers(0, len(members), size=len(members))
            idx = np.concatenate([members[k] for k in pick])
        m = _point_metrics(yy[idx], pp[idx], threshold, n_bins)
        samples[b] = [m[k] for k in CI_METRICS]
    lo_q, hi_q = 100 * alpha / 2, 100 * (1 - alpha / 2)
    for j, k in enumerate(CI_METRICS):
        col = samples[:, j]
        col = col[np.isfinite(col)]
        if col.size >= 10:
            out[k] = [float(np.percentile(col, lo_q)), float(np.percentile(col, hi_q))]
    return out


__all__ = [
    "CI_METRICS",
    "average_precision",
    "best_f1_threshold",
    "bootstrap_ci",
    "classification_metrics",
    "confusion",
    "pr_curve_points",
    "roc_auc",
    "roc_curve_points",
]
