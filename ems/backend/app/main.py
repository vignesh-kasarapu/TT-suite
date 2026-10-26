import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.controllers import (admin_controller, approvals_controller, auth_controller, claims_controller,
                             common_controller, delegations_controller, finance_controller, internal_controller)
from app.core.config import settings
from app.services import scheduler_service

logging.basicConfig(level=logging.INFO)
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(scheduler_service.loop(settings.scheduler_interval_minutes))
    yield
    task.cancel()


app = FastAPI(title="Expense Management System", lifespan=lifespan)


@app.middleware("http")
async def csrf_header(request: Request, call_next):
    """Sign-in is a cookie shared by the TT Suite, so every non-GET /api call must carry X-Requested-With: XHR
    (a cross-site form cannot set it)."""
    if (request.method not in SAFE_METHODS and request.url.path.startswith("/api/")
            and request.headers.get("x-requested-with") != "XHR"):
        return JSONResponse({"message": "Missing X-Requested-With: XHR header.", "code": "CSRF_HEADER_MISSING"}, status_code=403)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    """Errors always carry {message, errors?} so the UI can show a sentence, never a bare code.
    Suite errors add a `code` (e.g. NO_APP_ACCESS); internal routes answer {code, detail}."""
    detail = exc.detail
    body = detail if isinstance(detail, dict) else {"message": str(detail)}
    return JSONResponse(body, status_code=exc.status_code)


for router in (auth_controller.router, claims_controller.router, approvals_controller.router, delegations_controller.router,
               finance_controller.router, admin_controller.router, common_controller.router, internal_controller.router):
    app.include_router(router)


@app.get("/api/health")
def health():
    return {"ok": True}
