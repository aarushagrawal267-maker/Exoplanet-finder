"""Model evaluation (job ``evaluate``), evaluation browsing, comparison and feature importance.

An evaluation scores one split of the model's own dataset with :func:`exofinder.ml.evaluate.evaluate`:
point metrics at the model's validation-chosen threshold (and at 0.5), 95 % bootstrap confidence
intervals resampling whole stars, ROC / PR / reliability curves, the confusion matrix, inference
timing and a per-example CSV (``artifacts/evaluations/<id>/per_example.csv``).

**Test-set evaluations are logged and counted.** The methodology evaluates each final model once on
the held-out test split; every test evaluation is recorded, numbered (``test_evaluation_number``) and
its metrics are copied onto the model version (``ModelVersion.test_metrics``), so repeated looks at
the test set are visible in the UI and in reports. Use the validation split while iterating.
"""

from __future__ import annotations

import csv
import json
import math
import re
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from exofinder.config import PIPELINE_VERSION, get_settings
from exofinder.db.models import Dataset, Evaluation, ModelVersion, Signal
from exofinder.db.session import session_scope
from exofinder.jobs.runner import JobContext
from exofinder.services import app_settings
from exofinder.services.datasets import get_dataset, require_ready
from exofinder.services.jobs import JobSpec
from exofinder.services.jsonutil import to_jsonable
from exofinder.services.models import get_model
from exofinder.services.ops_common import finite_or_none, load_arrays_cached, remove_tree, view_phases
from exofinder.services.ops_errors import bad_request, conflict, not_found

EVAL_SPLITS = ("val", "test")
SUMMARY_METRICS = (
    "accuracy",
    "precision",
    "recall",
    "specificity",
    "f1",
    "roc_auc",
    "pr_auc",
    "brier",
    "ece",
)
#: Metrics shown in comparison tables, in order.
COMPARE_METRICS = (
    "pr_auc",
    "roc_auc",
    "f1",
    "precision",
    "recall",
    "specificity",
    "accuracy",
    "brier",
    "ece",
    "threshold",
    "n",
    "n_pos",
    "n_neg",
)
OUTCOMES = ("tp", "fp", "fn", "tn")


def evaluations_dir() -> Path:
    return get_settings().artifacts_path / "evaluations"


# --------------------------------------------------------------------------------------------------
# Start + run
# --------------------------------------------------------------------------------------------------
def count_test_evaluations(session: Session, model_version_id: int) -> int:
    return int(
        session.scalar(
            select(func.count())
            .select_from(Evaluation)
            .where(Evaluation.model_version_id == model_version_id, Evaluation.split == "test")
        )
        or 0
    )


def start_evaluation(
    session: Session, model_version_id: int, split: str = "test", n_boot: int = 1000, seed: int = 0
) -> JobSpec:
    """Validate and describe an ``evaluate`` job on ``split`` of the model's own dataset."""
    if split not in EVAL_SPLITS:
        raise bad_request(f"Unknown split {split!r}", "invalid_split", "Use 'val' or 'test'.")
    if not 0 <= int(n_boot) <= 10000:
        raise bad_request("n_boot must be between 0 and 10000", "invalid_n_boot")
    mv = get_model(session, model_version_id)
    if mv.pipeline_version != PIPELINE_VERSION:
        raise conflict(
            f"Model {mv.id} uses pipeline {mv.pipeline_version} (running {PIPELINE_VERSION})",
            "incompatible_pipeline",
            "Retrain the model on a dataset built with the current pipeline.",
        )
    if not (mv.checkpoint_path and (Path(mv.checkpoint_path) / "meta.json").is_file()):
        raise conflict(
            "The model's checkpoint files are missing", "checkpoint_missing", "Delete the model and retrain."
        )
    if mv.dataset_id is None:
        raise conflict("The model is not linked to a dataset", "no_dataset")
    ds = get_dataset(session, mv.dataset_id)
    require_ready(ds)
    n_split = ds.n_val if split == "val" else ds.n_test
    if not n_split:
        raise conflict(f"The {split} split of dataset {ds.id} is empty", "split_empty")
    previous = count_test_evaluations(session, mv.id) if split == "test" else None
    title = f"Evaluate '{mv.name}' on the {split} split"
    if split == "test":
        title += f" (test evaluation #{previous + 1})"
    return JobSpec(
        kind="evaluate",
        title=title,
        fn=partial(run_evaluation, model_version_id=mv.id, split=split, n_boot=int(n_boot), seed=int(seed)),
        params={
            "model_version_id": mv.id,
            "dataset_id": ds.id,
            "split": split,
            "n_boot": int(n_boot),
            "seed": int(seed),
            "previous_test_evaluations": previous,
        },
    )


