"""Leave encashment, compensatory off, and the per-leave-type ledger.

These run against the test database through the API, so authorization is covered too.
"""
import uuid
from datetime import date, timedelta

import pytest

from app.dao import leave_type_dao, leave_year_dao, ledger_dao
from app.models.employee import Employee
from app.services import comp_off_service, role_assignment_service
from tests.conftest import sign_in


def _employee(db, *, manager_id=None, role_code="EMPLOYEE", joined=date(2024, 1, 1)):
    suffix = uuid.uuid4().hex[:8].upper()
    employee = Employee(
        work_email=f"bx{suffix.lower()}@example.com", employee_code=f"BX{suffix}",
        first_name="Extras", last_name=suffix, date_of_joining=joined, designation="Engineer",
        reporting_manager_id=manager_id, is_active=True,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    role_assignment_service.assign_role(db, employee.employee_id, role_code, employee.employee_id)
    return employee


def _credit(db, employee, type_code, quantity):
    leave_type = leave_type_dao.find_by_code(db, type_code)
    leave_year = leave_year_dao.find_current(db)
    ledger_dao.create_entry(
        db, employee_id=employee.employee_id, leave_type_id=leave_type.leave_type_id,
        leave_year_id=leave_year.leave_year_id, entry_type="MANUAL_ADJUSTMENT", quantity=quantity,
        source_reference=f"test:{uuid.uuid4().hex[:8]}", is_system_actor=True, reason="test fixture",
    )
    db.commit()
    return leave_type, leave_year


# --- the ledger is per leave type ----------------------------------------------------------


def test_employee_ledger_is_scoped_to_one_leave_type(as_hr_admin, db):
    employee = _employee(db)
    annual, leave_year = _credit(db, employee, "ANNUAL", 10)
    sick, _ = _credit(db, employee, "SICK", 4)

    everything = as_hr_admin.get(f"/api/ledger/employee/{employee.employee_id}").json()["data"]
    annual_only = as_hr_admin.get(
        f"/api/ledger/employee/{employee.employee_id}", params={"leaveTypeId": annual.leave_type_id}
    ).json()["data"]

    assert {row["leave_type_id"] for row in annual_only} == {annual.leave_type_id}
    assert annual_only[-1]["running_balance"] == pytest.approx(10)
    # Unfiltered, each type still counts separately — never one total across all of them.
    by_type = {row["leave_type_id"]: row["running_balance"] for row in everything}
    assert by_type[annual.leave_type_id] == pytest.approx(10)
    assert by_type[sick.leave_type_id] == pytest.approx(4)


def test_ledger_rows_name_their_leave_type_and_year(as_hr_admin, db):
    employee = _employee(db)
    annual, leave_year = _credit(db, employee, "ANNUAL", 3)
    rows = as_hr_admin.get(
        f"/api/ledger/employee/{employee.employee_id}", params={"leaveTypeId": annual.leave_type_id}
    ).json()["data"]
    assert rows[0]["leave_type_name"] == annual.type_name
    assert rows[0]["leave_year_id"] == leave_year.leave_year_id


def test_balance_adjustment_still_demands_a_reason(as_hr_admin, db):
    employee = _employee(db)
    annual, leave_year = _credit(db, employee, "ANNUAL", 5)
    res = as_hr_admin.post("/api/ledger/adjust", json={
        "employeeId": employee.employee_id, "leaveTypeId": annual.leave_type_id,
        "leaveYearId": leave_year.leave_year_id, "quantity": 1, "reason": "   ",
    })
    assert res.status_code >= 400
    assert res.json()["error"]["code"] == "REASON_REQUIRED"


# --- leave encashment ----------------------------------------------------------------------


def _request_encashment(client, employee, leave_type, leave_year, days, notes="test"):
    return client.post("/api/r3/leave-encashment", json={
        "employeeId": employee.employee_id, "leaveTypeId": leave_type.leave_type_id,
        "leaveYearId": leave_year.leave_year_id, "daysEncashed": days, "notes": notes,
    })


@pytest.mark.parametrize("type_code", ["SICK", "CASUAL", "BEREAVEMENT", "MATERNITY", "COMP_OFF", "LOP"])
def test_only_annual_leave_can_be_encashed(as_hr_admin, db, type_code):
    employee = _employee(db)
    _credit(db, employee, "ANNUAL", 20)
    leave_type, leave_year = _credit(db, employee, type_code, 20)
    res = _request_encashment(as_hr_admin, employee, leave_type, leave_year, 1)
    assert res.status_code >= 400
    assert res.json()["error"]["code"] == "TYPE_NOT_ENCASHABLE"


def test_request_reserves_days_but_does_not_debit_the_ledger(as_hr_admin, db):
    employee = _employee(db)
    annual, leave_year = _credit(db, employee, "ANNUAL", 10)
    before = ledger_dao.sum_quantity(db, employee.employee_id, annual.leave_type_id, leave_year.leave_year_id)

    assert _request_encashment(as_hr_admin, employee, annual, leave_year, 4).status_code == 201
    db.expire_all()
    after = ledger_dao.sum_quantity(db, employee.employee_id, annual.leave_type_id, leave_year.leave_year_id)
    assert after == before  # nothing moved yet

    available = as_hr_admin.get("/api/r3/leave-encashment/encashable-balance", params={
        "employeeId": employee.employee_id, "leaveTypeId": annual.leave_type_id, "leaveYearId": leave_year.leave_year_id,
    }).json()["data"]
    assert available["reserved_by_pending_encashments"] == pytest.approx(4)
    assert available["encashable_balance"] == pytest.approx(6)


def test_pending_requests_cannot_spend_the_same_balance_twice(as_hr_admin, db):
    employee = _employee(db)
    annual, leave_year = _credit(db, employee, "ANNUAL", 10)
    assert _request_encashment(as_hr_admin, employee, annual, leave_year, 7).status_code == 201
    res = _request_encashment(as_hr_admin, employee, annual, leave_year, 5)
    assert res.status_code >= 400
    assert res.json()["error"]["code"] == "INSUFFICIENT_BALANCE"


def test_approval_posts_exactly_one_debit_and_rejection_posts_none(as_hr_admin, db):
    employee = _employee(db)
    annual, leave_year = _credit(db, employee, "ANNUAL", 10)

    approved = _request_encashment(as_hr_admin, employee, annual, leave_year, 3).json()["data"]
    rejected = _request_encashment(as_hr_admin, employee, annual, leave_year, 2).json()["data"]

    assert as_hr_admin.post(f"/api/r3/leave-encashment/{approved['encashment_id']}/decision",
                            json={"approve": True}).status_code == 200
    assert as_hr_admin.post(f"/api/r3/leave-encashment/{rejected['encashment_id']}/decision",
                            json={"approve": False, "comments": "not this year"}).status_code == 200

    db.expire_all()
    assert ledger_dao.sum_quantity(db, employee.employee_id, annual.leave_type_id, leave_year.leave_year_id) == pytest.approx(7)

    # A decided request cannot be decided again, so no second debit is possible.
    again = as_hr_admin.post(f"/api/r3/leave-encashment/{approved['encashment_id']}/decision", json={"approve": True})
    assert again.status_code >= 400
    assert again.json()["error"]["code"] == "ALREADY_DECIDED"


def test_insufficient_balance_is_refused(as_hr_admin, db):
    employee = _employee(db)
    annual, leave_year = _credit(db, employee, "ANNUAL", 2)
    res = _request_encashment(as_hr_admin, employee, annual, leave_year, 3)
    assert res.status_code >= 400
    assert res.json()["error"]["code"] == "INSUFFICIENT_BALANCE"


def test_encashment_requires_hr(client, db):
    employee = _employee(db)
    annual, leave_year = _credit(db, employee, "ANNUAL", 5)
    sign_in(client, employee)
    assert _request_encashment(client, employee, annual, leave_year, 1).status_code == 403


def test_encashment_report_carries_the_decision_fields(as_hr_admin, db):
    employee = _employee(db)
    annual, leave_year = _credit(db, employee, "ANNUAL", 6)
    created = _request_encashment(as_hr_admin, employee, annual, leave_year, 2, notes="payout").json()["data"]
    as_hr_admin.post(f"/api/r3/leave-encashment/{created['encashment_id']}/decision", json={"approve": True})

    rows = as_hr_admin.get("/api/reports/encashment", params={"employeeId": employee.employee_id}).json()["data"]
    row = next(r for r in rows if r["encashment_id"] == created["encashment_id"])
    assert row["status"] == "POSTED"
    assert row["days_requested"] == pytest.approx(2)
    assert row["days_encashed"] == pytest.approx(2)
    assert row["decided_by_name"] and row["requested_by_name"]
    assert "amount" not in row and "salary" not in row  # days only; payroll applies rates


# --- compensatory off ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "hours,days",
    [(2, 0.25), (4, 0.5), (6, 0.75), (8, 1.0), (10, 1.25), (16, 2.0), (24, 3.0)],
)
def test_eight_hours_make_one_day(hours, days):
    assert comp_off_service.days_for_hours(hours) == pytest.approx(days)


