"""Reference-data seed, run once per fresh database — mirrors backend/src/utils/seed.js:
3 roles, 5 management levels, 5 org leave types + policy + accrual config, the system
LOP type, COMP_OFF, the current leave year, config defaults, and the "Unassigned"
department that TT Suite provisioning puts new people in. No employees created here
(see scripts/seed_demo.py for a populated demo org).

TT Suite: also mirrors every existing employee's effective LMS role into
app.app_access (idempotent backfill), so the portal's access matrix matches. Runs
automatically on a fresh schema (app.core.bootstrap_db).

Run: python -m scripts.seed
"""
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import SessionLocal  # noqa: E402
from app.dao import leave_type_dao, leave_year_dao, notification_template_dao, org_structure_dao, role_dao  # noqa: E402
from app.models.org_structure import Role  # noqa: E402
from app.services import config_service, suite_access_service  # noqa: E402
from app.services.employee.directory import resolve_department_id  # noqa: E402
from app.services.suite_provision_service import UNASSIGNED_DEPARTMENT  # noqa: E402

ROLES = [
    ("EMPLOYEE", "Employee"),
    ("MANAGER", "Manager"),
    ("HR_ADMIN", "HR / Admin"),
]

MANAGEMENT_LEVELS = [("L1", "Level 1", 1), ("L2", "Level 2", 2), ("L3", "Level 3", 3), ("L4", "Level 4", 4), ("L5", "Level 5", 5)]

# code -> (name, annual_entitlement, carries_forward, carry_forward_cap, accrual_method,
#          is_sick_leave, gender_eligibility)
ORG_LEAVE_TYPES = [
    ("ANNUAL", "Annual Leave", 24, True, 10, "MONTHLY", False, "ALL"),
    ("SICK", "Sick Leave", 9, False, None, "MONTHLY", True, "ALL"),
    ("CASUAL", "Casual Leave", 15, False, None, "QUARTERLY", False, "ALL"),
    ("MATERNITY", "Maternity Leave", 182, False, None, "ANNUAL", False, "FEMALE"),
    ("BEREAVEMENT", "Bereavement Leave", 5, False, None, "ANNUAL", False, "ALL"),
]


def current_leave_year_bounds(start_month_day: str = "04-01") -> tuple[date, date, str]:
    month, day = (int(x) for x in start_month_day.split("-"))
    today = date.today()
    start_year = today.year if (today.month, today.day) >= (month, day) else today.year - 1
    start = date(start_year, month, day)
    end = date(start_year + 1, month, day) - timedelta(days=1)
    code = f"{start_year}-{start_year + 1}"
    return start, end, code


def seed_roles(db):
    for code, name in ROLES:
        if role_dao.find_role_by_code(db, code) is None:
            db.add(Role(role_code=code, role_name=name))
    db.commit()


def seed_management_levels(db):
    for code, name, rank in MANAGEMENT_LEVELS:
        if org_structure_dao.find_management_level_by_code(db, code) is None:
            org_structure_dao.create_management_level(db, level_code=code, level_name=name, level_rank=rank)


def seed_leave_types(db):
    for code, name, entitlement, carries_forward, cap, accrual_method, is_sick, gender in ORG_LEAVE_TYPES:
        lt = leave_type_dao.find_by_code(db, code)
        if lt is None:
            lt = leave_type_dao.create(
                db, type_code=code, type_name=name, is_sick_leave=is_sick, permits_half_day=True,
                permits_attachments=is_sick, gender_eligibility=gender,
            )
        elif lt.gender_eligibility != gender:
            lt.gender_eligibility = gender  # keeps an already-seeded database in step
        if leave_type_dao.find_policy(db, lt.leave_type_id) is None:
            leave_type_dao.create_policy(
                db, leave_type_id=lt.leave_type_id, annual_entitlement=entitlement,
                carries_forward=carries_forward, carry_forward_cap=cap,
            )
        if leave_type_dao.find_accrual_config(db, lt.leave_type_id) is None:
            leave_type_dao.create_accrual_config(db, leave_type_id=lt.leave_type_id, accrual_method=accrual_method)

    if leave_type_dao.find_by_code(db, "LOP") is None:
        leave_type_dao.create(
            db, type_code="LOP", type_name="Loss of Pay", is_system=True,
            is_balance_affecting=False, is_selectable_by_employee=False,
        )
    if leave_type_dao.find_by_code(db, "COMP_OFF") is None:
        leave_type_dao.create(db, type_code="COMP_OFF", type_name="Compensatory Off", permits_half_day=True)


def seed_leave_year(db):
    start, end, code = current_leave_year_bounds()
    if leave_year_dao.find_by_code(db, code) is None:
        leave_year_dao.create(db, year_code=code, start_date=start, end_date=end, is_current=True)


