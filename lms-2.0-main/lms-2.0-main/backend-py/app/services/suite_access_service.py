"""TT Suite access mirror (suite contract §3.3): keeps `app.app_access` (app='lms') in
step with LMS's own employee/role state, inside the caller's transaction.

Effective suite role of an employee:
    deactivated -> None;  HR_ADMIN -> 'admin';  MANAGER -> 'manager';  else 'employee'.

Services call `sync_employee(db, employee)` right after a local change and before the
commit that persists it, so the change and its mirror commit together. Who is acting
and whether the change came from the portal is carried by `mirror_context(...)` — the
portal's /internal/provision sets source='global'; everything else defaults to
source='app' with the acting employee's suite id.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session
from suite_core import identity

from app.dao import employee_dao, role_dao
from app.models.employee import Employee

APP = "lms"

# Local role grants for each suite role. EMPLOYEE is implicit for every employee
# (role_dao.get_role_codes_for_employee) but onboarding also grants it explicitly,
# so provisioning does the same.
SUITE_ROLE_TO_LOCAL: dict[str, tuple[str, ...]] = {
    "employee": ("EMPLOYEE",),
    "manager": ("EMPLOYEE", "MANAGER"),
    "admin": ("EMPLOYEE", "HR_ADMIN"),
}


@dataclass(frozen=True)
class _MirrorContext:
    source: str = "app"
    actor_suite_id: str | None = None
    suppress: bool = False


_context: ContextVar[_MirrorContext | None] = ContextVar("lms_suite_mirror_context", default=None)


@contextmanager
def mirror_context(*, source: str = "app", actor_suite_id: str | None = None, suppress: bool = False):
    """Within the block, every sync_employee call mirrors with this source/actor.
    `suppress=True` skips mirroring entirely (self-heal from an existing access row)."""
    token = _context.set(_MirrorContext(source=source, actor_suite_id=actor_suite_id, suppress=suppress))
    try:
        yield
    finally:
        _context.reset(token)


def effective_role_from_codes(role_codes: list[str] | set[str], is_active: bool) -> str | None:
    if not is_active:
        return None
    if "HR_ADMIN" in role_codes:
        return "admin"
    if "MANAGER" in role_codes:
        return "manager"
    return "employee"


def effective_role(db: Session, employee: Employee) -> str | None:
    db.flush()
    return effective_role_from_codes(role_dao.get_role_codes_for_employee(db, employee.employee_id), bool(employee.is_active))


def actor_suite_id(db: Session, actor_employee_id: int | None) -> str | None:
    if not actor_employee_id:
        return None
    actor = employee_dao.find_by_id(db, actor_employee_id)
    return actor.suite_user_id if actor is not None else None


def sync_employee(db: Session, employee: Employee, *, actor_employee_id: int | None = None) -> str | None:
    """Mirror `employee`'s effective role into app.app_access (no commit). Returns the
    suite user id (also stored on employee.suite_user_id), or None when suppressed."""
    ctx = _context.get() or _MirrorContext()
    if ctx.suppress:
        return None
    actor = ctx.actor_suite_id if ctx.actor_suite_id is not None else actor_suite_id(db, actor_employee_id)
    suite_id = identity.mirror_access(
        db,
        email=employee.work_email,
        name=employee.full_name if (employee.first_name or employee.last_name) else "",
        app=APP,
        role=effective_role(db, employee),
        source=ctx.source,
        actor=actor,
    )
    if employee.suite_user_id != suite_id:
        employee.suite_user_id = suite_id
        db.flush()
    return suite_id


def revoke_email(db: Session, email: str, *, actor_employee_id: int | None = None) -> None:
    """Remove LMS access from the suite person with `email` (no commit)."""
    ctx = _context.get() or _MirrorContext()
    if ctx.suppress or not email:
        return
    exists = db.execute(
        text("SELECT 1 FROM app.users WHERE email = :email"), {"email": email.strip().lower()}
    ).first()
    if exists is None:
        return  # never create a suite person just to record "no access"
    actor = ctx.actor_suite_id if ctx.actor_suite_id is not None else actor_suite_id(db, actor_employee_id)
    identity.mirror_access(db, email=email, app=APP, role=None, source=ctx.source, actor=actor)


def sync_employee_id(db: Session, employee_id: int, *, actor_employee_id: int | None = None) -> str | None:
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        return None
    return sync_employee(db, employee, actor_employee_id=actor_employee_id)


def sync_all(db: Session) -> int:
    """Backfill: mirror every employee (seed scripts / one-off repair). No commit."""
    count = 0
    for employee in employee_dao.list_all(db):
        sync_employee(db, employee)
        count += 1
    return count
