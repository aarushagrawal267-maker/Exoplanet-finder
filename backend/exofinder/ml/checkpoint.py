"""Model bundles: a directory holding weights plus a ``meta.json`` describing them.

Layout
------
::

    <model_dir>/
        meta.json                 # written last: its presence marks a complete bundle
        member_00/best.pt         # CNN: state_dict of the selected (best-validation) weights
        member_00/last.pt         # CNN: weights after the final epoch (written by train())
        member_01/...             # one directory per ensemble member
        model.joblib              # baselines: the fitted scikit-learn pipeline

``meta.json`` always records ``model_type``, ``config``, ``pipeline_version``, ``dataset_id``,
``feature_names``, ``threshold``, ``temperature``, ``logit_offset`` (prior correction applied before
the temperature; 0 for bundles written before it existed), ``ensemble_size``, ``created_at``, library
versions, the network architecture (class + constructor arguments) and the sha256 of every weight
file.

Security
--------
Torch weights are plain ``state_dict`` tensors saved with :func:`torch.save` and loaded with
``torch.load(weights_only=True)``, which cannot execute code. scikit-learn pipelines are stored with
joblib (pickle); only load bundles produced by this application on this machine.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import torch
from torch import nn

from . import MODEL_TYPES
from ._json import to_jsonable
from .models.cnn import CNN_CLASSES, build_cnn, count_parameters

META_FILE = "meta.json"
SKLEARN_FILE = "model.joblib"
BUNDLE_FORMAT = 1
CNN_TYPES = tuple(CNN_CLASSES)
BASELINE_TYPES = ("logreg", "random_forest")


class BundleError(RuntimeError):
    """A model directory is missing, incomplete or corrupt."""


@dataclass
class LoadedModel:
    """A model bundle loaded into memory (CPU)."""

    directory: Path
    meta: dict[str, Any]
    model_type: str
    torch_models: list[nn.Module] = field(default_factory=list)
    sklearn_model: Any = None

    @property
    def is_cnn(self) -> bool:
        return self.model_type in CNN_TYPES

    @property
    def threshold(self) -> float:
        return float(self.meta.get("threshold", 0.5))

    @property
    def temperature(self) -> float:
        return float(self.meta.get("temperature", 1.0))

    @property
    def logit_offset(self) -> float:
        """Prior correction subtracted from the logit before temperature scaling (0 if absent)."""
        return float(self.meta.get("logit_offset") or 0.0)

    @property
    def pipeline_version(self) -> str:
        return str(self.meta.get("pipeline_version", ""))


def library_versions() -> dict[str, str]:
    import joblib
    import numpy
    import sklearn

    return {
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "numpy": numpy.__version__,
        "sklearn": sklearn.__version__,
        "joblib": joblib.__version__,
    }


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def save_state_dict(path: str | os.PathLike[str], model: nn.Module) -> Path:
    """Atomically save ``model.state_dict()`` (tensors moved to CPU) to ``path``."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    state = {k: v.detach().to("cpu").clone() for k, v in model.state_dict().items()}
    tmp = p.with_name(p.name + ".tmp")
    torch.save(state, tmp)
    os.replace(tmp, p)
    return p


def member_dir(directory: str | os.PathLike[str], k: int) -> Path:
    return Path(directory) / f"member_{k:02d}"


