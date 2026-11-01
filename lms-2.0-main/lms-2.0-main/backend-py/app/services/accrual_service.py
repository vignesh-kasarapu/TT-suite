"""Leave accrual: the joining-period credit (BR-13) and the periodic accrual job (LMS-055).

Two rules hold the whole file together:

* **An accrual period is the unit of entitlement.** Periods are anchored to the leave year,
  not the calendar: with a 1 April year, quarters run Apr-Jun / Jul-Sep / Oct-Dec / Jan-Mar
  and the annual period is the leave year itself. On the leave year's first day all three
  frequencies fall due at once, which is the correct boundary behaviour.
* **A period is credited exactly once.** A joiner gets the eligible fraction of the period
  they join in, and the periodic job then skips that same period for them — so the joining
  period can never be paid twice (BR-13). Everything else is keyed idempotently.
"""
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.dao import employee_dao, ledger_dao, leave_type_dao, leave_year_dao, scheduled_job_run_dao
from app.services import rounding_policy

PERIODS_PER_YEAR = {"MONTHLY": 12, "QUARTERLY": 4, "ANNUAL": 1}
_DAY = timedelta(days=1)

#: Types the periodic job never credits, whatever their configuration says. Comp-off is
#: earned against approved extra work (comp_off_service), and LOP is never credited at all.
NEVER_ACCRUED_CODES = {"COMP_OFF", "LOP"}


# --- period arithmetic ---------------------------------------------------------------------


def _month_bounds(on_date: date) -> tuple[date, date]:
    last = monthrange(on_date.year, on_date.month)[1]
    return date(on_date.year, on_date.month, 1), date(on_date.year, on_date.month, last)


