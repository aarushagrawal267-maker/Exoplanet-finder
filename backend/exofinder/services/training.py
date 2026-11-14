"""Model training: model types, epoch-time estimates, training runs (job ``train``) and suites
(job ``train_suite``: logistic regression, random forest, single-view CNN and two-view CNN trained
sequentially on the same dataset, each as its own experiment).

Every run is an :class:`~exofinder.db.models.Experiment` (configuration, seed, device, software
environment, per-epoch metrics). A successful run registers a
:class:`~exofinder.db.models.ModelVersion` whose checkpoint bundle lives in
``artifacts/models/<model_version_id>/``; the first successful model becomes the active one when no
model is active. Cancelled or failed runs leave no checkpoint files behind.

Only the train and validation splits are used here (model selection, early stopping, calibration,
threshold); the test split is reserved for :mod:`exofinder.services.evaluation`.

Models trained on a dataset built from synthetic (test) light curves are marked ``is_fixture=True``
automatically, so they can never be presented as real results.
"""

from __future__ import annotations

import logging
import os
import subprocess
from functools import partial
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from exofinder import __version__
from exofinder.config import PIPELINE_VERSION, REPO_ROOT, get_settings
from exofinder.db.models import Dataset, EpochMetric, Experiment, ModelVersion, utcnow
from exofinder.db.session import session_scope
from exofinder.jobs.runner import JobCancelled, JobContext
from exofinder.ml import MODEL_TYPES
from exofinder.services import app_settings
from exofinder.services.datasets import get_dataset, require_ready
from exofinder.services.jobs import JobSpec, ProgressRange
from exofinder.services.jsonutil import to_jsonable
from exofinder.services.ops_common import load_arrays_cached, remove_tree
from exofinder.services.ops_errors import bad_request, conflict

log = logging.getLogger("exofinder.services.training")

MODEL_TYPE_LABELS = {
    "logreg": "Logistic regression",
    "random_forest": "Random forest",
    "cnn_single": "Single-view CNN",
    "cnn_two_view": "Two-view CNN (AstroNet)",
}
#: Fields of TrainConfig that a client may not set (chosen by the service).
_RESERVED_CONFIG_KEYS = {"model_type"}


# --------------------------------------------------------------------------------------------------
# Model types and estimates
# --------------------------------------------------------------------------------------------------
def model_types() -> list[dict[str, Any]]:
    """Model cards of the four model types (``GET /api/training/model-types``)."""
    from exofinder.ml.model_cards import list_model_cards

    return to_jsonable(list_model_cards())


def _check_model_type(model_type: str) -> None:
    if model_type not in MODEL_TYPES:
        raise bad_request(
            f"Unknown model type {model_type!r}",
            "invalid_model_type",
            f"Use one of {', '.join(MODEL_TYPES)}.",
        )


def build_train_config(model_type: str, config: dict[str, Any] | None, session: Session | None = None):
    """Validated :class:`~exofinder.ml.train.TrainConfig` from a client config dict (400 on bad values)."""
    from exofinder.ml.train import TrainConfig

    _check_model_type(model_type)
    cfg = dict(config or {})
    known = set(TrainConfig.__dataclass_fields__)
    unknown = sorted(set(cfg) - known)
    if unknown:
        raise bad_request(
            f"Unknown training option(s): {', '.join(unknown)}",
            "invalid_config",
            f"Known options: {', '.join(sorted(known - _RESERVED_CONFIG_KEYS))}.",
        )
    if cfg.get("model_type") not in (None, model_type):
        raise bad_request("config.model_type differs from model_type", "invalid_config")
    cfg["model_type"] = model_type
    if not cfg.get("device"):
        cfg["device"] = (
            app_settings.get_value("device", session) if session is not None else get_settings().device
        )
    try:
        return TrainConfig.from_dict(cfg)
    except (TypeError, ValueError) as exc:
        raise bad_request(f"Invalid training configuration: {exc}", "invalid_config") from exc


