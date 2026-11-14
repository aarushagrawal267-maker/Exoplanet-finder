"""Compute-device selection and environment reporting.

Exoplanet Finder is designed for CPU-only laptops; a CUDA GPU (or Apple-silicon MPS) is used
automatically when present and requested via ``"auto"``.
"""

from __future__ import annotations

import logging
import os
import platform
import sys
from typing import Any

import torch

log = logging.getLogger("exofinder.ml")


def _mps_available() -> bool:
    backend = getattr(torch.backends, "mps", None)
    try:
        return bool(backend is not None and backend.is_available())
    except (RuntimeError, AttributeError):  # pragma: no cover - platform specific
        return False


def resolve_device(pref: str | torch.device | None = "auto") -> torch.device:
    """Map a device preference to a usable :class:`torch.device`.

    ``"auto"`` (or ``None``) picks CUDA, then MPS, then CPU. An explicit ``"cuda"``/``"cuda:N"`` or
    ``"mps"`` that is not available falls back to CPU with a logged warning, so a settings file
    copied from a GPU machine still works on a laptop.
    """
    if isinstance(pref, torch.device):
        pref = str(pref)
    p = (pref or "auto").strip().lower()
    if p == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if _mps_available():
            return torch.device("mps")
        return torch.device("cpu")
    if p == "cpu":
        return torch.device("cpu")
    if p.startswith("cuda"):
        if torch.cuda.is_available():
            return torch.device(p)
        log.warning("CUDA requested but not available; falling back to CPU")
        return torch.device("cpu")
    if p == "mps":
        if _mps_available():
            return torch.device("mps")
        log.warning("MPS requested but not available; falling back to CPU")
        return torch.device("cpu")
    raise ValueError(f"unknown device preference {pref!r} (expected auto, cpu, cuda[:N] or mps)")


def default_num_threads() -> int:
    """Default intra-op thread count for CPU training: all logical cores reported by the OS."""
    return max(1, os.cpu_count() or 1)


def environment_info() -> dict[str, Any]:
    """Versions and hardware facts recorded with every experiment (JSON-serialisable)."""
    import numpy
    import scipy
    import sklearn

    info: dict[str, Any] = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor() or None,
        "cpu_count": os.cpu_count(),
        "torch": torch.__version__,
        "torch_num_threads": torch.get_num_threads(),
        "numpy": numpy.__version__,
        "scipy": scipy.__version__,
        "sklearn": sklearn.__version__,
        "cuda_available": bool(torch.cuda.is_available()),
        "cuda_version": torch.version.cuda,
        "cuda_device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "mps_available": _mps_available(),
        "default_device": str(resolve_device("auto")),
    }
    return info


__all__ = ["default_num_threads", "environment_info", "resolve_device"]
