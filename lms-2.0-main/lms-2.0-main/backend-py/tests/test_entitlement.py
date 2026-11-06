"""The entitlement model: full grant, shared pools, temporary restrictions, archive.

These are the checks the restructure is judged by (§19):

* a joining date never changes what somebody is granted, and neither does the order or the
  moment their record was created;
* Sick and Casual draw on one pool of nine days;
* a restriction holds days back for its period and gives them back by itself;
* existing balances are never overwritten — HR moves them through the opening-balance
  workflow, with a dry run first.
"""
import uuid
from datetime import date, timedelta

import pytest

from app.core.exceptions import AppError
from app.dao import employee_dao, entitlement_dao, leave_type_dao, leave_year_dao, ledger_dao
from app.models.employee import Employee
from app.services import (
    balance_admin_service,
    balance_service,
    entitlement_service,
    leave_type_service,
    restriction_service,
)
from app.services.employee import dashboard


def _employee(db, joined: date, *, suffix: str | None = None) -> Employee:
    suffix = suffix or uuid.uuid4().hex[:8].upper()
    row = Employee(
        work_email=f"ent{suffix.lower()}@example.com", employee_code=f"ENT{suffix}",
        first_name="Ent", last_name=suffix, date_of_joining=joined, designation="Engineer", is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _onboard(db, employee):
    leave_year = leave_year_dao.find_current(db)
    entitlement_service.grant_all_for_employee(db, employee, leave_year, None)
    db.commit()
    return leave_year


def _target(db, code: str):
    leave_type = leave_type_dao.find_by_code(db, code)
    return entitlement_service.target_for_leave_type(db, leave_type)


def _balance(db, employee, code: str) -> dict:
    leave_year = leave_year_dao.find_current(db)
    return entitlement_service.summary(db, employee.employee_id, _target(db, code), leave_year)


# --- A. the joining date never prorates anything ----------------------------------------------


@pytest.mark.parametrize("joined", [
    date(2026, 1, 1), date(2026, 3, 15), date(2026, 6, 10),
    date(2026, 9, 20), date(2026, 12, 1), date(2026, 12, 31),
])
def test_every_joiner_receives_the_whole_configured_entitlement(db, joined):
    leave_year = leave_year_dao.find_current(db)
    # Join inside whatever leave year the database is actually on.
    joined = min(max(joined, leave_year.start_date), leave_year.end_date)
    employee = _employee(db, joined)
    _onboard(db, employee)

    annual = _target(db, "ANNUAL")
    assert _balance(db, employee, "ANNUAL")["entitlement"] == annual.entitlement_days


def test_two_employees_with_the_same_joining_date_hold_the_same_days(db):
    """§19 B — the defect this replaced: what you held depended on whether the 2 a.m. job
    had run between the two records being created."""
    leave_year = leave_year_dao.find_current(db)
    joined = leave_year.start_date + timedelta(days=200)
    first = _employee(db, joined)
    _onboard(db, first)
    second = _employee(db, joined)
    _onboard(db, second)

    for code in ("ANNUAL", "SICK"):
        assert _balance(db, first, code)["entitlement"] == _balance(db, second, code)["entitlement"]


def test_granting_twice_grants_nothing_twice(db):
    employee = _employee(db, date(2024, 1, 1))
    leave_year = _onboard(db, employee)
    before = _balance(db, employee, "ANNUAL")["ledger_balance"]
    entitlement_service.grant_all_for_employee(db, employee, leave_year, None)
    db.commit()
    assert _balance(db, employee, "ANNUAL")["ledger_balance"] == before


def test_loss_of_pay_and_comp_off_are_never_granted(db):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)
    for code in ("LOP", "COMP_OFF"):
        assert _balance(db, employee, code)["entitlement"] == 0


# --- C. the shared Sick/Casual pool -----------------------------------------------------------


def test_sick_and_casual_share_one_entitlement(db):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)

    sick = _balance(db, employee, "SICK")
    casual = _balance(db, employee, "CASUAL")
    assert sick["target_kind"] == "POOL"
    assert sick["target_key"] == casual["target_key"]
    # One pool, granted once: not nine days each.
    pool = entitlement_dao.find_pool_by_code(db, "SICK_CASUAL")
    assert sick["entitlement"] == float(pool.annual_entitlement) == casual["entitlement"]


