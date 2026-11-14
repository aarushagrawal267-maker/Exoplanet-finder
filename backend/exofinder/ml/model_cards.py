"""Human-readable descriptions ("model cards") of the four model types, for the docs and the UI.

``get_model_card(model_type)`` returns a JSON-serialisable dict with the keys used by
``GET /api/training/model-types``: ``type``, ``name``, ``description``, ``inputs``, ``strengths``,
``limitations``, ``architecture`` (list of layer descriptions), ``uncertainty``, ``training``,
``default_config``, ``n_params`` (exact parameter count for the default AstroNet geometry; for the
baselines the size depends on the fitted data and is ``None``) and ``reference``.
"""

from __future__ import annotations

from functools import cache
from typing import Any

from exofinder.config import GLOBAL_VIEW_BINS, LOCAL_VIEW_BINS

from .features import BASELINE_GLOBAL_BINS
from .train import MODEL_TYPES, TrainConfig

_REFERENCE_ASTRONET = (
    "Shallue, C. J. & Vanderburg, A. (2018), Identifying Exoplanets with Deep Learning, AJ 155, 94"
)

_CNN_FIELDS = (
    "lr",
    "batch_size",
    "max_epochs",
    "patience",
    "weight_decay",
    "dropout",
    "fc_width",
    "fc_layers",
    "augment_flip",
    "ensemble_size",
    "seed",
)
_LR_FIELDS = ("logreg_c_grid", "logreg_max_iter", "cv_folds", "seed")
_RF_FIELDS = (
    "rf_n_estimators",
    "rf_max_depth_grid",
    "rf_min_samples_leaf_grid",
    "rf_max_features_grid",
    "cv_folds",
    "seed",
)


def _global_column_desc() -> list[str]:
    blocks = [
        f"Global block {i + 1}: 2 x Conv1d({16 * 2**i} filters, kernel 5, same padding) + ReLU, MaxPool(5, stride 2)"
        for i in range(5)
    ]
    return blocks


def _local_column_desc() -> list[str]:
    return [
        f"Local block {i + 1}: 2 x Conv1d({16 * 2**i} filters, kernel 5, same padding) + ReLU, MaxPool(7, stride 2)"
        for i in range(2)
    ]


def _head_desc(cfg: TrainConfig) -> list[str]:
    return [
        f"{cfg.fc_layers} x fully-connected({cfg.fc_width}) + ReLU + Dropout({cfg.dropout})",
        "Linear(1) -> logit z; sigmoid((z - log(n_neg/n_pos)) / T) = calibrated probability",
    ]


@cache
def _cnn_param_count(model_type: str) -> int:
    import torch

    from .models.cnn import build_cnn, count_parameters

    cfg = TrainConfig(model_type=model_type)
    kwargs: dict[str, Any] = {
        "global_bins": GLOBAL_VIEW_BINS,
        "fc_width": cfg.fc_width,
        "fc_layers": cfg.fc_layers,
        "dropout": cfg.dropout,
    }
    if model_type == "cnn_two_view":
        kwargs["local_bins"] = LOCAL_VIEW_BINS
    with torch.random.fork_rng(devices=[]):
        return count_parameters(build_cnn(model_type, **kwargs))


def _subset(cfg: TrainConfig, keys: tuple[str, ...]) -> dict[str, Any]:
    d = cfg.to_dict()
    return {k: d[k] for k in keys}


