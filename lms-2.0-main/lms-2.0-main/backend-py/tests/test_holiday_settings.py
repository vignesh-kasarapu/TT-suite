"""Optional holidays: HR sets how many each employee can take (no "half, rounded up"); HR can
edit a holiday; the Settings list shows every setting, including ones an older database never
got; in-app notifications can point at their request."""
import uuid
from datetime import date

import pytest

from app.core.exceptions import AppError
from app.dao import config_dao, holiday_dao, leave_type_dao, leave_year_dao, optional_holiday_dao
from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.notification_audit import AuditLog
from app.services import config_service, notification_service, optional_holiday_service, role_assignment_service

from .conftest import sign_in

KEY = "holiday.optional_holidays_allowed"


@pytest.fixture()
def employee(db):
    suffix = uuid.uuid4().hex[:8].upper()
    person = Employee(
        work_email=f"oh{suffix.lower()}@example.com", employee_code=f"OH{suffix}", first_name="Opt", last_name=suffix,
        date_of_joining=date(2025, 1, 1), designation="Engineer", is_active=True,
    )
    db.add(person)
    db.commit()
    db.refresh(person)
    role_assignment_service.assign_role(db, person.employee_id, "EMPLOYEE", person.employee_id)
    return person


@pytest.fixture()
def allowance(db):
    """Sets the allowance for one test and puts the setting back afterwards."""
    before = config_dao.find_by_key(db, KEY)
    saved = (before.config_value, before.value_type) if before else None

    def set_to(n: int) -> None:
        config_service.set_value(db, KEY, n, "INT", updated_by=None)

    yield set_to
    if saved:
        config_dao.upsert(db, KEY, saved[0], saved[1], None)
    else:
        row = config_dao.find_by_key(db, KEY)
        if row:
            db.delete(row)
            db.commit()


def _optional_holidays(db, n: int):
    year = leave_year_dao.find_current(db)
    return year, [
        holiday_dao.create(db, holiday_date=date(2031, 1, 10 + i), holiday_name=f"Optional {uuid.uuid4().hex[:6]}",
                           leave_year_id=year.leave_year_id, is_optional=True, created_by=1)
        for i in range(n)
    ]


def test_the_allowance_is_the_number_hr_sets_not_half_of_the_published_ones(db, employee, allowance):
    year, holidays = _optional_holidays(db, 3)
    allowance(2)
    assert optional_holiday_service.get_optional_holiday_quota(db, year.leave_year_id) == 2
    for h in holidays[:2]:
        optional_holiday_service.select_optional_holiday(db, employee.employee_id, h.holiday_id)
    with pytest.raises(AppError) as exc:
        optional_holiday_service.select_optional_holiday(db, employee.employee_id, holidays[2].holiday_id)
    assert exc.value.code == "OPTIONAL_HOLIDAY_QUOTA_EXCEEDED"

    allowance(3)  # raised: the third pick is allowed now
    optional_holiday_service.select_optional_holiday(db, employee.employee_id, holidays[2].holiday_id)
    assert optional_holiday_dao.count_for_employee_year(db, employee.employee_id, year.leave_year_id) == 3


def test_an_allowance_of_zero_turns_optional_holidays_off(db, employee, allowance):
    year, [holiday] = _optional_holidays(db, 1)
    allowance(0)
    with pytest.raises(AppError) as exc:
        optional_holiday_service.select_optional_holiday(db, employee.employee_id, holiday.holiday_id)
    assert exc.value.code == "OPTIONAL_HOLIDAY_QUOTA_EXCEEDED"


def test_an_older_database_without_the_setting_allows_two(db, allowance):
    allowance(5)
    row = config_dao.find_by_key(db, KEY)
    db.delete(row)
    db.commit()
    assert optional_holiday_service.get_optional_holiday_quota(db, leave_year_dao.find_current(db).leave_year_id) == 2


def test_the_allowance_must_be_a_whole_number_in_range():
    for bad in (-1, 366, "two"):
        with pytest.raises(AppError) as exc:
            config_service.set_value(None, KEY, bad, "INT", updated_by=None)
        assert exc.value.code == "VALIDATION_ERROR"
    with pytest.raises(AppError) as exc:
        config_service.set_value(None, "holiday.optional_holiday_quota_override", 1, "INT", updated_by=None)
    assert exc.value.code == "CONFIG_RETIRED"


