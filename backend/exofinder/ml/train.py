"""Training of the four model types on a star-level-split dataset.

Model types (names match ``Experiment.model_type``)
---------------------------------------------------
``logreg``         logistic regression on downsampled views + physical features
``random_forest``  random forest on the same design matrix
``cnn_single``     AstroNet global-view CNN
``cnn_two_view``   AstroNet two-view CNN (global + local view)

Protocol (only the **train** and **val** splits are ever touched; the test split is reserved for
:func:`exofinder.ml.evaluate.evaluate`)
---------------------------------------------------------------------------------------------------
CNNs
    * loss: ``BCEWithLogitsLoss(pos_weight = n_neg / n_pos)`` on the training split, so the rarer
      class contributes as much total gradient as the common one;
    * optimiser: Adam (``lr``, ``weight_decay``); mini-batches of ``batch_size`` in a seeded order;
    * augmentation: each training example is time-reversed with probability 0.5 (both views
      together). A transit is (to first order) symmetric in time, so the reversed fold is an
      equally valid example; this doubles the effective data and discourages the network from
      keying on asymmetric systematics;
    * early stopping on **validation PR-AUC** (average precision): training stops after
      ``patience`` epochs without an improvement larger than ``min_delta`` (PR-AUC ties within
      ``min_delta`` are broken by the validation loss); the weights of the best epoch are kept
      (``best.pt``) and the final weights are saved too (``last.pt``). If the validation split has
      only one class, the validation loss is monitored instead. ``train_loss`` and ``val_loss`` are
      both the pos-weighted BCE objective, so the two curves are comparable;
    * ensembles: ``ensemble_size`` members trained independently with seeds ``seed + k``; the
      ensemble logit is the mean member logit.
Baselines
    * hyper-parameters chosen by **grouped, stratified** K-fold cross-validation on the training
      split only (``StratifiedGroupKFold`` with groups = kepid, so no star is in both a CV-train
      and a CV-held-out fold), scored by average precision; then refit on the whole training split.
All models
    * calibration on the validation split (:mod:`exofinder.ml.calibration`): the logit shift
      ``log(n_neg / n_pos)`` introduced by the class weighting is subtracted (``logit_offset``,
      computed from the training split), then a temperature is fitted, so
      ``p = sigmoid((z - logit_offset) / T)``;
    * decision threshold = the F1-optimal threshold on the calibrated validation probabilities
      (metrics at the conventional 0.5 threshold are stored too);
    * deterministic given ``seed`` on CPU with a fixed ``num_threads``; ``torch.set_num_threads``
      is applied for the duration of training and restored afterwards;
    * physical-feature names that look catalogue-derived (dispositions, scores, false-positive
      flags, labels) are refused (:func:`exofinder.ml.features.assert_no_catalogue_features`).

Callbacks
---------
``on_epoch(record)`` receives one dict per epoch (per ensemble member) with keys ``member``,
``epoch``, ``train_loss``, ``val_loss``, ``val_pr_auc``, ``val_roc_auc``, ``val_accuracy``, ``lr``,
``elapsed_s``, ``best_epoch``, ``best_val_pr_auc``, ``improved``, ``progress`` (0-1), ...
``should_stop()`` is polled before every mini-batch (and every CV fit); returning True raises
:class:`TrainingCancelled`. A non-finite loss raises :class:`TrainingDiverged`. Files already
written to ``out_dir`` are left for the caller to clean (``meta.json`` is only written on success).
"""

from __future__ import annotations

import json
import math
import os
import random
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn

from exofinder.config import PIPELINE_VERSION

from ._json import to_jsonable
from .calibration import fit_temperature, logit, prior_logit_offset, sigmoid
from .checkpoint import BASELINE_TYPES, CNN_TYPES, MODEL_TYPES, member_dir, save_model_bundle, save_state_dict
from .dataset_arrays import DatasetArrays
from .device import default_num_threads, environment_info, resolve_device
from .features import assert_no_catalogue_features, baseline_feature_matrix
from .inference import IncompatiblePipelineError
from .metrics import average_precision, best_f1_threshold, classification_metrics, roc_auc
from .models.baselines import (
    count_sklearn_parameters,
    final_estimator,
    make_logreg,
    make_random_forest,
    positive_proba,
)
from .models.cnn import build_cnn, count_parameters
from .splits import assert_no_leakage

