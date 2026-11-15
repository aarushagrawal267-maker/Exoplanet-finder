"""Pydantic schemas shared by several routers."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict


def _as_utc(value: datetime) -> datetime:
    """Timestamps are stored as naive UTC; make them explicit so JSON carries the zone (``...Z``)."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


#: A datetime serialised with an explicit UTC offset (browsers would otherwise read it as local time).
UtcDatetime = Annotated[datetime, AfterValidator(_as_utc)]

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
    created_at: UtcDatetime
    started_at: UtcDatetime | None = None
    finished_at: UtcDatetime | None = None
    eta_s: float | None = None
    log_tail: str | None = None


class Page(BaseModel):
    total: int
    items: list[Any]
