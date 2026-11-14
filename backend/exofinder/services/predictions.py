"""Model predictions (``/api/predictions``).

Scoring one signal
------------------
:func:`predict` builds the AstroNet views + physical features of one signal and scores them with
every requested model version:

* **catalogue signal, catalogue ephemeris**: :func:`exofinder.services.signal_views.compute_signal_views`
  (cached; the star's other signals are masked from the trend fit). If the star's light curve is not
  downloaded yet and ``download_if_missing`` is true (default) it is downloaded **synchronously**
  with :func:`exofinder.data.acquire.ensure_lightcurve` (one star: seconds to a minute); otherwise
  the request fails with 409 ``not_downloaded``.
* **catalogue star, BLS ephemeris**: BLS first (cached), then the pipeline at the BLS ephemeris.
* **manual ephemeris** (catalogue star or upload) and **uploads with BLS**: the pipeline at that
  ephemeris.

Each model is loaded once into a thread-safe LRU of :class:`exofinder.ml.inference.Predictor`
objects (keyed by model id + checkpoint ``meta.json`` mtime). Calibrated probabilities come from
the bundle itself (temperature *and* ``logit_offset`` live in its meta; nothing is recomputed
here). The decision threshold is the model's validation-F1 threshold, or 0.5 when the setting
``default_threshold_mode`` is ``fixed_0.5``.

Every result records ``seen_in_split``: whether the star is in the model's dataset and in which
split (splits are by star), so a score on a training star is never mistaken for an unbiased test.
Planet-like scores are research leads, not discoveries.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from exofinder.astro.errors import InsufficientDataError
from exofinder.astro.features import FEATURE_NAMES
from exofinder.astro.pipeline import PipelineConfig, process_lightcurve
from exofinder.astro.types import Ephemeris
from exofinder.config import PIPELINE_VERSION, REPO_ROOT, get_settings
from exofinder.data.lightcurve_store import has_lightcurve
from exofinder.db.models import DatasetExample, ModelVersion, Prediction, Signal, Target
from exofinder.jobs.runner import JobContext, get_runner
from exofinder.services import app_settings
from exofinder.services.catalog import signal_dict
from exofinder.services.jsonutil import to_jsonable
from exofinder.services.sci_common import (
    RESEARCH_LEAD_NOTICE,
    ephemeris_dict,
    finite,
    make_ephemeris,
    to_list,
)
from exofinder.services.sci_errors import bad_request, conflict, not_found
from exofinder.services.sci_sources import SourceData, load_catalog_source, load_source
from exofinder.services.signal_views import (
    SignalEphemerisError,
    SignalNotDownloadedError,
    compute_signal_views,
)

MAX_PREDICTORS = 4
VIEW_DIGITS = 5
CLASS_NAMES = {1: "planet-like", 0: "false-positive-like"}
_predictors: OrderedDict[tuple, Any] = OrderedDict()
_predictors_lock = threading.Lock()


# ------------------------------------------------------------------------------------------------
# models
# ------------------------------------------------------------------------------------------------
def model_dir(mv: ModelVersion) -> Path:
    """Absolute checkpoint directory of a model version (relative paths resolved sensibly)."""
    p = Path(mv.checkpoint_path)
    if p.is_absolute():
        return p
    s = get_settings()
    for base in (s.artifacts_path, s.models_dir, REPO_ROOT):
        if (base / p).exists():
            return base / p
    return s.artifacts_path / p


def get_predictor(mv: ModelVersion):
    """Cached :class:`~exofinder.ml.inference.Predictor` for a model version (thread-safe LRU)."""
    from exofinder.ml.checkpoint import BundleError
    from exofinder.ml.inference import IncompatiblePipelineError, Predictor

    directory = model_dir(mv)
    meta = directory / "meta.json"
    try:
        mtime = meta.stat().st_mtime_ns
    except OSError as exc:
        raise conflict(
            f"Model '{mv.name}' (#{mv.id}) has no checkpoint at {directory}",
            "model_unavailable",
            "The model files were moved or deleted; retrain the model or pick another one.",
        ) from exc
    key = (mv.id, str(directory), mtime, get_settings().device)
    with _predictors_lock:
        hit = _predictors.get(key)
        if hit is not None:
            _predictors.move_to_end(key)
            return hit
        try:
            predictor = Predictor.from_dir(directory, device=get_settings().device)
        except IncompatiblePipelineError as exc:
            raise conflict(
                str(exc),
                "incompatible_model",
                "Retrain the model on a dataset built with the current pipeline.",
            ) from exc
        except (BundleError, OSError, ValueError) as exc:
            raise conflict(
                f"Model '{mv.name}' (#{mv.id}) could not be loaded: {exc}",
                "model_unavailable",
                "Retrain the model or pick another one.",
            ) from exc
        _predictors[key] = predictor
        while len(_predictors) > MAX_PREDICTORS:
            _predictors.popitem(last=False)
        return predictor


def clear_predictor_cache() -> None:
    with _predictors_lock:
        _predictors.clear()


def default_model(session: Session) -> ModelVersion:
    """Settings ``default_model_id``, else the active model; 409 ``no_model`` if neither exists."""
    mid = app_settings.get_value("default_model_id", session)
    if mid is not None:
        mv = session.get(ModelVersion, int(mid))
        if mv is not None:
            return mv
    mv = session.scalars(
        select(ModelVersion).where(ModelVersion.is_active.is_(True)).order_by(ModelVersion.id.desc())
    ).first()
    if mv is not None:
        return mv
    n = session.scalar(select(func.count()).select_from(ModelVersion)) or 0
    if n:
        raise conflict(
            "No model is active and no default model is set",
            "no_model",
            "Activate a model on the Models page, set a default model in Settings, or pass model_version_ids.",
        )
    raise conflict("No trained model is available", "no_model", "Train a model first (Training page).")


def resolve_models(session: Session, ids: list[int] | None) -> list[ModelVersion]:
    if not ids:
        return [default_model(session)]
    out = []
    for mid in dict.fromkeys(int(i) for i in ids):
        mv = session.get(ModelVersion, mid)
        if mv is None:
            raise not_found(f"Model version {mid}", "model_not_found", "List models with GET /api/models.")
        out.append(mv)
    return out


def threshold_for(session: Session, predictor: Any) -> tuple[float, str]:
    mode = app_settings.get_value("default_threshold_mode", session)
    if mode == "fixed_0.5":
        return 0.5, "fixed_0.5"
    return float(predictor.threshold), "validation_f1"


def seen_in_split(session: Session, mv: ModelVersion | None, kepid: int | None) -> str | None:
    """Split of the star in the model's dataset (``train``/``val``/``test``) or None if unseen."""
    if mv is None or kepid is None or mv.dataset_id is None:
        return None
    split = session.scalars(
        select(DatasetExample.split)
        .where(
            DatasetExample.dataset_id == mv.dataset_id,
            DatasetExample.kepid == int(kepid),
            DatasetExample.split.is_not(None),
        )
        .limit(1)
    ).first()
    return str(split) if split else None