def test_settings_list_has_every_setting_even_one_an_older_database_lacks(db, as_hr_admin, allowance):
    allowance(4)
    db.delete(config_dao.find_by_key(db, KEY))
    db.commit()
    rows = {r["config_key"]: r for r in as_hr_admin.get("/api/config").json()["data"]}
    assert rows[KEY]["config_value"] == "2" and rows[KEY]["value_type"] == "INT"  # the default, ready to save
    assert "holiday.optional_holiday_quota_override" not in rows

    saved = as_hr_admin.patch(f"/api/config/{KEY}", json={"value": 3, "value_type": "INT"})
    assert saved.status_code == 200, saved.text
    assert config_service.get(db, KEY) == 3


def test_hr_edits_a_holiday(db, as_hr_admin):
    year = leave_year_dao.find_current(db)
    made = as_hr_admin.post("/api/admin/holidays", json={
        "holiday_date": "2031-03-01", "holiday_name": "Typo Day", "leave_year_id": year.leave_year_id,
    }).json()["data"]["holiday"]
    res = as_hr_admin.put(f"/api/admin/holidays/{made['holiday_id']}", json={
        "holiday_date": "2031-03-02", "holiday_name": "Correct Day", "region_id": "", "is_optional": True,
    })
    assert res.status_code == 200, res.text
    out = res.json()["data"]
    assert out["holiday"]["holiday_name"] == "Correct Day" and out["holiday"]["holiday_date"] == "2031-03-02"
    assert out["holiday"]["is_optional"] is True and out["holiday"]["leave_year_id"] == year.leave_year_id
    assert out["removedSelections"] == 0
    audit = db.query(AuditLog).filter_by(action="HOLIDAY_UPDATED", entity_id=str(made["holiday_id"])).first()
    assert audit is not None
    as_hr_admin.delete(f"/api/admin/holidays/{made['holiday_id']}")


def test_making_an_optional_holiday_one_for_everyone_gives_the_picks_back(db, as_hr_admin, employee, allowance):
    allowance(2)
    year, [holiday] = _optional_holidays(db, 1)
    optional_holiday_service.select_optional_holiday(db, employee.employee_id, holiday.holiday_id)
    res = as_hr_admin.put(f"/api/admin/holidays/{holiday.holiday_id}", json={
        "holiday_date": "2031-01-10", "holiday_name": holiday.holiday_name, "is_optional": False,
    })
    assert res.status_code == 200, res.text
    assert res.json()["data"]["removedSelections"] == 1
    db.expire_all()
    assert optional_holiday_dao.count_for_employee_year(db, employee.employee_id, year.leave_year_id) == 0


def test_editing_holidays_is_for_hr_only_and_needs_a_real_holiday(client, as_hr_admin, employee):
    missing = as_hr_admin.put("/api/admin/holidays/999999999", json={"holiday_date": "2031-01-01", "holiday_name": "X"})
    assert missing.status_code == 404
    sign_in(client, employee)
    refused = client.put("/api/admin/holidays/1", json={"holiday_date": "2031-01-01", "holiday_name": "X"})
    assert refused.status_code == 403


def test_an_in_app_notification_can_point_at_its_request(db, employee):
    """Advance-LOP notifications are in-app only; with the request id they open that request
    instead of falling back to a list page."""
    year = leave_year_dao.find_current(db)
    lr = LeaveRequest(
        employee_id=employee.employee_id, leave_type_id=leave_type_dao.list_all(db)[0].leave_type_id,
        leave_year_id=year.leave_year_id, start_date="2031-02-03", end_date="2031-02-03", reason="test", state="APPROVED",
    )
    db.add(lr)
    db.commit()
    row = notification_service.notify_in_app(
        db, recipient_id=employee.employee_id, template_key="ADVANCE_LOP_WARNING", subject="s", body="b",
        related_request_id=lr.request_id,
    )
    db.commit()
    assert row.related_request_id == lr.request_id
