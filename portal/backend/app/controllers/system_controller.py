"""Health (App Service health check: one URL for all four processes) and the dev mailbox."""

import asyncio
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from suite_core.constants import is_active

from app.core.config import Settings
from app.core.deps import get_db, get_settings
from app.core.errors import AppError
from app.repositories.suite_repository import SuiteRepository

router = APIRouter(prefix="/api", tags=["system"])
HEALTH_PATHS = {"kanban": "/api/v1/health", "lms": "/api/health", "expense": "/api/health", "ams": "/api/health",
                "resume": "/api/v1/health"}


async def _probe(http: httpx.AsyncClient, url: str) -> str:
    try:
        res = await http.get(url, timeout=3)
        return "ok" if res.status_code < 400 else f"http {res.status_code}"
    except httpx.HTTPError as err:
        return type(err).__name__


@router.get("/health")
async def health(request: Request, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    """503 only when the database is down (App Service then recycles the site); an app that is
    restarting shows as degraded so one slow app never takes the others down with it."""
    settings: Settings = request.app.state.settings
    try:
        await db.execute(text("SELECT 1"))
        database = "ok"
    except Exception as err:  # noqa: BLE001
        database = type(err).__name__
    probed = {a: p for a, p in HEALTH_PATHS.items() if is_active(a)}  # skipped apps are not running
    apps = dict(zip(
        probed,
        await asyncio.gather(*(_probe(request.app.state.http, settings.app_url(a) + p) for a, p in probed.items())),
        strict=True,
    ))
    healthy = database == "ok" and all(v == "ok" for v in apps.values())
    body = {"status": "ok" if healthy else "degraded", "database": database, "services": {"portal": "ok", **apps}}
    return JSONResponse(body, status_code=200 if database == "ok" else 503)


@router.get("/dev/mail")
async def dev_mail(settings: Settings = Depends(get_settings), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Dev mailbox: the outbox as recorded (MAIL_PROVIDER=stub). Never in prod."""
    if settings.APP_PROFILE == "prod":
        raise AppError(404, "NOT_FOUND", "Not found.")
    return {"items": await SuiteRepository(db).recent_mail()}
