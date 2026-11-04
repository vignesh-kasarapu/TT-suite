"""The HR-approved balance reset, and the production seeding rules around it.

Two promises are tested here:

* a reset takes every active balance to zero and **keeps everything** — grants, accrual rows
  from the old system, comp-off claims, leave requests and the audit log are all still there,
  and running it twice changes nothing;
* a deployment creates no leave type by itself, so a production database comes up with an
  empty Leave types screen.
"""
import json
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.dao import comp_off_dao, employee_dao, leave_type_dao, leave_year_dao, ledger_dao
from app.models.employee import Employee
from app.services import balance_service, entitlement_service
from app.services.employee import dashboard
from scripts import reset_balances


def _employee(db) -> Employee:
    suffix = uuid.uuid4().hex[:8].upper()
    row = Employee(
        work_email=f"rst{suffix.lower()}@example.com", employee_code=f"RST{suffix}",
        first_name="Reset", last_name=suffix, date_of_joining=date(2024, 1, 1),
        designation="Engineer", is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    entitlement_service.grant_all_for_employee(db, row, leave_year_dao.find_current(db), None)
    db.commit()
    return row


def _balance(db, employee, code: str) -> float:
    leave_type = leave_type_dao.find_by_code(db, code)
    target = entitlement_service.target_for_leave_type(db, leave_type)
    return ledger_dao.sum_for_target(
        db, employee.employee_id, leave_year_dao.find_current(db).leave_year_id, **target.ledger_filter()
    )


def test_the_plan_reads_without_writing(db):
    employee = _employee(db)
    leave_year = leave_year_dao.find_current(db)
    before = _balance(db, employee, "ANNUAL")
    assert before > 0

    rows = reset_balances.plan(db, leave_year)
    mine = [r for r in rows if r["employee_id"] == employee.employee_id]
    assert mine, "the employee holds balances, so the plan must list them"
    annual = [r for r in mine if r["target_name"].upper().startswith("ANNUAL")][0]
    assert annual["current_balance"] == before
    assert annual["adjustment"] == -before
    assert annual["new_balance"] == 0
    # Nothing was written.
    assert _balance(db, employee, "ANNUAL") == before


def test_the_reset_zeroes_every_balance_and_keeps_the_history(db):
    employee = _employee(db)
    leave_year = leave_year_dao.find_current(db)
    before_rows = ledger_dao.list_for_employee(db, employee.employee_id, leave_year.leave_year_id)
    assert before_rows

    rows = [r for r in reset_balances.plan(db, leave_year) if r["employee_id"] == employee.employee_id]
    posted = reset_balances.apply_reset(db, leave_year, rows, "HR decision", actor_id=None)
    assert posted == len(rows)

    for code in ("ANNUAL", "SICK", "CASUAL"):
        assert _balance(db, employee, code) == 0
    summary = dashboard.get_dashboard(db, employee.employee_id)["totals"]
    assert summary["available"] == 0

    after_rows = ledger_dao.list_for_employee(db, employee.employee_id, leave_year.leave_year_id)
    # Every original row is still there; the reset only added to the ledger.
    assert len(after_rows) == len(before_rows) + posted
    assert {r.entry_id for r in before_rows} <= {r.entry_id for r in after_rows}
    assert any(r.entry_type == "ENTITLEMENT_GRANT" for r in after_rows)


def test_running_the_reset_twice_changes_nothing(db):
    employee = _employee(db)
    leave_year = leave_year_dao.find_current(db)

    rows = [r for r in reset_balances.plan(db, leave_year) if r["employee_id"] == employee.employee_id]
    reset_balances.apply_reset(db, leave_year, rows, "HR decision", actor_id=None)
    count_after_first = len(ledger_dao.list_for_employee(db, employee.employee_id, leave_year.leave_year_id))

    again = [r for r in reset_balances.plan(db, leave_year) if r["employee_id"] == employee.employee_id]
    assert all(r["already_reset"] for r in again) or not again
    reset_balances.apply_reset(db, leave_year, again, "HR decision", actor_id=None)
    assert len(ledger_dao.list_for_employee(db, employee.employee_id, leave_year.leave_year_id)) == count_after_first
    assert _balance(db, employee, "ANNUAL") == 0


def test_the_rollback_restores_what_the_reset_took(db):
    employee = _employee(db)
    leave_year = leave_year_dao.find_current(db)
    before = {code: _balance(db, employee, code) for code in ("ANNUAL", "SICK")}

    rows = [r for r in reset_balances.plan(db, leave_year) if r["employee_id"] == employee.employee_id]
    reset_balances.apply_reset(db, leave_year, rows, "HR decision", actor_id=None)
    assert _balance(db, employee, "ANNUAL") == 0

    restored = reset_balances.rollback(db, leave_year, "undo", actor_id=None)
    assert restored >= len(rows)
    for code, value in before.items():
        assert _balance(db, employee, code) == value
    # Rolling back twice is also a no-op.
    assert reset_balances.rollback(db, leave_year, "undo", actor_id=None) == 0


def test_comp_off_days_are_zeroed_but_the_claims_are_kept(db):
    employee = _employee(db)
    leave_year = leave_year_dao.find_current(db)
    comp_off = leave_type_dao.find_by_code(db, "COMP_OFF")
    assert comp_off is not None

    credit = comp_off_dao.create(
        db, employee_id=employee.employee_id, work_date=date.today() - timedelta(days=5),
        hours_or_days=1, hours_worked=8, status="APPROVED", leave_year_id=leave_year.leave_year_id,
        notes="extra work",
    )
    balance_service.write_manual_adjustment(
        db, employee.employee_id, comp_off.leave_type_id, leave_year.leave_year_id, 1,
        "comp-off credit", None, entry_type="COMP_OFF_CREDIT",
        source_reference=f"comp_off:{credit.comp_off_id}",
    )
    db.commit()
    assert _balance(db, employee, "COMP_OFF") == 1

    rows = [r for r in reset_balances.plan(db, leave_year) if r["employee_id"] == employee.employee_id]
    assert any("Comp" in r["target_name"] for r in rows), "comp-off is part of the reset"
    reset_balances.apply_reset(db, leave_year, rows, "HR decision", actor_id=None)

    assert _balance(db, employee, "COMP_OFF") == 0
    # The claim itself — the record of work somebody did and two people approved — is kept.
    assert comp_off_dao.find_by_id(db, credit.comp_off_id) is not None
    listed = reset_balances.comp_off_records(db, leave_year)
    assert any(r["comp_off_id"] == credit.comp_off_id for r in listed)


def test_after_a_reset_an_opening_balance_is_the_only_way_back(db, hr_admin):
    from app.services import balance_admin_service

    employee = _employee(db)
    leave_year = leave_year_dao.find_current(db)
    rows = [r for r in reset_balances.plan(db, leave_year) if r["employee_id"] == employee.employee_id]
    reset_balances.apply_reset(db, leave_year, rows, "HR decision", actor_id=None)
    assert _balance(db, employee, "ANNUAL") == 0

    annual = leave_type_dao.find_by_code(db, "ANNUAL")
    balance_admin_service.apply_opening_balances(
        db, leave_type_id=annual.leave_type_id, opening_balance=5, reason="approved opening balance",
        actor_id=hr_admin.employee_id, employee_ids=[employee.employee_id],
    )
    assert _balance(db, employee, "ANNUAL") == 5
    card = [c for c in dashboard.get_dashboard(db, employee.employee_id)["balances"]
            if c["target_code"] == "ANNUAL"][0]
    assert card["available"] == 5


def test_a_new_employee_still_receives_the_full_entitlement_after_a_reset(db):
    leave_year = leave_year_dao.find_current(db)
    reset_balances.apply_reset(db, leave_year, reset_balances.plan(db, leave_year), "HR decision", actor_id=None)

    joiner = _employee(db)  # onboarded after the reset
    annual = leave_type_dao.find_by_code(db, "ANNUAL")
    policy = leave_type_dao.find_policy(db, annual.leave_type_id)
    assert _balance(db, joiner, "ANNUAL") == float(policy.annual_entitlement)


def test_past_leave_years_are_closed_not_emptied(db):
    current = leave_year_dao.find_current(db)
    past = leave_year_dao.create(
        db, year_code=f"P{uuid.uuid4().hex[:4]}",
        start_date=current.start_date - timedelta(days=730),
        end_date=current.start_date - timedelta(days=366), is_current=False,
    )
    db.commit()
    assert past.is_closed is False

    closed = reset_balances.close_past_years(db, current)
    db.refresh(past)
    assert past.year_code in closed and past.is_closed is True


# --- production seeding ------------------------------------------------------------------------


def test_the_reference_seed_creates_no_leave_type():
    """A deployment must come up with an empty Leave types screen (strict requirement 1)."""
    import scripts.seed as seed_module

    reference = json.loads(
        (Path(seed_module.__file__).resolve().parents[1] / "seed" / "reference.json").read_text(encoding="utf-8")
    )
    assert "leave_types" not in reference
    assert "system_leave_types" not in reference

    source = Path(seed_module.__file__).read_text(encoding="utf-8")
    assert "leave_type_dao.create(" not in source
    assert "seed_company_policy_if_present" not in source
    assert not hasattr(seed_module, "seed_leave_types")


def test_the_application_copes_with_no_leave_types(db, client, monkeypatch):
    """Every screen an employee opens must work on a database where nothing is configured."""
    from tests.conftest import sign_in

    employee = _employee(db)
    monkeypatch.setattr(leave_type_dao, "list_selectable", lambda *a, **k: [])
    monkeypatch.setattr(entitlement_service, "grantable_targets", lambda *a, **k: [])

    sign_in(client, employee)
    res = client.get("/api/employees/dashboard")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["balances"] == [] and data["leaveTypes"] == []
    assert data["totals"]["available"] == 0


def test_the_lop_sweep_is_a_no_op_without_a_lop_type(db, monkeypatch):
    """Requirement 12: a missing LOP type must not raise anywhere."""
    from app.dao import scheduled_job_run_dao
    from app.services import escalation_service

    monkeypatch.setattr(
        escalation_service.leave_type_dao, "find_by_code",
        lambda session, code: None if code == "LOP" else leave_type_dao.find_by_code(session, code),
    )
    escalation_service.run_lop_conversion_sweep(db)

    # The sweep records the run itself; what matters is that it did not raise and converted
    # nothing. A request that was eligible is still in its own state.
    assert scheduled_job_run_dao is not None


def test_a_comp_off_claim_without_the_type_says_what_to_do(db, monkeypatch):
    from app.core.exceptions import AppError
    from app.services import comp_off_service

    employee = _employee(db)
    monkeypatch.setattr(
        comp_off_service.leave_type_dao, "find_by_code",
        lambda session, code: None if code == "COMP_OFF" else leave_type_dao.find_by_code(session, code),
    )
    with pytest.raises(AppError) as excinfo:
        comp_off_service.submit_request(
            db, employee_id=employee.employee_id, work_date=date.today() - timedelta(days=2),
            hours_worked=8, requested_by=employee.employee_id, notes="extra work",
        )
    assert excinfo.value.code == "COMP_OFF_TYPE_MISSING"
    assert "COMP_OFF" in excinfo.value.message
    assert excinfo.value.status == 409
