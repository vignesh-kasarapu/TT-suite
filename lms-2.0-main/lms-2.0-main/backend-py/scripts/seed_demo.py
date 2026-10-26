"""Demo-org seed — port of backend/src/utils/seedDemo.js. Run AFTER scripts.seed and
scripts.seed_employees:

    python -m scripts.seed_demo

Fills every screen with data: departments, management levels, reporting lines, MANAGER/HR_ADMIN
grants, project + standing watcher + working pattern, holidays, 14 leave requests covering every
request state, and 3 delegations (primary / supervisor-initiated / fallback). Requests and
delegations go through the real service layer (ledger postings, routing, watchers, notifications
all execute) — nothing is hand-inserted except the two timestamp back-dates the Node script also
does. Idempotent: each scenario is skipped when its own marker already exists.
"""
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.core.exceptions import AppError  # noqa: E402
from app.dao import (  # noqa: E402
    employee_dao, leave_type_dao, leave_year_dao, org_structure_dao, self_approval_dao,
)
from app.models.delegation_watcher import Delegation, StandingWatcher  # noqa: E402
from app.models.leave_config import Holiday  # noqa: E402
from app.models.leave_request import LeaveRequest  # noqa: E402
from app.models.org_structure import Project, ProjectAssignment  # noqa: E402
from app.models.working_pattern import WorkingPattern, WorkingPatternAssignment  # noqa: E402
from app.services import (  # noqa: E402
    accrual_service, config_service, delegation_service, escalation_service, holiday_service,
    notification_service, optional_holiday_service, org_structure_service, role_assignment_service, self_approval_service,
    suite_access_service, watcher_service, working_pattern_service,
)
from app.services.employee import onboarding  # noqa: E402
from app.services.leave_request import cancellation, decision, drafts, submission  # noqa: E402

TODAY = date.today()
SYSTEM = None  # acts as "the system", same convention as the accrual jobs

# Seeding fires dozens of notifications; never send them as real email to the demo addresses.
notification_service.send_email = lambda *args, **kwargs: None


def next_monday(d: date) -> date:
    return d + timedelta(days=(7 - d.weekday()) % 7 or 7)


def weekday_span(monday: date, n: int) -> tuple[date, date]:
    count, cur, end = 0, monday, monday
    while count < n:
        if cur.weekday() < 5:
            count += 1
            end = cur
        if count < n:
            cur += timedelta(days=1)
    return monday, end