def _add_months(anchor: date, months: int) -> date:
    """First day of the month `months` after `anchor`'s month."""
    total = (anchor.year * 12 + anchor.month - 1) + months
    return date(total // 12, total % 12 + 1, 1)


def period_bounds(leave_year, method: str, on_date: date) -> tuple[date, date, str]:
    """The accrual period of `method` that contains `on_date`, and its idempotency key.

    Quarters and years are measured from `leave_year.start_date`, so changing the leave-year
    start moves every boundary with it rather than leaving quarters on the calendar.
    """
    if method == "MONTHLY":
        start, end = _month_bounds(on_date)
        return start, end, f"{start:%Y-%m}"

    if method == "QUARTERLY":
        offset = (on_date.year * 12 + on_date.month) - (leave_year.start_date.year * 12 + leave_year.start_date.month)
        quarter_index = offset // 3  # 0-based, counted from the leave year's first month
        start = _add_months(leave_year.start_date, quarter_index * 3)
        end = _add_months(start, 3) - _DAY
        return start, end, f"{leave_year.year_code}:Q{quarter_index + 1}"

    # ANNUAL: the leave year itself.
    return leave_year.start_date, leave_year.end_date, leave_year.year_code


def period_is_due(leave_year, method: str, run_date: date) -> bool:
    """True only on the first day of one of `method`'s periods — the gate that stops a
    monthly job run from paying a quarterly or annual type twelve times a year."""
    start, _end, _key = period_bounds(leave_year, method, run_date)
    return run_date == start


def eligible_fraction(period_start: date, period_end: date, joined: date) -> float:
    """The share of a period an employee was employed for. 1.0 when they joined on or before
    it started, 0.0 when they join after it ends. Day counts come from real dates, so leap
    years and 28/30/31-day months need no special case."""
    if joined <= period_start:
        return 1.0
    if joined > period_end:
        return 0.0
    total_days = (period_end - period_start).days + 1
    eligible_days = (period_end - joined).days + 1
    return eligible_days / total_days


def period_starts(leave_year, method: str, as_of: date) -> list[date]:
    """Every period start of `method` from the leave year's beginning up to `as_of`."""
    starts, cursor = [], leave_year.start_date
    step = {"MONTHLY": 1, "QUARTERLY": 3, "ANNUAL": 12}[method]
    while cursor <= min(as_of, leave_year.end_date):
        starts.append(cursor)
        cursor = _add_months(cursor, step)
    return starts


def expected_to_date(leave_year, method: str, annual_entitlement: float, joined: date, as_of: date) -> float:
    """What this employee should hold of one leave type by `as_of`, under BR-13: the joining
    period prorated, every later period in full, nothing for periods before they joined.

    The correction script compares this with the ledger; the accrual job builds the same
    figure one period at a time.
    """
    per_period = float(annual_entitlement) / PERIODS_PER_YEAR[method]
    total = 0.0
    for start in period_starts(leave_year, method, as_of):
        _s, end, _key = period_bounds(leave_year, method, start)
        if joined <= start:
            total += per_period
        elif joined <= end:
            total += rounding_policy.apply(per_period * eligible_fraction(start, end, joined))
    return round(total, 2)


# --- the joining credit (BR-13/BR-14) ------------------------------------------------------


def post_opening_pro_rata(db: Session, employee_id: int) -> None:
    """BR-13: the joining **period's** share of entitlement, posted once on onboarding.

    Not the whole remaining leave year: the rest of the year arrives period by period from
    `run_periodic_accrual`, which skips this employee's joining period so the same days are
    never credited twice. BR-14 rounding lives in `rounding_policy` (one line to change).
    """
    leave_year = leave_year_dao.find_current(db)
    employee = employee_dao.find_by_id(db, employee_id)
    period_key = f"OPENING:{leave_year.year_code}:{employee_id}"

    if scheduled_job_run_dao.find_by_type_and_period(db, "ACCRUAL", period_key) is not None:
        return  # NFR-16 idempotency guard

    joined = employee.date_of_joining
    for policy in leave_type_dao.list_balance_affecting_policies(db):
        leave_type = leave_type_dao.find_by_id(db, policy.leave_type_id)
        if leave_type is None or leave_type.type_code.upper() in NEVER_ACCRUED_CODES:
            continue
        config = leave_type_dao.find_accrual_config(db, policy.leave_type_id)
        method = (config.accrual_method if config else "ANNUAL") or "ANNUAL"
        per_period = float(policy.annual_entitlement) / PERIODS_PER_YEAR[method]

        start, end, _key = period_bounds(leave_year, method, max(joined, leave_year.start_date))
        credit = rounding_policy.apply(per_period * eligible_fraction(start, end, joined))
        if credit <= 0:
            continue
        ledger_dao.create_entry(
            db, employee_id=employee_id, leave_type_id=policy.leave_type_id, leave_year_id=leave_year.leave_year_id,
            entry_type="OPENING_PRO_RATA_CREDIT", quantity=credit, source_reference=f"onboarding:{employee_id}",
            is_system_actor=True,
        )

    scheduled_job_run_dao.create(db, job_type="ACCRUAL", period_key=period_key, status="SUCCESS", finished_at=datetime.now(timezone.utc))
    db.commit()


def post_entitlement_revision(
    db: Session, leave_type_id: int, old_entitlement: float, new_entitlement: float, actor_id: int | None
) -> int:
    """An entitlement edit must reach balances that already exist. Posts the
    difference to every active employee for the current leave year, scaled by
    the same joining-date pro-rata ratio the opening credit used (BR-13), so
    a mid-year joiner gets a proportionate share. Returns employees adjusted."""
    delta = float(new_entitlement) - float(old_entitlement)
    if delta == 0:
        return 0
    leave_year = leave_year_dao.find_current(db)
    total_days_in_year = (leave_year.end_date - leave_year.start_date).days + 1
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    adjusted = 0
    for employee in employee_dao.list_active(db):
        days_from_join = (leave_year.end_date - employee.date_of_joining).days + 1
        ratio = max(min(days_from_join / total_days_in_year, 1), 0)
        quantity = round(delta * ratio, 1)
        if quantity == 0:
            continue
        ledger_dao.create_entry(
            db, employee_id=employee.employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year.leave_year_id,
            entry_type="ENTITLEMENT_REVISION_ADJUSTMENT", quantity=quantity,
            source_reference=f"entitlement_revision:{leave_type_id}:{employee.employee_id}:{stamp}",
            actor_id=actor_id, is_system_actor=actor_id is None,
            reason=f"Annual entitlement changed from {float(old_entitlement):g} to {float(new_entitlement):g} days.",
        )
        adjusted += 1
    return adjusted


# --- the periodic job ----------------------------------------------------------------------


def run_periodic_accrual(db: Session, run_date: date | None = None, job_period_key: str | None = None) -> None:
    """LMS-055: credit every leave type whose period starts on `run_date`.

    A monthly run no longer pays quarterly and annual types: `period_is_due` gates each
    config by its own frequency. Credits are keyed per
    (method, period, leave type, employee), so a retry — or a second run on the same day —
    adds nothing. An employee whose joining period is the one being credited is skipped:
    their joining credit already covered it (BR-13).
    """
    run_date = run_date or datetime.now(timezone.utc).date()
    job_period_key = job_period_key or f"ACCRUAL:{run_date.isoformat()}"

    job_run = scheduled_job_run_dao.find_by_type_and_period(db, "ACCRUAL", job_period_key)
    if job_run is not None:
        if job_run.status == "SUCCESS":
            return  # already completed for this period
        job_run.status = "RUNNING"
        job_run.error_message = None
        scheduled_job_run_dao.save(db, job_run)
    else:
        job_run = scheduled_job_run_dao.create(db, job_type="ACCRUAL", period_key=job_period_key, status="RUNNING")

    try:
        leave_year = leave_year_dao.find_current(db)
        configs = leave_type_dao.list_all_accrual_configs(db)
        policies = {p.leave_type_id: p for p in leave_type_dao.list_all_policies(db)}
        types = {t.leave_type_id: t for t in leave_type_dao.list_all(db)}
        employees = employee_dao.list_active(db)

        for cfg in configs:
            policy = policies.get(cfg.leave_type_id)
            leave_type = types.get(cfg.leave_type_id)
            if policy is None or leave_type is None:
                continue
            if leave_type.type_code.upper() in NEVER_ACCRUED_CODES or not leave_type.is_balance_affecting:
                continue
            method = cfg.accrual_method or "ANNUAL"
            if method not in PERIODS_PER_YEAR or not period_is_due(leave_year, method, run_date):
                continue

            period_start, period_end, period_key = period_bounds(leave_year, method, run_date)
            per_period = float(policy.annual_entitlement) / PERIODS_PER_YEAR[method]

            for employee in employees:
                # BR-13: the joining period was already paid by the joining credit.
                if employee.date_of_joining > period_start:
                    continue
                unique_key = f"accrual:{method}:{period_key}:{cfg.leave_type_id}:{employee.employee_id}"
                if ledger_dao.find_by_source_reference(db, unique_key) is not None:
                    continue  # idempotent
                ledger_dao.create_entry(
                    db, employee_id=employee.employee_id, leave_type_id=cfg.leave_type_id,
                    leave_year_id=leave_year.leave_year_id, entry_type="PERIODIC_ACCRUAL_CREDIT",
                    quantity=per_period, source_reference=unique_key, is_system_actor=True,
                )
        job_run.status = "SUCCESS"
    except Exception as exc:
        job_run.status = "FAILED"
        job_run.error_message = str(exc)
        raise
    finally:
        job_run.finished_at = datetime.now(timezone.utc)
        db.commit()