EpochCallback = Callable[[dict[str, Any]], None]
StopCallback = Callable[[], bool]


class TrainingCancelled(Exception):
    """Raised when ``should_stop()`` returns True during training."""


class TrainingDiverged(RuntimeError):
    """Raised when the loss or the validation logits become NaN/Inf (e.g. learning rate too high)."""


@dataclass
class TrainConfig:
    """Hyper-parameters of one training run (JSON round-trippable via ``to_dict``/``from_dict``)."""

    model_type: str = "cnn_two_view"
    # --- CNN optimisation -----------------------------------------------------------------------
    lr: float = 1e-4
    batch_size: int = 64
    max_epochs: int = 50
    patience: int = 8
    min_delta: float = 1e-4
    weight_decay: float = 0.0
    dropout: float = 0.3
    fc_width: int = 512
    fc_layers: int = 4
    augment_flip: bool = True
    ensemble_size: int = 1
    # --- shared ---------------------------------------------------------------------------------
    seed: int = 42
    device: str = "auto"
    num_threads: int | None = None  # None -> all logical CPU cores
    # --- baselines (grids searched by grouped CV on the training split) --------------------------
    cv_folds: int = 3
    logreg_c_grid: tuple[float, ...] = (0.001, 0.01, 0.1, 1.0)
    logreg_max_iter: int = 5000
    rf_n_estimators: int = 300
    rf_max_depth_grid: tuple[int | None, ...] = (None, 16)
    rf_min_samples_leaf_grid: tuple[int, ...] = (1, 4)
    rf_max_features_grid: tuple[str | float, ...] = ("sqrt",)

    def __post_init__(self) -> None:
        for name in (
            "logreg_c_grid",
            "rf_max_depth_grid",
            "rf_min_samples_leaf_grid",
            "rf_max_features_grid",
        ):
            setattr(self, name, tuple(getattr(self, name)))
        self.validate()

    def validate(self) -> None:
        if self.model_type not in MODEL_TYPES:
            raise ValueError(f"model_type must be one of {MODEL_TYPES}, got {self.model_type!r}")
        if not self.lr > 0:
            raise ValueError("lr must be positive")
        if self.batch_size < 1 or self.max_epochs < 1 or self.patience < 1:
            raise ValueError("batch_size, max_epochs and patience must be >= 1")
        if not 0.0 <= self.dropout < 1.0:
            raise ValueError("dropout must be in [0, 1)")
        if self.fc_width < 1 or self.fc_layers < 0:
            raise ValueError("fc_width must be >= 1 and fc_layers >= 0")
        if self.ensemble_size < 1:
            raise ValueError("ensemble_size must be >= 1")
        if self.weight_decay < 0:
            raise ValueError("weight_decay must be >= 0")
        if self.num_threads is not None and self.num_threads < 1:
            raise ValueError("num_threads must be >= 1 (or None for all cores)")
        if not self.min_delta >= 0:
            raise ValueError("min_delta must be >= 0")
        if self.cv_folds < 2:
            raise ValueError("cv_folds must be >= 2")
        if not self.logreg_c_grid or any(c <= 0 for c in self.logreg_c_grid):
            raise ValueError("logreg_c_grid must contain positive values")
        for name in ("rf_max_depth_grid", "rf_min_samples_leaf_grid", "rf_max_features_grid"):
            if not getattr(self, name):
                raise ValueError(f"{name} must not be empty")
        if self.rf_n_estimators < 1:
            raise ValueError("rf_n_estimators must be >= 1")

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> TrainConfig:
        """Build from a dict, ignoring unknown keys (forward compatibility)."""
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in d.items() if k in known})

    def resolved_threads(self) -> int:
        return int(self.num_threads or default_num_threads())


