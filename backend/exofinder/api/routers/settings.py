"""Settings, storage and backup: ``/api/settings``."""

from __future__ import annotations

import os
from typing import Annotated, Any

from fastapi import APIRouter, Body
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from exofinder.api.routers._sci_route import DbSession, SciRoute
from exofinder.api.schemas.common import ErrorOut
from exofinder.api.schemas.settings import ClearIn, ClearOut, SettingsOut, StorageOut
from exofinder.services import settings as svc

router = APIRouter(prefix="/api/settings", tags=["settings"], route_class=SciRoute)


@router.get("", response_model=SettingsOut, summary="Current settings with defaults and descriptions")
def get_settings_(db: DbSession) -> dict:
    return svc.get(db)


@router.put(
    "",
    response_model=SettingsOut,
    summary="Change settings (partial update)",
    responses={400: {"model": ErrorOut, "description": "code=invalid_setting"}},
)
def put_settings(
    db: DbSession, changes: Annotated[dict[str, Any], Body(examples=[{"download_workers": 4}])]
) -> dict:
    """All-or-nothing: if any value is invalid nothing is saved and the message says why."""
    return svc.put(db, changes)


@router.get("/storage", response_model=StorageOut, summary="Disk usage per category")
def storage() -> dict:
    return svc.storage()


@router.post(
    "/storage/clear",
    response_model=ClearOut,
    summary="Delete raw FITS, uploads or the views cache",
    responses={409: {"model": ErrorOut, "description": "code=job_running"}},
)
def clear(db: DbSession, body: ClearIn) -> dict:
    return svc.clear(db, body.target)


@router.get(
    "/backup",
    summary="Download a consistent SQLite backup",
    response_class=FileResponse,
    responses={200: {"content": {"application/octet-stream": {}}, "description": "SQLite database file"}},
)
def backup() -> FileResponse:
    path, name = svc.backup_file()
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=name,
        background=BackgroundTask(os.unlink, path),
    )
