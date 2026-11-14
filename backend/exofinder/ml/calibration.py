"""Probability calibration: temperature scaling, reliability curves and expected calibration error.

A classifier is *calibrated* when, among all signals it scores at probability ``p``, a fraction
``p`` really is planet-like. Neural networks trained with class-weighted cross-entropy are usually
mis-calibrated (over-confident, and shifted by the class weighting). **Temperature scaling**
(Guo et al. 2017) fixes the confidence with one parameter fitted on the *validation* set:

    p_calibrated = sigmoid(z / T)

where ``z`` is the model logit. ``T > 1`` softens over-confident predictions, ``T < 1`` sharpens
under-confident ones. Dividing by a positive constant does not change the ranking of signals, so
ROC-AUC and PR-AUC are unaffected; only the probability values (Brier score, ECE, and the meaning
of a threshold) change.

Prior correction for class-weighted training
--------------------------------------------
All four model types are trained with class weighting (``pos_weight = n_neg / n_pos`` for the CNNs,
``class_weight="balanced"`` for the baselines). For such a loss the population-optimal logit is the
true log-odds **plus** ``log(n_neg / n_pos)``: the weighting inflates every probability of the
positive class. A temperature can only stretch logits, never shift them, so before temperature
scaling the known offset is subtracted (``logit_offset``, :func:`prior_logit_offset`)::

    p_calibrated = sigmoid((z - logit_offset) / T)

The offset is not fitted (it follows from the training class counts), so it adds no parameter that
could overfit a small validation set.

The reliability curve groups predictions into equal-width probability bins and compares the mean
predicted probability with the observed fraction of positives in each bin; the **expected
calibration error** (ECE) is the example-weighted mean absolute gap.
"""

from __future__ import annotations

import math

import numpy as np
import torch

T_MIN = 0.05
T_MAX = 20.0


def sigmoid(z: np.ndarray | float) -> np.ndarray:
    """Numerically stable logistic function."""
    z = np.asarray(z, dtype=np.float64)
    out = np.empty_like(z)
    pos = z >= 0
    out[pos] = 1.0 / (1.0 + np.exp(-z[pos]))
    ez = np.exp(z[~pos])
    out[~pos] = ez / (1.0 + ez)
    return out


def logit(p: np.ndarray | float, eps: float = 1e-6) -> np.ndarray:
    """Inverse of :func:`sigmoid`, clipping ``p`` to ``[eps, 1 - eps]``."""
    q = np.clip(np.asarray(p, dtype=np.float64), eps, 1.0 - eps)
    return np.log(q) - np.log1p(-q)


def fit_temperature(logits: np.ndarray, y: np.ndarray, max_iter: int = 200) -> float:
    """Fit the temperature ``T`` minimising the binary NLL of ``sigmoid(logits / T)``.

    Optimises ``log T`` (so T stays positive) with L-BFGS in float64, starting at ``T = 1``. The
    result is clamped to ``[0.05, 20]``. With fewer than two examples, a single class, or all-zero
    logits the NLL has no informative minimum and ``1.0`` (no rescaling) is returned.

    The same applies when the logits separate the classes **by sign** (every positive ``z >= 0`` and
    every negative ``z <= 0``, common for small validation sets): the NLL then decreases
    monotonically as ``T -> 0``, so the "optimum" would be the lower clamp, multiplying every logit
    by 20 and turning each later mistake into a near-certain one. The data do not identify ``T`` in
    that case, so ``1.0`` is returned.

    Pass prior-corrected logits (``z - logit_offset``) when the model was trained with class
    weighting (see the module docstring).
    """
    z = np.asarray(logits, dtype=np.float64).ravel()
    t = np.asarray(y, dtype=np.float64).ravel()
    if z.shape != t.shape:
        raise ValueError("logits and labels must have the same length")
    finite = np.isfinite(z)
    z, t = z[finite], t[finite]
    if not np.isin(t, (0.0, 1.0)).all():
        raise ValueError("labels must be 0 or 1")
    if z.size < 2 or np.unique(t).size < 2 or not np.any(z != 0):
        return 1.0
    if np.all(z[t == 1] >= 0) and np.all(z[t == 0] <= 0):  # separable by sign: T not identifiable
        return 1.0
    zt = torch.as_tensor(z, dtype=torch.float64)
    yt = torch.as_tensor(t, dtype=torch.float64)
    log_t = torch.zeros(1, dtype=torch.float64, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.5, max_iter=max_iter, line_search_fn="strong_wolfe")

    def closure() -> torch.Tensor:
        opt.zero_grad()
        loss = torch.nn.functional.binary_cross_entropy_with_logits(zt / torch.exp(log_t), yt)
        loss.backward()
        return loss

    opt.step(closure)
    temp = float(torch.exp(log_t).item())
    if not math.isfinite(temp):
        return 1.0
    return float(min(max(temp, T_MIN), T_MAX))