def _feature_matrix(features: np.ndarray, names: list[str], predictor: Any, mv: ModelVersion) -> np.ndarray:
    wanted = predictor.physical_feature_names
    if not wanted:
        return features
    index = {n: i for i, n in enumerate(names)}
    missing = [n for n in wanted if n not in index]
    if missing:
        raise conflict(
            f"Model '{mv.name}' needs features this pipeline does not produce: {', '.join(missing)}",
            "incompatible_model",
            "Retrain the model on a dataset built with the current pipeline.",
        )
    return features[..., [index[n] for n in wanted]]


# ------------------------------------------------------------------------------------------------
# serialisation
# ------------------------------------------------------------------------------------------------
def _split_out(value: str | None) -> str | None:
    return value if value in ("train", "val", "test") else None


def prediction_out(p: Prediction, mv: ModelVersion | None, signal: Signal | None = None) -> dict[str, Any]:
    eph = dict(p.ephemeris or {})
    scoring = eph.pop("scoring", {}) or {}
    q = p.quality or {}
    return {
        "id": p.id,
        "created_at": p.created_at,
        "model_version_id": p.model_version_id,
        "model_name": mv.name if mv is not None else f"(deleted model #{p.model_version_id})",
        "model_type": mv.model_type if mv is not None else None,
        "is_fixture_model": bool(mv.is_fixture) if mv is not None else False,
        "probability": p.probability,
        "raw_probability": p.raw_probability,
        "predicted_label": p.predicted_label,
        "predicted_class": CLASS_NAMES.get(int(p.predicted_label), "unknown"),
        "threshold": scoring.get("threshold"),
        "threshold_mode": scoring.get("threshold_mode"),
        "uncertainty": p.uncertainty,
        "uncertainty_method": scoring.get("uncertainty_method"),
        "member_probabilities": list(p.member_probabilities or []),
        "seen_in_split": _split_out(p.seen_in_split),
        "inference_ms": p.inference_ms,
        "source_type": p.source_type,
        "kepid": p.kepid,
        "signal_id": p.signal_id,
        "signal_key": signal.signal_key if signal is not None else None,
        "input_name": p.input_name,
        "ephemeris": eph or None,
        "quality_grade": q.get("grade"),
        "quality_ok": q.get("ok"),
        "catalog_labels": p.catalog_labels or None,
        "batch_job_id": p.batch_job_id,
        "pipeline_version": scoring.get("pipeline_version"),
    }


def prediction_summaries(session: Session, preds: list[Prediction]) -> list[dict[str, Any]]:
    """Serialise predictions with their model versions / signals in two queries."""
    mids = {p.model_version_id for p in preds}
    sids = {p.signal_id for p in preds if p.signal_id is not None}
    models = (
        {m.id: m for m in session.scalars(select(ModelVersion).where(ModelVersion.id.in_(mids)))}
        if mids
        else {}
    )
    sigs = {s.id: s for s in session.scalars(select(Signal).where(Signal.id.in_(sids)))} if sids else {}
    return [prediction_out(p, models.get(p.model_version_id), sigs.get(p.signal_id)) for p in preds]


