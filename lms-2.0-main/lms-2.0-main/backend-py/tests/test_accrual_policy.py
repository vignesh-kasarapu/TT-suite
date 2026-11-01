"""Accrual cadence (LMS-055), joining-period proration (BR-13) and rounding (BR-14).

These are arithmetic tests: they build a leave year in memory rather than touching the
shared database wherever they can, so the cadence rules are pinned independently of whatever
the dev data happens to contain.
"""
from datetime import date
from types import SimpleNamespace

import pytest

from app.services import accrual_service, rounding_policy


def _year(start: date, end: date, code: str = "TEST"):
    return SimpleNamespace(start_date=start, end_date=end, year_code=code, leave_year_id=-1)


APRIL_YEAR = _year(date(2026, 4, 1), date(2027, 3, 31), "2026-2027")
JANUARY_YEAR = _year(date(2026, 1, 1), date(2026, 12, 31), "2026")


# --- period arithmetic ---------------------------------------------------------------------


def test_monthly_period_is_the_calendar_month():
    start, end, key = accrual_service.period_bounds(APRIL_YEAR, "MONTHLY", date(2026, 10, 30))
    assert (start, end, key) == (date(2026, 10, 1), date(2026, 10, 31), "2026-10")


def test_quarters_are_anchored_to_the_leave_year_not_the_calendar():
    start, end, key = accrual_service.period_bounds(APRIL_YEAR, "QUARTERLY", date(2026, 10, 30))
    assert (start, end) == (date(2026, 10, 1), date(2026, 12, 31))
    assert key == "2026-2027:Q3"

    # The same date in a January year falls in that year's fourth quarter instead.
    start, end, key = accrual_service.period_bounds(JANUARY_YEAR, "QUARTERLY", date(2026, 10, 30))
    assert (start, end, key) == (date(2026, 10, 1), date(2026, 12, 31), "2026:Q4")


def test_annual_period_is_the_leave_year():
    start, end, key = accrual_service.period_bounds(APRIL_YEAR, "ANNUAL", date(2026, 10, 30))
    assert (start, end, key) == (APRIL_YEAR.start_date, APRIL_YEAR.end_date, "2026-2027")


@pytest.mark.parametrize(
    "method,due_dates,not_due_dates",
    [
        ("MONTHLY", [date(2026, 4, 1), date(2026, 11, 1)], [date(2026, 11, 2), date(2026, 11, 30)]),
        ("QUARTERLY", [date(2026, 4, 1), date(2026, 7, 1), date(2026, 10, 1), date(2027, 1, 1)],
         [date(2026, 5, 1), date(2026, 11, 1), date(2026, 12, 1)]),
        ("ANNUAL", [date(2026, 4, 1)], [date(2026, 5, 1), date(2026, 10, 1), date(2027, 1, 1)]),
    ],
)
def test_only_a_methods_own_period_start_is_due(method, due_dates, not_due_dates):
    """The bug this replaces: a monthly job run credited quarterly and annual types too."""
    for due in due_dates:
        assert accrual_service.period_is_due(APRIL_YEAR, method, due), f"{method} should be due on {due}"
    for not_due in not_due_dates:
        assert not accrual_service.period_is_due(APRIL_YEAR, method, not_due), f"{method} must not be due on {not_due}"


def test_every_frequency_falls_due_together_on_the_leave_year_start():
    for method in ("MONTHLY", "QUARTERLY", "ANNUAL"):
        assert accrual_service.period_is_due(APRIL_YEAR, method, APRIL_YEAR.start_date)


# --- eligible fraction (BR-13) -------------------------------------------------------------


@pytest.mark.parametrize(
    "joined,expected",
    [
        (date(2026, 10, 1), 1.0),            # joined on the first day: a whole period
        (date(2026, 9, 15), 1.0),            # joined before it started
        (date(2026, 10, 31), 1 / 31),        # last day of a 31-day month
        (date(2026, 11, 1), 0.0),            # joined after this period ended
    ],
)
def test_eligible_fraction_of_a_month(joined, expected):
    assert accrual_service.eligible_fraction(date(2026, 10, 1), date(2026, 10, 31), joined) == pytest.approx(expected)


