"""Reset every active leave balance to zero, preserving all history (HR decision).

The previous entitlement system's balances are discontinued: each employee goes to zero and
stays there until an administrator posts an opening balance in Administration > Opening
balances. Nothing here deletes anything. The ledger is append-only (BR-07), so a reset is one
compensating entry per employee and target, posted beside the rows it offsets — the old
grants, accrual credits, adjustments, leave requests and audit log are all exactly where they
were, and old reports still read correctly.

    python -m scripts.reset_balances                        # dry run: the report, writes nothing
    python -m scripts.reset_balances --csv reset-report.csv # the same report as a file for HR
    python -m scripts.reset_balances --confirm --backup-verified \
        --allow-production --reason "HR decision: balances discontinued"
    python -m scripts.reset_balances --rollback --confirm --backup-verified   # undo it

Safety, in the order the script checks it:

* a dry run unless `--confirm`;
* `--backup-verified` is required to write, and says so in the audit entry;
* a production database (APP_PROFILE=prod, or unset — an unset profile is treated as
  production) refuses without `--allow-production`;
* a closed leave year is never touched;
* every entry is keyed `reset:{leave_year}:{target}:{employee}`, so running it twice posts
  nothing the second time;
* `--rollback` posts the exact inverse of what this script posted, again without deleting.

Scope: the **current** leave year, every active employee, every balance-holding target —
company leave types, shared pools, and Compensatory Off (HR asked for comp-off to be included;
the claim records themselves are kept and listed in the report). Loss of Pay never holds a
balance. Earlier leave years are left alone, and `--close-past-years` marks the ones that have
ended as closed so nothing can post into them.
"""
import argparse
import csv
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.dao import (  # noqa: E402
    comp_off_dao, employee_dao, entitlement_dao, leave_type_dao, leave_year_dao, ledger_dao,
)
from app.models.ledger import LeaveLedger  # noqa: E402
from app.services import audit_service, entitlement_service  # noqa: E402

RESET_ENTRY_TYPE = "BALANCE_RESET_ADJUSTMENT"
ROLLBACK_ENTRY_TYPE = "BALANCE_RESET_REVERSAL"


def _reference(leave_year, target_key: str, employee_id: int) -> str:
    return f"reset:{leave_year.leave_year_id}:{target_key}:{employee_id}"


def _targets(db):
    """Everything that can hold a balance: the grantable targets plus Compensatory Off,
    which is earned rather than granted but still carries days."""
    targets = list(entitlement_service.grantable_targets(db))
    comp_off = leave_type_dao.find_by_code(db, "COMP_OFF")
    if comp_off is not None:
        target = entitlement_service.target_for_leave_type(db, comp_off)
        if target.key not in {t.key for t in targets}:
            targets.append(target)
    return targets


def plan(db, leave_year) -> list[dict]:
    """One row per employee and target that holds something. Reads only."""
    rows = []
    for employee in employee_dao.list_active(db):
        for target in _targets(db):
            balance = ledger_dao.sum_for_target(
                db, employee.employee_id, leave_year.leave_year_id, **target.ledger_filter()
            )
            if round(balance, 2) == 0:
                continue
            rows.append(
                {
                    "employee_id": employee.employee_id,
                    "employee_code": employee.employee_code,
                    "employee_name": employee.full_name,
                    "target_key": target.key,
                    "target_name": target.name,
                    "current_balance": round(balance, 2),
                    "adjustment": round(-balance, 2),
                    "new_balance": 0.0,
                    "already_reset": ledger_dao.find_by_source_reference(
                        db, _reference(leave_year, target.key, employee.employee_id)
                    )
                    is not None,
                }
            )
    return rows


def comp_off_records(db, leave_year) -> list[dict]:
    """Comp-off claims in this leave year, listed so HR can see what the reset zeroes.

    They are never deleted: a claim is a record of work somebody actually did and of the two
    approvals it went through. Only the days it credited are offset, like every other balance.
    """
    rows = []
    for row in comp_off_dao.list_for_report(db, from_date=None, to_date=None, employee_id=None,
                                            employee_ids=None, status=None):
        record, employee = row if isinstance(row, tuple) else (row, None)
        if getattr(record, "leave_year_id", None) not in (None, leave_year.leave_year_id):
            continue
        rows.append(
            {
                "comp_off_id": record.comp_off_id,
                "employee_id": record.employee_id,
                "employee_name": getattr(employee, "full_name", None),
                "work_date": record.work_date,
                "days": float(record.hours_or_days or 0),
                "status": record.status,
            }
        )
    return rows


def apply_reset(db, leave_year, rows: list[dict], reason: str, actor_id: int | None) -> int:
    posted = 0
    for row in rows:
        if row["already_reset"]:
            continue
        reference = _reference(leave_year, row["target_key"], row["employee_id"])
        leave_type_id, pool_id = _posting_ids(db, row["target_key"])
        ledger_dao.create_entry(
            db, employee_id=row["employee_id"], leave_type_id=leave_type_id, pool_id=pool_id,
            leave_year_id=leave_year.leave_year_id, entry_type=RESET_ENTRY_TYPE,
            quantity=row["adjustment"], source_reference=reference, actor_id=actor_id,
            is_system_actor=actor_id is None, reason=reason,
        )
        audit_service.record(
            db, action="BALANCE_RESET", entity_type="leave_ledger", entity_id=row["employee_id"],
            actor_id=actor_id, is_system_actor=actor_id is None,
            prior_value={"target": row["target_name"], "balance": row["current_balance"]},
            new_value={"balance": 0.0, "adjustment": row["adjustment"], "reason": reason,
                       "leave_year": leave_year.year_code},
        )
        posted += 1
    db.commit()
    return posted