def catalog_labels(sig: Signal | None) -> dict[str, Any] | None:
    if sig is None:
        return None
    return {
        "signal_key": sig.signal_key,
        "kepler_name": sig.kepler_name,
        "kepoi_name": sig.kepoi_name,
        "av_training_set": sig.av_training_set,
        "koi_disposition": sig.koi_disposition,
        "category": sig.category,
        "label_conflict": bool(sig.label_conflict),
    }


def views_out(g: np.ndarray, loc: np.ndarray, gp: np.ndarray, lp: np.ndarray) -> dict[str, Any]:
    return {
        "global": to_list(g, VIEW_DIGITS),
        "local": to_list(loc, VIEW_DIGITS),
        "global_phase": to_list(gp, VIEW_DIGITS),
        "local_phase": to_list(lp, VIEW_DIGITS),
    }


# ------------------------------------------------------------------------------------------------
# preparing inputs
# ------------------------------------------------------------------------------------------------
@dataclass
class Prepared:
    global_view: np.ndarray
    local_view: np.ndarray
    global_phase: np.ndarray
    local_phase: np.ndarray
    features: np.ndarray
    feature_names: list[str]
    quality: dict[str, Any]
    ephemeris: dict[str, Any]
    source_type: str
    input_name: str
    kepid: int | None
    signal: Signal | None
    source: dict[str, Any]
    warnings: list[str] = field(default_factory=list)


def _ensure_downloaded(session: Session, kepid: int, download: bool) -> None:
    if has_lightcurve(kepid):
        return
    if not download:
        raise conflict(
            f"No light curve has been downloaded for KIC {kepid}",
            "not_downloaded",
            "Download the star first (POST /api/targets/{kepid}/download) or set download_if_missing=true.".replace(
                "{kepid}", str(kepid)
            ),
        )
    from exofinder.data.acquire import LightCurveUnavailableError, ensure_lightcurve

    if session.get(Target, kepid) is None:
        raise not_found(f"KIC {kepid}", "target_not_found", "The star is not in the local catalogue.")
    try:
        ensure_lightcurve(session, kepid)
    except LightCurveUnavailableError as exc:
        raise conflict(
            f"Could not obtain a light curve for KIC {kepid}: {exc}",
            "lightcurve_unavailable",
            "MAST has no Kepler long-cadence data for this star."
            if exc.status == "no_data"
            else "Check the internet connection and retry.",
        ) from exc


def _process(src: SourceData, eph: Ephemeris, others: list[Ephemeris], depth: float | None) -> tuple:
    try:
        processed = process_lightcurve(
            src.lc,
            eph,
            PipelineConfig(keep_stages=False),
            catalogue_depth_ppm=depth,
            other_ephemerides=others,
        )
    except InsufficientDataError as exc:
        raise bad_request(str(exc), "insufficient_data") from exc
    except ValueError as exc:
        raise bad_request(str(exc), "invalid_ephemeris") from exc
    names = list(FEATURE_NAMES)
    feats = np.array([processed.features[n] for n in names], dtype=np.float32)
    v = processed.views
    return (
        np.asarray(v.global_view, np.float32),
        np.asarray(v.local_view, np.float32),
        np.asarray(v.global_phase, np.float64),
        np.asarray(v.local_phase, np.float64),
        feats,
        names,
        processed.quality.to_dict(),
    )


