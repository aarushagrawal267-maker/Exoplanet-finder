"""Settings page: user settings, disk usage, cache clearing and database backup (``/api/settings``).

The settings themselves live in :mod:`exofinder.services.app_settings`; this module wraps it with
user-facing errors and adds storage management. Only three things can be cleared from the UI, all
of them re-creatable: raw FITS downloads (the stitched light-curve cache is kept), uploads, and the
processed-views cache. Clearing refuses to run while a job that uses those files is active.
"""

from __future__ import annotations

import contextlib
import os
import shutil
import sqlite3
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from exofinder.config import get_settings
from exofinder.db.models import Job, ModelVersion
from exofinder.services import app_settings
from exofinder.services.sci_common import dir_usage, files_usage
from exofinder.services.sci_errors import ServiceError, bad_request, conflict

CLEARABLE = ("raw_fits", "uploads", "views_cache")
#: Job kinds that read/write the files of each clearable category.
_BLOCKING_JOBS = {
    "raw_fits": ("download", "build_dataset", "batch_predict"),
    "uploads": (),
    "views_cache": ("build_dataset", "batch_predict"),
}


def get(session: Session) -> dict[str, Any]:
    return {
        "values": app_settings.get_all(session),
        "defaults": app_settings.defaults(),
        "descriptions": app_settings.descriptions(),
    }


def put(session: Session, changes: dict[str, Any]) -> dict[str, Any]:
    """Validated partial update (400 ``invalid_setting`` with the validation message)."""
    if not isinstance(changes, dict) or not changes:
        raise bad_request("Send a JSON object with the settings to change.", "invalid_setting")
    mid = changes.get("default_model_id")
    if (
        mid is not None
        and not isinstance(mid, bool)
        and isinstance(mid, int)
        and session.get(ModelVersion, mid) is None
    ):
        raise bad_request(
            f"Model version {mid} does not exist",
            "invalid_setting",
            "Pick a model from the Models page, or null.",
        )
    try:
        app_settings.update(session, changes)
    except ValueError as exc:
        raise bad_request(str(exc), "invalid_setting") from exc
    session.commit()
    return get(session)


# ------------------------------------------------------------------------------------------------
# storage
# ------------------------------------------------------------------------------------------------
def _db_path() -> Path | None:
    url = get_settings().database_url
    if not url.startswith("sqlite:///"):
        return None
    return Path(url[len("sqlite:///") :])


def storage() -> dict[str, Any]:
    """Disk usage per category (bytes and file counts) + free space on the data volume."""
    s = get_settings()
    db = _db_path()
    entries = [
        (
            "raw_fits",
            "Raw FITS downloads",
            s.raw_dir,
            "Original MAST quarter files (deleted after caching unless 'keep raw FITS' is on).",
        ),
        (
            "lightcurves",
            "Light-curve cache",
            s.lightcurves_dir,
            "Stitched light curve per star (needed for analysis and datasets).",
        ),
        (
            "views_cache",
            "Processed views cache",
            s.data_path / "views",
            "Per-signal model views; recomputed on demand.",
        ),
        (
            "catalogs",
            "Catalogue snapshots",
            s.catalogs_dir,
            "Verbatim NASA Exoplanet Archive CSV snapshots (provenance).",
        ),
        ("datasets", "Datasets", s.datasets_dir, "Training arrays and manifests."),
        ("models", "Models", s.models_dir, "Trained model checkpoints."),
        ("uploads", "Uploads", s.uploads_dir, "Files you uploaded."),
        (
            "predictions",
            "Prediction inputs",
            s.data_path / "predictions",
            "Views stored with single predictions.",
        ),
        ("reports", "Reports", s.reports_dir, "Generated experiment reports."),
    ]
    cats = []
    for key, label, path, desc in entries:
        size, n = dir_usage(path)
        cats.append(
            {
                "key": key,
                "label": label,
                "path": str(path),
                "bytes": size,
                "n_files": n,
                "clearable": key in CLEARABLE,
                "description": desc,
            }
        )
    if db is not None:
        size, n = files_usage([db, Path(f"{db}-wal"), Path(f"{db}-shm")])
        cats.append(
            {
                "key": "database",
                "label": "Database",
                "path": str(db),
                "bytes": size,
                "n_files": n,
                "clearable": False,
                "description": "SQLite metadata, provenance, experiments and predictions (use Backup).",
            }
        )
    try:
        du = shutil.disk_usage(s.data_path)
        disk = {"path": str(s.data_path), "total": du.total, "used": du.used, "free": du.free}
    except OSError:
        disk = None
    return {"categories": cats, "total_bytes": sum(c["bytes"] for c in cats), "disk": disk}


def clear(session: Session, target: str) -> dict[str, Any]:
    """Delete one re-creatable category (raw_fits | uploads | views_cache)."""
    if target not in CLEARABLE:
        raise bad_request(
            f"'{target}' cannot be cleared from here", "not_clearable", f"Clearable: {', '.join(CLEARABLE)}."
        )
    blocking = _BLOCKING_JOBS[target]
    if blocking:
        active = session.scalars(
            select(Job).where(Job.kind.in_(blocking), Job.status.in_(("queued", "running")))
        ).first()
        if active is not None:
            raise conflict(
                f"A {active.kind} job is running and uses these files",
                "job_running",
                "Wait for it to finish (or cancel it), then clear again.",
            )
    s = get_settings()
    path = {"raw_fits": s.raw_dir, "uploads": s.uploads_dir, "views_cache": s.data_path / "views"}[target]
    size, n = dir_usage(path)
    if path.exists():
        for child in list(path.iterdir()):
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child, ignore_errors=True)
            else:
                with contextlib.suppress(OSError):
                    child.unlink()
    if target == "views_cache":
        s.views_dir.mkdir(parents=True, exist_ok=True)
    after, n_after = dir_usage(path)
    if target == "uploads":
        from exofinder.services import analysis, lightcurves

        lightcurves.clear_cache()
        analysis.clear_caches()
    return {"target": target, "bytes_freed": size - after, "files_removed": n - n_after, "path": str(path)}


# ------------------------------------------------------------------------------------------------
# backup
# ------------------------------------------------------------------------------------------------
def backup_file() -> tuple[Path, str]:
    """Consistent copy of the SQLite database (sqlite3 online-backup API) in a temporary file.

    Returns ``(path, download_name)``; the caller deletes the file after sending it.
    """
    db = _db_path()
    if db is None or not db.is_file():
        raise ServiceError(
            400, "Backups are only available for the local SQLite database", "backup_unsupported", None
        )
    fd, tmp = tempfile.mkstemp(prefix="exofinder-backup-", suffix=".db")
    os.close(fd)
    src = sqlite3.connect(str(db), timeout=30)
    try:
        dst = sqlite3.connect(tmp)
        try:
            with dst:
                src.backup(dst)
        finally:
            dst.close()
    except sqlite3.Error as exc:
        os.unlink(tmp)
        raise ServiceError(
            500, f"Backup failed: {exc}", "backup_failed", "Try again; see logs/backend.log."
        ) from exc
    finally:
        src.close()
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return Path(tmp), f"exofinder-backup-{stamp}.db"
