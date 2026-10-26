"""Loads sample users, the FRD-2.3 example categories, a few policy limits and settings.

Run once after the migrations (`python -m app migrate`):  python seed.py
Safe to re-run: it does nothing if users already exist.
Every seeded user is mirrored into the TT Suite (app.app_access) with their effective Expense role,
so they appear on the portal dashboard. Sign-in is through the portal (Microsoft); for local demos
without Microsoft, POST /api/auth/dev/sign-in {"email": ...} (refused when APP_PROFILE=prod).
"""
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models import AppSetting, Category, PolicyLimit, User
from app.services import suite_service

# PLACEHOLDER: sample people. Replace with real users (Admin > Users) or an HR import.
USERS = [
    # key, name, email, code, department, location, manager key, roles.
    # Roles: APPROVER = Manager (approves their team; can self-approve and request advances),
    # FINANCE = Finance Reviewer, ADMIN = configures the system and never approves (can self-approve and request advances).
    ("vikram", "Vikram Rao", "vikram@example.com", "E001", "Leadership", "Bengaluru", None, ["APPROVER"]),
    ("maya", "Maya Iyer", "maya@example.com", "E002", "Engineering", "Bengaluru", "vikram", ["APPROVER"]),
    ("tara", "Tara Menon", "tara@example.com", "E003", "Travel Desk", "Bengaluru", "vikram", ["APPROVER"]),
    ("arun", "Arun Das", "arun@example.com", "E004", "Administration", "Bengaluru", "vikram", ["APPROVER"]),
    ("hema", "Hema Kulkarni", "hema@example.com", "E005", "Human Resources", "Pune", "vikram", ["APPROVER"]),
    ("fiona", "Fiona D'Souza", "fiona@example.com", "E006", "Finance", "Bengaluru", "vikram", ["FINANCE"]),
    ("farhan", "Farhan Ali", "farhan@example.com", "E007", "Finance", "Bengaluru", "vikram", ["FINANCE"]),
    ("feroz", "Feroz Khan", "feroz@example.com", "E008", "Finance", "Mumbai", "vikram", ["FINANCE"]),
    ("admin", "Asha Admin", "admin@example.com", "E009", "IT", "Bengaluru", "vikram", ["ADMIN"]),
    ("eshan", "Eshan Gupta", "eshan@example.com", "E010", "Engineering", "Bengaluru", "maya", []),
    ("esha", "Esha Nair", "esha@example.com", "E011", "Engineering", "Pune", "maya", []),
]

# FRD-2.3. Level 1 is always the employee's reporting manager; Level 2 is one company-wide rule (LEVEL2 below).
CATEGORIES = [
    # name, kind, GL, gst credit, taxable, receipt, extra field
    ("Flights & trains", "EXPENSE", "6100", True, False, True, None),
    ("Local transport", "EXPENSE", "6110", False, False, True, None),
    ("Hotel", "EXPENSE", "6400", True, False, True, None),
    ("Own vehicle mileage", "EXPENSE", "6120", False, False, False, "Trip (from, to, km)"),
    ("Meals while travelling", "EXPENSE", "6320", False, False, True, None),
    ("Client meals", "EXPENSE", "6300", False, False, True, "Attendees"),
    ("Team meals", "EXPENSE", "6310", False, False, True, "Attendees"),
    ("Software & subscriptions", "EXPENSE", "6220", True, False, True, None),
    ("Internet & phone", "EXPENSE", "6210", True, False, True, None),
    ("Office supplies & equipment", "EXPENSE", "6200", True, False, True, None),
    ("Training & courses", "EXPENSE", "6500", True, False, True, None),
    ("Miscellaneous", "EXPENSE", "6900", False, False, True, "Reason"),
    ("Cash Advance", "ADVANCE", "1400", False, False, False, None),
]
# PLACEHOLDER: lines above this amount also need the second approver. Change in Admin > Settings > Approvals.
LEVEL2 = {"above": 20000, "approver": "vikram"}