def prepare(session: Session, req: dict[str, Any]) -> Prepared:
    """Views, features, quality and ephemeris for one prediction request (see module docstring)."""
    from exofinder.astro.bls import bls_ephemeris
    from exofinder.services.analysis import bls_result, other_known_ephemerides

    source = req["source"]
    eph_source = req.get("ephemeris_source") or "catalog"
    manual = req.get("ephemeris")
    warnings: list[str] = []
    signal: Signal | None = None
    if source.get("type") == "catalog":
        kepid = int(source["kepid"])
        if source.get("signal_id") is not None:
            signal = session.get(Signal, int(source["signal_id"]))
            if signal is None:
                raise not_found(f"Signal {source['signal_id']}", "signal_not_found")
            if signal.kepid != kepid:
                raise bad_request(
                    f"Signal {signal.signal_key} belongs to KIC {signal.kepid}, not KIC {kepid}.",
                    "signal_mismatch",
                )
        if eph_source == "catalog" and signal is None:
            raise bad_request(
                "A catalogue ephemeris needs a signal (source.signal_id).",
                "signal_required",
                "Choose one of the star's signals, or use ephemeris_source 'bls' or 'manual'.",
            )
        if eph_source == "manual" and not manual:
            raise bad_request("ephemeris_source 'manual' needs an ephemeris.", "invalid_ephemeris")
        _ensure_downloaded(session, kepid, bool(req.get("download_if_missing", True)))
        if eph_source == "catalog" and signal is not None:
            try:
                sv = compute_signal_views(session, signal)
            except SignalNotDownloadedError as exc:
                raise conflict(str(exc), "not_downloaded") from exc
            except SignalEphemerisError as exc:
                raise bad_request(
                    str(exc), "no_ephemeris", "Use ephemeris_source 'bls' or 'manual'."
                ) from exc
            except InsufficientDataError as exc:
                raise bad_request(str(exc), "insufficient_data") from exc
            name = signal.kepler_name or signal.kepoi_name or signal.signal_key
            src = load_catalog_source(session, kepid, missing_status=409)
            warnings += src.warnings
            return Prepared(
                global_view=sv.global_view,
                local_view=sv.local_view,
                global_phase=sv.global_phase,
                local_phase=sv.local_phase,
                features=sv.features,
                feature_names=list(sv.feature_names),
                quality=dict(sv.quality),
                ephemeris={**sv.ephemeris, "time_system": "BKJD"},
                source_type="catalog",
                input_name=f"{name} (KIC {kepid})",
                kepid=kepid,
                signal=signal,
                source=src.describe(),
                warnings=warnings,
            )
    src = load_source(session, source, missing_status=409)
    warnings += src.warnings
    if eph_source == "catalog":
        raise bad_request(
            "Uploads have no catalogue ephemeris.",
            "invalid_ephemeris",
            "Use ephemeris_source 'bls' (search the light curve) or 'manual' (enter period, epoch, duration).",
        )
    if eph_source == "manual":
        if not manual:
            raise bad_request("ephemeris_source 'manual' needs an ephemeris.", "invalid_ephemeris")
        eph = make_ephemeris(manual.get("period_days"), manual.get("epoch"), manual.get("duration_hours"))
    elif eph_source == "bls":
        res, _, _ = bls_result(src)
        eph = bls_ephemeris(res)
        warnings.append(
            f"Ephemeris from a BLS search (P = {eph.period_days:.5f} d, measured): check it is not an alias "
            "(P/2, 2P) or another planet of the same star."
        )
        if signal is not None and signal.period_days and abs(eph.period_days / signal.period_days - 1) > 0.01:
            warnings.append(
                f"BLS found P = {eph.period_days:.4f} d, which is not the catalogue period of {signal.signal_key} "
                f"({signal.period_days:.4f} d): the score refers to the BLS signal."
            )
    else:
        raise bad_request(f"Unknown ephemeris_source '{eph_source}'", "invalid_ephemeris")
    others = other_known_ephemerides(session, src.kepid, eph) if src.kind == "catalog" else []
    g, loc, gp, lp, feats, names, quality = _process(src, eph, others, None)
    return Prepared(
        global_view=g,
        local_view=loc,
        global_phase=gp,
        local_phase=lp,
        features=feats,
        feature_names=names,
        quality=quality,
        ephemeris=ephemeris_dict(eph, src.time_system),
        source_type=src.prediction_source_type,
        input_name=src.input_name,
        kepid=src.kepid,
        signal=signal,
        source=src.describe(),
        warnings=warnings,
    )


def _save_inputs(prep: Prepared) -> str:
    d = get_settings().data_path / "predictions"
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{uuid.uuid4().hex}.npz"
    np.savez_compressed(
        path,
        global_view=prep.global_view,
        local_view=prep.local_view,
        global_phase=prep.global_phase,
        local_phase=prep.local_phase,
        features=prep.features,
        meta=np.array(
            json.dumps(
                to_jsonable(
                    {
                        "feature_names": prep.feature_names,
                        "quality": prep.quality,
                        "ephemeris": prep.ephemeris,
                        "pipeline_version": PIPELINE_VERSION,
                    }
                )
            )
        ),
    )
    return str(path)


# ------------------------------------------------------------------------------------------------
# predict
# ------------------------------------------------------------------------------------------------
def _finite_inputs(*arrays: np.ndarray) -> bool:
    return all(bool(np.isfinite(a).all()) for a in arrays)


def _split_warning(split: str | None, mv: ModelVersion, label: str) -> str | None:
    if split == "train":
        return (
            f"{label} was in the TRAINING set of model '{mv.name}': its score is not an unbiased test "
            "(the model has seen this star)."
        )
    if split == "val":
        return (
            f"{label} was in the VALIDATION set of model '{mv.name}' (used for early stopping, the threshold "
            "and calibration): its score is not a fully independent test."
        )
    return None


