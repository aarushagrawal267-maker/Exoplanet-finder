"""Pydantic schemas shared by several routers."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

Provenance = Literal["catalogue", "measured", "estimate", "manual"]


class ErrorOut(BaseModel):
    detail: str
    code: str | None = None
    hint: str | None = None


class ProvenancedValue(BaseModel):
    """A scientific value plus where it came from."""

    value: float | None
    err: float | None = None
    unit: str = ""
    provenance: Provenance
    source: str = ""


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    title: str
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    progress: float
    message: str | None = None
    params: dict[str, Any] = {}
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    eta_s: float | None = None
    log_tail: str | None = None


class Page(BaseModel):
    total: int
    items: list[Any]
