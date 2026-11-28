"""Build the static results viewer of Exoplanet Finder (Hugging Face static Space).

A free static Space cannot run the FastAPI app or train models, so this page shows **real results
precomputed by the application** on a local run, read straight from its database and files:

* the dataset (tier, star-level splits, catalogue snapshot dates),
* each model's validation metrics and its one-time held-out **test** evaluation (metrics with the
  bootstrap confidence intervals, ROC and precision-recall curves, confusion counts),
* every held-out test signal with its NASA labels, each model's calibrated planet-like probability
  (from the evaluation's ``per_example.csv``) and the global/local views the models saw.

No model runs in the page. Usage (the app's environment; EXOF_DATA_DIR / EXOF_ARTIFACTS_DIR set to
the run to publish):

    python deploy/browser-demo/build_results_viewer.py --dataset 1 --out /path/to/space
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "backend"))

from sqlalchemy import select  # noqa: E402

from exofinder.db.models import CatalogSnapshot, Dataset, Evaluation, ModelVersion, Signal  # noqa: E402
from exofinder.db.session import session_scope  # noqa: E402
from exofinder.services.ops_common import load_arrays_cached  # noqa: E402

METRICS = ["pr_auc", "roc_auc", "f1", "precision", "recall", "specificity", "accuracy", "brier", "ece"]


def r(x, d=6):
    return None if x is None else round(float(x), d)


def _ci_text(m) -> str | None:
    if not isinstance(m, dict):
        return m
    unit = "whole stars" if m.get("resample") == "star" else "signals"
    return f"{m.get('n_boot')} bootstrap resamples of {unit}, {m.get('method')} intervals"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", type=int, required=True)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    (args.out / "data").mkdir(parents=True, exist_ok=True)

    with session_scope() as s:
        ds = s.get(Dataset, args.dataset)
        if ds is None or ds.status != "ready":
            sys.exit(f"dataset {args.dataset} is not ready")
        arrays = load_arrays_cached(ds.path)
        snaps = {sn.source: sn.retrieved_at.strftime("%Y-%m-%d") for sn in s.scalars(select(CatalogSnapshot))}
        models, per_model_probs = [], {}
        for mv in s.scalars(
            select(ModelVersion).where(ModelVersion.dataset_id == ds.id).order_by(ModelVersion.id)
        ):
            ev = s.scalars(
                select(Evaluation)
                .where(Evaluation.model_version_id == mv.id, Evaluation.split == "test")
                .order_by(Evaluation.id)
            ).first()
            if ev is None:
                sys.exit(
                    f"model {mv.id} has no test evaluation; run `exofinder evaluate --model {mv.id} --split test`"
                )
            with open(ev.per_example_path, newline="", encoding="utf-8") as f:
                per_model_probs[mv.id] = {int(row["signal_id"]): row for row in csv.DictReader(f)}
            models.append(
                {
                    "id": mv.id,
                    "name": mv.name,
                    "model_type": mv.model_type,
                    "is_active": bool(mv.is_active),
                    "threshold": r(ev.threshold),
                    "n_params": mv.n_params,
                    "val": {k: r((mv.val_metrics or {}).get(k)) for k in METRICS},
                    "test": {
                        k: r(ev.metrics.get(k))
                        for k in METRICS + ["n", "n_pos", "n_neg", "tp", "fp", "tn", "fn"]
                    },
                    "test_ci": {k: [r(v) for v in ev.ci[k]] for k in METRICS if k in ev.ci},
                    "ci_method": _ci_text(ev.ci.get("method")),
                    "roc": [[r(pt["fpr"]), r(pt["tpr"])] for pt in ev.curves["roc"]],
                    "pr": [[r(pt["recall"]), r(pt["precision"])] for pt in ev.curves["pr"]],
                    "evaluated_at": ev.created_at.strftime("%Y-%m-%d"),
                }
            )
        test_idx = np.flatnonzero(arrays.splits == "test")
        sig_ids = [int(arrays.signal_ids[i]) for i in test_idx]
        sigs = {sg.id: sg for sg in s.scalars(select(Signal).where(Signal.id.in_(sig_ids)))}
        examples = []
        for i in test_idx:
            sid = int(arrays.signal_ids[i])
            sg = sigs[sid]
            if sid not in per_model_probs[models[0]["id"]]:
                continue  # unlabelled signal of a reserved showcase star: not part of the test metrics
            examples.append(
                {
                    "signal_id": sid,
                    "signal_key": sg.signal_key,
                    "kepid": int(sg.kepid),
                    "name": sg.kepler_name or sg.kepoi_name or sg.signal_key,
                    "period_days": r(sg.period_days, 5),
                    "depth_ppm": r(sg.depth_ppm, 1),
                    "snr": r(sg.model_snr, 1),
                    "av_label": sg.av_training_set,
                    "koi_disposition": sg.koi_disposition,
                    "label": int(arrays.labels[i]),
                    "scores": {
                        str(mid): {
                            "prob": r(float(rows[sid]["prob"])),
                            "pred": int(rows[sid]["predicted_label"]),
                            "unc": r(float(rows[sid]["uncertainty"]))
                            if rows[sid].get("uncertainty") not in (None, "")
                            else None,
                        }
                        for mid, rows in per_model_probs.items()
                    },
                    "global": [r(v, 3) for v in arrays.global_view[i]],
                    "local": [r(v, 3) for v in arrays.local_view[i]],
                }
            )
        split_stats = (ds.stats or {}).get("per_split", {})
        out = {
            "dataset": {
                "id": ds.id,
                "name": ds.name,
                "tier": ds.tier,
                "label_mode": ds.label_mode,
                "pipeline_version": ds.pipeline_version,
                "created_at": ds.created_at.strftime("%Y-%m-%d"),
                "per_split": split_stats,
                "n_examples": ds.n_examples,
            },
            "catalog_snapshots": snaps,
            "models": models,
            "test_examples": examples,
        }
    (args.out / "data" / "results.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    shutil.copy2(HERE / "index.html", args.out / "index.html")
    print(f"{len(models)} models, {len(examples)} test signals -> {args.out}")


if __name__ == "__main__":
    main()
