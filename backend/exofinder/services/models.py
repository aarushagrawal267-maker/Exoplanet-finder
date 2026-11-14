"""Trained model versions: listing, details (with model card), activation and deletion.

The *active* model is the default for predictions (unless the ``default_model_id`` setting names
another). Deleting a model removes its checkpoint directory, its evaluations and the predictions made
with it (they reference the model and would be meaningless without it).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from exofinder.config import PIPELINE_VERSION
from exofinder.db.models import Dataset, Evaluation, Experiment, ModelVersion, Prediction
from exofinder.services.jsonutil import to_jsonable
from exofinder.services.ops_common import dir_size_bytes, remove_tree
from exofinder.services.ops_errors import conflict, not_found

#: Keys of the bundle's meta.json exposed in the model detail.
_BUNDLE_META_KEYS = (
    "best_params",
    "cv_folds",
    "cv_scoring",
    "cv_results",
    "top_features",
    "calibration_method",
    "logit_offset",
    "architecture",
    "n_params_per_member",
    "n_params_meaning",
    "member_best_epochs",
    "member_epochs_run",
    "num_threads",
    "library_versions",
    "created_at",
    "train_counts",
    "val_counts",
    "n_input_features",
    "label_mode",
)


def get_model(session: Session, model_id: int) -> ModelVersion:
    mv = session.get(ModelVersion, model_id)
    if mv is None:
        raise not_found("Model version", "model_not_found", "List models with GET /api/models.")
    return mv


def active_model(session: Session) -> ModelVersion | None:
    return session.scalar(select(ModelVersion).where(ModelVersion.is_active.is_(True)).limit(1))


def _card_name(model_type: str) -> str:
    from exofinder.services.training import MODEL_TYPE_LABELS

    return MODEL_TYPE_LABELS.get(model_type, model_type)


def model_summary(session: Session, mv: ModelVersion) -> dict[str, Any]:
    """Plain dict for ``ModelVersionOut``."""
    ds = session.get(Dataset, mv.dataset_id) if mv.dataset_id is not None else None
    counts = dict(
        session.execute(
            select(Evaluation.split, func.count())
            .where(Evaluation.model_version_id == mv.id)
            .group_by(Evaluation.split)
        ).all()
    )
    path = Path(mv.checkpoint_path) if mv.checkpoint_path else None
    return to_jsonable(
        {
            "id": mv.id,
            "name": mv.name,
            "model_type": mv.model_type,
            "model_type_name": _card_name(mv.model_type),
            "experiment_id": mv.experiment_id,
            "dataset_id": mv.dataset_id,
            "dataset_name": ds.name if ds else None,
            "pipeline_version": mv.pipeline_version,
            "compatible": mv.pipeline_version == PIPELINE_VERSION,
            "checkpoint_path": mv.checkpoint_path,
            "checkpoint_exists": bool(path and (path / "meta.json").is_file()),
            "threshold": mv.threshold,
            "temperature": mv.temperature,
            "ensemble_size": mv.ensemble_size,
            "n_params": mv.n_params,
            "is_active": bool(mv.is_active),
            "is_fixture": bool(mv.is_fixture),
            "val_metrics": mv.val_metrics or {},
            "test_metrics": mv.test_metrics or {},
            "n_evaluations": int(sum(counts.values())),
            "n_test_evaluations": int(counts.get("test", 0)),
            "created_at": mv.created_at,
        }
    )


def list_models(session: Session, include_fixtures: bool = True) -> list[dict[str, Any]]:
    q = select(ModelVersion).order_by(ModelVersion.created_at.desc(), ModelVersion.id.desc())
    if not include_fixtures:
        q = q.where(ModelVersion.is_fixture.is_(False))
    return [model_summary(session, mv) for mv in session.scalars(q)]


def model_detail(session: Session, model_id: int) -> dict[str, Any]:
    """Summary + model card, training configuration, bundle metadata and evaluations."""
    from exofinder.ml.checkpoint import BundleError, read_bundle_meta
    from exofinder.ml.model_cards import get_model_card

    mv = get_model(session, model_id)
    out = model_summary(session, mv)
    exp = session.get(Experiment, mv.experiment_id) if mv.experiment_id else None
    meta: dict[str, Any] = {}
    meta_error = None
    if mv.checkpoint_path:
        try:
            meta = read_bundle_meta(mv.checkpoint_path)
        except BundleError as exc:
            meta_error = str(exc)
    evals = session.scalars(
        select(Evaluation).where(Evaluation.model_version_id == mv.id).order_by(Evaluation.created_at)
    ).all()
    out.update(
        {
            "model_card": to_jsonable(get_model_card(mv.model_type)),
            "config": (exp.config if exp else meta.get("config")) or {},
            "bundle": to_jsonable({k: meta[k] for k in _BUNDLE_META_KEYS if k in meta}),
            "bundle_error": meta_error,
            "checkpoint_bytes": dir_size_bytes(mv.checkpoint_path),
            "training": {
                "experiment_name": exp.name if exp else None,
                "best_epoch": exp.best_epoch if exp else None,
                "epochs_run": exp.epochs_run if exp else None,
                "duration_s": exp.duration_s if exp else None,
                "device": exp.device if exp else None,
                "seed": exp.seed if exp else None,
            },
            "evaluations": [
                {
                    "id": ev.id,
                    "split": ev.split,
                    "dataset_id": ev.dataset_id,
                    "threshold": ev.threshold,
                    "pr_auc": (ev.metrics or {}).get("pr_auc"),
                    "roc_auc": (ev.metrics or {}).get("roc_auc"),
                    "f1": (ev.metrics or {}).get("f1"),
                    "created_at": ev.created_at,
                }
                for ev in evals
            ],
        }
    )
    return to_jsonable(out)


def activate_model(session: Session, model_id: int) -> dict[str, Any]:
    """Make ``model_id`` the active model (409 if incompatible or its checkpoint is missing)."""
    mv = get_model(session, model_id)
    if mv.pipeline_version != PIPELINE_VERSION:
        raise conflict(
            f"Model {mv.id} was trained with pipeline {mv.pipeline_version} (running {PIPELINE_VERSION})",
            "incompatible_pipeline",
            "Retrain the model on a dataset built with the current pipeline.",
        )
    if not (mv.checkpoint_path and (Path(mv.checkpoint_path) / "meta.json").is_file()):
        raise conflict(
            "The model's checkpoint files are missing", "checkpoint_missing", "Delete the model and retrain."
        )
    for other in session.scalars(select(ModelVersion).where(ModelVersion.is_active.is_(True))):
        other.is_active = False
    mv.is_active = True
    session.commit()
    return model_summary(session, mv)


def delete_model_rows(session: Session, model_id: int) -> dict[str, int]:
    """Delete a model version, its evaluations (and files), its predictions and its checkpoint dir.

    No safety checks (callers decide); if it was active, the most recent remaining compatible model
    (non-fixture models first) becomes active.
    """
    mv = session.get(ModelVersion, model_id)
    if mv is None:
        return {"models": 0, "evaluations": 0, "predictions": 0}
    was_active = bool(mv.is_active)
    n_pred = 0
    artefacts: set[str] = set()
    for p in session.scalars(select(Prediction).where(Prediction.model_version_id == model_id)).all():
        if p.artifacts_path:
            artefacts.add(p.artifacts_path)
        session.delete(p)
        n_pred += 1
    session.flush()
    for path in artefacts:  # a request scoring several models may share one artefact file
        still_used = session.scalar(select(Prediction.id).where(Prediction.artifacts_path == path).limit(1))
        if still_used is None:
            remove_tree(path)
    n_eval = 0
    for ev in session.scalars(select(Evaluation).where(Evaluation.model_version_id == model_id)).all():
        remove_tree(Path(ev.per_example_path).parent if ev.per_example_path else None)
        session.delete(ev)
        n_eval += 1
    path = mv.checkpoint_path
    session.delete(mv)
    session.flush()
    remove_tree(path)
    if was_active:
        _promote_replacement(session)
    _clear_default_setting(session, model_id)
    return {"models": 1, "evaluations": n_eval, "predictions": n_pred}


def _promote_replacement(session: Session) -> int | None:
    candidates = session.scalars(
        select(ModelVersion)
        .where(ModelVersion.pipeline_version == PIPELINE_VERSION)
        .order_by(ModelVersion.is_fixture, ModelVersion.created_at.desc(), ModelVersion.id.desc())
    ).all()
    for mv in candidates:
        if mv.checkpoint_path and (Path(mv.checkpoint_path) / "meta.json").is_file():
            mv.is_active = True
            session.flush()
            return mv.id
    return None


def _clear_default_setting(session: Session, model_id: int) -> None:
    from exofinder.services import app_settings

    try:
        if app_settings.get_all(session).get("default_model_id") == model_id:
            app_settings.update(session, {"default_model_id": None})
    except Exception:  # noqa: BLE001 - a settings problem must not block a deletion
        pass


def delete_model(session: Session, model_id: int, force: bool = False) -> dict[str, Any]:
    """Delete a model version (``DELETE /api/models/{id}``).

    Deleting the active model is refused when it is the only model (predictions would stop working)
    unless ``force``; otherwise another model is promoted to active.
    """
    mv = get_model(session, model_id)
    if mv.is_active and not force:
        others = (
            session.scalar(select(func.count()).select_from(ModelVersion).where(ModelVersion.id != mv.id))
            or 0
        )
        if others == 0:
            raise conflict(
                "This is the only (active) model",
                "model_is_active",
                "Train another model first, or repeat with ?force=true to delete it anyway.",
            )
    counts = delete_model_rows(session, model_id)
    session.commit()
    new_active = active_model(session)
    return {
        "deleted": True,
        "model_id": model_id,
        **counts,
        "active_model_id": new_active.id if new_active else None,
    }
