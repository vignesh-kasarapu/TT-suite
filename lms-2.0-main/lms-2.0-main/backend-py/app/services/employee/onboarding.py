"""Mirrors employee.service.js's onboardEmployee (LMS-010/012)."""
import re
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import AppError
from app.dao import employee_dao
from app.services import accrual_service, approval_routing_service, audit_service, notification_service, role_assignment_service
from app.services.employee.directory import resolve_department_id

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
# Accepts every code the TT Suite portal accepts (letters/digits with . _ / - inside):
# LMS uses the suite person's employee code as its own.
EMPLOYEE_CODE_RE = re.compile(r"^[-A-Za-z0-9_./]+$")
ALLOWED_ROLES = ("EMPLOYEE", "MANAGER", "HR_ADMIN")


def onboard_employee(db: Session, payload: dict, created_by: int | None, *, send_invite: bool = True):
    """`send_invite=False` skips EMPLOYEE_ONBOARDING_INVITE — used when the TT Suite
    portal provisions the person (source=global): the portal sends one suite invite.
    The role grant mirrors the new employee into app.app_access
    (role_assignment_service -> suite_access_service)."""
    required = [
        ("full_name", "Full name"),
        ("work_email", "Work email"),
        ("employee_code", "Employee code"),
        ("date_of_joining", "Date of joining"),
        ("designation", "Designation"),
    ]
    for field, label in required:
        if not str(payload.get(field) or "").strip():
            raise AppError("VALIDATION_ERROR", f"{label} is required.")

    if not EMAIL_RE.match(payload["work_email"].strip()):
        raise AppError("VALIDATION_ERROR", "Enter a valid work email address.")
    if not EMPLOYEE_CODE_RE.match(payload["employee_code"].strip()):
        raise AppError("VALIDATION_ERROR", "Employee code may contain only letters, numbers, hyphens, underscores, dots and slashes.")
    try:
        datetime.strptime(str(payload["date_of_joining"]), "%Y-%m-%d")
    except ValueError as exc:
        raise AppError("VALIDATION_ERROR", "Enter a valid date of joining.") from exc

    role_code = payload.get("role_code") or "EMPLOYEE"
    if role_code not in ALLOWED_ROLES:
        raise AppError("VALIDATION_ERROR", "Select a valid assigned role.")

    department_id = payload.get("department_id")
    department_name = payload.get("department_name")
    if not department_id and not (department_name or "").strip():
        raise AppError("VALIDATION_ERROR", "Department is required.")

    reporting_manager_id = payload.get("reporting_manager_id")
    if reporting_manager_id and approval_routing_service.would_create_circular_hierarchy(db, None, reporting_manager_id):
        raise AppError("CIRCULAR_HIERARCHY", "This reporting relationship would be circular.")

    if (department_name or "").strip():
        department_id = resolve_department_id(db, department_name)

    employee = employee_dao.create(
        db,
        entra_oid=payload.get("entra_oid"),
        work_email=payload["work_email"].strip().lower(),
        employee_code=payload["employee_code"],
        first_name=payload["full_name"].split(" ")[0],
        last_name=" ".join(payload["full_name"].split(" ")[1:]) or None,
        date_of_joining=payload["date_of_joining"],
        department_id=department_id,
        grade_id=payload.get("grade_id"),
        management_level_id=payload.get("management_level_id"),
        region_id=payload.get("region_id"),
        gender=payload.get("gender"),
        marital_status=payload.get("marital_status"),
        designation=payload["designation"],
        reporting_manager_id=reporting_manager_id,
    )

    role_assignment_service.assign_role(db, employee.employee_id, role_code, created_by)
    audit_service.record(
        db, action="EMPLOYEE_CREATED", entity_type="employees", entity_id=employee.employee_id,
        actor_id=created_by, new_value=payload,
    )

    # BR-13-15: pro-rata opening entitlement, posted automatically on onboarding.
    accrual_service.post_opening_pro_rata(db, employee.employee_id)
    if send_invite:
        notification_service.notify(
            db, recipient_id=employee.employee_id, template_key="EMPLOYEE_ONBOARDING_INVITE",
            tokens={"fullName": employee.full_name, "signInUrl": f"{settings.link_base_url}/"},
        )
    db.commit()
    return employee