@dataclass
class TrainResult:
    """Outcome of :func:`train` (``val_metrics`` are at the chosen ``threshold``)."""

    model_dir: Path
    history: list[dict[str, Any]]
    best_epoch: int
    epochs_run: int
    val_metrics: dict[str, Any]
    threshold: float
    temperature: float
    n_params: int
    duration_s: float
    device: str
    val_metrics_at_0_5: dict[str, Any] = field(default_factory=dict)
    member_best_epochs: list[int] = field(default_factory=list)
    member_epochs_run: list[int] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)
    logit_offset: float = 0.0  # prior correction subtracted before temperature scaling

    def to_dict(self) -> dict[str, Any]:
        return to_jsonable(asdict(self))


# --------------------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------------------
def seed_everything(seed: int) -> None:
    """Seed Python, NumPy and torch global RNGs (torch model init and dropout use the latter)."""
    random.seed(seed)
    np.random.seed(seed % (2**32))
    torch.manual_seed(seed)


def _check_stop(should_stop: StopCallback | None) -> None:
    if should_stop is not None and should_stop():
        raise TrainingCancelled("training cancelled")


def _prepare_splits(arrays: DatasetArrays) -> tuple[DatasetArrays, DatasetArrays]:
    assert_no_leakage(arrays.kepids, arrays.splits)
    train_set, val_set = arrays.subset("train"), arrays.subset("val")
    if len(train_set) == 0:
        raise ValueError("the dataset has no training examples")
    if len(val_set) == 0:
        raise ValueError("the dataset has no validation examples (needed for early stopping/calibration)")
    if np.unique(train_set.labels).size < 2:
        raise ValueError("the training split must contain both classes")
    return train_set, val_set


def _dataset_pipeline_version(arrays: DatasetArrays) -> str:
    version = str(arrays.meta.get("pipeline_version") or PIPELINE_VERSION)
    if version != PIPELINE_VERSION:
        raise IncompatiblePipelineError(
            f"dataset was built with pipeline version {version!r}; the running pipeline is "
            f"{PIPELINE_VERSION!r}. Rebuild the dataset before training."
        )
    return version


def _class_offset(train_set: DatasetArrays) -> float:
    """Prior correction ``log(n_neg / n_pos)`` of the training split (the class weighting used)."""
    n_pos = int(train_set.labels.sum())
    return prior_logit_offset(n_pos, len(train_set) - n_pos)


def _calibrate_and_threshold(
    y_val: np.ndarray, val_logits: np.ndarray, logit_offset: float
) -> tuple[float, float, np.ndarray, dict[str, Any], dict[str, Any]]:
    corrected = val_logits - logit_offset
    temperature = fit_temperature(corrected, y_val)
    p_cal = sigmoid(corrected / temperature)
    threshold = best_f1_threshold(y_val, p_cal)
    return (
        temperature,
        threshold,
        p_cal,
        classification_metrics(y_val, p_cal, threshold),
        classification_metrics(y_val, p_cal, 0.5),
    )


def _base_meta(
    config: TrainConfig, arrays: DatasetArrays, train_set: DatasetArrays, val_set: DatasetArrays
) -> dict:
    return {
        "model_type": config.model_type,
        "config": config.to_dict(),
        "pipeline_version": _dataset_pipeline_version(arrays),
        "dataset_id": arrays.meta.get("dataset_id"),
        "label_mode": arrays.meta.get("label_mode"),
        "feature_names": list(arrays.feature_names),
        "global_bins": arrays.global_bins,
        "local_bins": arrays.local_bins,
        "n_train": len(train_set),
        "n_val": len(val_set),
        "train_counts": {"pos": int(train_set.labels.sum()), "neg": int((train_set.labels == 0).sum())},
        "val_counts": {"pos": int(val_set.labels.sum()), "neg": int((val_set.labels == 0).sum())},
    }


def _write_history(out: Path, history: list[dict[str, Any]]) -> None:
    """Atomically write ``history.json`` (called before ``meta.json``, the bundle's completion marker)."""
    tmp = out / "history.json.tmp"
    tmp.write_text(json.dumps(to_jsonable(history), indent=1), "utf-8")
    os.replace(tmp, out / "history.json")


