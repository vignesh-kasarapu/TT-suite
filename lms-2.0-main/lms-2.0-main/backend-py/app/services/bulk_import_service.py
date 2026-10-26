"""Mirrors backend/src/services/bulkImport.service.js (LMS-019).

KNOWN LIMITATION vs. Node: Node wraps the whole import in one DB transaction,
so a circular-hierarchy failure partway through the manager-wiring pass rolls
back every employee created in the same batch. Several DAOs this service
depends on (employee_dao.create, role_dao.create_grant via
role_assignment_service, scheduled_job_run_dao.create via
accrual_service.post_opening_pro_rata) commit eagerly rather than only
flushing, so a failure on the LAST row's manager-wiring will NOT undo the
employee rows already committed for earlier rows in this same call. The
per-row validation pass below (which is read-only and runs to completion
before anything is created) is what actually prevents most bad imports;
only a circular-hierarchy failure discovered during the second pass can
leave a partial import committed. Flagged here rather than silently
pretending this port has the same atomicity guarantee as Node."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, org_structure_dao
from app.services import accrual_service, approval_routing_service, audit_service, role_assignment_service
from app.services.employee.directory import resolve_department_id

REQUIRED_FIELDS = ("full_name", "work_email", "employee_code", "date_of_joining", "designation")
ALLOWED_ROLES = ("EMPLOYEE", "MANAGER", "HR_ADMIN")
ALLOWED_GENDERS = ("MALE", "FEMALE")


def validate_rows(db: Session, rows: list[dict]) -> list[dict]:
    """LMS-019: validates every row first and produces a per-row error
    report. The whole file is accepted or rejected as a unit."""
    errors = []
    seen_codes: set[str] = set()
    seen_emails: set[str] = set()

    for i, row in enumerate(rows):
        row_number = i + 2  # header is row 1
        row_errors = []

        for field in REQUIRED_FIELDS:
            if not str(row.get(field) or "").strip():
                row_errors.append(f"Missing {field}")

        code = row.get("employee_code")
        if code:
            if code.strip().lower() in seen_codes:
                row_errors.append(f"Duplicate employee code within file: {code}")
            seen_codes.add(code.strip().lower())
            if employee_dao.find_by_employee_code(db, code) is not None:
                row_errors.append(f"Employee code already exists: {code}")

        email = row.get("work_email")
        if email:
            if email.strip().lower() in seen_emails:
                row_errors.append(f"Duplicate work email within file: {email}")
            seen_emails.add(email.strip().lower())
            if employee_dao.find_by_work_email(db, email) is not None:
                row_errors.append(f"Work email already exists: {email}")

        role_code = (row.get("role_code") or "").strip().upper()
        if role_code and role_code not in ALLOWED_ROLES:
            row_errors.append(f"Unknown role_code: {row['role_code']} (use one of {', '.join(ALLOWED_ROLES)})")

        gender = (row.get("gender") or "").strip().upper()
        if gender and gender not in ALLOWED_GENDERS:
            row_errors.append(f"Unknown gender: {row['gender']} (use MALE or FEMALE, or leave blank)")

        level_code = (row.get("management_level_code") or "").strip()
        if level_code and org_structure_dao.find_management_level_by_code(db, level_code) is None:
            row_errors.append(f"Management level code not found: {level_code}")
        # The create form only offers a management level once the role is above EMPLOYEE.
        # An import that quietly accepted one would produce people the single-employee
        # screen could never have created.
        if level_code and role_code in ("", "EMPLOYEE"):
            row_errors.append(
                "management_level_code applies to managers only — set role_code to MANAGER or HR_ADMIN, or leave the level blank"
            )

        region_code = (row.get("region_code") or "").strip()
        if region_code and org_structure_dao.find_region_by_code(db, region_code) is None:
            row_errors.append(f"Region code not found: {region_code}")

        manager_code = row.get("reporting_manager_code")
        if manager_code:
            manager = employee_dao.find_by_employee_code(db, manager_code)
            manager_in_file = any(r.get("employee_code") == manager_code for r in rows)
            if manager is None and not manager_in_file:
                row_errors.append(f"Reporting manager code not found: {manager_code}")
            elif code and _would_cycle(db, rows, code):
                row_errors.append(
                    f"Reporting manager {manager_code} would create a circular reporting chain"
                )

        if row_errors:
            errors.append({"row": row_number, "employee_code": code or "(missing)", "errors": row_errors})

    return errors


def _manager_code_of(db: Session, file_managers: dict, code: str):
    """The manager code for `code`, looking at this file first and the database second.
    Returns (known, manager_code) so "not a real employee" is distinguishable from
    "an employee with no manager"."""
    if code in file_managers:
        return True, (file_managers[code] or None)
    employee = employee_dao.find_by_employee_code(db, code)
    if employee is None:
        return False, None
    if not employee.reporting_manager_id:
        return True, None
    manager = employee_dao.find_by_id(db, employee.reporting_manager_id)
    return True, (manager.employee_code if manager else None)


def _would_cycle(db: Session, rows: list[dict], code: str) -> bool:
    """Walks the reporting chain upward from `code`, treating the file's own rows as
    already applied.

    This has to happen during validation, not while wiring managers up afterwards. The
    DAOs underneath commit eagerly, so a cycle discovered in the second pass left the
    employee rows already written while the caller was told the import had been rolled
    back — a 400 that lied, and a half-configured employee left behind.
    """
    file_managers = {r["employee_code"]: r.get("reporting_manager_code") for r in rows if r.get("employee_code")}
    seen: set[str] = set()
    current = code
    while current:
        if current in seen:
            return True
        seen.add(current)
        known, nxt = _manager_code_of(db, file_managers, current)
        if not known:
            return False  # unknown code: already reported as its own error
        current = nxt
    return False


def import_employees(db: Session, rows: list[dict], actor_id: int) -> dict:
    errors = validate_rows(db, rows)
    if errors:
        return {"committed": False, "errors": errors, "imported_count": 0}

    code_to_id: dict[str, int] = {}
    # First pass: create every row with no manager, so later rows can
    # reference earlier ones in the same file regardless of order.
    for row in rows:
        full_name = row["full_name"].strip()

        # Departments are find-or-create by name, exactly as the single-employee form does,
        # so an import does not silently drop people into no department.
        department_name = (row.get("department_name") or "").strip()
        department_id = resolve_department_id(db, department_name) if department_name else None

        level_code = (row.get("management_level_code") or "").strip()
        level = org_structure_dao.find_management_level_by_code(db, level_code) if level_code else None

        region_code = (row.get("region_code") or "").strip()
        region = org_structure_dao.find_region_by_code(db, region_code) if region_code else None

        employee = employee_dao.create(
            db, entra_oid=row.get("entra_oid") or None, work_email=row["work_email"].strip().lower(),
            employee_code=row["employee_code"],
            first_name=full_name.split(" ")[0], last_name=" ".join(full_name.split(" ")[1:]) or None,
            date_of_joining=row["date_of_joining"], designation=row["designation"],
            department_id=department_id,
            management_level_id=level.management_level_id if level else None,
            region_id=region.region_id if region else None,
            gender=(row.get("gender") or "").strip().upper() or None,
            marital_status=(row.get("marital_status") or "").strip() or None,
        )
        code_to_id[row["employee_code"]] = employee.employee_id

        # Same baseline treatment single onboarding gives: opening pro-rata credit plus a
        # role grant, defaulting to EMPLOYEE when the file does not say. Deliberately NOT
        # sending the onboarding-invite notification — per-row would spam a large batch.
        # The role grant also mirrors the employee into app.app_access (TT Suite §3.3).
        accrual_service.post_opening_pro_rata(db, employee.employee_id)
        role_assignment_service.assign_role(
            db, employee.employee_id, (row.get("role_code") or "EMPLOYEE").strip().upper(), actor_id
        )

    # Second pass: wire up reporting managers now that every code has an id.
    for row in rows:
        manager_code = row.get("reporting_manager_code")
        if not manager_code:
            continue
        manager_id = code_to_id.get(manager_code)
        if manager_id is None:
            manager = employee_dao.find_by_employee_code(db, manager_code)
            manager_id = manager.employee_id if manager else None
        if manager_id is None:
            continue

        employee_id = code_to_id[row["employee_code"]]
        if approval_routing_service.would_create_circular_hierarchy(db, employee_id, manager_id):
            # Unreachable in normal operation: validate_rows rejects cycles before
            # anything is created. Kept as a backstop, with an honest message — rows
            # created earlier in this call have already been committed by the DAOs.
            raise AppError(
                "CIRCULAR_HIERARCHY",
                f"Row for {row['employee_code']}: assigning manager {manager_code} would create a circular "
                "hierarchy. Employees created earlier in this file may already have been saved.",
            )
        employee = employee_dao.find_by_id(db, employee_id)
        employee_dao.update(db, employee, {"reporting_manager_id": manager_id})

    audit_service.record(
        db, action="BULK_EMPLOYEE_IMPORT", entity_type="employees", entity_id="bulk", actor_id=actor_id,
        new_value={"count": len(rows), "codes": [r["employee_code"] for r in rows]},
    )
    return {"committed": True, "errors": [], "imported_count": len(rows)}