def prior_logit_offset(n_pos: int, n_neg: int) -> float:
    """``log(n_neg / n_pos)``: the logit shift caused by class-weighted training (see module docstring).

    Returns ``0.0`` when either count is zero (no weighting can be inferred).
    """
    if n_pos <= 0 or n_neg <= 0:
        return 0.0
    return float(math.log(n_neg / n_pos))


def scale_logits(logits: np.ndarray, temperature: float, offset: float = 0.0) -> np.ndarray:
    """Return ``(logits - offset) / T`` (calibrated logits; ``offset`` = prior correction)."""
    if not temperature > 0:
        raise ValueError("temperature must be positive")
    return (np.asarray(logits, dtype=np.float64) - float(offset)) / float(temperature)


def apply_temperature(logits: np.ndarray, temperature: float, offset: float = 0.0) -> np.ndarray:
    """Return calibrated **probabilities** ``sigmoid((logits - offset) / T)``."""
    return sigmoid(scale_logits(logits, temperature, offset))


def _bin_index(p: np.ndarray, n_bins: int) -> np.ndarray:
    return np.clip(np.floor(p * n_bins).astype(np.int64), 0, n_bins - 1)


def reliability_curve(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> list[dict[str, float | int | None]]:
    """Equal-width reliability diagram data.

    Returns one dict per bin ``{bin_lo, bin_hi, mean_pred, frac_pos, count}``; ``mean_pred`` and
    ``frac_pos`` are ``None`` for empty bins. Bin ``i`` holds ``i/n <= p < (i+1)/n`` (the last bin
    includes ``p = 1``).
    """
    yy = np.asarray(y, dtype=np.float64).ravel()
    pp = np.clip(np.asarray(p, dtype=np.float64).ravel(), 0.0, 1.0)
    if yy.shape != pp.shape:
        raise ValueError("y and p must have the same length")
    idx = _bin_index(pp, n_bins)
    counts = np.bincount(idx, minlength=n_bins)
    sum_p = np.bincount(idx, weights=pp, minlength=n_bins)
    sum_y = np.bincount(idx, weights=yy, minlength=n_bins)
    out: list[dict[str, float | int | None]] = []
    for i in range(n_bins):
        c = int(counts[i])
        out.append(
            {
                "bin_lo": i / n_bins,
                "bin_hi": (i + 1) / n_bins,
                "mean_pred": float(sum_p[i] / c) if c else None,
                "frac_pos": float(sum_y[i] / c) if c else None,
                "count": c,
            }
        )
    return out


def expected_calibration_error(y: np.ndarray, p: np.ndarray, n_bins: int = 10) -> float | None:
    """ECE = sum_b (n_b / N) |mean_pred_b - frac_pos_b| over equal-width bins (``None`` if N = 0)."""
    yy = np.asarray(y, dtype=np.float64).ravel()
    pp = np.clip(np.asarray(p, dtype=np.float64).ravel(), 0.0, 1.0)
    if yy.shape != pp.shape:
        raise ValueError("y and p must have the same length")
    n = yy.size
    if n == 0:
        return None
    idx = _bin_index(pp, n_bins)
    # sum_b (n_b/N) |sum_p_b/n_b - sum_y_b/n_b| = sum_b |sum_p_b - sum_y_b| / N
    gap = np.abs(
        np.bincount(idx, weights=pp, minlength=n_bins) - np.bincount(idx, weights=yy, minlength=n_bins)
    )
    return float(gap.sum() / n)


__all__ = [
    "apply_temperature",
    "expected_calibration_error",
    "fit_temperature",
    "logit",
    "prior_logit_offset",
    "reliability_curve",
    "scale_logits",
    "sigmoid",
]
