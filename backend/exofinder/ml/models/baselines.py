"""Classical baseline classifiers (scikit-learn pipelines).

Both baselines use the design matrix of :func:`exofinder.ml.features.baseline_feature_matrix`
(downsampled global view + local view + physical features) and ``class_weight="balanced"`` so
that the minority class (usually planet-like) is not ignored.

* **Logistic regression** — a linear model on standardised features (``StandardScaler`` first:
  view bins and physical features live on very different scales). L2-regularised; the inverse
  regularisation strength ``C`` is chosen by grouped cross-validation on the training split.
  It answers "how far does a linear combination of bins and diagnostics get us?".
* **Random forest** — an ensemble of decision trees on bootstrap samples; captures non-linear
  interactions (e.g. "deep secondary *and* V-shape") without scaling. The spread of the per-tree
  votes provides a cheap uncertainty estimate.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

LOGREG_DEFAULTS: dict[str, Any] = {"C": 0.1, "max_iter": 5000, "random_state": 42}
RF_DEFAULTS: dict[str, Any] = {
    "n_estimators": 300,
    "max_depth": None,
    "min_samples_leaf": 2,
    "max_features": "sqrt",
    "n_jobs": None,
    "random_state": 42,
}


def make_logreg(**hp: Any) -> Pipeline:
    """``StandardScaler -> LogisticRegression(class_weight="balanced")``.

    Keyword arguments override :data:`LOGREG_DEFAULTS` (``C``, ``max_iter``, ``random_state``, ``tol``).
    """
    params = {**LOGREG_DEFAULTS, **hp}
    return Pipeline(
        [
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(class_weight="balanced", solver="lbfgs", **params)),
        ]
    )


def make_random_forest(**hp: Any) -> Pipeline:
    """``RandomForestClassifier(class_weight="balanced")`` wrapped in a one-step pipeline.

    Keyword arguments override :data:`RF_DEFAULTS` (``n_estimators``, ``max_depth``,
    ``min_samples_leaf``, ``max_features``, ``n_jobs``, ``random_state``).
    """
    params = {**RF_DEFAULTS, **hp}
    return Pipeline([("clf", RandomForestClassifier(class_weight="balanced", **params))])


def final_estimator(pipeline: Pipeline) -> Any:
    return pipeline.steps[-1][1]


def transform_until_final(pipeline: Pipeline, X: np.ndarray) -> np.ndarray:
    """Apply every pipeline step except the final estimator."""
    Xt = X
    for _, step in pipeline.steps[:-1]:
        Xt = step.transform(Xt)
    return Xt


def tree_probabilities(pipeline: Pipeline, X: np.ndarray) -> np.ndarray:
    """Per-tree P(class 1) for a random-forest pipeline, shape (N, n_trees)."""
    rf = final_estimator(pipeline)
    if not isinstance(rf, RandomForestClassifier):
        raise TypeError("tree_probabilities requires a random-forest pipeline")
    Xt = np.asarray(transform_until_final(pipeline, X), dtype=np.float32)
    pos_col = int(np.flatnonzero(rf.classes_ == 1)[0])
    return np.stack([t.predict_proba(Xt)[:, pos_col] for t in rf.estimators_], axis=1)


def positive_proba(pipeline: Pipeline, X: np.ndarray) -> np.ndarray:
    """P(class 1) from a fitted pipeline (robust to the order of ``classes_``)."""
    clf = final_estimator(pipeline)
    pos_col = int(np.flatnonzero(clf.classes_ == 1)[0])
    return pipeline.predict_proba(X)[:, pos_col]


def count_sklearn_parameters(pipeline: Pipeline) -> int:
    """Size of a fitted baseline: coefficients + intercept (LR) or total tree nodes (RF)."""
    clf = final_estimator(pipeline)
    if isinstance(clf, LogisticRegression):
        return int(clf.coef_.size + np.size(clf.intercept_))
    if isinstance(clf, RandomForestClassifier):
        return int(sum(t.tree_.node_count for t in clf.estimators_))
    return 0


__all__ = [
    "LOGREG_DEFAULTS",
    "RF_DEFAULTS",
    "count_sklearn_parameters",
    "final_estimator",
    "make_logreg",
    "make_random_forest",
    "positive_proba",
    "transform_until_final",
    "tree_probabilities",
]
