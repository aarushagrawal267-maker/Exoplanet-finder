"""Downloadable research reports for one experiment or a comparison of experiments.

Reports are assembled **only from stored data** (database rows, dataset manifests, checkpoint
metadata). When a section has no data yet (e.g. no test evaluation), the report says so explicitly;
it never fills a gap with an estimate. Formats: ``json`` (the structured data), ``md`` and ``html``
(self-contained: inline CSS, no scripts, no external requests). Both text formats are rendered from
one block list, so they always contain the same information.
"""

from __future__ import annotations

import html
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from exofinder import __version__
from exofinder.config import PIPELINE_VERSION
from exofinder.data.labels import LABEL_MODES
from exofinder.db.models import Dataset, Evaluation, ModelVersion
from exofinder.services.experiments import epochs_of, get_experiment
from exofinder.services.jsonutil import to_jsonable
from exofinder.services.ops_common import PLANET_LEAD_SENTENCE
from exofinder.services.ops_errors import bad_request

FORMATS = {
    "md": "text/markdown; charset=utf-8",
    "html": "text/html; charset=utf-8",
    "json": "application/json",
}
METRIC_ROWS = (
    ("pr_auc", "PR-AUC (average precision)"),
    ("roc_auc", "ROC-AUC"),
    ("f1", "F1"),
    ("precision", "Precision"),
    ("recall", "Recall / sensitivity"),
    ("specificity", "Specificity"),
    ("accuracy", "Accuracy"),
    ("brier", "Brier score (lower is better)"),
    ("ece", "Expected calibration error (lower is better)"),
)
NO_DATA = "Not available"

LIMITATIONS = (
    "These results describe how well a model separates Kepler transit-like signals labelled planet-like "
    "from those labelled false-positive-like by published NASA vetting, on star-separated held-out data "
    "processed by this application's pipeline. Labels are expert/automated judgements and contain noise; "
    "class 0 mixes astrophysical false positives and non-transiting phenomena. Photometry alone cannot rule "
    "out background eclipsing binaries or contamination (no pixel or centroid data are used). Models are "
    "trained on Kepler long-cadence data only; other missions or cadences are out of distribution. Small "
    "datasets give wide confidence intervals, so differences between models inside overlapping intervals "
    "are not evidence of a real difference."
)


# --------------------------------------------------------------------------------------------------
# Data assembly
# --------------------------------------------------------------------------------------------------
def _num(x: Any) -> float | None:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) else None


def _manifest_meta(ds: Dataset | None) -> dict[str, Any]:
    if ds is None or not ds.path:
        return {}
    path = Path(ds.path) / "manifest.json"
    try:
        return dict(json.loads(path.read_text("utf-8")).get("meta") or {})
    except (OSError, ValueError):
        return {}


def _eval_block(ev: Evaluation | None, n_total: int = 0) -> dict[str, Any]:
    if ev is None:
        return {"available": False}
    metrics = {k: v for k, v in (ev.metrics or {}).items() if not isinstance(v, dict)}
    ci = {k: v for k, v in (ev.ci or {}).items() if k != "method"}
    return {
        "available": True,
        "evaluation_id": ev.id,
        "created_at": ev.created_at.isoformat() if ev.created_at else None,
        "threshold": ev.threshold,
        "metrics": metrics,
        "metrics_at_0_5": (ev.metrics or {}).get("at_0_5"),
        "ci": ci,
        "ci_method": (ev.ci or {}).get("method"),
        "confusion": ev.confusion or {},
        "calibration": (ev.curves or {}).get("calibration") or [],
        "timing": ev.timing or {},
        "n_evaluations_of_this_split": n_total,
    }


def _curve_summary(epochs: list[dict[str, Any]], best_epoch: int | None) -> dict[str, Any]:
    if not epochs:
        return {"available": False}
    best = next((e for e in epochs if e.get("epoch") == best_epoch), None)
    return {
        "available": True,
        "n_epochs_logged": len(epochs),
        "first": epochs[0],
        "best": best,
        "last": epochs[-1],
    }


