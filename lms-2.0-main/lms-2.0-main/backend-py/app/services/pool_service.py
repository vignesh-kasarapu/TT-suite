"""Shared entitlement pools: one entitlement that several leave types draw on.

Sick and Casual sharing nine days is a pool with two members, not a rule about those two
codes — HR can pool any types, and the grant, the deduction and the balance all happen at
the pool, so nine days can never become nine each.
"""
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import entitlement_dao, leave_type_dao, leave_year_dao
from app.models.ledger import LeaveLedger
from app.services import audit_service, entitlement_service


def list_pools(db: Session, include_archived: bool = False) -> list[dict]:
    rows = []
    for pool in entitlement_dao.list_pools(db, include_archived=include_archived):
        members = entitlement_dao.list_members(db, pool.pool_id)
        types = [leave_type_dao.find_by_id(db, m.leave_type_id) for m in members]
        rows.append(
            {
                "pool_id": pool.pool_id,
                "pool_code": pool.pool_code,
                "pool_name": pool.pool_name,
                "annual_entitlement": float(pool.annual_entitlement),
                "carries_forward": bool(pool.carries_forward),
                "carry_forward_cap": float(pool.carry_forward_cap) if pool.carry_forward_cap is not None else None,
                "archived_at": pool.archived_at,
                "leave_types": [
                    {"leave_type_id": t.leave_type_id, "type_code": t.type_code, "type_name": t.type_name}
                    for t in types
                    if t is not None
                ],
            }
        )
    return rows


def create_pool(db: Session, payload: dict, actor_id: int) -> dict:
    code = str(payload["pool_code"]).strip().upper()
    if entitlement_dao.find_pool_by_code(db, code) is not None:
        raise AppError("DUPLICATE_POOL", f"A shared pool with the code {code} already exists.", status=409)
    if float(payload["annual_entitlement"]) < 0:
        raise AppError("VALIDATION_ERROR", "A pool's annual entitlement cannot be negative.")

    pool = entitlement_dao.create_pool(
        db, pool_code=code, pool_name=payload["pool_name"].strip(),
        annual_entitlement=payload["annual_entitlement"],
        carries_forward=bool(payload.get("carries_forward")),
        carry_forward_cap=payload.get("carry_forward_cap"),
        updated_by=actor_id,
    )
    for leave_type_id in payload.get("leave_type_ids") or []:
        _assert_poolable(db, leave_type_id)
        entitlement_dao.set_membership(db, leave_type_id, pool.pool_id, actor_id)
    db.commit()

    audit_service.record(
        db, action="ENTITLEMENT_POOL_CREATED", entity_type="leave_entitlement_pools", entity_id=pool.pool_id,
        actor_id=actor_id, new_value=payload,
    )

    # No bulk credit: a pool is policy. Existing employees receive its days through the
    # opening-balance workflow, new employees when they are onboarded.
    return {**_one(db, pool), "granted_to": 0}


def update_pool(db: Session, pool_id: int, payload: dict, actor_id: int) -> dict:
    pool = entitlement_dao.find_pool(db, pool_id)
    if pool is None:
        raise AppError("NOT_FOUND", "Shared pool not found.", status=404)
    prior = {
        "pool_name": pool.pool_name, "annual_entitlement": float(pool.annual_entitlement),
        "carries_forward": pool.carries_forward, "carry_forward_cap": pool.carry_forward_cap,
    }
    if payload.get("pool_name") is not None:
        pool.pool_name = payload["pool_name"].strip()
    if payload.get("annual_entitlement") is not None:
        # Like a leave type's entitlement: this is what new grants use. Existing balances
        # move only through the opening-balance workflow.
        pool.annual_entitlement = payload["annual_entitlement"]
    if payload.get("carries_forward") is not None:
        pool.carries_forward = payload["carries_forward"]
    if "carry_forward_cap" in payload:
        pool.carry_forward_cap = payload["carry_forward_cap"]
    if pool.carries_forward is False:
        pool.carry_forward_cap = None
    pool.updated_by = actor_id

    if payload.get("leave_type_ids") is not None:
        wanted = set(payload["leave_type_ids"])
        current = {m.leave_type_id for m in entitlement_dao.list_members(db, pool_id)}
        for leave_type_id in wanted - current:
            _assert_poolable(db, leave_type_id)
            _assert_no_balance_elsewhere(db, leave_type_id)
            entitlement_dao.set_membership(db, leave_type_id, pool_id, actor_id)
        for leave_type_id in current - wanted:
            entitlement_dao.set_membership(db, leave_type_id, None, actor_id)
    db.commit()

    audit_service.record(
        db, action="ENTITLEMENT_POOL_UPDATED", entity_type="leave_entitlement_pools", entity_id=pool_id,
        actor_id=actor_id, prior_value=prior, new_value=payload,
    )
    return {**_one(db, pool), "granted_to": 0}


def archive_pool(db: Session, pool_id: int, actor_id: int) -> dict:
    """The pool stops being used; its member types fall back to their own policies. History
    stays — nothing is deleted."""
    pool = entitlement_dao.find_pool(db, pool_id)
    if pool is None:
        raise AppError("NOT_FOUND", "Shared pool not found.", status=404)
    pool.archived_at = datetime.now(timezone.utc)
    for member in entitlement_dao.list_members(db, pool_id):
        entitlement_dao.set_membership(db, member.leave_type_id, None, actor_id)
    db.commit()
    audit_service.record(
        db, action="ENTITLEMENT_POOL_ARCHIVED", entity_type="leave_entitlement_pools", entity_id=pool_id,
        actor_id=actor_id,
    )
    return _one(db, pool)


def _assert_poolable(db: Session, leave_type_id: int) -> None:
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        raise AppError("NOT_FOUND", f"Leave type {leave_type_id} not found.", status=404)
    if not entitlement_service.is_grantable(leave_type):
        raise AppError(
            "LEAVE_TYPE_NOT_POOLABLE",
            f"{leave_type.type_name} cannot join a shared pool: it holds no entitlement of its own.",
        )


def _assert_no_balance_elsewhere(db: Session, leave_type_id: int) -> None:
    """A type that already holds its own balance this year cannot quietly join a pool: the
    days people hold would stay behind under the old target. HR moves them first, through
    the opening-balance workflow, and then pools the type."""
    leave_year = leave_year_dao.find_current(db)
    held = db.execute(
        select(func.count())
        .select_from(LeaveLedger)
        .where(
            LeaveLedger.leave_type_id == leave_type_id,
            LeaveLedger.pool_id.is_(None),
            LeaveLedger.leave_year_id == leave_year.leave_year_id,
        )
    ).scalar_one()
    if held:
        leave_type = leave_type_dao.find_by_id(db, leave_type_id)
        raise AppError(
            "LEAVE_TYPE_HAS_BALANCE",
            f"{leave_type.type_name if leave_type else 'This leave type'} already holds balances of its own this "
            "leave year. Move them with an opening-balance adjustment before adding it to a pool.",
            status=409,
        )


def _one(db: Session, pool) -> dict:
    for row in list_pools(db, include_archived=True):
        if row["pool_id"] == pool.pool_id:
            return row
    raise AppError("NOT_FOUND", "Shared pool not found.", status=404)
