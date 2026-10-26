from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.delegation_watcher import Delegation


def find_active_for_nominator(db: Session, nominator_id: int, on_date: date) -> Delegation | None:
    """Used by getFirstStageApprover/cancellation re-routing — an active
    (not revoked, date-window-covering) delegation for this nominator."""
    return db.execute(
        select(Delegation).where(
            Delegation.nominator_id == nominator_id,
            Delegation.from_date <= on_date,
            Delegation.to_date >= on_date,
            Delegation.revoked_at.is_(None),
        )
    ).scalars().first()


def find_match_for_audit_context(db: Session, nominator_id: int, delegate_id: int, on_date: date) -> Delegation | None:
    """Used by decide()'s approval-row audit-trail reconstruction. Deliberately
    does NOT filter revoked_at — a request may still be pending after the
    delegation that routed it was revoked; match against what was active when
    the request was originally submitted, most-recent match wins."""
    return db.execute(
        select(Delegation)
        .where(
            Delegation.nominator_id == nominator_id,
            Delegation.delegate_id == delegate_id,
            Delegation.from_date <= on_date,
            Delegation.to_date >= on_date,
        )
        .order_by(Delegation.delegation_id.desc())
    ).scalars().first()


def list_active_for_nominator(db: Session, nominator_id: int) -> list[Delegation]:
    return list(
        db.execute(
            select(Delegation).where(Delegation.nominator_id == nominator_id, Delegation.revoked_at.is_(None))
        ).scalars()
    )


def create(db: Session, **fields) -> Delegation:
    row = Delegation(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def find_by_id(db: Session, delegation_id: int) -> Delegation | None:
    return db.get(Delegation, delegation_id)


def save(db: Session, row: Delegation) -> Delegation:
    db.commit()
    db.refresh(row)
    return row


def list_mine(db: Session, employee_id: int) -> list[Delegation]:
    return list(
        db.execute(
            select(Delegation)
            .where(or_(Delegation.nominator_id == employee_id, Delegation.delegate_id == employee_id))
            .order_by(Delegation.from_date.desc())
        ).scalars()
    )


def list_all(db: Session) -> list[Delegation]:
    return list(db.execute(select(Delegation).order_by(Delegation.from_date.desc())).scalars())


def revoke_all_for_employee(db: Session, employee_id: int) -> None:
    """Revokes every active delegation naming this employee as either party —
    used at deactivation time so a delegation to/from a deactivated person no
    longer reads as active."""
    from datetime import datetime, timezone

    from sqlalchemy import update

    db.execute(
        update(Delegation)
        .where(
            or_(Delegation.nominator_id == employee_id, Delegation.delegate_id == employee_id),
            Delegation.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(timezone.utc))
    )
    db.flush()
