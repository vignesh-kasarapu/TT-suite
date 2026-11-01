"""A delegation adds an approver; it must not hide the work from the manager who gave it.

Before this, a request routed to the delegate vanished from the nominator's approvals queue
and they were refused if they tried to decide it — a manager who delegated for a week could
not step back in.
"""
from datetime import date, timedelta

from app.models.delegation_watcher import Delegation
from tests.test_leave_requests import _as, _make_employee, manager, report  # noqa: F401  (fixtures)
from tests.test_review_fixes import _monday, _type_id


def _delegate_everything(db, manager_employee, delegate):
    """A delegation wide enough to cover both today and the leave dates used below."""
    db.add(Delegation(
        nominator_id=manager_employee.employee_id, delegate_id=delegate.employee_id,
        set_by_id=manager_employee.employee_id,
        from_date=date.today() - timedelta(days=1), to_date=date.today() + timedelta(days=900),
    ))
    db.commit()


def _raise_request(client, monkeypatch, db, report_employee, offset, code="ANNUAL"):
    _as(client, monkeypatch, report_employee)
    start = _monday(offset)
    res = client.post("/api/leave-requests", json={
        "leave_type_id": _type_id(db, code), "start_date": start.isoformat(),
        "end_date": start.isoformat(), "reason": "delegation visibility",
    })
    assert res.status_code == 201, res.text
    return res.json()["data"]


def test_both_the_manager_and_the_delegate_see_the_request(client, monkeypatch, db, manager, report):
    delegate = _make_employee(db, role_code="MANAGER")
    _delegate_everything(db, manager, delegate)
    created = _raise_request(client, monkeypatch, db, report, 500)
    assert created["current_approver_id"] == delegate.employee_id

    # The delegate, because it is routed to them.
    _as(client, monkeypatch, delegate)
    delegate_queue = client.get("/api/leave-requests/approvals-queue").json()["data"]
    delegate_row = next(r for r in delegate_queue if r["request_id"] == created["request_id"])
    assert delegate_row["is_delegated"] is True
    assert delegate_row["delegated_for"]["employee_id"] == manager.employee_id

    # The manager, because delegating did not give their authority away.
    _as(client, monkeypatch, manager)
    manager_queue = client.get("/api/leave-requests/approvals-queue").json()["data"]
    manager_row = next(r for r in manager_queue if r["request_id"] == created["request_id"])
    assert manager_row["delegated_to"]["employee_id"] == delegate.employee_id


def test_the_manager_can_still_decide_what_the_delegate_holds(client, monkeypatch, db, manager, report):
    delegate = _make_employee(db, role_code="MANAGER")
    _delegate_everything(db, manager, delegate)
    created = _raise_request(client, monkeypatch, db, report, 540, code="CASUAL")

    _as(client, monkeypatch, manager)
    res = client.post(f"/api/leave-requests/{created['request_id']}/decision", json={"decision": "APPROVE"})
    assert res.status_code == 200, res.text
    assert res.json()["data"]["state"] == "APPROVED"


def test_the_delegate_can_decide_as_before(client, monkeypatch, db, manager, report):
    delegate = _make_employee(db, role_code="MANAGER")
    _delegate_everything(db, manager, delegate)
    created = _raise_request(client, monkeypatch, db, report, 580, code="CASUAL")

    _as(client, monkeypatch, delegate)
    res = client.post(f"/api/leave-requests/{created['request_id']}/decision", json={"decision": "APPROVE"})
    assert res.status_code == 200, res.text


def test_an_unrelated_manager_still_cannot_decide(client, monkeypatch, db, manager, report):
    """The extra authority is the nominator's alone — it is not a hole for any manager."""
    delegate = _make_employee(db, role_code="MANAGER")
    stranger = _make_employee(db, role_code="MANAGER")
    _delegate_everything(db, manager, delegate)
    created = _raise_request(client, monkeypatch, db, report, 620, code="CASUAL")

    _as(client, monkeypatch, stranger)
    assert client.get("/api/leave-requests/approvals-queue").json()["data"] == [] or all(
        r["request_id"] != created["request_id"] for r in client.get("/api/leave-requests/approvals-queue").json()["data"]
    )
    res = client.post(f"/api/leave-requests/{created['request_id']}/decision", json={"decision": "APPROVE"})
    assert res.status_code == 403


def test_the_delegation_notification_names_people_not_ids(db):
    """It used to read "set from 2 to 1" — raw employee ids, because the template's tokens
    were given the ids themselves."""
    from datetime import date as _date

    from app.dao import notification_dao
    from app.services import delegation_service

    supervisor = _make_employee(db, role_code="MANAGER")
    nominator = _make_employee(db, manager_id=supervisor.employee_id, role_code="MANAGER")
    # The fallback path: no peer manager under the same supervisor, so the supervisor is the
    # eligible delegate.
    delegation = delegation_service.nominate(
        db, nominator.employee_id, supervisor.employee_id,
        _date.today(), _date.today() + timedelta(days=5), set_by_id=nominator.employee_id,
    )
    assert delegation is not None

    rows = notification_dao.list_in_app_for_employee(db, nominator.employee_id)
    body = next(r.body for r in rows if r.template_key == "DELEGATE_ASSIGNED_TO_YOU")
    assert nominator.full_name in body
    assert supervisor.full_name in body
    assert f"from {nominator.employee_id} to {supervisor.employee_id}" not in body


def test_the_delegate_sees_who_delegated_even_when_the_window_opens_later(client, monkeypatch, db, manager, report):
    """Routing matches the delegation on the LEAVE START date. The queue used to match on
    the submission date, so a delegation starting after the request was raised — the normal
    case, since people book cover in advance — left the row with no "Delegated for" at all.
    """
    delegate = _make_employee(db, role_code="MANAGER")
    start = _monday(660)
    # Window covers the leave dates only, not today.
    db.add(Delegation(
        nominator_id=manager.employee_id, delegate_id=delegate.employee_id, set_by_id=manager.employee_id,
        from_date=start - timedelta(days=1), to_date=start + timedelta(days=1),
    ))
    db.commit()

    _as(client, monkeypatch, report)
    created = client.post("/api/leave-requests", json={
        "leave_type_id": _type_id(db, "ANNUAL"), "start_date": start.isoformat(),
        "end_date": start.isoformat(), "reason": "cover booked ahead",
    }).json()["data"]
    assert created["current_approver_id"] == delegate.employee_id

    _as(client, monkeypatch, delegate)
    row = next(
        r for r in client.get("/api/leave-requests/approvals-queue").json()["data"]
        if r["request_id"] == created["request_id"]
    )
    assert row["is_delegated"] is True
    assert row["delegated_for"]["employee_id"] == manager.employee_id
    assert row["delegated_for"]["full_name"] == manager.full_name
