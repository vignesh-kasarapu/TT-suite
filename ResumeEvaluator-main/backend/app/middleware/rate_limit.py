"""Database-backed sliding-window rate limiter middleware.

Uses the ``rate_limit_hits`` table so that the rate limit is correctly
enforced across multiple Uvicorn workers (or containers) without requiring
an external Redis instance.

Upgrade path to Redis
---------------------
For deployments exceeding ~50 req/s, swap the ``_db_check_rate_limit`` function
for a Redis sorted-set implementation (e.g. using the ``limits`` library):

    pip install limits redis

Then replace the DB logic with::

    from limits import storage, strategies, parse
    _redis_store = storage.RedisStorage("redis://localhost:6379/0")
    _strategy  = strategies.MovingWindowRateLimiter(_redis_store)

This middleware interface stays the same; only the backend storage changes.
"""

from __future__ import annotations

import fnmatch
import logging
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, Tuple

from fastapi import Request, Response
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# Route-specific limits: (method, path_pattern, window_seconds, max_requests).
# path_pattern is matched with fnmatch (supports "*" wildcards) against the request
# path, so a dynamic segment like an evaluation ID can be matched with "/results/*/email".
# method is "*" to match any HTTP verb, or a specific verb — this matters because several
# patterns below would otherwise also catch an unrelated GET on the same path prefix
# (e.g. "/job-roles" is both the read-heavy list endpoint and, via POST, role creation).
_ROUTE_LIMITS: list[Tuple[str, str, int, int]] = [
    ("*",      "/auth/login",            60,   5),   # 5 login attempts per minute
    ("*",      "/auth/register",         60,   5),   # 5 registrations per minute
    ("*",      "/auth/forgot",           60,   3),   # 3 reset requests per minute
    ("*",      "/auth/reset-password",   60,  10),   # 10 reset-token submissions per minute
    ("*",      "/auth/change-password",  60,  10),   # 10 password-change attempts per minute
    ("*",      "/upload",                60,  30),   # 30 uploads per minute
    ("*",      "/candidate/apply",       60,  10),   # 10 self-applications per minute
    ("*",      "/candidate/verify-pan-card", 60, 10),  # 10 OCR calls per minute (compute cost)
    ("*",      "/share/view",            60,  20),   # 20 share-link views/votes per minute
    ("*",      "/skills/extract",        60,  15),   # 15 JD/skill LLM extractions per minute
    ("*",      "/admin/reclassify-experience-levels", 60, 5),  # 5 bulk reclassifies per minute
    ("*",      "/candidates/reparse-all", 60,  5),   # 5 bulk re-parses per minute (LLM cost)
    ("DELETE", "/candidates/*",          60,  20),   # candidate soft/hard delete
    ("POST",   "/candidates/bulk-delete", 60,  5),
    ("POST",   "/job-roles",             60,  10),   # create — exact match, doesn't catch GET "/job-roles"
    ("PUT",    "/job-roles/*",           60,  10),   # update
    ("DELETE", "/job-roles/*",           60,  10),   # delete
    ("POST",   "/results/bulk-delete",   60,   5),
    ("GET",    "/results/export/csv",    60,  10),   # candidate PII export
    ("POST",   "/results/*/email",       60,  20),   # per-candidate email send
    ("POST",   "/results/*/send-rejection", 60, 20),
]
_DEFAULT_LIMIT = (60, 300)         # 300 requests per minute for everything else


def _is_bypass_ip(ip: str) -> bool:
    """Return True if *ip* is in the configured rate-limit bypass list.

    Loopback addresses (127.0.0.1, ::1, etc.) are bypassed by default so that
    local development and QA runs are never blocked by per-route limits.
    """
    from app.config import settings  # late import avoids circular deps
    return ip in settings.rate_limit_bypass_ips_set