def plan_windows(sizes: list[tuple[str, int]]) -> dict[str, tuple[date, date]]:
    """Non-overlapping future windows handed out in a fixed order up front, so a re-run
    (where finished scenarios are skipped) still computes the same windows for each one."""
    windows, cursor_week = {}, 2
    for key, n in sizes:
        windows[key] = weekday_span(next_monday(TODAY + timedelta(weeks=cursor_week)), n)
        cursor_week += -(-n // 5) + 1
    return windows


# Every scenario's reason, keyed by its old [SEED-nn] marker. The reason doubles as the
# idempotency key — it is unique per employee and stable across runs, which is the job the
# markers used to do. Writing a bracketed marker into a user-visible field to achieve
# that was never worth it; these read like something a person actually typed.
REASONS = {
    "01": "Cousin's wedding in Pune",
    "02A": "Passport appointment",
    "02B": "Family trip to Goa",
    "03": "Planning a short break, dates not final yet",
    "04": "Wedding and family functions back home",
    "05": "Moving house",
    "06": "Extended trip home to see family",
    "07": "Bank paperwork, sorting it another way",
    "08A": "Annual holiday with family",
    "08": "Extending the holiday by a fortnight",
    "09": "Trip I may still have to call off",
    "10": "Viral fever, resting on the doctor's advice",
    "11": "Parent-teacher meeting at school",
    "12": "Family commitment at home",
    "13": "Car service and registration",
    "14": "Visiting my grandparents",
    "20": "Festival shopping with family",
    "21": "House repairs I have to be there for",
    "22": "Migraine, advised to rest",
    "23": "Short break, visiting relatives",
    "24": "Personal errand at the registry office",
    "25": "Long weekend away",
    "30": "Short break before audit season",
    "31": "Home maintenance",
    "32": "Planning end-of-year leave",
    "40": "Family holiday",
    "41": "School admission formalities",
    "42": "Attending a friend's wedding",
    "43": "Flu, advised two days of rest",
    "44": "Family function out of town",
    "45": "Vehicle registration appointment",
    "46": "Family visit",
    "47": "Medical check-up",
}


GRADES = (
    ("G1", "Associate"),
    ("G2", "Senior Associate"),
    ("G3", "Lead"),
    ("G4", "Manager"),
    ("G5", "Senior Manager"),
)


def already_seeded(db, employee_id: int, reason: str):
    """Exact-match on the reason: unique per employee, so re-running is still a no-op."""
    return db.execute(
        select(LeaveRequest).where(LeaveRequest.employee_id == employee_id, LeaveRequest.reason == reason)
    ).scalars().first()


# name, (month, day), is_optional. Fixed-date Indian public holidays only — the movable
# festivals (Diwali, Holi, Eid, Good Friday) shift every year, so replace this list with the
# organisation's own published calendar rather than letting a seed guess their dates. Each
# entry is placed in whichever calendar year the current leave year covers for that month.
HOLIDAYS = [
    ("Labour Day", (5, 1), False),
    ("Independence Day", (8, 15), False),
    ("Gandhi Jayanti", (10, 2), False),
    ("Christmas Day", (12, 25), False),
    ("Republic Day", (1, 26), False),
    ("Dr. Ambedkar Jayanti", (4, 14), True),
    ("Children's Day", (11, 14), True),
]

# code, first+last, email, designation, department, level, manager code, joining ("START"|"MID"), roles, gender
ROSTER = [
    ("EMP001", "Asha Rao", "asha.rao@example.com", "HR Business Partner", "ENG", "L5", None, "START", ["HR_ADMIN"], "FEMALE"),
    ("EMP002", "Vikram Shah", "vikram.shah@example.com", "Engineering Manager", "ENG", "L4", "EMP001", "START", ["MANAGER"], "MALE"),
    ("EMP003", "Priya Nair", "priya.nair@example.com", "Software Engineer", "ENG", "L2", "EMP002", "START", [], "FEMALE"),
    ("EMP004", "Rohan Mehta", "rohan.mehta@example.com", "Software Engineer", "ENG", "L2", "EMP002", "START", [], "MALE"),
    ("EMP005", "Neha Kapoor", "neha.kapoor@example.com", "Product Manager", "PRD", "L4", "EMP001", "START", ["MANAGER"], "FEMALE"),
    ("EMP006", "Arjun Desai", "arjun.desai@example.com", "Product Analyst", "PRD", "L2", "EMP005", "START", [], "MALE"),
    ("EMP007", "Kavya Iyer", "kavya.iyer@example.com", "Product Analyst", "PRD", "L2", "EMP005", "START", [], "FEMALE"),
    ("EMP008", "Sanjay Verma", "sanjay.verma@example.com", "Team Lead", "ENG", "L3", "EMP002", "START", ["MANAGER"], "MALE"),
    ("EMP009", "Meera Joshi", "meera.joshi@example.com", "Associate Engineer", "ENG", "L1", "EMP008", "START", [], "FEMALE"),
    ("EMP010", "Aditya Rao", "aditya.rao@example.com", "Software Engineer", "ENG", "L2", "EMP002", "MID", [], "MALE"),
]


def ensure_department(db, code, name):
    return org_structure_dao.find_department_by_code(db, code) or org_structure_dao.create_department(
        db, department_code=code, department_name=name
    )


def ensure_roster(db, year, dept_by_code, level_by_code):
    """Create-or-reconcile each demo employee (create via real onboarding; reconcile as plain field
    update when seed_employees.py already created the row), then grant roles."""
    year_end = year.end_date.year
    emps: dict = {}
    for code, full_name, email, designation, dept, level, mgr_code, join_kind, roles, gender in ROSTER:
        joined = year.start_date if join_kind == "START" else date(year_end, 1, 15)
        manager_id = emps[mgr_code].employee_id if mgr_code else None
        first, _, last = full_name.partition(" ")
        emp = employee_dao.find_by_employee_code(db, code)
        if emp is None:
            emp = onboarding.onboard_employee(db, {
                "entra_oid": f"DEV-SEED-{code}", "work_email": email, "employee_code": code, "full_name": full_name,
                "date_of_joining": joined.isoformat(), "department_id": dept_by_code[dept].department_id,
                "management_level_id": level_by_code[level].management_level_id, "designation": designation,
                "reporting_manager_id": manager_id, "gender": gender,
            }, SYSTEM)
        else:
            employee_dao.update(db, emp, {
                "first_name": first, "last_name": last or None, "department_id": dept_by_code[dept].department_id,
                "management_level_id": level_by_code[level].management_level_id, "designation": designation,
                "reporting_manager_id": manager_id, "date_of_joining": joined, "is_active": True,
                "gender": gender,
            })
            db.commit()
        for role in roles:
            role_assignment_service.assign_role(db, emp.employee_id, role, SYSTEM)
        db.commit()
        accrual_service.post_opening_pro_rata(db, emp.employee_id)  # no-op if already posted
        emps[code] = emp
    return emps


def run():
    db = SessionLocal()
    try:
        year = leave_year_dao.find_current(db)
        if year is None:
            raise SystemExit("No current leave year. Run `python -m scripts.seed` first.")
        next_code = f"{year.start_date.year + 1}-{year.end_date.year + 1}"
        next_year = leave_year_dao.find_by_code(db, next_code) or leave_year_dao.create(
            db, year_code=next_code, start_date=year.start_date.replace(year=year.start_date.year + 1),
            end_date=year.end_date.replace(year=year.end_date.year + 1), is_current=False,
        )
        db.commit()

        lt = {c: leave_type_dao.find_by_code(db, c) for c in ("ANNUAL", "CASUAL", "SICK")}
        annual_policy = leave_type_dao.find_policy(db, lt["ANNUAL"].leave_type_id)
        level_by_code = {c: org_structure_dao.find_management_level_by_code(db, c) for c in ("L1", "L2", "L3", "L4", "L5")}
        dept_by_code = {"ENG": ensure_department(db, "ENG", "Engineering"), "PRD": ensure_department(db, "PRD", "Product")}
        # Regions exist so the region field on an employee, and region-scoped holidays,
        # are demonstrable rather than permanently empty.
        for region_code, region_name in (("IND", "India"), ("IN-SOUTH", "South India")):
            if org_structure_dao.find_region_by_code(db, region_code) is None:
                org_structure_dao.create_region(db, region_code=region_code, region_name=region_name)
        # Grades are a lookup the edit screen offers; with the table empty that dropdown is
        # blank, so the pay-band field can never be set on anyone.
        existing_grades = {g.grade_code for g in org_structure_dao.list_grades(db)}
        for grade_code, grade_name in GRADES:
            if grade_code not in existing_grades:
                org_structure_dao.create_grade(db, grade_code=grade_code, grade_name=grade_name)
        db.commit()

        e = ensure_roster(db, year, dept_by_code, level_by_code)
        asha, vikram, priya, rohan = e["EMP001"], e["EMP002"], e["EMP003"], e["EMP004"]
        neha, arjun, kavya, sanjay, meera, aditya = e["EMP005"], e["EMP006"], e["EMP007"], e["EMP008"], e["EMP009"], e["EMP010"]

        # ---- Org data ------------------------------------------------------------------------
        atlas = db.execute(select(Project).where(Project.project_code == "ATLAS")).scalars().first()
        if atlas is None:
            atlas = org_structure_service.create_project(db, "ATLAS", "Atlas", asha.employee_id)
        if db.execute(select(ProjectAssignment).where(
            ProjectAssignment.employee_id == priya.employee_id, ProjectAssignment.project_id == atlas.project_id,
        )).scalars().first() is None:
            org_structure_service.assign_project(db, {
                "employee_id": priya.employee_id, "project_id": atlas.project_id, "project_lead_id": neha.employee_id,
                "effective_from": year.start_date, "effective_to": year.end_date,
            }, asha.employee_id)

        if db.execute(select(StandingWatcher).where(
            StandingWatcher.watched_employee_id == meera.employee_id, StandingWatcher.watcher_employee_id == neha.employee_id,
        )).scalars().first() is None:
            watcher_service.add_standing_watcher(
                db, meera.employee_id, neha.employee_id, year.start_date, year.end_date, asha.employee_id, True,
            )

        pattern = db.execute(select(WorkingPattern).where(WorkingPattern.pattern_code == "THU_FRI_WEEKEND")).scalars().first()
        if pattern is None:
            pattern = working_pattern_service.create_pattern(db, "THU_FRI_WEEKEND", "Thursday/Friday Weekend", ["THU", "FRI"], asha.employee_id)
        if db.execute(select(WorkingPatternAssignment).where(
            WorkingPatternAssignment.employee_id == sanjay.employee_id,
        )).scalars().first() is None:
            working_pattern_service.assign_pattern(
                db, sanjay.employee_id, pattern.working_pattern_id, year.start_date,
                year.start_date + timedelta(days=91), asha.employee_id,
            )

        def ensure_holiday(name, d, year_id, optional=False):
            row = db.execute(select(Holiday).where(Holiday.holiday_name == name)).scalars().first()
            if row:
                return row
            row = holiday_service.add_holiday(db, {
                "holiday_date": d, "holiday_name": name, "leave_year_id": year_id, "is_optional": optional,
            }, asha.employee_id)["holiday"]
            db.commit()
            return row

        for name, (month, day), optional in HOLIDAYS:
            holiday_year = year.start_date.year if month >= year.start_date.month else year.end_date.year
            ensure_holiday(name, date(holiday_year, month, day), year.leave_year_id, optional)
        # One in the next leave year, so switching the year selector is not an empty screen.
        ensure_holiday("Independence Day (next year)", date(next_year.start_date.year, 8, 15), next_year.leave_year_id)

        # ---- Optional-holiday choices --------------------------------------------------------
        # An optional holiday is the employee's own pick, so these are seeded as if each person
        # chose for themselves. Only some of the roster takes one, which is the realistic shape
        # and lets a manager see the difference between "chosen" and "none yet".
        optional = [h for h in holiday_service.list_holidays(db, year.leave_year_id) if h.is_optional]
        if optional:
            picks = [(priya, 0), (arjun, 1), (meera, 0), (employee_dao.find_by_employee_code(db, "EMP012"), 1)]
            for employee, index in picks:
                if employee is None or index >= len(optional):
                    continue
                try:
                    optional_holiday_service.select_optional_holiday(db, employee.employee_id, optional[index].holiday_id)
                except AppError:
                    pass  # already chosen, or over quota on a re-run — both fine
            db.commit()

        # ---- Leave requests ------------------------------------------------------------------
        # One request is capped at leave.max_days_per_request, so Kavya's over-balance scenario
        # (#8) first commits most of her Annual balance, then asks for more than what remains.
        cap = int(config_service.get(db, "leave.max_days_per_request"))
        entitlement = int(annual_policy.annual_entitlement)
        k_first = min(cap, entitlement - 5)
        k_second = min(cap, entitlement - k_first + 5)
        W = plan_windows([
            ("01", 2), ("02A", 1), ("02B", 3), ("03", 3), ("04", 12), ("05", 2), ("06", 8), ("07", 1),
            ("08A", k_first), ("08", k_second), ("09", 2), ("10", 3), ("11", 1), ("12", 1), ("13", 1), ("14", 2),
            # Managers and EMP012 take leave too — without these their own My Requests,
            # dashboard and balances are all empty while everyone they manage has data.
            ("40", 3), ("41", 1), ("42", 2), ("43", 2), ("44", 3), ("45", 1), ("46", 2), ("47", 1),
        ])

        def submit(emp, type_code, key, reason, half=False, portion=None):
            s, en = W[key]
            return submission.submit_request(
                db, emp.employee_id, lt[type_code].leave_type_id, s, s if half else en, half, portion, reason,
            )

        def approve(req, approver):
            return decision.decide(db, req.request_id, approver.employee_id, "APPROVE", "")

        def reject(req, approver, why):
            return decision.decide(db, req.request_id, approver.employee_id, "REJECT", why)

        # 1 Priya Annual 2d -> PENDING_MANAGER
        if not already_seeded(db, priya.employee_id, REASONS["01"]):
            submit(priya, "ANNUAL", "01", REASONS["01"])

        # 2a Rohan Casual 1d -> APPROVED
        if not already_seeded(db, rohan.employee_id, REASONS["02A"]):
            approve(submit(rohan, "CASUAL", "02A", REASONS["02A"]), vikram)

        # 2b Rohan Annual 3d approved, holiday lands inside span, then cancelled -> CANCELLED
        if not already_seeded(db, rohan.employee_id, REASONS["02B"]):
            r = approve(submit(rohan, "ANNUAL", "02B", REASONS["02B"]), vikram)
            ensure_holiday("Company Foundation Day", r.start_date, year.leave_year_id)
            r = cancellation.request_cancellation(db, r.request_id, rohan.employee_id)
            cancellation.decide_cancellation(db, r.request_id, vikram.employee_id, "APPROVE", float(r.deducted_days or 0))

        # 3 Meera Annual 3d draft -> DRAFT
        if not already_seeded(db, meera.employee_id, REASONS["03"]):
            s, en = W["03"]
            drafts.save_draft(db, meera.employee_id, lt["ANNUAL"].leave_type_id, s, en, False, None, REASONS["03"])

        # 4 Arjun Annual 12d (long leave) approved by Neha -> PENDING_HR
        if not already_seeded(db, arjun.employee_id, REASONS["04"]):
            approve(submit(arjun, "ANNUAL", "04", REASONS["04"]), neha)

        # 5 Sanjay Casual 2d rejected by Vikram -> REJECTED
        if not already_seeded(db, sanjay.employee_id, REASONS["05"]):
            reject(submit(sanjay, "CASUAL", "05", REASONS["05"]), vikram, "Team coverage constraints during this period.")

        # 6 Aditya Annual 8d (over pro-rated balance) rejected -> REJECTED_PENDING_WITHDRAWAL
        if not already_seeded(db, aditya.employee_id, REASONS["06"]):
            r = reject(submit(aditya, "ANNUAL", "06", REASONS["06"]), vikram, "Insufficient balance for this request.")
            r.withdrawal_window_end = datetime.now(timezone.utc) + timedelta(days=4)
            db.commit()

        # 7 Meera Casual 1d withdrawn -> WITHDRAWN
        if not already_seeded(db, meera.employee_id, REASONS["07"]):
            r = submit(meera, "CASUAL", "07", REASONS["07"])
            cancellation.withdraw(db, r.request_id, meera.employee_id)

        # 8 Kavya Annual (> full balance), rejected, window expired -> LOP_APPLIED
        if not already_seeded(db, kavya.employee_id, REASONS["08"]):
            if not already_seeded(db, kavya.employee_id, REASONS["08A"]):
                approve(submit(kavya, "ANNUAL", "08A", REASONS["08A"]), neha)
            r = reject(
                submit(kavya, "ANNUAL", "08", REASONS["08"]), neha,
                "Cannot accommodate this span; exceeds available balance.",
            )
            r.withdrawal_window_end = datetime.now(timezone.utc) - timedelta(days=1)
            db.commit()
            escalation_service.run_lop_conversion_sweep(db)

        # 9 Priya Annual 2d approved, cancellation requested -> CANCELLATION_REQUESTED
        if not already_seeded(db, priya.employee_id, REASONS["09"]):
            r = approve(submit(priya, "ANNUAL", "09", REASONS["09"]), vikram)
            cancellation.request_cancellation(db, r.request_id, priya.employee_id)

        # 10 Arjun Sick 3d (>3d needs a medical certificate) approved -> APPROVED
        if not already_seeded(db, arjun.employee_id, REASONS["10"]):
            approve(submit(arjun, "SICK", "10", REASONS["10"]), neha)

        # 11 Kavya Casual half day approved -> APPROVED
        if not already_seeded(db, kavya.employee_id, REASONS["11"]):
            s, _ = W["11"]
            r = submission.submit_request(
                db, kavya.employee_id, lt["CASUAL"].leave_type_id, s, s, True, "FIRST", REASONS["11"],
            )
            approve(r, neha)

        # 12 Rohan Casual 1d, SLA breached under Vikram -> escalated to Asha
        if not already_seeded(db, rohan.employee_id, REASONS["12"]):
            r = submit(rohan, "CASUAL", "12", REASONS["12"])
            sla_days = int(config_service.get(db, "approval.sla_working_days"))
            r.sla_started_at = datetime.now(timezone.utc) - timedelta(days=sla_days + 3)
            db.commit()
            escalation_service.escalate_one_level(db, r)

        # 13 Arjun Casual 1d, left pending -> sits in Neha's approval queue
        if not already_seeded(db, arjun.employee_id, REASONS["13"]):
            submit(arjun, "CASUAL", "13", REASONS["13"])

        # 14 Meera Annual 2d, left pending -> sits in Sanjay's approval queue
        if not already_seeded(db, meera.employee_id, REASONS["14"]):
            submit(meera, "ANNUAL", "14", REASONS["14"])

        # ---- Leave around today --------------------------------------------------------------
        # Everything above is at least two weeks out, so the team calendar and the dashboard both
        # open on an empty month. These sit in the current month instead: some already taken,
        # some still to come. Dates are anchored to this month's Mondays, and the backdating
        # window (BR-27, 30 days) is what limits how far back they can start.
        month_start = TODAY.replace(day=1)
        first_monday = month_start + timedelta(days=(7 - month_start.weekday()) % 7)

        def monday(index: int) -> date:
            return first_monday + timedelta(weeks=index)

        # marker, employee, type, start, end, approver (None leaves it pending)
        NEAR_TERM = [
            ("20", priya, "ANNUAL", monday(0), monday(0) + timedelta(days=1), vikram),
            ("21", rohan, "CASUAL", monday(1), monday(1), vikram),
            ("22", kavya, "SICK", monday(1) + timedelta(days=3), monday(1) + timedelta(days=4), neha),
            ("23", arjun, "ANNUAL", monday(2), monday(2) + timedelta(days=2), neha),
            ("24", meera, "CASUAL", monday(3), monday(3), None),
            ("25", priya, "ANNUAL", monday(3) + timedelta(days=2), monday(3) + timedelta(days=3), vikram),
        ]
        backdating_days = int(config_service.get(db, "backdating.window_days"))
        earliest = TODAY - timedelta(days=backdating_days)
        for marker, employee, type_code, start, end, approver in NEAR_TERM:
            if start < earliest or end > year.end_date:
                continue  # the month ran off the end of the window or the leave year
            if already_seeded(db, employee.employee_id, REASONS[marker]):
                continue
            request = submission.submit_request(
                db, employee.employee_id, lt[type_code].leave_type_id, start, end, False, None,
                REASONS[marker],
            )
            if approver is not None:
                approve(request, approver)

        # ---- The managers' own leave, and EMP012's --------------------------------------------
        # A manager's leave routes to their own manager: Vikram and Neha to Asha, Sanjay to
        # Vikram. EMP012 comes from scripts.seed_employees rather than ROSTER above, so its
        # opening balance is posted here (a no-op when it already exists).
        srikaran = employee_dao.find_by_employee_code(db, "EMP012")
        if srikaran is not None:
            accrual_service.post_opening_pro_rata(db, srikaran.employee_id)

        # marker, employee, type, approver (None leaves it pending with that person)
        OTHERS_LEAVE = [
            ("40", vikram, "ANNUAL", asha),
            ("41", vikram, "CASUAL", None),
            ("42", neha, "ANNUAL", asha),
            ("43", neha, "SICK", asha),
            ("44", sanjay, "ANNUAL", vikram),
            ("45", sanjay, "CASUAL", None),
            ("46", srikaran, "ANNUAL", asha),
            ("47", srikaran, "CASUAL", None),
        ]
        for marker, employee, type_code, approver in OTHERS_LEAVE:
            if employee is None or already_seeded(db, employee.employee_id, REASONS[marker]):
                continue
            request = submit(employee, type_code, marker, REASONS[marker])
            if approver is not None:
                approve(request, approver)

        # ---- Asha's own leave ----------------------------------------------------------------
        # Asha is the top of the tree, so she has no manager to route to and submitting would
        # fail with NO_APPROVER. The addendum's controlled self-approval grant is exactly the
        # case this models: a grant applies only where no higher authority exists.
        if self_approval_dao.find_any_active(db, asha.employee_id) is None:
            self_approval_service.grant(
                db, asha.employee_id, granted_by=asha.employee_id, effective_from=year.start_date,
                effective_to=year.end_date, notes="No higher authority on record (HR/Admin at the top of the tree).",
            )
            db.commit()

        # Self-approval routes these straight to APPROVED, so they land in her My Requests.
        ASHA_LEAVE = [
            ("30", "ANNUAL", monday(2), monday(2) + timedelta(days=1)),
            ("31", "CASUAL", monday(4), monday(4)),
        ]
        for marker, type_code, start, end in ASHA_LEAVE:
            if end > year.end_date or already_seeded(db, asha.employee_id, REASONS[marker]):
                continue
            submission.submit_request(
                db, asha.employee_id, lt[type_code].leave_type_id, start, end, False, None,
                REASONS[marker],
            )
        if not already_seeded(db, asha.employee_id, REASONS["32"]):
            drafts.save_draft(
                db, asha.employee_id, lt["ANNUAL"].leave_type_id, monday(5), monday(5) + timedelta(days=2),
                False, None, REASONS["32"],
            )

        # ---- Delegations (far-future windows, as in the Node seed) ---------------------------
        def win(a, b):
            return TODAY + timedelta(weeks=a), TODAY + timedelta(weeks=b)

        def has_delegation(nominator, delegate, set_by):
            return db.execute(select(Delegation).where(
                Delegation.nominator_id == nominator.employee_id, Delegation.delegate_id == delegate.employee_id,
                Delegation.set_by_id == set_by.employee_id,
            )).scalars().first() is not None

        if not has_delegation(vikram, neha, vikram):  # primary path (LMS-041)
            f, t = win(100, 102)
            delegation_service.nominate(db, vikram.employee_id, neha.employee_id, f, t, vikram.employee_id, True)
        if not has_delegation(vikram, neha, asha):  # supervisor-initiated (LMS-042)
            f, t = win(104, 106)
            delegation_service.nominate_on_behalf(db, asha.employee_id, vikram.employee_id, neha.employee_id, f, t, False)
        if not has_delegation(sanjay, vikram, sanjay):  # fallback to supervisor (LMS-041)
            f, t = win(108, 110)
            delegation_service.nominate(db, sanjay.employee_id, vikram.employee_id, f, t, sanjay.employee_id, True)

        # TT Suite: every demo employee's effective LMS role into app.app_access.
        suite_access_service.sync_all(db)
        db.commit()
        print("OK: demo org seeded (10 employees, org data, 14 leave requests, 3 delegations).")
        print("Dev sign-in (POST /api/auth/dev/sign-in {employeeCode}): EMP001 HR/Admin, EMP002/EMP005/EMP008 Managers, rest Employees.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
