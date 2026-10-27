"""The TT Suite link: the Resume Evaluator's users <-> the suite role for app "resume".

Suite roles are the local roles: recruiter and admin. Roles are central (SUITE-CONTRACT 3.3): only a
global admin gives or changes them, in the portal, which calls /internal/provision here. This app
never grants access itself, so - unlike the other apps - there is no boot backfill: nobody gets in
until a global admin says so.
"""
from __future__ import annotations

import logging

from sqlalchemy import func
from sqlalchemy.orm import Session
from suite_core import identity
from suite_core.constants import is_valid_role
from suite_core.provision import AuthorizeRequest, AuthorizeResult, ProvisionRequest, ProvisionResult

from app.config import APP
from app.models import User

log = logging.getLogger(__name__)
NO_APP_ACCESS = "NO_APP_ACCESS"
ROLES = ("recruiter", "admin")


class SuiteError(Exception):
    """Answered as {code, detail} (the shape the portal and the suite frontends read)."""

    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail


def effective_role(user: User) -> str | None:
    return user.role if user.is_active and user.role in ROLES else None


def find_local(db: Session, *, suite_user_id: str | None = None, email: str | None = None) -> User | None:
    user = None
    if suite_user_id:
        user = db.query(User).filter(User.suite_user_id == suite_user_id).first()
    if user is None and email:
        user = db.query(User).filter(func.lower(User.email) == email.strip().lower()).first()
    return user


def provision(db: Session, req: ProvisionRequest) -> ProvisionResult:
    """Portal -> here (POST /internal/provision): give, change or remove a person's role."""
    if not is_valid_role(APP, req.role):
        raise SuiteError(422, "UNKNOWN_ROLE", f"Resume Evaluator has no role {req.role!r}.")
    email = req.email.strip().lower()
    # By the suite person first: a work email changed in the portal updates this user.
    user = find_local(db, suite_user_id=req.suite_user_id, email=email)

    if req.role is None:
        if user is not None:
            user.is_active = False
        uid = identity.mirror_access(db, email=email, name=req.name, app=APP, role=None, source=req.source,
                                     actor=req.actor_id, entra_oid=req.entra_oid)
        if user is not None:
            user.suite_user_id = uid
        db.commit()
        return ProvisionResult(local_user_id=str(user.id) if user else "", role=None)

    if user is None:
        user = User(email=email, role=req.role, is_active=True)
        db.add(user)
    elif user.email.lower() != email and find_local(db, email=email) is None:
        user.email = email
    user.role = req.role
    user.is_active = True
    if req.name.strip():
        user.name = req.name.strip()[:255]
    db.flush()
    user.suite_user_id = identity.mirror_access(db, email=email, name=req.name, app=APP, role=req.role,
                                                source=req.source, actor=req.actor_id, entra_oid=req.entra_oid)
    db.commit()
    return ProvisionResult(local_user_id=str(user.id), role=effective_role(user))


def local_user(db: Session, *, suite_user_id: str, email: str, name: str = "", entra_oid: str | None = None,
               role: str | None) -> User | None:
    """This app's user for a suite person: by suite_user_id, then email. The role and name follow
    the suite (people edit their name in the portal profile; roles are given there); a person
    the suite gave a role while this app was down is created here (self-heal)."""
    if role is None:
        return None
    user = find_local(db, suite_user_id=suite_user_id, email=email)
    if user is None:
        try:
            provision(db, ProvisionRequest(email=email, name=name, entra_oid=entra_oid, role=role, source="global"))
        except SuiteError:
            db.rollback()  # e.g. a parallel first request created them already
        return find_local(db, suite_user_id=suite_user_id, email=email)
    changed = False
    for attr, value in (("suite_user_id", suite_user_id), ("role", role), ("is_active", True)):
        if getattr(user, attr) != value:
            setattr(user, attr, value)
            changed = True
    suite_name = (name or "").strip()[:255]
    if suite_name and suite_name != user.name:
        user.name = suite_name
        changed = True
    suite_email = (email or "").strip().lower()
    if suite_email and suite_email != user.email.lower():  # the work email changed in the portal
        taken = find_local(db, email=suite_email)
        if taken is None:
            user.email = suite_email
            changed = True
        else:
            log.warning("user %s: suite email %s is used by user %s; not changed", user.id, suite_email, taken.id)
    if changed:
        db.commit()
    return user


def authorize(db: Session, req: AuthorizeRequest) -> AuthorizeResult:
    """Portal -> here (POST /internal/authorize), when the dashboard card is clicked."""
    role = identity.access_of(db, req.suite_user_id, APP)
    if role is None:
        return AuthorizeResult(allowed=False, code=NO_APP_ACCESS)
    user = local_user(db, suite_user_id=req.suite_user_id, email=req.email, name=req.name,
                      entra_oid=req.entra_oid, role=role)
    if user is None:
        return AuthorizeResult(allowed=False, code=NO_APP_ACCESS)
    return AuthorizeResult(allowed=True, role=effective_role(user))
