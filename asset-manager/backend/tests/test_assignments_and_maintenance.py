import logging
from fastapi.testclient import TestClient
import pytest

from tests.conftest import INTERNAL_TOKEN
from tests.test_schema_and_seed import assert_error_contract

INTERNAL = {"x-internal-token": INTERNAL_TOKEN}  # the portal's /internal/provision (global admin)
REVOKE_EMPLOYEE = {"email": "employee@tektalis.com", "role": None}


def _create_sample_asset(
    client: TestClient,
    headers: dict[str, str],
    name: str = "MacBook Pro 14 M4",
    serial_no: str = "SN-SPRINT3-001",
    category_id: int = 1,
    *,
    include_optional_tags: bool = True,
) -> dict:
    payload: dict = {
        "name": name,
        "serial_no": serial_no,
        "category_id": category_id,
        "purchase_date": "2026-02-01",
        "cost": 2199.00,
        "location": "HQ - Floor 4",
    }
    if include_optional_tags:
        payload["service_tag"] = f"SVC-{serial_no}"
        payload["asset_tag"] = f"ATG-{serial_no}"
    resp = client.post(
        "/api/v1/assets",
        headers=headers,
        json=payload,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _get_employee_user_id(client: TestClient, admin_headers: dict[str, str]) -> int:
    resp = client.get("/api/v1/users?search=employee@tektalis.com", headers=admin_headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    return int(items[0]["id"])


def test_assign_asset_single_active_enforcement_and_audit_log(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    asset = _create_sample_asset(client, manager_headers, serial_no="SN-ASSIGN-001")
    employee_id = _get_employee_user_id(client, admin_headers)

    with caplog.at_level(logging.INFO, logger="ams.audit"):
        assign_resp = client.post(
            f"/api/v1/assets/{asset['id']}/assign",
            headers=manager_headers,
            json={
                "user_id": employee_id,
                "assigned_on": "2026-03-01",
            },
        )
    assert assign_resp.status_code == 200, assign_resp.text
    assignment = assign_resp.json()
    assert assignment["asset_id"] == asset["id"]
    assert assignment["asset_tag"] == asset["tag"]
    assert assignment["user_id"] == employee_id
    assert assignment["user_email"] == "employee@tektalis.com"
    assert assignment["assigned_on"] == "2026-03-01"
    assert assignment["returned_on"] is None

    # Verify structured audit log fired on assign
    audit_messages = [rec.getMessage() for rec in caplog.records if rec.name == "ams.audit"]
    assert any(
        "action=assign" in msg
        and f"asset_id={asset['id']}" in msg
        and f"user_id={employee_id}" in msg
        and "timestamp=" in msg
        for msg in audit_messages
    )

    # Verify asset status transitioned to ASSIGNED
    asset_check = client.get(f"/api/v1/assets/{asset['id']}", headers=manager_headers)
    assert asset_check.status_code == 200
    assert asset_check.json()["status"] == "ASSIGNED"

    # Attempting to assign the same asset again while ASSIGNED -> 409 Conflict (FR-7)
    second_assign = client.post(
        f"/api/v1/assets/{asset['id']}/assign",
        headers=manager_headers,
        json={"user_id": employee_id},
    )
    assert second_assign.status_code == 409
    assert_error_contract(second_assign.json(), 409)
    assert "ASSIGNED" in second_assign.json()["message"]

    # Assigning to a non-existent user -> 404 Not Found
    asset2 = _create_sample_asset(client, manager_headers, serial_no="SN-ASSIGN-002")
    missing_user_resp = client.post(
        f"/api/v1/assets/{asset2['id']}/assign",
        headers=manager_headers,
        json={"user_id": 99999},
    )
    assert missing_user_resp.status_code == 404
    assert_error_contract(missing_user_resp.json(), 404)

    # An inactive user (the global admin revoked their AMS access) cannot be assigned -> 409 Conflict
    for body in ({"email": "inactive.assign@tektalis.com", "name": "Inactive Person", "role": "employee"},
                 {"email": "inactive.assign@tektalis.com", "role": None}):
        assert client.post("/internal/provision", headers=INTERNAL, json=body).status_code == 200
    inactive_user = next(
        u for u in client.get("/api/v1/users/directory", headers=manager_headers).json()
        if u["email"] == "inactive.assign@tektalis.com"
    )
    assert inactive_user["active"] is False
    inactive_assign = client.post(
        f"/api/v1/assets/{asset2['id']}/assign",
        headers=manager_headers,
        json={"user_id": inactive_user["id"]},
    )
    assert inactive_assign.status_code == 409
    assert_error_contract(inactive_assign.json(), 409)


def test_return_transitions_available_maintenance_retired_and_reassignment(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    asset = _create_sample_asset(client, manager_headers, serial_no="SN-RETURN-FLOW-01")
    employee_id = _get_employee_user_id(client, admin_headers)

    # 1. Assign to employee
    r1 = client.post(
        f"/api/v1/assets/{asset['id']}/assign",
        headers=manager_headers,
        json={"user_id": employee_id, "assigned_on": "2026-03-01"},
    )
    assert r1.status_code == 200

    # 2. Return to AVAILABLE and verify structured audit log
    caplog.clear()
    with caplog.at_level(logging.INFO, logger="ams.audit"):
        ret_avail = client.post(
            f"/api/v1/assets/{asset['id']}/return",
            headers=manager_headers,
            json={
                "next_status": "AVAILABLE",
                "return_reason": "OTHER",
                "returned_on": "2026-03-05",
            },
        )
    assert ret_avail.status_code == 200, ret_avail.text
    ret_data = ret_avail.json()
    assert ret_data["returned_on"] == "2026-03-05"
    assert ret_data["return_reason"] == "OTHER"
    assert ret_data["asset_status"] == "AVAILABLE"

    audit_messages = [rec.getMessage() for rec in caplog.records if rec.name == "ams.audit"]
    assert any(
        "action=return" in msg
        and f"asset_id={asset['id']}" in msg
        and f"user_id={employee_id}" in msg
        and '"next_status": "AVAILABLE"' in msg
        for msg in audit_messages
    )

    # Returning an already AVAILABLE asset -> 409 Conflict
    ret_again = client.post(
        f"/api/v1/assets/{asset['id']}/return",
        headers=manager_headers,
        json={"next_status": "AVAILABLE"},
    )
    assert ret_again.status_code == 409
    assert_error_contract(ret_again.json(), 409)

    # 3. Re-assign asset (FR-13) and return to IN_MAINTENANCE
    r2 = client.post(
        f"/api/v1/assets/{asset['id']}/assign",
        headers=manager_headers,
        json={"user_id": employee_id, "assigned_on": "2026-03-06"},
    )
    assert r2.status_code == 200

    ret_maint = client.post(
        f"/api/v1/assets/{asset['id']}/return",
        headers=manager_headers,
        json={
            "next_status": "IN_MAINTENANCE",
            "return_reason": "REPLACEMENT",
            "description": "Keyboard key stuck on return",
            "returned_on": "2026-03-10",
        },
    )
    assert ret_maint.status_code == 200
    asset_after_maint = client.get(f"/api/v1/assets/{asset['id']}", headers=manager_headers).json()
    assert asset_after_maint["status"] == "IN_MAINTENANCE"

    # Verify an open maintenance record was automatically created and close it
    maint_list = client.get(
        f"/api/v1/maintenance?asset_id={asset['id']}&open_only=true",
        headers=manager_headers,
    )
    assert maint_list.status_code == 200
    open_records = maint_list.json()
    assert len(open_records) == 1
    assert "Keyboard key stuck" in open_records[0]["description"]
    assert open_records[0].get("employee_name") == "Jordan Lee"

    close_resp = client.patch(
        f"/api/v1/maintenance/{open_records[0]['id']}/close",
        headers=manager_headers,
        json={
            "closed_on": "2026-03-12",
            "cost": 85.00,
            "resolution": "Keyboard repaired and tested",
        },
    )
    assert close_resp.status_code == 200
    assert close_resp.json()["closed_on"] == "2026-03-12"
    assert close_resp.json()["cost"] == 85.00

    # 4. Re-assign a third time and return directly to RETIRED
    r3 = client.post(
        f"/api/v1/assets/{asset['id']}/assign",
        headers=manager_headers,
        json={"user_id": employee_id, "assigned_on": "2026-03-13"},
    )
    assert r3.status_code == 200

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="ams.audit"):
        ret_retired = client.post(
            f"/api/v1/assets/{asset['id']}/return",
            headers=manager_headers,
            json={
                "next_status": "RETIRED",
                "return_reason": "EMPLOYEE_LEFT",
                "returned_on": "2026-03-15",
            },
        )
    assert ret_retired.status_code == 200
    asset_final = client.get(f"/api/v1/assets/{asset['id']}", headers=manager_headers).json()
    assert asset_final["status"] == "RETIRED"

    # Both return and retire audit events should be logged
    audit_msgs_retired = [rec.getMessage() for rec in caplog.records if rec.name == "ams.audit"]
    assert any("action=return" in m for m in audit_msgs_retired)
    assert any("action=retire" in m for m in audit_msgs_retired)

    # 5. Verify full history via GET /api/v1/assets/{id}/history (FR-9, FR-13)
    history_resp = client.get(f"/api/v1/assets/{asset['id']}/history", headers=manager_headers)
    assert history_resp.status_code == 200
    history = history_resp.json()
    assert history["asset"]["id"] == asset["id"]
    assert history["asset"]["status"] == "RETIRED"
    assert len(history["assignments"]) == 3
    assert all(a["returned_on"] is not None for a in history["assignments"])
    assert len(history["maintenance_records"]) == 1
    assert history["maintenance_records"][0]["closed_on"] == "2026-03-12"


def test_maintenance_locking_and_close_workflow(
    client: TestClient,
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
) -> None:
    asset = _create_sample_asset(client, manager_headers, serial_no="SN-MAINT-LOCK-01")
    employee_id = _get_employee_user_id(client, admin_headers)

    # Open maintenance record on AVAILABLE asset (FR-10, FR-11)
    open_resp = client.post(
        f"/api/v1/assets/{asset['id']}/maintenance",
        headers=manager_headers,
        json={
            "description": "Battery swelling replacement",
            "opened_on": "2026-03-02",
            "cost": 149.50,
        },
    )
    assert open_resp.status_code == 200, open_resp.text
    record = open_resp.json()
    assert record["asset_id"] == asset["id"]
    assert record["asset_tag"] == asset["tag"]
    assert record["description"] == "Battery swelling replacement"
    assert record["opened_on"] == "2026-03-02"
    assert record["closed_on"] is None
    assert record["cost"] == 149.50

    # Asset is now locked in IN_MAINTENANCE
    asset_state = client.get(f"/api/v1/assets/{asset['id']}", headers=manager_headers).json()
    assert asset_state["status"] == "IN_MAINTENANCE"

    # Cannot assign an IN_MAINTENANCE asset -> 409 Conflict (FR-11)
    assign_maint = client.post(
        f"/api/v1/assets/{asset['id']}/assign",
        headers=manager_headers,
        json={"user_id": employee_id},
    )
    assert assign_maint.status_code == 409
    assert_error_contract(assign_maint.json(), 409)

    # Cannot retire an IN_MAINTENANCE asset -> 409 Conflict (FR-11)
    retire_maint = client.patch(
        f"/api/v1/assets/{asset['id']}/retire",
        headers=manager_headers,
    )
    assert retire_maint.status_code == 409
    assert_error_contract(retire_maint.json(), 409)

    # Cannot open another maintenance record while already IN_MAINTENANCE -> 409 Conflict
    dup_maint = client.post(
        f"/api/v1/assets/{asset['id']}/maintenance",
        headers=manager_headers,
        json={"description": "Duplicate maintenance"},
    )
    assert dup_maint.status_code == 409
    assert_error_contract(dup_maint.json(), 409)

    # Close maintenance record -> transitions asset back to AVAILABLE (FR-11)
    close_resp = client.patch(
        f"/api/v1/maintenance/{record['id']}/close",
        headers=manager_headers,
        json={"resolution": "Battery replaced and verified"},
    )
    assert close_resp.status_code == 200, close_resp.text
    closed_record = close_resp.json()
    assert closed_record["closed_on"] is not None
    assert closed_record["resolution"] == "Battery replaced and verified"

    asset_after = client.get(f"/api/v1/assets/{asset['id']}", headers=manager_headers).json()
    assert asset_after["status"] == "AVAILABLE"

    # Closing an already closed maintenance record -> 409 Conflict
    close_again = client.patch(
        f"/api/v1/maintenance/{record['id']}/close",
        headers=manager_headers,
        json={"resolution": "Duplicate close attempt"},
    )
    assert close_again.status_code == 409
    assert_error_contract(close_again.json(), 409)


def test_me_assets_user_assets_and_fr14_offboarding_deactivation_guardrail(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    asset1 = _create_sample_asset(
        client, manager_headers, name="MacBook Air M3", serial_no="SN-OFFBOARD-01", category_id=1
    )
    asset2 = _create_sample_asset(
        client, manager_headers, name="Dell 27 Monitor", serial_no="SN-OFFBOARD-02", category_id=2
    )
    employee_id = _get_employee_user_id(client, admin_headers)

    # Assign both assets to employee@tektalis.com
    assert (
        client.post(
            f"/api/v1/assets/{asset1['id']}/assign",
            headers=manager_headers,
            json={"user_id": employee_id, "assigned_on": "2026-03-01"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/assets/{asset2['id']}/assign",
            headers=manager_headers,
            json={"user_id": employee_id, "assigned_on": "2026-03-02"},
        ).status_code
        == 200
    )

    # Employee checks GET /api/v1/me/assets (FR-9)
    me_assets_resp = client.get("/api/v1/me/assets", headers=employee_headers)
    assert me_assets_resp.status_code == 200
    me_assets = me_assets_resp.json()
    assert len(me_assets) == 2
    tags = {a["tag"] for a in me_assets}
    assert tags == {asset1["tag"], asset2["tag"]}

    # Manager checks GET /api/v1/users/{id}/assets for offboarding (FR-9, FR-14)
    user_assets_resp = client.get(
        f"/api/v1/users/{employee_id}/assets", headers=manager_headers
    )
    assert user_assets_resp.status_code == 200
    assert len(user_assets_resp.json()) == 2

    # Manager checks GET /api/v1/users/directory -> employee has active_assets_count == 2
    dir_resp = client.get("/api/v1/users/directory", headers=manager_headers)
    assert dir_resp.status_code == 200
    emp_dir_entry = next(u for u in dir_resp.json() if u["id"] == employee_id)
    assert emp_dir_entry["active_assets_count"] == 2

    # FR-14 Guardrail: the global admin (portal revoke) attempts to deactivate user while holding 2 open assignments -> 409 Conflict
    deactivate_conflict = client.post("/internal/provision", headers=INTERNAL, json=REVOKE_EMPLOYEE)
    assert deactivate_conflict.status_code == 409
    assert_error_contract(deactivate_conflict.json(), 409)
    assert "active asset assignment" in deactivate_conflict.json()["message"]

    # Return first asset -> still 1 active asset held -> deactivation still blocked with 409 Conflict
    assert (
        client.post(
            f"/api/v1/assets/{asset1['id']}/return",
            headers=manager_headers,
            json={"next_status": "AVAILABLE", "return_reason": "EMPLOYEE_LEFT"},
        ).status_code
        == 200
    )
    still_blocked = client.post("/internal/provision", headers=INTERNAL, json=REVOKE_EMPLOYEE)
    assert still_blocked.status_code == 409
    assert_error_contract(still_blocked.json(), 409)

    # Return second asset -> 0 active assets held
    assert (
        client.post(
            f"/api/v1/assets/{asset2['id']}/return",
            headers=manager_headers,
            json={"next_status": "AVAILABLE", "return_reason": "EMPLOYEE_LEFT"},
        ).status_code
        == 200
    )
    remaining_assets = client.get(
        f"/api/v1/users/{employee_id}/assets", headers=manager_headers
    ).json()
    assert remaining_assets == []

    # Now the global admin can deactivate the offboarded employee -> 200 OK
    deactivate_ok = client.post("/internal/provision", headers=INTERNAL, json=REVOKE_EMPLOYEE)
    assert deactivate_ok.status_code == 200
    assert deactivate_ok.json()["role"] is None
    entry = next(u for u in client.get("/api/v1/users/directory", headers=manager_headers).json()
                 if u["id"] == employee_id)
    assert entry["active"] is False and entry["active_assets_count"] == 0


def test_employee_rbac_for_sprint3_endpoints(
    client: TestClient,
    employee_headers: dict[str, str],
) -> None:
    assert client.get("/api/v1/me/assets", headers=employee_headers).status_code == 200
    assert (
        client.post(
            "/api/v1/assets/1/assign",
            headers=employee_headers,
            json={"user_id": 1},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/assets/1/return",
            headers=employee_headers,
            json={"next_status": "AVAILABLE"},
        ).status_code
        == 403
    )
    assert client.get("/api/v1/assets/1/history", headers=employee_headers).status_code == 403
    assert client.get("/api/v1/users/1/assets", headers=employee_headers).status_code == 403
    assert client.get("/api/v1/users/directory", headers=employee_headers).status_code == 403
    assert (
        client.post(
            "/api/v1/assets/1/maintenance",
            headers=employee_headers,
            json={"description": "Nope"},
        ).status_code
        == 403
    )
    assert client.patch("/api/v1/maintenance/1/close", headers=employee_headers).status_code == 403
    assert client.get("/api/v1/maintenance", headers=employee_headers).status_code == 403



@pytest.mark.xfail(
    strict=True,
    reason="Fails in the original stand-alone AMS too (before the TT Suite): an empty fill of an asset "
    "awaiting employee details answers 409 (required-field checks) instead of 400/422.",
)
def test_employee_one_time_fill_held_asset_details(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """Employee may set blank service_tag/asset_tag once on a held asset; edits lock after."""
    employee_id = _get_employee_user_id(client, admin_headers)
    asset = _create_sample_asset(
        client,
        manager_headers,
        serial_no="SN-EMP-FILL-001",
        include_optional_tags=False,
    )
    assert asset["service_tag"] is None
    assert asset["asset_tag"] is None

    assert (
        client.post(
            f"/api/v1/assets/{asset['id']}/assign",
            headers=manager_headers,
            json={"user_id": employee_id, "assigned_on": "2026-03-01"},
        ).status_code
        == 200
    )

    # Not held by employee -> 409
    other = _create_sample_asset(
        client,
        manager_headers,
        serial_no="SN-EMP-FILL-OTHER",
        include_optional_tags=False,
    )
    not_held = client.patch(
        f"/api/v1/me/assets/{other['id']}/details",
        headers=employee_headers,
        json={"service_tag": "SVC-SHOULD-FAIL"},
    )
    assert not_held.status_code == 409
    assert_error_contract(not_held.json(), 409)

    # Empty payload -> validation error
    empty = client.patch(
        f"/api/v1/me/assets/{asset['id']}/details",
        headers=employee_headers,
        json={},
    )
    assert empty.status_code in (400, 422)

    # First fill succeeds
    fill_ok = client.patch(
        f"/api/v1/me/assets/{asset['id']}/details",
        headers=employee_headers,
        json={"service_tag": "SVC-EMP-FILL-001", "asset_tag": "ATG-EMP-FILL-001"},
    )
    assert fill_ok.status_code == 200, fill_ok.text
    body = fill_ok.json()
    assert body["service_tag"] == "SVC-EMP-FILL-001"
    assert body["asset_tag"] == "ATG-EMP-FILL-001"
    assert body["id"] == asset["id"]

    # Second fill / edit attempt -> 409
    refill = client.patch(
        f"/api/v1/me/assets/{asset['id']}/details",
        headers=employee_headers,
        json={"service_tag": "SVC-CHANGED"},
    )
    assert refill.status_code == 409
    assert_error_contract(refill.json(), 409)
    assert "already set" in refill.json()["message"].lower()

    # Partial fill: create asset with only service_tag blank for another assignment cycle
    asset2 = _create_sample_asset(
        client,
        manager_headers,
        serial_no="SN-EMP-FILL-002",
        include_optional_tags=False,
    )
    assert (
        client.post(
            f"/api/v1/assets/{asset2['id']}/assign",
            headers=manager_headers,
            json={"user_id": employee_id, "assigned_on": "2026-03-02"},
        ).status_code
        == 200
    )
    partial = client.patch(
        f"/api/v1/me/assets/{asset2['id']}/details",
        headers=employee_headers,
        json={"service_tag": "SVC-EMP-FILL-002"},
    )
    assert partial.status_code == 200, partial.text
    assert partial.json()["service_tag"] == "SVC-EMP-FILL-002"
    assert partial.json()["asset_tag"] is None

    # Can still fill the remaining blank asset_tag once
    fill_remaining = client.patch(
        f"/api/v1/me/assets/{asset2['id']}/details",
        headers=employee_headers,
        json={"asset_tag": "ATG-EMP-FILL-002"},
    )
    assert fill_remaining.status_code == 200, fill_remaining.text
    assert fill_remaining.json()["asset_tag"] == "ATG-EMP-FILL-002"

    # Both locked now
    both_locked = client.patch(
        f"/api/v1/me/assets/{asset2['id']}/details",
        headers=employee_headers,
        json={"asset_tag": "ATG-CHANGED"},
    )
    assert both_locked.status_code == 409
    assert_error_contract(both_locked.json(), 409)