def experiment_report_data(session: Session, experiment_id: int) -> dict[str, Any]:
    """Structured content of an experiment report (all values from stored data)."""
    from exofinder.ml.model_cards import get_model_card

    exp = get_experiment(session, experiment_id)
    ds = session.get(Dataset, exp.dataset_id)
    mv = session.scalar(
        select(ModelVersion).where(ModelVersion.experiment_id == exp.id).order_by(ModelVersion.id.desc())
    )
    evals: list[Evaluation] = (
        list(
            session.scalars(
                select(Evaluation).where(Evaluation.model_version_id == mv.id).order_by(Evaluation.id)
            )
        )
        if mv
        else []
    )
    val_evals = [e for e in evals if e.split == "val"]
    test_evals = [e for e in evals if e.split == "test"]
    meta = _manifest_meta(ds)
    stats = (ds.stats or {}) if ds else {}
    cfg_ds = (ds.config or {}) if ds else {}
    epochs = epochs_of(session, exp.id)
    is_fixture = bool(mv.is_fixture) if mv else bool(cfg_ds.get("synthetic"))
    missing: list[str] = []
    if mv is None:
        missing.append("No trained model: the experiment did not finish successfully.")
    if not test_evals:
        missing.append("No test-set evaluation has been run for this model yet.")
    if not epochs:
        missing.append("No per-epoch training metrics were recorded.")
    data = {
        "report_type": "experiment",
        "title": f"Experiment report: {exp.name}",
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "app_version": __version__,
        "pipeline_version": PIPELINE_VERSION,
        "disclaimer": PLANET_LEAD_SENTENCE,
        "is_fixture": is_fixture,
        "experiment": {
            "id": exp.id,
            "name": exp.name,
            "model_type": exp.model_type,
            "status": exp.status,
            "error": exp.error,
            "seed": exp.seed,
            "device": exp.device,
            "created_at": exp.created_at.isoformat() if exp.created_at else None,
            "finished_at": exp.finished_at.isoformat() if exp.finished_at else None,
            "notes": exp.notes or "",
            "tags": list(exp.tags or []),
        },
        "model_card": _card(get_model_card, exp.model_type),
        "data_provenance": {
            "label_mode": ds.label_mode if ds else None,
            "label_mode_description": LABEL_MODES[ds.label_mode].description
            if ds and ds.label_mode in LABEL_MODES
            else None,
            "exclude_label_conflicts": cfg_ds.get("exclude_conflicts"),
            "catalogue_snapshots": meta.get("catalogue_snapshots") or [],
            "lightcurves": meta.get("lightcurves") or {},
            "synthetic_data": bool(cfg_ds.get("synthetic")),
        },
        "dataset": {
            "available": ds is not None,
            "id": ds.id if ds else None,
            "name": ds.name if ds else None,
            "tier": ds.tier if ds else None,
            "status": ds.status if ds else None,
            "pipeline_version": ds.pipeline_version if ds else None,
            "split_seed": ds.split_seed if ds else None,
            "content_hash": ds.content_hash if ds else None,
            "n_examples": ds.n_examples if ds else None,
            "per_split": stats.get("per_split") or {},
            "exclusions_by_reason": stats.get("exclusions_by_reason") or {},
            "quality_grades": stats.get("quality_grades") or {},
            "reserved": stats.get("reserved") or [],
            "pipeline_config": cfg_ds.get("pipeline") or meta.get("pipeline_config") or {},
        },
        "config": exp.config or {},
        "training": {
            "epochs_run": exp.epochs_run,
            "best_epoch": exp.best_epoch,
            "duration_s": exp.duration_s,
            "n_params": mv.n_params if mv else None,
            "curve": _curve_summary(epochs, exp.best_epoch),
        },
        "model_version": (
            {
                "id": mv.id,
                "threshold": mv.threshold,
                "threshold_rule": "F1-optimal on the validation split",
                "temperature": mv.temperature,
                "ensemble_size": mv.ensemble_size,
                "is_active": bool(mv.is_active),
                "is_fixture": bool(mv.is_fixture),
            }
            if mv
            else {"available": False}
        ),
        "validation": {
            "from_training": {
                "available": bool(exp.val_metrics),
                "metrics": {k: v for k, v in (exp.val_metrics or {}).items() if not isinstance(v, dict)},
                "metrics_at_0_5": (exp.val_metrics or {}).get("at_0_5"),
            },
            "evaluation": _eval_block(val_evals[-1] if val_evals else None, len(val_evals)),
        },
        "test": _eval_block(test_evals[-1] if test_evals else None, len(test_evals)),
        "environment": exp.environment or {},
        "limitations": LIMITATIONS,
        "missing_sections": missing,
    }
    if len(test_evals) > 1:
        data["test"]["note"] = (
            f"The test split was evaluated {len(test_evals)} times for this model; the latest evaluation is "
            "reported. Repeated test evaluations weaken the claim that the test set is untouched."
        )
    return to_jsonable(data)


