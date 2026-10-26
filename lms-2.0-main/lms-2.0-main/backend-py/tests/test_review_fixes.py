"""Regression tests for the review findings: sick-leave medical file, per-request
day cap, delegation by leave dates, entitlement revisions reaching balances,
blank carry-forward cap, and report export."""
import io
from datetime import date, timedelta

import pytest

from app.core.config import settings
from app.dao import leave_type_dao
from app.dao import ledger_dao, leave_year_dao
from app.models.delegation_watcher import Delegation
from tests.test_leave_requests import _as, _make_employee, manager, report  # noqa: F401  (fixtures)


def _monday(offset_days):
    d = date.today() + timedelta(days=offset_days)
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d


def _type_id(db, code):
    return next(t.leave_type_id for t in leave_type_dao.list_all(db) if t.type_code == code)


def test_max_days_per_request_is_enforced(client, monkeypatch, db, report):
    _as(client, monkeypatch, report)
    start = _monday(300)
    end = start + timedelta(days=24)  # 5 weeks Mon..Fri-ish = 19 working days
    res = client.post("/api/leave-requests", json={
        "leave_type_id": _type_id(db, "ANNUAL"), "start_date": start.isoformat(), "end_date": end.isoformat(), "reason": "long",
    })
    assert res.status_code == 400, res.text
    assert res.json()["error"]["code"] == "MAX_DAYS_EXCEEDED"


def test_long_sick_leave_needs_a_medical_file(client, monkeypatch, db, report):
    _as(client, monkeypatch, report)
    sick = _type_id(db, "SICK")
    start = _monday(330)
    end = start + timedelta(days=4)  # 5 working days > threshold 3
    payload = {"leave_type_id": sick, "start_date": start.isoformat(), "end_date": end.isoformat(), "reason": "flu"}

    direct = client.post("/api/leave-requests", json=payload)
    assert direct.status_code == 400 and direct.json()["error"]["code"] == "MEDICAL_CERT_REQUIRED", direct.text

    draft = client.post("/api/leave-requests/draft", json=payload)
    assert draft.status_code == 201, draft.text
    rid = draft.json()["data"]["request_id"]
    no_file = client.post(f"/api/leave-requests/draft/{rid}/submit")
    assert no_file.status_code == 400 and no_file.json()["error"]["code"] == "MEDICAL_CERT_REQUIRED"

    up = client.post(f"/api/attachments/{rid}", files={"file": ("cert.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")})
    assert up.status_code == 201, up.text
    ok = client.post(f"/api/leave-requests/draft/{rid}/submit")
    assert ok.status_code == 201, ok.text


def test_short_sick_leave_needs_no_file(client, monkeypatch, db, report):
    _as(client, monkeypatch, report)
    start = _monday(360)
    res = client.post("/api/leave-requests", json={
        "leave_type_id": _type_id(db, "SICK"), "start_date": start.isoformat(), "end_date": (start + timedelta(days=1)).isoformat(),
        "reason": "cold",
    })
    assert res.status_code == 201, res.text


def test_delegation_is_matched_on_leave_dates_not_today(client, monkeypatch, db, manager, report):
    delegate = _make_employee(db, role_code="MANAGER")
    start = _monday(400)
    # Delegation covers today but ENDS before the leave starts.
    db.add(Delegation(nominator_id=manager.employee_id, delegate_id=delegate.employee_id, set_by_id=manager.employee_id,
                      from_date=date.today() - timedelta(days=1), to_date=date.today() + timedelta(days=10)))
    db.commit()
    _as(client, monkeypatch, report)
    after = client.post("/api/leave-requests", json={
        "leave_type_id": _type_id(db, "ANNUAL"), "start_date": start.isoformat(), "end_date": start.isoformat(), "reason": "later",
    })
    assert after.status_code == 201, after.text
    assert after.json()["data"]["current_approver_id"] == manager.employee_id  # not the delegate

    # And a delegation that covers the leave dates (but not today) does route to the delegate.
    start2 = _monday(430)
    db.add(Delegation(nominator_id=manager.employee_id, delegate_id=delegate.employee_id, set_by_id=manager.employee_id,
                      from_date=start2 - timedelta(days=2), to_date=start2 + timedelta(days=2)))
    db.commit()
    during = client.post("/api/leave-requests", json={
        "leave_type_id": _type_id(db, "CASUAL"), "start_date": start2.isoformat(), "end_date": start2.isoformat(), "reason": "covered",
    })
    assert during.status_code == 201, during.text
    assert during.json()["data"]["current_approver_id"] == delegate.employee_id


def test_entitlement_edit_reaches_existing_balances_and_blank_cap_is_ok(as_hr_admin, db, monkeypatch):
    employee = _make_employee(db)  # joined before the leave year -> full ratio
    casual = _type_id(db, "CASUAL")
    year = leave_year_dao.find_current(db)
    policy = leave_type_dao.find_policy(db, casual)
    old = float(policy.annual_entitlement)
    db.commit()
    before = ledger_dao.sum_quantity(db, employee.employee_id, casual, year.leave_year_id)

    res = as_hr_admin.patch(f"/api/admin/leave-types/{casual}/policy", json={"annual_entitlement": old + 2, "carry_forward_cap": ""})
    assert res.status_code == 200, res.text
    assert res.json()["data"]["policy"]["carry_forward_cap"] is None
    db.commit()
    after = ledger_dao.sum_quantity(db, employee.employee_id, casual, year.leave_year_id)
    assert after - before == pytest.approx(2.0)

    back = as_hr_admin.patch(f"/api/admin/leave-types/{casual}/policy", json={"annual_entitlement": old})
    assert back.status_code == 200, back.text
    db.commit()
    assert ledger_dao.sum_quantity(db, employee.employee_id, casual, year.leave_year_id) == pytest.approx(before)


def test_reports_export_csv_and_xlsx(as_hr_admin):
    csv_res = as_hr_admin.get("/api/reports/leave-taken?export=csv")
    assert csv_res.status_code == 200
    assert csv_res.headers["content-type"].startswith("text/csv")
    assert "attachment" in csv_res.headers["content-disposition"]

    xlsx = as_hr_admin.get("/api/reports/leave-taken?export=xlsx")
    assert xlsx.status_code == 200
    assert xlsx.content[:2] == b"PK"  # xlsx is a zip

    assert as_hr_admin.get("/api/reports/leave-taken?export=pdf").status_code == 400
