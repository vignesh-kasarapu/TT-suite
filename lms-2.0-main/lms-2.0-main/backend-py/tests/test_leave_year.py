"""Leave-year configuration and the controlled transition to the next year."""
from datetime import date, timedelta

import pytest

from app.core.exceptions import AppError
from app.dao import leave_year_dao
from app.services import config_service, leave_year_service


def test_bounds_follow_the_configured_start():
    start, end, code = leave_year_service.bounds_from("04-01", date(2026, 10, 30))
    assert (start, end, code) == (date(2026, 4, 1), date(2027, 3, 31), "2026-2027")

    # A January year is one calendar year, and is labelled as one — not "2026-2026".
    start, end, code = leave_year_service.bounds_from("01-01", date(2026, 10, 30))
    assert (start, end, code) == (date(2026, 1, 1), date(2026, 12, 31), "2026")

    # Before the start date, the year in force is the previous one.
    start, _end, _code = leave_year_service.bounds_from("04-01", date(2026, 2, 10))
    assert start == date(2025, 4, 1)


def test_an_unreadable_start_is_refused():
    for value in ("", "4-1-2026", "13-01", "02-30", None):
        with pytest.raises(AppError) as excinfo:
            leave_year_service.parse_start_month_day(value)
        assert excinfo.value.code == "INVALID_LEAVE_YEAR_START"


def test_29_february_is_a_legal_start():
    assert leave_year_service.parse_start_month_day("02-29") == (2, 29)


def test_configuration_reports_a_pending_change_without_applying_it(db):
    """Changing the setting must not touch the leave year in force (BR: never retrospective)."""
    current = leave_year_dao.find_current(db)
    original = config_service.get(db, leave_year_service.CONFIG_KEY)
    other = "01-01" if original != "01-01" else "04-01"
    try:
        config_service.set_value(db, leave_year_service.CONFIG_KEY, other, "STRING", None)
        db.commit()
        state = leave_year_service.get_configuration(db)

        assert state["configured_start_month_day"] == other
        assert state["pending_change"] is True
        # The year in force is untouched by the setting.
        db.refresh(current)
        assert state["current"].start_date == current.start_date
        assert state["current"].end_date == current.end_date
    finally:
        config_service.set_value(db, leave_year_service.CONFIG_KEY, original, "STRING", None)
        db.commit()


def test_overlapping_years_are_refused(db):
    current = leave_year_dao.find_current(db)
    with pytest.raises(AppError) as excinfo:
        leave_year_service.create_next_leave_year(
            db, current.start_date + timedelta(days=30), current.end_date + timedelta(days=200), None
        )
    assert excinfo.value.code == "LEAVE_YEAR_OVERLAP"
    db.rollback()


def test_a_year_cannot_start_before_the_current_one(db):
    current = leave_year_dao.find_current(db)
    with pytest.raises(AppError) as excinfo:
        leave_year_service.create_next_leave_year(
            db, current.start_date - timedelta(days=400), current.start_date - timedelta(days=1), None
        )
    assert excinfo.value.code == "INVALID_LEAVE_YEAR"
    db.rollback()


def test_an_end_before_its_start_is_refused(db):
    current = leave_year_dao.find_current(db)
    with pytest.raises(AppError) as excinfo:
        leave_year_service.create_next_leave_year(
            db, current.end_date + timedelta(days=10), current.end_date + timedelta(days=5), None
        )
    assert excinfo.value.code == "INVALID_LEAVE_YEAR"
    db.rollback()


def test_creating_the_next_year_never_switches_to_it(db):
    """`is_current` moves only when carry-forward closes the year before it."""
    current = leave_year_dao.find_current(db)
    start = current.end_date + timedelta(days=1)
    end = date(start.year + 1, start.month, start.day) - timedelta(days=1)
    created = None
    try:
        created = leave_year_service.create_next_leave_year(db, start, end, None)
        db.commit()
        assert created.is_current is False
        db.refresh(current)
        assert current.is_current is True
        assert leave_year_dao.find_current(db).leave_year_id == current.leave_year_id
        # And the transition is no longer "required": the next year now exists.
        assert leave_year_service.get_configuration(db)["next"].leave_year_id == created.leave_year_id
    finally:
        if created is not None:
            db.delete(created)
            db.commit()
