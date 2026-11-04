"""Apply a company's leave policy: its leave types, entitlements and shared pools.

The policy is data, not code and not part of the reference seed — a deployment must never
ship one company's entitlements to another (§18). Copy `seed/company-policy.example.json`
to `seed/company-policy.json` (gitignored), edit the numbers, then:

    python -m scripts.seed_company_policy                 # dry run: prints what it would do
    python -m scripts.seed_company_policy --confirm       # applies it
    python -m scripts.seed_company_policy --file other.json --confirm

Applying is additive and idempotent:

* the system types (LOP, Compensatory Off) are created if the file lists them and they are
  missing — nothing else creates them, at any point;
* a leave type that does not exist is created with its policy;
* an existing type keeps its name, its policy and its history — the file never overwrites a
  number HR has since changed in the application;
* a pool that does not exist is created and its member types are attached;
* every active employee is then granted whatever they have not been granted yet, in full —
  this is the one place a bulk grant happens, and it only runs when somebody asks for it with
  `--confirm`. Creating a leave type in the application never credits anybody.

Nothing is deleted and no balance is overwritten.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import SessionLocal  # noqa: E402
from app.core.seed_data import seed_dir  # noqa: E402
from app.dao import entitlement_dao, leave_type_dao, leave_year_dao  # noqa: E402
from app.services import entitlement_service  # noqa: E402


def load(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(f"Policy file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def apply_policy(db, policy: dict, actor_id: int | None = None, dry_run: bool = True) -> list[str]:
    """Returns the lines describing what was done (or would be)."""
    lines: list[str] = []

    # The two types the application looks up by code. They carry no entitlement and nothing
    # creates them by itself — a deployment that wants loss-of-pay conversion or comp-off
    # claims asks for them here, deliberately.
    for spec in policy.get("system_leave_types", []):
        if leave_type_dao.find_by_code(db, spec["code"]) is not None:
            lines.append(f"system leave type {spec['code']} already exists — left as it is")
            continue
        lines.append(f"create system leave type {spec['code']} ({spec['name']})")
        if not dry_run:
            fields = {k: v for k, v in spec.items() if k not in ("code", "name", "note")}
            leave_type_dao.create(db, type_code=spec["code"], type_name=spec["name"], **fields)

    for spec in policy.get("leave_types", []):
        leave_type = leave_type_dao.find_by_code(db, spec["code"])
        if leave_type is None:
            lines.append(f"create leave type {spec['code']} ({spec['name']}), {spec['annual_entitlement']} day(s)/year")
            if not dry_run:
                leave_type = leave_type_dao.create(
                    db, type_code=spec["code"], type_name=spec["name"],
                    is_sick_leave=bool(spec.get("is_sick_leave")), permits_half_day=True,
                    permits_attachments=bool(spec.get("is_sick_leave")),
                    gender_eligibility=spec.get("gender_eligibility", "ALL"),
                    marital_eligibility=spec.get("marital_eligibility", "ANY"),
                )
        else:
            lines.append(f"leave type {spec['code']} already exists — left as it is")
        if leave_type is not None and leave_type_dao.find_policy(db, leave_type.leave_type_id) is None:
            lines.append(f"  set {spec['code']} entitlement to {spec['annual_entitlement']} day(s)/year")
            if not dry_run:
                leave_type_dao.create_policy(
                    db, leave_type_id=leave_type.leave_type_id, annual_entitlement=spec["annual_entitlement"],
                    carries_forward=bool(spec.get("carries_forward")), carry_forward_cap=spec.get("carry_forward_cap"),
                )

    for spec in policy.get("pools", []):
        pool = entitlement_dao.find_pool_by_code(db, spec["code"])
        if pool is None:
            lines.append(
                f"create shared pool {spec['code']} ({spec['name']}), {spec['annual_entitlement']} day(s)/year "
                f"shared by {', '.join(spec['leave_type_codes'])}"
            )
            if not dry_run:
                pool = entitlement_dao.create_pool(
                    db, pool_code=spec["code"], pool_name=spec["name"],
                    annual_entitlement=spec["annual_entitlement"],
                    carries_forward=bool(spec.get("carries_forward")), carry_forward_cap=spec.get("carry_forward_cap"),
                    updated_by=actor_id,
                )
        else:
            lines.append(f"shared pool {spec['code']} already exists — left as it is")
        if pool is not None and not dry_run:
            for code in spec["leave_type_codes"]:
                member = leave_type_dao.find_by_code(db, code)
                if member is not None:
                    entitlement_dao.set_membership(db, member.leave_type_id, pool.pool_id, actor_id)

    if not dry_run:
        db.commit()

    leave_year = leave_year_dao.find_current(db)
    if leave_year is None:
        lines.append("no current leave year: nothing granted")
        return lines

    if dry_run:
        lines.append("then grant every active employee the full entitlement of each target they do not hold yet")
        return lines

    from app.dao import employee_dao

    for target in entitlement_service.grantable_targets(db):
        granted = 0
        for employee in employee_dao.list_active(db):
            if entitlement_service.grant_entitlement(db, employee, target, leave_year, actor_id):
                granted += 1
        if granted:
            lines.append(f"granted {target.name} ({target.entitlement_days:g} day(s)) to {granted} employee(s)")
    db.commit()
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", default=None, help="policy file (default: seed/company-policy.json)")
    parser.add_argument("--confirm", action="store_true", help="apply it (without this it is a dry run)")
    args = parser.parse_args()

    path = Path(args.file) if args.file else seed_dir() / "company-policy.json"
    policy = load(path)

    db = SessionLocal()
    try:
        lines = apply_policy(db, policy, actor_id=None, dry_run=not args.confirm)
    finally:
        db.close()

    print(f"{'APPLYING' if args.confirm else 'DRY RUN'} — {path}")
    for line in lines:
        print(" ", line)
    if not args.confirm:
        print("\nNothing was written. Re-run with --confirm to apply.")


if __name__ == "__main__":
    main()