# --------------------------------------------------------------------------------------------------
# public API
# --------------------------------------------------------------------------------------------------
def train(
    config: TrainConfig,
    arrays: DatasetArrays,
    out_dir: str | Path,
    on_epoch: EpochCallback | None = None,
    should_stop: StopCallback | None = None,
) -> TrainResult:
    """Train ``config.model_type`` on ``arrays`` (train/val splits) and save a bundle to ``out_dir``.

    See the module docstring for the protocol. Raises :class:`TrainingCancelled` when
    ``should_stop()`` returns True, ``ValueError`` for unusable datasets and
    :class:`~exofinder.ml.inference.IncompatiblePipelineError` when the dataset was built with
    another pipeline version.
    """
    config.validate()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    train_set, val_set = _prepare_splits(arrays)
    _dataset_pipeline_version(arrays)
    assert_no_catalogue_features(arrays.feature_names)
    prev_threads = torch.get_num_threads()
    torch.set_num_threads(config.resolved_threads())
    t0 = time.perf_counter()
    try:
        if config.model_type in CNN_TYPES:
            result = _train_cnn(config, arrays, train_set, val_set, out, on_epoch, should_stop, t0)
        elif config.model_type in BASELINE_TYPES:
            result = _train_baseline(config, arrays, train_set, val_set, out, on_epoch, should_stop, t0)
        else:  # pragma: no cover - validated above
            raise ValueError(config.model_type)
    finally:
        torch.set_num_threads(prev_threads)
    return result


# --------------------------------------------------------------------------------------------------
# CNN training
# --------------------------------------------------------------------------------------------------
def _is_improvement(
    pr: float | None, loss: float, best_pr: float, best_loss: float, min_delta: float
) -> bool:
    """Early-stopping criterion: higher validation PR-AUC, ties broken by lower validation loss.

    A PR-AUC gain larger than ``min_delta`` is an improvement. When PR-AUC is unchanged within
    ``min_delta`` (it saturates at 1.0 on easy or small validation sets), a lower validation loss
    counts as an improvement, so the selected epoch keeps improving its probabilities. Without
    PR-AUC (single-class validation split) the validation loss must drop by more than ``min_delta``.
    """
    if pr is None:
        return loss < best_loss - (min_delta if math.isfinite(best_loss) else 0.0)
    if not math.isfinite(best_pr):
        return True
    return pr > best_pr + min_delta or (abs(pr - best_pr) <= min_delta and loss < best_loss)


@dataclass
class _BestTracker:
    """Early-stopping reference values (see :func:`_is_improvement`).

    The PR-AUC reference stays at the **best PR-AUC seen**: when an epoch wins a tie-break (PR-AUC
    within ``min_delta`` but slightly lower, with a lower loss) it becomes the selected epoch, but
    the reference does not drop, so repeated tie-breaks cannot ratchet the PR-AUC down.
    """

    min_delta: float
    use_pr: bool
    best_pr: float = -math.inf
    best_loss: float = math.inf

    def update(self, pr: float | None, loss: float) -> bool:
        pr_used = pr if self.use_pr else None
        improved = _is_improvement(pr_used, loss, self.best_pr, self.best_loss, self.min_delta)
        if improved:
            if pr_used is not None:
                self.best_pr = max(self.best_pr, pr_used)
            self.best_loss = loss
        return improved