def test_using_sick_leaves_fewer_casual_days(db):
    employee = _employee(db, date(2024, 1, 1))
    leave_year = _onboard(db, employee)
    sick_type = leave_type_dao.find_by_code(db, "SICK")
    before = _balance(db, employee, "CASUAL")["available"]

    balance_service.write_manual_adjustment(
        db, employee.employee_id, sick_type.leave_type_id, leave_year.leave_year_id, -2,
        "two days of sick leave", None, entry_type="LEAVE_DEDUCTION_DEBIT",
        source_reference=f"test:{uuid.uuid4().hex[:8]}",
    )
    db.commit()

    assert _balance(db, employee, "CASUAL")["available"] == before - 2
    assert _balance(db, employee, "SICK")["available"] == before - 2


def test_the_dashboard_shows_a_pool_once_and_names_both_types(db):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)
    cards = dashboard.get_dashboard(db, employee.employee_id)["balances"]

    pooled = [c for c in cards if c["target_kind"] == "POOL"]
    assert len(pooled) == 1
    assert {t["type_code"] for t in pooled[0]["leave_types"]} == {"SICK", "CASUAL"}
    # Every type is still offered for an application.
    codes = {t["type_code"] for c in cards for t in c["leave_types"]}
    assert {"SICK", "CASUAL", "ANNUAL"} <= codes


def test_totals_count_a_shared_pool_once(db):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)
    data = dashboard.get_dashboard(db, employee.employee_id)

    counted = [c for c in data["balances"] if c["leave_type"]["is_balance_affecting"] and c["configured_entitlement"]]
    assert data["totals"]["entitlement"] == pytest.approx(sum(c["entitlement"] + c["carry_forward"] for c in counted))
    pool = entitlement_dao.find_pool_by_code(db, "SICK_CASUAL")
    annual = _target(db, "ANNUAL")
    assert data["totals"]["entitlement"] >= float(pool.annual_entitlement) + annual.entitlement_days


# --- E. temporary restrictions ------------------------------------------------------------------


def test_a_restriction_holds_days_back_then_gives_them_back(db, hr_admin):
    employee = _employee(db, date(2024, 1, 1))
    leave_year = _onboard(db, employee)
    before = _balance(db, employee, "ANNUAL")["available"]
    annual_type = leave_type_dao.find_by_code(db, "ANNUAL")

    restriction = restriction_service.create_restriction(
        db, employee_id=employee.employee_id, leave_type_id=annual_type.leave_type_id, days=4,
        start_date=date.today() - timedelta(days=1), end_date=date.today() + timedelta(days=5),
        reason="Temporary HR-approved restriction", actor_id=hr_admin.employee_id,
    )
    during = _balance(db, employee, "ANNUAL")
    assert during["restricted"] == 4
    assert during["available"] == before - 4
    # Not leave: the entitlement and the usage are untouched.
    assert during["used"] == 0
    assert during["entitlement"] == _target(db, "ANNUAL").entitlement_days

    # The day after it ends the days are back, with no job involved.
    after_window = entitlement_service.summary(
        db, employee.employee_id, _target(db, "ANNUAL"), leave_year, as_of=date.today() + timedelta(days=6)
    )
    assert after_window["restricted"] == 0
    assert after_window["available"] == before

    # The sweep only writes the state down, and twice is the same as once.
    row = entitlement_dao.find_restriction(db, restriction["restriction_id"])
    row.end_date = date.today() - timedelta(days=1)
    db.commit()
    assert restriction_service.release_expired(db) >= 1
    assert entitlement_dao.find_restriction(db, restriction["restriction_id"]).state == "RELEASED"
    assert restriction_service.release_expired(db) == 0
    assert _balance(db, employee, "ANNUAL")["available"] == before


def test_a_restriction_cannot_exceed_the_available_balance(db, hr_admin):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)
    annual_type = leave_type_dao.find_by_code(db, "ANNUAL")
    available = _balance(db, employee, "ANNUAL")["available"]

    with pytest.raises(AppError) as excinfo:
        restriction_service.create_restriction(
            db, employee_id=employee.employee_id, leave_type_id=annual_type.leave_type_id,
            days=available + 1, start_date=date.today(), end_date=date.today() + timedelta(days=2),
            reason="too much", actor_id=hr_admin.employee_id,
        )
    assert excinfo.value.code == "RESTRICTION_EXCEEDS_BALANCE"