def estimate(
    session: Session, model_type: str, dataset_id: int, config: dict[str, Any] | None = None
) -> dict:
    """Measured seconds per epoch (a few real training steps on the dataset's own examples)."""
    from exofinder.ml.train import estimate_epoch_seconds

    ds = get_dataset(session, dataset_id)
    require_ready(ds)
    cfg = build_train_config(model_type, config, session)
    arrays = load_arrays_cached(ds.path)
    info = estimate_epoch_seconds(cfg, arrays)
    per_epoch = info.get("seconds_per_epoch")
    info.update(
        {
            "dataset_id": dataset_id,
            "max_epochs": cfg.max_epochs if model_type in ("cnn_single", "cnn_two_view") else None,
            "ensemble_size": cfg.ensemble_size,
            "est_max_total_seconds": (per_epoch * cfg.max_epochs * cfg.ensemble_size) if per_epoch else None,
            "note": (
                "Measured on this machine with a few real training steps; early stopping usually ends "
                "training before max_epochs."
                if per_epoch
                else "Baselines have no epochs: they train in one step (grid search with grouped "
                "cross-validation), typically seconds to a few minutes."
            ),
        }
    )
    return to_jsonable(info)


# --------------------------------------------------------------------------------------------------
# Starting runs
# --------------------------------------------------------------------------------------------------
def _git_commit() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return out.stdout.strip() or None if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _environment() -> dict[str, Any]:
    from exofinder.ml.device import environment_info

    env = environment_info()
    env.update({"exofinder": __version__, "pipeline_version": PIPELINE_VERSION, "git_commit": _git_commit()})
    return env


def _resolved_device(cfg: Any) -> str:
    if cfg.model_type in ("logreg", "random_forest"):
        return "cpu"
    from exofinder.ml.device import resolve_device

    return str(resolve_device(cfg.device))


def _dataset_for_training(session: Session, dataset_id: int) -> Dataset:
    ds = get_dataset(session, dataset_id)
    require_ready(ds)
    if ds.pipeline_version != PIPELINE_VERSION:
        raise conflict(
            f"Dataset {ds.id} was built with pipeline {ds.pipeline_version}; the running pipeline is "
            f"{PIPELINE_VERSION}",
            "incompatible_pipeline",
            "Rebuild the dataset with the current pipeline before training.",
        )
    if ds.n_train == 0 or ds.n_val == 0:
        raise conflict(
            "The dataset needs training and validation examples",
            "dataset_too_small",
            "Build a larger dataset (e.g. the pilot tier).",
        )
    return ds


def _new_experiment(
    session: Session, *, name: str | None, model_type: str, ds: Dataset, cfg: Any, env: dict[str, Any]
) -> Experiment:
    exp = Experiment(
        name=(name or f"{MODEL_TYPE_LABELS[model_type]} - {ds.name}")[:128],
        model_type=model_type,
        dataset_id=ds.id,
        status="queued",
        config=cfg.to_dict(),
        seed=int(cfg.seed),
        device=_resolved_device(cfg),
        environment=env,
        tags=["fixture"] if (ds.config or {}).get("synthetic") else [],
    )
    session.add(exp)
    return exp


def _link_job(experiment_ids: list[int], job_id: str) -> None:
    with session_scope() as s:
        for eid in experiment_ids:
            exp = s.get(Experiment, eid)
            if exp is not None and exp.job_id is None:
                exp.job_id = job_id


def start_training(
    session: Session,
    *,
    model_type: str,
    dataset_id: int,
    name: str | None = None,
    config: dict[str, Any] | None = None,
    is_fixture: bool = False,
) -> tuple[Experiment, JobSpec]:
    """Create the experiment row (status ``queued``) and the ``train`` job that runs it."""
    cfg = build_train_config(model_type, config, session)
    ds = _dataset_for_training(session, dataset_id)
    exp = _new_experiment(session, name=name, model_type=model_type, ds=ds, cfg=cfg, env=_environment())
    session.commit()
    eid = exp.id
    spec = JobSpec(
        kind="train",
        title=f"Train {MODEL_TYPE_LABELS[model_type]} on '{ds.name}'",
        fn=partial(run_training, experiment_id=eid, is_fixture=is_fixture),
        params={"experiment_id": eid, "model_type": model_type, "dataset_id": ds.id, "config": cfg.to_dict()},
        on_created=partial(_link_job, [eid]),
    )
    return exp, spec


