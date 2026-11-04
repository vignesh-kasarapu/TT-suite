"""The one place that decides what an employee is entitled to and what is left of it.

Two rules hold the whole file together:

* **The full configured entitlement, granted once.** A leave year's entitlement does not
  depend on the joining date, the joining month, when the employee record was created, which
  order people were provisioned in, or whether any job has run. Somebody who joins on
  31 December of a January-December year gets the same days as somebody who was there all
  year. There is no proration and no periodic accrual anywhere in this file.
* **A balance is read, never stored.** Every number below is summed from `leave_ledger`
  (BR-07) and from the restrictions table, so a dashboard, an approval and a report that ask
  the same question get the same answer.

A **target** is what a balance belongs to: a leave type, or the shared pool a leave type
draws on. Sick and Casual sharing nine days is one pool with two member types — the grant,
the deduction and the balance all happen at the pool, so the days can never be counted
twice.
"""
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, entitlement_dao, leave_type_dao, ledger_dao, leave_request_dao
from app.services import audit_service

#: Types that are never granted an entitlement: Loss of Pay is unpaid by definition, and
#: Compensatory Off is earned one approved claim at a time through its own workflow.
NEVER_GRANTED_CODES = frozenset({"LOP", "COMP_OFF"})

#: What each kind of ledger row means. The dashboard shows these separately, so an employee
#: can see where their days came from and where they went.
ENTITLEMENT_ENTRY_TYPES = ("ENTITLEMENT_GRANT",)
OPENING_ENTRY_TYPES = (
    "OPENING_BALANCE_ADJUSTMENT",
    # Historical rows from the accrual model this replaced. They still count towards the
    # balance — they are days people were given — but nothing posts them any more.
    "OPENING_PRO_RATA_CREDIT",
    "PERIODIC_ACCRUAL_CREDIT",
    "ENTITLEMENT_REVISION_ADJUSTMENT",
)
CARRY_FORWARD_ENTRY_TYPES = ("CARRY_FORWARD_CREDIT", "CARRY_FORWARD_LAPSE_DEBIT")
#: HR's own corrections, the opening balances they post, and the approved reset that
#: discontinued the old balances. All of them move the balance and none of them is leave.
ADJUSTMENT_ENTRY_TYPES = ("MANUAL_ADJUSTMENT", "BALANCE_RESET_ADJUSTMENT", "BALANCE_RESET_REVERSAL")
CREDIT_ENTRY_TYPES = ("COMP_OFF_CREDIT", "CANCELLATION_RESTORATION_CREDIT")
USAGE_ENTRY_TYPES = ("LEAVE_DEDUCTION_DEBIT",)
ENCASHMENT_ENTRY_TYPES = ("ENCASHMENT_DEBIT",)

#: BR-10: days committed to a request that is waiting for a decision. Not leave taken, but
#: not available either.
OPEN_COMMITMENT_STATES = ("PENDING_MANAGER", "PENDING_HR", "CANCELLATION_REQUESTED")


@dataclass(frozen=True)
class BalanceTarget:
    """A leave type, or the pool several leave types share."""

    kind: str  # "POOL" | "TYPE"
    key: str
    name: str
    code: str
    entitlement_days: float | None
    carries_forward: bool
    carry_forward_cap: float | None
    pool_id: int | None = None
    leave_type_id: int | None = None
    leave_type_ids: tuple[int, ...] = field(default_factory=tuple)

    @property
    def is_pool(self) -> bool:
        return self.kind == "POOL"

    def ledger_filter(self) -> dict:
        """Keyword arguments for `ledger_dao.sum_for_target` / `list_for_target`."""
        return {"pool_id": self.pool_id} if self.is_pool else {"leave_type_id": self.leave_type_id}


# --- resolving targets ---------------------------------------------------------------------


