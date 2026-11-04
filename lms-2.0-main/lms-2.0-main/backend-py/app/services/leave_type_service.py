"""Leave types, their policy, their pool membership and their archive state (LMS-024/026/027).

One rule decides what everything here does to balances: **nothing in this file credits an
existing employee.** Creating a leave type, editing its entitlement and restoring it from the
archive all change *policy*, which is what a newly onboarded employee is granted and what HR
posts from. People who are already employed receive days only through the opening-balance
workflow (`balance_admin_service`), where HR previews the change and approves it.

`preview_entitlement_change` is how HR sees what an edit would mean before deciding.
"""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, entitlement_dao, leave_type_dao, leave_year_dao
import app.models  # noqa: F401 - every table registered, so the usage check sees all references
from app.core.db import Base
from app.models.employee_extras import EmployeeLeaveTypeExclusion
from app.models.leave_config import LeaveAccrualConfig, LeavePolicy, LeaveType
from app.services import audit_service, entitlement_service

# Looked up by code (automatic LOP conversion, comp-off credits): never archived.
PROTECTED_CODES = frozenset({"LOP", "COMP_OFF"})
# The type's own settings. Every other table pointing at a leave type is history.
_OWN_TABLES = frozenset({
    LeavePolicy.__tablename__, LeaveAccrualConfig.__tablename__, EmployeeLeaveTypeExclusion.__tablename__,
})


def list_leave_types(db: Session, include_archived: bool = True):
    rows = []
    for leave_type in leave_type_dao.list_all(db, include_archived=include_archived):
        membership = entitlement_dao.find_membership(db, leave_type.leave_type_id)
        pool = entitlement_dao.find_pool(db, membership.pool_id) if membership else None
        rows.append(
            {
                "leave_type": leave_type,
                "policy": leave_type_dao.find_policy(db, leave_type.leave_type_id),
                "accrual_config": leave_type_dao.find_accrual_config(db, leave_type.leave_type_id),
                "pool": pool,
            }
        )
    return rows


def create_leave_type(db: Session, payload: dict, actor_id: int):
    # LMS-025 is enforced structurally: is_system/is_selectable_by_employee are
    # never settable here, so a caller can never mint a second LOP.
    leave_type = leave_type_dao.create(
        db,
        type_code=payload["type_code"],
        type_name=payload["type_name"],
        is_sick_leave=bool(payload.get("is_sick_leave")),
        is_balance_affecting=payload.get("is_balance_affecting", True),
        permits_half_day=bool(payload.get("permits_half_day")),
        permits_attachments=bool(payload.get("permits_attachments")),
    )

    leave_type_dao.create_policy(
        db,
        leave_type_id=leave_type.leave_type_id,
        annual_entitlement=payload["annual_entitlement"],
        carries_forward=bool(payload.get("carries_forward")),
        carry_forward_cap=payload.get("carry_forward_cap"),
        updated_by=actor_id,
    )

    if payload.get("pool_id") is not None:
        _assert_pool_exists(db, payload["pool_id"])
        entitlement_dao.set_membership(db, leave_type.leave_type_id, payload["pool_id"], actor_id)
        db.commit()

    audit_service.record(
        db, action="LEAVE_TYPE_CREATED", entity_type="leave_types", entity_id=leave_type.leave_type_id,
        actor_id=actor_id, new_value=payload,
    )

    # Deliberately no grant. Existing employees get days for this type only when HR posts an
    # opening balance for them; anyone onboarded from now on is granted it in full, the same
    # as every other type.
    return {"leave_type": leave_type, "granted_to": 0}


def update_leave_type_policy(db: Session, leave_type_id: int, payload: dict, actor_id: int):
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        raise AppError("NOT_FOUND", "Leave type not found.", status=404)
    # LOP (is_system) is edited like any other type: HR can turn it on so employees may apply for
    # it, and tick it per person. is_system still marks it as the type the automatic LOP
    # conversion posts to, whatever its on/off setting.

    # Some leave types (e.g. Compensatory Off) have no LeavePolicy row at all —
    # entitlement/carry-forward edits are meaningless for those, but
    # is_selectable_by_employee still lives on LeaveType itself, so enable/
    # disable must keep working regardless.
    policy = leave_type_dao.find_policy(db, leave_type_id)
    prior = {
        "annual_entitlement": policy.annual_entitlement if policy else None,
        "carries_forward": policy.carries_forward if policy else None,
        "carry_forward_cap": policy.carry_forward_cap if policy else None,
        "is_selectable_by_employee": leave_type.is_selectable_by_employee,
    }

    if policy is not None:
        if payload.get("annual_entitlement") is not None:
            policy.annual_entitlement = payload["annual_entitlement"]
        if payload.get("carries_forward") is not None:
            policy.carries_forward = payload["carries_forward"]
        # A blank cap means "no cap": null is a real value here, distinct from
        # the key being absent (payload is built with exclude_unset).
        if "carry_forward_cap" in payload:
            policy.carry_forward_cap = payload["carry_forward_cap"]
        if policy.carries_forward is False:
            policy.carry_forward_cap = None
        policy.updated_by = actor_id
        # Deliberately no balance write. An entitlement change applies to employees granted
        # from now on; existing people are moved by HR one at a time through the
        # opening-balance workflow — see preview_entitlement_change.
        db.commit()

    # Whether employees can apply for this type at all — independent of the
    # policy numbers above.
    if payload.get("is_selectable_by_employee") is not None:
        leave_type.is_selectable_by_employee = payload["is_selectable_by_employee"]
        db.commit()

    if payload.get("gender_eligibility") is not None:
        value = str(payload["gender_eligibility"]).upper()
        if value not in ("ALL", "FEMALE", "MALE"):
            raise AppError("VALIDATION_ERROR", "Gender eligibility must be ALL, FEMALE or MALE.")
        leave_type.gender_eligibility = value
        db.commit()

    if payload.get("marital_eligibility") is not None:
        value = str(payload["marital_eligibility"]).upper()
        if value not in ("ANY", "MARRIED", "SINGLE"):
            raise AppError("VALIDATION_ERROR", "Marital eligibility must be ANY, MARRIED or SINGLE.")
        leave_type.marital_eligibility = value
        db.commit()

    if "pool_id" in payload:
        pool_id = payload["pool_id"]
        if pool_id is not None:
            _assert_pool_exists(db, pool_id)
        entitlement_dao.set_membership(db, leave_type_id, pool_id, actor_id)
        db.commit()

    audit_service.record(
        db, action="LEAVE_POLICY_UPDATED", entity_type="leave_policies",
        entity_id=policy.policy_id if policy else leave_type.leave_type_id,
        actor_id=actor_id, prior_value=prior, new_value=payload,
    )
    membership = entitlement_dao.find_membership(db, leave_type_id)
    pool = entitlement_dao.find_pool(db, membership.pool_id) if membership else None
    return {"leave_type": leave_type, "policy": policy, "pool": pool}