def _views_tensors(
    ds: DatasetArrays, device: torch.device
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    g = torch.from_numpy(ds.global_view).unsqueeze(1).to(device)
    loc = torch.from_numpy(ds.local_view).unsqueeze(1).to(device)
    y = torch.from_numpy(ds.labels.astype(np.float32)).to(device)
    return g, loc, y


@torch.no_grad()
def _predict_logits(
    model: nn.Module, g: torch.Tensor, loc: torch.Tensor, batch_size: int = 512
) -> torch.Tensor:
    model.eval()
    out = [model(g[s : s + batch_size], loc[s : s + batch_size]) for s in range(0, g.shape[0], batch_size)]
    return torch.cat(out).float()


def _train_cnn(
    config: TrainConfig,
    arrays: DatasetArrays,
    train_set: DatasetArrays,
    val_set: DatasetArrays,
    out: Path,
    on_epoch: EpochCallback | None,
    should_stop: StopCallback | None,
    t0: float,
) -> TrainResult:
    device = resolve_device(config.device)
    g_tr, l_tr, y_tr = _views_tensors(train_set, device)
    g_va, l_va, y_va_t = _views_tensors(val_set, device)
    y_va = val_set.labels
    n_tr = len(train_set)
    n_pos = int(train_set.labels.sum())
    pos_weight = float((n_tr - n_pos) / n_pos)
    criterion = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([pos_weight], device=device))
    val_has_both = np.unique(y_va).size == 2
    arch = {
        "global_bins": arrays.global_bins,
        "fc_width": config.fc_width,
        "fc_layers": config.fc_layers,
        "dropout": config.dropout,
    }
    if config.model_type == "cnn_two_view":
        arch["local_bins"] = arrays.local_bins

    K = config.ensemble_size
    history: list[dict[str, Any]] = []
    members: list[nn.Module] = []
    member_best: list[int] = []
    member_runs: list[int] = []
    for k in range(K):
        member_seed = int(config.seed) + k
        seed_everything(member_seed)
        gen = torch.Generator().manual_seed(member_seed)
        model = build_cnn(config.model_type, **arch).to(device)
        opt = torch.optim.Adam(model.parameters(), lr=config.lr, weight_decay=config.weight_decay)
        tracker = _BestTracker(min_delta=config.min_delta, use_pr=val_has_both)
        best_state: dict[str, torch.Tensor] | None = None
        best_epoch, best_pr_auc, since_best, epoch = 0, None, 0, 0
        for epoch in range(1, config.max_epochs + 1):
            model.train()
            perm = torch.randperm(n_tr, generator=gen)
            loss_sum = 0.0
            for s in range(0, n_tr, config.batch_size):
                _check_stop(should_stop)
                idx = perm[s : s + config.batch_size]
                flip = torch.rand(idx.numel(), generator=gen) < 0.5 if config.augment_flip else None
                idx_d = idx.to(device)
                gb, lb, yb = g_tr[idx_d], l_tr[idx_d], y_tr[idx_d]
                if flip is not None:
                    fm = flip.to(device)[:, None, None]
                    gb = torch.where(fm, gb.flip(-1), gb)
                    lb = torch.where(fm, lb.flip(-1), lb)
                opt.zero_grad(set_to_none=True)
                loss = criterion(model(gb, lb), yb)
                loss.backward()
                opt.step()
                loss_sum += float(loss.item()) * idx.numel()
            _check_stop(should_stop)
            val_logits = _predict_logits(model, g_va, l_va)
            val_loss = float(criterion(val_logits, y_va_t).item())
            if not (math.isfinite(loss_sum) and math.isfinite(val_loss)):
                raise TrainingDiverged(
                    f"training diverged at epoch {epoch} (member {k}): non-finite loss; "
                    f"try a lower learning rate than {config.lr:g}"
                )
            p_val = sigmoid(val_logits.double().cpu().numpy())
            pr = average_precision(y_va, p_val)
            roc = roc_auc(y_va, p_val)
            acc = float(np.mean((p_val >= 0.5) == (y_va == 1))) if y_va.size else None
            improved = tracker.update(pr, val_loss)
            if improved:
                best_epoch, best_pr_auc, since_best = epoch, pr, 0
                best_state = {n: t.detach().clone() for n, t in model.state_dict().items()}
            else:
                since_best += 1
            record = {
                "member": k,
                "epoch": epoch,
                "train_loss": loss_sum / n_tr,
                "val_loss": val_loss,
                "val_pr_auc": pr,
                "val_roc_auc": roc,
                "val_accuracy": acc,
                "lr": float(opt.param_groups[0]["lr"]),
                "elapsed_s": time.perf_counter() - t0,
                "best_epoch": best_epoch,
                "best_val_pr_auc": best_pr_auc,
                "improved": bool(improved),
                "epochs_since_improvement": since_best,
                "n_members": K,
                "max_epochs": config.max_epochs,
                "progress": min(1.0, (k + epoch / config.max_epochs) / K),
            }
            history.append(record)
            if on_epoch is not None:
                on_epoch(dict(record))
            if since_best >= config.patience:
                break
        save_state_dict(member_dir(out, k) / "last.pt", model)
        assert best_state is not None
        model.load_state_dict(best_state)
        model.eval()
        members.append(model)
        member_best.append(best_epoch)
        member_runs.append(epoch)

    _check_stop(should_stop)
    member_val = torch.stack([_predict_logits(m, g_va, l_va) for m in members], dim=1)
    val_logits_ens = member_val.mean(dim=1).double().cpu().numpy()
    logit_offset = _class_offset(train_set)  # == log(pos_weight)
    temperature, threshold, _, val_metrics, val_metrics_05 = _calibrate_and_threshold(
        y_va, val_logits_ens, logit_offset
    )
    duration = time.perf_counter() - t0
    n_params = count_parameters(members[0]) * K
    meta = _base_meta(config, arrays, train_set, val_set)
    meta.update(
        {
            "threshold": threshold,
            "temperature": temperature,
            "logit_offset": logit_offset,
            "calibration_method": "prior_correction+temperature",
            "ensemble_size": K,
            "pos_weight": pos_weight,
            "val_metrics": val_metrics,
            "val_metrics_at_0_5": val_metrics_05,
            "member_best_epochs": member_best,
            "member_epochs_run": member_runs,
            "monitor": "val_pr_auc" if val_has_both else "val_loss",
            "device": str(device),
            "num_threads": config.resolved_threads(),
            "duration_s": duration,
            "environment": environment_info(),
            "n_params": n_params,
        }
    )
    _write_history(out, history)
    final_meta = save_model_bundle(out, [m.cpu() for m in members], meta)  # meta.json last
    return TrainResult(
        model_dir=out,
        history=history,
        best_epoch=member_best[0],
        epochs_run=member_runs[0],
        val_metrics=val_metrics,
        threshold=threshold,
        temperature=temperature,
        n_params=n_params,
        duration_s=duration,
        device=str(device),
        val_metrics_at_0_5=val_metrics_05,
        member_best_epochs=member_best,
        member_epochs_run=member_runs,
        meta=final_meta,
        logit_offset=logit_offset,
    )