def _client_ip(request: Request) -> str:
    """Return client IP, trusting only headers our own nginx proxy sets.

    ``X-Real-IP`` is always overwritten by nginx to ``$remote_addr`` (the
    actual TCP peer), so a client-supplied value is discarded and cannot be
    forged. ``X-Forwarded-For`` is nginx's ``$proxy_add_x_forwarded_for``,
    which *appends* the real peer to any client-supplied value rather than
    replacing it — so the trustworthy entry is the last one, not the first.
    Trusting the first (client-controlled) hop let an attacker set an
    arbitrary ``X-Forwarded-For`` to get a fresh rate-limit bucket on every
    request.
    """
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _match_route(method: str, path: str) -> Tuple[str, int, int]:
    """Return (bucket_key, window_secs, max_req) for the given request method + path.

    Patterns are checked in declaration order and matched with fnmatch, so a
    pattern like ``/results/*/email`` catches a dynamic ID segment without
    also catching unrelated routes that merely share a path prefix.
    """
    for pattern_method, pattern, w, m in _ROUTE_LIMITS:
        if pattern_method != "*" and pattern_method != method:
            continue
        if path == pattern or path.startswith(pattern) or fnmatch.fnmatch(path, pattern):
            return f"{pattern_method}:{pattern}", w, m
    return "__default__", *_DEFAULT_LIMIT


def _db_check_rate_limit(ip: str, method: str, path: str, db: Session) -> Optional[JSONResponse]:
    """Sliding-window check using the ``rate_limit_hits`` PostgreSQL table.

    Returns a 429 JSONResponse if the limit is exceeded, else None.
    This function is multi-worker–safe because all workers share the same DB.
    """
    from app.models import RateLimitHit  # late import avoids circular deps at module load

    prefix, window_secs, max_req = _match_route(method, path)
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=window_secs)

    # Prune stale rows for this key (amortised cleanup — keeps table small)
    try:
        db.query(RateLimitHit).filter(
            RateLimitHit.ip == ip,
            RateLimitHit.path_prefix == prefix,
            RateLimitHit.hit_at < window_start,
        ).delete(synchronize_session=False)
        db.flush()
    except Exception as exc:
        logger.debug("Rate limit prune failed (non-fatal): %s", exc)

    # Count hits in the current window
    try:
        count = db.query(RateLimitHit).filter(
            RateLimitHit.ip == ip,
            RateLimitHit.path_prefix == prefix,
            RateLimitHit.hit_at >= window_start,
        ).count()
    except Exception:
        return None  # fail open — don't block traffic on DB errors

    if count >= max_req:
        retry_after = window_secs
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please slow down."},
            headers={"Retry-After": str(retry_after)},
        )

    # Record this hit
    try:
        db.add(RateLimitHit(ip=ip, path_prefix=prefix, hit_at=now))
        db.commit()
    except Exception as exc:
        logger.debug("Rate limit insert failed (non-fatal): %s", exc)
        try:
            db.rollback()
        except Exception:
            pass

    return None


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Apply sliding-window rate limiting to all API requests.

    Uses the database as the shared state store so that limits are correctly
    enforced when the application runs with multiple workers.

    IPs listed in ``settings.rate_limit_bypass_ips`` (default: loopback
    addresses) skip per-route strict limits entirely, allowing local QA and
    dev tooling to run without being throttled.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip health checks and static file serving
        path = request.url.path.removeprefix("/api/v1")  # the limits below are written without the prefix
        if path in ("/health", "/ready") or path.startswith("/uploads/") or request.url.path.startswith("/internal/"):
            return await call_next(request)

        ip = _client_ip(request)

        # Bypass strict per-route limits for trusted local / QA IPs
        if _is_bypass_ip(ip):
            return await call_next(request)

        # Open a short-lived DB session just for the rate-limit check
        try:
            from app.database import SessionLocal
            db = SessionLocal()
            try:
                rejection = _db_check_rate_limit(ip, request.method, path, db)
            finally:
                db.close()
        except Exception as exc:
            logger.warning("Rate limit middleware DB error (fail open): %s", exc)
            rejection = None

        if rejection is not None:
            return rejection

        return await call_next(request)
