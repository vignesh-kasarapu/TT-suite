"""HR's balance workflows: opening balances, bulk previews and the organisation picture.

Four things HR does to a balance, each its own kind of ledger row so a report never has to
guess which it was (§14):

* `OPENING_BALANCE_ADJUSTMENT` — what an existing employee starts the new policy with.
* `MANUAL_ADJUSTMENT` — a permanent correction, days added or taken away for good.
* a temporary restriction, and its release — neither is a ledger row at all; they live in
  `leave_balance_restrictions` (see restriction_service), because they are not days gained
  or lost.

Nothing in here runs by itself. A bulk change is a preview until somebody confirms it.
"""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, entitlement_dao, leave_type_dao, leave_year_dao
from app.services import audit_service, balance_service, entitlement_service, notification_service


def _target(db: Session, *, leave_type_id: int | None, pool_id: int | None):
    if (leave_type_id is None) == (pool_id is None):
        raise AppError("VALIDATION_ERROR", "Choose either a leave type or a shared pool, not both.")
    if pool_id is not None:
        pool = entitlement_dao.find_pool(db, pool_id)
        if pool is None:
            raise AppError("NOT_FOUND", "Shared pool not found.", status=404)
        return entitlement_service.target_for_pool(db, pool)
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        raise AppError("NOT_FOUND", "Leave type not found.", status=404)
    return entitlement_service.target_for_leave_type(db, leave_type)


def _leave_year(db: Session, leave_year_id: int | None):
    leave_year = leave_year_dao.find_by_id(db, leave_year_id) if leave_year_id else leave_year_dao.find_current(db)
    if leave_year is None:
        raise AppError("NOT_FOUND", "Leave year not found.", status=404)
    if leave_year.is_closed:
        raise AppError("CLOSED_YEAR", f"{leave_year.year_code} is closed and cannot be adjusted.", status=409)
    return leave_year


def employee_balances(db: Session, employee_id: int, leave_year_id: int | None = None) -> dict:
    """What HR sees before deciding: today's figures per target, next to the entitlement the
    current policy would grant."""
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)
    leave_year = _leave_year(db, leave_year_id)

    rows = []
    for target in entitlement_service.grantable_targets(db):
        summary = entitlement_service.summary(db, employee_id, target, leave_year)
        rows.append({**summary, "policy_entitlement": target.entitlement_days})
    return {
        "employee": {
            "employee_id": employee.employee_id, "employee_code": employee.employee_code,
            "full_name": employee.full_name, "date_of_joining": employee.date_of_joining,
        },
        "leave_year": {"leave_year_id": leave_year.leave_year_id, "year_code": leave_year.year_code},
        "balances": rows,
        "totals": entitlement_service.totals(rows),
    }


def preview_opening_balances(
    db: Session, *, leave_type_id: int | None = None, pool_id: int | None = None,
    opening_balance: float, employee_ids: list[int] | None = None, department_id: int | None = None,
    leave_year_id: int | None = None,
) -> dict:
    """§4.2: the dry run. Shows every employee the change would touch, what they hold now
    and what the adjustment would be. Writes nothing."""
    target = _target(db, leave_type_id=leave_type_id, pool_id=pool_id)
    leave_year = _leave_year(db, leave_year_id)

    rows = []
    for employee in _employees(db, employee_ids, department_id):
        summary = entitlement_service.summary(db, employee.employee_id, target, leave_year)
        difference = round(float(opening_balance) - summary["ledger_balance"], 2)
        rows.append(
            {
                "employee_id": employee.employee_id,
                "employee_code": employee.employee_code,
                "employee_name": employee.full_name,
                "current_balance": summary["ledger_balance"],
                "used": summary["used"],
                "restricted": summary["restricted"],
                "available": summary["available"],
                "proposed_opening_balance": float(opening_balance),
                "difference": difference,
                "changes": difference != 0,
            }
        )
    return {
        "target_name": target.name,
        "target_key": target.key,
        "leave_year": leave_year.year_code,
        "leave_year_id": leave_year.leave_year_id,
        "policy_entitlement": target.entitlement_days,
        "employees": rows,
        "employees_changed": sum(1 for r in rows if r["changes"]),
    }


