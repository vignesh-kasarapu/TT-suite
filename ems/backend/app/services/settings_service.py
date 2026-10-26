from sqlalchemy.orm import Session

from app.models import AppSetting
from app.services import audit_service

DEFAULTS: dict[str, object] = {
    "reminder_days": 3,  # FR-2.8: days pending before reminders
    "escalation_days": 5,  # FR-2.8: further days before escalating to the approver's manager
    "payroll_cutoff_day": 25,  # FR-6.13: approved after this day of month -> next month's payroll
    "self_approval_cap": None,  # FR-3.6: max claim total for self-approval (None = no cap)
    "finance_backup_reviewer_id": None,  # FR-3.9
    "finance_second_reviewer_id": None,  # FR-3.9: checks the backup reviewer's own claims
    "advance_max_amount": 50000,  # A40
    "advance_settle_days": 60,  # A45
    "duplicate_window_days": 180,  # FR-8.1
    "late_submission_days": 90,  # FR-5.11: expenses older than this cannot be claimed
    "require_project": False,  # every claim must name a project
    "require_purpose": False,  # every claim must give a business purpose
    "projects": [],  # dropdown lists; empty = free text
    "cost_centres": [],
    "departments": [],
    "level2_above": 20000,  # FR-2.2: a line above this amount (as approved at Level 1) also needs the second approver
    "level2_approver_id": None,  # PLACEHOLDER: the second approver for every category (seed: Vikram)
    "fallback_approver_id": None,  # used when no Level 1 / Level 2 approver can be found
    "bank_change_needs_verification": True,  # employee bank changes wait for Finance
    # PLACEHOLDER: your company's GSTIN per state (FR-7.3). Seed values are fake examples.
    "company_gstins": {"Karnataka": "29AAAAA0000A1Z5", "Maharashtra": "27AAAAA0000A1Z9"},
}


def get(db: Session, key: str):
    row = db.get(AppSetting, key)
    return row.value if row else DEFAULTS.get(key)


def get_all(db: Session) -> dict:
    return {key: get(db, key) for key in DEFAULTS}


def update(db: Session, actor_id: int, changes: dict) -> dict:
    for key, value in changes.items():
        if key not in DEFAULTS:
            continue
        old = get(db, key)
        if old == value:
            continue
        row = db.get(AppSetting, key)
        if row:
            row.value = value
        else:
            db.add(AppSetting(key=key, value=value))
        audit_service.log(db, actor_id, "SETTING_CHANGED", "setting", key, details={"old": old, "new": value})
    db.commit()
    return get_all(db)
