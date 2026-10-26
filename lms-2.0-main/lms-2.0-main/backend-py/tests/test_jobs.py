"""Covers Phase 4's scheduled jobs: SLA escalation, LOP conversion,
periodic-accrual idempotency, and carry-forward's cap/lapse math. Mocks
notification_service.notify to a no-op — these tests are about ledger/state
arithmetic, not live SMTP delivery (already covered structurally by
notification_service's own contract, and hitting real Gmail here is slow and
rate-limited)."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.dao import ledger_dao, leave_request_dao, leave_year_dao
from app.models.employee import Employee
from app.services import accrual_service, carry_forward_service, escalation_service, notification_service, role_assignment_service


@pytest.fixture(autouse=True)
def _no_real_email(monkeypatch):
    monkeypatch.setattr(notification_service, "_send_email_best_effort", lambda *a, **k: None)


def _make_employee(db, *, manager_id=None, role_code="EMPLOYEE"):
    suffix = uuid.uuid4().hex[:8].upper()
    employee = Employee(
        work_email=f"job{suffix.lower()}@example.com", employee_code=f"JOB{suffix}",
        first_name="Job", last_name=suffix, date_of_joining=date(2025, 1, 1), designation="Engineer",
        reporting_manager_id=manager_id, is_active=True,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    role_assignment_service.assign_role(db, employee.employee_id, role_code, employee.employee_id)
    return employee


def test_sla_breach_escalates_to_hr_admin_when_manager_has_no_manager(db):
    manager = _make_employee(db, role_code="MANAGER")
    report = _make_employee(db, manager_id=manager.employee_id)
    hr_admin = _make_employee(db, role_code="HR_ADMIN")

    request = leave_request_dao.create(
        db, employee_id=report.employee_id, leave_type_id=1, leave_year_id=1,
        start_date=date(2027, 6, 1), end_date=date(2027, 6, 1), reason="sla test", state="PENDING_MANAGER",
        deducted_days=1, current_approver_id=manager.employee_id,
        sla_started_at=datetime.now(timezone.utc) - timedelta(days=10),
    )
    db.commit()

    escalation_service.run_sla_sweep(db)
    db.commit()
    db.refresh(request)

    # manager has no manager of their own -> falls back to the active
    # HR_ADMIN queue (lowest employee_id), never stays put, never self-approves.
    assert request.current_approver_id is not None
    from app.dao import role_dao

    assert role_dao.has_role(db, request.current_approver_id, "HR_ADMIN")


def test_lop_conversion_sweep_converts_expired_rejection(db):
    employee = _make_employee(db)
    from app.dao import leave_type_dao

    lop_type = leave_type_dao.find_by_code(db, "LOP")
    request = leave_request_dao.create(
        db, employee_id=employee.employee_id, leave_type_id=1, leave_year_id=1,
        start_date=date(2027, 6, 1), end_date=date(2027, 6, 1), reason="lop test",
        state="REJECTED_PENDING_WITHDRAWAL", deducted_days=1,
        withdrawal_window_end=datetime.now(timezone.utc) - timedelta(days=1),
    )
    db.commit()

    escalation_service.run_lop_conversion_sweep(db)
    db.commit()
    db.refresh(request)

    assert request.state == "LOP_APPLIED"
    assert request.leave_type_id == lop_type.leave_type_id
    assert request.prior_leave_type_id == 1

    from app.dao import lop_record_dao

    record = lop_record_dao.find_by_request_id(db, request.request_id)
    assert record is not None

    # Re-running must be a no-op (idempotent per request via LopRecord).
    escalation_service.run_lop_conversion_sweep(db)
    db.commit()
    db.refresh(request)
    assert request.state == "LOP_APPLIED"


def test_periodic_accrual_is_idempotent_per_period(db):
    employee = _make_employee(db)
    period_key = f"TEST-{uuid.uuid4().hex[:8]}"

    accrual_service.run_periodic_accrual(db, period_key)
    db.commit()
    leave_year = leave_year_dao.find_current(db)
    balance_after_first = ledger_dao.sum_quantity(db, employee.employee_id, 1, leave_year.leave_year_id)
    assert balance_after_first > 0  # ANNUAL is MONTHLY-accrued, ANNUAL/12 > 0

    accrual_service.run_periodic_accrual(db, period_key)
    db.commit()
    balance_after_second = ledger_dao.sum_quantity(db, employee.employee_id, 1, leave_year.leave_year_id)
    assert balance_after_second == balance_after_first


def test_carry_forward_caps_and_lapses_excess(db):
    """Uses a fully isolated, fabricated closing/next leave-year pair — never
    the shared dev DB's real "current" leave year — because
    run_year_end_carry_forward unconditionally flips is_current/is_closed on
    whatever pair it's given, and every other test in this suite depends on
    leave_year_dao.find_current() still returning the real current year."""
    employee = _make_employee(db)
    from app.dao import leave_type_dao

    policy = leave_type_dao.find_policy(db, 1)  # ANNUAL: cap=10 per seed data
    suffix = uuid.uuid4().hex[:4]  # year_code is STRING(10) — "C"/"N" + 4 hex chars fits
    # A random, wide-spread starting year (not a fixed date range) so this
    # test's fabricated years never collide with a leftover pair from a
    # previous run — find_next_after would otherwise match the wrong "next
    # year" row (same start_date) and the credit lands on the wrong id.
    base_year = 2200 + (int(suffix, 16) % 5000)
    closing_year = leave_year_dao.create(
        db, year_code=f"C{suffix}", start_date=date(base_year, 4, 1), end_date=date(base_year + 1, 3, 31), is_current=False,
    )
    next_year = leave_year_dao.create(
        db, year_code=f"N{suffix}", start_date=date(base_year + 1, 4, 1), end_date=date(base_year + 2, 3, 31), is_current=False,
    )

    # Post a balance well above the cap so both credit and lapse fire.
    ledger_dao.create_entry(
        db, employee_id=employee.employee_id, leave_type_id=1, leave_year_id=closing_year.leave_year_id,
        entry_type="OPENING_PRO_RATA_CREDIT", quantity=20, source_reference=f"test-seed:{employee.employee_id}",
        is_system_actor=True,
    )
    db.commit()

    carry_forward_service.run_year_end_carry_forward(db, closing_year.leave_year_id)
    db.commit()

    cap = float(policy.carry_forward_cap)
    carried = ledger_dao.sum_quantity(db, employee.employee_id, 1, next_year.leave_year_id)
    assert carried == cap

    lapse_key = f"carry_forward:{closing_year.leave_year_id}:1:{employee.employee_id}"
    lapse_row = ledger_dao.find_by_source_reference(db, lapse_key)
    assert lapse_row is not None

    db.refresh(closing_year)
    assert closing_year.is_closed is True

    # The job unconditionally sets next_year.is_current = True — with no DB
    # uniqueness constraint on is_current, leaving that set would give the
    # shared dev DB two "current" leave years and break
    # leave_year_dao.find_current() (a scalar_one_or_none()) for every other
    # test. Clear it before this test ends.
    db.refresh(next_year)
    next_year.is_current = False
    db.commit()