def target_for_leave_type(db: Session, leave_type) -> BalanceTarget:
    """The target a leave type's days live in: its pool when it has one, else itself."""
    membership = entitlement_dao.find_membership(db, leave_type.leave_type_id)
    if membership is not None:
        pool = entitlement_dao.find_pool(db, membership.pool_id)
        if pool is not None and pool.archived_at is None:
            return target_for_pool(db, pool)
    policy = leave_type_dao.find_policy(db, leave_type.leave_type_id)
    return BalanceTarget(
        kind="TYPE",
        key=f"type:{leave_type.leave_type_id}",
        name=leave_type.type_name,
        code=leave_type.type_code,
        entitlement_days=float(policy.annual_entitlement) if policy is not None else None,
        carries_forward=bool(policy.carries_forward) if policy is not None else False,
        carry_forward_cap=float(policy.carry_forward_cap) if policy is not None and policy.carry_forward_cap is not None else None,
        leave_type_id=leave_type.leave_type_id,
        leave_type_ids=(leave_type.leave_type_id,),
    )


def target_for_pool(db: Session, pool) -> BalanceTarget:
    members = entitlement_dao.list_members(db, pool.pool_id)
    return BalanceTarget(
        kind="POOL",
        key=f"pool:{pool.pool_id}",
        name=pool.pool_name,
        code=pool.pool_code,
        entitlement_days=float(pool.annual_entitlement),
        carries_forward=bool(pool.carries_forward),
        carry_forward_cap=float(pool.carry_forward_cap) if pool.carry_forward_cap is not None else None,
        pool_id=pool.pool_id,
        leave_type_ids=tuple(m.leave_type_id for m in members),
    )


def is_grantable(leave_type) -> bool:
    return (
        leave_type.is_balance_affecting
        and leave_type.archived_at is None
        and leave_type.type_code.upper() not in NEVER_GRANTED_CODES
    )


def grantable_targets(db: Session) -> list[BalanceTarget]:
    """Every target that should hold an entitlement, each one exactly once. Two pooled
    types produce one target, which is what stops a shared pool being granted twice."""
    targets: dict[str, BalanceTarget] = {}
    for leave_type in leave_type_dao.list_all(db, include_archived=False):
        if not is_grantable(leave_type):
            continue
        target = target_for_leave_type(db, leave_type)
        if target.entitlement_days is None:
            continue  # no policy configured: nothing to grant, and nothing invented here
        targets.setdefault(target.key, target)
    return list(targets.values())


# --- granting ------------------------------------------------------------------------------


def _grant_reference(target: BalanceTarget, leave_year, employee_id: int) -> str:
    return f"entitlement:{leave_year.leave_year_id}:{target.key}:{employee_id}"


def has_grant(db: Session, employee_id: int, target: BalanceTarget, leave_year) -> bool:
    return ledger_dao.find_by_source_reference(db, _grant_reference(target, leave_year, employee_id)) is not None


def grant_entitlement(
    db: Session, employee, target: BalanceTarget, leave_year, actor_id: int | None = None
) -> float:
    """Grant the full configured entitlement for one target. Returns the days posted, or 0.0
    when the employee already holds this grant — running onboarding twice grants nothing
    twice (idempotent on `source_reference`)."""
    if target.entitlement_days is None or float(target.entitlement_days) <= 0:
        return 0.0
    reference = _grant_reference(target, leave_year, employee.employee_id)
    if ledger_dao.find_by_source_reference(db, reference) is not None:
        return 0.0

    days = float(target.entitlement_days)
    ledger_dao.create_entry(
        db,
        employee_id=employee.employee_id,
        # A pooled entry still names a leave type (the ledger column is NOT NULL and the
        # type is genuine history); the balance is summed by pool_id.
        leave_type_id=target.leave_type_id or target.leave_type_ids[0],
        pool_id=target.pool_id,
        leave_year_id=leave_year.leave_year_id,
        entry_type="ENTITLEMENT_GRANT",
        quantity=days,
        source_reference=reference,
        actor_id=actor_id,
        is_system_actor=actor_id is None,
        reason=f"{target.name}: full entitlement for {leave_year.year_code}.",
    )
    return days