def _claim(client, employee, hours=8, when=None):
    return client.post("/api/r3/comp-off", json={
        "employeeId": employee.employee_id,
        "workDate": (when or date.today() - timedelta(days=3)).isoformat(),
        "hoursWorked": hours, "notes": "weekend release",
    })


def test_two_stage_approval_credits_once_and_only_at_the_end(client, db, as_hr_admin, hr_admin):
    manager = _employee(db, role_code="MANAGER")
    employee = _employee(db, manager_id=manager.employee_id)
    comp_off = leave_type_dao.find_by_code(db, "COMP_OFF")
    leave_year = leave_year_dao.find_current(db)
    before = ledger_dao.sum_quantity(db, employee.employee_id, comp_off.leave_type_id, leave_year.leave_year_id)

    sign_in(client, employee)
    claim = _claim(client, employee, hours=6).json()["data"]
    assert claim["status"] == "PENDING_MANAGER"
    assert claim["hours_or_days"] == pytest.approx(0.75)

    # Manager stage: nothing is credited yet.
    sign_in(client, manager)
    assert client.post(f"/api/r3/comp-off/{claim['comp_off_id']}/decision", json={"approve": True}).status_code == 200
    db.expire_all()
    assert ledger_dao.sum_quantity(db, employee.employee_id, comp_off.leave_type_id, leave_year.leave_year_id) == before

    # HR stage: the one and only credit. (`as_hr_admin` is this same client, so sign back
    # in as HR after the manager's turn.)
    sign_in(client, hr_admin)
    assert as_hr_admin.post(f"/api/r3/comp-off/{claim['comp_off_id']}/decision", json={"approve": True}).status_code == 200
    db.expire_all()
    assert ledger_dao.sum_quantity(
        db, employee.employee_id, comp_off.leave_type_id, leave_year.leave_year_id
    ) == pytest.approx(before + 0.75)

    repeat = as_hr_admin.post(f"/api/r3/comp-off/{claim['comp_off_id']}/decision", json={"approve": True})
    assert repeat.status_code >= 400


