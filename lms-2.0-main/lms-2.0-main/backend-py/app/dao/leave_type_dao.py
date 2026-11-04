from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.employee_extras import EmployeeLeaveTypeExclusion
from app.models.leave_config import LeaveAccrualConfig, LeavePolicy, LeaveType


def list_balance_affecting(db: Session) -> list[LeaveType]:
    """Deactivation-time settlement snapshot: every balance-affecting leave
    type (Node's `LeaveType.findAll({where: {is_balance_affecting: true}})`)."""
    return list(db.execute(select(LeaveType).where(LeaveType.is_balance_affecting.is_(True))).scalars())


def list_balance_affecting_policies(db: Session) -> list[LeavePolicy]:
    """Policies of types that hold a balance and have not been archived."""
    return list(
        db.execute(
            select(LeavePolicy).join(LeaveType, LeaveType.leave_type_id == LeavePolicy.leave_type_id).where(
                LeaveType.is_balance_affecting.is_(True), LeaveType.archived_at.is_(None)
            )
        ).scalars()
    )


def list_all_policies(db: Session) -> list[LeavePolicy]:
    return list(db.execute(select(LeavePolicy)).scalars())


def list_carry_forward_policies(db: Session) -> list[LeavePolicy]:
    return list(db.execute(select(LeavePolicy).where(LeavePolicy.carries_forward.is_(True))).scalars())


def list_all_accrual_configs(db: Session) -> list[LeaveAccrualConfig]:
    return list(db.execute(select(LeaveAccrualConfig)).scalars())


def find_by_code(db: Session, type_code: str) -> LeaveType | None:
    # Case-insensitive, as under MySQL's collation (codes are seeded upper-case).
    return db.execute(select(LeaveType).where(func.lower(LeaveType.type_code) == type_code.strip().lower())).scalars().first()


def find_by_id(db: Session, leave_type_id: int) -> LeaveType | None:
    return db.get(LeaveType, leave_type_id)


def list_all(db: Session, include_archived: bool = True) -> list[LeaveType]:
    """Every type, archived ones included by default: a report, a ledger row or an old
    request still has to be able to name the type it points at."""
    stmt = select(LeaveType)
    if not include_archived:
        stmt = stmt.where(LeaveType.archived_at.is_(None))
    return list(db.execute(stmt.order_by(LeaveType.type_name)).scalars())


def list_selectable(db: Session, include_archived: bool = False) -> list[LeaveType]:
    """What an employee may apply for. An archived type is out — it keeps its history but
    nobody can book it again."""
    stmt = select(LeaveType).where(LeaveType.is_selectable_by_employee.is_(True))
    if not include_archived:
        stmt = stmt.where(LeaveType.archived_at.is_(None))
    return list(db.execute(stmt).scalars())


def list_archived(db: Session) -> list[LeaveType]:
    return list(
        db.execute(
            select(LeaveType).where(LeaveType.archived_at.is_not(None)).order_by(LeaveType.type_name)
        ).scalars()
    )


def create(db: Session, **fields) -> LeaveType:
    row = LeaveType(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def find_policy(db: Session, leave_type_id: int) -> LeavePolicy | None:
    return db.execute(select(LeavePolicy).where(LeavePolicy.leave_type_id == leave_type_id)).scalar_one_or_none()


def create_policy(db: Session, **fields) -> LeavePolicy:
    row = LeavePolicy(**fields)
    db.add(row)
    db.commit()
    return row


def find_accrual_config(db: Session, leave_type_id: int) -> LeaveAccrualConfig | None:
    return db.execute(
        select(LeaveAccrualConfig).where(LeaveAccrualConfig.leave_type_id == leave_type_id)
    ).scalar_one_or_none()


def create_accrual_config(db: Session, **fields) -> LeaveAccrualConfig:
    row = LeaveAccrualConfig(**fields)
    db.add(row)
    db.commit()
    return row


def excluded_type_ids(db: Session, employee_id: int) -> set[int]:
    """Leave types HR marked as not applicable to this employee."""
    return set(
        db.execute(
            select(EmployeeLeaveTypeExclusion.leave_type_id).where(EmployeeLeaveTypeExclusion.employee_id == employee_id)
        ).scalars()
    )


def replace_exclusions(db: Session, employee_id: int, leave_type_ids: set[int]) -> None:
    db.execute(delete(EmployeeLeaveTypeExclusion).where(EmployeeLeaveTypeExclusion.employee_id == employee_id))
    db.add_all(EmployeeLeaveTypeExclusion(employee_id=employee_id, leave_type_id=i) for i in sorted(leave_type_ids))
    db.commit()
