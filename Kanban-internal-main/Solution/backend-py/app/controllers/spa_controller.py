"""SPA hosting: the built frontend (Solution/frontend/dist). Hashed assets are immutable;
index.html is never cached; /api/* (and the suite's /internal/*) never falls back to HTML
(TC-036)."""

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.exceptions.custom_exceptions import NotFoundException


def spa_router(static_dir: Path) -> APIRouter:
    root = static_dir.resolve()
    index = root / "index.html"
    router = APIRouter(include_in_schema=False)
    present = index.is_file()

    @router.get("/{path:path}")
    async def spa(path: str) -> FileResponse:
        if path.startswith(("api/", "internal/")) or path in ("api", "internal") or not present:
            raise NotFoundException()
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            immutable = (root / "assets") in candidate.parents
            cache = "public, max-age=31536000, immutable" if immutable else "no-cache"
            return FileResponse(candidate, headers={"Cache-Control": cache})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return router
