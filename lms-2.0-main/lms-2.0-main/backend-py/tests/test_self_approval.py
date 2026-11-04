"""Self-approval grants and how long they run (BR/Addendum-37).

HR picks one of three: the rest of the leave year, open-ended until the person is
deactivated, or dates they type. The first two are worked out on the server, so nobody has
to look a date up, and the open-ended one really does end at deactivation.
"""
import uuid
from datetime import date, timedelta

import pytest

from app.core.exceptions import AppError
from app.dao import leave_year_dao, self_approval_dao
from app.models.employee import Employee
from app.services import self_approval_service
from app.services.employee import lifecycle


def _employee(db) -> Employee:
    suffix = uuid.uuid4().hex[:8].upper()
    row = Employee(
        work_email=f"sa{suffix.lower()}@example.com", employee_code=f"SA{suffix}",
        first_name="Self", last_name=suffix, date_of_joining=date(2024, 1, 1),
        designation="Engineer", is_active=True, status="ACTIVE",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_a_leave_year_grant_runs_to_the_end_of_the_year(db, hr_admin):
    employee = _employee(db)
    leave_year = leave_year_dao.find_current(db)

    grant = self_approval_service.grant(
        db, employee.employee_id, hr_admin.employee_id, None, None, "no manager", duration="leave_year"
    )
    db.commit()

    assert grant.effective_to == leave_year.end_date
    assert grant.effective_from >= leave_year.start_date
    assert self_approval_service.describe(grant) == "dates"


def test_an_until_deactivated_grant_is_open_ended_and_ends_on_deactivation(db, hr_admin):
    employee = _employee(db)

    grant = self_approval_service.grant(
        db, employee.employee_id, hr_admin.employee_id, None, None, "sole director",
        duration="until_deactivated",
    )
    db.commit()
    assert grant.effective_to is None
    assert self_approval_service.describe(grant) == "until_deactivated"
    assert self_approval_dao.find_any_active(db, employee.employee_id) is not None

    lifecycle.deactivate(db, employee.employee_id, date.today(), hr_admin.employee_id)
    db.commit()

    assert self_approval_dao.find_any_active(db, employee.employee_id) is None
    db.refresh(grant)
    assert grant.is_active is False


def test_dates_are_taken_exactly_as_given(db, hr_admin):
    employee = _employee(db)
    start = date.today()
    end = start + timedelta(days=30)

    grant = self_approval_service.grant(
        db, employee.employee_id, hr_admin.employee_id, start, end, None, duration="dates"
    )
    db.commit()
    assert (grant.effective_from, grant.effective_to) == (start, end)


def test_a_grant_cannot_end_before_it_starts(db, hr_admin):
    employee = _employee(db)
    start = date.today()
    with pytest.raises(AppError) as excinfo:
        self_approval_service.grant(
            db, employee.employee_id, hr_admin.employee_id, start, start - timedelta(days=1),
            None, duration="dates",
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_one_active_grant_per_employee(db, hr_admin):
    employee = _employee(db)
    self_approval_service.grant(
        db, employee.employee_id, hr_admin.employee_id, None, None, None, duration="leave_year"
    )
    db.commit()
    with pytest.raises(AppError) as excinfo:
        self_approval_service.grant(
            db, employee.employee_id, hr_admin.employee_id, None, None, None, duration="until_deactivated"
        )
    assert excinfo.value.code == "ACTIVE_GRANT_EXISTS"


def test_the_endpoint_offers_the_three_durations_and_names_both_people(as_hr_admin, hr_admin, db):
    employee = _employee(db)

    res = as_hr_admin.post("/api/admin/self-approval-permissions", json={
        "employee_id": employee.employee_id, "duration": "until_deactivated", "notes": "no manager",
    })
    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert body["effective_to"] is None
    assert body["duration"] == "until_deactivated"
    # The screen reads these two; before, it showed blanks because nothing sent them.
    assert body["grantee"]["full_name"] == employee.full_name
    assert body["grantedBy"]["full_name"] == hr_admin.full_name

    listed = as_hr_admin.get("/api/admin/self-approval-permissions").json()["data"]
    mine = [g for g in listed if g["employee_id"] == employee.employee_id][0]
    assert mine["duration"] == "until_deactivated"

    revoked = as_hr_admin.post(
        f"/api/admin/self-approval-permissions/{body['self_approval_permission_id']}/revoke"
    )
    assert revoked.status_code == 200 and revoked.json()["data"]["is_active"] is False


def test_an_unknown_duration_is_refused(db, hr_admin):
    employee = _employee(db)
    with pytest.raises(AppError) as excinfo:
        self_approval_service.grant(
            db, employee.employee_id, hr_admin.employee_id, None, None, None, duration="forever"
        )
    assert excinfo.value.code == "VALIDATION_ERROR"
