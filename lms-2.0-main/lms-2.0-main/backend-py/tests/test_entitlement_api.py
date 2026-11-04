"""The entitlement surfaces through the API: dashboards, restrictions, reports and exports.

§19 G: every screen reads the same calculation, so the dashboard, My Team, the organisation
summary, the entitlement report and its CSV export must agree on the same person's figures.
"""
import uuid
from datetime import date, timedelta

from app.dao import leave_type_dao, leave_year_dao
from app.models.employee import Employee
from app.services import entitlement_service, role_assignment_service
from tests.conftest import sign_in


def _employee(db, *, manager_id=None, role_code="EMPLOYEE"):
    suffix = uuid.uuid4().hex[:8].upper()
    employee = Employee(
        work_email=f"api{suffix.lower()}@example.com", employee_code=f"API{suffix}",
        first_name="Api", last_name=suffix, date_of_joining=date(2024, 1, 1), designation="Engineer",
        reporting_manager_id=manager_id, is_active=True,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    role_assignment_service.assign_role(db, employee.employee_id, role_code, employee.employee_id)
    entitlement_service.grant_all_for_employee(db, employee, leave_year_dao.find_current(db), None)
    db.commit()
    return employee


def test_the_dashboard_the_team_view_and_the_report_agree(db, client, as_hr_admin, hr_admin):
    manager = _employee(db, role_code="MANAGER")
    report = _employee(db, manager_id=manager.employee_id)

    sign_in(client, report)
    own = client.get("/api/employees/dashboard").json()["data"]
    assert own["totals"]["available"] > 0

    sign_in(client, manager)
    team = client.get("/api/employees/my-team").json()["data"]
    row = [r for r in team if r["employee"]["employee_id"] == report.employee_id][0]
    assert row["totals"]["available"] == own["totals"]["available"]

    # The HR client is the same TestClient: signing somebody else in signs HR out, so the
    # actor is set back before each HR call.
    sign_in(as_hr_admin, hr_admin)
    rows = as_hr_admin.get(f"/api/reports/entitlement?employeeId={report.employee_id}").json()["data"]
    assert rows
    assert round(sum(r["available_balance"] for r in rows), 2) == own["totals"]["available"]

    summary = as_hr_admin.get("/api/admin/balances-summary").json()["data"]
    mine = [r for r in summary["employees"] if r["employee_id"] == report.employee_id][0]
    assert mine["available"] == own["totals"]["available"]


def test_a_restriction_shows_on_the_employees_own_dashboard(db, client, as_hr_admin, hr_admin):
    employee = _employee(db)
    annual = leave_type_dao.find_by_code(db, "ANNUAL")

    sign_in(client, employee)
    before = client.get("/api/employees/dashboard").json()["data"]["totals"]["available"]

    sign_in(as_hr_admin, hr_admin)
    res = as_hr_admin.post("/api/admin/restrictions", json={
        "employeeId": employee.employee_id, "leaveTypeId": annual.leave_type_id, "days": 3,
        "startDate": date.today().isoformat(), "endDate": (date.today() + timedelta(days=4)).isoformat(),
        "reason": "Held back while a handover finishes",
    })
    assert res.status_code == 201, res.text

    sign_in(client, employee)
    after = client.get("/api/employees/dashboard").json()["data"]
    assert after["totals"]["available"] == before - 3
    assert after["totals"]["restricted"] == 3
    # It is not leave: usage is unchanged and the employee can see why the days are gone.
    assert after["totals"]["used"] == 0
    assert client.get("/api/my-restrictions").json()["data"][0]["days"] == 3

    sign_in(as_hr_admin, hr_admin)
    cancelled = as_hr_admin.post(
        f"/api/admin/restrictions/{res.json()['data']['restriction_id']}/cancel",
        json={"reason": "No longer needed"},
    )
    assert cancelled.status_code == 200, cancelled.text
    sign_in(client, employee)
    assert client.get("/api/employees/dashboard").json()["data"]["totals"]["available"] == before


def test_an_employee_cannot_create_or_see_other_peoples_restrictions(db, client):
    employee = _employee(db)
    annual = leave_type_dao.find_by_code(db, "ANNUAL")
    sign_in(client, employee)

    res = client.post("/api/admin/restrictions", json={
        "employeeId": employee.employee_id, "leaveTypeId": annual.leave_type_id, "days": 1,
        "startDate": date.today().isoformat(), "endDate": date.today().isoformat(), "reason": "nope",
    })
    assert res.status_code == 403, res.text
    assert client.get("/api/admin/restrictions").status_code == 403


def test_the_reports_export_as_csv_and_excel(as_hr_admin):
    for name in ("entitlement", "restrictions", "adjustments", "carry-forward", "archived-leave-types"):
        for fmt, content_type in (("csv", "text/csv"), ("xlsx", "application/vnd.openxmlformats")):
            res = as_hr_admin.get(f"/api/reports/{name}?export={fmt}")
            assert res.status_code == 200, f"{name}.{fmt}: {res.text}"
            assert res.headers["content-type"].startswith(content_type)


def test_an_opening_balance_runs_as_a_preview_first(db, as_hr_admin):
    employee = _employee(db)
    annual = leave_type_dao.find_by_code(db, "ANNUAL")
    payload = {
        "leaveTypeId": annual.leave_type_id, "openingBalance": 6, "reason": "migration",
        "employeeIds": [employee.employee_id],
    }

    preview = as_hr_admin.post("/api/admin/balances/opening-preview", json=payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["data"]["employees"][0]["proposed_opening_balance"] == 6

    balances = as_hr_admin.get(f"/api/admin/balances/{employee.employee_id}").json()["data"]
    annual_row = [b for b in balances["balances"] if b["target_code"] == "ANNUAL"][0]
    assert annual_row["ledger_balance"] != 6  # the preview wrote nothing

    applied = as_hr_admin.post("/api/admin/balances/opening", json=payload)
    assert applied.status_code == 200, applied.text
    balances = as_hr_admin.get(f"/api/admin/balances/{employee.employee_id}").json()["data"]
    annual_row = [b for b in balances["balances"] if b["target_code"] == "ANNUAL"][0]
    assert annual_row["ledger_balance"] == 6


def test_applying_for_leave_reads_the_restricted_balance(db, client, as_hr_admin, hr_admin):
    """§15: a restriction cannot be stepped around through the Apply screen."""
    employee = _employee(db)
    annual = leave_type_dao.find_by_code(db, "ANNUAL")
    sign_in(client, employee)

    start = date.today() + timedelta(days=30)
    while start.weekday() >= 5:
        start += timedelta(days=1)
    preview_query = (
        f"/api/leave-requests/preview?leave_type_id={annual.leave_type_id}"
        f"&start_date={start.isoformat()}&end_date={start.isoformat()}"
    )
    before = client.get(preview_query).json()["data"]["effectiveBalance"]

    sign_in(as_hr_admin, hr_admin)
    as_hr_admin.post("/api/admin/restrictions", json={
        "employeeId": employee.employee_id, "leaveTypeId": annual.leave_type_id, "days": 2,
        "startDate": date.today().isoformat(), "endDate": (date.today() + timedelta(days=60)).isoformat(),
        "reason": "held back",
    })

    sign_in(client, employee)
    after = client.get(preview_query).json()["data"]["effectiveBalance"]
    assert after == before - 2
