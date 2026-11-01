"""Balance correction for accruals posted under the old rules — a dry run by default.

Why it exists: before the accrual job honoured each leave type's frequency, a monthly run
credited every type, so quarterly types were credited four times too often and annual types
twelve times. The opening credit also paid the whole remaining leave year and the periodic
job then paid the same periods again (BR-13).

What it does NOT do: delete or rewrite anything. The ledger is append-only (BR-07), so a
correction is a compensating MANUAL_ADJUSTMENT carrying the reason, exactly as if HR had
posted it by hand. Historical rows stay where they are and the audit trail stays complete.

    python -m scripts.correct_accruals                 # dry run: prints the differences
    python -m scripts.correct_accruals --confirm       # posts the compensating entries
    python -m scripts.correct_accruals --employee 4    # one employee

`--confirm` is required to write, and is refused under APP_PROFILE=prod unless
`--allow-production` is also given — this is a data correction, not a deployment step.
"""
import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.dao import employee_dao, ledger_dao, leave_type_dao, leave_year_dao  # noqa: E402
from app.services import accrual_service, balance_service  # noqa: E402

REASON = (
    "Accrual correction: credits posted before the accrual job honoured each leave type's "
    "frequency and the joining-period rule (BR-13). The difference is adjusted here; the "
    "original entries are left in place."
)


def differences(db, as_of: date, employee_id: int | None = None):
    """(employee, leave type, expected, actual, difference) for everything that is out."""
    leave_year = leave_year_dao.find_current(db)
    if leave_year is None:
        raise SystemExit("No current leave year.")

    employees = [employee_dao.find_by_id(db, employee_id)] if employee_id else employee_dao.list_active(db)
    employees = [e for e in employees if e is not None]
    rows = []

    for policy in leave_type_dao.list_balance_affecting_policies(db):
        leave_type = leave_type_dao.find_by_id(db, policy.leave_type_id)
        if leave_type is None or leave_type.type_code.upper() in accrual_service.NEVER_ACCRUED_CODES:
            continue
        config = leave_type_dao.find_accrual_config(db, policy.leave_type_id)
        method = (config.accrual_method if config else "ANNUAL") or "ANNUAL"

        for employee in employees:
            expected = accrual_service.expected_to_date(
                leave_year, method, policy.annual_entitlement, employee.date_of_joining, as_of
            )
            actual = ledger_dao.sum_quantity(db, employee.employee_id, policy.leave_type_id, leave_year.leave_year_id)
            # Days already taken are legitimate debits, not an accrual error: compare what
            # was CREDITED, not the net balance.
            taken = _debits(db, employee.employee_id, policy.leave_type_id, leave_year.leave_year_id)
            credited = round(actual - taken, 2)
            difference = round(expected - credited, 2)
            if abs(difference) >= 0.01:
                rows.append((employee, leave_type, expected, credited, difference))
    return leave_year, rows


def _debits(db, employee_id: int, leave_type_id: int, leave_year_id: int) -> float:
    """The negative side of the ledger: leave taken, encashed or adjusted downwards."""
    total = 0.0
    for entry in ledger_dao.list_for_employee(db, employee_id, leave_year_id, leave_type_id):
        quantity = float(entry.quantity)
        if quantity < 0:
            total += quantity
    return round(total, 2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true", help="post the compensating entries")
    parser.add_argument("--employee", type=int, default=None, help="limit to one employee id")
    parser.add_argument("--as-of", default=None, help="compute expected balances as at this date (YYYY-MM-DD)")
    parser.add_argument("--allow-production", action="store_true", help="permit --confirm under APP_PROFILE=prod")
    args = parser.parse_args()

    if args.confirm and settings.is_production and not args.allow_production:
        raise SystemExit("Refusing to write under APP_PROFILE=prod without --allow-production.")

    as_of = date.fromisoformat(args.as_of) if args.as_of else date.today()
    db = SessionLocal()
    try:
        leave_year, rows = differences(db, as_of, args.employee)
        print(f"Leave year {leave_year.year_code} ({leave_year.start_date} to {leave_year.end_date}), as at {as_of}")
        if not rows:
            print("Nothing to correct: every credited balance matches the expected figure.")
            return

        print(f"{'Employee':<24}{'Type':<14}{'expected':>10}{'credited':>10}{'adjust':>10}")
        for employee, leave_type, expected, credited, difference in rows:
            print(f"{employee.full_name[:23]:<24}{leave_type.type_code:<14}{expected:>10.2f}{credited:>10.2f}{difference:>+10.2f}")

        if not args.confirm:
            print(f"\nDry run: {len(rows)} adjustment(s) would be posted. Re-run with --confirm to write them.")
            return

        for employee, leave_type, _expected, _credited, difference in rows:
            balance_service.write_manual_adjustment(
                db, employee.employee_id, leave_type.leave_type_id, leave_year.leave_year_id,
                difference, REASON, actor_id=None,
            )
        db.commit()
        print(f"\nPosted {len(rows)} compensating adjustment(s). No historical entry was changed.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