def predict(session: Session, req: dict[str, Any]) -> dict[str, Any]:
    """``POST /api/predictions``: score one signal with one or more models and store the results."""
    models = resolve_models(session, req.get("model_version_ids"))
    predictors = [(mv, get_predictor(mv)) for mv in models]
    prep = prepare(session, req)
    if not _finite_inputs(prep.global_view, prep.local_view, prep.features):
        msgs = "; ".join(prep.quality.get("messages") or prep.quality.get("issues") or [])
        raise bad_request(
            "This signal cannot be scored: its views contain empty bins (no data around the transit)"
            + (f" ({msgs})" if msgs else "")
            + ".",
            "unscorable_signal",
            "Check the ephemeris and that the light curve covers at least two transits.",
        )
    warnings = list(prep.warnings)
    grade = prep.quality.get("grade")
    if grade in ("C", "D"):
        msgs = "; ".join(prep.quality.get("messages") or prep.quality.get("issues") or [])
        warnings.append(f"Data-quality grade {grade}: {msgs}. Treat the score with caution.")
    labels = catalog_labels(prep.signal)
    if labels and labels["label_conflict"]:
        warnings.append("NASA labels disagree for this signal (DR24 Autovetter vs KOI disposition).")
    artifacts = _save_inputs(prep)
    results = []
    for mv, predictor in predictors:
        feats = _feature_matrix(prep.features[None, :], prep.feature_names, predictor, mv)
        out = predictor.predict(
            prep.global_view[None, :], prep.local_view[None, :], feats, pipeline_version=PIPELINE_VERSION
        )
        thr, mode = threshold_for(session, predictor)
        prob = float(out.prob[0])
        split = seen_in_split(session, mv, prep.kepid)
        w = _split_warning(split, mv, prep.input_name)
        if w:
            warnings.append(w)
        if mv.is_fixture:
            warnings.append(
                f"Model '{mv.name}' is a TEST FIXTURE trained on synthetic data: its score has no scientific meaning."
            )
        row = Prediction(
            model_version_id=mv.id,
            source_type=prep.source_type,
            kepid=prep.kepid,
            signal_id=prep.signal.id if prep.signal is not None else None,
            input_name=prep.input_name[:256],
            ephemeris={
                **prep.ephemeris,
                "scoring": {
                    "threshold": thr,
                    "threshold_mode": mode,
                    "uncertainty_method": out.uncertainty_method,
                    "pipeline_version": PIPELINE_VERSION,
                },
            },
            probability=prob,
            raw_probability=float(out.raw_prob[0]),
            predicted_label=int(prob >= thr),
            uncertainty=finite(out.uncertainty[0]) if out.uncertainty is not None else None,
            member_probabilities=[float(x) for x in out.member_probs[0]]
            if out.member_probs is not None
            else [],
            quality=to_jsonable(prep.quality),
            seen_in_split=split or "none",
            catalog_labels=labels or {},
            inference_ms=float(out.inference_ms),
            artifacts_path=artifacts,
        )
        session.add(row)
        session.flush()
        results.append(prediction_out(row, mv, prep.signal))
    session.commit()
    return to_jsonable(
        {
            "results": results,
            "views": views_out(prep.global_view, prep.local_view, prep.global_phase, prep.local_phase),
            "quality": prep.quality,
            "ephemeris": prep.ephemeris,
            "features": {
                n: finite(v) for n, v in zip(prep.feature_names, prep.features.tolist(), strict=True)
            },
            "catalog_labels": labels,
            "signal": signal_dict(prep.signal, session.get(Target, prep.signal.kepid))
            if prep.signal
            else None,
            "source": prep.source,
            "warnings": list(dict.fromkeys(warnings)),
            "disclaimer": RESEARCH_LEAD_NOTICE,
            "pipeline_version": PIPELINE_VERSION,
        }
    )


# ------------------------------------------------------------------------------------------------
# history
# ------------------------------------------------------------------------------------------------
def list_predictions(
    session: Session,
    *,
    kepid: int | None = None,
    model_version_id: int | None = None,
    source_type: str | None = None,
    signal_id: int | None = None,
    batch_job_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    conds = []
    if kepid is not None:
        conds.append(Prediction.kepid == int(kepid))
    if model_version_id is not None:
        conds.append(Prediction.model_version_id == int(model_version_id))
    if source_type:
        conds.append(Prediction.source_type == source_type)
    if signal_id is not None:
        conds.append(Prediction.signal_id == int(signal_id))
    if batch_job_id:
        conds.append(Prediction.batch_job_id == batch_job_id)
    limit = max(1, min(int(limit), 500))
    q = (
        select(Prediction)
        .where(*conds)
        .order_by(Prediction.id.desc())
        .limit(limit)
        .offset(max(0, int(offset)))
    )
    total = int(session.scalar(select(func.count()).select_from(Prediction).where(*conds)) or 0)
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": prediction_summaries(session, list(session.scalars(q))),
    }


