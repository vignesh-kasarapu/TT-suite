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
from tests.conftest import annual_type_id, sign_in


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
    # Within the balance (2 days credited): approval debits the day. Beyond the balance the extra
    # days are loss of pay instead (test_approved_advance_leave_*).
    from app.dao import leave_year_dao
    from app.services import balance_service

    year = leave_year_dao.find_current(db)
    balance_service.write_manual_adjustment(db, report.employee_id, annual_type_id(), year.leave_year_id, 2, "test credit", manager.employee_id)
    db.commit()
    _as(client, monkeypatch, report)
    start = date.today() + timedelta(days=200)
    while start.weekday() >= 5:
        start += timedelta(days=1)
    end = start

    submit = client.post("/api/leave-requests", json={
        "leave_type_id": annual_type_id(), "start_date": start.isoformat(), "end_date": end.isoformat(), "reason": "test",
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
    balance = ledger_dao.sum_quantity(db, report.employee_id, annual_type_id(), body["leave_year_id"])
    assert balance == 1.0  # 2 credited - 1 deducted


def test_overlap_is_rejected(client, monkeypatch, report):
    _as(client, monkeypatch, report)
    start = date.today() + timedelta(days=210)
    while start.weekday() >= 5:
        start += timedelta(days=1)
    end = start + timedelta(days=1)

    first = client.post("/api/leave-requests", json={
        "leave_type_id": annual_type_id(), "start_date": start.isoformat(), "end_date": end.isoformat(), "reason": "first",
    })
    assert first.status_code == 201, first.text

    overlapping = client.post("/api/leave-requests", json={
        "leave_type_id": annual_type_id(), "start_date": start.isoformat(), "end_date": start.isoformat(), "reason": "overlap",
    })
    assert overlapping.status_code == 400
    assert overlapping.json()["error"]["code"] == "OVERLAP"


def test_reject_advance_leave_then_withdraw(client, monkeypatch, manager, report):
    _as(client, monkeypatch, report)
    start = date.today() + timedelta(days=220)
    while start.weekday() >= 5:
        start += timedelta(days=1)

    submit = client.post("/api/leave-requests", json={
        "leave_type_id": annual_type_id(), "start_date": start.isoformat(), "end_date": start.isoformat(), "reason": "test",
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
        "leave_type_id": annual_type_id(), "start_date": start.isoformat(), "end_date": start.isoformat(), "reason": "draft",
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
        "leave_type_id": annual_type_id(), "start_date": start.isoformat(), "end_date": start.isoformat(), "reason": "test",
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
            employee_id=who.employee_id, leave_type_id=annual_type_id(), leave_year_id=leave_year.leave_year_id,
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


def test_sick_leave_needs_proof_only_for_more_than_3_days(client, monkeypatch, db, report):
    from app.dao import leave_type_dao

    sick = leave_type_dao.find_by_code(db, "SICK")
    _as(client, monkeypatch, report)
    monday = date.today() + timedelta(days=240)
    while monday.weekday() != 0:
        monday += timedelta(days=1)

    def preview(days):
        end = monday + timedelta(days=days - 1)  # Mon.. (no weekend inside 4 days)
        res = client.get("/api/leave-requests/preview", params={
            "leave_type_id": sick.leave_type_id, "start_date": monday.isoformat(), "end_date": end.isoformat()})
        assert res.status_code == 200, res.text
        return res.json()["data"]

    short = preview(2)
    assert short["medicalCertificateRequired"] is False
    long = preview(4)
    assert long["deductedWorkingDays"] == 4 and long["medicalCertificateRequired"] is True
    assert long["medicalCertificateAfterDays"] == 3

    # Without a certificate the 4-day request is refused; the 2-day one goes through.
    refused = client.post("/api/leave-requests", json={
        "leave_type_id": sick.leave_type_id, "start_date": monday.isoformat(),
        "end_date": (monday + timedelta(days=3)).isoformat(), "reason": "flu"})
    assert refused.status_code == 400 and refused.json()["error"]["code"] == "MEDICAL_CERT_REQUIRED"


def test_advance_leave_rejected_then_withdrawn_or_converted_to_lop(client, monkeypatch, db, manager, report, hr_admin):
    """More days than the balance -> the manager decides -> a rejection opens the withdrawal window
    (7 days) -> withdrawn: nothing happens; not withdrawn: the nightly sweep makes it loss of pay."""
    from datetime import datetime, timezone

    from app.dao import leave_request_dao, lop_record_dao
    from app.models.notification_audit import Notification
    from app.services import balance_service, escalation_service

    year = __import__("app.dao.leave_year_dao", fromlist=["x"]).find_current(db)
    balance = balance_service.get_effective_balance(db, report.employee_id, annual_type_id(), year.leave_year_id)["effective_balance"]
    days = int(balance) + 3  # more than the balance

    def apply(offset):
        start = date.today() + timedelta(days=offset)
        while start.weekday() != 0:
            start += timedelta(days=1)
        end, n = start, 1
        while n < days:
            end += timedelta(days=1)
            if end.weekday() < 5:
                n += 1
        _as(client, monkeypatch, report)
        res = client.post("/api/leave-requests", json={
            "leave_type_id": annual_type_id(), "start_date": start.isoformat(), "end_date": end.isoformat(), "reason": "advance"})
        assert res.status_code == 201, res.text
        body = res.json()["data"]
        assert body["is_advance_leave"] is True and body["state"] == "PENDING_MANAGER"
        assert body["current_approver_id"] == manager.employee_id  # goes to their manager
        return body["request_id"]

    withdrawn_id, expired_id = apply(300), apply(340)

    _as(client, monkeypatch, manager)
    for rid in (withdrawn_id, expired_id):
        res = client.post(f"/api/leave-requests/{rid}/decision", json={"decision": "REJECT", "reason": "busy"})
        assert res.status_code == 200, res.text
        assert res.json()["data"]["state"] == "REJECTED_PENDING_WITHDRAWAL"

    db.commit()
    rejected = leave_request_dao.find_by_id(db, withdrawn_id)
    window_end = rejected.withdrawal_window_end.replace(tzinfo=timezone.utc)
    assert 6.9 < (window_end - datetime.now(timezone.utc)).total_seconds() / 86400 <= 7.0
    told = db.query(Notification).filter(Notification.recipient_id == report.employee_id,
                                         Notification.template_key == "ADVANCE_LEAVE_WITHDRAW_WINDOW").all()
    assert len(told) == 2 and "loss of pay" in told[0].body

    # The employee sees how long they have, and HR sees it in the LOP report.
    _as(client, monkeypatch, report)
    dash = client.get("/api/employees/dashboard").json()["data"]
    assert {r["request_id"] for r in dash["withdrawalWindow"]} >= {withdrawn_id, expired_id}
    assert all(r["withdrawal_window_end"] for r in dash["withdrawalWindow"])
    sign_in(client, hr_admin)
    pending = {r["request_id"]: r for r in client.get("/api/reports/lop-pending").json()["data"]}
    assert pending[withdrawn_id]["days_left_to_withdraw"] == 7

    # Withdrawn in time: never loss of pay.
    _as(client, monkeypatch, report)
    assert client.post(f"/api/leave-requests/{withdrawn_id}/withdraw").status_code == 200

    # Not withdrawn: once the window has passed, the nightly sweep converts it.
    expired = leave_request_dao.find_by_id(db, expired_id)
    expired.withdrawal_window_end = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    escalation_service.run_lop_conversion_sweep(db)
    db.commit()
    db.expire_all()
    assert leave_request_dao.find_by_id(db, withdrawn_id).state == "WITHDRAWN"
    assert lop_record_dao.find_by_request_id(db, withdrawn_id) is None
    assert leave_request_dao.find_by_id(db, expired_id).state == "LOP_APPLIED"
    sign_in(client, hr_admin)
    lop = client.get("/api/reports/lop", params={"employee_id": report.employee_id}).json()["data"]
    assert [r["request_id"] for r in lop if r["source"] == "CONVERTED"] == [expired_id]


# ---- Approved advance leave: the days beyond the balance are loss of pay, the employee decides ----
def _advance_setup(client, monkeypatch, db, manager, report, offset, balance=3, days=5):
    """`report` has `balance` days, applies for `days` working days, `manager` approves."""
    from app.dao import leave_year_dao
    from app.services import balance_service

    year = leave_year_dao.find_current(db)
    current = balance_service.get_effective_balance(db, report.employee_id, annual_type_id(), year.leave_year_id)["effective_balance"]
    if balance - current:
        balance_service.write_manual_adjustment(db, report.employee_id, annual_type_id(), year.leave_year_id, balance - current, "test", manager.employee_id)
        db.commit()
    start = date.today() + timedelta(days=offset)
    while start.weekday() != 0:
        start += timedelta(days=1)
    end = start + timedelta(days=days - 1)  # Mon..Fri
    _as(client, monkeypatch, report)
    res = client.post("/api/leave-requests", json={
        "leave_type_id": annual_type_id(), "start_date": start.isoformat(), "end_date": end.isoformat(), "reason": "trip"})
    assert res.status_code == 201, res.text
    rid = res.json()["data"]["request_id"]
    _as(client, monkeypatch, manager)
    approved = client.post(f"/api/leave-requests/{rid}/decision", json={"decision": "APPROVE"})
    assert approved.status_code == 200, approved.text
    body = approved.json()["data"]
    assert body["state"] == "APPROVED" and body["lop_days"] == days - balance and body["lop_status"] == "PENDING"
    return rid, start, year


def _notes(db, who, key):
    from app.models.notification_audit import Notification

    db.expire_all()
    return db.query(Notification).filter(Notification.recipient_id == who, Notification.template_key == key).all()


def test_approved_advance_leave_lop_accepted(client, monkeypatch, db, manager, report, hr_admin):
    from app.dao import ledger_dao

    rid, _start, year = _advance_setup(client, monkeypatch, db, manager, report, 400)
    # Balance 3 -> 0 (never negative); the employee is warned about the 2 LOP days.
    assert ledger_dao.sum_quantity(db, report.employee_id, annual_type_id(), year.leave_year_id) == 0.0
    warning = _notes(db, report.employee_id, "ADVANCE_LOP_WARNING")
    assert warning and "2 day(s) are beyond it" in warning[-1].body

    _as(client, monkeypatch, report)
    mine = client.get("/api/employees/dashboard").json()["data"]["lossOfPay"]
    assert [(r["request_id"], r["lop_status"], r["lop_days"]) for r in mine] == [(rid, "PENDING", 2.0)]
    sign_in(client, hr_admin)
    row = next(r for r in client.get("/api/reports/lop").json()["data"] if r["source"] == "ADVANCE" and r["request_id"] == rid)
    assert (row["total_days"], row["balance_days"], row["deducted_days"], row["lop_status"]) == (5, 3, 2, "PENDING")

    _as(client, monkeypatch, report)
    accepted = client.post(f"/api/leave-requests/{rid}/lop/accept")
    assert accepted.status_code == 200 and accepted.json()["data"]["lop_status"] == "CONFIRMED"
    assert _notes(db, report.employee_id, "ADVANCE_LOP_ACCEPTED") and _notes(db, manager.employee_id, "ADVANCE_LOP_ACCEPTED")
    assert client.post(f"/api/leave-requests/{rid}/lop/withdraw").status_code == 400  # decided


def test_approved_advance_leave_lop_withdrawn_keeps_the_covered_days(client, monkeypatch, db, manager, report):
    from app.dao import leave_request_dao, ledger_dao

    rid, start, year = _advance_setup(client, monkeypatch, db, manager, report, 430)
    _as(client, monkeypatch, report)
    res = client.post(f"/api/leave-requests/{rid}/lop/withdraw")
    assert res.status_code == 200, res.text
    body = res.json()["data"]
    # Only the 2 LOP days are dropped: Mon-Fri becomes Mon-Wed, the 3 balance days stay.
    assert body["state"] == "APPROVED" and body["deducted_days"] == 3 and body["lop_days"] == 0
    assert body["lop_status"] == "WITHDRAWN" and body["end_date"] == (start + timedelta(days=2)).isoformat()
    assert ledger_dao.sum_quantity(db, report.employee_id, annual_type_id(), year.leave_year_id) == 0.0
    assert _notes(db, report.employee_id, "ADVANCE_LOP_WITHDRAWN") and _notes(db, manager.employee_id, "ADVANCE_LOP_WITHDRAWN")
    assert leave_request_dao.find_by_id(db, rid).end_date == start + timedelta(days=2)


def test_advance_lop_window_closes_after_24_hours(client, monkeypatch, db, manager, report):
    from datetime import datetime, timezone

    from app.dao import leave_request_dao
    from app.services.leave_request import advance_lop

    late, _s, _y = _advance_setup(client, monkeypatch, db, manager, report, 460)
    silent, _s, _y = _advance_setup(client, monkeypatch, db, manager, report, 490)
    for rid in (late, silent):
        leave_request_dao.find_by_id(db, rid).lop_decision_deadline = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    _as(client, monkeypatch, report)
    refused = client.post(f"/api/leave-requests/{late}/lop/withdraw")
    assert refused.status_code == 400 and refused.json()["error"]["code"] == "LOP_WINDOW_CLOSED"

    assert advance_lop.run_confirmation_sweep(db) >= 2  # no answer in 24 h: confirmed
    db.expire_all()
    assert leave_request_dao.find_by_id(db, silent).lop_status == "CONFIRMED"
    assert _notes(db, manager.employee_id, "ADVANCE_LOP_ACCEPTED")


def test_cancelling_leave_with_lop_gives_back_only_the_balance_days(client, monkeypatch, db, manager, report):
    from app.dao import ledger_dao

    rid, _start, year = _advance_setup(client, monkeypatch, db, manager, report, 520)
    _as(client, monkeypatch, report)
    assert client.post(f"/api/leave-requests/{rid}/lop/accept").status_code == 200
    assert client.post(f"/api/leave-requests/{rid}/cancellation").status_code == 200
    _as(client, monkeypatch, manager)
    res = client.post(f"/api/leave-requests/{rid}/cancellation/decision", json={"decision": "APPROVE", "unelapsed_days": 5})
    assert res.status_code == 200, res.text
    # 5 untaken days: the 2 LOP days are simply dropped, 3 go back to the balance.
    assert ledger_dao.sum_quantity(db, report.employee_id, annual_type_id(), year.leave_year_id) == 3.0