def _card(fn: Any, model_type: str) -> dict[str, Any]:
    try:
        card = fn(model_type, include_n_params=False)
    except ValueError:
        return {}
    return {k: card.get(k) for k in ("type", "name", "description", "inputs", "reference")}


def comparison_report_data(session: Session, experiment_ids: list[int]) -> dict[str, Any]:
    from exofinder.services.experiments import compare_experiments

    reports = [experiment_report_data(session, i) for i in experiment_ids]
    cmp = compare_experiments(session, experiment_ids)
    datasets = {r["dataset"]["id"] for r in reports}
    warnings = list(cmp.get("warnings") or [])
    if any(r["is_fixture"] for r in reports):
        warnings.append(
            "Some experiments are TEST FIXTURES trained on synthetic data: not scientific results."
        )
    if any(not r["test"]["available"] for r in reports):
        warnings.append("Some experiments have no test-set evaluation; their test columns are empty.")
    return to_jsonable(
        {
            "report_type": "comparison",
            "title": f"Comparison of {len(reports)} experiments",
            "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "app_version": __version__,
            "pipeline_version": PIPELINE_VERSION,
            "disclaimer": PLANET_LEAD_SENTENCE,
            "is_fixture": any(r["is_fixture"] for r in reports),
            "same_dataset": len(datasets) == 1,
            "experiments": reports,
            "config_diff": cmp.get("config_diff") or [],
            "warnings": warnings,
            "limitations": LIMITATIONS,
        }
    )


# --------------------------------------------------------------------------------------------------
# Block document
# --------------------------------------------------------------------------------------------------
Block = tuple


def _fmt(x: Any, digits: int = 3) -> str:
    if x is None:
        return NO_DATA
    if isinstance(x, bool):
        return "yes" if x else "no"
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        if not math.isfinite(x):
            return NO_DATA
        return f"{x:.{digits}f}" if abs(x) >= 10 ** (-digits) or x == 0 else f"{x:.2e}"
    if isinstance(x, (list, tuple)):
        return ", ".join(_fmt(v, digits) for v in x)
    if isinstance(x, dict):
        return json.dumps(x, sort_keys=True, default=str)
    return str(x)


def _ci(ci: Any) -> str:
    if isinstance(ci, list) and len(ci) == 2 and all(_num(v) is not None for v in ci):
        return f"[{ci[0]:.3f}, {ci[1]:.3f}]"
    return NO_DATA


def _metric_table(block: dict[str, Any]) -> Block:
    metrics, ci = block.get("metrics") or {}, block.get("ci") or {}
    rows = [[label, _fmt(metrics.get(key)), _ci(ci.get(key))] for key, label in METRIC_ROWS]
    return ("table", ["Metric", "Value", "95 % CI (bootstrap by star)"], rows)


