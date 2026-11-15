"""Scoring signals with a trained model bundle.

Outputs
-------
For every example the :class:`Predictor` returns

* ``logits`` — the raw (uncalibrated) model logit; for an ensemble the **mean of the member
  logits** (pooling in log-odds space);
* ``raw_prob`` = sigmoid(logit) — the uncalibrated probability;
* ``prob`` = sigmoid((logit - logit_offset) / T) — the **calibrated** probability of
  "planet-like": ``logit_offset`` = log(n_neg / n_pos) undoes the class weighting used in training
  and the temperature ``T`` is fitted on the validation set (:mod:`exofinder.ml.calibration`);
* ``member_probs`` — calibrated probability of each ensemble member (CNN ensembles only);
* ``uncertainty`` — a standard deviation of calibrated probabilities that expresses how much the
  model "disagrees with itself":

  - **ensemble** (K > 1 CNNs): std over the K members' probabilities;
  - **MC-dropout** (single CNN): std over 20 stochastic passes with dropout kept active
    (Gal & Ghahramani 2016). Dropout lives only in the fully-connected head, so the convolutional
    features are computed once and only the head is resampled. The 20 dropout masks are drawn
    once per call from a private, fixed-seed ``torch.Generator`` and shared by every example
    (20 fixed "thinned" sub-networks), so an example's uncertainty does not depend on which other
    examples are in the batch, the global RNG is never touched, and the model is never switched
    to training mode (a shared :class:`Predictor` is safe to call from several threads);
  - **random forest**: std over the per-tree probabilities (each calibrated with ``T``);
  - **logistic regression**: ``None`` (a single deterministic linear model offers no spread).

  This is a *model* uncertainty heuristic, not a full posterior; it does not capture label noise
  or problems in the input data (see the quality report for those).

Pipeline-version guard
----------------------
Views and features depend on preprocessing details (detrending, binning, normalisation). A model
trained on one ``PIPELINE_VERSION`` must not score inputs from another, so loading a bundle whose
version differs from the running pipeline raises :class:`IncompatiblePipelineError`, as does
calling :meth:`Predictor.predict` with inputs labelled with a different version.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import torch
from torch import nn

from exofinder.config import PIPELINE_VERSION

from .calibration import apply_temperature, logit
from .checkpoint import BASELINE_TYPES, CNN_TYPES, LoadedModel, load_model_bundle
from .device import resolve_device
from .features import baseline_feature_matrix
from .models.baselines import positive_proba, tree_probabilities
from .models.cnn import has_dropout

DEFAULT_MC_PASSES = 20
MC_SEED = 1234


class IncompatiblePipelineError(RuntimeError):
    """The model was trained on views from a different preprocessing-pipeline version."""


@dataclass
class PredictionOutput:
    """Batch prediction (arrays have one entry per example)."""

    prob: np.ndarray
    raw_prob: np.ndarray
    uncertainty: np.ndarray | None
    member_probs: np.ndarray | None
    logits: np.ndarray
    threshold: float = 0.5
    uncertainty_method: str | None = None  # ensemble_std | mc_dropout_std | tree_vote_std | None
    inference_ms: float = 0.0  # wall time of the whole batch

    @property
    def predicted_label(self) -> np.ndarray:
        """1 where the calibrated probability reaches the model's decision threshold."""
        return (self.prob >= self.threshold).astype(np.int64)

    def __len__(self) -> int:
        return int(self.prob.shape[0])


def _as_batch(x: Any, length: int | None, name: str) -> np.ndarray:
    a = np.asarray(x, dtype=np.float32)
    if a.ndim == 1:
        a = a[None, :]
    if a.ndim == 3 and a.shape[1] == 1:
        a = a[:, 0, :]
    if a.ndim != 2:
        raise ValueError(f"{name} must have shape (N, bins)")
    if length is not None and a.shape[1] != length:
        raise ValueError(f"{name} has {a.shape[1]} bins; this model expects {length}")
    if not np.isfinite(a).all():
        raise ValueError(f"{name} contains NaN or Inf values")
    return a


