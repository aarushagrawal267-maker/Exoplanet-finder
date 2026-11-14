"""Schemas for user uploads (``/api/uploads``)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ColumnMapping(BaseModel):
    """Which column holds each quantity (CSV). For FITS only ``flux`` is used (e.g. ``SAP_FLUX``)."""

    time: str | None = None
    flux: str | None = None
    flux_err: str | None = None
    quality: str | None = None


class ParsedInfo(BaseModel):
    mapping: dict[str, str | None] | None = None
    time_system: str | None = Field(None, description="Time system of the stored times (BKJD/BTJD/unknown)")
    input_time_system: str | None = Field(None, description="Time system the input was declared in")
    n_points: int
    time_span_days: float
    time_start: float | None = None
    time_end: float | None = None
    cadence_days: float | None = None
    mission: str | None = None
    kepid: int | None = None
    warnings: list[str] = []
    out_of_distribution: bool = False
    parsed_at: str | None = None


class UploadOut(BaseModel):
    upload_id: str
    filename: str
    kind: Literal["fits", "csv"]
    size_bytes: int
    n_rows: int
    columns: list[str] | None = Field(None, description="Table columns (CSV/text only)")
    suggested_mapping: dict[str, str | None] | None = Field(
        None, description="Suggested {time, flux, flux_err, quality} columns for the user to confirm"
    )
    suggested_time_system: str | None = None
    preview_rows: list[dict[str, Any]] = []
    meta: dict[str, Any] = Field(default_factory=dict, description="FITS header facts (mission, time system...)")
    parsed: ParsedInfo | None = None
    created_at: str | None = None


class ParseIn(BaseModel):
    mapping: ColumnMapping | None = None
    time_system: Literal["BKJD", "BJD", "BTJD", "other"] | None = Field(
        None,
        description=(
            "BKJD (Kepler, BJD-2454833), BJD (converted to BKJD), BTJD (TESS, BJD-2457000) or other "
            "(relative days). FITS files that declare BKJD/BTJD in their header keep it."
        ),
    )


class ParseOut(ParsedInfo):
    upload_id: str
