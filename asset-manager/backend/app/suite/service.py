"""The TT Suite link: AMS roles <-> the suite role for app "ams", and the mirror into app.app_access.

Suite roles: employee (EMPLOYEE), manager (ASSET_MANAGER), admin (ADMIN). A deactivated user has none.
Only AMS writes its row in app.app_access, always in the same transaction as its own change
(SUITE-CONTRACT 3.3): UserService calls mirror() before it commits.
"""
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session
from suite_core import identity
from suite_core.constants import is_valid_role
from suite_core.provision import AuthorizeRequest, AuthorizeResult, ProvisionRequest, ProvisionResult

from app.common.config import APP
from app.common.enums import UserRole
from app.common.exceptions import AppException
from app.users.models import User

log = logging.getLogger("ams.suite")
NO_APP_ACCESS = "NO_APP_ACCESS"
LOCAL_ROLE: dict[str, UserRole] = {"employee": UserRole.EMPLOYEE, "manager": UserRole.ASSET_MANAGER, "admin": UserRole.ADMIN}
SUITE_ROLE: dict[UserRole, str] = {local: suite for suite, local in LOCAL_ROLE.items()}


def effective_role(user: User) -> str | None:
    return SUITE_ROLE[user.role] if user.active else None


def mirror(db: Session, user: User, *, source: str = "app", actor: str | None = None,
           entra_oid: str | None = None, old_email: str | None = None) -> str:
    """Write the user's suite role to app.app_access in the caller's transaction."""
    # Email changed here: the old address loses access. A change that came from the suite
    # (source "global") already moved the person's email, so there is no old address to revoke.
    if old_email and old_email != user.email and source != "global":
        identity.mirror_access(db, email=old_email, app=APP, role=None, source=source, actor=actor)
    uid = identity.mirror_access(db, email=user.email, name=user.name, app=APP, role=effective_role(user),
                                 source=source, actor=actor, entra_oid=entra_oid)
    user.suite_user_id = uid
    return uid


def find_local(db: Session, *, suite_user_id: str | None = None, email: str | None = None) -> User | None:
    user = None
    if suite_user_id:
        user = db.scalars(select(User).where(User.suite_user_id == suite_user_id)).first()
    if user is None and email:
        user = db.scalars(select(User).where(User.email == email.strip().lower())).first()
    return user


def refuse(status: int, code: str, message: str) -> AppException:
    return AppException(status, message, code=code)


def provision(db: Session, req: ProvisionRequest) -> ProvisionResult:
    """Portal -> AMS (POST /internal/provision). Every change goes through UserService, so the AMS
    rules hold (e.g. nobody holding assets is deactivated) and the mirror is in the same transaction."""
    from app.users.schemas import UserCreateRequest, UserUpdateRequest
    from app.users.service import UserService

    if not is_valid_role(APP, req.role):
        raise refuse(422, "UNKNOWN_ROLE", f"Asset Management has no role {req.role!r}.")
    email = req.email.strip().lower()
    users = UserService(db, source=req.source, actor=req.actor_id, entra_oid=req.entra_oid)
    # By the suite person first: a work email changed in the portal updates this user.
    user = find_local(db, suite_user_id=req.suite_user_id, email=email)

    if req.role is None:  # revoke: deactivate and drop the access row
        if user is not None and user.active:
            users.update_user(user.id, UserUpdateRequest(active=False))
        else:
            identity.mirror_access(db, email=email, name=req.name, app=APP, role=None, source=req.source,
                                   actor=req.actor_id, entra_oid=req.entra_oid)
            db.commit()
        return ProvisionResult(local_user_id=str(user.id) if user else "", role=None)

    role = LOCAL_ROLE[req.role]
    if user is not None:
        name = req.name.strip()
        users.update_user(user.id, UserUpdateRequest(
            role=role, active=True,
            email=email if email != user.email.lower() else None,
            name=name if name and name != user.name else None,
        ))
    else:
        name = req.name.strip() or email.split("@")[0]
        users.create_user(UserCreateRequest(name=name, email=email, role=role))
    user = find_local(db, email=email)
    assert user is not None
    return ProvisionResult(local_user_id=str(user.id), role=effective_role(user))


def local_user(db: Session, *, suite_user_id: str, email: str, name: str = "", entra_oid: str | None = None,
               role: str | None) -> User | None:
    """The AMS user for a suite person: by suite_user_id, then email; created from `role` when missing
    (self-heal, e.g. access granted while AMS was down). The name follows the suite: people edit it
    in the portal profile, so a different suite name replaces the local one."""
    user = find_local(db, suite_user_id=suite_user_id, email=email)
    if user is not None:
        changed = False
        if user.suite_user_id != suite_user_id:
            user.suite_user_id = suite_user_id
            changed = True
        suite_email = (email or "").strip().lower()
        if suite_email and suite_email != user.email.lower():  # the work email changed in the portal
            taken = find_local(db, email=suite_email)
            if taken is None:
                user.email = suite_email
                changed = True
            else:
                log.warning("AMS user %s: suite email %s is used by user %s; not changed", user.id, suite_email, taken.id)
        suite_name = (name or "").strip()
        if suite_name and suite_name != user.name:
            user.name = suite_name[:255]
            changed = True
        if changed:
            db.commit()
        return user
    if role is None:
        return None
    try:
        provision(db, ProvisionRequest(email=email, name=name, entra_oid=entra_oid, role=role, source="global"))
    except AppException:
        db.rollback()  # e.g. a parallel first request created them already
    return find_local(db, suite_user_id=suite_user_id, email=email)


def authorize(db: Session, req: AuthorizeRequest) -> AuthorizeResult:
    """Portal -> AMS (POST /internal/authorize), when the dashboard card is clicked."""
    role = identity.access_of(db, req.suite_user_id, APP)
    if role is None:
        return AuthorizeResult(allowed=False, code=NO_APP_ACCESS)
    user = local_user(db, suite_user_id=req.suite_user_id, email=req.email, name=req.name,
                      entra_oid=req.entra_oid, role=role)
    if user is None:
        return AuthorizeResult(allowed=False, code=NO_APP_ACCESS)
    if not user.active:
        return AuthorizeResult(allowed=False, code="LOCAL_USER_INACTIVE")
    return AuthorizeResult(allowed=True, role=effective_role(user))


def backfill(db: Session) -> int:
    """Boot: active AMS users not yet linked to the suite (an AMS database from before the suite)
    get their access mirrored, so nobody loses access at cutover. Inactive users are left out:
    they have no access to give. Returns how many were linked."""
    pending = db.scalars(select(User).where(User.suite_user_id.is_(None), User.active.is_(True))).all()
    for user in pending:
        mirror(db, user, source="app")
    db.commit()
    return len(pending)
