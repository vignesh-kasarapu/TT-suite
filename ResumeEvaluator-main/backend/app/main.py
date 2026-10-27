from __future__ import annotations

import logging
import logging.config
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import create_db_tables, fix_section_header_candidate_names
from app.middleware.rate_limit import RateLimitMiddleware
from app.routers import admin, analytics, audit, auth, candidates, comments, enrichment, evaluate, inbound_emails, interview_feedback, job_roles, manual_eval, notifications, onedrive, reports, results, sharepoint, shortlist, skills, upload
from app.routers import share
from app.suite import router as suite_router
from app.suite.service import SuiteError

# ---------------------------------------------------------------------------
# Structured logging setup (runs before anything else)
# ---------------------------------------------------------------------------

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "logging.Formatter",
            "fmt": '{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
            "datefmt": "%Y-%m-%dT%H:%M:%S",
        },
        "plain": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        },
    },
    "handlers": {
        "stdout": {
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
            "formatter": "json",
        },
    },
    "root": {
        "level": settings.log_level.upper(),
        "handlers": ["stdout"],
    },
})

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    # Validate config and warn about insecure defaults
    settings.validate_production()

    # Create DB tables (idempotent — Alembic handles migrations)
    create_db_tables()

    # One-time data fix: replace section-header strings stored as candidate names
    fix_section_header_candidate_names()

    # Merge duplicate candidates on startup
    try:
        from app.database import SessionLocal, merge_duplicate_candidates
        db = SessionLocal()
        try:
            merged = merge_duplicate_candidates(db)
            if merged > 0:
                logger.info("Startup cleanup: merged %d duplicate candidates", merged)
        finally:
            db.close()
    except Exception as exc:
        logger.error("Lifespan duplicate candidates merge failed: %s", exc)

    # Pre-warm spaCy model
    try:
        from app.services.confidence import _get_nlp
        _get_nlp()
    except Exception:
        pass

    # Pre-warm embedding model in a background thread if enabled and not on Render.
    # SentenceTransformer consumes significant RAM (200MB+ PyTorch + 90MB model)
    # which easily triggers Out-Of-Memory (OOM) kills on Render's 512MB free tier.
    if os.environ.get("PREWARM_EMBEDDING", "true").lower() == "true" and not os.environ.get("RENDER"):
        import threading

        def _warm_embedder() -> None:
            try:
                from app.services.embedder import embedder
                embedder.load(settings.embedding_model)
                logger.info("Embedding model '%s' ready", settings.embedding_model)
            except Exception as exc:
                logger.warning("Embedding model pre-warm failed (will lazy-load on first use): %s", exc)

        threading.Thread(target=_warm_embedder, daemon=True, name="embedder-warmup").start()
    else:
        logger.info("Embedding model pre-warming skipped to conserve memory")

    os.makedirs(settings.upload_dir, exist_ok=True)

    # Start IMAP ingestion worker (reads credentials from DB on each poll)
    from app.services.email_ingestion import start_email_ingestion_worker, stop_email_ingestion_worker
    start_email_ingestion_worker(poll_interval=settings.imap_poll_interval)

    # Start Microsoft Graph API ingestion worker (reads credentials from DB on each poll)
    from app.services.graph_ingestion import start_graph_ingestion_worker, stop_graph_ingestion_worker
    start_graph_ingestion_worker(poll_interval=settings.imap_poll_interval)

    # Start OneDrive ingestion worker (reads credentials + folder config from DB on each poll)
    from app.services.onedrive_ingestion import start_onedrive_ingestion_worker, stop_onedrive_ingestion_worker
    start_onedrive_ingestion_worker(poll_interval=settings.imap_poll_interval)

    logger.info("Application startup complete")
    yield

    stop_email_ingestion_worker()
    stop_graph_ingestion_worker()
    stop_onedrive_ingestion_worker()
    logger.info("Application shutdown complete")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="TekTalentScan API",
    version="1.0.0",
    description="AI-powered resume evaluation backend",
    lifespan=lifespan,
    # Disable docs in production by checking an env var
    docs_url=None if settings.app_profile == "prod" or os.getenv("ENABLE_DOCS", "true").lower() != "true" else "/docs",
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-Requested-With"],
)
app.add_middleware(RateLimitMiddleware)

# Public, signed-out POSTs: a share-link viewer's vote (the link's token is the credential).
_CSRF_EXEMPT = ("/api/v1/share/view/",)


