"""Downloadable research reports: ``/api/reports``."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import Response

from exofinder.api.routers._ops_route import DbSession, OpsRoute, errors, parse_ids
from exofinder.services import reports as svc

router = APIRouter(prefix="/api/reports", tags=["reports"], route_class=OpsRoute)

_CONTENT = {
    200: {
        "description": "The report file (attachment)",
        "content": {"text/markdown": {}, "text/html": {}, "application/json": {}},
    }
}


def _attachment(content: bytes, media_type: str, filename: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/experiments/{experiment_id}",
    summary="Experiment report (Markdown, HTML or JSON)",
    response_class=Response,
    responses={**_CONTENT, **errors((404, "experiment_not_found"))},
)
def experiment_report(
    db: DbSession, experiment_id: int, format: Literal["md", "html", "json"] = Query("md")
) -> Response:
    """Data provenance (catalogue snapshot ids and SHA-256), dataset and split sizes, configuration,
    training-curve summary, validation and test metrics with 95 % CIs, confusion matrix, calibration,
    threshold, timing, environment and limitations. Sections without data say so explicitly. HTML is
    self-contained (inline CSS, no external requests)."""
    return _attachment(*svc.experiment_report(db, experiment_id, format))


@router.get(
    "/comparison",
    summary="Comparison report of several experiments",
    response_class=Response,
    responses={**_CONTENT, **errors((400, "invalid_ids"), (404, "experiment_not_found"))},
)
def comparison_report(
    db: DbSession,
    ids: str = Query(..., description="Comma-separated experiment ids (at least two)"),
    format: Literal["md", "html", "json"] = Query("md"),
) -> Response:
    return _attachment(*svc.comparison_report(db, parse_ids(ids, "experiment ids"), format))