def _eval_blocks(block: dict[str, Any], what: str) -> list[Block]:
    out: list[Block] = []
    if not block.get("available"):
        return [
            (
                "note",
                f"No {what} evaluation has been run for this model yet, so no {what} metrics are reported.",
            )
        ]
    out.append(
        (
            "p",
            f"Evaluation #{block['evaluation_id']} ({_fmt(block.get('created_at'))}), decision threshold "
            f"{_fmt(block.get('threshold'))}; n = {_fmt((block.get('metrics') or {}).get('n'))} "
            f"({_fmt((block.get('metrics') or {}).get('n_pos'))} planet-like, "
            f"{_fmt((block.get('metrics') or {}).get('n_neg'))} false-positive-like).",
        )
    )
    if block.get("note"):
        out.append(("note", block["note"]))
    out.append(_metric_table(block))
    cm = block.get("confusion") or {}
    if cm:
        out.append(
            (
                "table",
                ["", "Predicted planet-like", "Predicted false-positive-like"],
                [
                    ["Labelled planet-like", _fmt(cm.get("tp")), _fmt(cm.get("fn"))],
                    ["Labelled false-positive-like", _fmt(cm.get("fp")), _fmt(cm.get("tn"))],
                ],
            )
        )
    cal = block.get("calibration") or []
    rows = [
        [
            f"{_fmt(c.get('bin_lo'), 1)}-{_fmt(c.get('bin_hi'), 1)}",
            _fmt(c.get("mean_pred")),
            _fmt(c.get("frac_pos")),
            _fmt(c.get("count")),
        ]
        for c in cal
        if c.get("count")
    ]
    if rows:
        out.append(("h3", "Calibration (reliability)"))
        out.append(
            ("table", ["Probability bin", "Mean predicted", "Fraction labelled planet-like", "Count"], rows)
        )
    t = block.get("timing") or {}
    if t:
        out.append(
            (
                "p",
                f"Inference time on {_fmt(t.get('device'))}: {_fmt(t.get('ms_per_sample_batch1'))} ms/sample at batch 1, "
                f"{_fmt(t.get('ms_per_sample_batch64'))} ms/sample at batch 64.",
            )
        )
    return out


