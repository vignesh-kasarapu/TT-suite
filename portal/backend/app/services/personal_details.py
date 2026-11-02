"""The person's own details — validated in one place, whoever is editing.

A person edits them on their Profile; a global admin edits the same set for someone else in
Users & access. Both go through `personal_detail_changes`, so the two surfaces can never
disagree about what is allowed. The suite stores them (0004, 0008) and every app copies what
it keeps on the person's next request.
"""
import re
from datetime import date
from typing import Any

from app.core.errors import AppError

PHONE = re.compile(r"\+?[0-9 ()\-]{5,30}")
EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

# Free text in the database, a fixed list here. LMS matches gender against a leave type's
# gender_eligibility ('ALL' | 'FEMALE' | 'MALE'), so an unexpected spelling would quietly
# stop restricting anything — Maternity would appear for everyone.
GENDERS = ("", "MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY")
MARITAL_STATUSES = ("", "SINGLE", "MARRIED", "DIVORCED", "WIDOWED")

#: Trimmed free text. None means "leave this one alone"; "" clears it.
TEXT_FIELDS = ("job_title", "phone", "location", "personal_email",
               "emergency_contact_name", "emergency_contact_phone")
PHONE_FIELDS = (("phone", "phone number"), ("emergency_contact_phone", "emergency contact number"))
CODED_FIELDS = (("gender", GENDERS, "gender"), ("marital_status", MARITAL_STATUSES, "marital status"))


def personal_detail_changes(details: dict[str, Any]) -> dict[str, Any]:
    """The columns to write for the details supplied, validated. Raises on a bad value."""
    changes: dict[str, Any] = {}

    for field in TEXT_FIELDS:
        value = details.get(field)
        if value is not None:
            changes[field] = " ".join(str(value).split())

    for field, label in PHONE_FIELDS:
        if changes.get(field) and not PHONE.fullmatch(changes[field]):
            raise AppError(422, "VALIDATION", f"Enter a {label} with digits, spaces, +, - or brackets.")
    if changes.get("personal_email") and not EMAIL.fullmatch(changes["personal_email"]):
        raise AppError(422, "VALIDATION", "Enter a valid personal email address.")

    if details.get("date_of_birth") is not None:
        changes["date_of_birth"] = birth_date(details["date_of_birth"])

    for field, allowed, label in CODED_FIELDS:
        value = details.get(field)
        if value is not None:
            code = str(value).strip().upper().replace(" ", "_")
            if code not in allowed:
                raise AppError(422, "VALIDATION", f"Choose a {label} from the list.")
            changes[field] = code

    return changes


def birth_date(value: Any) -> date | None:
    """"" clears it. A date in the future is a typo, not a birthday."""
    if value in ("", None):
        return None
    if isinstance(value, date):
        parsed = value
    else:
        try:
            parsed = date.fromisoformat(str(value))
        except ValueError as err:
            raise AppError(422, "VALIDATION", "Enter the date of birth as YYYY-MM-DD.") from err
    if parsed > date.today():
        raise AppError(422, "VALIDATION", "A date of birth cannot be in the future.")
    return parsed
