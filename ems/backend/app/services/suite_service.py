"""The TT Suite link: EMS roles <-> the suite role for app "expense", and the mirror into app.app_access.

Suite roles: member (no EMS role), approver (Manager), finance (Finance Reviewer), admin.
Effective role = the highest EMS role held: ADMIN > FINANCE > APPROVER > member; a deactivated user has none.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session
from suite_core import identity

from app.core.config import APP
from app.models import User
from app.models.enums import Role

# Suite role -> the EMS role it stands for (member = an employee with no role)
LOCAL_ROLE: dict[str, str | None] = {"member": None, "approver": Role.APPROVER, "finance": Role.FINANCE, "admin": Role.ADMIN}
RANK = {Role.APPROVER: 1, Role.FINANCE: 2, Role.ADMIN: 3}


def effective_role(user: User) -> str | None:
    if not user.is_active:
        return None
    roles = user.roles or []
    if Role.ADMIN in roles:
        return "admin"
    if Role.FINANCE in roles:
        return "finance"
    if Role.APPROVER in roles:
        return "approver"
    return "member"


def roles_for(suite_role: str, current: list[str]) -> list[str]:
    """EMS roles after the portal grants `suite_role`: the matching role plus any role the person already
    holds that ranks below it (so admin keeps Finance Reviewer). The result can break role_conflict
    (e.g. a Manager made admin); the caller refuses that."""
    top = LOCAL_ROLE[suite_role]
    if top is None:
        return []
    keep = [r for r in current if r in RANK and RANK[r] < RANK[top]]
    return [top, *keep]


def mirror(db: Session, user: User, *, source: str = "app", actor: str | None = None,
           entra_oid: str | None = None, old_email: str | None = None) -> str:
    """Write the user's effective role to app.app_access in the caller's transaction."""
    if old_email and old_email != user.email:  # email changed: the old address loses access
        identity.mirror_access(db, email=old_email, app=APP, role=None, source=source, actor=actor)
    uid = identity.mirror_access(db, email=user.email, name=user.full_name, app=APP, role=effective_role(user),
                                 source=source, actor=actor, entra_oid=entra_oid)
    user.suite_user_id = uid
    return uid


def find_local(db: Session, *, suite_user_id: str | None = None, email: str | None = None) -> User | None:
    user = None
    if suite_user_id:
        user = db.scalars(select(User).where(User.suite_user_id == suite_user_id)).first()
    if not user and email:
        user = db.scalars(select(User).where(User.email == email.strip().lower())).first()
    return user