def experiment_blocks(d: dict[str, Any]) -> list[Block]:
    b: list[Block] = [("h1", d["title"]), ("note", d["disclaimer"])]
    if d.get("is_fixture"):
        b.append(
            (
                "warn",
                "TEST FIXTURE: this model was trained on synthetic test data. These numbers are not scientific results.",
            )
        )
    b.append(
        (
            "p",
            f"Generated {d['generated_at']} by Exoplanet Finder {d['app_version']} (pipeline {d['pipeline_version']}).",
        )
    )
    for m in d.get("missing_sections") or []:
        b.append(("note", m))
    e, mv = d["experiment"], d["model_version"]
    b += [
        ("h2", "1. Summary"),
        (
            "kv",
            [
                ("Experiment", f"#{e['id']} {e['name']}"),
                (
                    "Model type",
                    f"{(d.get('model_card') or {}).get('name') or e['model_type']} ({e['model_type']})",
                ),
                ("Status", e["status"] + (f" ({e['error']})" if e.get("error") else "")),
                ("Model version", f"#{mv['id']}" if mv.get("id") else NO_DATA),
                (
                    "Decision threshold",
                    f"{_fmt(mv.get('threshold'))} ({mv.get('threshold_rule')})" if mv.get("id") else NO_DATA,
                ),
                ("Temperature (calibration)", _fmt(mv.get("temperature"))),
                ("Seed", _fmt(e.get("seed"))),
                ("Notes", e.get("notes") or "-"),
            ],
        ),
    ]
    p, ds = d["data_provenance"], d["dataset"]
    b.append(("h2", "2. Data provenance"))
    b.append(
        (
            "kv",
            [
                ("Label mode", f"{p.get('label_mode')}: {p.get('label_mode_description') or ''}"),
                ("Label conflicts excluded", _fmt(p.get("exclude_label_conflicts"))),
            ],
        )
    )
    snaps = p.get("catalogue_snapshots") or []
    if snaps:
        b.append(
            (
                "table",
                ["Source", "Table", "Snapshot id", "Retrieved (UTC)", "Rows", "SHA-256"],
                [
                    [
                        s.get("source"),
                        s.get("table"),
                        _fmt(s.get("id")),
                        _fmt(s.get("retrieved_at")),
                        _fmt(s.get("rows")),
                        s.get("sha256"),
                    ]
                    for s in snaps
                ],
            )
        )
    else:
        b.append(("note", "No catalogue snapshot provenance is recorded for this dataset."))
    lc = p.get("lightcurves") or {}
    b.append(
        (
            "p",
            f"Light curves: {_fmt(lc.get('n_stars'))} stars from NASA MAST (Kepler long cadence); SHA-256 of the cache digests: {_fmt(lc.get('digests_sha256'))}.",
        )
    )
    if p.get("synthetic_data"):
        b.append(("warn", "The dataset was built from SYNTHETIC light curves (test data)."))
    b.append(("h2", "3. Dataset and splits"))
    if not ds.get("available"):
        b.append(("note", "The dataset of this experiment no longer exists."))
    else:
        b.append(
            (
                "kv",
                [
                    ("Dataset", f"#{ds['id']} {ds['name']} (tier {ds['tier']}, status {ds['status']})"),
                    ("Examples", _fmt(ds.get("n_examples"))),
                    ("Split seed", _fmt(ds.get("split_seed"))),
                    ("Content hash", _fmt(ds.get("content_hash"))),
                ],
            )
        )
        ps = ds.get("per_split") or {}
        if ps:
            b.append(
                (
                    "table",
                    ["Split", "Examples", "Planet-like", "False-positive-like", "Stars"],
                    [
                        [
                            k,
                            _fmt(v.get("n")),
                            _fmt(v.get("n_pos")),
                            _fmt(v.get("n_neg")),
                            _fmt(v.get("n_stars")),
                        ]
                        for k, v in ps.items()
                    ],
                )
            )
        ex = ds.get("exclusions_by_reason") or {}
        if ex:
            b.append(("h3", "Exclusions by reason"))
            b.append(("table", ["Reason", "Signals"], [[k, _fmt(v)] for k, v in ex.items()]))
        res = ds.get("reserved") or []
        if res:
            b.append(
                (
                    "p",
                    "Reserved showcase stars (forced into the test split): "
                    + ", ".join(f"{r.get('name')} (KIC {r.get('kepid')})" for r in res)
                    + ".",
                )
            )
        pc = ds.get("pipeline_config") or {}
        if pc:
            b.append(("h3", "Preprocessing configuration"))
            b.append(("kv", [(k, _fmt(v)) for k, v in sorted(pc.items())]))
    b.append(("h2", "4. Model configuration"))
    b.append(
        ("kv", [(k, _fmt(v)) for k, v in sorted((d.get("config") or {}).items())] or [("config", NO_DATA)])
    )
    tr = d["training"]
    b.append(("h2", "5. Training"))
    b.append(
        (
            "kv",
            [
                ("Epochs run", _fmt(tr.get("epochs_run"))),
                ("Best epoch", _fmt(tr.get("best_epoch"))),
                ("Training time (s)", _fmt(tr.get("duration_s"), 1)),
                ("Parameters", _fmt(tr.get("n_params"))),
            ],
        )
    )
    curve = tr.get("curve") or {}
    if curve.get("available"):
        rows = []
        for label in ("first", "best", "last"):
            r = curve.get(label)
            if r:
                rows.append(
                    [
                        label,
                        _fmt(r.get("epoch")),
                        _fmt(r.get("train_loss")),
                        _fmt(r.get("val_loss")),
                        _fmt(r.get("val_pr_auc")),
                        _fmt(r.get("val_roc_auc")),
                    ]
                )
        b.append(("table", ["Epoch", "#", "Train loss", "Val loss", "Val PR-AUC", "Val ROC-AUC"], rows))
    else:
        b.append(("note", "No training curve was recorded."))
    b.append(("h2", "6. Validation results"))
    ft = d["validation"]["from_training"]
    if ft.get("available"):
        b.append(
            (
                "p",
                "Validation metrics computed at the end of training (model selection, calibration and threshold were chosen on this split):",
            )
        )
        b.append(_metric_table({"metrics": ft.get("metrics"), "ci": {}}))
    else:
        b.append(("note", "No validation metrics were recorded during training."))
    ve = d["validation"]["evaluation"]
    if ve.get("available"):
        b.append(("h3", "Validation evaluation with bootstrap confidence intervals"))
        b += _eval_blocks(ve, "validation")
    b.append(("h2", "7. Test results (held-out stars)"))
    b += _eval_blocks(d["test"], "test-set")
    b.append(("h2", "8. Environment"))
    env = d.get("environment") or {}
    keys = (
        "exofinder",
        "pipeline_version",
        "git_commit",
        "python",
        "platform",
        "torch",
        "numpy",
        "scipy",
        "sklearn",
        "cpu_count",
        "cuda_available",
        "default_device",
    )
    b.append(("kv", [(k, _fmt(env.get(k))) for k in keys if k in env] or [("environment", NO_DATA)]))
    b.append(("h2", "9. Limitations"))
    b.append(("p", d["limitations"]))
    b.append(("p", d["disclaimer"]))
    return b


