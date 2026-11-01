from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.core.casing_middleware import ClientCasingMiddleware
from app.core.config import settings
from app.core.db import engine
from app.core.exceptions import register_exception_handlers
from app.core.responses import ok


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.jobs import scheduler

    if settings.scheduler_enabled:
        scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(title="LMS 2.0 API (Python)", lifespan=lifespan)

# Phase 6 cutover shim (see casing.py) — added before CORS so CORS stays the
# outermost middleware (Starlette applies add_middleware calls LIFO: the last
# one added wraps everything else, including error responses).
app.add_middleware(ClientCasingMiddleware)

# Mirrors backend/src/app.js's cors({ origin: env.clientBaseUrl, credentials: true }) —
# the web app's axios client sends withCredentials:true, so this must be one explicit
# origin (not "*") for the session cookie to be accepted cross-origin in dev.
_cors_kwargs = dict(
    allow_origins=[settings.client_base_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
if not settings.is_production:
    # The mobile app's Expo web preview binds to whatever free localhost port
    # it finds (8081, 8090, ...) each run — regex-match any localhost origin
    # in dev instead of hardcoding one. Never applies in production.
    _cors_kwargs["allow_origin_regex"] = r"http://localhost:\d+"
app.add_middleware(CORSMiddleware, **_cors_kwargs)

register_exception_handlers(app)


@app.get("/api/health")
def health():
    db_ok = True
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return ok({"status": "ok" if db_ok else "degraded", "database": db_ok})


# Routers are added phase by phase (see MIGRATION_PLAN.md §4).
from app.routers import (  # noqa: E402
    attachments,
    auth,
    calendar_feed_public,
    config,
    delegations,
    employees,
    holiday_view,
    holidays,
    internal,
    jobs,
    ledger,
    leave_requests,
    leave_types,
    leave_years,
    notification_templates,
    notifications,
    org_structure,
    r3,
    reports,
    self_approval,
    working_patterns,
)

# TT Suite portal -> app contract (§3.2): on the app root, never under /api, so the
# gateway (which only proxies /lms/api/*) cannot expose it.
internal.register_internal_error_handler(app)
app.include_router(internal.router, prefix="/internal", tags=["internal"])

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(config.router, prefix="/api/config", tags=["config"])
app.include_router(employees.router, prefix="/api/employees", tags=["employees"])
app.include_router(leave_requests.router, prefix="/api/leave-requests", tags=["leave-requests"])
app.include_router(reports.router, prefix="/api/reports", tags=["reports"])
app.include_router(attachments.router, prefix="/api/attachments", tags=["attachments"])
app.include_router(ledger.router, prefix="/api/ledger", tags=["ledger"])
app.include_router(delegations.router, prefix="/api/delegations", tags=["delegations"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])
app.include_router(r3.router, prefix="/api/r3", tags=["r3"])
app.include_router(self_approval.router, prefix="/api/admin/self-approval-permissions", tags=["admin"])
# Deliberately mounted with no auth dependency — see calendar_feed_public.py.
app.include_router(calendar_feed_public.router, prefix="/api/calendar-feed", tags=["calendar-feed-public"])

# Everything below mirrors backend/src/routes/admin.routes.js — mounted at
# the same /api/admin base, every route HR_ADMIN-only.
app.include_router(org_structure.router, prefix="/api/admin", tags=["admin"])
app.include_router(leave_types.router, prefix="/api/admin", tags=["admin"])
app.include_router(leave_years.router, prefix="/api/admin", tags=["admin"])
app.include_router(holidays.router, prefix="/api/admin/holidays", tags=["admin"])
app.include_router(holiday_view.router, prefix="/api/holidays", tags=["holidays"])
app.include_router(working_patterns.router, prefix="/api/admin", tags=["admin"])
app.include_router(notification_templates.router, prefix="/api/admin/notification-templates", tags=["admin"])
app.include_router(jobs.router, prefix="/api/admin", tags=["admin"])