# --------------------------------------------------------------------------------------------------
# Baselines
# --------------------------------------------------------------------------------------------------
def _baseline_grid(config: TrainConfig) -> tuple[Callable[..., Any], dict[str, Any], list[dict[str, Any]]]:
    from sklearn.model_selection import ParameterGrid

    if config.model_type == "logreg":
        fixed = {"max_iter": config.logreg_max_iter, "random_state": config.seed}
        grid = list(ParameterGrid({"C": list(config.logreg_c_grid)}))
        return make_logreg, fixed, grid
    fixed = {
        "n_estimators": config.rf_n_estimators,
        "random_state": config.seed,
        "n_jobs": config.resolved_threads(),
    }
    grid = list(
        ParameterGrid(
            {
                "max_depth": list(config.rf_max_depth_grid),
                "min_samples_leaf": list(config.rf_min_samples_leaf_grid),
                "max_features": list(config.rf_max_features_grid),
            }
        )
    )
    return make_random_forest, fixed, grid


def _log_loss(y: np.ndarray, p: np.ndarray) -> float | None:
    if y.size == 0:
        return None
    q = np.clip(p, 1e-7, 1 - 1e-7)
    return float(-np.mean(y * np.log(q) + (1 - y) * np.log1p(-q)))


def _top_features(pipeline: Any, names: list[str], k: int = 25) -> list[dict[str, Any]]:
    clf = final_estimator(pipeline)
    if hasattr(clf, "feature_importances_"):
        weights = np.asarray(clf.feature_importances_, dtype=np.float64)
        key = weights
    elif hasattr(clf, "coef_"):
        weights = np.asarray(clf.coef_, dtype=np.float64).ravel()  # on standardised features
        key = np.abs(weights)
    else:  # pragma: no cover
        return []
    order = np.argsort(-key, kind="mergesort")[:k]
    return [{"name": names[i], "weight": float(weights[i])} for i in order]