@app.middleware("http")
async def csrf_header(request: Request, call_next):
    """TT Suite (Kanban TC-012): every non-GET API call carries X-Requested-With: XHR, which a
    cross-site form cannot send; the suite session cookie alone is never enough to write."""
    path = request.url.path
    if (request.method not in ("GET", "HEAD", "OPTIONS") and path.startswith("/api/")
            and not path.startswith(_CSRF_EXEMPT) and request.headers.get("x-requested-with") != "XHR"):
        return JSONResponse({"code": "CSRF_HEADER_MISSING", "detail": "Send X-Requested-With: XHR."}, status_code=403)
    return await call_next(request)


@app.exception_handler(SuiteError)
async def suite_error(_request: Request, exc: SuiteError) -> JSONResponse:
    return JSONResponse({"code": exc.code, "detail": exc.detail}, status_code=exc.status)


# ---------------------------------------------------------------------------
# API version header middleware
# ---------------------------------------------------------------------------

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse


class APIVersionHeaderMiddleware(BaseHTTPMiddleware):
    """Attach X-API-Version: 1 to every response so clients can detect the version."""
    async def dispatch(self, request: StarletteRequest, call_next) -> StarletteResponse:
        response = await call_next(request)
        response.headers["X-API-Version"] = "1"
        return response


app.add_middleware(APIVersionHeaderMiddleware)

# ---------------------------------------------------------------------------
# Routers — under /api/v1 only: the TT Suite gateway sends /resume/api/* here as /api/*.
# ---------------------------------------------------------------------------

from fastapi import APIRouter as _APIRouter
_v1 = _APIRouter(prefix="/api/v1")

_routers = [
    admin.router, audit.router, auth.router, candidates.router, comments.router,
    interview_feedback.router, upload.router, analytics.router, skills.router,
    job_roles.router, evaluate.router, results.router, shortlist.router,
    enrichment.router, inbound_emails.router, manual_eval.router, sharepoint.router,
    onedrive.router, share.router,
    notifications.router, reports.router,
]

for _r in _routers:
    _v1.include_router(_r)

# Public, unauthenticated report-share view — kept off `reports.router` since
# that router applies `require_staff` to every route it carries.
_v1.include_router(reports.public_router)

# Portal -> this app (localhost only; the gateway never proxies /internal/*).
app.include_router(suite_router.router)


# ---------------------------------------------------------------------------
# Health / readiness probes
# ---------------------------------------------------------------------------

@_v1.get("/health", tags=["ops"], include_in_schema=False)
def health_check() -> dict:
    """Liveness probe — returns 200 as long as the process is alive."""
    return {"status": "ok"}


@_v1.get("/ready", tags=["ops"], include_in_schema=False)
def readiness_check() -> dict:
    """Readiness probe — verifies DB connectivity and Tesseract OCR before accepting traffic."""
    from app.database import SessionLocal
    try:
        db = SessionLocal()
        db.execute(__import__("sqlalchemy").text("SELECT 1"))
        db.close()
    except Exception as exc:
        logger.error("Readiness check failed: %s", exc)
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Database not ready") from exc

    # Verify Tesseract binary is reachable (fail gracefully — OCR is non-critical)
    ocr_ok = False
    ocr_version = None
    try:
        import pytesseract
        ocr_version = pytesseract.get_tesseract_version()
        ocr_ok = True
    except Exception as exc:
        logger.warning("Tesseract OCR not available: %s", exc)

    return {"status": "ready", "ocr": {"ok": ocr_ok, "version": str(ocr_version) if ocr_version else None}}


# ---------------------------------------------------------------------------
# Email open tracking pixel
# ---------------------------------------------------------------------------

@_v1.get("/track/open/{token}", tags=["tracking"], include_in_schema=False)
def track_email_open(token: str):
    """Record the first time a candidate opens their shortlist email.

    Returns a 1×1 transparent GIF so the browser/email client has something
    to load without showing an error.
    """
    from fastapi.responses import Response
    from app.database import SessionLocal
    from app.models import Evaluation, _utcnow

    try:
        db = SessionLocal()
        ev = db.query(Evaluation).filter(Evaluation.email_tracking_token == token).first()
        if ev and ev.email_opened_at is None:
            ev.email_opened_at = _utcnow()
            db.commit()
            logger.info("Email opened: evaluation_id=%s", ev.id)
        db.close()
    except Exception as exc:
        logger.warning("Email open tracking failed for token %s: %s", token, exc)

    # 1×1 transparent GIF
    gif = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
    return Response(content=gif, media_type="image/gif",
                    headers={"Cache-Control": "no-cache, no-store, must-revalidate"})


app.include_router(_v1)  # last: after the health and tracking routes above are added to it