def test_restricting_a_pooled_type_restricts_the_pool_once(db, hr_admin):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)
    sick_type = leave_type_dao.find_by_code(db, "SICK")

    restriction_service.create_restriction(
        db, employee_id=employee.employee_id, leave_type_id=sick_type.leave_type_id, days=2,
        start_date=date.today(), end_date=date.today() + timedelta(days=3),
        reason="shared pool restriction", actor_id=hr_admin.employee_id,
    )
    sick = _balance(db, employee, "SICK")
    casual = _balance(db, employee, "CASUAL")
    assert sick["restricted"] == casual["restricted"] == 2  # held once, seen by both


def test_a_cancelled_restriction_stops_holding_days(db, hr_admin):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)
    annual_type = leave_type_dao.find_by_code(db, "ANNUAL")
    before = _balance(db, employee, "ANNUAL")["available"]

    created = restriction_service.create_restriction(
        db, employee_id=employee.employee_id, leave_type_id=annual_type.leave_type_id, days=3,
        start_date=date.today(), end_date=date.today() + timedelta(days=10),
        reason="restriction", actor_id=hr_admin.employee_id,
    )
    assert _balance(db, employee, "ANNUAL")["available"] == before - 3
    restriction_service.cancel_restriction(db, created["restriction_id"], "called off", hr_admin.employee_id)
    assert _balance(db, employee, "ANNUAL")["available"] == before


# --- D. existing employees: opening balances ----------------------------------------------------


def test_opening_balances_are_previewed_before_they_are_applied(db, hr_admin):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)
    annual_type = leave_type_dao.find_by_code(db, "ANNUAL")
    before = _balance(db, employee, "ANNUAL")["ledger_balance"]

    preview = balance_admin_service.preview_opening_balances(
        db, leave_type_id=annual_type.leave_type_id, opening_balance=7,
        employee_ids=[employee.employee_id],
    )
    row = preview["employees"][0]
    assert row["current_balance"] == before
    assert row["proposed_opening_balance"] == 7
    assert row["difference"] == round(7 - before, 2)
    # A preview writes nothing.
    assert _balance(db, employee, "ANNUAL")["ledger_balance"] == before

    applied = balance_admin_service.apply_opening_balances(
        db, leave_type_id=annual_type.leave_type_id, opening_balance=7, reason="migration to the new policy",
        actor_id=hr_admin.employee_id, employee_ids=[employee.employee_id],
    )
    assert applied["applied_to"] == 1
    assert _balance(db, employee, "ANNUAL")["ledger_balance"] == 7
    # History is kept: the grant is still there, with a compensating entry beside it.
    entries = [e.entry_type for e in ledger_dao.list_for_target(
        db, employee.employee_id, leave_year_dao.find_current(db).leave_year_id,
        leave_type_id=annual_type.leave_type_id,
    )]
    assert "ENTITLEMENT_GRANT" in entries and "OPENING_BALANCE_ADJUSTMENT" in entries


def test_an_opening_balance_needs_a_reason(db, hr_admin):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)
    annual_type = leave_type_dao.find_by_code(db, "ANNUAL")
    with pytest.raises(AppError) as excinfo:
        balance_admin_service.apply_opening_balances(
            db, leave_type_id=annual_type.leave_type_id, opening_balance=5, reason="  ",
            actor_id=hr_admin.employee_id, employee_ids=[employee.employee_id],
        )
    assert excinfo.value.code == "REASON_REQUIRED"


# --- leave types: creation reaches everyone, archive hides without losing anything ---------------