def apply_opening_balances(
    db: Session, *, leave_type_id: int | None = None, pool_id: int | None = None,
    opening_balance: float, reason: str, actor_id: int, employee_ids: list[int] | None = None,
    department_id: int | None = None, leave_year_id: int | None = None,
) -> dict:
    """Post the compensating entry that moves each employee's balance to the opening figure
    HR approved. Historical rows are never touched (BR-07)."""
    if not (reason or "").strip():
        raise AppError("REASON_REQUIRED", "A reason is required for an opening-balance adjustment.")
    preview = preview_opening_balances(
        db, leave_type_id=leave_type_id, pool_id=pool_id, opening_balance=opening_balance,
        employee_ids=employee_ids, department_id=department_id, leave_year_id=leave_year_id,
    )
    target = _target(db, leave_type_id=leave_type_id, pool_id=pool_id)
    leave_year = _leave_year(db, leave_year_id)
    posting_type_id = target.leave_type_id or target.leave_type_ids[0]

    applied = 0
    for row in preview["employees"]:
        if not row["changes"]:
            continue
        balance_service.write_manual_adjustment(
            db, row["employee_id"], posting_type_id, leave_year.leave_year_id, row["difference"],
            reason, actor_id, entry_type="OPENING_BALANCE_ADJUSTMENT",
            source_reference=f"opening_balance:{target.key}:{row['employee_id']}:{leave_year.leave_year_id}",
        )
        audit_service.record(
            db, action="OPENING_BALANCE_SET", entity_type="leave_ledger", entity_id=row["employee_id"],
            actor_id=actor_id,
            prior_value={"balance": row["current_balance"]},
            new_value={"target": target.name, "opening_balance": row["proposed_opening_balance"],
                       "adjustment": row["difference"], "reason": reason},
        )
        _notify(db, row["employee_id"], {"quantity": row["difference"], "reason": reason})
        applied += 1
    db.commit()
    return {**preview, "applied_to": applied, "reason": reason}


def organization_summary(db: Session, leave_year_id: int | None = None) -> dict:
    """§13.3: the admin picture — per target and per department, each pool counted once."""
    leave_year = leave_year_dao.find_by_id(db, leave_year_id) if leave_year_id else leave_year_dao.find_current(db)
    if leave_year is None:
        raise AppError("NOT_FOUND", "Leave year not found.", status=404)

    employees = employee_dao.list_active(db)
    targets = entitlement_service.grantable_targets(db)

    by_target: list[dict] = []
    per_employee: dict[int, list[dict]] = {e.employee_id: [] for e in employees}
    for target in targets:
        rows = []
        for employee in employees:
            summary = entitlement_service.summary(db, employee.employee_id, target, leave_year)
            rows.append(summary)
            per_employee[employee.employee_id].append(summary)
        totals = entitlement_service.totals(rows)
        by_target.append(
            {
                "target_key": target.key, "target_name": target.name, "target_kind": target.kind,
                "configured_entitlement": target.entitlement_days,
                "leave_types": [
                    {"leave_type_id": t.leave_type_id, "type_name": t.type_name}
                    for t in (leave_type_dao.find_by_id(db, i) for i in target.leave_type_ids)
                    if t is not None
                ],
                **totals,
            }
        )

    departments: dict[str, dict] = {}
    employee_rows = []
    for employee in employees:
        totals = entitlement_service.totals(per_employee[employee.employee_id])
        employee_rows.append(
            {
                "employee_id": employee.employee_id, "employee_code": employee.employee_code,
                "employee_name": employee.full_name, "department_id": employee.department_id,
                **totals,
            }
        )
        key = str(employee.department_id or "unassigned")
        bucket = departments.setdefault(
            key, {"department_id": employee.department_id, "employees": 0,
                  "entitlement": 0.0, "used": 0.0, "restricted": 0.0, "committed": 0.0, "available": 0.0}
        )
        bucket["employees"] += 1
        for field in ("entitlement", "used", "restricted", "committed", "available"):
            bucket[field] = round(bucket[field] + totals[field], 2)

    restrictions = entitlement_dao.list_restrictions(db, leave_year_id=leave_year.leave_year_id)
    from app.services import restriction_service

    return {
        "leave_year": {"leave_year_id": leave_year.leave_year_id, "year_code": leave_year.year_code,
                       "start_date": leave_year.start_date, "end_date": leave_year.end_date},
        "employee_count": len(employees),
        "by_target": by_target,
        "by_department": list(departments.values()),
        "employees": employee_rows,
        "totals": {
            "entitlement": round(sum(r["entitlement"] for r in employee_rows), 2),
            "used": round(sum(r["used"] for r in employee_rows), 2),
            "restricted": round(sum(r["restricted"] for r in employee_rows), 2),
            "committed": round(sum(r["committed"] for r in employee_rows), 2),
            "available": round(sum(r["available"] for r in employee_rows), 2),
        },
        "restrictions": {
            "active": sum(1 for r in restrictions if restriction_service.effective_state(r) == "ACTIVE"),
            "scheduled": sum(1 for r in restrictions if restriction_service.effective_state(r) == "SCHEDULED"),
            # Expired but not yet written down by the nightly sweep: the days are already
            # back, this is only bookkeeping outstanding.
            "awaiting_release": sum(
                1 for r in restrictions if r.state == "ACTIVE" and restriction_service.effective_state(r) == "EXPIRED"
            ),
        },
    }


def _employees(db: Session, employee_ids: list[int] | None, department_id: int | None):
    people = employee_dao.list_active(db)
    if employee_ids:
        wanted = set(employee_ids)
        people = [e for e in people if e.employee_id in wanted]
    if department_id is not None:
        people = [e for e in people if e.department_id == department_id]
    if not people:
        raise AppError("NO_EMPLOYEES", "No active employees match that selection.")
    return people


def _notify(db: Session, recipient_id: int, tokens: dict) -> None:
    try:
        notification_service.notify(db, recipient_id=recipient_id, template_key="BALANCE_ADJUSTED", tokens=tokens)
    except Exception:  # noqa: BLE001 — a missing template never blocks an HR action
        pass
