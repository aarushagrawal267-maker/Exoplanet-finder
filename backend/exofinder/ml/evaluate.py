"""Held-out evaluation of a trained model.

:func:`evaluate` scores one split (by default the **test** split, which training never touches)
with a :class:`~exofinder.ml.inference.Predictor` and returns everything the Evaluation page and the
research report need: point metrics at the model's validation-chosen threshold (and at 0.5),
95 % bootstrap confidence intervals (resampling whole stars, since signals of one star are
correlated), ROC / precision-recall / reliability curves, the confusion matrix, inference timing and
per-example scores.

Timing is measured on the evaluation device with uncertainty estimation switched off (the core
forward pass): ``ms_per_sample_batch1`` is the median latency of single-example calls,
``ms_per_sample_batch64`` the median time of a 64-example batch divided by 64.
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any

import numpy as np

from ._json import to_jsonable
from .calibration import reliability_curve
from .dataset_arrays import DatasetArrays
from .inference import IncompatiblePipelineError, Predictor
from .metrics import bootstrap_ci, classification_metrics, confusion, pr_curve_points, roc_curve_points


@dataclass
class EvaluationResult:
    split: str
    threshold: float
    metrics: dict[str, Any]
    ci: dict[str, Any]
    curves: dict[str, Any]
    confusion: dict[str, int]
    timing: dict[str, Any]
    per_example: list[dict[str, Any]]
    metrics_at_0_5: dict[str, Any] = field(default_factory=dict)
    ci_method: dict[str, Any] = field(default_factory=dict)  # n_boot, alpha, resampling unit
    model_type: str = ""
    pipeline_version: str = ""

    def to_dict(self) -> dict[str, Any]:
        """JSON-safe dict (NaN -> None)."""
        return to_jsonable(asdict(self))


def _slice(arr: np.ndarray | None, idx: np.ndarray) -> np.ndarray | None:
    return None if arr is None else arr[idx]


def measure_timing(
    predictor: Predictor, ds: DatasetArrays, n_single: int = 20, n_batch_repeats: int = 3
) -> dict[str, Any]:
    """Inference latency per sample at batch size 1 and 64 (median of repeats, warm-up excluded)."""
    n = len(ds)
    if n == 0:
        return {"ms_per_sample_batch1": None, "ms_per_sample_batch64": None, "device": str(predictor.device)}
    feats = ds.features if ds.features.shape[1] else None

    def run(idx: np.ndarray) -> float:
        t = time.perf_counter()
        predictor.predict(ds.global_view[idx], ds.local_view[idx], _slice(feats, idx), with_uncertainty=False)
        return (time.perf_counter() - t) * 1000.0

    run(np.array([0]))  # warm-up
    singles = [run(np.array([i % n])) for i in range(min(n_single, max(n, 1)))]
    batch_idx = np.arange(64) % n
    run(batch_idx)  # warm-up
    batches = [run(batch_idx) for _ in range(n_batch_repeats)]
    return {
        "ms_per_sample_batch1": float(np.median(singles)),
        "ms_per_sample_batch64": float(np.median(batches) / 64.0),
        "device": str(predictor.device),
        "n_single_calls": len(singles),
        "n_batch_repeats": n_batch_repeats,
        "with_uncertainty": False,
    }


def evaluate(
    predictor: Predictor,
    arrays: DatasetArrays,
    split: str = "test",
    threshold: float | None = None,
    n_boot: int = 1000,
    seed: int = 0,
    with_uncertainty: bool = False,
    bootstrap_by_star: bool = True,
    timing: bool = True,
) -> EvaluationResult:
    """Evaluate ``predictor`` on one split of ``arrays`` (``"test"``, ``"val"``, ``"train"`` or ``"all"``).

    ``threshold`` defaults to the model's validation-chosen threshold. ``with_uncertainty`` adds
    per-example uncertainties (slower for single CNNs: 20 MC-dropout passes of the head).
    """
    dataset_version = arrays.meta.get("pipeline_version")
    if dataset_version and str(dataset_version) != predictor.pipeline_version:
        raise IncompatiblePipelineError(
            f"dataset pipeline version {dataset_version!r} does not match the model's "
            f"{predictor.pipeline_version!r}"
        )
    ds = arrays.subset(split)
    if len(ds) == 0:
        raise ValueError(f"split {split!r} has no examples")
    thr = predictor.threshold if threshold is None else float(threshold)
    feats = ds.features if ds.features.shape[1] else None
    out = predictor.predict(ds.global_view, ds.local_view, feats, with_uncertainty=with_uncertainty)
    y, p = ds.labels, out.prob
    metrics = classification_metrics(y, p, thr)
    ci = bootstrap_ci(y, p, thr, n_boot=n_boot, seed=seed, groups=ds.kepids if bootstrap_by_star else None)
    curves = {
        "roc": roc_curve_points(y, p),
        "pr": pr_curve_points(y, p),
        "calibration": reliability_curve(y, p, n_bins=10),
    }
    per_example = []
    for i in range(len(ds)):
        row: dict[str, Any] = {
            "signal_id": int(ds.signal_ids[i]),
            "kepid": int(ds.kepids[i]),
            "label": int(y[i]),
            "prob": float(p[i]),
            "raw_prob": float(out.raw_prob[i]),
            "predicted_label": int(p[i] >= thr),
        }
        if out.uncertainty is not None:
            row["uncertainty"] = float(out.uncertainty[i])
        per_example.append(row)
    timing_info = measure_timing(predictor, ds) if timing else {"device": str(predictor.device)}
    ci_method = {
        "n_boot": n_boot,
        "alpha": 0.05,
        "method": "percentile",
        "resample": "star" if bootstrap_by_star else "example",
        "seed": seed,
    }
    return EvaluationResult(
        split=split,
        threshold=thr,
        metrics=metrics,
        ci=ci,
        curves=curves,
        confusion=confusion(y, p, thr),
        timing=timing_info,
        per_example=per_example,
        metrics_at_0_5=classification_metrics(y, p, 0.5),
        ci_method=ci_method,
        model_type=predictor.model_type,
        pipeline_version=predictor.pipeline_version,
    )


__all__ = ["EvaluationResult", "evaluate", "measure_timing"]