def get_prediction(session: Session, prediction_id: int) -> dict[str, Any]:
    p = session.get(Prediction, int(prediction_id))
    if p is None:
        raise not_found(f"Prediction {prediction_id}", "prediction_not_found")
    mv = session.get(ModelVersion, p.model_version_id)
    sig = session.get(Signal, p.signal_id) if p.signal_id is not None else None
    out = prediction_out(p, mv, sig)
    views = None
    features = None
    views_source = None
    if p.artifacts_path and os.path.isfile(p.artifacts_path):
        with np.load(p.artifacts_path, allow_pickle=False) as z:
            views = views_out(z["global_view"], z["local_view"], z["global_phase"], z["local_phase"])
            meta = json.loads(str(z["meta"]))
            features = {
                n: finite(v)
                for n, v in zip(meta.get("feature_names", []), z["features"].tolist(), strict=False)
            }
            views_source = "stored inputs of this prediction"
    elif sig is not None and (p.ephemeris or {}).get("source") == "catalogue":
        try:
            sv = compute_signal_views(session, sig)
            views = views_out(sv.global_view, sv.local_view, sv.global_phase, sv.local_phase)
            features = {n: finite(v) for n, v in zip(sv.feature_names, sv.features.tolist(), strict=True)}
            views_source = "view cache (catalogue ephemeris)"
        except (SignalNotDownloadedError, SignalEphemerisError, InsufficientDataError, ValueError):
            views = None
    warnings = []
    split = out["seen_in_split"]
    if mv is not None:
        w = _split_warning(split, mv, p.input_name)
        if w:
            warnings.append(w)
        if mv.is_fixture:
            warnings.append(f"Model '{mv.name}' is a TEST FIXTURE trained on synthetic data.")
    if out["quality_grade"] in ("C", "D"):
        warnings.append(f"Data-quality grade {out['quality_grade']}.")
    return to_jsonable(
        {
            **out,
            "views": views,
            "views_source": views_source,
            "features": features,
            "quality": p.quality or {},
            "signal": None if sig is None else signal_dict(sig, session.get(Target, sig.kepid)),
            "warnings": warnings,
            "disclaimer": RESEARCH_LEAD_NOTICE,
        }
    )


# ------------------------------------------------------------------------------------------------
# batch
# ------------------------------------------------------------------------------------------------
def _batch_signal_ids(
    session: Session, categories: list[str] | None, only_downloaded: bool, limit: int | None
) -> list[int]:
    q = select(Signal.id).where(Signal.category != "retired")
    if categories:
        q = q.where(Signal.category.in_(categories))
    if only_downloaded:
        q = q.join(Target, Target.kepid == Signal.kepid).where(Target.lc_status == "available")
    q = q.order_by(Signal.id)
    if limit:
        q = q.limit(int(limit))
    return [int(i) for i in session.scalars(q)]


def start_batch(
    session: Session,
    model_version_id: int | None,
    category: str = "candidate",
    only_downloaded: bool = True,
    limit: int | None = None,
    skip_existing: bool = False,
) -> str:
    """Submit a ``batch_predict`` job scoring catalogue signals at their catalogue ephemerides."""
    mv = resolve_models(session, [model_version_id] if model_version_id else None)[0]
    get_predictor(mv)  # fail fast (409) if the model cannot be loaded
    cats = None if category in (None, "", "all") else [c.strip() for c in category.split(",") if c.strip()]
    n_now = len(_batch_signal_ids(session, cats, only_downloaded, limit))
    if n_now == 0:
        raise conflict(
            "No catalogue signal matches this batch",
            "nothing_to_score",
            "Download light curves for the stars first, or set only_downloaded=false.",
        )
    mv_id, mv_name = mv.id, mv.name
    params = {
        "model_version_id": mv_id,
        "category": category,
        "only_downloaded": only_downloaded,
        "limit": limit,
        "skip_existing": skip_existing,
    }

    def work(ctx: JobContext) -> dict[str, Any]:
        from exofinder.db.session import session_scope

        with session_scope() as s:
            return _run_batch(ctx, s, mv_id, cats, only_downloaded, limit, skip_existing)

    return get_runner().submit(
        "batch_predict", f"Batch predictions: {mv_name} on {category} signals", work, params
    )


