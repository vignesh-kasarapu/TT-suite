"""Shared entitlement pools, pool membership and temporary balance restrictions."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entitlement import LeaveBalanceRestriction, LeaveEntitlementPool, LeaveTypePoolMember


# --- pools ---------------------------------------------------------------------------------


def list_pools(db: Session, include_archived: bool = False) -> list[LeaveEntitlementPool]:
    stmt = select(LeaveEntitlementPool)
    if not include_archived:
        stmt = stmt.where(LeaveEntitlementPool.archived_at.is_(None))
    return list(db.execute(stmt.order_by(LeaveEntitlementPool.pool_name)).scalars())


def find_pool(db: Session, pool_id: int) -> LeaveEntitlementPool | None:
    return db.get(LeaveEntitlementPool, pool_id)


def find_pool_by_code(db: Session, pool_code: str) -> LeaveEntitlementPool | None:
    return db.execute(
        select(LeaveEntitlementPool).where(LeaveEntitlementPool.pool_code == pool_code)
    ).scalars().first()


def create_pool(db: Session, **fields) -> LeaveEntitlementPool:
    row = LeaveEntitlementPool(**fields)
    db.add(row)
    db.flush()
    return row


# --- membership ----------------------------------------------------------------------------


def find_membership(db: Session, leave_type_id: int) -> LeaveTypePoolMember | None:
    return db.get(LeaveTypePoolMember, leave_type_id)


def list_members(db: Session, pool_id: int) -> list[LeaveTypePoolMember]:
    return list(
        db.execute(select(LeaveTypePoolMember).where(LeaveTypePoolMember.pool_id == pool_id)).scalars()
    )


def list_all_memberships(db: Session) -> list[LeaveTypePoolMember]:
    return list(db.execute(select(LeaveTypePoolMember)).scalars())


def set_membership(db: Session, leave_type_id: int, pool_id: int | None, actor_id: int | None) -> None:
    """`pool_id=None` takes the type out of its pool. A type belongs to one pool at most."""
    existing = find_membership(db, leave_type_id)
    if pool_id is None:
        if existing is not None:
            db.delete(existing)
        return
    if existing is None:
        db.add(LeaveTypePoolMember(leave_type_id=leave_type_id, pool_id=pool_id, created_by=actor_id))
    else:
        existing.pool_id = pool_id
    db.flush()


# --- restrictions --------------------------------------------------------------------------


def create_restriction(db: Session, **fields) -> LeaveBalanceRestriction:
    row = LeaveBalanceRestriction(**fields)
    db.add(row)
    db.flush()
    return row


def find_restriction(db: Session, restriction_id: int) -> LeaveBalanceRestriction | None:
    return db.get(LeaveBalanceRestriction, restriction_id)


def list_restrictions(
    db: Session, *, employee_id: int | None = None, leave_year_id: int | None = None,
    state: str | None = None, leave_type_id: int | None = None, pool_id: int | None = None,
) -> list[LeaveBalanceRestriction]:
    stmt = select(LeaveBalanceRestriction)
    if employee_id is not None:
        stmt = stmt.where(LeaveBalanceRestriction.employee_id == employee_id)
    if leave_year_id is not None:
        stmt = stmt.where(LeaveBalanceRestriction.leave_year_id == leave_year_id)
    if state is not None:
        stmt = stmt.where(LeaveBalanceRestriction.state == state)
    if leave_type_id is not None:
        stmt = stmt.where(LeaveBalanceRestriction.leave_type_id == leave_type_id)
    if pool_id is not None:
        stmt = stmt.where(LeaveBalanceRestriction.pool_id == pool_id)
    return list(db.execute(stmt.order_by(LeaveBalanceRestriction.start_date.desc())).scalars())


def list_expired_active(db: Session, as_of: date) -> list[LeaveBalanceRestriction]:
    """Restrictions whose window has passed but which nothing has marked released yet.

    The balance already ignores them — this is bookkeeping, not the rule, which is why a
    late or failed job can never keep days held back.
    """
    return list(
        db.execute(
            select(LeaveBalanceRestriction).where(
                LeaveBalanceRestriction.state == "ACTIVE",
                LeaveBalanceRestriction.end_date < as_of,
            )
        ).scalars()
    )