def _train_baseline(
    config: TrainConfig,
    arrays: DatasetArrays,
    train_set: DatasetArrays,
    val_set: DatasetArrays,
    out: Path,
    on_epoch: EpochCallback | None,
    should_stop: StopCallback | None,
    t0: float,
) -> TrainResult:
    from sklearn.model_selection import StratifiedGroupKFold

    seed_everything(config.seed)
    X_tr, names = baseline_feature_matrix(
        train_set.global_view, train_set.local_view, train_set.features, train_set.feature_names
    )
    X_va, _ = baseline_feature_matrix(
        val_set.global_view, val_set.local_view, val_set.features, val_set.feature_names
    )
    y_tr, y_va = train_set.labels, val_set.labels
    factory, fixed, grid = _baseline_grid(config)

    n_groups = int(np.unique(train_set.kepids).size)
    n_splits = min(config.cv_folds, n_groups)
    cv_results: list[dict[str, Any]] = []
    if n_splits >= 2 and len(grid) > 1:
        cv = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=config.seed)
        folds = list(cv.split(X_tr, y_tr, groups=train_set.kepids))
        for params in grid:
            scores = []
            for tr_idx, te_idx in folds:
                _check_stop(should_stop)
                if np.unique(y_tr[tr_idx]).size < 2:
                    continue
                est = factory(**fixed, **params).fit(X_tr[tr_idx], y_tr[tr_idx])
                ap = average_precision(y_tr[te_idx], positive_proba(est, X_tr[te_idx]))
                if ap is not None:
                    scores.append(ap)
            cv_results.append(
                {
                    "params": params,
                    "mean_ap": float(np.mean(scores)) if scores else None,
                    "std_ap": float(np.std(scores)) if scores else None,
                    "fold_scores": scores,
                }
            )
        scored = [
            (r["mean_ap"] if r["mean_ap"] is not None else -math.inf, -i) for i, r in enumerate(cv_results)
        ]
        best_params = cv_results[-max(scored)[1]]["params"]
    else:
        best_params = grid[0]

    _check_stop(should_stop)
    model = factory(**fixed, **best_params).fit(X_tr, y_tr)
    _check_stop(should_stop)
    p_tr = positive_proba(model, X_tr)
    p_va = positive_proba(model, X_va)
    val_logits = logit(p_va)
    logit_offset = _class_offset(train_set)  # class_weight="balanced" shifts logits by this much
    temperature, threshold, _, val_metrics, val_metrics_05 = _calibrate_and_threshold(
        y_va, val_logits, logit_offset
    )
    duration = time.perf_counter() - t0
    record = {
        "member": 0,
        "epoch": 1,
        "train_loss": _log_loss(y_tr, p_tr),
        "val_loss": _log_loss(y_va, p_va),
        "val_pr_auc": average_precision(y_va, p_va),
        "val_roc_auc": roc_auc(y_va, p_va),
        "val_accuracy": float(np.mean((p_va >= 0.5) == (y_va == 1))),
        "lr": None,
        "elapsed_s": duration,
        "best_epoch": 1,
        "best_val_pr_auc": average_precision(y_va, p_va),
        "improved": True,
        "epochs_since_improvement": 0,
        "n_members": 1,
        "max_epochs": 1,
        "progress": 1.0,
    }
    history = [record]
    if on_epoch is not None:
        on_epoch(dict(record))
    n_params = count_sklearn_parameters(model)
    meta = _base_meta(config, arrays, train_set, val_set)
    meta.update(
        {
            "threshold": threshold,
            "temperature": temperature,
            "logit_offset": logit_offset,
            "calibration_method": "prior_correction+temperature",
            "ensemble_size": 1,
            "val_metrics": val_metrics,
            "val_metrics_at_0_5": val_metrics_05,
            "best_params": {**fixed, **best_params},
            "cv_results": cv_results,
            "cv_folds": n_splits,
            "cv_scoring": "average_precision",
            "n_input_features": int(X_tr.shape[1]),
            "input_feature_names": names,
            "top_features": _top_features(model, names),
            "device": "cpu",
            "num_threads": config.resolved_threads(),
            "duration_s": duration,
            "environment": environment_info(),
            "n_params": n_params,
            "n_params_meaning": "coefficients+intercept"
            if config.model_type == "logreg"
            else "total tree nodes",
        }
    )
    _write_history(out, history)
    final_meta = save_model_bundle(out, model, meta)  # meta.json last
    return TrainResult(
        model_dir=out,
        history=history,
        best_epoch=1,
        epochs_run=1,
        val_metrics=val_metrics,
        threshold=threshold,
        temperature=temperature,
        n_params=n_params,
        duration_s=duration,
        device="cpu",
        val_metrics_at_0_5=val_metrics_05,
        member_best_epochs=[1],
        member_epochs_run=[1],
        meta=final_meta,
        logit_offset=logit_offset,
    )


