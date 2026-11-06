"""Give every active employee the entitlement today's policy says they should have.

This is what makes a fresh database — or one whose balance history has just been cleared —
agree with the leave types HR has configured. For each person it grants the types they may
actually apply for: a type excluded for them is skipped, and so is one their profile makes
them ineligible for, so nobody ends up holding days they could never book.

It is safe to run again, at any time. A grant is keyed per employee, target and leave year
(`entitlement_service.grant_entitlement`), so a second run adds nothing for anybody who
already holds it — and tops up somebody who has since become eligible, or a leave type
created after the last run.

    python -m scripts.grant_entitlements                       # dry run: who would get what
    python -m scripts.grant_entitlements --csv grants.csv      # the same, as a file
    python -m scripts.grant_entitlements --confirm --allow-production \\
        --reason "Fresh initialisation"

Nothing is ever taken away here. A balance that is too high is HR's to correct in Balance
adjustment; this only adds what is missing.
"""
import argparse
import csv
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import SessionLocal  # noqa: E402
from app.dao import employee_dao, leave_year_dao, ledger_dao  # noqa: E402
from app.services import entitlement_service  # noqa: E402


def plan(db, leave_year) -> list[dict]:
    """One row per employee and target: what they would be granted, and what they hold."""
    rows = []
    for employee in employee_dao.list_active(db):
        for target in entitlement_service.grantable_targets_for(db, employee):
            held = ledger_dao.sum_for_target(
                db, employee.employee_id, leave_year.leave_year_id, **target.ledger_filter()
            )
            already = entitlement_service.has_grant(db, employee.employee_id, target, leave_year)
            rows.append(
                {
                    "employee_id": employee.employee_id,
                    "employee_code": employee.employee_code,
                    "employee_name": employee.full_name,
                    "target_name": target.name,
                    "policy_days": target.entitlement_days,
                    "holds_now": round(held, 2),
                    "already_granted": already,
                    "would_grant": 0.0 if already else float(target.entitlement_days or 0),
                }
            )
    return rows


def apply_grants(db, leave_year, actor_id: int | None) -> dict[int, dict[str, float]]:
    granted: dict[int, dict[str, float]] = {}
    for employee in employee_dao.list_active(db):
        given = entitlement_service.grant_all_for_employee(db, employee, leave_year, actor_id)
        if given:
            granted[employee.employee_id] = given
    db.commit()
    return granted


def _profile_label() -> str:
    """What the environment actually says, not what the settings default to."""
    return (os.environ.get("APP_PROFILE") or os.environ.get("ENVIRONMENT") or "").strip()         or "unset (treated as production)"


def _is_production() -> bool:
    """Production unless the environment explicitly says otherwise.

    `settings.app_profile` falls back to "dev" when nothing is set, so reading it here would
    wave an unconfigured production box straight through. The raw variables are what decide:
    only an explicit dev or test profile counts as safe.
    """
    profile = (os.environ.get("APP_PROFILE") or "").strip().lower()
    if not profile:
        environment = (os.environ.get("ENVIRONMENT") or "").strip().lower()
        profile = "dev" if environment in ("development", "dev") else ""
    return profile not in ("dev", "test")


def write_csv(path: Path, rows: list[dict]) -> None:
    fields = ["employee_code", "employee_name", "target_name", "policy_days", "holds_now",
              "already_granted", "would_grant"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--confirm", action="store_true", help="post the grants (without this it is a dry run)")
    parser.add_argument("--allow-production", action="store_true", help="required against a production database")
    parser.add_argument("--reason", default="Entitlement granted from the current policy.")
    parser.add_argument("--csv", default=None, help="write the plan to this file as well")
    parser.add_argument("--actor-id", type=int, default=None, help="the administrator this is recorded against")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        leave_year = leave_year_dao.find_current(db)
        if leave_year is None:
            raise SystemExit("No current leave year: nothing to grant.")
        if leave_year.is_closed:
            raise SystemExit(f"{leave_year.year_code} is closed and cannot be granted into.")

        rows = plan(db, leave_year)
        pending = [r for r in rows if not r["already_granted"]]
        print(f"{'GRANTING' if args.confirm else 'DRY RUN'} — leave year {leave_year.year_code}")
        print(f"  profile: {_profile_label()}")
        print(f"  {len({r['employee_id'] for r in rows})} employee(s), "
              f"{len(pending)} grant(s) to post, {len(rows) - len(pending)} already held")
        for row in rows:
            mark = "already held" if row["already_granted"] else f"+{row['would_grant']:g}"
            print(f"    {row['employee_code']:<14} {row['target_name']:<24} "
                  f"holds {row['holds_now']:>7} {mark}")
        if args.csv:
            write_csv(Path(args.csv), rows)
            print(f"  plan written to {args.csv}")

        if not args.confirm:
            print("\nNothing was written. Re-run with --confirm to post the grants.")
            return

        if _is_production() and not args.allow_production:
            raise SystemExit(
                f"APP_PROFILE={_profile_label()} looks like production. "
                "Re-run with --allow-production if that is what you mean."
            )

        granted = apply_grants(db, leave_year, args.actor_id)
        posted = sum(len(v) for v in granted.values())
        print(f"\nGranted {posted} entitlement(s) across {len(granted)} employee(s). "
              f"Reason: {args.reason}")
        print("Run it again at any time: anybody who already holds a grant is skipped.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
