"""Mirrors backend/src/services/roleAssignment.service.js.

TT Suite: every grant/revoke also mirrors the employee's effective suite role into
app.app_access (suite_access_service) in the same transaction — the role row and
the mirror are flushed first and committed together by the audit write."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, role_dao
from app.services import audit_service, suite_access_service

ALLOWED_ROLE_CODES = ("EMPLOYEE", "MANAGER", "HR_ADMIN")


def assign_role(db: Session, employee_id: int, role_code: str, actor_id: int | None) -> None:
    if role_code not in ALLOWED_ROLE_CODES:
        raise AppError("VALIDATION_ERROR", f"'{role_code}' is not a valid role.")
    role = role_dao.find_role_by_code(db, role_code)
    if role is None:
        raise AppError("VALIDATION_ERROR", f"Role '{role_code}' has not been seeded.", status=500)

    if role_dao.find_grant(db, employee_id, role.role_id) is not None:
        return  # idempotent — already held

    role_dao.create_grant(db, employee_id, role.role_id)
    _mirror(db, employee_id, actor_id)
    audit_service.record(  # commits the grant + mirror together
        db, action="ROLE_ASSIGNED", entity_type="employees", entity_id=f"{employee_id}:{role.role_id}",
        actor_id=actor_id, new_value={"role_code": role_code},
    )


def assert_can_revoke(db: Session, role_code: str) -> None:
    """The LAST_HR_ADMIN guard on its own, so callers that revoke as part of a larger
    change (deactivation, suite provisioning) can refuse before writing anything."""
    if role_code != "HR_ADMIN":
        return
    role = role_dao.find_role_by_code(db, role_code)
    if role is not None and role_dao.count_holders(db, role.role_id) <= 1:
        raise AppError("LAST_HR_ADMIN", "At least one HR/Admin must exist at all times.")


def revoke_role(db: Session, employee_id: int, role_code: str, actor_id: int | None) -> None:
    role = role_dao.find_role_by_code(db, role_code)
    if role is None:
        raise AppError("VALIDATION_ERROR", f"Role '{role_code}' has not been seeded.", status=500)

    if role_dao.find_grant(db, employee_id, role.role_id) is not None:
        assert_can_revoke(db, role_code)

    role_dao.delete_grant(db, employee_id, role.role_id)
    _mirror(db, employee_id, actor_id)
    audit_service.record(  # commits the revoke + mirror together
        db, action="ROLE_REVOKED", entity_type="employees", entity_id=f"{employee_id}:{role.role_id}",
        actor_id=actor_id, prior_value={"role_code": role_code},
    )


def list_roles_for_employee(db: Session, employee_id: int) -> list[str]:
    return role_dao.get_role_codes_for_employee(db, employee_id)


def _mirror(db: Session, employee_id: int, actor_id: int | None) -> None:
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is not None:
        suite_access_service.sync_employee(db, employee, actor_employee_id=actor_id)
