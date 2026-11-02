"""The suite owns a person's own details; LMS keeps a copy and refreshes it.

A person edits phone, personal email, date of birth, emergency contacts, gender and marital
status once in their TT Suite profile. LMS copies them when the person is provisioned and
again on every request, so the two can never drift apart — and LMS refuses to edit them
itself (tests/test_employees.py).
"""
import uuid
from datetime import date
from types import SimpleNamespace

from app.dao import employee_dao
from app.models.employee import Employee
from app.services import suite_provision_service
from tests.conftest import INTERNAL_TOKEN


def _suite_details(**overrides):
    """Anything carrying the attributes the sync reads: a SuiteIdentity on a request, a
    ProvisionRequest on provisioning."""
    return SimpleNamespace(**{
        "job_title": "Staff Engineer",
        "phone": "+91 90000 11111",
        "personal_email": "person@example.com",
        "date_of_birth": date(1990, 5, 17),
        "emergency_contact_name": "Next Of Kin",
        "emergency_contact_phone": "+91 90000 22222",
        "gender": "FEMALE",
        "marital_status": "MARRIED",
        **overrides,
    })


def _employee(db) -> Employee:
    suffix = uuid.uuid4().hex[:8].upper()
    employee = Employee(
        work_email=f"sp{suffix.lower()}@example.com", employee_code=f"SP{suffix}",
        first_name="Suite", last_name=suffix, date_of_joining=date(2024, 1, 1), is_active=True,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee


def test_personal_details_are_copied_from_the_suite(db):
    employee = _employee(db)
    assert suite_provision_service.sync_personal_details(employee, _suite_details()) is True
    db.commit()
    db.refresh(employee)

    assert employee.designation == "Staff Engineer"   # the suite calls it job title
    assert employee.phone == "+91 90000 11111"
    assert employee.personal_email == "person@example.com"
    assert employee.date_of_birth == date(1990, 5, 17)
    assert employee.emergency_contact_name == "Next Of Kin"
    assert employee.emergency_contact_phone == "+91 90000 22222"
    assert employee.gender == "FEMALE"
    assert employee.marital_status == "MARRIED"


def test_copying_the_same_details_twice_changes_nothing(db):
    employee = _employee(db)
    details = _suite_details()
    assert suite_provision_service.sync_personal_details(employee, details) is True
    assert suite_provision_service.sync_personal_details(employee, details) is False


def test_an_empty_suite_value_never_wipes_what_lms_holds(db):
    """A person who has not filled a field in must not lose the value LMS already had."""
    employee = _employee(db)
    suite_provision_service.sync_personal_details(employee, _suite_details())
    db.commit()

    blank = _suite_details(phone="", personal_email="", date_of_birth=None, gender="")
    suite_provision_service.sync_personal_details(employee, blank)
    db.commit()
    db.refresh(employee)

    assert employee.phone == "+91 90000 11111"
    assert employee.personal_email == "person@example.com"
    assert employee.date_of_birth == date(1990, 5, 17)
    assert employee.gender == "FEMALE"


def test_employment_data_is_not_touched_by_the_suite(db):
    """Department, grade, manager and region are LMS's own: HR edits them here."""
    employee = _employee(db)
    employee.department_id = None
    before = (employee.department_id, employee.grade_id, employee.reporting_manager_id, employee.region_id)
    suite_provision_service.sync_personal_details(employee, _suite_details())
    assert (employee.department_id, employee.grade_id, employee.reporting_manager_id, employee.region_id) == before


def test_provisioning_brings_the_details_with_it(client, db):
    """A person provisioned from the portal arrives complete, rather than waiting for their
    first request to fill the details in."""
    email = f"prov.{uuid.uuid4().hex[:10]}@example.com"
    res = client.post(
        "/internal/provision", headers={"x-internal-token": INTERNAL_TOKEN},
        json={
            "email": email, "name": "Provisioned Person", "role": "employee", "source": "global",
            "employee_code": "P" + uuid.uuid4().hex[:9].upper(),
            "job_title": "Designer", "phone": "+91 91111 00000", "personal_email": "p@example.com",
            "date_of_birth": "1992-03-04", "emergency_contact_name": "Kin",
            "emergency_contact_phone": "+91 91111 22222", "gender": "MALE", "marital_status": "SINGLE",
        },
    )
    assert res.status_code == 200, res.text

    employee = employee_dao.find_by_id(db, int(res.json()["local_user_id"]))
    assert employee.designation == "Designer"
    assert employee.phone == "+91 91111 00000"
    assert employee.date_of_birth == date(1992, 3, 4)
    assert employee.gender == "MALE"


# --- what the gender is actually for -------------------------------------------------------


def _maternity_eligible(db, employee) -> bool:
    """What the dashboard computes per leave type (services/employee/dashboard.py)."""
    from app.dao import leave_type_dao
    from app.services.leave_request import validation

    maternity = leave_type_dao.find_by_code(db, "MATERNITY")
    assert (maternity.gender_eligibility, maternity.marital_eligibility) == ("FEMALE", "MARRIED"),         "Maternity is the restricted type these tests are about"
    return validation.is_eligible(maternity, employee)


def test_changing_the_suite_gender_decides_who_sees_maternity_leave(db):
    """Male -> Maternity is not offered. Female -> it is. The change is made once in the
    suite profile (by the person or a global admin) and LMS picks it up on the next request."""
    employee = _employee(db)

    suite_provision_service.sync_personal_details(employee, _suite_details(gender="MALE"))
    db.commit()
    assert employee.gender == "MALE"
    assert _maternity_eligible(db, employee) is False

    suite_provision_service.sync_personal_details(employee, _suite_details(gender="FEMALE"))
    db.commit()
    assert employee.gender == "FEMALE"
    assert _maternity_eligible(db, employee) is True


def test_maternity_needs_female_and_married(db):
    """Both profile rules, as HR configured them: gender FEMALE and marital status MARRIED.
    Either one alone is not enough."""
    employee = _employee(db)
    cases = {
        ("FEMALE", "MARRIED"): True,
        ("FEMALE", "SINGLE"): False,
        ("MALE", "MARRIED"): False,
        ("MALE", "SINGLE"): False,
    }
    for (gender, marital), expected in cases.items():
        suite_provision_service.sync_personal_details(employee, _suite_details(gender=gender, marital_status=marital))
        db.commit()
        assert (employee.gender, employee.marital_status) == (gender, marital)
        assert _maternity_eligible(db, employee) is expected, f"{gender} + {marital}"


def test_marrying_makes_maternity_available(db):
    """The change the employee makes in their own suite profile: single -> married."""
    employee = _employee(db)
    suite_provision_service.sync_personal_details(employee, _suite_details(gender="FEMALE", marital_status="SINGLE"))
    db.commit()
    assert _maternity_eligible(db, employee) is False

    suite_provision_service.sync_personal_details(employee, _suite_details(gender="FEMALE", marital_status="MARRIED"))
    db.commit()
    assert _maternity_eligible(db, employee) is True


def test_other_leave_types_ignore_both_rules(db):
    """Only Maternity is restricted; Annual and Sick stay open to everyone."""
    from app.dao import leave_type_dao
    from app.services.leave_request import validation

    employee = _employee(db)
    suite_provision_service.sync_personal_details(employee, _suite_details(gender="MALE", marital_status="SINGLE"))
    db.commit()
    for code in ("ANNUAL", "SICK", "CASUAL", "BEREAVEMENT"):
        leave_type = leave_type_dao.find_by_code(db, code)
        assert validation.is_eligible(leave_type, employee) is True, code


def test_an_unset_profile_restricts_nothing(db):
    """Nobody is refused leave over a field nobody filled in — the same forgiveness the
    gender rule has always had, now applied to marital status too."""
    employee = _employee(db)
    assert (employee.gender, employee.marital_status) == (None, None)
    assert _maternity_eligible(db, employee) is True


def test_the_dashboard_reports_the_same_eligibility_and_says_why(as_hr_admin, db, hr_admin):
    """End to end through the API the Apply screen actually calls — including the reason it
    shows under a greyed-out type."""
    def maternity_row():
        balances = as_hr_admin.get("/api/employees/dashboard").json()["data"]["balances"]
        return next(b["leaveType"] for b in balances if b["leaveType"]["type_code"] == "MATERNITY")

    suite_provision_service.sync_personal_details(hr_admin, _suite_details(gender="MALE", marital_status="MARRIED"))
    db.commit()
    row = maternity_row()
    assert row["is_eligible"] is False
    assert "female" in row["ineligibility_reason"].lower()

    suite_provision_service.sync_personal_details(hr_admin, _suite_details(gender="FEMALE", marital_status="SINGLE"))
    db.commit()
    row = maternity_row()
    assert row["is_eligible"] is False
    assert "married" in row["ineligibility_reason"].lower()

    suite_provision_service.sync_personal_details(hr_admin, _suite_details(gender="FEMALE", marital_status="MARRIED"))
    db.commit()
    row = maternity_row()
    assert row["is_eligible"] is True
    assert row["ineligibility_reason"] is None