def comparison_blocks(d: dict[str, Any]) -> list[Block]:
    b: list[Block] = [("h1", d["title"]), ("note", d["disclaimer"])]
    if d.get("is_fixture"):
        b.append(("warn", "Contains TEST FIXTURE models trained on synthetic data: not scientific results."))
    b.append(
        (
            "p",
            f"Generated {d['generated_at']} by Exoplanet Finder {d['app_version']} (pipeline {d['pipeline_version']}).",
        )
    )
    for w in d.get("warnings") or []:
        b.append(("note", w))
    exps = d["experiments"]
    head = ["Metric"] + [f"#{r['experiment']['id']} {r['experiment']['model_type']}" for r in exps]
    b.append(("h2", "Overview"))
    b.append(
        (
            "table",
            [
                "Experiment",
                "Model type",
                "Dataset",
                "Status",
                "Threshold",
                "Epochs (best)",
                "Training time (s)",
            ],
            [
                [
                    f"#{r['experiment']['id']} {r['experiment']['name']}",
                    r["experiment"]["model_type"],
                    f"#{r['dataset']['id']} {r['dataset']['name']}"
                    if r["dataset"].get("available")
                    else NO_DATA,
                    r["experiment"]["status"],
                    _fmt(r["model_version"].get("threshold")),
                    f"{_fmt(r['training'].get('epochs_run'))} ({_fmt(r['training'].get('best_epoch'))})",
                    _fmt(r["training"].get("duration_s"), 1),
                ]
                for r in exps
            ],
        )
    )
    b.append(("h2", "Validation metrics (from training)"))
    b.append(
        (
            "table",
            head,
            [
                [label] + [_fmt((r["validation"]["from_training"].get("metrics") or {}).get(k)) for r in exps]
                for k, label in METRIC_ROWS
            ],
        )
    )
    b.append(("h2", "Test metrics (held-out stars) with 95 % CI"))
    if not any(r["test"].get("available") for r in exps):
        b.append(("note", "No test-set evaluation has been run for any of these models yet."))
    else:
        rows = []
        for k, label in METRIC_ROWS:
            row = [label]
            for r in exps:
                t = r["test"]
                row.append(
                    f"{_fmt((t.get('metrics') or {}).get(k))} {_ci((t.get('ci') or {}).get(k))}"
                    if t.get("available")
                    else NO_DATA
                )
            rows.append(row)
        b.append(("table", head, rows))
    diff = d.get("config_diff") or []
    b.append(("h2", "Configuration differences"))
    if diff:
        b.append(
            (
                "table",
                ["Option"] + head[1:],
                [
                    [x["key"]] + [_fmt(x["values"].get(str(r["experiment"]["id"]))) for r in exps]
                    for x in diff
                ],
            )
        )
    else:
        b.append(("p", "The configurations are identical."))
    b.append(("h2", "Limitations"))
    b.append(("p", d["limitations"]))
    b.append(("p", d["disclaimer"]))
    return b


# --------------------------------------------------------------------------------------------------
# Renderers
# --------------------------------------------------------------------------------------------------
def _md_cell(x: Any) -> str:
    return str(x if x is not None else NO_DATA).replace("|", "\\|").replace("\n", " ")


def to_markdown(blocks: list[Block]) -> str:
    out: list[str] = []
    for blk in blocks:
        kind = blk[0]
        if kind == "h1":
            out.append(f"# {blk[1]}")
        elif kind == "h2":
            out.append(f"## {blk[1]}")
        elif kind == "h3":
            out.append(f"### {blk[1]}")
        elif kind == "p":
            out.append(blk[1])
        elif kind == "note":
            out.append(f"> {blk[1]}")
        elif kind == "warn":
            out.append(f"> **Warning:** {blk[1]}")
        elif kind == "kv":
            out.append("\n".join(f"- **{_md_cell(k)}:** {_md_cell(v)}" for k, v in blk[1]))
        elif kind == "table":
            headers, rows = blk[1], blk[2]
            lines = ["| " + " | ".join(_md_cell(h) for h in headers) + " |", "|" + "---|" * len(headers)]
            lines += ["| " + " | ".join(_md_cell(c) for c in row) + " |" for row in rows]
            out.append("\n".join(lines))
        out.append("")
    return "\n".join(out).rstrip() + "\n"


