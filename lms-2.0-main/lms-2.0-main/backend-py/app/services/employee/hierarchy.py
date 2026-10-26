from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, role_dao
from app.services import approval_routing_service, audit_service


def set_reporting_manager(db: Session, employee_id: int, manager_id: int, actor_id: int):
    """LMS-011/BR-37."""
    if approval_routing_service.would_create_circular_hierarchy(db, employee_id, manager_id):
        raise AppError(
            "CIRCULAR_HIERARCHY",
            f"Assigning this manager would create a circular reporting chain through employee #{manager_id}.",
        )
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)

    prior = employee.reporting_manager_id
    employee_dao.update(db, employee, {"reporting_manager_id": manager_id})
    audit_service.record(
        db, action="MANAGER_REASSIGNED", entity_type="employees", entity_id=employee_id,
        actor_id=actor_id, prior_value={"reporting_manager_id": prior}, new_value={"reporting_manager_id": manager_id},
    )
    return employee


def get_all_reports_recursive(db: Session, manager_id: int) -> list:
    """BR-39: unbounded-depth walk down reporting_manager_id — the base of the
    entire manager-hierarchy visibility model (team balances, reports, watcher scoping)."""
    direct = employee_dao.list_direct_reports(db, manager_id)
    all_reports = list(direct)
    for d in direct:
        all_reports.extend(get_all_reports_recursive(db, d.employee_id))
    return all_reports


def is_in_manager_hierarchy(db: Session, manager_id: int, employee_id: int) -> bool:
    reports = get_all_reports_recursive(db, manager_id)
    return any(r.employee_id == employee_id for r in reports)


def list_watchable_employees(db: Session) -> list:
    """LMS-060/063: union of (a) any active employee with >=1 active direct
    report (derived "is a manager", not a stored role) and (b) any employee
    holding the explicit HR_ADMIN role — deduped by employee_id."""
    from app.models.employee import Employee

    seen: dict[int, Employee] = {}
    all_active = [e for e in employee_dao.list_all(db) if e.status == "ACTIVE"]
    manager_ids = {e.reporting_manager_id for e in all_active if e.reporting_manager_id is not None}
    for e in all_active:
        if e.employee_id in manager_ids:
            seen[e.employee_id] = e

    for e in all_active:
        if "HR_ADMIN" in role_dao.get_role_codes_for_employee(db, e.employee_id):
            seen[e.employee_id] = e

    return list(seen.values())