def test_leap_day_counts_like_any_other_day():
    """February 2028 has 29 days, so joining on the 29th earns 1/29 of the month."""
    assert accrual_service.eligible_fraction(
        date(2028, 2, 1), date(2028, 2, 29), date(2028, 2, 29)
    ) == pytest.approx(1 / 29)


# --- expected balance over a whole year (BR-13 + cadence) ----------------------------------


def test_an_employee_present_all_year_receives_exactly_the_entitlement():
    for method, entitlement in (("MONTHLY", 24), ("MONTHLY", 9), ("QUARTERLY", 15), ("ANNUAL", 182)):
        total = accrual_service.expected_to_date(
            APRIL_YEAR, method, entitlement, joined=date(2020, 1, 1), as_of=APRIL_YEAR.end_date
        )
        assert total == pytest.approx(float(entitlement), abs=0.01), f"{method} {entitlement}"


def test_joining_period_is_prorated_and_never_paid_twice():
    """30 October, 24 days a year, monthly: October's share once, then five full months."""
    joining_only = accrual_service.expected_to_date(
        APRIL_YEAR, "MONTHLY", 24, joined=date(2026, 10, 30), as_of=date(2026, 10, 31)
    )
    by_year_end = accrual_service.expected_to_date(
        APRIL_YEAR, "MONTHLY", 24, joined=date(2026, 10, 30), as_of=APRIL_YEAR.end_date
    )
    # Method A (ceil to a whole day) is still the policy in force, so October's 0.13 is 1.0.
    assert joining_only == pytest.approx(rounding_policy.apply(2.0 * 2 / 31))
    assert by_year_end == pytest.approx(joining_only + 5 * 2.0)
    # The old behaviour credited the whole remaining year up front AND accrued on top.
    assert by_year_end < 11 + 10


def test_quarterly_joiner_gets_a_part_quarter_then_full_quarters():
    total = accrual_service.expected_to_date(
        APRIL_YEAR, "QUARTERLY", 15, joined=date(2026, 10, 30), as_of=APRIL_YEAR.end_date
    )
    part = rounding_policy.apply(3.75 * 63 / 92)  # 30 Oct - 31 Dec of a 92-day quarter
    assert total == pytest.approx(part + 3.75)


def test_nothing_accrues_before_someone_joins():
    assert accrual_service.expected_to_date(
        APRIL_YEAR, "MONTHLY", 24, joined=date(2027, 1, 15), as_of=date(2026, 12, 31)
    ) == 0.0


# --- BR-14 rounding ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value,method_a,method_b,method_c",
    [
        (1.2, 2.0, 1.2, 1.2),
        (1.7, 2.0, 1.7, 1.7),
        (1.21, 2.0, 1.3, 1.2),
        (1.71, 2.0, 1.8, 1.7),
        (1.75, 2.0, 1.8, 1.8),
        (1.25, 2.0, 1.3, 1.3),
        (2.01, 3.0, 2.1, 2.0),
        (2.1, 3.0, 2.1, 2.1),
    ],
)
def test_the_three_rounding_methods(value, method_a, method_b, method_c):
    assert rounding_policy.apply(value, rounding_policy.METHOD_A) == pytest.approx(method_a)
    assert rounding_policy.apply(value, rounding_policy.METHOD_B) == pytest.approx(method_b)
    assert rounding_policy.apply(value, rounding_policy.METHOD_C) == pytest.approx(method_c)


def test_the_active_method_is_still_the_one_hr_approved():
    """BR-14 is unchanged until HR says otherwise — this test is the tripwire."""
    assert rounding_policy.ACTIVE_METHOD == rounding_policy.METHOD_A
    assert rounding_policy.apply(0.06) == 1.0


def test_periodic_credits_are_not_rounded_so_a_year_does_not_drift():
    """Sick is 0.75 a month. Rounding each credit up would give 12 days against a 9-day
    policy; the job stores the exact figure, so twelve months come to exactly 9."""
    assert accrual_service.expected_to_date(
        APRIL_YEAR, "MONTHLY", 9, joined=date(2020, 1, 1), as_of=APRIL_YEAR.end_date
    ) == pytest.approx(9.0)
