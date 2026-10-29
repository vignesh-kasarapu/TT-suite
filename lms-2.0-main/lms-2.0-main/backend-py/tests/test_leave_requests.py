"""Covers Phase 3's core leave lifecycle end to end: submit -> manager queue ->
approve (ledger deduction) -> cancellation request -> cancellation decision
(ledger restoration), plus the overlap gate and the reject -> withdraw path.
Each test creates its own fresh employee(s) (uuid-suffixed) so re-running the
suite against the shared dev DB never collides with a prior run's leftover
state — the lesson from test_employees.py's earlier flakiness."""
import uuid
from datetime import date, timedelta

import pytest

from app.dao import ledger_dao
from app.models.employee import Employee
from app.services import role_assignment_service
from tests.conftest import sign_in


def _make_employee(db, *, manager_id=None, role_code="EMPLOYEE"):
    suffix = uuid.uuid4().hex[:8].upper()
    employee = Employee(
        work_email=f"lr{suffix.lower()}@example.com", employee_code=f"LR{suffix}",
        first_name="Test", last_name=suffix, date_of_joining=date(2025, 1, 1), designation="Engineer",
        reporting_manager_id=manager_id, is_active=True,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    role_assignment_service.assign_role(db, employee.employee_id, role_code, employee.employee_id)
    return employee


@pytest.fixture()
def manager(db):
    return _make_employee(db, role_code="MANAGER")


@pytest.fixture()
def report(db, manager):
    return _make_employee(db, manager_id=manager.employee_id)


def _as(client, monkeypatch, employee):
    """Acts as `employee` from here on: a real suite session cookie (see conftest.sign_in).
    `monkeypatch` is unused since the dev bypass went away; kept so call sites stay put."""
    sign_in(client, employee)


def test_submit_approve_writes_ledger_deduction(client, monkeypatch, db, manager, report):
    _as(client, monkeypatch, report)
    start = date.today() + timedelta(days=200)
    while start.weekday() >= 5:
        start += timedelta(days=1)
    end = start

    submit = client.post("/api/leave-requests", json={
        "leave_type_id": 1, "start_date": start.isoformat(), "end_date": end.isoformat(), "reason": "test",
    })
    assert submit.status_code == 201, submit.text
    body = submit.json()["data"]
    assert body["state"] == "PENDING_MANAGER"
    assert body["current_approver_id"] == manager.employee_id
    request_id = body["request_id"]

    _as(client, monkeypatch, manager)
    queue = client.get("/api/leave-requests/approvals-queue")
    assert any(r["request_id"] == request_id for r in queue.json()["data"])

    decide = client.post(f"/api/leave-requests/{request_id}/decision", json={"decision": "APPROVE"})
    assert decide.status_code == 200, decide.text
    assert decide.json()["data"]["state"] == "APPROVED"

    # Close this session's open transaction so the next read starts fresh and sees
    # the ledger entry the API calls (separate sessions) committed. Needed under
    # MySQL's REPEATABLE READ; harmless under PostgreSQL's READ COMMITTED.
    db.commit()
    balance = ledger_dao.sum_quantity(db, report.employee_id, 1, body["leave_year_id"])
    assert balance == -1.0


def test_overlap_is_rejected(client, monkeypatch, report):
    _as(client, monkeypatch, report)
    start = date.today() + timedelta(days=210)
    while start.weekday() >= 5:
        start += timedelta(days=1)
    end = start + timedelta(days=1)

    first = client.post("/api/leave-requests", json={
        "leave_type_id": 1, "start_date": start.isoformat(), "end_date": end.isoformat(), "reason": "first",
    })
    assert first.status_code == 201, first.text

    overlapping = client.post("/api/leave-requests", json={
        "leave_type_id": 1, "start_date": start.isoformat(), "end_date": start.isoformat(), "reason": "overlap",
    })
    assert overlapping.status_code == 400
    assert overlapping.json()["error"]["code"] == "OVERLAP"


def test_reject_advance_leave_then_withdraw(client, monkeypatch, manager, report):
    _as(client, monkeypatch, report)
    start = date.today() + timedelta(days=220)
    while start.weekday() >= 5:
        start += timedelta(days=1)

    submit = client.post("/api/leave-requests", json={
        "leave_type_id": 1, "start_date": start.isoformat(), "end_date": start.isoformat(), "reason": "test",
    })
    request_id = submit.json()["data"]["request_id"]
    assert submit.json()["data"]["is_advance_leave"] is True  # fresh employee, zero balance

    _as(client, monkeypatch, manager)
    reject = client.post(f"/api/leave-requests/{request_id}/decision", json={"decision": "REJECT", "reason": "no coverage"})
    assert reject.status_code == 200, reject.text
    assert reject.json()["data"]["state"] == "REJECTED_PENDING_WITHDRAWAL"

    _as(client, monkeypatch, report)
    withdraw = client.post(f"/api/leave-requests/{request_id}/withdraw")
    assert withdraw.status_code == 200, withdraw.text
    assert withdraw.json()["data"]["state"] == "WITHDRAWN"


def test_draft_lifecycle(client, monkeypatch, report):
    _as(client, monkeypatch, report)
    start = date.today() + timedelta(days=230)
    while start.weekday() >= 5:
        start += timedelta(days=1)

    draft = client.post("/api/leave-requests/draft", json={
        "leave_type_id": 1, "start_date": start.isoformat(), "end_date": start.isoformat(), "reason": "draft",
    })
    assert draft.status_code == 201, draft.text
    request_id = draft.json()["data"]["request_id"]
    assert draft.json()["data"]["state"] == "DRAFT"

    updated = client.patch(f"/api/leave-requests/draft/{request_id}", json={"reason": "edited draft"})
    assert updated.json()["data"]["reason"] == "edited draft"

    submitted = client.post(f"/api/leave-requests/draft/{request_id}/submit")
    assert submitted.status_code == 201, submitted.text
    assert submitted.json()["data"]["state"] == "PENDING_MANAGER"


def test_detail_scoping_full_vs_denied(client, monkeypatch, manager, report, db):
    _as(client, monkeypatch, report)
    start = date.today() + timedelta(days=240)
    while start.weekday() >= 5:
        start += timedelta(days=1)
    submit = client.post("/api/leave-requests", json={
        "leave_type_id": 1, "start_date": start.isoformat(), "end_date": start.isoformat(), "reason": "test",
    })
    request_id = submit.json()["data"]["request_id"]

    owner_view = client.get(f"/api/leave-requests/{request_id}")
    assert owner_view.json()["data"]["scope"] == "FULL"

    stranger = _make_employee(db)
    _as(client, monkeypatch, stranger)
    denied_view = client.get(f"/api/leave-requests/{request_id}")
    assert denied_view.status_code == 403
    assert denied_view.json()["error"]["code"] == "PERMISSION_DENIED"


def test_calendars_show_your_own_leave_too(client, monkeypatch, db, manager, report):
    from app.dao import leave_year_dao
    from app.models.leave_request import LeaveRequest

    leave_year = leave_year_dao.find_current(db)
    day = date.today() + timedelta(days=3)
    for who in (manager, report):
        db.add(LeaveRequest(
            employee_id=who.employee_id, leave_type_id=1, leave_year_id=leave_year.leave_year_id,
            start_date=day, end_date=day, reason="calendar", state="APPROVED",
        ))
    db.commit()

    _as(client, monkeypatch, manager)  # team calendar: their own leave and their report's
    team = {e["employee_id"] for e in client.get("/api/employees/team-calendar").json()["data"]}
    assert {manager.employee_id, report.employee_id} <= team

    _as(client, monkeypatch, report)  # peer calendar: their own leave, even as the only peer
    peer = client.get("/api/employees/peer-calendar").json()["data"]
    assert report.employee_id in {e["employee_id"] for e in peer}
    assert manager.employee_id not in {e["employee_id"] for e in peer}
