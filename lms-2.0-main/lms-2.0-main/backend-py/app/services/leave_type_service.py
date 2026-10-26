"""Mirrors backend/src/services/admin.service.js's leave type/policy/accrual
section (LMS-024, LMS-026, LMS-027). No transaction wraps the three creates in
Node either — a faithful port, not a hardening pass; a failure between the
LeaveType/LeavePolicy/LeaveAccrualConfig creates can leave an orphaned row
there exactly as it can here."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import leave_type_dao
from app.services import accrual_service, audit_service


def list_leave_types(db: Session):
    rows = []
    for leave_type in leave_type_dao.list_all(db):
        rows.append(
            {
                "leave_type": leave_type,
                "policy": leave_type_dao.find_policy(db, leave_type.leave_type_id),
                "accrual_config": leave_type_dao.find_accrual_config(db, leave_type.leave_type_id),
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

    leave_type_dao.create_accrual_config(
        db,
        leave_type_id=leave_type.leave_type_id,
        accrual_method=payload["accrual_method"],
        posting_day=payload.get("posting_day") or 1,
        updated_by=actor_id,
    )

    audit_service.record(
        db, action="LEAVE_TYPE_CREATED", entity_type="leave_types", entity_id=leave_type.leave_type_id,
        actor_id=actor_id, new_value=payload,
    )
    return leave_type


def update_leave_type_policy(db: Session, leave_type_id: int, payload: dict, actor_id: int):
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        raise AppError("NOT_FOUND", "Leave type not found.", status=404)
    if leave_type.is_system:
        raise AppError("SYSTEM_TYPE_LOCKED", "The system LOP type cannot be edited or deleted (LMS-025).")

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

    entitlement_changed_from = None
    if policy is not None:
        if payload.get("annual_entitlement") is not None:
            if float(payload["annual_entitlement"]) != float(policy.annual_entitlement):
                entitlement_changed_from = float(policy.annual_entitlement)
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
        if entitlement_changed_from is not None and leave_type.is_balance_affecting:
            accrual_service.post_entitlement_revision(
                db, leave_type_id, entitlement_changed_from, float(policy.annual_entitlement), actor_id
            )
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

    audit_service.record(
        db, action="LEAVE_POLICY_UPDATED", entity_type="leave_policies",
        entity_id=policy.policy_id if policy else leave_type.leave_type_id,
        actor_id=actor_id, prior_value=prior, new_value=payload,
    )
    return {"leave_type": leave_type, "policy": policy}