def test_manager_rejection_stops_the_claim(client, db, as_hr_admin, hr_admin):
    manager = _employee(db, role_code="MANAGER")
    employee = _employee(db, manager_id=manager.employee_id)
    comp_off = leave_type_dao.find_by_code(db, "COMP_OFF")
    leave_year = leave_year_dao.find_current(db)
    before = ledger_dao.sum_quantity(db, employee.employee_id, comp_off.leave_type_id, leave_year.leave_year_id)

    sign_in(client, employee)
    claim = _claim(client, employee).json()["data"]
    sign_in(client, manager)
    assert client.post(f"/api/r3/comp-off/{claim['comp_off_id']}/decision",
                       json={"approve": False, "comments": "not approved overtime"}).status_code == 200

    db.expire_all()
    assert ledger_dao.sum_quantity(db, employee.employee_id, comp_off.leave_type_id, leave_year.leave_year_id) == before
    # HR cannot revive it.
    sign_in(client, hr_admin)
    assert as_hr_admin.post(f"/api/r3/comp-off/{claim['comp_off_id']}/decision", json={"approve": True}).status_code >= 400


def test_a_manager_cannot_decide_outside_their_hierarchy(client, db):
    manager = _employee(db, role_code="MANAGER")
    stranger = _employee(db)
    sign_in(client, stranger)
    claim = _claim(client, stranger).json()["data"]

    sign_in(client, manager)
    res = client.post(f"/api/r3/comp-off/{claim['comp_off_id']}/decision", json={"approve": True})
    assert res.status_code == 403


def test_nobody_decides_their_own_claim(client, db):
    manager = _employee(db, role_code="MANAGER")
    sign_in(client, manager)
    claim = _claim(client, manager).json()["data"]
    res = client.post(f"/api/r3/comp-off/{claim['comp_off_id']}/decision", json={"approve": True})
    assert res.status_code >= 400
    assert res.json()["error"]["code"] in ("SELF_APPROVAL_NOT_ALLOWED", "PERMISSION_DENIED")