def get_model_card(model_type: str, include_n_params: bool = True) -> dict[str, Any]:
    """Model card for ``model_type`` (``logreg``, ``random_forest``, ``cnn_single``, ``cnn_two_view``)."""
    if model_type not in MODEL_TYPES:
        raise ValueError(f"unknown model type {model_type!r}; expected one of {MODEL_TYPES}")
    cfg = TrainConfig(model_type=model_type)
    common_training = (
        "Selected on the validation split only; probabilities corrected for the training class "
        "weighting (logit - log(n_neg/n_pos)) and temperature-scaled on validation; decision threshold = "
        "F1-optimal on validation. The test split is used once, for final evaluation."
    )
    baseline_inputs = [
        f"Global view block-averaged to {BASELINE_GLOBAL_BINS} bins",
        f"Local view ({LOCAL_VIEW_BINS} bins)",
        (
            "Physical features measured from the light curve (depth, duration, SNR, odd/even, secondary "
            "eclipse, shape, scatter...). No catalogue scores or dispositions."
        ),
    ]
    if model_type == "logreg":
        card = {
            "name": "Logistic regression",
            "description": (
                "A linear classifier on standardised view bins and physical features. It weighs each input "
                "independently, so it shows how much of the problem is solvable without learned shape detectors."
            ),
            "inputs": baseline_inputs,
            "strengths": [
                "Trains in seconds; fully transparent coefficients",
                "Hard to overfit with L2 regularisation",
                "Useful sanity check for the deep models",
            ],
            "limitations": [
                "Cannot model interactions (e.g. 'V-shaped AND deep secondary')",
                "Sensitive to small phase misalignments of view bins",
                "No uncertainty estimate",
            ],
            "architecture": [
                "StandardScaler (zero mean, unit variance per feature)",
                "LogisticRegression (L2, class_weight=balanced, C chosen by grouped CV)",
            ],
            "uncertainty": None,
            "training": "Grouped stratified K-fold CV by star on the training split, refit on all of it. "
            + common_training,
            "default_config": _subset(cfg, _LR_FIELDS),
            "n_params": None,
            "reference": "Classical baseline",
        }
    elif model_type == "random_forest":
        card = {
            "name": "Random forest",
            "description": (
                "An ensemble of decision trees on the same inputs as logistic regression. Trees capture "
                "non-linear rules and interactions between diagnostics without feature scaling."
            ),
            "inputs": baseline_inputs,
            "strengths": [
                "Non-linear, robust to feature scales and outliers",
                "Feature importances explain which inputs matter",
                "Tree-vote spread gives a cheap uncertainty",
            ],
            "limitations": [
                "Treats view bins as unordered features (no notion of shape or translation)",
                "Probabilities need calibration",
            ],
            "architecture": [
                (
                    f"RandomForestClassifier({cfg.rf_n_estimators} trees, class_weight=balanced, "
                    "max_depth / min_samples_leaf chosen by grouped CV)"
                )
            ],
            "uncertainty": "Standard deviation of the per-tree (calibrated) probabilities",
            "training": "Grouped stratified K-fold CV by star on the training split, refit on all of it. "
            + common_training,
            "default_config": _subset(cfg, _RF_FIELDS),
            "n_params": None,
            "reference": "Breiman, L. (2001), Random Forests, Machine Learning 45, 5",
        }
    elif model_type == "cnn_single":
        card = {
            "name": "Single-view CNN (global view)",
            "description": (
                "AstroNet's global-view network: a 1-D convolutional column reads the whole phase-folded orbit "
                f"({GLOBAL_VIEW_BINS} bins) and learns shape detectors for transits, secondary eclipses and "
                "variability."
            ),
            "inputs": [f"Global view ({GLOBAL_VIEW_BINS} bins, whole orbit)"],
            "strengths": [
                "Learns transit shape directly from the folded light curve",
                "Sees secondary eclipses and out-of-transit variability",
            ],
            "limitations": [
                "Short transits occupy only a few global bins, so fine ingress/egress shape is lost",
                "Needs thousands of labelled examples; minutes per epoch on CPU for large datasets",
            ],
            "architecture": _global_column_desc() + ["Flatten"] + _head_desc(cfg),
            "uncertainty": "Ensemble spread (ensemble_size > 1) or Monte-Carlo dropout (20 passes)",
            "training": "Adam, BCE with pos_weight = n_neg/n_pos, random time-reversal augmentation, early "
            "stopping on validation PR-AUC. " + common_training,
            "default_config": _subset(cfg, _CNN_FIELDS),
            "n_params": _cnn_param_count(model_type) if include_n_params else None,
            "reference": _REFERENCE_ASTRONET,
        }
    else:
        card = {
            "name": "Two-view CNN (AstroNet)",
            "description": (
                "The AstroNet architecture: a global column reads the whole folded orbit and a local column "
                f"zooms on the transit (+/- 2 durations, {LOCAL_VIEW_BINS} bins); their features are combined "
                "by fully-connected layers. This design found Kepler-90 i and Kepler-80 g."
            ),
            "inputs": [
                f"Global view ({GLOBAL_VIEW_BINS} bins, whole orbit)",
                f"Local view ({LOCAL_VIEW_BINS} bins, transit +/- 2 durations)",
            ],
            "strengths": [
                "Combines context (secondary eclipses, variability) with detailed transit shape (U vs V)",
                "Best-performing architecture in Shallue & Vanderburg (2018)",
            ],
            "limitations": [
                "Cannot detect background eclipsing binaries that need centroid/pixel data",
                "Needs thousands of labelled examples; minutes per epoch on CPU for large datasets",
            ],
            "architecture": _global_column_desc()
            + _local_column_desc()
            + ["Flatten + concatenate"]
            + _head_desc(cfg),
            "uncertainty": "Ensemble spread (ensemble_size > 1) or Monte-Carlo dropout (20 passes)",
            "training": "Adam, BCE with pos_weight = n_neg/n_pos, random time-reversal augmentation, early "
            "stopping on validation PR-AUC. " + common_training,
            "default_config": _subset(cfg, _CNN_FIELDS),
            "n_params": _cnn_param_count(model_type) if include_n_params else None,
            "reference": _REFERENCE_ASTRONET,
        }
    return {"type": model_type, **card}


def list_model_cards(include_n_params: bool = True) -> list[dict[str, Any]]:
    """Cards for all four model types, in a fixed order."""
    return [get_model_card(t, include_n_params) for t in MODEL_TYPES]


__all__ = ["get_model_card", "list_model_cards"]