def _run_batch(
    ctx: JobContext,
    s: Session,
    mv_id: int,
    cats: list[str] | None,
    only_downloaded: bool,
    limit: int | None,
    skip_existing: bool,
) -> dict[str, Any]:
    mv = s.get(ModelVersion, mv_id)
    if mv is None:
        raise RuntimeError(f"Model version {mv_id} no longer exists")
    predictor = get_predictor(mv)
    thr, mode = threshold_for(s, predictor)
    ids = _batch_signal_ids(s, cats, only_downloaded, limit)
    if skip_existing:
        done = set(s.scalars(select(Prediction.signal_id).where(Prediction.model_version_id == mv_id)))
        ids = [i for i in ids if i not in done]
    offset = 0.0
    if not only_downloaded:
        from exofinder.data.acquire import download_many

        kepids = sorted({int(k) for k in s.scalars(select(Signal.kepid).where(Signal.id.in_(ids)))})
        missing = [k for k in kepids if not has_lightcurve(k)]
        if missing:
            ctx.log(f"Downloading {len(missing)} missing light curves")
            download_many(
                missing,
                progress=lambda d, t, m: ctx.progress(0.3 * d / max(t, 1), f"Download {d}/{t}: {m}"),
                cancel=ctx.cancel_event,
                session=s,
            )
            offset = 0.3
    n = len(ids)
    ctx.log(f"Scoring {n} signals with model '{mv.name}' (#{mv.id}), threshold {thr:.3f} ({mode})")
    failures: dict[str, int] = defaultdict(int)
    n_scored = n_pos = 0
    splits: dict[str, int] = defaultdict(int)
    chunk = 64
    split_cache: dict[int, str | None] = {}
    for start in range(0, n, chunk):
        ctx.check_cancelled()
        batch_ids = ids[start : start + chunk]
        sigs = {x.id: x for x in s.scalars(select(Signal).where(Signal.id.in_(batch_ids)))}
        good = []
        for sid in batch_ids:
            sig = sigs.get(sid)
            if sig is None:
                failures["signal_missing"] += 1
                continue
            try:
                sv = compute_signal_views(s, sig)
                if _finite_inputs(sv.global_view, sv.local_view, sv.features):
                    good.append((sig, sv))
                else:
                    failures["nan_in_views"] += 1
            except SignalNotDownloadedError:
                failures["not_downloaded"] += 1
            except SignalEphemerisError:
                failures["no_ephemeris"] += 1
            except InsufficientDataError:
                failures["insufficient_data"] += 1
            except ValueError as exc:
                failures["processing_error"] += 1
                ctx.log(f"{sig.signal_key}: {exc}")
        if good:
            G = np.stack([sv.global_view for _, sv in good])
            L = np.stack([sv.local_view for _, sv in good])
            F = _feature_matrix(
                np.stack([sv.features for _, sv in good]), list(good[0][1].feature_names), predictor, mv
            )
            out = predictor.predict(G, L, F, pipeline_version=PIPELINE_VERSION)
            per_ms = float(out.inference_ms) / len(good)
            for i, (sig, sv) in enumerate(good):
                if sig.kepid not in split_cache:
                    split_cache[sig.kepid] = seen_in_split(s, mv, sig.kepid)
                split = split_cache[sig.kepid]
                splits[split or "none"] += 1
                prob = float(out.prob[i])
                label = int(prob >= thr)
                n_pos += label
                s.add(
                    Prediction(
                        model_version_id=mv.id,
                        source_type="catalog",
                        kepid=sig.kepid,
                        signal_id=sig.id,
                        input_name=(sig.kepler_name or sig.kepoi_name or sig.signal_key)[:256],
                        ephemeris={
                            **sv.ephemeris,
                            "time_system": "BKJD",
                            "scoring": {
                                "threshold": thr,
                                "threshold_mode": mode,
                                "uncertainty_method": out.uncertainty_method,
                                "pipeline_version": PIPELINE_VERSION,
                            },
                        },
                        probability=prob,
                        raw_probability=float(out.raw_prob[i]),
                        predicted_label=label,
                        uncertainty=finite(out.uncertainty[i]) if out.uncertainty is not None else None,
                        member_probabilities=[float(x) for x in out.member_probs[i]]
                        if out.member_probs is not None
                        else [],
                        quality=to_jsonable(sv.quality),
                        seen_in_split=split or "none",
                        catalog_labels=catalog_labels(sig) or {},
                        inference_ms=per_ms,
                        batch_job_id=ctx.job_id,
                    )
                )
                n_scored += 1
        s.commit()
        done = min(start + chunk, n)
        ctx.progress(offset + (1.0 - offset) * done / max(n, 1), f"Scored {n_scored}/{n} signals")
    return {
        "model_version_id": mv_id,
        "model_name": mv.name,
        "is_fixture_model": bool(mv.is_fixture),
        "threshold": thr,
        "threshold_mode": mode,
        "n_signals": n,
        "n_scored": n_scored,
        "n_failed": int(sum(failures.values())),
        "failures_by_reason": dict(failures),
        "n_planet_like": n_pos,
        "seen_in_split": dict(splits),
        "note": RESEARCH_LEAD_NOTICE,
    }