# FRD Section 6 event keys — mirrors seed.js's `templates` list verbatim.
NOTIFICATION_TEMPLATES = [
    ("REQUEST_SUBMITTED_CONFIRMATION", "Your leave request has been submitted", "Your request for {{days}} day(s) from {{startDate}} to {{endDate}} has been submitted."),
    ("REQUEST_AWAITING_DECISION", "Leave request awaiting your decision", "{{employeeName}} has requested {{days}} day(s) leave from {{startDate}} to {{endDate}}."),
    ("NEW_REQUEST_AWAITING_DECISION", "A request has moved to your queue", "A leave request now requires your decision."),
    ("REQUEST_APPROVED", "Your leave request was approved", "Your leave request has been approved."),
    ("REQUEST_REJECTED", "Your leave request was rejected", "Your leave request was rejected. Reason: {{reason}}"),
    ("SLA_REMINDER", "Reminder: a leave request is awaiting your decision", "Request #{{requestId}} is approaching its SLA deadline."),
    ("ESCALATION_NOTICE_TO_PRIOR_APPROVER", "A request escalated past your queue", "A leave request has escalated to the next level after breaching SLA. It is now with {{newApproverName}}."),
    ("REQUEST_ESCALATED", "Your leave request moved to a new approver", "Your leave request #{{requestId}} was not actioned within the SLA window and has escalated. It is now with {{newApproverName}}."),
    ("CANCELLATION_REQUEST_AWAITING_DECISION", "Cancellation request awaiting your decision", "{{employeeName}} has requested cancellation of an approved leave."),
    ("CANCELLATION_APPROVED", "Your cancellation was approved", "Your leave cancellation has been approved."),
    ("CANCELLATION_REJECTED", "Your cancellation was rejected", "Your leave cancellation request was rejected."),
    ("BALANCE_ADJUSTED", "Your leave balance was adjusted", "Your balance was adjusted by {{quantity}} day(s). Reason: {{reason}}"),
    ("LOSS_OF_PAY_APPLIED", "Loss of pay applied", "Your withdrawal window expired; the request has been converted to Loss of Pay."),
    ("DELEGATE_ASSIGNED_TO_YOU", "Delegation update", "A delegation involving you has been set from {{nominatorId}} to {{delegateId}}."),
    ("SELF_APPROVAL_GRANTED", "Self-approval permission granted", "HR/Admin has granted you self-approval permission for leave requests, effective where no higher authority exists."),
    ("MANAGER_REASSIGNED", "Reporting line updated", "{{employeeName}} ({{employeeCode}}) now reports to {{newManagerName}} ({{newManagerCode}}). Previous manager: {{oldManagerName}}."),
    ("LEAVE_ENCASHMENT_POSTED", "Leave encashment posted", "{{daysEncashed}} day(s) of leave have been encashed and recorded for payroll."),
    ("COMP_OFF_CREDITED", "Compensatory off credited", "{{hoursOrDays}} day(s) of compensatory off have been credited for your work on {{workDate}}."),
    ("WATCHED_REQUEST_SUBMITTED", "A watched request was submitted", "A leave request you are watching has been submitted."),
    ("WATCHED_REQUEST_APPROVED", "A watched request was approved", "A leave request you are watching has been approved."),
    ("WATCHED_REQUEST_REJECTED", "A watched request was rejected", "A leave request you are watching has been rejected."),
    ("WATCHED_REQUEST_CANCELLED", "A watched request was cancelled", "A leave request you are watching has been cancelled."),
    ("LONG_LEAVE_SUPERVISOR_NOTICE", "Long leave submitted in your reporting line", "{{employeeName}}'s request has entered second-stage (HR) approval. This is notification only — you have no approval authority over it."),
    ("EXTENDED_SICK_LEAVE_ALERT", "Extended sick leave", "{{employeeName}} has an extended sick leave request ({{days}} day(s))."),
    ("CARRY_FORWARD_APPLIED", "Carry-forward applied", "Your leave-year rollover is complete: {{carried}} day(s) carried forward, {{lapsed}} day(s) lapsed."),
    ("EMPLOYEE_ONBOARDING_INVITE", "Welcome to LMS — sign in to get started", "Hi {{fullName}}, your employee record has been created. Sign in at {{signInUrl}} using your work email with your Microsoft account (single sign-on) to access the system."),
]


def seed_notification_templates(db):
    for key, subject, body in NOTIFICATION_TEMPLATES:
        if notification_template_dao.find_by_key(db, key) is None:
            notification_template_dao.create(db, template_key=key, subject_template=subject, body_template=body)


def run():
    db = SessionLocal()
    try:
        seed_roles(db)
        seed_management_levels(db)
        seed_leave_types(db)
        seed_leave_year(db)
        config_service.seed_defaults(db, updated_by=None)
        seed_notification_templates(db)
        resolve_department_id(db, UNASSIGNED_DEPARTMENT)  # find-or-create
        suite_access_service.sync_all(db)
        db.commit()
        print("OK: reference data seeded.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
