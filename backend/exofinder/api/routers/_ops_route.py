"""Route class and helpers shared by the operations routers (private: not auto-discovered).

Operations services raise :class:`~exofinder.services.ops_errors.OpsError` (they may not import
``api``); :class:`OpsRoute` turns it into :class:`~exofinder.api.errors.ApiError`, which the app's
error handler renders as ``{"detail", "code", "hint"}`` with the right status code.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session
from starlette.requests import Request
from starlette.responses import Response

from exofinder.api.deps import get_db
from exofinder.api.errors import ApiError
from exofinder.api.schemas.common import ErrorOut
from exofinder.services.ops_errors import OpsError

#: Request-scoped database session (``Annotated`` form, so no call appears in argument defaults).
DbSession = Annotated[Session, Depends(get_db)]


class OpsRoute(APIRoute):
    """APIRoute that maps ``OpsError`` to ``ApiError``."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def wrapped(request: Request) -> Response:
            try:
                return await handler(request)
            except OpsError as exc:
                raise ApiError(exc.status_code, exc.detail, exc.code, exc.hint) from exc

        return wrapped


def errors(*codes: tuple[int, str]) -> dict[int | str, dict[str, Any]]:
    """OpenAPI ``responses=`` entries for documented error codes, e.g. ``errors((404, "dataset_not_found"))``."""
    out: dict[int | str, dict[str, Any]] = {}
    for status, code in codes:
        entry = out.setdefault(status, {"model": ErrorOut, "description": ""})
        entry["description"] = ", ".join(x for x in (entry["description"], f"code={code}") if x)
    return out


def parse_ids(ids: str, what: str = "ids") -> list[int]:
    """Parse a comma-separated id list (``"1,2,3"``); raises a 400 ``OpsError`` on bad input."""
    out: list[int] = []
    for part in (ids or "").split(","):
        part = part.strip()
        if not part:
            continue
        if not part.isdigit():
            raise OpsError(
                400, f"Invalid {what}: {part!r} is not an integer id", "invalid_ids", "Use e.g. ?ids=1,2,3"
            )
        out.append(int(part))
    if not out:
        raise OpsError(400, f"No {what} given", "invalid_ids", "Use e.g. ?ids=1,2,3")
    return list(dict.fromkeys(out))