def start_suite(
    session: Session,
    *,
    dataset_id: int,
    name_prefix: str | None = None,
    configs: dict[str, dict[str, Any]] | None = None,
    model_types: tuple[str, ...] | list[str] | None = None,
    is_fixture: bool = False,
) -> tuple[list[Experiment], JobSpec]:
    """Create one experiment per model type and a single ``train_suite`` job training them in order."""
    types = list(model_types or MODEL_TYPES)
    for t in types:
        _check_model_type(t)
    configs = dict(configs or {})
    unknown = sorted(set(configs) - set(types))
    if unknown:
        raise bad_request(f"configs given for model types not in the suite: {unknown}", "invalid_config")
    ds = _dataset_for_training(session, dataset_id)
    env = _environment()
    exps = []
    for t in types:
        cfg = build_train_config(t, configs.get(t), session)
        name = f"{name_prefix} - {MODEL_TYPE_LABELS[t]}" if name_prefix else None
        exps.append(_new_experiment(session, name=name, model_type=t, ds=ds, cfg=cfg, env=env))
    session.commit()
    ids = [e.id for e in exps]
    spec = JobSpec(
        kind="train_suite",
        title=f"Train model suite ({len(ids)} models) on '{ds.name}'",
        fn=partial(run_suite, experiment_ids=ids, is_fixture=is_fixture),
        params={"experiment_ids": ids, "dataset_id": ds.id, "model_types": types},
        on_created=partial(_link_job, ids),
    )
    return exps, spec


# --------------------------------------------------------------------------------------------------
# Job functions
# --------------------------------------------------------------------------------------------------
def _finish_experiment(experiment_id: int, status: str, error: str | None = None) -> None:
    with session_scope() as s:
        exp = s.get(Experiment, experiment_id)
        if exp is not None:
            exp.status = status
            exp.error = error
            exp.finished_at = utcnow()


def _fmt(x: Any) -> str:
    return f"{x:.3f}" if isinstance(x, (int, float)) else "n/a"


