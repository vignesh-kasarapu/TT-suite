"""The employee dashboard (LMS-036).

One card per **target**: a leave type, or the pool several types share. Sick and Casual
sharing nine days is one card showing nine, not two cards showing nine each — and the card
names both types so nobody has to guess what it covers.

Every number comes from `entitlement_service`, the same calculation Apply, the approval
screens and the reports use.
"""
from datetime import date

from sqlalchemy.orm import Session

from app.dao import employee_dao, leave_request_query_dao, leave_type_dao, leave_year_dao
from app.schemas.leave_type import LeaveTypeOut
from app.services import balance_service, entitlement_service, restriction_service
from app.services.leave_request import validation


def visible_leave_types(db: Session, employee) -> list:
    """Types this person may see: selectable, not archived, not excluded for them."""
    excluded = leave_type_dao.excluded_type_ids(db, employee.employee_id)
    return [lt for lt in leave_type_dao.list_selectable(db) if lt.leave_type_id not in excluded]


def balance_cards(db: Session, employee, leave_year, as_of: date | None = None) -> list[dict]:
    """One card per target, in leave-type name order, with its types nested."""
    cards: dict[str, dict] = {}
    for leave_type in sorted(visible_leave_types(db, employee), key=lambda t: t.type_name):
        target = entitlement_service.target_for_leave_type(db, leave_type)
        type_out = {
            **LeaveTypeOut.model_validate(leave_type).model_dump(),
            # Lets the Apply picker grey out a restricted type up front rather than failing
            # the submission, and says why. Both profile rules are applied: gender and
            # marital status.
            "is_eligible": validation.is_eligible(leave_type, employee),
            "ineligibility_reason": validation.ineligibility_reason(leave_type, employee),
        }
        if target.key in cards:
            cards[target.key]["leave_types"].append(type_out)
            cards[target.key]["days_taken_by_type"][leave_type.type_code] = balance_service.get_days_taken(
                db, employee.employee_id, leave_type, leave_year.leave_year_id
            )
            continue

        summary = entitlement_service.summary(db, employee.employee_id, target, leave_year, as_of)
        cards[target.key] = {
            **summary,
            # A card with no entitlement to speak of (Loss of Pay, Compensatory Off) leads
            # with what was used instead of what is left. The rule lives here, not in the
            # page, so no screen has to recognise a leave-type code.
            "shows_usage": not leave_type.is_balance_affecting
            or leave_type.type_code.upper() in entitlement_service.NEVER_GRANTED_CODES,
            # The first (or only) type, kept flat so every existing screen keeps working.
            "leave_type": type_out,
            "leave_types": [type_out],
            # Per type, never per pool: a shared card still reports Sick and Casual apart.
            "days_taken_by_type": {
                leave_type.type_code: balance_service.get_days_taken(
                    db, employee.employee_id, leave_type, leave_year.leave_year_id
                )
            },
            "days_taken": balance_service.get_days_taken(
                db, employee.employee_id, leave_type, leave_year.leave_year_id
            ),
            "effective_balance": summary["available"],
            "restrictions": [
                {
                    "restriction_id": r.restriction_id, "days": float(r.days),
                    "start_date": r.start_date, "end_date": r.end_date, "reason": r.reason,
                }
                for r in entitlement_service.active_restrictions(db, employee.employee_id, target, leave_year, as_of)
            ],
        }

    rows = list(cards.values())
    for row in rows:
        # The card's headline usage is everything its types were used for.
        row["days_taken"] = round(sum(row["days_taken_by_type"].values()), 2)
    return rows


def get_dashboard(db: Session, employee_id: int) -> dict:
    leave_year = leave_year_dao.find_current(db)
    employee = employee_dao.find_by_id(db, employee_id)

    balances = balance_cards(db, employee, leave_year)
    # Totals cover the types that hold a balance; Comp-Off and Loss of Pay are reported on
    # their own because neither has an entitlement to total.
    # The same cards the page shows: a type this person cannot apply for is not part of
    # their total, or the tiles would never add up to it.
    counted = [
        b for b in balances
        if b["leave_type"]["is_balance_affecting"]
        and b["configured_entitlement"]
        and any(t.get("is_eligible") is not False for t in b["leave_types"])
    ]

    return {
        "balances": balances,
        # Flat list for the Apply picker and any other type-level screen.
        "leave_types": [t for b in balances for t in b["leave_types"]],
        "totals": entitlement_service.totals(counted),
        "restrictions": restriction_service.list_for_employee(db, employee_id, leave_year.leave_year_id),
        "pending": leave_request_query_dao.list_pending_for_employee(db, employee_id),
        "upcoming": leave_request_query_dao.list_upcoming_approved(db, employee_id, date.today(), 5),
        "withdrawal_window": leave_request_query_dao.list_withdrawal_window(db, employee_id),
        # Approved advance leave: LOP days awaiting a decision (accept / withdraw within 24 h) or confirmed.
        "loss_of_pay": leave_request_query_dao.list_own_advance_lop(db, employee_id, leave_year.leave_year_id),
        "leave_year": leave_year,
    }
