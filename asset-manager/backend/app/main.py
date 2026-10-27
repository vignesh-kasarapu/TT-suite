import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.asset_requests.router import router as asset_requests_router
from app.assets.router import router as assets_router
from app.assignments.router import router as assignments_router
from app.auth.router import router as auth_router
from app.categories.router import router as categories_router
from app.common.config import settings
from app.common.exceptions import build_error_payload, register_exception_handlers
from app.maintenance.router import router as maintenance_router
from app.replacements.router import router as replacements_router
from app.reports.router import router as reports_router
from app.suite.router import router as suite_router
from app.users.router import router as users_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Enterprise Asset Management System API (FastAPI + PostgreSQL 17)",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)


@app.middleware("http")
async def csrf_header(request: Request, call_next):
    """TT Suite: sign-in is a cookie shared by every app, so each write to /api must carry
    X-Requested-With: XHR (a cross-site form cannot add it). /internal/* is token-guarded instead."""
    if (request.method not in ("GET", "HEAD", "OPTIONS") and request.url.path.startswith("/api/")
            and request.headers.get("x-requested-with") != "XHR"):
        body = build_error_payload(403, "Missing X-Requested-With: XHR header.") | {"code": "CSRF_HEADER_MISSING"}
        return JSONResponse(status_code=403, content=body)
    return await call_next(request)


app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
app.include_router(users_router, prefix=settings.API_V1_PREFIX)
app.include_router(categories_router, prefix=settings.API_V1_PREFIX)
app.include_router(assets_router, prefix=settings.API_V1_PREFIX)
app.include_router(assignments_router, prefix=settings.API_V1_PREFIX)
app.include_router(maintenance_router, prefix=settings.API_V1_PREFIX)
app.include_router(replacements_router, prefix=settings.API_V1_PREFIX)
app.include_router(asset_requests_router, prefix=settings.API_V1_PREFIX)
app.include_router(reports_router, prefix=settings.API_V1_PREFIX)
# Portal -> AMS (localhost only; never proxied by the gateway)
app.include_router(suite_router)


@app.get("/health", tags=["Health"])
@app.get(f"{settings.API_V1_PREFIX}/health", tags=["Health"], include_in_schema=False)
@app.get("/api/health", tags=["Health"], include_in_schema=False)  # the TT Suite portal checks this one
def health_check() -> dict[str, str]:
    return {"status": "healthy"}