def preview_entitlement_change(db: Session, leave_type_id: int, new_entitlement: float) -> dict:
    """§11: what this entitlement change would mean, for HR to look at before deciding.

    Nothing is written. Each employee is listed with what they hold today and what the new
    policy would give, so HR can post an opening balance for the ones they choose.
    """
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        raise AppError("NOT_FOUND", "Leave type not found.", status=404)
    policy = leave_type_dao.find_policy(db, leave_type_id)
    if policy is None:
        raise AppError("NO_POLICY", "This leave type has no entitlement policy to change.")

    target = entitlement_service.target_for_leave_type(db, leave_type)
    leave_year = leave_year_dao.find_current(db)
    rows = []
    for employee in employee_dao.list_active(db):
        summary = entitlement_service.summary(db, employee.employee_id, target, leave_year)
        rows.append(
            {
                "employee_id": employee.employee_id,
                "employee_code": employee.employee_code,
                "employee_name": employee.full_name,
                "current_entitlement": summary["entitlement"],
                "used": summary["used"],
                "available": summary["available"],
                "proposed_entitlement": float(new_entitlement),
                "difference": round(float(new_entitlement) - summary["entitlement"], 2),
            }
        )
    return {
        "leave_type_id": leave_type_id,
        "leave_type_name": leave_type.type_name,
        "target_name": target.name,
        "is_pool": target.is_pool,
        "current_policy": float(policy.annual_entitlement),
        "proposed_policy": float(new_entitlement),
        "employees": rows,
    }


def archive_leave_type(db: Session, leave_type_id: int, actor_id: int) -> LeaveType:
    """Soft delete (§12). The type leaves the Apply picker, the dashboards and My Team;
    every request, ledger row and report that names it keeps working."""
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        raise AppError("NOT_FOUND", "Leave type not found.", status=404)
    if leave_type.is_system or leave_type.type_code.upper() in PROTECTED_CODES:
        raise AppError(
            "LEAVE_TYPE_PROTECTED",
            f"{leave_type.type_name} is built in (the system uses it) and cannot be archived. Turn it off instead.",
            status=409,
        )
    if leave_type.archived_at is not None:
        raise AppError("ALREADY_ARCHIVED", f"{leave_type.type_name} is already archived.", status=409)

    leave_type.archived_at = datetime.now(timezone.utc)
    leave_type.archived_by = actor_id
    db.commit()
    audit_service.record(
        db, action="LEAVE_TYPE_ARCHIVED", entity_type="leave_types", entity_id=leave_type_id,
        actor_id=actor_id,
        prior_value={"type_code": leave_type.type_code, "type_name": leave_type.type_name},
        new_value={"kept_history": _usage(db, leave_type_id)},
    )
    return leave_type


def restore_leave_type(db: Session, leave_type_id: int, actor_id: int) -> dict:
    """Bring an archived type back with its policy, pool membership and every balance it
    already held. Nobody is credited by the restore: a balance that was there before the
    archive is there again, and anything new goes through the opening-balance workflow."""
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        raise AppError("NOT_FOUND", "Leave type not found.", status=404)
    if leave_type.archived_at is None:
        raise AppError("NOT_ARCHIVED", f"{leave_type.type_name} is not archived.", status=409)

    leave_type.archived_at = None
    leave_type.archived_by = None
    db.commit()

    audit_service.record(
        db, action="LEAVE_TYPE_RESTORED", entity_type="leave_types", entity_id=leave_type_id,
        actor_id=actor_id, new_value={"granted_to": 0},
    )
    return {"leave_type": leave_type, "granted_to": 0}


def _assert_pool_exists(db: Session, pool_id: int) -> None:
    if entitlement_dao.find_pool(db, pool_id) is None:
        raise AppError("NOT_FOUND", "Shared entitlement pool not found.", status=404)


def _usage(db: Session, leave_type_id: int) -> dict[str, int]:
    """Rows elsewhere that refer to this leave type (requests, ledger, LOP records...), by
    table — recorded with the archive so it is clear what history was kept."""
    used: dict[str, int] = {}
    for table in Base.metadata.sorted_tables:
        if table.name in _OWN_TABLES:
            continue
        for fk in table.foreign_keys:
            if fk.column.table.name != LeaveType.__tablename__:
                continue
            count = db.execute(select(func.count()).select_from(table).where(fk.parent == leave_type_id)).scalar()
            if count:
                used[table.name] = used.get(table.name, 0) + count
    return used