def grant_all_for_employee(db: Session, employee, leave_year, actor_id: int | None = None) -> dict[str, float]:
    """Onboarding: the full entitlement of every grantable target, immediately. No
    scheduler, no proration, no dependency on when the record was created."""
    granted: dict[str, float] = {}
    for target in grantable_targets(db):
        days = grant_entitlement(db, employee, target, leave_year, actor_id)
        if days:
            granted[target.name] = days
    if granted:
        audit_service.record(
            db, action="ENTITLEMENT_GRANTED", entity_type="employees", entity_id=employee.employee_id,
            actor_id=actor_id, is_system_actor=actor_id is None,
            new_value={"leave_year": leave_year.year_code, "granted": granted},
        )
    return granted


def grant_target_to_all_employees(
    db: Session, target: BalanceTarget, leave_year, actor_id: int | None = None
) -> dict[int, float]:
    """A target that has just started existing (a new leave type, a new pool) reaches
    everyone who is already employed, at once.

    Nothing is overwritten: an employee who already holds a grant, an opening balance or any
    other entry for this target is left alone, so this can never disturb a balance HR has
    already decided.
    """
    granted: dict[int, float] = {}
    for employee in employee_dao.list_active(db):
        if _has_any_entry(db, employee.employee_id, target, leave_year):
            continue
        days = grant_entitlement(db, employee, target, leave_year, actor_id)
        if days:
            granted[employee.employee_id] = days
    if granted:
        audit_service.record(
            db, action="ENTITLEMENT_GRANTED_TO_ALL", entity_type="leave_types",
            entity_id=target.leave_type_id or target.pool_id, actor_id=actor_id,
            new_value={"target": target.name, "leave_year": leave_year.year_code, "employees": len(granted),
                       "days_each": target.entitlement_days},
        )
    return granted


def _has_any_entry(db: Session, employee_id: int, target: BalanceTarget, leave_year) -> bool:
    return bool(
        ledger_dao.list_for_target(
            db, employee_id, leave_year.leave_year_id, **target.ledger_filter()
        )
    )


# --- restrictions ---------------------------------------------------------------------------


def restricted_days(
    db: Session, employee_id: int, target: BalanceTarget, leave_year, as_of: date | None = None
) -> float:
    """Days held back right now. A restriction counts only inside its own dates and only
    while it has not been cancelled — an expired one stops counting immediately, with no
    job involved."""
    as_of = as_of or date.today()
    total = 0.0
    for restriction in entitlement_dao.list_restrictions(
        db, employee_id=employee_id, leave_year_id=leave_year.leave_year_id, **_restriction_filter(target)
    ):
        if restriction.state == "CANCELLED":
            continue
        if restriction.start_date <= as_of <= restriction.end_date:
            total += float(restriction.days)
    return round(total, 2)


def _restriction_filter(target: BalanceTarget) -> dict:
    return {"pool_id": target.pool_id} if target.is_pool else {"leave_type_id": target.leave_type_id}


def active_restrictions(
    db: Session, employee_id: int, target: BalanceTarget, leave_year, as_of: date | None = None
) -> list:
    as_of = as_of or date.today()
    return [
        r
        for r in entitlement_dao.list_restrictions(
            db, employee_id=employee_id, leave_year_id=leave_year.leave_year_id, **_restriction_filter(target)
        )
        if r.state != "CANCELLED" and r.start_date <= as_of <= r.end_date
    ]


# --- the balance ------------------------------------------------------------------------------