def run_evaluation(
    ctx: JobContext, model_version_id: int, split: str, n_boot: int = 1000, seed: int = 0
) -> dict:
    """Job function of ``evaluate``."""
    from exofinder.ml.evaluate import evaluate
    from exofinder.ml.inference import Predictor

    with session_scope() as s:
        mv = s.get(ModelVersion, model_version_id)
        if mv is None:
            raise RuntimeError(f"model version {model_version_id} no longer exists")
        ds = s.get(Dataset, mv.dataset_id)
        if ds is None or not ds.path:
            raise RuntimeError(f"dataset {mv.dataset_id} is not available")
        ckpt, ds_path, dataset_id, name = mv.checkpoint_path, ds.path, ds.id, mv.name
        device = app_settings.get_value("device", s)
        previous = count_test_evaluations(s, model_version_id)
    if split == "test":
        ctx.log(
            f"TEST-SET EVALUATION #{previous + 1} for model {model_version_id} ('{name}'). "
            "Test evaluations are logged and counted (methodology: evaluate each final model once)."
        )
    ctx.progress(0.05, "Loading model and dataset")
    predictor = Predictor.from_dir(ckpt, device=device)
    arrays = load_arrays_cached(ds_path)
    ctx.check_cancelled()
    ctx.progress(
        0.2, f"Scoring the {split} split ({int((arrays.splits == split).sum())} examples) + bootstrap CIs"
    )
    res = evaluate(predictor, arrays, split=split, n_boot=n_boot, seed=seed, with_uncertainty=True)
    ctx.check_cancelled()
    ctx.progress(0.9, "Saving results")
    keys = _signal_keys([r["signal_id"] for r in res.per_example])
    with session_scope() as s:
        ev = Evaluation(
            model_version_id=model_version_id,
            dataset_id=dataset_id,
            split=split,
            threshold=float(res.threshold),
            metrics=to_jsonable({**res.metrics, "at_0_5": res.metrics_at_0_5}),
            ci=to_jsonable({**res.ci, "method": res.ci_method}),
            curves=to_jsonable(res.curves),
            confusion=to_jsonable(res.confusion),
            timing=to_jsonable(res.timing),
        )
        s.add(ev)
        s.flush()
        out_dir = evaluations_dir() / str(ev.id)
        remove_tree(out_dir)  # ids can be re-used after a deletion
        out_dir.mkdir(parents=True, exist_ok=True)
        csv_path = out_dir / "per_example.csv"
        _write_per_example(csv_path, res.per_example, keys)
        ev.per_example_path = str(csv_path)
        if split == "test":
            mv = s.get(ModelVersion, model_version_id)
            if mv is not None:
                mv.test_metrics = to_jsonable(
                    {
                        **res.metrics,
                        "ci": res.ci,
                        "evaluation_id": ev.id,
                        "dataset_id": dataset_id,
                        "evaluated_at": datetime.now(UTC).isoformat(timespec="seconds"),
                        "test_evaluation_number": previous + 1,
                    }
                )
        eval_id = ev.id
    m = res.metrics
    ctx.log(
        f"Evaluation {eval_id} ({split}): PR-AUC {_f(m.get('pr_auc'))}, ROC-AUC {_f(m.get('roc_auc'))}, "
        f"F1 {_f(m.get('f1'))}, precision {_f(m.get('precision'))}, recall {_f(m.get('recall'))} "
        f"at threshold {res.threshold:.3f} (n={m.get('n')})"
    )
    return {"evaluation_id": eval_id, "split": split, "metrics": to_jsonable(res.metrics)}


def _f(x: Any) -> str:
    return f"{x:.3f}" if isinstance(x, (int, float)) and math.isfinite(x) else "n/a"


def _signal_keys(signal_ids: list[int]) -> dict[int, str]:
    with session_scope() as s:
        rows = s.execute(select(Signal.id, Signal.signal_key).where(Signal.id.in_(signal_ids))).all()
    return {int(i): k for i, k in rows}


def _write_per_example(path: Path, rows: list[dict[str, Any]], keys: dict[int, str]) -> None:
    cols = ["signal_id", "kepid", "signal_key", "label", "prob", "raw_prob", "predicted_label", "uncertainty"]
    tmp = path.with_suffix(".csv.tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow(
                {
                    "signal_id": r["signal_id"],
                    "kepid": r["kepid"],
                    "signal_key": keys.get(int(r["signal_id"]), ""),
                    "label": r["label"],
                    "prob": f"{r['prob']:.6g}",
                    "raw_prob": f"{r['raw_prob']:.6g}",
                    "predicted_label": r["predicted_label"],
                    "uncertainty": "" if r.get("uncertainty") is None else f"{r['uncertainty']:.6g}",
                }
            )
    tmp.replace(path)