def run_training(
    ctx: JobContext,
    experiment_id: int,
    progress: ProgressRange | None = None,
    label: str | None = None,
    is_fixture: bool = False,
) -> dict[str, Any]:
    """Train one experiment (job function of ``train``; also called by :func:`run_suite`)."""
    from exofinder.ml.train import TrainConfig, TrainingCancelled, TrainingDiverged, train

    prange = progress or ProgressRange(ctx, 0.0, 1.0)
    with session_scope() as s:
        exp = s.get(Experiment, experiment_id)
        if exp is None:
            raise RuntimeError(f"experiment {experiment_id} was deleted before training started")
        ds = s.get(Dataset, exp.dataset_id)
        if ds is None or ds.status != "ready" or not ds.path:
            exp.status, exp.error, exp.finished_at = "failed", "dataset not available", utcnow()
            raise RuntimeError(f"dataset {exp.dataset_id} is not available")
        exp.status, exp.error, exp.job_id = "running", None, exp.job_id or ctx.job_id
        s.execute(delete(EpochMetric).where(EpochMetric.experiment_id == experiment_id))
        cfg = TrainConfig.from_dict(exp.config)
        name, model_type, dataset_id, ds_path = exp.name, exp.model_type, ds.id, ds.path
        fixture = bool(is_fixture or (ds.config or {}).get("synthetic"))
    tag = label or MODEL_TYPE_LABELS.get(model_type, model_type)
    arrays = load_arrays_cached(ds_path)
    if arrays.meta.get("dataset_id") not in (None, dataset_id):
        raise RuntimeError(f"arrays in {ds_path} belong to dataset {arrays.meta.get('dataset_id')}")
    models_dir = get_settings().models_dir
    tmp_dir = models_dir / f"_training_exp{experiment_id}_{ctx.job_id[:8]}"
    remove_tree(tmp_dir)
    state = {"member": 0, "offset": 0, "last": 0}

    def on_epoch(rec: dict[str, Any]) -> None:
        member = int(rec.get("member") or 0)
        if member != state["member"]:
            state["offset"] += state["last"]
            state["member"] = member
        state["last"] = int(rec.get("epoch") or 0)
        global_epoch = state["offset"] + state["last"]
        with session_scope() as s2:
            s2.add(
                EpochMetric(
                    experiment_id=experiment_id,
                    epoch=global_epoch,
                    train_loss=_num(rec.get("train_loss")),
                    val_loss=_num(rec.get("val_loss")),
                    val_pr_auc=_num(rec.get("val_pr_auc")),
                    val_roc_auc=_num(rec.get("val_roc_auc")),
                    val_accuracy=_num(rec.get("val_accuracy")),
                    lr=_num(rec.get("lr")),
                    elapsed_s=_num(rec.get("elapsed_s")),
                )
            )
        ctx.event(
            "epoch",
            to_jsonable(
                {
                    **rec,
                    "experiment_id": experiment_id,
                    "model_type": model_type,
                    "global_epoch": global_epoch,
                }
            ),
        )
        members = int(rec.get("n_members") or cfg.ensemble_size or 1)
        member_txt = f" member {member + 1}/{members}" if members > 1 else ""
        if model_type in ("logreg", "random_forest"):
            step = "fitted"
        else:
            step = f"epoch {rec.get('epoch')}/{rec.get('max_epochs') or cfg.max_epochs}"
        prange(
            float(rec.get("progress") or 0.0),
            f"{tag}{member_txt}: {step}, val PR-AUC {_fmt(rec.get('val_pr_auc'))}",
        )

    ctx.log(
        f"Training {tag} (experiment {experiment_id}) on dataset {dataset_id}: "
        f"{int((arrays.splits == 'train').sum())} train / {int((arrays.splits == 'val').sum())} val examples"
    )
    prange(
        0.0,
        f"{tag}: training"
        + (" (grid search with grouped CV)" if model_type in ("logreg", "random_forest") else ""),
    )
    try:
        result = train(cfg, arrays, tmp_dir, on_epoch=on_epoch, should_stop=ctx.cancelled)
    except TrainingCancelled:
        remove_tree(tmp_dir)
        _finish_experiment(experiment_id, "cancelled", "Cancelled by user")
        raise JobCancelled() from None
    except TrainingDiverged as exc:
        remove_tree(tmp_dir)
        _finish_experiment(experiment_id, "failed", f"Training diverged: {exc}. Try a lower learning rate.")
        raise
    except BaseException as exc:
        remove_tree(tmp_dir)
        status = "cancelled" if isinstance(exc, JobCancelled) else "failed"
        _finish_experiment(experiment_id, status, f"{type(exc).__name__}: {exc}")
        raise
    return _register_model(ctx, experiment_id, name, model_type, dataset_id, result, tmp_dir, fixture, tag)


def _num(x: Any) -> float | None:
    from exofinder.services.ops_common import finite_or_none

    return finite_or_none(x)


