"""Portal -> EMS: provision a person (POST /internal/provision), check access (POST /internal/authorize),
and self-heal a missing local user on first visit. Every change goes through admin_service.save_user,
so the EMS rules (role conflicts, leavers) hold and the mirror is written in the same transaction."""
import logging
import re

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session
from suite_core import identity
from suite_core.constants import is_valid_role
from suite_core.provision import AuthorizeRequest, AuthorizeResult, ProvisionRequest, ProvisionResult

from app.core.config import APP
from app.models import User
from app.models.enums import role_conflict
from app.schemas.user import UserIn
from app.services import admin_service, audit_service, suite_service

NO_APP_ACCESS = "NO_APP_ACCESS"
log = logging.getLogger("ems.provision")


def refuse(status: int, code: str, detail: str) -> HTTPException:
    return HTTPException(status, {"code": code, "detail": detail, "message": detail})


def placeholder_code(db: Session, email: str) -> str:
    """employee_code is required and unique. People added from the portal get one from their email
    (jane.doe@x.com -> JANE-DOE, then JANE-DOE-2...) until the EMS Admin sets the real code."""
    base = re.sub(r"[^A-Z0-9]+", "-", email.split("@")[0].upper()).strip("-")[:40] or "USER"
    code, n = base, 1
    while db.scalars(select(User.id).where(User.employee_code == code)).first():
        n += 1
        code = f"{base}-{n}"
    return code


def _form(user: User, **changes) -> UserIn:
    return UserIn(**{**{f: getattr(user, f) for f in admin_service.USER_FIELDS}, **changes})


#: Details the suite owns, as (EMS column, suite attribute). The person edits them once in
#: their suite profile and every app copies what it keeps. Bank details are NOT here: they
#: are Expense's own and are edited in Expense.
PERSONAL_FIELDS = (("designation", "job_title"), ("phone", "phone"), ("location", "location"))


def sync_personal_details(user: User, details: object | None) -> bool:
    """Copy the suite's personal details onto the EMS user. `details` carries the attributes
    in PERSONAL_FIELDS — a SuiteIdentity on a request, a ProvisionRequest on provisioning.
    An empty value means the person has not filled it in and never wipes what EMS holds."""
    changed = False
    for column, attribute in PERSONAL_FIELDS:
        value = getattr(details, attribute, None) if details is not None else None
        if not value:
            continue
        value = " ".join(str(value).split())
        if getattr(user, column, None) != value:
            setattr(user, column, value)
            changed = True
    return changed


def sync_from_suite(db: Session, user: User, *, email: str, name: str = "", details: object | None = None) -> bool:
    """Make the EMS user's email and name the suite's (the global admin can change both in the portal).
    Written straight onto the row, NOT through admin_service.save_user: save_user mirrors with
    old_email, which would revoke access for the old address and, since the suite person no longer has
    it, create a second suite person for it. An email another EMS user already has is left alone
    (logged). Does not commit. Returns True when something changed."""
    changed = False
    name = name.strip()
    if len(name) >= 2 and name != user.full_name:
        user.full_name = name
        changed = True
    email = email.strip().lower()
    if email and email != user.email:
        if db.scalars(select(User.id).where(User.email == email, User.id != user.id)).first():
            log.warning("EMS user %s: suite email %s already belongs to another EMS user; email not changed.",
                        user.id, email)
        else:
            audit_service.log(db, None, "USER_UPDATED", "user", user.id,
                              details={"old": {"email": user.email}, "new": {"email": email}, "source": "suite"})
            user.email = email
            changed = True
    if sync_personal_details(user, details):
        changed = True
    return changed


def provision(db: Session, req: ProvisionRequest) -> ProvisionResult:
    if not is_valid_role(APP, req.role):
        raise refuse(422, "UNKNOWN_ROLE", f"Expense has no role {req.role!r}.")
    email = req.email.strip().lower()
    user = suite_service.find_local(db, suite_user_id=req.suite_user_id, email=email)
    if user and sync_from_suite(db, user, email=email, name=req.name, details=req):
        db.flush()  # before save_user snapshots the user, so it sees no email change to revoke
    if user and user.email != email:
        raise refuse(409, "EMAIL_IN_USE", f"Another Expense user already has the email {email}.")
    actor = suite_service.find_local(db, suite_user_id=req.actor_id) if req.actor_id else None
    mirror_as = {"source": req.source, "suite_actor": req.actor_id, "entra_oid": req.entra_oid}

    if req.role is None:  # revoke: deactivate (a leaver) and drop the access row
        if user and user.is_active:
            admin_service.save_user(db, actor, _form(user, is_active=False), user.id, **mirror_as)
        else:
            identity.mirror_access(db, email=email, name=req.name, app=APP, role=None, source=req.source,
                                   actor=req.actor_id, entra_oid=req.entra_oid)
            db.commit()
        return ProvisionResult(local_user_id=str(user.id) if user else "", role=None)

    roles = suite_service.roles_for(req.role, user.roles if user else [])
    if problem := role_conflict(roles):
        raise refuse(409, "ROLE_CONFLICT", f"{problem} Change their Expense roles in Expense > Admin > Users first.")
    try:
        if user:
            data = _form(user, roles=roles, is_active=True)
        else:
            name = req.name.strip() if len(req.name.strip()) >= 2 else email.split("@")[0]
            data = UserIn(email=email, full_name=name, employee_code=placeholder_code(db, email), roles=roles)
    except ValidationError as e:
        raise refuse(422, "INVALID_USER", e.errors()[0]["msg"])
    user = admin_service.save_user(db, actor, data, user.id if user else None, **mirror_as)
    return ProvisionResult(local_user_id=str(user.id), role=suite_service.effective_role(user))


def local_user(db: Session, *, suite_user_id: str, email: str, name: str = "", entra_oid: str | None = None,
               role: str | None, details: object | None = None) -> User | None:
    """The EMS user for a suite person: by suite_user_id, then email; created from `role` when missing.
    The suite name and email win: when they differ from the local ones they replace them
    (an email another EMS user already has is left alone and logged)."""
    user = suite_service.find_local(db, suite_user_id=suite_user_id, email=email)
    if user:
        changed = user.suite_user_id != suite_user_id
        user.suite_user_id = suite_user_id
        if sync_from_suite(db, user, email=email, name=name, details=details):  # the suite's (portal /profile, global admin)
            changed = True
        if changed:
            db.commit()
        return user
    if role is None:
        return None
    try:
        provision(db, ProvisionRequest(email=email, name=name, entra_oid=entra_oid, role=role, source="global",
                                       suite_user_id=suite_user_id))
    except HTTPException:
        db.rollback()  # e.g. a parallel first request created them already
    return suite_service.find_local(db, suite_user_id=suite_user_id, email=email)


def authorize(db: Session, req: AuthorizeRequest) -> AuthorizeResult:
    role = identity.access_of(db, req.suite_user_id, APP)
    if role is None:
        return AuthorizeResult(allowed=False, code=NO_APP_ACCESS)
    user = local_user(db, suite_user_id=req.suite_user_id, email=req.email, name=req.name, entra_oid=req.entra_oid, role=role)
    if not user:
        return AuthorizeResult(allowed=False, code=NO_APP_ACCESS)
    if not user.is_active:
        return AuthorizeResult(allowed=False, code="LOCAL_USER_INACTIVE")
    return AuthorizeResult(allowed=True, role=suite_service.effective_role(user))