def read_per_example(path: str | None) -> list[dict[str, Any]]:
    if not path or not Path(path).is_file():
        return []
    out = []
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out.append(
                {
                    "signal_id": int(r["signal_id"]),
                    "kepid": int(r["kepid"]),
                    "signal_key": r.get("signal_key") or None,
                    "label": int(r["label"]),
                    "prob": float(r["prob"]),
                    "raw_prob": float(r["raw_prob"]),
                    "predicted_label": int(r["predicted_label"]),
                    "uncertainty": float(r["uncertainty"]) if r.get("uncertainty") else None,
                }
            )
    return out


# --------------------------------------------------------------------------------------------------
# Queries
# --------------------------------------------------------------------------------------------------
def get_evaluation(session: Session, evaluation_id: int) -> Evaluation:
    ev = session.get(Evaluation, evaluation_id)
    if ev is None:
        raise not_found("Evaluation", "evaluation_not_found", "List evaluations with GET /api/evaluation.")
    return ev


def _split_metrics(d: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    flat = {k: v for k, v in (d or {}).items() if not isinstance(v, dict)}
    return flat, (d or {}).get("at_0_5")


def _test_number(session: Session, ev: Evaluation) -> int | None:
    if ev.split != "test":
        return None
    return int(
        session.scalar(
            select(func.count())
            .select_from(Evaluation)
            .where(
                Evaluation.model_version_id == ev.model_version_id,
                Evaluation.split == "test",
                Evaluation.id <= ev.id,
            )
        )
        or 0
    )


def evaluation_summary(session: Session, ev: Evaluation) -> dict[str, Any]:
    mv = session.get(ModelVersion, ev.model_version_id)
    ds = session.get(Dataset, ev.dataset_id)
    metrics, _ = _split_metrics(ev.metrics)
    return to_jsonable(
        {
            "id": ev.id,
            "model_version_id": ev.model_version_id,
            "model_name": mv.name if mv else None,
            "model_type": mv.model_type if mv else None,
            "experiment_id": mv.experiment_id if mv else None,
            "is_fixture": bool(mv.is_fixture) if mv else False,
            "dataset_id": ev.dataset_id,
            "dataset_name": ds.name if ds else None,
            "split": ev.split,
            "threshold": ev.threshold,
            "n": metrics.get("n"),
            "n_pos": metrics.get("n_pos"),
            "n_neg": metrics.get("n_neg"),
            "summary": {k: metrics.get(k) for k in SUMMARY_METRICS},
            "test_evaluation_number": _test_number(session, ev),
            "created_at": ev.created_at,
        }
    )


def list_evaluations(
    session: Session,
    model_version_id: int | None = None,
    dataset_id: int | None = None,
    split: str | None = None,
) -> list[dict[str, Any]]:
    q = select(Evaluation).order_by(Evaluation.created_at.desc(), Evaluation.id.desc())
    if model_version_id is not None:
        q = q.where(Evaluation.model_version_id == model_version_id)
    if dataset_id is not None:
        q = q.where(Evaluation.dataset_id == dataset_id)
    if split:
        q = q.where(Evaluation.split == split)
    return [evaluation_summary(session, ev) for ev in session.scalars(q)]


def evaluation_detail(session: Session, evaluation_id: int) -> dict[str, Any]:
    ev = get_evaluation(session, evaluation_id)
    out = evaluation_summary(session, ev)
    metrics, at05 = _split_metrics(ev.metrics)
    ci = {k: v for k, v in (ev.ci or {}).items() if k != "method"}
    out.update(
        {
            "metrics": metrics,
            "metrics_at_0_5": at05,
            "ci": ci,
            "ci_method": (ev.ci or {}).get("method"),
            "curves": ev.curves or {},
            "confusion": ev.confusion or {},
            "timing": ev.timing or {},
            "per_example_available": bool(ev.per_example_path and Path(ev.per_example_path).is_file()),
        }
    )
    return to_jsonable(out)


def outcome_of(label: int, predicted: int) -> str:
    if predicted == 1:
        return "tp" if label == 1 else "fp"
    return "fn" if label == 1 else "tn"


def evaluation_examples(
    session: Session, evaluation_id: int, outcome: str | None = None, limit: int = 24, offset: int = 0
) -> dict[str, Any]:
    """Scored examples of an evaluation (most confident mistakes/hits first) with their local view."""
    if outcome is not None and outcome not in OUTCOMES:
        raise bad_request(f"Unknown outcome {outcome!r}", "invalid_outcome", "Use tp, fp, fn or tn.")
    ev = get_evaluation(session, evaluation_id)
    rows = read_per_example(ev.per_example_path)
    if not rows and ev.per_example_path:
        raise conflict(
            "The per-example results file is missing", "per_example_missing", "Run the evaluation again."
        )
    for r in rows:
        r["outcome"] = outcome_of(r["label"], r["predicted_label"])
    counts = {o: sum(1 for r in rows if r["outcome"] == o) for o in OUTCOMES}
    if outcome:
        rows = [r for r in rows if r["outcome"] == outcome]
    # confident first: high scores for predicted planet-like, low scores for predicted false-positive-like
    rows.sort(key=lambda r: (-r["prob"] if r["predicted_label"] == 1 else r["prob"], r["signal_id"]))
    total = len(rows)
    page = rows[max(0, offset) : max(0, offset) + max(1, min(limit, 200))]
    ds = session.get(Dataset, ev.dataset_id)
    arrays = load_arrays_cached(ds.path) if ds is not None and ds.path and Path(ds.path).is_dir() else None
    index = {int(s): i for i, s in enumerate(arrays.signal_ids)} if arrays is not None else {}
    sigs = {
        s.id: s for s in session.scalars(select(Signal).where(Signal.id.in_([r["signal_id"] for r in page])))
    }
    items = []
    for r in page:
        sig = sigs.get(r["signal_id"])
        item = {
            **r,
            "signal_key": sig.signal_key if sig else r.get("signal_key"),
            "kepoi_name": sig.kepoi_name if sig else None,
            "kepler_name": sig.kepler_name if sig else None,
            "category": sig.category if sig else None,
            "av_training_set": sig.av_training_set if sig else None,
            "koi_disposition": sig.koi_disposition if sig else None,
            "period_days": finite_or_none(sig.period_days) if sig else None,
            "duration_hours": finite_or_none(sig.duration_hours) if sig else None,
            "depth_ppm": finite_or_none(sig.depth_ppm) if sig else None,
            "local_view": None,
            "local_phase": None,
        }
        i = index.get(r["signal_id"])
        if i is not None and sig is not None:
            lv = arrays.local_view[i]
            _, lphase = view_phases(sig.period_days, sig.duration_hours, arrays.global_bins, lv.size)
            item["local_view"] = lv
            item["local_phase"] = lphase
        items.append(item)
    return to_jsonable({"total": total, "counts": counts, "items": items}, float_digits=6)


def compare_evaluations(session: Session, ids: list[int]) -> dict[str, Any]:
    """Aligned metric table (with CIs) for several evaluations; warns when they are not comparable."""
    evs = [get_evaluation(session, i) for i in ids]
    warnings: list[str] = []
    datasets = {ev.dataset_id for ev in evs}
    splits = {ev.split for ev in evs}
    if len(datasets) > 1:
        warnings.append(
            f"Evaluations use different datasets ({sorted(datasets)}): metrics are not directly comparable."
        )
    if len(splits) > 1:
        warnings.append(f"Evaluations use different splits ({sorted(splits)}): compare like with like.")
    fixtures = [
        ev.id for ev in evs if (mv := session.get(ModelVersion, ev.model_version_id)) and mv.is_fixture
    ]
    if fixtures:
        warnings.append(f"Evaluations {fixtures} belong to TEST FIXTURE models: not scientific results.")
    rows = []
    for metric in COMPARE_METRICS:
        values, cis = {}, {}
        for ev in evs:
            flat, _ = _split_metrics(ev.metrics)
            values[str(ev.id)] = ev.threshold if metric == "threshold" else flat.get(metric)
            ci = (ev.ci or {}).get(metric)
            cis[str(ev.id)] = ci if isinstance(ci, list) else None
        numeric = {k: v for k, v in values.items() if isinstance(v, (int, float)) and math.isfinite(v)}
        best = None
        if numeric and metric not in ("threshold", "n", "n_pos", "n_neg"):
            pick = min if metric in ("brier", "ece") else max
            best = pick(numeric, key=numeric.get)
        rows.append({"metric": metric, "values": values, "ci": cis, "best": best})
    return to_jsonable(
        {
            "evaluations": [evaluation_summary(session, ev) for ev in evs],
            "metrics": rows,
            "comparable": len(datasets) == 1 and len(splits) == 1,
            "warnings": warnings,
        }
    )


# --------------------------------------------------------------------------------------------------
# Feature importance (baselines)
# --------------------------------------------------------------------------------------------------
def feature_importance(
    session: Session, evaluation_id: int, n_repeats: int = 5, seed: int = 0
) -> dict[str, Any]:
    """Grouped permutation importance of a logistic-regression / random-forest model on the evaluated split.

    Feature groups: the whole downsampled global view, the whole local view, and each physical feature.
    Importance = drop in PR-AUC (average precision) when the group's columns are shuffled across
    examples (mean and std over ``n_repeats``). The model's intrinsic importances (LR coefficients /
    RF impurity importances, from training) are included for reference. Cached per evaluation.
    """
    from exofinder.ml.checkpoint import load_model_bundle
    from exofinder.ml.features import baseline_feature_matrix
    from exofinder.ml.metrics import average_precision
    from exofinder.ml.models.baselines import positive_proba

    ev = get_evaluation(session, evaluation_id)
    mv = get_model(session, ev.model_version_id)
    if mv.model_type not in ("logreg", "random_forest"):
        raise conflict(
            "Permutation importance is available for the logistic regression and random forest baselines only",
            "not_supported_for_cnn",
            "CNNs learn from the raw views; inspect their errors with the evaluation examples instead.",
        )
    n_repeats = max(1, min(int(n_repeats), 50))
    cache = (
        Path(ev.per_example_path).parent / f"feature_importance_r{n_repeats}_s{seed}.json"
        if ev.per_example_path
        else None
    )
    if cache is not None and cache.is_file():
        return json.loads(cache.read_text("utf-8"))
    ds = get_dataset(session, ev.dataset_id)
    require_ready(ds)
    loaded = load_model_bundle(mv.checkpoint_path)
    data = load_arrays_cached(ds.path).subset(ev.split)
    X, names = baseline_feature_matrix(data.global_view, data.local_view, data.features, data.feature_names)
    y = data.labels
    est = loaded.sklearn_model
    base = average_precision(y, positive_proba(est, X))
    if base is None:
        raise conflict("The evaluated split has a single class; PR-AUC is undefined", "split_single_class")
    # View bins are named global_000.. / local_000..; physical features such as local_asymmetry or
    # global_secondary_min share the prefix but must stay separate groups.
    global_bins = [i for i, n in enumerate(names) if re.fullmatch(r"global_\d+", n)]
    local_bins = [i for i, n in enumerate(names) if re.fullmatch(r"local_\d+", n)]
    groups: list[tuple[str, str, list[int]]] = [
        ("global_view", f"Global view (all {len(global_bins)} downsampled bins)", global_bins),
        ("local_view", f"Local view (all {len(local_bins)} bins)", local_bins),
    ]
    view_cols = set(global_bins) | set(local_bins)
    groups += [(n, n, [i]) for i, n in enumerate(names) if i not in view_cols]
    rng = np.random.default_rng(int(seed))
    rows = []
    for key, label, cols in groups:
        if not cols:
            continue
        drops = []
        for _ in range(n_repeats):
            Xp = X.copy()
            perm = rng.permutation(X.shape[0])
            Xp[:, cols] = X[perm][:, cols]
            ap = average_precision(y, positive_proba(est, Xp))
            drops.append(base - ap if ap is not None else np.nan)
        arr = np.asarray(drops, dtype=np.float64)
        rows.append(
            {
                "feature": key,
                "label": label,
                "n_columns": len(cols),
                "importance_mean": float(np.nanmean(arr)) if np.isfinite(arr).any() else None,
                "importance_std": float(np.nanstd(arr)) if np.isfinite(arr).any() else None,
            }
        )
    rows.sort(key=lambda r: -(r["importance_mean"] if r["importance_mean"] is not None else -math.inf))
    out = to_jsonable(
        {
            "evaluation_id": ev.id,
            "model_version_id": mv.id,
            "model_type": mv.model_type,
            "split": ev.split,
            "n_examples": int(len(y)),
            "metric": "pr_auc",
            "baseline_score": base,
            "n_repeats": n_repeats,
            "seed": int(seed),
            "method": "grouped permutation importance (drop in PR-AUC when the group's columns are shuffled)",
            "features": rows,
            "intrinsic": loaded.meta.get("top_features") or [],
            "intrinsic_meaning": "coefficients on standardised inputs (sorted by magnitude)"
            if mv.model_type == "logreg"
            else "mean impurity decrease (training split)",
            "is_fixture": bool(mv.is_fixture),
        }
    )
    if cache is not None and cache.parent.is_dir():
        cache.write_text(json.dumps(out), "utf-8")
    return out
