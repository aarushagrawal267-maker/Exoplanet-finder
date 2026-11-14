"""AstroNet-style 1-D convolutional networks (Shallue & Vanderburg 2018, AJ 155, 94).

A phase-folded light curve is a 1-D "image" of the transit. Convolutional columns learn local
shape detectors (ingress/egress slopes, flat vs V-shaped bottoms, secondary eclipses, sinusoidal
variability); max-pooling makes them tolerant to small shifts in phase; fully-connected layers
combine the evidence into a single logit for "planet-like".

Architecture (as in the paper; the input length is configurable)
-----------------------------------------------------------------
* **Global column** (whole orbit, 2001 bins): 5 blocks; block ``i`` has two ``Conv1d`` layers with
  ``16 * 2**i`` filters (16, 32, 64, 128, 256), kernel size 5, "same" padding, ReLU, followed by
  ``MaxPool1d(kernel_size=5, stride=2)``.
* **Local column** (transit zoom, 201 bins): 2 blocks with 16 and 32 filters, kernel size 5, ReLU,
  ``MaxPool1d(kernel_size=7, stride=2)``.
* The flattened column outputs are concatenated and passed through ``fc_layers`` fully-connected
  layers of ``fc_width`` units with ReLU and dropout, then a linear layer to one logit.

Initialisation
--------------
Convolutional and hidden fully-connected layers use He (Kaiming) normal initialisation for ReLU
(He et al. 2015) with zero biases; the output layer is drawn 10x smaller (std ``0.1/sqrt(fan_in)``)
so training starts near ``p = 0.5`` for every input. PyTorch's default initialisation (tuned for
leaky-ReLU with ``a = sqrt(5)``) shrinks the activations by ~0.58 per layer; through AstroNet's
10 convolutional + 4 fully-connected layers the untrained network's logit then varies by only
~1e-4 across inputs and training at ``lr = 1e-4`` stalls for many epochs (long enough for early
stopping on a validation set that is not trivially separable to end training before learning starts).

Flatten sizes are computed at construction by running a zero tensor through the columns, so any
view length that survives the pooling stack is supported (a ``ValueError`` explains when it is too
short). Both models take ``(global, local)`` tensors shaped ``(B, 1, L)`` and return logits ``(B,)``;
the single-view model ignores ``local``. ``embed()`` returns the flattened convolutional features and
``head`` maps them to the logit; dropout lives only in the head, which lets Monte-Carlo dropout
reuse one convolutional pass (see :mod:`exofinder.ml.inference`).
"""

from __future__ import annotations

import math

import torch
from torch import nn

GLOBAL_BLOCKS = 5
LOCAL_BLOCKS = 2
CONV_KERNEL = 5
GLOBAL_POOL = (5, 2)  # (kernel_size, stride)
LOCAL_POOL = (7, 2)
BASE_FILTERS = 16


