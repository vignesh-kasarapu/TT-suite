"""Who is calling. TT Suite sign-in (SUITE-CONTRACT 3.1): the portal's session cookie -> the suite
person -> their user here. There are no logins, passwords or tokens in this app any more; a
sign-out, a removed role or a deactivation in the portal takes effect on the next request."""
from __future__ import annotations

import json
from typing import Callable, Generator, Tuple

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from suite_core import identity
from suite_core.constants import session_cookie_name

from app.config import APP, settings
from app.database import SessionLocal
from app.models import User
from app.suite import service as suite
from app.suite.service import SuiteError

NO_ACCESS_MESSAGE = "You do not have access to the Resume Evaluator. Ask a global admin for access."


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yield a SQLAlchemy session; roll back on unhandled exceptions."""
    db: Session = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """401 UNAUTHENTICATED (no or expired suite session) sends the browser to the suite sign-in;
    403 NO_APP_ACCESS (no role here) to the dashboard."""
    who = identity.resolve(db, request.cookies.get(session_cookie_name(settings.app_profile)), APP)
    if who is None:
        raise SuiteError(401, "UNAUTHENTICATED", "Please sign in again.")
    user = suite.local_user(db, suite_user_id=who.user_id, email=who.email, name=who.name,
                            entra_oid=who.entra_oid, role=who.app_role)
    if user is None:
        raise SuiteError(403, suite.NO_APP_ACCESS, NO_ACCESS_MESSAGE)
    request.state.suite = who
    return user


STAFF_ROLES: Tuple[str, ...] = ("admin", "recruiter")


def require_staff(current_user: User = Depends(get_current_user)) -> User:
    """Raise 403 unless the authenticated user is a staff role.

    Every endpoint except the public share links is staff-facing; under the suite every
    signed-in user here holds one of the staff roles, so this is a safety net.
    """
    if current_user.role not in STAFF_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Staff access required",
        )
    return current_user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Raise 403 if the authenticated user does not have the ``admin`` role.

    Returns:
        The current user when they are an admin.
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


# ---------------------------------------------------------------------------
# Fine-grained RBAC helpers
# ---------------------------------------------------------------------------

# Roles ordered by privilege level (highest first)
_ROLE_HIERARCHY: list[str] = ["admin", "recruiter"]


def require_role(*allowed_roles: str) -> Callable:
    """Return a FastAPI dependency that raises 403 unless the user has one of the allowed roles.

    Usage::

        @router.get("/secret")
        def secret(user: User = Depends(require_role("admin", "recruiter"))):
            ...
    """
    allowed = set(allowed_roles)

    def _dep(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access requires one of roles: {', '.join(sorted(allowed))}",
            )
        return current_user

    return _dep


def require_permission(flag: str) -> Callable:
    """Return a FastAPI dependency that checks a fine-grained permission flag.

    Admins always pass.  For other roles, the ``User.permissions`` JSON column
    must contain ``{flag: true}``.

    Usage::

        @router.delete("/candidate/{id}")
        def delete_candidate(user: User = Depends(require_permission("can_delete"))):
            ...
    """
    def _dep(current_user: User = Depends(get_current_user)) -> User:
        # Admins have all permissions
        if current_user.role == "admin":
            return current_user

        perms: dict = {}
        if current_user.permissions:
            try:
                perms = json.loads(current_user.permissions)
            except (ValueError, TypeError):
                perms = {}

        if not perms.get(flag, False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {flag}",
            )
        return current_user

    return _dep
