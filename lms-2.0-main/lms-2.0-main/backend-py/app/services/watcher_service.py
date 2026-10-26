"""Mirrors backend/src/services/watcher.service.js."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import leave_request_dao, role_dao, watcher_dao
from app.services import audit_service, notification_service
from app.services.employee.hierarchy import is_in_manager_hierarchy

WATCHER_ELIGIBLE_ROLES = ("MANAGER", "HR_ADMIN")


def apply_standing_watchers(db: Session, request) -> None:
    """LMS-062: any active StandingWatcher covering the request's start date
    becomes a Watcher on this request (idempotent — skips if already present)."""
    standing = watcher_dao.list_active_standing_watchers(db, request.employee_id, request.start_date)
    for sw in standing:
        if watcher_dao.find_existing(db, request.request_id, sw.watcher_employee_id) is None:
            watcher_dao.create(
                db, request_id=request.request_id, watcher_employee_id=sw.watcher_employee_id,
                added_by_id=sw.added_by_id,
            )


def notify_watchers(db: Session, request_id: int, template_key: str) -> None:
    for w in watcher_dao.list_for_request(db, request_id):
        notification_service.notify(db, recipient_id=w.watcher_employee_id, template_key=template_key, related_request_id=request_id)


def add_watcher(db: Session, request_id: int, watcher_employee_id: int, added_by_id: int, actor_is_hr_admin: bool):
    """LMS-063: a Watcher must hold Manager or HR/Admin. A Manager may only
    add/remove a watcher from a request raised by someone in their own
    reporting line."""
    request = leave_request_dao.find_by_id(db, request_id)
    if request is None:
        raise AppError("NOT_FOUND", "Leave request not found.", status=404)
    if not actor_is_hr_admin and not is_in_manager_hierarchy(db, added_by_id, request.employee_id):
        raise AppError("PERMISSION_DENIED", "You may only manage watchers for your own reporting line.", status=403)

    roles = role_dao.get_role_codes_for_employee(db, watcher_employee_id)
    if not set(WATCHER_ELIGIBLE_ROLES) & set(roles):
        raise AppError("VALIDATION_ERROR", "A watcher must hold the Manager or HR/Admin role.")

    if watcher_dao.find_existing(db, request_id, watcher_employee_id) is not None:
        db.commit()
        return watcher_dao.find_existing(db, request_id, watcher_employee_id)

    watcher = watcher_dao.create(db, request_id=request_id, watcher_employee_id=watcher_employee_id, added_by_id=added_by_id)
    audit_service.record(
        db, action="WATCHER_ADDED", entity_type="leave_requests", entity_id=request_id,
        actor_id=added_by_id, new_value={"watcher_employee_id": watcher_employee_id},
    )
    db.commit()
    return watcher


def _assert_eligible_watcher(db: Session, watcher_employee_id: int) -> None:
    roles = role_dao.get_role_codes_for_employee(db, watcher_employee_id)
    if not set(WATCHER_ELIGIBLE_ROLES) & set(roles):
        raise AppError("VALIDATION_ERROR", "A watcher must hold the Manager or HR/Admin role.")


def list_standing_watchers(db: Session, watched_employee_id: int, viewer_id: int, viewer_is_hr_admin: bool):
    if not viewer_is_hr_admin and not is_in_manager_hierarchy(db, viewer_id, watched_employee_id):
        raise AppError("NOT_IN_HIERARCHY", "You may only view standing watchers for your own reporting line.", status=403)
    return watcher_dao.list_standing_watchers_for(db, watched_employee_id)


def add_standing_watcher(db: Session, watched_employee_id: int, watcher_employee_id: int, from_date, to_date, added_by_id: int, added_by_is_hr_admin: bool):
    """LMS-061: standing Watcher on a direct/indirect report (Manager) or any
    employee (HR/Admin)."""
    if not added_by_is_hr_admin and not is_in_manager_hierarchy(db, added_by_id, watched_employee_id):
        raise AppError("NOT_IN_HIERARCHY", "You may only manage standing watchers for your own reporting line.", status=403)
    _assert_eligible_watcher(db, watcher_employee_id)

    if watcher_dao.find_overlapping_standing_watcher(db, watched_employee_id, watcher_employee_id, from_date, to_date) is not None:
        raise AppError(
            "DUPLICATE_STANDING_WATCHER",
            "A standing watcher already exists for this employee/watcher pair covering part of this date range.",
        )

    standing = watcher_dao.create_standing_watcher(
        db, watched_employee_id=watched_employee_id, watcher_employee_id=watcher_employee_id,
        from_date=from_date, to_date=to_date, added_by_id=added_by_id,
    )
    audit_service.record(
        db, action="STANDING_WATCHER_ADDED", entity_type="employees", entity_id=watched_employee_id,
        actor_id=added_by_id, new_value={"watcher_employee_id": watcher_employee_id, "from_date": from_date, "to_date": to_date},
    )
    db.commit()
    return standing


def remove_watcher(db: Session, request_id: int, watcher_id: int, actor_id: int, actor_is_hr_admin: bool):
    request = leave_request_dao.find_by_id(db, request_id)
    if request is None:
        raise AppError("NOT_FOUND", "Leave request not found.", status=404)
    if not actor_is_hr_admin and not is_in_manager_hierarchy(db, actor_id, request.employee_id):
        raise AppError("PERMISSION_DENIED", "You may only manage watchers for your own reporting line.", status=403)

    watcher = watcher_dao.find_by_id(db, watcher_id)
    if watcher is None or watcher.request_id != request_id:
        raise AppError("NOT_FOUND", "Watcher not found.", status=404)

    watcher_dao.delete(db, watcher)
    audit_service.record(
        db, action="WATCHER_REMOVED", entity_type="leave_requests", entity_id=request_id,
        actor_id=actor_id, prior_value={"watcher_employee_id": watcher.watcher_employee_id},
    )
    db.commit()
    return {"removed": True}
