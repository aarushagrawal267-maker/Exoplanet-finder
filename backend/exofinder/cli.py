"""Command-line interface: ``exofinder <command>`` or ``python -m exofinder.cli <command>``.

The commands call the same service functions as the REST API; long-running work runs synchronously
in this process as a recorded job (visible in the app's job history), prints readable progress and
can be cancelled with Ctrl+C. Exit codes: 0 success, 1 failure, 2 usage error, 130 cancelled.

``init`` and ``doctor --no-network`` work on a fresh install (no catalogue, no models).
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import platform
import shutil
import sys
import tempfile
import time
import warnings
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

EXIT_OK, EXIT_FAIL, EXIT_USAGE, EXIT_CANCELLED = 0, 1, 2, 130


def _p(msg: str = "") -> None:
    print(msg, flush=True)


def _tolerant_console() -> None:
    """Replace, instead of crashing on, characters the output encoding cannot represent.

    On Windows, output that is redirected or piped (``exofinder status > out.txt``, ``| Tee-Object``)
    is encoded with the ANSI code page (cp1252 on most Western systems), and stdout uses the
    ``strict`` error handler: one dataset name, path or message with e.g. "→" or "≈" would raise
    ``UnicodeEncodeError`` mid-command. UTF-8 streams (Linux, macOS, the Windows console itself) are
    left unchanged.
    """
    for stream in (sys.stdout, sys.stderr):
        encoding = (getattr(stream, "encoding", None) or "").lower().replace("-", "").replace("_", "")
        if encoding in ("utf8", "utf8sig") or not hasattr(stream, "reconfigure"):
            continue
        with contextlib.suppress(AttributeError, ValueError, OSError):  # exotic stream wrappers
            stream.reconfigure(errors="replace")


def _err(msg: str, hint: str | None = None) -> None:
    print(f"Error: {msg}", file=sys.stderr, flush=True)
    if hint:
        print(f"Hint: {hint}", file=sys.stderr, flush=True)


def _bootstrap() -> None:
    """Create folders and tables, then apply settings saved from the UI (device, download workers...)."""
    from exofinder.config import get_settings
    from exofinder.db import init_db
    from exofinder.services.app_settings import apply_overrides

    get_settings().ensure_dirs()
    init_db()
    apply_overrides()


def _fmt(x: Any, digits: int = 3) -> str:
    if isinstance(x, float):
        return f"{x:.{digits}f}"
    return "-" if x is None else str(x)


def _job_exit(res: Any, label: str) -> int:
    if res.status == "succeeded":
        return EXIT_OK
    if res.status == "cancelled":
        _p(f"{label} cancelled.")
        return EXIT_CANCELLED
    _err(f"{label} failed: {res.error}", f"See the job log: exofinder status (job {res.job_id[:8]}).")
    return EXIT_FAIL


# --------------------------------------------------------------------------------------------------
# init / doctor / status
# --------------------------------------------------------------------------------------------------
def cmd_init(args: argparse.Namespace) -> int:
    from exofinder.config import REPO_ROOT, get_settings
    from exofinder.db import init_db
    from exofinder.db.session import get_engine

    s = get_settings()
    s.ensure_dirs()
    (REPO_ROOT / "logs").mkdir(exist_ok=True)
    init_db()
    from sqlalchemy import inspect

    tables = inspect(get_engine()).get_table_names()
    _p("Exoplanet Finder initialised:")
    _p(f"  data folder:      {s.data_path}")
    _p(f"  artifacts folder: {s.artifacts_path}")
    _p(f"  database:         {s.database_url} ({len(tables)} tables)")
    return EXIT_OK


class _Checks:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def add(self, status: str, name: str, detail: str, hint: str | None = None) -> None:
        self.rows.append({"status": status, "check": name, "detail": detail, "hint": hint})

    @property
    def failed(self) -> bool:
        return any(r["status"] == "fail" for r in self.rows)


def _check_writable(path: Path) -> str | None:
    try:
        path.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path, prefix=".doctor-")
        os.close(fd)
        os.unlink(tmp)
        return None
    except OSError as exc:
        return str(exc)


def _doctor_checks(network: bool) -> _Checks:
    from exofinder import __version__
    from exofinder.config import PIPELINE_VERSION, REPO_ROOT, get_settings

    c = _Checks()
    v = sys.version_info
    py = f"{v.major}.{v.minor}.{v.micro} ({platform.architecture()[0]}, {platform.system()})"
    if (v.major, v.minor) < (3, 11):
        c.add("fail", "Python", py, "Install Python 3.11 or 3.12 and re-run setup.")
    elif (v.major, v.minor) > (3, 13):
        c.add("warn", "Python", py, "Python 3.11-3.13 are tested; newer versions may lack PyTorch wheels.")
    else:
        c.add("ok", "Python", py)
    c.add("ok", "Exoplanet Finder", f"version {__version__}, pipeline {PIPELINE_VERSION}")

    required = (
        "numpy",
        "scipy",
        "pandas",
        "sklearn",
        "torch",
        "astropy",
        "fastapi",
        "uvicorn",
        "sqlalchemy",
        "pydantic",
        "requests",
    )
    optional = ("lightkurve", "joblib")
    for name in required + optional:
        try:
            with warnings.catch_warnings():  # e.g. lightkurve warns about optional sub-dependencies
                warnings.simplefilter("ignore")
                mod = __import__(name)
            c.add("ok", f"package {name}", getattr(mod, "__version__", "installed"))
        except Exception as exc:  # noqa: BLE001 - report any import problem
            if name in required:
                hint = "Re-run setup.ps1 (pip install -r requirements.txt)."
                if isinstance(exc, OSError) and sys.platform == "win32":  # e.g. [WinError 126] ... c10.dll
                    hint = (
                        "A DLL failed to load: install the Microsoft Visual C++ Redistributable (X64) from "
                        "https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist, then re-run setup.ps1."
                    )
                c.add("fail", f"package {name}", f"cannot be imported: {exc}", hint)
            else:
                c.add(
                    "warn", f"package {name}", f"not available: {exc}", "Only needed as a download fallback."
                )

    settings = get_settings()
    try:
        import torch

        from exofinder.ml.device import resolve_device

        dev = resolve_device(settings.device)
        detail = f"setting '{settings.device}' -> {dev}; CUDA {'available' if torch.cuda.is_available() else 'not available'}"
        if settings.device not in ("auto", "cpu") and dev.type == "cpu":
            c.add(
                "warn", "compute device", detail, "The requested accelerator is not available; CPU is used."
            )
        else:
            c.add("ok", "compute device", detail + f"; {os.cpu_count()} CPU cores")
    except Exception as exc:  # noqa: BLE001
        c.add("fail", "compute device", str(exc), "PyTorch is not working; re-run setup.ps1.")

    for label, path in (
        ("data folder", settings.data_path),
        ("artifacts folder", settings.artifacts_path),
        ("logs folder", REPO_ROOT / "logs"),
    ):
        err = _check_writable(path)
        if err:
            c.add(
                "fail",
                f"{label} writable",
                f"{path}: {err}",
                "Move the project to a folder you can write to (not Program Files).",
            )
        else:
            c.add("ok", f"{label} writable", str(path))

    try:
        free = shutil.disk_usage(settings.data_path).free
        gb = free / 1e9
        if gb < 0.5:
            c.add(
                "fail",
                "disk space",
                f"{gb:.1f} GB free",
                "Free some disk space: datasets and light curves need several GB.",
            )
        elif gb < 5:
            c.add(
                "warn",
                "disk space",
                f"{gb:.1f} GB free",
                "The Standard tier needs ~2 GB, Full ~15 GB of light-curve cache.",
            )
        else:
            c.add("ok", "disk space", f"{gb:.1f} GB free")
    except OSError as exc:
        c.add("warn", "disk space", str(exc))

    try:
        from sqlalchemy import func, select, text

        from exofinder.db import init_db
        from exofinder.db.models import CatalogSnapshot, Dataset, ModelVersion, Signal, Target
        from exofinder.db.session import session_scope

        settings.ensure_dirs()
        init_db()
        with session_scope() as s:
            s.execute(text("SELECT 1"))
            c.add("ok", "database", settings.database_url)
            n_sig = s.scalar(select(func.count()).select_from(Signal)) or 0
            n_snap = s.scalar(select(func.count()).select_from(CatalogSnapshot)) or 0
            if n_sig:
                c.add("ok", "catalogue", f"{n_sig:,} signals from {n_snap} snapshot(s)")
            else:
                c.add(
                    "warn",
                    "catalogue",
                    "not downloaded yet",
                    "Run `exofinder refresh-catalog` or use the Data page.",
                )
            n_lc = (
                s.scalar(select(func.count()).select_from(Target).where(Target.lc_status == "available")) or 0
            )
            c.add("ok", "light curves", f"{n_lc:,} stars downloaded")
            n_ds = s.scalar(select(func.count()).select_from(Dataset).where(Dataset.status == "ready")) or 0
            active = s.scalar(select(ModelVersion).where(ModelVersion.is_active.is_(True)).limit(1))
            n_mv = s.scalar(select(func.count()).select_from(ModelVersion)) or 0
            detail = f"{n_ds} ready dataset(s), {n_mv} model(s)" + (
                f"; active model #{active.id} ({active.model_type})" if active else ""
            )
            if active is not None and active.pipeline_version != PIPELINE_VERSION:
                c.add(
                    "warn",
                    "models",
                    detail,
                    "The active model was trained with another pipeline version; retrain it.",
                )
            else:
                c.add(
                    "ok" if n_mv or not n_sig else "warn",
                    "models",
                    detail if n_mv else detail + " (none trained yet)",
                )
    except Exception as exc:  # noqa: BLE001
        c.add(
            "fail",
            "database",
            f"{type(exc).__name__}: {exc}",
            "Check that data/app.db is not open in another program; run `exofinder init`.",
        )

    if network:
        import requests

        checks = (
            (
                "NASA Exoplanet Archive",
                settings.archive_tap_url,
                {"query": "select top 1 kepid from q1_q17_dr24_tce", "format": "csv"},
            ),
            (
                "NASA MAST downloads",
                settings.mast_download_url,
                {
                    "uri": "mast:KEPLER/url/missions/kepler/lightcurves/0106/010666592/kplr010666592-2009350155506_llc.fits"
                },
            ),
        )
        for name, url, params in checks:
            t0 = time.perf_counter()
            try:
                with requests.get(url, params=params, timeout=20, stream=True) as r:
                    ms = (time.perf_counter() - t0) * 1000
                    if r.status_code < 400:
                        c.add("ok", name, f"reachable (HTTP {r.status_code}, {ms:.0f} ms)")
                    else:
                        c.add(
                            "warn", name, f"HTTP {r.status_code}", "The service may be down; try again later."
                        )
            except Exception as exc:  # noqa: BLE001 - network problems are warnings, not failures
                c.add(
                    "warn",
                    name,
                    f"unreachable: {type(exc).__name__}",
                    "Check your internet connection or proxy.",
                )
    else:
        c.add("skip", "NASA services", "network checks skipped (--no-network)")
    return c


def cmd_doctor(args: argparse.Namespace) -> int:
    checks = _doctor_checks(network=not args.no_network)
    if args.json:
        _p(json.dumps({"ok": not checks.failed, "checks": checks.rows}, indent=2))
    else:
        marks = {"ok": "[ok]  ", "warn": "[warn]", "fail": "[FAIL]", "skip": "[skip]"}
        _p("Exoplanet Finder self-check")
        for r in checks.rows:
            _p(f"  {marks[r['status']]} {r['check']}: {r['detail']}")
            if r["hint"] and r["status"] in ("warn", "fail"):
                _p(f"         -> {r['hint']}")
        n_fail = sum(r["status"] == "fail" for r in checks.rows)
        n_warn = sum(r["status"] == "warn" for r in checks.rows)
        _p(f"Result: {'FAILED' if n_fail else 'OK'} ({n_fail} failure(s), {n_warn} warning(s))")
    return EXIT_FAIL if checks.failed else EXIT_OK


def cmd_status(args: argparse.Namespace) -> int:
    from sqlalchemy import func, select

    from exofinder.db.models import CatalogSnapshot, Dataset, Job, ModelVersion, Signal, Target
    from exofinder.db.session import session_scope

    _bootstrap()
    with session_scope() as s:
        n_sig = s.scalar(select(func.count()).select_from(Signal)) or 0
        n_tgt = s.scalar(select(func.count()).select_from(Target)) or 0
        last = s.scalar(select(CatalogSnapshot).order_by(CatalogSnapshot.retrieved_at.desc()).limit(1))
        lc = dict(s.execute(select(Target.lc_status, func.count()).group_by(Target.lc_status)).all())
        _p("Catalogue")
        if n_sig:
            when = last.retrieved_at.strftime("%Y-%m-%d %H:%M UTC") if last and last.retrieved_at else "?"
            _p(f"  {n_sig:,} signals on {n_tgt:,} stars (last snapshot {when})")
        else:
            _p("  not downloaded yet -> exofinder refresh-catalog")
        _p("Light curves")
        _p("  " + (", ".join(f"{k}: {v:,}" for k, v in sorted(lc.items())) or "none"))
        _p("Datasets")
        datasets = s.scalars(select(Dataset).order_by(Dataset.id)).all()
        for d in datasets:
            _p(
                f"  #{d.id} {d.name} [{d.status}] tier={d.tier} n={d.n_examples} (train {d.n_train}/val {d.n_val}/test {d.n_test})"
            )
        if not datasets:
            _p('  none -> exofinder build-dataset --tier pilot --name "Pilot DR24"')
        _p("Models")
        models = s.scalars(select(ModelVersion).order_by(ModelVersion.id)).all()
        for m in models:
            flags = (" ACTIVE" if m.is_active else "") + (" FIXTURE" if m.is_fixture else "")
            vm, tm = m.val_metrics or {}, m.test_metrics or {}
            _p(
                f"  #{m.id} {m.model_type} '{m.name}'{flags}: val PR-AUC {_fmt(vm.get('pr_auc'))}, "
                f"test PR-AUC {_fmt(tm.get('pr_auc')) if tm else 'not evaluated'}"
            )
        if not models:
            _p("  none -> exofinder train-suite --dataset <id>")
        _p("Recent jobs")
        jobs = s.scalars(select(Job).order_by(Job.created_at.desc()).limit(args.jobs)).all()
        for j in jobs:
            _p(f"  {j.id[:8]} {j.kind:<14} {j.status:<10} {j.created_at:%Y-%m-%d %H:%M} {j.title}")
        if not jobs:
            _p("  none")
    return EXIT_OK


# --------------------------------------------------------------------------------------------------
# data
# --------------------------------------------------------------------------------------------------
def cmd_refresh_catalog(args: argparse.Namespace) -> int:
    from exofinder.db.session import session_scope
    from exofinder.services.catalog import refresh_blocker
    from exofinder.services.jobs import JobSpec, run_inline

    _bootstrap()
    with session_scope() as s:
        blocker = refresh_blocker(s)
        if blocker is not None:
            _err(
                f"A dataset is being built ('{blocker.title}'); refreshing the catalogue now could change "
                "the signals it is using.",
                "Wait for the build to finish (or cancel it), then run refresh-catalog again.",
            )
            return 1

    def work(ctx: Any) -> dict:
        from exofinder.data.catalog import refresh_catalog
        from exofinder.db.session import session_scope

        def progress(done: int, total: int, msg: str) -> None:
            if done < total:  # the final report follows the commit of the new catalogue
                ctx.check_cancelled()
            ctx.progress(done / max(total, 1), msg)

        kwargs: dict[str, Any] = {"progress": progress}
        if args.sources:
            kwargs["sources"] = args.sources
        with session_scope() as s:
            result = refresh_catalog(s, **kwargs)
        return {"summary": result.get("summary"), "snapshots": result.get("snapshots")}

    res = run_inline(
        JobSpec("catalog_refresh", "Refresh NASA catalogue (CLI)", work, {"sources": args.sources})
    )
    if res.status == "succeeded":
        summ = (res.result or {}).get("summary") or {}
        _p(f"Catalogue ready: {summ.get('n_signals', 0):,} signals on {summ.get('n_targets', 0):,} stars.")
    return _job_exit(res, "Catalogue refresh")


def cmd_download(args: argparse.Namespace) -> int:
    from exofinder.config import get_settings
    from exofinder.services.jobs import JobSpec, run_inline

    _bootstrap()
    if args.tier:
        from exofinder.data.tiers import select_signals_for_tier
        from exofinder.db.session import session_scope

        with session_scope() as s:
            try:
                kepids = sorted(
                    {
                        sig.kepid
                        for sig in select_signals_for_tier(s, args.tier, args.label_mode, seed=args.seed)
                    }
                )
            except ValueError as exc:
                _err(str(exc))
                return EXIT_USAGE
        title = f"Download light curves: tier {args.tier} (CLI)"
    else:
        kepids = sorted(set(args.kepid))
        title = f"Download light curves: {len(kepids)} star(s) (CLI)"
    if not kepids:
        _err("No stars to download.", "Refresh the catalogue first: exofinder refresh-catalog")
        return EXIT_FAIL
    workers = args.workers or get_settings().download_workers
    _p(f"Downloading light curves for {len(kepids)} star(s) with {workers} worker(s)...")

    def work(ctx: Any) -> dict:
        from exofinder.data.acquire import download_many

        def progress(done: int, total: int, msg: str) -> None:
            ctx.progress(done / max(total, 1), f"{done}/{total} {msg}")

        res = download_many(kepids, workers, progress=progress, cancel=ctx.cancelled, force=args.force)
        ctx.check_cancelled()
        return {k: v for k, v in res.items() if k != "results"}

    res = run_inline(JobSpec("download", title, work, {"n_stars": len(kepids), "tier": args.tier}))
    if res.result:
        r = res.result
        _p(
            f"Done: {r.get('available', 0)} downloaded, {r.get('cached', 0)} already cached, "
            f"{r.get('no_data', 0)} without Kepler data, {r.get('error', 0)} failed."
        )
    return _job_exit(res, "Download")


def cmd_build_dataset(args: argparse.Namespace) -> int:
    from exofinder.db.session import session_scope
    from exofinder.services import datasets as svc
    from exofinder.services.jobs import run_inline

    _bootstrap()
    with session_scope() as s:
        ds, spec = svc.create_dataset(
            s,
            name=args.name,
            tier=args.tier,
            label_mode=args.label_mode,
            split_seed=args.seed,
            exclude_conflicts=not args.include_conflicts,
            max_signals=args.max_signals,
            pipeline={"detrend_method": args.detrend},
            parent_id=args.parent,
            download_missing=not args.no_download,
            workers=args.workers,
        )
        dataset_id = ds.id
    _p(
        f"Building dataset #{dataset_id} '{args.name}' (tier {args.tier}, {args.label_mode}, seed {args.seed})..."
    )
    res = run_inline(spec)
    if res.status == "succeeded":
        r = res.result or {}
        _p(f"Dataset #{dataset_id} ready: {r.get('n_examples')} examples, {r.get('n_excluded')} excluded.")
        for split, row in (r.get("per_split") or {}).items():
            _p(
                f"  {split:<5} n={row['n']:<5} planet-like={row['n_pos']:<5} false-positive-like={row['n_neg']:<5} stars={row['n_stars']}"
            )
        if r.get("exclusions_by_reason"):
            _p("  exclusions: " + ", ".join(f"{k}={v}" for k, v in r["exclusions_by_reason"].items()))
        proc = r.get("processing") or {}
        _p(
            f"  processing: {proc.get('wall_s')} s wall, {proc.get('n_computed')} computed / {proc.get('n_from_cache')} cached, "
            f"{proc.get('workers')} worker(s) ({proc.get('mode')}), effective speed-up {proc.get('effective_speedup')}"
        )
    return _job_exit(res, "Dataset build")


# --------------------------------------------------------------------------------------------------
# training / evaluation / prediction
# --------------------------------------------------------------------------------------------------
def _parse_sets(pairs: Sequence[str] | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for pair in pairs or []:
        if "=" not in pair:
            raise ValueError(f"--set expects key=value, got {pair!r}")
        key, raw = pair.split("=", 1)
        try:
            out[key.strip()] = json.loads(raw)
        except json.JSONDecodeError:
            out[key.strip()] = raw
    return out


def _training_config(args: argparse.Namespace) -> dict[str, Any]:
    cfg = json.loads(args.config) if getattr(args, "config", None) else {}
    cfg.update(_parse_sets(args.set))
    if getattr(args, "max_epochs", None):
        cfg["max_epochs"] = args.max_epochs
    return cfg


def _print_training(result: dict[str, Any]) -> None:
    vm = result.get("val_metrics") or {}
    _p(
        f"  experiment #{result.get('experiment_id')} -> model #{result.get('model_version_id')} ({result.get('model_type')}): "
        f"val PR-AUC {_fmt(vm.get('pr_auc'))}, ROC-AUC {_fmt(vm.get('roc_auc'))}, F1 {_fmt(vm.get('f1'))}, "
        f"{_fmt(result.get('duration_s'), 1)} s" + (" [active]" if result.get("is_active") else "")
    )


def cmd_train(args: argparse.Namespace) -> int:
    from exofinder.db.session import session_scope
    from exofinder.services import training as svc
    from exofinder.services.jobs import run_inline

    _bootstrap()
    with session_scope() as s:
        exp, spec = svc.start_training(
            s,
            model_type=args.model_type,
            dataset_id=args.dataset,
            name=args.name,
            config=_training_config(args),
        )
        eid = exp.id
    _p(f"Training experiment #{eid} ({args.model_type}) on dataset #{args.dataset}...")
    res = run_inline(spec)
    if res.status == "succeeded":
        _print_training(res.result or {})
    return _job_exit(res, "Training")


def cmd_train_suite(args: argparse.Namespace) -> int:
    from exofinder.db.session import session_scope
    from exofinder.services import training as svc
    from exofinder.services.jobs import run_inline

    _bootstrap()
    cfg = _training_config(args)
    types = args.models or None
    with session_scope() as s:
        exps, spec = svc.start_suite(
            s,
            dataset_id=args.dataset,
            name_prefix=args.name_prefix,
            configs={t: dict(cfg) for t in (types or svc.MODEL_TYPES)} if cfg else None,
            model_types=types,
        )
        ids = [e.id for e in exps]
    _p(f"Training suite on dataset #{args.dataset}: experiments {ids}...")
    res = run_inline(spec)
    for row in (res.result or {}).get("experiments", []):
        if row.get("status") == "succeeded":
            _print_training(row)
        else:
            _p(
                f"  experiment #{row.get('experiment_id')} ({row.get('model_type')}) FAILED: {row.get('error')}"
            )
    return _job_exit(res, "Training suite")


def cmd_evaluate(args: argparse.Namespace) -> int:
    from exofinder.db.session import session_scope
    from exofinder.services import evaluation as svc
    from exofinder.services.jobs import run_inline

    _bootstrap()
    with session_scope() as s:
        spec = svc.start_evaluation(s, args.model, args.split, n_boot=args.n_boot)
        previous = svc.count_test_evaluations(s, args.model)
    if args.split == "test":
        _p(
            f"NOTE: test-set evaluation #{previous + 1} for model #{args.model}. Test evaluations are logged and "
            "counted; use --split val while iterating."
        )
    res = run_inline(spec)
    if res.status == "succeeded":
        m = (res.result or {}).get("metrics") or {}
        _p(
            f"Evaluation #{(res.result or {}).get('evaluation_id')} ({args.split}, n={m.get('n')}): "
            f"PR-AUC {_fmt(m.get('pr_auc'))}, ROC-AUC {_fmt(m.get('roc_auc'))}, F1 {_fmt(m.get('f1'))}, "
            f"precision {_fmt(m.get('precision'))}, recall {_fmt(m.get('recall'))}, accuracy {_fmt(m.get('accuracy'))}"
        )
    return _job_exit(res, "Evaluation")


def cmd_predict(args: argparse.Namespace) -> int:
    from sqlalchemy import select

    from exofinder.db.models import Signal
    from exofinder.db.session import session_scope
    from exofinder.services.ops_common import PLANET_LEAD_SENTENCE

    _bootstrap()
    try:
        from exofinder.services import predictions as pred_svc
    except ImportError:  # pragma: no cover - the predictions service ships with the app
        pred_svc = None
    with session_scope() as s:
        q = (
            select(Signal)
            .where(Signal.kepid == args.kepid, Signal.category != "retired")
            .order_by(Signal.signal_key)
        )
        if args.signal_id:
            q = q.where(Signal.id == args.signal_id)
        signals = s.scalars(q).all()
        if not signals:
            _err(f"No catalogue signals for KIC {args.kepid}.", "Check the KIC id, or refresh the catalogue.")
            return EXIT_FAIL
        _p(f"KIC {args.kepid}: {len(signals)} signal(s)")
        failures = 0
        for sig in signals:
            label = sig.kepler_name or sig.kepoi_name or sig.signal_key
            try:
                if pred_svc is not None:
                    out = pred_svc.predict(
                        s,
                        {
                            "model_version_ids": args.model or None,
                            "source": {"type": "catalog", "kepid": args.kepid, "signal_id": sig.id},
                            "ephemeris_source": "catalog",
                        },
                    )
                    rows = out.get("results") or []
                    warnings = out.get("warnings") or []
                else:
                    rows, warnings = _predict_direct(s, sig, args.model), []
            except Exception as exc:  # noqa: BLE001 - report per signal and continue
                failures += 1
                detail = getattr(exc, "detail", None) or str(exc)
                _p(f"  {label} ({sig.signal_key}, P={sig.period_days:.4f} d): could not score - {detail}")
                hint = getattr(exc, "hint", None)
                if hint:
                    _p(f"      hint: {hint}")
                continue
            nasa = f"NASA: AV={sig.av_training_set or '-'}, KOI={sig.koi_disposition or '-'}"
            for r in rows:
                verdict = "planet-like" if r.get("predicted_label") == 1 else "false-positive-like"
                unc = r.get("uncertainty")
                _p(
                    f"  {label} ({sig.signal_key}, P={sig.period_days:.4f} d) model #{r.get('model_version_id')} "
                    f"{r.get('model_type')}: p={_fmt(r.get('probability'))}"
                    + (f" +/- {_fmt(unc)}" if unc is not None else "")
                    + f" -> {verdict} (threshold {_fmt(r.get('threshold'))}; seen in split: {r.get('seen_in_split') or 'none'}); {nasa}"
                )
            for w in dict.fromkeys(warnings):
                _p(f"      warning: {w}")
    _p(PLANET_LEAD_SENTENCE)
    return EXIT_FAIL if failures == len(signals) else EXIT_OK


def _predict_direct(session: Any, sig: Any, model_ids: list[int] | None) -> list[dict[str, Any]]:
    """Fallback scoring with :class:`exofinder.ml.inference.Predictor` (used only without the predictions service)."""
    from exofinder.data.acquire import ensure_lightcurve
    from exofinder.ml.inference import Predictor
    from exofinder.services.models import active_model, get_model
    from exofinder.services.signal_views import compute_signal_views

    models = (
        [get_model(session, i) for i in model_ids] if model_ids else [m for m in [active_model(session)] if m]
    )
    if not models:
        raise RuntimeError("no trained model: train one first (exofinder train-suite --dataset <id>)")
    ensure_lightcurve(session, sig.kepid)
    sv = compute_signal_views(session, sig)
    rows = []
    for mv in models:
        pred = Predictor.from_dir(mv.checkpoint_path)
        out = pred.predict(sv.global_view[None, :], sv.local_view[None, :], sv.features[None, :])
        p = float(out.prob[0])
        rows.append(
            {
                "model_version_id": mv.id,
                "model_type": mv.model_type,
                "probability": p,
                "uncertainty": None if out.uncertainty is None else float(out.uncertainty[0]),
                "threshold": pred.threshold,
                "predicted_label": int(p >= pred.threshold),
            }
        )
    return rows


def cmd_report(args: argparse.Namespace) -> int:
    from exofinder.config import get_settings
    from exofinder.db.session import session_scope
    from exofinder.services import reports as svc

    _bootstrap()
    with session_scope() as s:
        if len(args.experiment) == 1:
            content, _, filename = svc.experiment_report(s, args.experiment[0], args.format)
        else:
            content, _, filename = svc.comparison_report(s, args.experiment, args.format)
    out = Path(args.out) if args.out else get_settings().reports_dir / filename
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(content)
    _p(f"Report written to {out}")
    return EXIT_OK


# --------------------------------------------------------------------------------------------------
# argument parsing
# --------------------------------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="exofinder",
        description=(
            "Exoplanet Finder command line. Planet-like predictions are research leads, not discoveries."
        ),
    )
    sub = p.add_subparsers(dest="command", metavar="<command>")

    def add(name: str, fn: Callable[[argparse.Namespace], int], help_: str) -> argparse.ArgumentParser:
        sp = sub.add_parser(name, help=help_, description=help_)
        sp.set_defaults(func=fn)
        return sp

    add("init", cmd_init, "Create the data folders and the database (safe to run again)")
    sp = add("doctor", cmd_doctor, "Check the installation")
    sp.add_argument("--no-network", action="store_true", help="Skip the NASA reachability checks")
    sp.add_argument("--json", action="store_true", help="Machine-readable output")
    sp = add("status", cmd_status, "Summary of data, datasets, models and jobs")
    sp.add_argument("--jobs", type=int, default=8, help="Number of recent jobs to list")

    sp = add("refresh-catalog", cmd_refresh_catalog, "Download the NASA catalogue snapshots and ingest them")
    sp.add_argument(
        "--sources",
        nargs="+",
        choices=["dr24_tce", "koi_cumulative", "confirmed", "stellar"],
        help="Only refresh these sources",
    )

    sp = add("download", cmd_download, "Download Kepler light curves for a tier or for given stars")
    g = sp.add_mutually_exclusive_group(required=True)
    g.add_argument("--tier", choices=["pilot", "standard", "full"])
    g.add_argument("--kepid", type=int, nargs="+", help="KIC ids, e.g. 11442793")
    sp.add_argument("--label-mode", default="astronet_dr24", choices=["astronet_dr24", "koi_disposition"])
    sp.add_argument("--seed", type=int, default=42)
    sp.add_argument("--workers", type=int, default=None)
    sp.add_argument("--force", action="store_true", help="Download again even if cached")

    sp = add("build-dataset", cmd_build_dataset, "Build a training dataset (downloads missing light curves)")
    sp.add_argument("--name", required=True)
    sp.add_argument("--tier", default="pilot", choices=["pilot", "standard", "full", "custom"])
    sp.add_argument("--label-mode", default="astronet_dr24", choices=["astronet_dr24", "koi_disposition"])
    sp.add_argument("--seed", type=int, default=42, help="Seed of the star selection and of the split")
    sp.add_argument("--max-signals", type=int, default=None, help="Target size (required for --tier custom)")
    sp.add_argument(
        "--include-conflicts", action="store_true", help="Keep signals whose NASA labels disagree"
    )
    sp.add_argument("--detrend", default="spline", choices=["spline", "savgol"])
    sp.add_argument(
        "--parent", type=int, default=None, help="Expand this dataset (its stars keep their split)"
    )
    sp.add_argument("--no-download", action="store_true", help="Do not download missing light curves")
    sp.add_argument(
        "--workers", type=int, default=None, help="Processing worker processes (default: CPU cores - 1)"
    )

    def training_opts(sp: argparse.ArgumentParser) -> None:
        sp.add_argument(
            "--set",
            action="append",
            metavar="KEY=VALUE",
            help="Training option, e.g. --set lr=0.0003 (repeatable)",
        )
        sp.add_argument("--config", help="Training options as a JSON object")
        sp.add_argument("--max-epochs", type=int, default=None)

    sp = add("train", cmd_train, "Train one model on a dataset")
    sp.add_argument(
        "--model-type", required=True, choices=["logreg", "random_forest", "cnn_single", "cnn_two_view"]
    )
    sp.add_argument("--dataset", type=int, required=True)
    sp.add_argument("--name", default=None)
    training_opts(sp)

    sp = add(
        "train-suite", cmd_train_suite, "Train logistic regression, random forest and both CNNs on a dataset"
    )
    sp.add_argument("--dataset", type=int, required=True)
    sp.add_argument("--name-prefix", default=None)
    sp.add_argument("--models", nargs="+", choices=["logreg", "random_forest", "cnn_single", "cnn_two_view"])
    training_opts(sp)

    sp = add("evaluate", cmd_evaluate, "Evaluate a model on its validation or test split")
    sp.add_argument("--model", type=int, required=True, help="Model version id")
    sp.add_argument("--split", default="val", choices=["val", "test"])
    sp.add_argument("--n-boot", type=int, default=1000)

    sp = add("predict", cmd_predict, "Score the catalogue signals of a star")
    sp.add_argument("--kepid", type=int, required=True)
    sp.add_argument("--signal-id", type=int, default=None)
    sp.add_argument(
        "--model", type=int, nargs="+", default=None, help="Model version id(s); default: the active model"
    )

    sp = add("report", cmd_report, "Write an experiment (or comparison) report")
    sp.add_argument(
        "--experiment", type=int, nargs="+", required=True, help="One id, or several for a comparison"
    )
    sp.add_argument("--format", default="md", choices=["md", "html", "json"])
    sp.add_argument("--out", default=None, help="Output file (default: artifacts/reports/...)")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    _tolerant_console()
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return EXIT_USAGE
    from exofinder.services.ops_errors import OpsError

    try:
        return int(args.func(args))
    except OpsError as exc:
        _err(exc.detail, exc.hint)
        return EXIT_FAIL
    except ValueError as exc:
        _err(str(exc))
        return EXIT_USAGE
    except KeyboardInterrupt:
        _p("Interrupted.")
        return EXIT_CANCELLED


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