def _mc_dropout_masks(
    head: nn.Module, passes: int, seed: int, device: torch.device
) -> list[list[torch.Tensor]]:
    """Inverted-dropout keep masks for every active ``Dropout`` of ``head``, one list per pass.

    Each mask has shape ``(width,)`` (broadcast over the batch), keeps a unit with probability
    ``1 - p`` and rescales kept units by ``1 / (1 - p)``, exactly like :class:`torch.nn.Dropout`
    in training mode. Drawn on the CPU from a private generator (deterministic, thread-safe).
    """
    if not isinstance(head, nn.Sequential):
        raise TypeError("MC-dropout expects the model head to be an nn.Sequential")
    specs: list[tuple[float, int]] = []
    width: int | None = None
    for layer in head:
        if isinstance(layer, nn.Linear):
            width = int(layer.out_features)
        elif isinstance(layer, nn.Dropout) and layer.p > 0:
            if width is None:
                raise TypeError("MC-dropout expects every Dropout in the head to follow a Linear layer")
            specs.append((float(layer.p), width))
    gen = torch.Generator(device="cpu").manual_seed(int(seed))
    return [
        [((torch.rand(w, generator=gen) >= p).float() / (1.0 - p)).to(device) for p, w in specs]
        for _ in range(passes)
    ]


def _head_with_masks(head: nn.Module, x: torch.Tensor, masks: list[torch.Tensor]) -> torch.Tensor:
    """Run ``head`` with fixed dropout ``masks`` instead of its (eval-mode, identity) Dropout layers."""
    i = 0
    for layer in head:  # type: ignore[union-attr]
        if isinstance(layer, nn.Dropout):
            if layer.p > 0:
                x = x * masks[i]
                i += 1
        else:
            x = layer(x)
    return x