def test_one_open_claim_per_work_date(client, db):
    employee = _employee(db)
    sign_in(client, employee)
    when = date.today() - timedelta(days=5)
    assert _claim(client, employee, when=when).status_code == 201
    again = _claim(client, employee, when=when)
    assert again.status_code >= 400
    assert again.json()["error"]["code"] == "DUPLICATE_COMP_OFF"


def test_the_credit_follows_the_work_date_not_the_approval_date(db):
    """Work in a year that is not the current one must be credited to that year."""
    leave_year = leave_year_dao.find_current(db)
    inside = leave_year.start_date + timedelta(days=1)
    assert comp_off_service.leave_year_for_work_date(db, inside).leave_year_id == leave_year.leave_year_id

    # A date before the first leave year on record has no year of its own; the current one
    # stands in rather than the claim being lost.
    long_ago = leave_year_dao.list_all(db)[0].start_date - timedelta(days=400)
    assert comp_off_service.leave_year_for_work_date(db, long_ago) is not None


def test_hours_must_be_positive_and_the_work_already_done(client, db):
    employee = _employee(db)
    sign_in(client, employee)
    assert _claim(client, employee, hours=0).status_code >= 400
    future = client.post("/api/r3/comp-off", json={
        "employeeId": employee.employee_id,
        "workDate": (date.today() + timedelta(days=2)).isoformat(),
        "hoursWorked": 8,
    })
    assert future.status_code >= 400
    assert future.json()["error"]["code"] == "WORK_DATE_IN_FUTURE"


def test_comp_off_is_never_credited_by_the_accrual_job(db):
    comp_off = leave_type_dao.find_by_code(db, "COMP_OFF")
    lop = leave_type_dao.find_by_code(db, "LOP")
    assert comp_off.type_code in __import__("app.services.accrual_service", fromlist=["x"]).NEVER_ACCRUED_CODES
    assert lop.type_code in __import__("app.services.accrual_service", fromlist=["x"]).NEVER_ACCRUED_CODES


def test_a_claim_without_a_reporting_manager_goes_straight_to_hr(client, db, as_hr_admin, hr_admin):
    """Nobody can fill the manager stage for someone at the top of a line, so the claim must
    not come to rest there — it used to sit at PENDING_MANAGER for ever."""
    employee = _employee(db)  # no reporting manager
    sign_in(client, employee)
    claim = _claim(client, employee, hours=8).json()["data"]
    assert claim["status"] == "PENDING_HR"

    sign_in(client, hr_admin)
    assert as_hr_admin.post(f"/api/r3/comp-off/{claim['comp_off_id']}/decision",
                            json={"approve": True}).status_code == 200


def test_a_manager_raising_for_their_report_completes_the_manager_stage(client, db):
    manager = _employee(db, role_code="MANAGER")
    report = _employee(db, manager_id=manager.employee_id)
    sign_in(client, manager)
    claim = client.post("/api/r3/comp-off", json={
        "employeeId": report.employee_id,
        "workDate": (date.today() - timedelta(days=2)).isoformat(),
        "hoursWorked": 4, "notes": "manager raised",
    }).json()["data"]
    # Their own act is the manager decision; asking them to approve themselves would deadlock.
    assert claim["status"] == "PENDING_HR"
    assert claim["manager_id"] == manager.employee_id


def test_hr_queue_includes_manager_stage_claims_from_their_own_reports(client, db, as_hr_admin, hr_admin):
    """An HR admin who is also somebody's manager saw an empty queue while a claim from
    their report was waiting on them."""
    report = _employee(db, manager_id=hr_admin.employee_id)
    sign_in(client, report)
    claim = _claim(client, report, hours=8, when=date.today() - timedelta(days=4)).json()["data"]
    assert claim["status"] == "PENDING_MANAGER"

    sign_in(client, hr_admin)
    queue = as_hr_admin.get("/api/r3/comp-off/pending").json()["data"]
    assert claim["comp_off_id"] in {row["comp_off_id"] for row in queue}

    assert as_hr_admin.post(f"/api/r3/comp-off/{claim['comp_off_id']}/decision",
                            json={"approve": True}).status_code == 200


def test_a_claim_shows_in_the_claimants_own_list(client, db):
    manager = _employee(db, role_code="MANAGER")
    sign_in(client, manager)
    claim = _claim(client, manager, hours=8, when=date.today() - timedelta(days=6)).json()["data"]
    mine = client.get("/api/r3/comp-off/mine").json()["data"]
    assert claim["comp_off_id"] in {row["comp_off_id"] for row in mine}