def test_a_new_leave_type_credits_nobody_but_reaches_new_joiners(db, hr_admin):
    """A leave type is policy. Somebody already employed gets its days only when HR posts an
    opening balance; somebody onboarded afterwards is granted it in full like any other."""
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)

    code = f"NT{uuid.uuid4().hex[:6].upper()}"
    result = leave_type_service.create_leave_type(
        db, {"type_code": code, "type_name": "Study leave", "annual_entitlement": 15}, hr_admin.employee_id
    )
    assert result["granted_to"] == 0
    assert _balance(db, employee, code)["available"] == 0
    cards = dashboard.get_dashboard(db, employee.employee_id)["balances"]
    assert [c for c in cards if c["target_code"] == code][0]["available"] == 0

    joiner = _employee(db, date(2024, 1, 1))
    _onboard(db, joiner)
    assert _balance(db, joiner, code)["available"] == 15


def test_archiving_hides_a_type_but_keeps_its_history(db, hr_admin):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)
    code = f"AR{uuid.uuid4().hex[:6].upper()}"
    created = leave_type_service.create_leave_type(
        db, {"type_code": code, "type_name": "Temporary type", "annual_entitlement": 3}, hr_admin.employee_id
    )
    type_id = created["leave_type"].leave_type_id
    leave_year = leave_year_dao.find_current(db)
    # Give this person a balance of their own to prove the archive keeps it.
    entitlement_service.grant_entitlement(
        db, employee, entitlement_service.target_for_leave_type(db, created["leave_type"]), leave_year, None
    )
    db.commit()

    leave_type_service.archive_leave_type(db, type_id, hr_admin.employee_id)
    db.expire_all()

    assert type_id not in [t.leave_type_id for t in leave_type_dao.list_selectable(db)]
    assert type_id in [t.leave_type_id for t in leave_type_dao.list_all(db)]  # reports still name it
    assert ledger_dao.sum_quantity(db, employee.employee_id, type_id, leave_year.leave_year_id) == 3
    assert code not in [c["target_code"] for c in dashboard.get_dashboard(db, employee.employee_id)["balances"]]

    leave_type_service.restore_leave_type(db, type_id, hr_admin.employee_id)
    db.expire_all()
    assert code in [c["target_code"] for c in dashboard.get_dashboard(db, employee.employee_id)["balances"]]
    # Restoring credits nobody: the balance is whatever it was before the archive.
    assert ledger_dao.sum_quantity(db, employee.employee_id, type_id, leave_year.leave_year_id) == 3


# --- H. the scheduler no longer grants anything ---------------------------------------------------


def test_no_accrual_job_is_registered():
    import inspect

    from app.jobs import scheduler

    source = inspect.getsource(scheduler)
    assert "accrual" not in source.lower()
    assert "Restriction release" in source
    for kept in ("SLA sweep", "LOP sweep", "Digest run", "Year-end rollover check"):
        assert kept in source


def test_the_organisation_summary_counts_each_pool_once(db, hr_admin):
    employee = _employee(db, date(2024, 1, 1))
    _onboard(db, employee)
    summary = balance_admin_service.organization_summary(db)

    keys = [t["target_key"] for t in summary["by_target"]]
    assert len(keys) == len(set(keys))
    assert summary["employee_count"] >= 1
    mine = [row for row in summary["employees"] if row["employee_id"] == employee.employee_id][0]
    own = dashboard.get_dashboard(db, employee.employee_id)["totals"]
    assert mine["available"] == pytest.approx(own["available"])


def test_days_added_in_balance_adjustment_count_towards_used_of_total(db, hr_admin):
    """A balance HR posts by hand is days the person holds, so the dashboard counts it in
    "x of y used" exactly like a grant. It used to read 0 of 0 and show no usage line."""
    from app.services import ledger_service

    employee = _employee(db, date(2024, 1, 1))
    leave_year = _onboard(db, employee)
    sick = leave_type_dao.find_by_code(db, "SICK")

    ledger_service.adjust(
        db, employee.employee_id, sick.leave_type_id, leave_year.leave_year_id, 4,
        "extra days agreed with HR", hr_admin.employee_id,
    )

    summary = _balance(db, employee, "SICK")
    pool = entitlement_dao.find_pool_by_code(db, "SICK_CASUAL")
    assert summary["adjustments"] == 4
    assert summary["total_days"] == float(pool.annual_entitlement) + 4
    assert summary["available"] == summary["total_days"]

    card = [c for c in dashboard.get_dashboard(db, employee.employee_id)["balances"]
            if c["target_code"] == pool.pool_code][0]
    assert card["total_days"] == summary["total_days"]
    totals = dashboard.get_dashboard(db, employee.employee_id)["totals"]
    assert totals["total"] >= summary["total_days"]


