"""The days-off answer other suite apps rely on (Kanban's time log).

What counts: approved leave and a holiday that applies to the person. What does not: a
request still waiting for a decision, a rejected one, an optional holiday nobody chose, and
another region's holiday.
"""
import uuid
from datetime import date, timedelta

from suite_core.constants import INTERNAL_HEADER

from app.dao import holiday_dao, leave_type_dao, leave_year_dao, optional_holiday_dao
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.services import days_off_service
from tests.conftest import INTERNAL_TOKEN


def _employee(db, *, region_id=None) -> Employee:
    suffix = uuid.uuid4().hex[:8].upper()
    row = Employee(
        work_email=f"off{suffix.lower()}@example.com", employee_code=f"OFF{suffix}",
        first_name="Days", last_name=suffix, date_of_joining=date(2024, 1, 1),
        designation="Engineer", is_active=True, region_id=region_id,
        suite_user_id=f"suite-{suffix}",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _leave(db, employee, start, end, state="APPROVED", half=False):
    leave_year = leave_year_dao.find_current(db)
    leave_type = leave_type_dao.find_by_code(db, "ANNUAL")
    request = LeaveRequest(
        employee_id=employee.employee_id, leave_type_id=leave_type.leave_type_id,
        leave_year_id=leave_year.leave_year_id, start_date=start, end_date=end,
        state=state, reason="test", is_half_day=half, deducted_days=0.5 if half else 1,
    )
    db.add(request)
    db.commit()
    return request


def _window(db):
    """A few days inside the current leave year, so holidays can be attached to it."""
    leave_year = leave_year_dao.find_current(db)
    start = max(leave_year.start_date, min(date.today(), leave_year.end_date - timedelta(days=10)))
    return leave_year, start, start + timedelta(days=6)


def test_approved_leave_is_a_day_off(db):
    leave_year, start, end = _window(db)
    employee = _employee(db)
    _leave(db, employee, start + timedelta(days=1), start + timedelta(days=2))

    found = days_off_service.days_off_for_employees(db, [employee.employee_id], start, end)[employee.employee_id]
    assert sorted(found) == [start + timedelta(days=1), start + timedelta(days=2)]
    assert all(info["kind"] == "leave" and info["portion"] == 1.0 for info in found.values())


def test_a_request_awaiting_a_decision_is_not_a_day_off(db):
    leave_year, start, end = _window(db)
    employee = _employee(db)
    _leave(db, employee, start, start, state="PENDING_MANAGER")
    _leave(db, employee, start + timedelta(days=3), start + timedelta(days=3), state="REJECTED")

    assert days_off_service.days_off_for_employees(db, [employee.employee_id], start, end) == {
        employee.employee_id: {}
    }


def test_half_a_day_of_leave_is_reported_as_half(db):
    leave_year, start, end = _window(db)
    employee = _employee(db)
    _leave(db, employee, start + timedelta(days=1), start + timedelta(days=1), half=True)

    found = days_off_service.days_off_for_employees(db, [employee.employee_id], start, end)[employee.employee_id]
    assert found[start + timedelta(days=1)]["portion"] == 0.5


def test_a_holiday_applies_to_everyone_it_covers(db, hr_admin):
    leave_year, start, end = _window(db)
    employee = _employee(db)
    holiday = holiday_dao.create(
        db, holiday_date=start + timedelta(days=4), holiday_name=f"Festival {uuid.uuid4().hex[:4]}",
        leave_year_id=leave_year.leave_year_id, region_id=None, is_optional=False,
        created_by=hr_admin.employee_id,
    )
    db.commit()

    found = days_off_service.days_off_for_employees(db, [employee.employee_id], start, end)[employee.employee_id]
    assert found[holiday.holiday_date]["kind"] == "holiday"
    assert found[holiday.holiday_date]["label"] == holiday.holiday_name


def test_an_optional_holiday_counts_only_for_whoever_chose_it(db, hr_admin):
    leave_year, start, end = _window(db)
    chooser, other = _employee(db), _employee(db)
    holiday = holiday_dao.create(
        db, holiday_date=start + timedelta(days=5), holiday_name=f"Optional {uuid.uuid4().hex[:4]}",
        leave_year_id=leave_year.leave_year_id, region_id=None, is_optional=True,
        created_by=hr_admin.employee_id,
    )
    optional_holiday_dao.create(
        db, employee_id=chooser.employee_id, holiday_id=holiday.holiday_id,
        leave_year_id=leave_year.leave_year_id,
    )
    db.commit()

    found = days_off_service.days_off_for_employees(
        db, [chooser.employee_id, other.employee_id], start, end
    )
    assert holiday.holiday_date in found[chooser.employee_id]
    assert holiday.holiday_date not in found[other.employee_id]


def test_the_internal_endpoint_answers_by_suite_user_id(client, db):
    leave_year, start, end = _window(db)
    employee = _employee(db)
    _leave(db, employee, start + timedelta(days=1), start + timedelta(days=1))

    res = client.post(
        "/internal/days-off",
        headers={INTERNAL_HEADER: INTERNAL_TOKEN},
        json={"suiteUserIds": [employee.suite_user_id, "nobody-here"],
              "start": start.isoformat(), "end": end.isoformat()},
    )
    assert res.status_code == 200, res.text
    days = res.json()["days"]
    # Nobody LMS has never heard of appears at all.
    assert {d["suiteUserId"] for d in days} == {employee.suite_user_id}
    # Other tests in this database may have put a holiday in the same window; the leave day
    # is what this one is about.
    leave_days = [d for d in days if d["kind"] == "leave"]
    assert [d["date"] for d in leave_days] == [(start + timedelta(days=1)).isoformat()]
    assert leave_days[0]["portion"] == 1.0


def test_the_internal_endpoint_needs_the_token(client, db):
    start = date.today()
    res = client.post(
        "/internal/days-off",
        json={"suiteUserIds": [], "start": start.isoformat(), "end": start.isoformat()},
    )
    assert res.status_code == 401, res.text
    assert res.json()["code"] == "BAD_INTERNAL_TOKEN"


def test_a_backwards_range_is_refused(client):
    today = date.today()
    res = client.post(
        "/internal/days-off",
        headers={INTERNAL_HEADER: INTERNAL_TOKEN},
        json={"suiteUserIds": [], "start": today.isoformat(),
              "end": (today - timedelta(days=1)).isoformat()},
    )
    assert res.status_code == 400 and res.json()["code"] == "BAD_RANGE"