def _conv_column(n_blocks: int, pool: tuple[int, int], base_filters: int = BASE_FILTERS) -> nn.Sequential:
    """``n_blocks`` x [Conv1d-ReLU-Conv1d-ReLU-MaxPool]; filters double every block."""
    layers: list[nn.Module] = []
    in_ch = 1
    for i in range(n_blocks):
        out_ch = base_filters * 2**i
        layers += [
            nn.Conv1d(in_ch, out_ch, CONV_KERNEL, padding=CONV_KERNEL // 2),
            nn.ReLU(),
            nn.Conv1d(out_ch, out_ch, CONV_KERNEL, padding=CONV_KERNEL // 2),
            nn.ReLU(),
            nn.MaxPool1d(kernel_size=pool[0], stride=pool[1]),
        ]
        in_ch = out_ch
    return nn.Sequential(*layers)


def _flat_size(column: nn.Sequential, length: int, name: str) -> int:
    """Number of features produced by ``column`` for an input of ``length`` bins."""
    try:
        with torch.no_grad():
            out = column(torch.zeros(1, 1, int(length)))
    except RuntimeError as exc:  # pooling window larger than the remaining sequence
        raise ValueError(f"{name} view of {length} bins is too short for the convolutional column") from exc
    n = int(out.numel())
    if n <= 0:
        raise ValueError(f"{name} view of {length} bins is too short for the convolutional column")
    return n


def _fc_head(in_features: int, width: int, n_layers: int, dropout: float) -> nn.Sequential:
    layers: list[nn.Module] = []
    d = in_features
    for _ in range(n_layers):
        layers += [nn.Linear(d, width), nn.ReLU(), nn.Dropout(dropout)]
        d = width
    layers.append(nn.Linear(d, 1))
    return nn.Sequential(*layers)


def init_weights(model: nn.Module) -> None:
    """He-normal init for ReLU layers, small output layer, zero biases (see module docstring).

    The output layer is ``model.head[-1]``. Uses the global torch RNG (seeded by the trainer).
    """
    out_layer = model.head[-1]  # type: ignore[index]
    for m in model.modules():
        if isinstance(m, (nn.Conv1d, nn.Linear)) and m is not out_layer:
            nn.init.kaiming_normal_(m.weight, mode="fan_in", nonlinearity="relu")
            nn.init.zeros_(m.bias)
    nn.init.normal_(out_layer.weight, mean=0.0, std=0.1 / math.sqrt(out_layer.in_features))
    nn.init.zeros_(out_layer.bias)


def _check_input(x: torch.Tensor, length: int, name: str) -> torch.Tensor:
    if x.dim() == 2:  # (B, L) -> (B, 1, L)
        x = x.unsqueeze(1)
    if x.dim() != 3 or x.shape[1] != 1 or x.shape[2] != length:
        raise ValueError(f"{name} input must have shape (B, 1, {length}), got {tuple(x.shape)}")
    return x


class SingleViewCNN(nn.Module):
    """Global-view-only AstroNet variant (the paper's "global view" baseline network)."""

    def __init__(
        self, global_bins: int = 2001, fc_width: int = 512, dropout: float = 0.3, fc_layers: int = 4
    ) -> None:
        super().__init__()
        if not 0.0 <= dropout < 1.0:
            raise ValueError("dropout must be in [0, 1)")
        self.global_bins = int(global_bins)
        self.global_column = _conv_column(GLOBAL_BLOCKS, GLOBAL_POOL)
        self.global_flat = _flat_size(self.global_column, self.global_bins, "global")
        self.head = _fc_head(self.global_flat, int(fc_width), int(fc_layers), float(dropout))
        init_weights(self)
        self.arch_kwargs = {
            "global_bins": self.global_bins,
            "fc_width": int(fc_width),
            "dropout": float(dropout),
            "fc_layers": int(fc_layers),
        }

    def embed(self, global_view: torch.Tensor, local_view: torch.Tensor | None = None) -> torch.Tensor:
        """Flattened convolutional features (B, global_flat); deterministic (no dropout)."""
        g = _check_input(global_view, self.global_bins, "global")
        return self.global_column(g).flatten(1)

    def forward(self, global_view: torch.Tensor, local_view: torch.Tensor | None = None) -> torch.Tensor:
        return self.head(self.embed(global_view, local_view)).squeeze(-1)


class TwoViewCNN(nn.Module):
    """AstroNet two-view network: global column + local column -> shared FC head -> logit."""

    def __init__(
        self,
        global_bins: int = 2001,
        local_bins: int = 201,
        fc_width: int = 512,
        fc_layers: int = 4,
        dropout: float = 0.3,
    ) -> None:
        super().__init__()
        if not 0.0 <= dropout < 1.0:
            raise ValueError("dropout must be in [0, 1)")
        self.global_bins = int(global_bins)
        self.local_bins = int(local_bins)
        self.global_column = _conv_column(GLOBAL_BLOCKS, GLOBAL_POOL)
        self.local_column = _conv_column(LOCAL_BLOCKS, LOCAL_POOL)
        self.global_flat = _flat_size(self.global_column, self.global_bins, "global")
        self.local_flat = _flat_size(self.local_column, self.local_bins, "local")
        self.head = _fc_head(
            self.global_flat + self.local_flat, int(fc_width), int(fc_layers), float(dropout)
        )
        init_weights(self)
        self.arch_kwargs = {
            "global_bins": self.global_bins,
            "local_bins": self.local_bins,
            "fc_width": int(fc_width),
            "fc_layers": int(fc_layers),
            "dropout": float(dropout),
        }

    def embed(self, global_view: torch.Tensor, local_view: torch.Tensor | None) -> torch.Tensor:
        """Concatenated flattened column features (B, global_flat + local_flat); no dropout."""
        if local_view is None:
            raise ValueError("TwoViewCNN requires a local view")
        g = _check_input(global_view, self.global_bins, "global")
        loc = _check_input(local_view, self.local_bins, "local")
        return torch.cat([self.global_column(g).flatten(1), self.local_column(loc).flatten(1)], dim=1)

    def forward(self, global_view: torch.Tensor, local_view: torch.Tensor | None) -> torch.Tensor:
        return self.head(self.embed(global_view, local_view)).squeeze(-1)


#: Model-type name -> network class (names match ``Experiment.model_type``).
CNN_CLASSES: dict[str, type[nn.Module]] = {"cnn_single": SingleViewCNN, "cnn_two_view": TwoViewCNN}


def build_cnn(model_type: str, **kwargs: object) -> nn.Module:
    """Instantiate a CNN by model-type name with architecture keyword arguments."""
    try:
        cls = CNN_CLASSES[model_type]
    except KeyError as exc:
        raise ValueError(f"unknown CNN model type {model_type!r}") from exc
    return cls(**kwargs)  # type: ignore[arg-type]


def count_parameters(model: nn.Module, trainable_only: bool = True) -> int:
    """Number of (trainable) scalar parameters of ``model``."""
    return int(sum(p.numel() for p in model.parameters() if p.requires_grad or not trainable_only))


def has_dropout(model: nn.Module) -> bool:
    """True if the model contains an active (p > 0) dropout layer (needed for MC-dropout)."""
    return any(isinstance(m, nn.Dropout) and m.p > 0 for m in model.modules())


def enable_mc_dropout(model: nn.Module) -> None:
    """Put the model in eval mode but keep dropout layers sampling (Monte-Carlo dropout)."""
    model.eval()
    for m in model.modules():
        if isinstance(m, nn.Dropout):
            m.train()


__all__ = [
    "CNN_CLASSES",
    "SingleViewCNN",
    "TwoViewCNN",
    "build_cnn",
    "count_parameters",
    "enable_mc_dropout",
    "has_dropout",
    "init_weights",
]