# --------------------------------------------------------------------------------------------------
# Timing estimate (for the UI's "how long will this take?")
# --------------------------------------------------------------------------------------------------
def estimate_epoch_seconds(config: TrainConfig, arrays: DatasetArrays, n_batches: int = 4) -> dict[str, Any]:
    """Measure a few CNN training steps on the dataset's own training examples and extrapolate.

    A throw-away network is trained for ``n_batches`` mini-batches (after two warm-up batches) inside
    a forked RNG, so global RNG state and saved models are untouched. Returns
    ``{seconds_per_epoch, seconds_per_batch, batches_per_epoch, n_train, device, num_threads}``;
    baselines have no epochs and return ``seconds_per_epoch=None``.
    """
    train_set = arrays.subset("train")
    info: dict[str, Any] = {
        "model_type": config.model_type,
        "n_train": len(train_set),
        "batches_per_epoch": math.ceil(len(train_set) / config.batch_size) if len(train_set) else 0,
        "seconds_per_epoch": None,
        "seconds_per_batch": None,
        "num_threads": config.resolved_threads(),
    }
    if config.model_type not in CNN_TYPES or len(train_set) == 0:
        info["device"] = "cpu"
        return info
    device = resolve_device(config.device)
    prev = torch.get_num_threads()
    torch.set_num_threads(config.resolved_threads())
    try:
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(config.seed)
            arch: dict[str, Any] = {
                "global_bins": arrays.global_bins,
                "fc_width": config.fc_width,
                "fc_layers": config.fc_layers,
                "dropout": config.dropout,
            }
            if config.model_type == "cnn_two_view":
                arch["local_bins"] = arrays.local_bins
            model = build_cnn(config.model_type, **arch).to(device).train()
            opt = torch.optim.Adam(model.parameters(), lr=config.lr)
            bs = min(config.batch_size, len(train_set))
            g, loc, y = _views_tensors(train_set.select(np.arange(bs)), device)
            lossf = nn.BCEWithLogitsLoss()

            def step() -> None:
                opt.zero_grad(set_to_none=True)
                lossf(model(g, loc), y).backward()
                opt.step()

            for _ in range(2):  # warm-up: allocations, Adam state, oneDNN/cuDNN kernel selection
                step()
            times = []
            for _ in range(max(1, n_batches)):
                t = time.perf_counter()
                step()
                times.append(time.perf_counter() - t)
            per_batch = float(np.median(times))  # median: robust to scheduler noise
    finally:
        torch.set_num_threads(prev)
    # Validation forward passes cost roughly 1/3 of a training step per example.
    n_val = int((arrays.splits == "val").sum())
    per_epoch = per_batch * (info["batches_per_epoch"] + n_val / max(bs, 1) / 3.0)
    info.update({"seconds_per_batch": per_batch, "seconds_per_epoch": per_epoch, "device": str(device)})
    return info


__all__ = [
    "MODEL_TYPES",
    "TrainConfig",
    "TrainResult",
    "TrainingCancelled",
    "TrainingDiverged",
    "estimate_epoch_seconds",
    "seed_everything",
    "train",
]
