"""FastAPI application factory.

Routers are discovered automatically: every module in ``exofinder.api.routers`` that defines a
module-level ``router`` (an ``APIRouter`` whose prefix starts with ``/api``) is included.
"""

from __future__ import annotations

import importlib
import logging
import os
import pkgutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from exofinder import __version__
from exofinder.api.errors import ApiError, install_error_handlers
from exofinder.config import PIPELINE_VERSION, get_settings
from exofinder.db import init_db

log = logging.getLogger("exofinder")


def _include_routers(app: FastAPI) -> list[str]:
    import exofinder.api.routers as routers_pkg

    names = []
    for mod in sorted(pkgutil.iter_modules(routers_pkg.__path__), key=lambda m: m.name):
        if mod.name.startswith("_"):
            continue
        module = importlib.import_module(f"exofinder.api.routers.{mod.name}")
        router = getattr(module, "router", None)
        if router is not None:
            app.include_router(router)
            names.append(mod.name)
    return names


@asynccontextmanager
async def lifespan(app: FastAPI):
    from exofinder.jobs.runner import get_runner, mark_interrupted_jobs

    settings = get_settings()
    settings.ensure_dirs()
    init_db()
    n = mark_interrupted_jobs()
    if n:
        log.warning("Marked %d interrupted job(s) as failed", n)
    from exofinder.services.app_settings import apply_overrides

    apply_overrides()
    get_runner()
    yield
    get_runner().shutdown(wait=False)


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    # When the built frontend is served from this server (hosted deployment), the web app owns
    # ``/docs`` (its Research Docs page), so the interactive API documentation moves under ``/api``.
    docs_kwargs: dict = {}
    if _frontend_dist() is not None:
        docs_kwargs = {"docs_url": "/api/docs", "redoc_url": "/api/redoc", "openapi_url": "/api/openapi.json"}
    app = FastAPI(
        title="Exoplanet Finder API",
        version=__version__,
        description=(
            "AI-powered classification of NASA Kepler transit-like signals. Planet-like predictions are "
            "research leads, not confirmed discoveries."
        ),
        lifespan=lifespan,
        **docs_kwargs,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    @app.get("/api/health", tags=["system"])
    def health() -> dict:
        return {"status": "ok", "version": __version__, "pipeline_version": PIPELINE_VERSION}

    app.state.routers = _include_routers(app)
    _mount_frontend(app)
    return app


def _frontend_dist() -> Path | None:
    """The built frontend folder named by ``EXOF_FRONTEND_DIST``, if it contains an index.html."""
    dist = os.environ.get("EXOF_FRONTEND_DIST", "").strip()
    if not dist or not (Path(dist) / "index.html").is_file():
        return None
    return Path(dist).resolve()


def _mount_frontend(app: FastAPI) -> None:
    """Serve a built frontend (``EXOF_FRONTEND_DIST``) from the same server, e.g. for a hosted
    deployment. Unknown non-API paths fall back to index.html (client-side routing)."""
    from fastapi.responses import FileResponse

    root = _frontend_dist()
    if root is None:
        return

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise ApiError(404, f"Unknown API path /{full_path}", "not_found")
        candidate = (root / full_path).resolve()
        if full_path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(root / "index.html")


app = create_app()