_CSS = """
body{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:960px;margin:2rem auto;
padding:0 1rem;color:#1d2433;background:#fff;line-height:1.5}
h1{font-size:1.6rem;border-bottom:2px solid #3b4a6b;padding-bottom:.3rem}h2{font-size:1.25rem;margin-top:2rem;
color:#22304d}h3{font-size:1.05rem}table{border-collapse:collapse;margin:.6rem 0;font-size:.9rem}
th,td{border:1px solid #cfd6e4;padding:.3rem .6rem;text-align:left;vertical-align:top}th{background:#eef2f9}
td{font-variant-numeric:tabular-nums;word-break:break-word}.note{background:#f3f6fb;border-left:4px solid #5b7bd5;
padding:.5rem .8rem;margin:.6rem 0}.warn{background:#fff4e5;border-left:4px solid #e08a00;padding:.5rem .8rem;
margin:.6rem 0;font-weight:600}dl{display:grid;grid-template-columns:max-content 1fr;gap:.2rem 1rem}
dt{font-weight:600}dd{margin:0;word-break:break-word}
@media (prefers-color-scheme:dark){body{background:#12161f;color:#e3e8f2}th{background:#1f2738}
th,td{border-color:#36415a}.note{background:#1a2233}.warn{background:#2e2414}h2{color:#aebfe6}}
"""


def to_html(blocks: list[Block], title: str) -> str:
    e = html.escape
    parts = [
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{e(title)}</title><style>{_CSS}</style></head><body>",
    ]
    for blk in blocks:
        kind = blk[0]
        if kind in ("h1", "h2", "h3"):
            parts.append(f"<{kind}>{e(str(blk[1]))}</{kind}>")
        elif kind == "p":
            parts.append(f"<p>{e(str(blk[1]))}</p>")
        elif kind in ("note", "warn"):
            parts.append(f'<div class="{kind}">{e(str(blk[1]))}</div>')
        elif kind == "kv":
            parts.append(
                "<dl>" + "".join(f"<dt>{e(str(k))}</dt><dd>{e(str(v))}</dd>" for k, v in blk[1]) + "</dl>"
            )
        elif kind == "table":
            head = "".join(f"<th>{e(str(h))}</th>" for h in blk[1])
            body = "".join("<tr>" + "".join(f"<td>{e(str(c))}</td>" for c in row) + "</tr>" for row in blk[2])
            parts.append(f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>")
    parts.append("</body></html>")
    return "\n".join(parts)


def render(data: dict[str, Any], fmt: str) -> tuple[bytes, str]:
    """Render report ``data`` as ``md``/``html``/``json``; returns ``(content, media_type)``."""
    if fmt not in FORMATS:
        raise bad_request(f"Unknown report format {fmt!r}", "invalid_format", "Use md, html or json.")
    if fmt == "json":
        return json.dumps(data, indent=2, sort_keys=False).encode("utf-8"), FORMATS[fmt]
    blocks = experiment_blocks(data) if data.get("report_type") == "experiment" else comparison_blocks(data)
    if fmt == "md":
        return to_markdown(blocks).encode("utf-8"), FORMATS[fmt]
    return to_html(blocks, data.get("title") or "Report").encode("utf-8"), FORMATS[fmt]


def experiment_report(session: Session, experiment_id: int, fmt: str = "md") -> tuple[bytes, str, str]:
    """``(content, media_type, filename)`` of an experiment report."""
    data = experiment_report_data(session, experiment_id)
    content, media = render(data, fmt)
    return content, media, f"exofinder-experiment-{experiment_id}-report.{fmt}"


def comparison_report(session: Session, experiment_ids: list[int], fmt: str = "md") -> tuple[bytes, str, str]:
    if len(experiment_ids) < 2:
        raise bad_request(
            "A comparison needs at least two experiment ids", "invalid_ids", "Use e.g. ?ids=1,2"
        )
    data = comparison_report_data(session, experiment_ids)
    content, media = render(data, fmt)
    ids = "-".join(str(i) for i in experiment_ids)
    return content, media, f"exofinder-comparison-{ids}-report.{fmt}"


__all__ = [
    "comparison_report",
    "comparison_report_data",
    "experiment_report",
    "experiment_report_data",
    "render",
]