# --- only what somebody may actually use (the 301.8-vs-24 report) --------------------------


def _profiled(db, *, gender: str | None, marital: str | None):
    employee = _employee(db, date(2024, 1, 1))
    employee.gender, employee.marital_status = gender, marital
    db.commit()
    db.refresh(employee)
    return employee


def test_a_type_somebody_cannot_apply_for_is_never_granted(db):
    """Maternity is FEMALE + MARRIED. Granting it to everybody put 182 days on every man's
    ledger, which is what made the admin view read 301.8 where his dashboard read 24."""
    maternity = leave_type_dao.find_by_code(db, "MATERNITY")
    assert (maternity.gender_eligibility, maternity.marital_eligibility) == ("FEMALE", "MARRIED")

    man = _profiled(db, gender="MALE", marital="MARRIED")
    woman = _profiled(db, gender="FEMALE", marital="MARRIED")
    _onboard(db, man)
    _onboard(db, woman)

    assert _balance(db, man, "MATERNITY")["ledger_balance"] == 0
    assert _balance(db, woman, "MATERNITY")["ledger_balance"] > 0
    # Everything else is granted to both.
    assert _balance(db, man, "ANNUAL")["ledger_balance"] == _balance(db, woman, "ANNUAL")["ledger_balance"]


def test_becoming_eligible_later_is_topped_up_on_the_next_run(db):
    employee = _profiled(db, gender="FEMALE", marital="SINGLE")
    _onboard(db, employee)
    assert _balance(db, employee, "MATERNITY")["ledger_balance"] == 0

    employee.marital_status = "MARRIED"
    db.commit()
    leave_year = _onboard(db, employee)  # the same grant, run again

    maternity = _target(db, "MATERNITY")
    assert _balance(db, employee, "MATERNITY")["ledger_balance"] == maternity.entitlement_days
    # and running it once more adds nothing
    entitlement_service.grant_all_for_employee(db, employee, leave_year, None)
    db.commit()
    assert _balance(db, employee, "MATERNITY")["ledger_balance"] == maternity.entitlement_days


def test_a_type_hr_excluded_for_somebody_is_not_granted(db):
    from app.dao import leave_type_dao as dao

    employee = _profiled(db, gender="MALE", marital="SINGLE")
    annual = leave_type_dao.find_by_code(db, "ANNUAL")
    dao.replace_exclusions(db, employee.employee_id, [annual.leave_type_id])
    db.commit()

    _onboard(db, employee)
    assert _balance(db, employee, "ANNUAL")["ledger_balance"] == 0
    assert _balance(db, employee, "BEREAVEMENT")["ledger_balance"] > 0


def test_the_dashboard_total_is_the_sum_of_the_cards_it_shows(db):
    man = _profiled(db, gender="MALE", marital="MARRIED")
    _onboard(db, man)

    data = dashboard.get_dashboard(db, man.employee_id)
    shown = [
        c for c in data["balances"]
        if any(t["is_eligible"] is not False for t in c["leave_types"])
        and c["leave_type"]["is_balance_affecting"] and c["configured_entitlement"]
    ]
    assert data["totals"]["available"] == pytest.approx(sum(c["available"] for c in shown))
    assert all(c["target_code"] != "MATERNITY" for c in shown)


def test_the_admin_summary_agrees_with_each_dashboard(db):
    from app.services import balance_admin_service

    man = _profiled(db, gender="MALE", marital="MARRIED")
    woman = _profiled(db, gender="FEMALE", marital="MARRIED")
    _onboard(db, man)
    _onboard(db, woman)

    summary = balance_admin_service.organization_summary(db)
    for employee in (man, woman):
        own = dashboard.get_dashboard(db, employee.employee_id)["totals"]
        row = [r for r in summary["employees"] if r["employee_id"] == employee.employee_id][0]
        assert row["available"] == pytest.approx(own["available"]), employee.employee_code
        assert row["entitlement"] == pytest.approx(own["entitlement"]), employee.employee_code
