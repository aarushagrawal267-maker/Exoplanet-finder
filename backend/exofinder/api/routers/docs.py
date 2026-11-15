"""Research documentation: ``/api/docs`` (Markdown pages from the repository's ``docs/``)."""

from __future__ import annotations

from fastapi import APIRouter

from exofinder.api.routers._sci_route import SciRoute
from exofinder.api.schemas.common import ErrorOut
from exofinder.api.schemas.settings import DocPage, DocPageSummary
from exofinder.services import docs_pages as svc

router = APIRouter(prefix="/api/docs", tags=["docs"], route_class=SciRoute)


@router.get("/pages", response_model=list[DocPageSummary], summary="Research documentation index")
def pages() -> list[dict]:
    return svc.list_pages()


@router.get(
    "/pages/{slug}",
    response_model=DocPage,
    summary="One documentation page (Markdown)",
    responses={404: {"model": ErrorOut, "description": "code=doc_not_found"}},
)
def page(slug: str) -> dict:
    return svc.get_page(slug)