def rollback(db, leave_year, reason: str, actor_id: int | None) -> int:
    """Reverse every reset entry for this leave year, by posting its inverse."""
    prefix = f"reset:{leave_year.leave_year_id}:"
    entries = (
        db.query(LeaveLedger)
        .filter(
            LeaveLedger.leave_year_id == leave_year.leave_year_id,
            LeaveLedger.entry_type == RESET_ENTRY_TYPE,
            LeaveLedger.source_reference.like(f"{prefix}%"),
        )
        .all()
    )
    posted = 0
    for entry in entries:
        reference = f"rollback:{entry.source_reference}"
        if ledger_dao.find_by_source_reference(db, reference) is not None:
            continue
        ledger_dao.create_entry(
            db, employee_id=entry.employee_id, leave_type_id=entry.leave_type_id, pool_id=entry.pool_id,
            leave_year_id=entry.leave_year_id, entry_type=ROLLBACK_ENTRY_TYPE,
            quantity=-float(entry.quantity), source_reference=reference, actor_id=actor_id,
            is_system_actor=actor_id is None, reason=reason,
        )
        audit_service.record(
            db, action="BALANCE_RESET_ROLLED_BACK", entity_type="leave_ledger", entity_id=entry.employee_id,
            actor_id=actor_id, is_system_actor=actor_id is None,
            new_value={"restored": -float(entry.quantity), "reason": reason},
        )
        posted += 1
    db.commit()
    return posted


def close_past_years(db, current) -> list[str]:
    """Mark leave years that have already ended as closed, so the old balance period is
    history and nothing can post into it."""
    closed = []
    for year in leave_year_dao.list_all(db):
        if year.leave_year_id == current.leave_year_id or year.is_closed:
            continue
        if year.end_date < current.start_date:
            year.is_closed = True
            closed.append(year.year_code)
    db.commit()
    return closed


def _posting_ids(db, target_key: str) -> tuple[int, int | None]:
    """Which (leave_type_id, pool_id) a compensating entry carries for a target key."""
    kind, raw_id = target_key.split(":")
    if kind == "pool":
        pool_id = int(raw_id)
        members = entitlement_dao.list_members(db, pool_id)
        return members[0].leave_type_id, pool_id
    return int(raw_id), None


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
    fields = ["employee_code", "employee_name", "target_name", "current_balance", "adjustment",
              "new_balance", "already_reset"]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--confirm", action="store_true", help="write the entries (without this it is a dry run)")
    parser.add_argument("--backup-verified", action="store_true",
                        help="you have taken and verified a restorable database backup")
    parser.add_argument("--allow-production", action="store_true", help="required against a production database")
    parser.add_argument("--reason", default="HR decision: existing leave balances discontinued.")
    parser.add_argument("--csv", default=None, help="write the report to this file as well")
    parser.add_argument("--rollback", action="store_true", help="reverse a reset instead of performing one")
    parser.add_argument("--close-past-years", action="store_true",
                        help="also mark leave years that have ended as closed")
    parser.add_argument("--actor-id", type=int, default=None, help="the administrator this is recorded against")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        leave_year = leave_year_dao.find_current(db)
        if leave_year is None:
            raise SystemExit("No current leave year: nothing to reset.")
        if leave_year.is_closed:
            raise SystemExit(f"{leave_year.year_code} is closed and cannot be modified.")

        rows = plan(db, leave_year)
        comp_off = comp_off_records(db, leave_year)
        header = "ROLLBACK" if args.rollback else ("APPLYING" if args.confirm else "DRY RUN")
        print(f"{header} — leave year {leave_year.year_code} ({leave_year.start_date} to {leave_year.end_date})")
        print(f"  profile: {_profile_label()}")
        print(f"  {len({r['employee_id'] for r in rows})} employee(s), {len(rows)} balance(s) to zero")
        for row in rows:
            flag = " (already reset)" if row["already_reset"] else ""
            print(f"    {row['employee_code']:<12} {row['target_name']:<24} "
                  f"{row['current_balance']:>8} -> 0{flag}")
        if comp_off:
            credited = sum(r["days"] for r in comp_off if r["status"] == "APPROVED")
            print(f"  comp-off claims in this year: {len(comp_off)} record(s), {credited:g} day(s) credited — "
                  "the records are kept, the days are zeroed with everything else")
        if args.csv:
            write_csv(Path(args.csv), rows)
            print(f"  report written to {args.csv}")

        if not args.confirm:
            print("\nNothing was written. Re-run with --confirm --backup-verified to apply.")
            return

        if not args.backup_verified:
            raise SystemExit("Refusing to write without --backup-verified: take a restorable backup first.")
        if _is_production() and not args.allow_production:
            raise SystemExit(
                f"APP_PROFILE={_profile_label()} looks like production. "
                "Re-run with --allow-production if that is what you mean."
            )

        if args.rollback:
            restored = rollback(db, leave_year, f"Rollback of the balance reset. {args.reason}", args.actor_id)
            print(f"\nRolled back: {restored} entry(ies) reversed. Balances are back to what they were.")
            return

        posted = apply_reset(db, leave_year, rows, args.reason, args.actor_id)
        print(f"\nReset: {posted} compensating entry(ies) posted. Every active balance is now zero.")
        if args.close_past_years:
            closed = close_past_years(db, leave_year)
            print(f"Closed earlier leave years: {', '.join(closed) if closed else 'none to close'}")
        print("History is untouched: no row was deleted, and every old entry is still on the ledger.")
        print("Next: grant opening balances in Administration > Opening balances.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
