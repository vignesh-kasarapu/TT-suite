"""Leave-year configuration and the controlled transition to the next year.

`leave_year.start_month_day` is a **pending** setting: it says where the *next* leave year
starts and never moves the one in force. Nothing here runs by itself — HR creates the next
year with explicit dates and then runs carry-forward, which is what flips `is_current`
(`carry_forward_service.run_year_end_carry_forward`). The dates are never guessed: a change
from an April year to a January one needs a transition period somebody has decided on.
"""
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import leave_year_dao
from app.services import audit_service, config_service

CONFIG_KEY = "leave_year.start_month_day"


def parse_start_month_day(value: str) -> tuple[int, int]:
    try:
        month, day = (int(part) for part in str(value).split("-"))
        date(2024, month, day)  # 2024 is a leap year: 02-29 is a legal setting
    except (ValueError, TypeError) as exc:
        raise AppError("INVALID_LEAVE_YEAR_START", f"{CONFIG_KEY} must be MM-DD, e.g. 04-01.") from exc
    return month, day


def bounds_from(start_month_day: str, on_date: date | None = None) -> tuple[date, date, str]:
    """The leave year that `on_date` falls in for a given MM-DD start — the same arithmetic
    the first seed uses, exposed so the admin screen can preview what it proposes."""
    month, day = parse_start_month_day(start_month_day)
    today = on_date or date.today()
    start_year = today.year if (today.month, today.day) >= (month, day) else today.year - 1
    start = date(start_year, month, day)
    end = date(start_year + 1, month, day) - timedelta(days=1)
    return start, end, year_code_for(start, end)


def year_code_for(start: date, end: date) -> str:
    """"2026-2027" when the year spans two calendar years, "2026" when it does not — so a
    January-December year is not labelled "2026-2026"."""
    return f"{start.year}" if start.year == end.year else f"{start.year}-{end.year}"


def get_configuration(db: Session) -> dict:
    """What the admin screen shows: the year in force, the pending setting, and whether a
    transition is outstanding."""
    current = leave_year_dao.find_current(db)
    configured = config_service.get(db, CONFIG_KEY)
    next_year = leave_year_dao.find_next_after(db, current.end_date) if current else None

    pending_change = False
    if current is not None:
        month, day = parse_start_month_day(configured)
        pending_change = (current.start_date.month, current.start_date.day) != (month, day)

    return {
        "current": current,
        "next": next_year,
        "configured_start_month_day": configured,
        # True when the setting no longer matches the year in force: the next year HR
        # creates should start on the configured date, and until they create it nothing
        # changes. Never applied retrospectively.
        "pending_change": pending_change,
        "transition_required": pending_change and next_year is None,
    }


def create_next_leave_year(db: Session, start_date: date, end_date: date, actor_id: int | None) -> object:
    """Create the year that follows the current one. Dates are given, never derived: a
    transition between two different year shapes (April-March to January-December) needs a
    period somebody approved, which may be shorter than twelve months."""
    if end_date <= start_date:
        raise AppError("INVALID_LEAVE_YEAR", "The leave year's end date must be after its start date.")

    current = leave_year_dao.find_current(db)
    if current is None:
        raise AppError("NO_CURRENT_LEAVE_YEAR", "There is no current leave year to follow.")
    if start_date <= current.start_date:
        raise AppError("INVALID_LEAVE_YEAR", "The next leave year must start after the current one starts.")

    # No overlaps, in either direction, against every year on record.
    for existing in leave_year_dao.list_all(db):
        if start_date <= existing.end_date and end_date >= existing.start_date:
            raise AppError(
                "LEAVE_YEAR_OVERLAP",
                f"{start_date} to {end_date} overlaps the existing leave year {existing.year_code} "
                f"({existing.start_date} to {existing.end_date}).",
            )

    code = year_code_for(start_date, end_date)
    if leave_year_dao.find_by_code(db, code) is not None:
        raise AppError("DUPLICATE_LEAVE_YEAR", f"A leave year with the code {code} already exists.")

    # is_current stays False: the switch happens in carry-forward, after the closing year's
    # balances have been carried or lapsed. Exactly one year is current at any time.
    row = leave_year_dao.create(db, year_code=code, start_date=start_date, end_date=end_date, is_current=False)
    audit_service.record(
        db, action="LEAVE_YEAR_CREATED", entity_type="leave_years", entity_id=row.leave_year_id,
        actor_id=actor_id,
        new_value={"year_code": code, "start_date": str(start_date), "end_date": str(end_date)},
    )
    return row
