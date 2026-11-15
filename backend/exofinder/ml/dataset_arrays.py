"""In-memory and on-disk representation of a consolidated training dataset.

A dataset build (``data/datasets/<dataset_id>/``) stores two files:

* ``arrays.npz`` — numeric arrays, one row per example (signal):

  ======================  ==============  ===========================================================
  key                     shape / dtype   meaning
  ======================  ==============  ===========================================================
  ``global``              (N, G) float32  AstroNet global view (whole orbit, G = 2001 bins)
  ``local``               (N, L) float32  AstroNet local view (+/- 2 durations, L = 201 bins)
  ``features``            (N, F) float32  physical features measured from the light curve
  ``labels``              (N,) int64      1 = planet-like, 0 = false-positive-like
  ``signal_ids``          (N,) int64      ``signals.id`` of each example
  ``kepids``              (N,) int64      Kepler Input Catalog id of the host star
  ``splits``              (N,) str        ``train`` / ``val`` / ``test``
  ======================  ==============  ===========================================================

* ``manifest.json`` — feature names, shapes, per-split class counts, the sha256 of ``arrays.npz``
  and free-form ``meta`` supplied by the dataset builder (dataset id, pipeline version, label mode,
  split seed, ...).

Arrays are saved with ``allow_pickle=False`` semantics (no object arrays), so loading a dataset can
never execute code.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from .splits import SPLIT_NAMES, split_summary

ARRAYS_FILE = "arrays.npz"
MANIFEST_FILE = "manifest.json"
FORMAT_VERSION = 1


@dataclass
class DatasetArrays:
    """Model-ready arrays of one dataset build (see module docstring for shapes)."""

    global_view: np.ndarray
    local_view: np.ndarray
    features: np.ndarray
    labels: np.ndarray
    signal_ids: np.ndarray
    kepids: np.ndarray
    splits: np.ndarray
    feature_names: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.global_view = np.ascontiguousarray(self.global_view, dtype=np.float32)
        self.local_view = np.ascontiguousarray(self.local_view, dtype=np.float32)
        feats = np.asarray(self.features, dtype=np.float32)
        if feats.ndim == 1 and feats.size == 0:
            feats = feats.reshape(self.global_view.shape[0], 0)
        self.features = np.ascontiguousarray(feats)
        self.labels = np.asarray(self.labels, dtype=np.int64)
        self.signal_ids = np.asarray(self.signal_ids, dtype=np.int64)
        self.kepids = np.asarray(self.kepids, dtype=np.int64)
        splits = np.asarray(self.splits).astype(str)
        # check before narrowing to <U5: truncation would silently turn e.g. "trainval" into "train"
        unknown = sorted(set(splits.tolist()) - set(SPLIT_NAMES))
        if unknown:
            raise ValueError(f"unknown split names: {unknown}")
        self.splits = splits.astype("<U5")
        self.feature_names = [str(n) for n in self.feature_names]
        if not self.feature_names and self.features.shape[1]:
            self.feature_names = [f"physical_{i:02d}" for i in range(self.features.shape[1])]
        self.validate()

    # ------------------------------------------------------------------------------------------
    def __len__(self) -> int:
        return int(self.labels.shape[0])

    @property
    def global_bins(self) -> int:
        return int(self.global_view.shape[1])

    @property
    def local_bins(self) -> int:
        return int(self.local_view.shape[1])

    def validate(self) -> None:
        """Check shapes, dtypes and value domains; raise ``ValueError`` on any inconsistency."""
        n = self.labels.shape[0]
        if self.global_view.ndim != 2 or self.local_view.ndim != 2 or self.features.ndim != 2:
            raise ValueError("global, local and features must be 2-D arrays")
        for name, arr in (
            ("global", self.global_view),
            ("local", self.local_view),
            ("features", self.features),
            ("signal_ids", self.signal_ids),
            ("kepids", self.kepids),
            ("splits", self.splits),
        ):
            if arr.shape[0] != n:
                raise ValueError(f"{name} has {arr.shape[0]} rows, expected {n}")
        if self.labels.ndim != 1:
            raise ValueError("labels must be 1-D")
        if n and not np.isin(self.labels, (0, 1)).all():
            raise ValueError("labels must be 0 or 1")
        if len(self.feature_names) != self.features.shape[1]:
            raise ValueError("feature_names length does not match the number of feature columns")
        for name, arr in (
            ("global", self.global_view),
            ("local", self.local_view),
            ("features", self.features),
        ):
            if arr.size and not np.isfinite(arr).all():
                raise ValueError(f"{name} contains NaN or Inf values")
        if n and not np.isin(self.splits, SPLIT_NAMES).all():
            bad = sorted(set(self.splits.tolist()) - set(SPLIT_NAMES))
            raise ValueError(f"unknown split names: {bad}")
        if n:
            ids, counts = np.unique(self.signal_ids, return_counts=True)
            if (counts > 1).any():
                dup = ids[counts > 1][:5].tolist()
                raise ValueError(
                    f"signal_ids must be unique; duplicated examples would be counted twice: {dup}"
                )

    def select(self, mask: np.ndarray) -> DatasetArrays:
        """Rows where ``mask`` is True (boolean mask or integer index array)."""
        return DatasetArrays(
            global_view=self.global_view[mask],
            local_view=self.local_view[mask],
            features=self.features[mask],
            labels=self.labels[mask],
            signal_ids=self.signal_ids[mask],
            kepids=self.kepids[mask],
            splits=self.splits[mask],
            feature_names=list(self.feature_names),
            meta=dict(self.meta),
        )

    def subset(self, split: str) -> DatasetArrays:
        """Examples of one split (``"train"``, ``"val"``, ``"test"``; ``"all"`` returns a copy)."""
        if split == "all":
            return self.select(np.ones(len(self), dtype=bool))
        if split not in SPLIT_NAMES:
            raise ValueError(f"unknown split {split!r}; expected one of {SPLIT_NAMES} or 'all'")
        return self.select(self.splits == split)

    def summary(self) -> dict[str, Any]:
        """Counts per split and class (JSON-serialisable)."""
        return {
            "n": len(self),
            "n_pos": int((self.labels == 1).sum()),
            "n_neg": int((self.labels == 0).sum()),
            "n_stars": int(np.unique(self.kepids).size),
            "global_bins": self.global_bins,
            "local_bins": self.local_bins,
            "n_features": int(self.features.shape[1]),
            "splits": split_summary(self.kepids, self.labels, self.splits),
        }


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def save_dataset_arrays(path: str | os.PathLike[str], arrays: DatasetArrays) -> dict[str, Any]:
    """Write ``arrays.npz`` and ``manifest.json`` into directory ``path`` (created if needed).

    Files are written to temporary names and atomically renamed, the manifest last, so a crash
    never leaves a manifest pointing at a partial array file. Returns the manifest dict.
    """
    arrays.validate()
    out_dir = Path(path)
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_npz = out_dir / (ARRAYS_FILE + ".tmp.npz")
    np.savez_compressed(
        tmp_npz,
        **{
            "global": arrays.global_view,
            "local": arrays.local_view,
            "features": arrays.features,
            "labels": arrays.labels,
            "signal_ids": arrays.signal_ids,
            "kepids": arrays.kepids,
            "splits": arrays.splits,
        },
    )
    os.replace(tmp_npz, out_dir / ARRAYS_FILE)
    manifest = {
        "format_version": FORMAT_VERSION,
        "arrays_file": ARRAYS_FILE,
        "arrays_sha256": _sha256(out_dir / ARRAYS_FILE),
        "feature_names": list(arrays.feature_names),
        "summary": arrays.summary(),
        "meta": arrays.meta,
    }
    tmp_manifest = out_dir / (MANIFEST_FILE + ".tmp")
    tmp_manifest.write_text(json.dumps(manifest, indent=2, sort_keys=True, default=_json_default), "utf-8")
    os.replace(tmp_manifest, out_dir / MANIFEST_FILE)
    return manifest


def load_dataset_arrays(path: str | os.PathLike[str], verify_hash: bool = False) -> DatasetArrays:
    """Load a dataset directory written by :func:`save_dataset_arrays`.

    ``path`` may be the directory or the ``arrays.npz`` file inside it. With ``verify_hash`` the
    sha256 recorded in the manifest is checked (raises ``ValueError`` on mismatch).
    """
    p = Path(path)
    out_dir = p.parent if p.suffix == ".npz" else p
    manifest_path = out_dir / MANIFEST_FILE
    manifest: dict[str, Any] = {}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text("utf-8"))
    npz_path = out_dir / manifest.get("arrays_file", ARRAYS_FILE)
    if verify_hash and manifest.get("arrays_sha256") and _sha256(npz_path) != manifest["arrays_sha256"]:
        raise ValueError(f"{npz_path} does not match the sha256 recorded in its manifest")
    with np.load(npz_path, allow_pickle=False) as z:
        return DatasetArrays(
            global_view=z["global"],
            local_view=z["local"],
            features=z["features"],
            labels=z["labels"],
            signal_ids=z["signal_ids"],
            kepids=z["kepids"],
            splits=z["splits"],
            feature_names=list(manifest.get("feature_names", [])),
            meta=dict(manifest.get("meta", {})),
        )


def _json_default(obj: Any) -> Any:
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, Path):
        return str(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serialisable")


__all__ = ["DatasetArrays", "load_dataset_arrays", "save_dataset_arrays"]
