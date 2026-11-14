"""Experiment tracking: list, detail (configuration, environment, epoch curves, model, evaluations),
edit (name/notes/tags/archived), delete (with all artefacts) and side-by-side comparison."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from exofinder.db.models import Dataset, EpochMetric, Evaluation, Experiment, Job, ModelVersion
from exofinder.jobs.runner import get_runner
from exofinder.services.jobs import reconcile_orphans
from exofinder.services.jsonutil import to_jsonable
from exofinder.services.ops_errors import bad_request, conflict, not_found

EPOCH_FIELDS = (
    "epoch",
    "train_loss",
    "val_loss",
    "val_pr_auc",
    "val_roc_auc",
    "val_accuracy",
    "lr",
    "elapsed_s",
)
SUMMARY_VAL_METRICS = ("pr_auc", "roc_auc", "f1", "precision", "recall", "accuracy", "brier", "ece")


def get_experiment(session: Session, experiment_id: int) -> Experiment:
    exp = session.get(Experiment, experiment_id)
    if exp is None:
        raise not_found("Experiment", "experiment_not_found", "List experiments with GET /api/experiments.")
    return exp


def _model_for(session: Session, experiment_id: int) -> ModelVersion | None:
    return session.scalar(
        select(ModelVersion)
        .where(ModelVersion.experiment_id == experiment_id)
        .order_by(ModelVersion.id.desc())
    )


def experiment_summary(session: Session, exp: Experiment) -> dict[str, Any]:
    ds = session.get(Dataset, exp.dataset_id)
    mv = _model_for(session, exp.id)
    vm = exp.val_metrics or {}
    return to_jsonable(
        {
            "id": exp.id,
            "name": exp.name,
            "model_type": exp.model_type,
            "dataset_id": exp.dataset_id,
            "dataset_name": ds.name if ds else None,
            "status": exp.status,
            "seed": exp.seed,
            "device": exp.device,
            "best_epoch": exp.best_epoch,
            "epochs_run": exp.epochs_run,
            "duration_s": exp.duration_s,
            "val_summary": {k: vm.get(k) for k in SUMMARY_VAL_METRICS},
            "threshold": mv.threshold if mv else None,
            "model_version_id": mv.id if mv else None,
            "is_active_model": bool(mv.is_active) if mv else False,
            "is_fixture": bool(mv.is_fixture)
            if mv
            else bool((ds.config or {}).get("synthetic"))
            if ds
            else False,
            "test_metrics": (mv.test_metrics or {}) if mv else {},
            "notes": exp.notes or "",
            "tags": list(exp.tags or []),
            "archived": bool(exp.archived),
            "job_id": exp.job_id,
            "error": exp.error,
            "created_at": exp.created_at,
            "finished_at": exp.finished_at,
        }
    )


def list_experiments(
    session: Session,
    *,
    model_type: str | None = None,
    dataset_id: int | None = None,
    status: str | None = None,
    archived: bool | None = None,
) -> list[dict[str, Any]]:
    reconcile_orphans(session)
    q = select(Experiment).order_by(Experiment.created_at.desc(), Experiment.id.desc())
    if model_type:
        q = q.where(Experiment.model_type == model_type)
    if dataset_id is not None:
        q = q.where(Experiment.dataset_id == dataset_id)
    if status:
        q = q.where(Experiment.status.in_([s.strip() for s in status.split(",") if s.strip()]))
    if archived is not None:
        q = q.where(Experiment.archived.is_(bool(archived)))
    return [experiment_summary(session, e) for e in session.scalars(q)]


def epochs_of(session: Session, experiment_id: int) -> list[dict[str, Any]]:
    rows = session.scalars(
        select(EpochMetric).where(EpochMetric.experiment_id == experiment_id).order_by(EpochMetric.epoch)
    )
    return [to_jsonable({f: getattr(r, f) for f in EPOCH_FIELDS}) for r in rows]


def _history(mv: ModelVersion | None) -> list[dict[str, Any]]:
    """Full per-epoch records (incl. ensemble member index) from the checkpoint bundle, if present."""
    if mv is None or not mv.checkpoint_path:
        return []
    path = Path(mv.checkpoint_path) / "history.json"
    try:
        return to_jsonable(json.loads(path.read_text("utf-8"))) if path.is_file() else []
    except (OSError, ValueError):
        return []


def experiment_detail(session: Session, experiment_id: int) -> dict[str, Any]:
    from exofinder.services.evaluation import evaluation_summary
    from exofinder.services.models import model_summary

    reconcile_orphans(session)
    exp = get_experiment(session, experiment_id)
    out = experiment_summary(session, exp)
    mv = _model_for(session, exp.id)
    evals = (
        session.scalars(
            select(Evaluation).where(Evaluation.model_version_id == mv.id).order_by(Evaluation.id)
        ).all()
        if mv
        else []
    )
    out.update(
        {
            "config": exp.config or {},
            "environment": exp.environment or {},
            "val_metrics": exp.val_metrics or {},
            "epochs": epochs_of(session, exp.id),
            "history": _history(mv),
            "model_version": model_summary(session, mv) if mv else None,
            "evaluations": [evaluation_summary(session, ev) for ev in evals],
        }
    )
    return to_jsonable(out)


def patch_experiment(
    session: Session,
    experiment_id: int,
    *,
    name: str | None = None,
    notes: str | None = None,
    tags: list[str] | None = None,
    archived: bool | None = None,
) -> dict[str, Any]:
    exp = get_experiment(session, experiment_id)
    if name is not None:
        name = name.strip()
        if not name:
            raise bad_request("The name cannot be empty", "invalid_name")
        exp.name = name[:128]
        mv = _model_for(session, exp.id)
        if mv is not None:
            mv.name = exp.name
    if notes is not None:
        exp.notes = notes
    if tags is not None:
        exp.tags = list(dict.fromkeys(t.strip() for t in tags if t and t.strip()))
    if archived is not None:
        exp.archived = bool(archived)
    session.commit()
    return experiment_detail(session, experiment_id)


def delete_experiment_rows(session: Session, experiment_id: int) -> dict[str, int]:
    """Delete an experiment with its epoch metrics, model versions (checkpoints), evaluations and
    predictions. No safety checks (see :func:`delete_experiment`)."""
    from exofinder.services.models import delete_model_rows

    counts = {"experiments": 0, "models": 0, "evaluations": 0, "predictions": 0}
    for mid in session.scalars(
        select(ModelVersion.id).where(ModelVersion.experiment_id == experiment_id)
    ).all():
        for k, v in delete_model_rows(session, mid).items():
            counts[k] = counts.get(k, 0) + v
    session.execute(delete(EpochMetric).where(EpochMetric.experiment_id == experiment_id))
    exp = session.get(Experiment, experiment_id)
    if exp is not None:
        session.delete(exp)
        counts["experiments"] = 1
    session.flush()
    return counts


def delete_experiment(session: Session, experiment_id: int) -> dict[str, Any]:
    """Delete an experiment and all its artefacts (409 while its training job is running)."""
    exp = get_experiment(session, experiment_id)
    job = session.get(Job, exp.job_id) if exp.job_id else None
    job_active = job is not None and job.status in ("queued", "running")  # here or in a CLI process
    if (
        exp.status in ("queued", "running")
        and exp.job_id
        and (get_runner().is_active(exp.job_id) or job_active)
    ):
        raise conflict(
            "The experiment is still training", "experiment_running", "Cancel its job first, then delete it."
        )
    counts = delete_experiment_rows(session, experiment_id)
    session.commit()
    return {"deleted": True, "experiment_id": experiment_id, **counts}


def _flatten(d: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in (d or {}).items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(_flatten(v, key + "."))
        else:
            out[key] = v
    return out


def compare_experiments(session: Session, ids: list[int]) -> dict[str, Any]:
    """Experiments side by side: summaries, configuration differences and epoch curves."""
    exps = [get_experiment(session, i) for i in ids]
    configs = {e.id: _flatten(e.config or {}) for e in exps}
    keys = sorted(set().union(*[set(c) for c in configs.values()])) if configs else []
    diff, same = [], {}
    for k in keys:
        values = {str(e.id): configs[e.id].get(k) for e in exps}
        distinct = {json.dumps(v, sort_keys=True, default=str) for v in values.values()}
        if len(distinct) > 1:
            diff.append({"key": k, "values": values})
        else:
            same[k] = next(iter(values.values()))
    warnings = []
    if len({e.dataset_id for e in exps}) > 1:
        warnings.append(
            "The experiments use different datasets: validation metrics are not directly comparable."
        )
    return to_jsonable(
        {
            "experiments": [experiment_summary(session, e) for e in exps],
            "config_diff": diff,
            "config_same": same,
            "curves": {str(e.id): epochs_of(session, e.id) for e in exps},
            "warnings": warnings,
        }
    )