def save_model_bundle(
    directory: str | os.PathLike[str],
    model_or_models: nn.Module | list[nn.Module] | Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Write the weights and ``meta.json`` into ``directory``; return the final meta dict.

    ``model_or_models`` is a CNN, a list of CNNs (ensemble members, saved as
    ``member_XX/best.pt``) or a fitted scikit-learn pipeline. ``meta`` must contain ``model_type``
    and ``pipeline_version``; ``threshold`` defaults to 0.5 and ``temperature`` to 1.0.
    """
    out = Path(directory)
    out.mkdir(parents=True, exist_ok=True)
    meta = dict(meta)
    model_type = meta.get("model_type")
    if model_type not in MODEL_TYPES:
        raise ValueError(f"meta['model_type'] must be one of {MODEL_TYPES}, got {model_type!r}")
    if not meta.get("pipeline_version"):
        raise ValueError("meta['pipeline_version'] is required")
    # every contract key is always present, even when a caller does not know it
    meta.setdefault("threshold", 0.5)
    meta.setdefault("temperature", 1.0)
    meta.setdefault("logit_offset", 0.0)
    meta.setdefault("config", {})
    meta.setdefault("dataset_id", None)
    meta.setdefault("feature_names", [])
    meta.setdefault("created_at", datetime.now(UTC).isoformat(timespec="seconds"))
    meta["bundle_format"] = BUNDLE_FORMAT
    meta["library_versions"] = library_versions()

    if model_type in CNN_TYPES:
        models = list(model_or_models) if isinstance(model_or_models, (list, tuple)) else [model_or_models]
        if not models or not all(isinstance(m, nn.Module) for m in models):
            raise TypeError("CNN bundles need one or more torch modules")
        arch = getattr(models[0], "arch_kwargs", None)
        if arch is None:
            raise TypeError("CNN modules must expose arch_kwargs (use SingleViewCNN / TwoViewCNN)")
        weights = []
        for k, m in enumerate(models):
            path = save_state_dict(member_dir(out, k) / "best.pt", m)
            weights.append({"path": path.relative_to(out).as_posix(), "sha256": sha256_file(path)})
        meta["architecture"] = {"class": type(models[0]).__name__, "kwargs": dict(arch)}
        meta["weights"] = weights
        meta["ensemble_size"] = len(models)
        meta["n_params_per_member"] = count_parameters(models[0])
        meta.setdefault("n_params", count_parameters(models[0]) * len(models))
    else:
        import joblib

        path = out / SKLEARN_FILE
        tmp = path.with_name(path.name + ".tmp")
        joblib.dump(model_or_models, tmp)
        os.replace(tmp, path)
        meta["weights"] = [{"path": SKLEARN_FILE, "sha256": sha256_file(path)}]
        meta["ensemble_size"] = 1

    meta = to_jsonable(meta)
    tmp_meta = out / (META_FILE + ".tmp")
    tmp_meta.write_text(json.dumps(meta, indent=2, sort_keys=True), "utf-8")
    os.replace(tmp_meta, out / META_FILE)
    return meta


def read_bundle_meta(directory: str | os.PathLike[str]) -> dict[str, Any]:
    """Read ``meta.json`` without loading any weights."""
    path = Path(directory) / META_FILE
    if not path.exists():
        raise BundleError(f"{directory} is not a model bundle (no {META_FILE})")
    try:
        meta = json.loads(path.read_text("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BundleError(f"{path} is corrupt: {exc}") from exc
    if not isinstance(meta, dict):
        raise BundleError(f"{path} does not contain a JSON object")
    return meta


def load_model_bundle(directory: str | os.PathLike[str], verify_hashes: bool = True) -> LoadedModel:
    """Load a bundle written by :func:`save_model_bundle` onto the CPU (models in eval mode)."""
    out = Path(directory)
    meta = read_bundle_meta(out)
    model_type = meta.get("model_type")
    if model_type not in MODEL_TYPES:
        raise BundleError(f"unknown model_type {model_type!r} in {out / META_FILE}")
    weights = meta.get("weights") or []
    if not weights:
        raise BundleError(f"{out / META_FILE} lists no weight files")
    for w in weights:
        if not isinstance(w, dict) or "path" not in w:
            raise BundleError(f"{out / META_FILE} has a malformed weights entry: {w!r}")
        p = out / w["path"]
        if not p.exists():
            raise BundleError(f"missing weight file {p}")
        if verify_hashes and w.get("sha256") and sha256_file(p) != w["sha256"]:
            raise BundleError(f"weight file {p} does not match its recorded sha256")

    loaded = LoadedModel(directory=out, meta=meta, model_type=model_type)
    if model_type in CNN_TYPES:
        arch = meta.get("architecture") or {}
        for w in weights:
            model = build_cnn(model_type, **arch.get("kwargs", {}))
            state = torch.load(out / w["path"], map_location="cpu", weights_only=True)
            model.load_state_dict(state, strict=True)
            model.eval()
            loaded.torch_models.append(model)
    else:
        import joblib

        loaded.sklearn_model = joblib.load(out / weights[0]["path"])
    return loaded


__all__ = [
    "BASELINE_TYPES",
    "CNN_TYPES",
    "MODEL_TYPES",
    "BundleError",
    "LoadedModel",
    "load_model_bundle",
    "member_dir",
    "read_bundle_meta",
    "save_model_bundle",
    "save_state_dict",
]
