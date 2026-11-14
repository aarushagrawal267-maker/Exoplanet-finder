"""Route class shared by the science/interactive routers (private: not auto-discovered).

Services raise :class:`~exofinder.services.sci_errors.ServiceError` (they may not import ``api``);
this route class turns it into :class:`~exofinder.api.errors.ApiError`, which the app's error
handler renders as ``{"detail", "code", "hint"}`` with the right status code.
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
from exofinder.services.sci_errors import ServiceError


class SciRoute(APIRoute):
    """APIRoute that maps ``ServiceError`` to ``ApiError``."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def wrapped(request: Request) -> Response:
            try:
                return await handler(request)
            except ServiceError as exc:
                raise ApiError(exc.status_code, exc.detail, exc.code, exc.hint) from exc

        return wrapped


#: Database session dependency (``Annotated`` form, usable without a default value).
DbSession = Annotated[Session, Depends(get_db)]
