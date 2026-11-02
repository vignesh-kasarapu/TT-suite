from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from suite_core import identity
from suite_core.constants import session_cookie_name

from app.core.config import APP, settings
from app.core.db import get_db
from app.models import User
from app.services import provision_service
from app.services.provision_service import NO_APP_ACCESS


def no_access() -> HTTPException:
    return HTTPException(403, {"message": "You do not have access to Expenses. Ask your admin for access.", "code": NO_APP_ACCESS})


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """TT Suite sign-in (contract 3.1): the portal's session cookie -> suite person -> their EMS user.
    The EMS user is matched by suite_user_id, then email, and created from the suite role if missing."""
    who = identity.resolve(db, request.cookies.get(session_cookie_name(settings.app_profile)), APP)
    if who is None:
        raise HTTPException(401, {"message": "Please sign in again.", "code": "UNAUTHENTICATED"})
    if who.app_role is None:
        raise no_access()
    user = provision_service.local_user(db, suite_user_id=who.user_id, email=who.email, name=who.name,
                                        entra_oid=who.entra_oid, role=who.app_role, details=who)
    if not user or not user.is_active:
        raise no_access()
    request.state.suite = who
    return user


def require_role(role: str):
    def checker(user: User = Depends(current_user)) -> User:
        if role not in user.roles:
            raise HTTPException(403, "You do not have access to this.")
        return user

    return checker