def summary(
    db: Session, employee_id: int, target: BalanceTarget, leave_year, as_of: date | None = None
) -> dict:
    """Every number a dashboard, an approval or a report needs about one target.

        available = entitlement + carry-forward + credits + adjustments
                    - leave taken - active restrictions - committed days
    """
    ledger_filter = target.ledger_filter()

    def total(entry_types):
        return ledger_dao.sum_for_target(
            db, employee_id, leave_year.leave_year_id, entry_types=entry_types, **ledger_filter
        )

    entitlement = total(ENTITLEMENT_ENTRY_TYPES)
    opening = total(OPENING_ENTRY_TYPES)
    carry_forward = total(CARRY_FORWARD_ENTRY_TYPES)
    adjustments = total(ADJUSTMENT_ENTRY_TYPES)
    credits = total(CREDIT_ENTRY_TYPES)
    encashed = total(ENCASHMENT_ENTRY_TYPES)
    used = -total(USAGE_ENTRY_TYPES)  # debits are negative; usage reads as a positive number

    ledger_balance = ledger_dao.sum_for_target(db, employee_id, leave_year.leave_year_id, **ledger_filter)
    committed = _committed_days(db, employee_id, target, leave_year)
    restricted = restricted_days(db, employee_id, target, leave_year, as_of)

    # Every day this person has held of this target this leave year, however it arrived:
    # the entitlement grant, an opening balance, carry-forward, a comp-off credit or an
    # adjustment HR posted by hand. It is what "x of y used" counts against — the grant
    # alone would read 0 for somebody whose days came from Balance adjustment.
    total_days = round(ledger_balance + used, 2)

    return {
        "target_key": target.key,
        "target_kind": target.kind,
        "target_name": target.name,
        "target_code": target.code,
        "pool_id": target.pool_id,
        "leave_type_id": target.leave_type_id,
        "leave_type_ids": list(target.leave_type_ids),
        "configured_entitlement": target.entitlement_days,
        "entitlement": round(entitlement + opening, 2),
        "carry_forward": round(carry_forward, 2),
        "adjustments": round(adjustments, 2),
        "credits": round(credits, 2),
        "encashed": round(encashed, 2),
        "used": round(used, 2),
        "total_days": total_days,
        "ledger_balance": round(ledger_balance, 2),
        "committed_to_open_requests": round(committed, 2),
        "restricted": restricted,
        "available": round(ledger_balance - committed - restricted, 2),
    }


def _committed_days(db: Session, employee_id: int, target: BalanceTarget, leave_year) -> float:
    """Days reserved by requests still waiting for a decision — summed across every type in
    the pool, so a pending Sick request reserves days a Casual request cannot also use."""
    total = 0.0
    for leave_type_id in (target.leave_type_ids or ((target.leave_type_id,) if target.leave_type_id else ())):
        total += leave_request_dao.sum_deducted_days_in_states(
            db, employee_id, leave_type_id, leave_year.leave_year_id, OPEN_COMMITMENT_STATES
        )
    return total


def summary_for_leave_type(db: Session, employee_id: int, leave_type, leave_year, as_of: date | None = None) -> dict:
    return summary(db, employee_id, target_for_leave_type(db, leave_type), leave_year, as_of)


def totals(summaries: list[dict]) -> dict:
    """The organisation's, a team's or one person's figures, with each pool counted once —
    `summaries` must already hold one entry per target.

    `total` is every day held this year whatever its source; `entitlement` is the policy
    grant and carry-forward alone, which is the smaller number when HR has adjusted a
    balance by hand.
    """
    return {
        "total": round(sum(s["total_days"] for s in summaries), 2),
        "entitlement": round(sum(s["entitlement"] + s["carry_forward"] for s in summaries), 2),
        "used": round(sum(s["used"] for s in summaries), 2),
        "restricted": round(sum(s["restricted"] for s in summaries), 2),
        "committed": round(sum(s["committed_to_open_requests"] for s in summaries), 2),
        "available": round(sum(s["available"] for s in summaries), 2),
    }


def assert_configured(target: BalanceTarget) -> None:
    """§18: a missing policy is a configuration error, never an invented default."""
    if target.entitlement_days is None:
        raise AppError(
            "ENTITLEMENT_NOT_CONFIGURED",
            f"{target.name} has no annual entitlement configured. Set it in Leave types & policy.",
        )