# PLACEHOLDER: picker headings, short descriptions and "receipt only above" amounts. Change in Admin > Settings > Categories.
GROUPS = {
    "Flights & trains": "Travel", "Local transport": "Travel", "Hotel": "Travel", "Own vehicle mileage": "Travel",
    "Meals while travelling": "Food", "Client meals": "Food", "Team meals": "Food",
    "Software & subscriptions": "Work tools", "Internet & phone": "Work tools", "Office supplies & equipment": "Work tools",
    "Training & courses": "Other", "Miscellaneous": "Other",
}
DESCRIPTIONS = {
    "Local transport": "Cab, auto, metro, parking, tolls",
    "Own vehicle mileage": "Own car or bike",
    "Miscellaneous": "With a short reason",
}
RECEIPT_ABOVE = {"Local transport": 200, "Meals while travelling": 200}

# PLACEHOLDER: dropdown lists for claims and users. Replace in Admin > Settings.
LISTS = {
    "projects": ["Internal", "Project Alpha", "Project Beta"],
    "cost_centres": ["CC-100 Engineering", "CC-200 Sales", "CC-300 Operations"],
    "departments": ["Administration", "Engineering", "Finance", "Human Resources", "IT", "Leadership", "Travel Desk"],
}


def main() -> None:
    with SessionLocal() as db:
        if db.scalars(select(User.id).limit(1)).first():
            print("Users already exist; nothing to do.")
            return
        people: dict[str, User] = {}
        for key, name, email, code, dept, loc, _mgr, roles in USERS:
            people[key] = User(full_name=name, email=email, employee_code=code, department=dept,
                               location=loc, roles=roles, is_active=True)
            db.add(people[key])
        db.flush()
        for key, *_rest, mgr, _roles in USERS:
            if mgr:
                people[key].manager_id = people[mgr].id

        cats: dict[str, Category] = {}
        for name, kind, gl, gst, taxable, receipt, extra in CATEGORIES:
            cat = Category(name=name, kind=kind, gl_code=gl, gst_credit_eligible=gst, taxable=taxable,
                           receipt_required=receipt, extra_field_label=extra, group_name=GROUPS.get(name, ""), description=DESCRIPTIONS.get(name),
                           receipt_threshold=Decimal(RECEIPT_ABOVE[name]) if name in RECEIPT_ABOVE else None)
            db.add(cat)
            cats[name] = cat
        db.flush()

        # PLACEHOLDER: sample policy limits. Replace with your travel and expense policy in Admin > Policy limits.
        start = date(2026, 1, 1)
        db.add_all([
            PolicyLimit(category_id=cats["Client meals"].id, scope="COMPANY", period="LINE",
                        amount=Decimal(5000), action="FLAG", effective_from=start),
            PolicyLimit(category_id=cats["Office supplies & equipment"].id, scope="COMPANY", period="MONTH",
                        amount=Decimal(10000), action="WARN", effective_from=start),
            PolicyLimit(category_id=cats["Hotel"].id, scope="COMPANY", period="LINE",
                        amount=Decimal(12000), action="FLAG", effective_from=start),
            PolicyLimit(category_id=cats["Training & courses"].id, scope="COMPANY", period="LINE",
                        amount=Decimal(250000), action="BLOCK", effective_from=start),
        ])
        db.add_all([
            AppSetting(key="level2_above", value=LEVEL2["above"]),
            AppSetting(key="level2_approver_id", value=people[LEVEL2["approver"]].id),
            AppSetting(key="finance_backup_reviewer_id", value=people["farhan"].id),
            AppSetting(key="finance_second_reviewer_id", value=people["feroz"].id),
            *[AppSetting(key=k, value=v) for k, v in LISTS.items()],
        ])
        for person in people.values():
            suite_service.mirror(db, person)
        db.commit()
        print(f"Seeded {len(USERS)} users and mirrored them into the TT Suite.")


if __name__ == "__main__":
    main()