# ------------------------------------------------------------------------------------------------
# candidates
# ------------------------------------------------------------------------------------------------
def candidates(
    session: Session,
    *,
    category: str = "candidate",
    model_version_id: int | None = None,
    min_probability: float | None = None,
    sort: str = "mean_probability",
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Latest catalogue-ephemeris score per signal per model, aggregated per signal and ranked."""
    if sort not in ("mean_probability", "max_probability", "agreement", "uncertainty"):
        raise bad_request(f"Cannot sort by '{sort}'", "invalid_sort")
    latest = (
        select(func.max(Prediction.id))
        .where(
            Prediction.signal_id.is_not(None),
            func.json_extract(Prediction.ephemeris, "$.source") == "catalogue",
        )
        .group_by(Prediction.signal_id, Prediction.model_version_id)
    )
    if model_version_id is not None:
        latest = latest.where(Prediction.model_version_id == int(model_version_id))
    q = (
        select(Prediction, Signal)
        .join(Signal, Signal.id == Prediction.signal_id)
        .where(Prediction.id.in_(latest))
    )
    cats = None if category in (None, "", "all") else [c.strip() for c in category.split(",") if c.strip()]
    if cats:
        q = q.where(Signal.category.in_(cats))
    rows = session.execute(q).all()
    mids = {p.model_version_id for p, _ in rows}
    models = (
        {m.id: m for m in session.scalars(select(ModelVersion).where(ModelVersion.id.in_(mids)))}
        if mids
        else {}
    )
    by_signal: dict[int, list[Prediction]] = defaultdict(list)
    sigs: dict[int, Signal] = {}
    for p, sig in rows:
        by_signal[sig.id].append(p)
        sigs[sig.id] = sig
    hosts = (
        dict(
            session.execute(
                select(Target.kepid, Target.kepler_host_name).where(
                    Target.kepid.in_({s.kepid for s in sigs.values()})
                )
            ).all()
        )
        if sigs
        else {}
    )
    items = []
    for sid, preds in by_signal.items():
        sig = sigs[sid]
        preds.sort(key=lambda p: p.model_version_id)
        probs = np.array([p.probability for p in preds], dtype=np.float64)
        labels = [int(p.predicted_label) for p in preds]
        uncs = [p.uncertainty for p in preds if p.uncertainty is not None]
        mean_p = float(probs.mean())
        if min_probability is not None and mean_p < float(min_probability):
            continue
        n_pl = sum(labels)
        latest_pred = max(preds, key=lambda p: p.id)
        q_latest = latest_pred.quality or {}
        scores = []
        for p in preds:
            mv = models.get(p.model_version_id)
            scores.append(
                {
                    "prediction_id": p.id,
                    "model_version_id": p.model_version_id,
                    "model_name": mv.name if mv else f"(deleted model #{p.model_version_id})",
                    "model_type": mv.model_type if mv else None,
                    "is_fixture_model": bool(mv.is_fixture) if mv else False,
                    "probability": p.probability,
                    "uncertainty": p.uncertainty,
                    "predicted_label": p.predicted_label,
                    "seen_in_split": _split_out(p.seen_in_split),
                    "created_at": p.created_at,
                }
            )
        items.append(
            {
                "signal_id": sid,
                "signal_key": sig.signal_key,
                "kepid": sig.kepid,
                "kepler_host_name": hosts.get(sig.kepid),
                "kepler_name": sig.kepler_name,
                "kepoi_name": sig.kepoi_name,
                "category": sig.category,
                "koi_disposition": sig.koi_disposition,
                "av_training_set": sig.av_training_set,
                "label_conflict": bool(sig.label_conflict),
                "period_days": sig.period_days,
                "depth_ppm": sig.depth_ppm,
                "duration_hours": sig.duration_hours,
                "planet_radius_re": sig.planet_radius_re,
                "scores": scores,
                "mean_probability": mean_p,
                "max_probability": float(probs.max()),
                "min_probability": float(probs.min()),
                "agreement": {
                    "n_models": len(preds),
                    "n_planet_like": n_pl,
                    "fraction_planet_like": n_pl / len(preds),
                    "consensus": "planet-like"
                    if n_pl == len(preds)
                    else ("false-positive-like" if n_pl == 0 else "split"),
                },
                "uncertainty": float(np.mean(uncs)) if uncs else None,
                "quality_grade": q_latest.get("grade"),
                "quality_ok": q_latest.get("ok"),
                "seen_in_training": any(s["seen_in_split"] in ("train", "val") for s in scores),
                "has_fixture_model_scores": any(s["is_fixture_model"] for s in scores),
            }
        )
    keyf = {
        "mean_probability": lambda d: (-d["mean_probability"], d["signal_key"]),
        "max_probability": lambda d: (-d["max_probability"], d["signal_key"]),
        "agreement": lambda d: (
            -d["agreement"]["fraction_planet_like"],
            -d["mean_probability"],
            d["signal_key"],
        ),
        "uncertainty": lambda d: (d["uncertainty"] if d["uncertainty"] is not None else 1e9, d["signal_key"]),
    }[sort]
    items.sort(key=keyf)
    total = len(items)
    limit = max(1, min(int(limit), 500))
    page = items[max(0, int(offset)) : max(0, int(offset)) + limit]
    for i, it in enumerate(page, start=max(0, int(offset)) + 1):
        it["rank"] = i
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": page,
        "models": [
            {"id": m.id, "name": m.name, "model_type": m.model_type, "is_fixture": bool(m.is_fixture)}
            for m in sorted(models.values(), key=lambda m: m.id)
        ],
        "disclaimer": (
            "These rankings are research leads for follow-up, not discoveries. A high planet-like score means "
            "the light-curve shape resembles vetted planet candidates; it does not rule out blends or eclipsing "
            "binaries and is not a statistical validation."
        ),
    }
