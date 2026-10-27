"""TT Suite sign-in (SUITE-CONTRACT 3.1): the portal's session cookie -> suite person -> their AMS user.

Sign-in happens only in the portal; AMS has no login, passwords or tokens of its own. Every
request resolves the shared cookie against app.session, so a sign-out, a deactivation or a
removed AMS role takes effect on the next request.
"""
from typing import Callable, Sequence

from fastapi import Depends, Request
from sqlalchemy.orm import Session
from suite_core import identity
from suite_core.constants import session_cookie_name

from app.common.config import APP, settings
from app.common.database import get_db
from app.common.enums import UserRole
from app.common.exceptions import ForbiddenException, UnauthorizedException
from app.suite import service as suite
from app.users.models import User

NO_ACCESS_MESSAGE = "You do not have access to Asset Management. Ask your administrator for access."


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """401 (no or expired session) sends the browser to the suite sign-in; 403 NO_APP_ACCESS to the
    dashboard. The AMS user is matched by suite_user_id, then email, and created if missing."""
    who = identity.resolve(db, request.cookies.get(session_cookie_name(settings.APP_PROFILE)), APP)
    if who is None:
        exc = UnauthorizedException("Please sign in again.")
        exc.code = "UNAUTHENTICATED"
        raise exc
    if who.app_role is None:
        raise _no_access()
    user = suite.local_user(db, suite_user_id=who.user_id, email=who.email, name=who.name,
                            entra_oid=who.entra_oid, role=who.app_role)
    if user is None or not user.active:
        raise _no_access()
    request.state.suite = who
    return user


def _no_access() -> ForbiddenException:
    exc = ForbiddenException(NO_ACCESS_MESSAGE)
    exc.code = suite.NO_APP_ACCESS
    return exc


def require_roles(*allowed_roles: UserRole) -> Callable[[User], User]:
    allowed_set: Sequence[UserRole] = tuple(allowed_roles)

    def role_dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_set:
            allowed_names = ", ".join(r.value for r in allowed_set)
            raise ForbiddenException(
                f"Access denied. Required role(s): {allowed_names}"
            )
        return current_user

    return role_dependency