def _register_model(
    ctx: JobContext,
    experiment_id: int,
    name: str,
    model_type: str,
    dataset_id: int,
    result: Any,
    tmp_dir: Any,
    fixture: bool,
    tag: str,
) -> dict[str, Any]:
    val_metrics = to_jsonable({**result.val_metrics, "at_0_5": result.val_metrics_at_0_5})
    final_dir = None
    try:
        with session_scope() as s:
            has_active = s.scalar(select(ModelVersion.id).where(ModelVersion.is_active.is_(True)).limit(1))
            mv = ModelVersion(
                name=name,
                model_type=model_type,
                experiment_id=experiment_id,
                dataset_id=dataset_id,
                pipeline_version=str(result.meta.get("pipeline_version") or PIPELINE_VERSION),
                checkpoint_path="",
                threshold=float(result.threshold),
                temperature=float(result.temperature),
                ensemble_size=int(result.meta.get("ensemble_size") or 1),
                n_params=int(result.n_params) if result.n_params is not None else None,
                is_active=has_active is None,
                is_fixture=fixture,
                val_metrics=val_metrics,
                test_metrics={},
            )
            s.add(mv)
            s.flush()
            final_dir = get_settings().models_dir / str(mv.id)
            remove_tree(final_dir)  # ids can be re-used after a deletion
            os.replace(tmp_dir, final_dir)
            mv.checkpoint_path = str(final_dir)
            exp = s.get(Experiment, experiment_id)
            if exp is not None:
                exp.status = "succeeded"
                exp.error = None
                exp.val_metrics = val_metrics
                exp.best_epoch = int(result.best_epoch)
                exp.epochs_run = int(result.epochs_run)
                exp.duration_s = float(result.duration_s)
                exp.device = str(result.device)
                exp.finished_at = utcnow()
            model_id, active = mv.id, mv.is_active
    except BaseException:
        remove_tree(final_dir or tmp_dir)
        _finish_experiment(experiment_id, "failed", "could not register the trained model")
        raise
    ctx.log(
        f"{tag}: done in {result.duration_s:.1f} s - val PR-AUC {_fmt(result.val_metrics.get('pr_auc'))}, "
        f"ROC-AUC {_fmt(result.val_metrics.get('roc_auc'))}, F1 {_fmt(result.val_metrics.get('f1'))} "
        f"at threshold {result.threshold:.3f}; model version {model_id}" + (" (now active)" if active else "")
    )
    return {
        "experiment_id": experiment_id,
        "model_version_id": model_id,
        "model_type": model_type,
        "val_metrics": val_metrics,
        "best_epoch": int(result.best_epoch),
        "epochs_run": int(result.epochs_run),
        "duration_s": float(result.duration_s),
        "is_active": active,
        "is_fixture": fixture,
    }


def run_suite(ctx: JobContext, experiment_ids: list[int], is_fixture: bool = False) -> dict[str, Any]:
    """Train several experiments one after the other (job function of ``train_suite``).

    A failing model is recorded and the suite continues; cancellation stops the suite and marks the
    remaining experiments cancelled. The job fails only if every model failed.
    """
    n = len(experiment_ids)
    outcomes: list[dict[str, Any]] = []
    for k, eid in enumerate(experiment_ids):
        if ctx.cancelled():
            for rest in experiment_ids[k:]:
                _finish_experiment(rest, "cancelled", "Suite cancelled before this model started")
            raise JobCancelled()
        with session_scope() as s:
            exp = s.get(Experiment, eid)
            model_type = exp.model_type if exp else "?"
        label = f"[{k + 1}/{n}] {MODEL_TYPE_LABELS.get(model_type, model_type)}"
        try:
            res = run_training(
                ctx, eid, ProgressRange(ctx, k / n, (k + 1) / n), label=label, is_fixture=is_fixture
            )
            outcomes.append({"experiment_id": eid, "model_type": model_type, "status": "succeeded", **res})
        except JobCancelled:
            for rest in experiment_ids[k + 1 :]:
                _finish_experiment(rest, "cancelled", "Suite cancelled before this model started")
            raise
        except Exception as exc:  # noqa: BLE001 - keep going with the other models
            ctx.log(f"{label} failed: {type(exc).__name__}: {exc}")
            outcomes.append(
                {
                    "experiment_id": eid,
                    "model_type": model_type,
                    "status": "failed",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
    if outcomes and all(o["status"] == "failed" for o in outcomes):
        raise RuntimeError("every model of the suite failed: " + "; ".join(o["error"] for o in outcomes))
    return {"experiments": outcomes}
