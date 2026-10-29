"""Mirrors backend/src/services/employeeLifecycle.service.js (LMS-016/017/018)."""
import json
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import (
    delegation_dao,
    employee_dao,
    employee_final_settlement_dao,
    leave_request_query_dao,
    leave_type_dao,
    leave_year_dao,
    manager_reassignment_log_dao,
    role_dao,
)
from app.services import (
    approval_routing_service,
    audit_service,
    balance_service,
    notification_service,
    role_assignment_service,
    suite_access_service,
)


def deactivate(db: Session, employee_id: int, last_working_day, actor_id: int | None):
    """LMS-016/017: deactivate an employee, recording a last working day, and
    produce a final settlement position — a snapshot for downstream
    consumption only, no payment calculation performed.

    TT Suite: the employee's LMS access is mirrored to None (app.app_access row
    removed) in the same transaction as the status change."""
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)
    if employee.status == "DEACTIVATED":
        raise AppError("ALREADY_DEACTIVATED", "Employee is already deactivated.")
    # Checked before anything is written: the role revoke in (b) would refuse anyway,
    # but only after earlier steps' commits, leaving a half-deactivated employee.
    if "HR_ADMIN" in role_dao.get_role_codes_for_employee(db, employee_id):
        role_assignment_service.assert_can_revoke(db, "HR_ADMIN")

    leave_year = leave_year_dao.find_current(db)
    balances_at_settlement = {
        lt.type_code: balance_service.get_effective_balance(db, employee_id, lt.leave_type_id, leave_year.leave_year_id)
        for lt in leave_type_dao.list_balance_affecting(db)
    }
    snapshot = json.dumps(
        {"last_working_day": str(last_working_day), "leave_year": leave_year.year_code, "balances": balances_at_settlement}, default=str
    )
    # One settlement per employee (unique): a re-deactivation after a reactivation
    # replaces the earlier snapshot.
    settlement = employee_final_settlement_dao.find_by_employee(db, employee_id)
    if settlement is None:
        settlement = employee_final_settlement_dao.create(
            db, employee_id=employee_id, deactivated_at=last_working_day, created_by=actor_id,
            settlement_snapshot_json=snapshot,
        )
    else:
        settlement.deactivated_at = last_working_day
        settlement.created_by = actor_id
        settlement.settlement_snapshot_json = snapshot

    employee.status = "DEACTIVATED"
    employee.deactivated_at = last_working_day
    db.flush()
    suite_access_service.sync_employee(db, employee, actor_employee_id=actor_id)

    audit_service.record(db, action="EMPLOYEE_DEACTIVATED", entity_type="employees", entity_id=employee_id, actor_id=actor_id, new_value={"last_working_day": str(last_working_day)})

    # (a) Escalate anything stuck routed to this employee — a stopgap, not a
    # full re-derivation of routing (HR can re-route further by hand).
    stuck = leave_request_query_dao.list_stuck_for_approver(db, employee_id)
    if stuck:
        escalate_to_id = employee.reporting_manager_id or role_dao.find_hr_admin_queue_id(db)
        leave_request_query_dao.bulk_reassign_approver(db, [r.request_id for r in stuck], escalate_to_id)
        audit_service.record(
            db, action="REQUESTS_ESCALATED_ON_DEACTIVATION", entity_type="leave_requests", entity_id=employee_id,
            actor_id=actor_id, new_value={"request_ids": [r.request_id for r in stuck], "new_approver_id": escalate_to_id},
        )

    # (b) Revoke every explicit role grant — routed through role_assignment_service
    # so the "last HR_ADMIN cannot be removed" guard still applies; if it
    # refuses, that error rolls back the whole deactivation.
    for role_code in role_dao.get_role_codes_for_employee(db, employee_id):
        if role_code == "EMPLOYEE":
            continue  # implicit, not an explicit grant to revoke
        role_assignment_service.revoke_role(db, employee_id, role_code, actor_id)

    # (c) Revoke delegations naming this employee as either party.
    delegation_dao.revoke_all_for_employee(db, employee_id)

    db.commit()
    return {"employee": employee, "settlement": settlement}


def reactivate(db: Session, employee_id: int, actor_id: int | None):
    """Undo a deactivation (TT Suite: the portal re-granting LMS access, or HR).
    Roles revoked at deactivation are NOT restored — the caller grants what the
    person should hold now; the plain EMPLOYEE role is implicit. The settlement
    snapshot is kept as history. Mirrors the effective role in the same commit."""
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)
    if employee.status == "ACTIVE":
        raise AppError("ALREADY_ACTIVE", "Employee is already active.")

    employee.status = "ACTIVE"
    employee.deactivated_at = None
    db.flush()
    suite_access_service.sync_employee(db, employee, actor_employee_id=actor_id)
    audit_service.record(  # commits the status change + mirror together
        db, action="EMPLOYEE_REACTIVATED", entity_type="employees", entity_id=employee_id, actor_id=actor_id,
    )
    return employee


def reassign_manager(db: Session, employee_id: int, new_manager_id: int, transfer_pending_requests: bool, actor_id: int):
    """LMS-018: requests already pending with the previous manager remain
    there unless explicitly transferred — silently moving a pending request
    to a manager with no context is worse than leaving it."""
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)

    if approval_routing_service.would_create_circular_hierarchy(db, employee_id, new_manager_id):
        raise AppError("CIRCULAR_HIERARCHY", "This reassignment would create a circular reporting chain.")

    old_manager_id = employee.reporting_manager_id
    employee.reporting_manager_id = new_manager_id
    db.flush()

    if transfer_pending_requests:
        leave_request_query_dao.bulk_transfer_pending_manager(db, employee_id, old_manager_id, new_manager_id)

    log = manager_reassignment_log_dao.create(
        db, employee_id=employee_id, old_manager_id=old_manager_id, new_manager_id=new_manager_id,
        pending_requests_transferred=bool(transfer_pending_requests), reassigned_by=actor_id,
    )

    audit_service.record(
        db, action="MANAGER_REASSIGNED", entity_type="employees", entity_id=employee_id, actor_id=actor_id,
        prior_value={"reporting_manager_id": old_manager_id},
        new_value={"reporting_manager_id": new_manager_id, "transferred": bool(transfer_pending_requests)},
    )

    # Both managers and the employee are notified — explicit, never silent. Named, with
    # employee codes, rather than "employee #2".
    new_manager = employee_dao.find_by_id(db, new_manager_id)
    old_manager = employee_dao.find_by_id(db, old_manager_id) if old_manager_id else None
    tokens = {
        "newManagerId": new_manager_id,
        "employeeName": employee.full_name, "employeeCode": employee.employee_code,
        "newManagerName": new_manager.full_name if new_manager else f"employee #{new_manager_id}",
        "newManagerCode": new_manager.employee_code if new_manager else "",
        "oldManagerName": f"{old_manager.full_name} ({old_manager.employee_code})" if old_manager else "none",
    }
    for recipient_id in filter(None, (employee_id, old_manager_id, new_manager_id)):
        try:
            notification_service.notify(db, recipient_id=recipient_id, template_key="MANAGER_REASSIGNED", tokens=tokens)
        except Exception:  # noqa: BLE001 — Node swallows this specifically
            pass

    db.commit()
    return log