class Predictor:
    """Calibrated scoring with uncertainty for one model bundle."""

    def __init__(
        self,
        loaded: LoadedModel,
        device: str | torch.device = "auto",
        mc_dropout_passes: int = DEFAULT_MC_PASSES,
        mc_seed: int = MC_SEED,
    ) -> None:
        self.loaded = loaded
        self.meta = loaded.meta
        self.model_type = loaded.model_type
        self.device = resolve_device(device)
        self.mc_dropout_passes = int(mc_dropout_passes)
        self.mc_seed = int(mc_seed)
        self.models = [m.to(self.device).eval() for m in loaded.torch_models]
        self.sklearn_model = loaded.sklearn_model
        arch = (self.meta.get("architecture") or {}).get("kwargs", {})
        self.global_bins: int | None = arch.get("global_bins", self.meta.get("global_bins"))
        self.local_bins: int | None = arch.get("local_bins", self.meta.get("local_bins"))
        self.last_inference_ms: float | None = None

    # ------------------------------------------------------------------------------------------
    @classmethod
    def from_dir(
        cls,
        directory: str | os.PathLike[str],
        device: str | torch.device = "auto",
        expected_pipeline_version: str | None = None,
        mc_dropout_passes: int = DEFAULT_MC_PASSES,
    ) -> Predictor:
        """Load a bundle; refuse it if its pipeline version differs from the running pipeline.

        ``expected_pipeline_version`` defaults to :data:`exofinder.config.PIPELINE_VERSION`.
        """
        loaded = load_model_bundle(directory)
        expected = PIPELINE_VERSION if expected_pipeline_version is None else expected_pipeline_version
        if loaded.pipeline_version != expected:
            raise IncompatiblePipelineError(
                f"model in {directory} was trained on pipeline version {loaded.pipeline_version!r}, "
                f"but the running pipeline is {expected!r}; retrain the model on a dataset built "
                "with the current pipeline"
            )
        return cls(loaded, device=device, mc_dropout_passes=mc_dropout_passes)

    @property
    def threshold(self) -> float:
        return self.loaded.threshold

    @property
    def temperature(self) -> float:
        return self.loaded.temperature

    @property
    def logit_offset(self) -> float:
        """Prior correction subtracted before temperature scaling (0 for older bundles)."""
        return self.loaded.logit_offset

    @property
    def pipeline_version(self) -> str:
        return self.loaded.pipeline_version

    @property
    def ensemble_size(self) -> int:
        return len(self.models) if self.models else 1

    @property
    def physical_feature_names(self) -> list[str]:
        return list(self.meta.get("feature_names") or [])

    @property
    def inputs(self) -> tuple[str, ...]:
        """Which inputs :meth:`predict` needs for this model type."""
        if self.model_type == "cnn_single":
            return ("global",)
        if self.model_type == "cnn_two_view":
            return ("global", "local")
        return ("global", "local", "features")

    # ------------------------------------------------------------------------------------------
    def predict(
        self,
        global_view: Any = None,
        local_view: Any = None,
        features: Any = None,
        *,
        with_uncertainty: bool = True,
        pipeline_version: str | None = None,
        batch_size: int = 256,
    ) -> PredictionOutput:
        """Score a batch of examples (1-D inputs are treated as a batch of one).

        ``pipeline_version`` (optional) is the version that produced the inputs; a mismatch raises
        :class:`IncompatiblePipelineError`. ``with_uncertainty=False`` skips MC-dropout and the
        per-tree pass (faster; ``uncertainty`` is then ``None`` except for ensembles, whose spread
        comes for free).
        """
        if pipeline_version is not None and pipeline_version != self.pipeline_version:
            raise IncompatiblePipelineError(
                f"inputs come from pipeline version {pipeline_version!r} but the model expects "
                f"{self.pipeline_version!r}"
            )
        if int(batch_size) < 1:
            raise ValueError("batch_size must be >= 1")
        t0 = time.perf_counter()
        if self.model_type in CNN_TYPES:
            out = self._predict_cnn(global_view, local_view, with_uncertainty, batch_size)
        elif self.model_type in BASELINE_TYPES:
            out = self._predict_sklearn(global_view, local_view, features, with_uncertainty)
        else:  # pragma: no cover - guarded by load_model_bundle
            raise ValueError(f"unsupported model type {self.model_type!r}")
        out.inference_ms = (time.perf_counter() - t0) * 1000.0
        self.last_inference_ms = out.inference_ms
        return out

    # ------------------------------------------------------------------------------------------
    def _predict_cnn(
        self, global_view: Any, local_view: Any, with_uncertainty: bool, batch_size: int
    ) -> PredictionOutput:
        if global_view is None:
            raise ValueError("this model needs the global view")
        g = _as_batch(global_view, self.global_bins, "global view")
        loc = None
        if self.model_type == "cnn_two_view":
            if local_view is None:
                raise ValueError("this model needs the local view")
            loc = _as_batch(local_view, self.local_bins, "local view")
            if loc.shape[0] != g.shape[0]:
                raise ValueError("global and local views have different numbers of rows")
        T, offset = self.temperature, self.logit_offset
        n, n_members = g.shape[0], len(self.models)
        use_mc = (
            n_members == 1 and with_uncertainty and self.mc_dropout_passes > 1 and has_dropout(self.models[0])
        )
        masks = (
            _mc_dropout_masks(self.models[0].head, self.mc_dropout_passes, self.mc_seed, self.device)  # type: ignore[arg-type]
            if use_mc
            else None
        )
        logits_k = np.empty((n, n_members), dtype=np.float64)
        mc_logits = np.empty((n, self.mc_dropout_passes), dtype=np.float64) if masks is not None else None
        # Models stay in eval mode (set once in __init__); nothing here mutates shared state.
        # The head runs per mini-batch, so memory stays O(batch_size) for any number of examples.
        with torch.inference_mode():
            for s in range(0, n, batch_size):
                e = min(s + batch_size, n)
                gt = torch.from_numpy(g[s:e]).unsqueeze(1).to(self.device)
                lt = None if loc is None else torch.from_numpy(loc[s:e]).unsqueeze(1).to(self.device)
                for k, model in enumerate(self.models):
                    emb = model.embed(gt, lt)  # type: ignore[operator]
                    logits_k[s:e, k] = model.head(emb).squeeze(-1).double().cpu().numpy()  # type: ignore[operator]
                    if mc_logits is not None and masks is not None:
                        for j, pass_masks in enumerate(masks):
                            out_j = _head_with_masks(model.head, emb, pass_masks)  # type: ignore[arg-type]
                            mc_logits[s:e, j] = out_j.squeeze(-1).double().cpu().numpy()
        mean_logit = logits_k.mean(axis=1)
        member_probs = apply_temperature(logits_k, T, offset)
        if n_members > 1:
            uncertainty, method = member_probs.std(axis=1), "ensemble_std"
        elif mc_logits is not None:
            uncertainty, method = apply_temperature(mc_logits, T, offset).std(axis=1), "mc_dropout_std"
        else:
            uncertainty, method = None, None
        return PredictionOutput(
            prob=apply_temperature(mean_logit, T, offset),
            raw_prob=apply_temperature(mean_logit, 1.0),
            uncertainty=uncertainty,
            member_probs=member_probs if n_members > 1 else None,
            logits=mean_logit,
            threshold=self.threshold,
            uncertainty_method=method,
        )

    def _predict_sklearn(
        self, global_view: Any, local_view: Any, features: Any, with_uncertainty: bool
    ) -> PredictionOutput:
        if global_view is None or local_view is None:
            raise ValueError("baseline models need the global and local views")
        g = _as_batch(global_view, self.meta.get("global_bins"), "global view")
        loc = _as_batch(local_view, self.meta.get("local_bins"), "local view")
        names = self.physical_feature_names
        if names:
            if features is None:
                raise ValueError("this model needs the physical features")
            phys = _as_batch(features, len(names), "features")
        else:
            phys = np.zeros((g.shape[0], 0), dtype=np.float32)
        if loc.shape[0] != g.shape[0] or phys.shape[0] != g.shape[0]:
            raise ValueError("global view, local view and features have different numbers of rows")
        X, _ = baseline_feature_matrix(g, loc, phys, physical_names=names)
        expected = self.meta.get("n_input_features")
        if expected is not None and X.shape[1] != expected:
            raise ValueError(f"feature matrix has {X.shape[1]} columns; the model expects {expected}")
        T, offset = self.temperature, self.logit_offset
        is_rf = self.model_type == "random_forest"
        if X.shape[0] == 0:  # scikit-learn refuses empty inputs; an empty batch has empty outputs
            empty = np.zeros(0, dtype=np.float64)
            return PredictionOutput(
                prob=empty,
                raw_prob=empty.copy(),
                uncertainty=empty.copy() if (with_uncertainty and is_rf) else None,
                member_probs=None,
                logits=empty.copy(),
                threshold=self.threshold,
                uncertainty_method="tree_vote_std" if (with_uncertainty and is_rf) else None,
            )
        if is_rf:
            # Thread-pool start-up dominates small batches; parallelise over trees only for big ones.
            n_jobs = 1 if X.shape[0] < 256 else min(4, os.cpu_count() or 1)
            self.sklearn_model.steps[-1][1].set_params(n_jobs=n_jobs)
        raw = positive_proba(self.sklearn_model, X)
        z = logit(raw)
        uncertainty, method = None, None
        if with_uncertainty and is_rf:
            trees = tree_probabilities(self.sklearn_model, X)
            uncertainty, method = apply_temperature(logit(trees), T, offset).std(axis=1), "tree_vote_std"
        return PredictionOutput(
            prob=apply_temperature(z, T, offset),
            raw_prob=np.asarray(raw, dtype=np.float64),
            uncertainty=uncertainty,
            member_probs=None,
            logits=z,
            threshold=self.threshold,
            uncertainty_method=method,
        )


__all__ = ["DEFAULT_MC_PASSES", "IncompatiblePipelineError", "PredictionOutput", "Predictor"]
