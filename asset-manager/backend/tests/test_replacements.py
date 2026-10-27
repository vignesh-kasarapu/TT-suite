from fastapi.testclient import TestClient


def _get_employee_id(client: TestClient, employee_headers: dict[str, str]) -> int:
    me_resp = client.get("/api/v1/auth/me", headers=employee_headers)
    assert me_resp.status_code == 200
    return me_resp.json()["id"]


def _create_available_asset(
    client: TestClient,
    manager_headers: dict[str, str],
    name: str,
    serial_no: str,
    category_id: int = 1,
) -> dict:
    resp = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": name,
            "category_id": category_id,
            "serial_no": serial_no,
            "service_tag": f"SVC-{serial_no}",
            "asset_tag": f"ATG-{serial_no}",
            "purchase_date": "2026-01-15",
            "cost": 1800.00,
            "location": "HQ - Floor 4",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _assign_asset(
    client: TestClient,
    manager_headers: dict[str, str],
    asset_id: int,
    user_id: int,
) -> dict:
    resp = client.post(
        f"/api/v1/assets/{asset_id}/assign",
        headers=manager_headers,
        json={"user_id": user_id, "notes": "Initial assignment for test"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_create_and_list_replacement_requests_fr15(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    employee_id = _get_employee_id(client, employee_headers)

    # Create two assets: one assigned to employee, one left AVAILABLE
    held_asset = _create_available_asset(
        client, manager_headers, "ThinkPad X1 Carbon Gen 12", "SN-REPL-HELD-01"
    )
    unheld_asset = _create_available_asset(
        client, manager_headers, "Spare MacBook Pro", "SN-REPL-SPARE-01"
    )
    _assign_asset(client, manager_headers, held_asset["id"], employee_id)

    # 1. Unauthenticated -> 401
    unauth_resp = client.post(
        "/api/v1/replacement-requests",
        json={
            "asset_id": held_asset["id"],
            "reason": "Battery swelling",
            "old_asset_action": "REPAIR",
            "temporary": True,
        },
    )
    assert unauth_resp.status_code == 401
    assert {"status", "message", "timestamp"} <= set(unauth_resp.json().keys())  # TT Suite adds `code`

    # 2. Invalid combination: temporary=True with old_asset_action=RETIRE -> 400
    bad_combo_resp = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": held_asset["id"],
            "reason": "Total hardware failure",
            "old_asset_action": "RETIRE",
            "temporary": True,
        },
    )
    assert bad_combo_resp.status_code == 400

    # 3. Non-existent asset -> 404
    not_found_resp = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": 99999,
            "reason": "Broken screen",
            "old_asset_action": "REPAIR",
            "temporary": False,
        },
    )
    assert not_found_resp.status_code == 404

    # 4. Asset not held by the requesting employee -> 409 Conflict
    unheld_resp = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": unheld_asset["id"],
            "reason": "Want to replace an asset I do not hold",
            "old_asset_action": "REPAIR",
            "temporary": False,
        },
    )
    assert unheld_resp.status_code == 409

    # 5. Valid replacement request by employee -> 201 Created
    create_resp = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": held_asset["id"],
            "reason": "Screen flickering intermittently during calls",
            "old_asset_action": "REPAIR",
            "temporary": True,
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    created = create_resp.json()
    assert created["asset_id"] == held_asset["id"]
    assert created["asset_tag"] == held_asset["tag"]
    assert created["requested_by"] == employee_id
    assert created["old_asset_action"] == "REPAIR"
    assert created["temporary"] is True
    assert created["status"] == "PENDING"

    # 6. Duplicate pending request on the same asset -> 409 Conflict
    dup_resp = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": held_asset["id"],
            "reason": "Second duplicate pending request",
            "old_asset_action": "REPAIR",
            "temporary": False,
        },
    )
    assert dup_resp.status_code == 409

    # 7. Role-filtered GET /api/v1/replacement-requests
    # Create another asset assigned to admin and have admin submit a request
    admin_me = client.get("/api/v1/auth/me", headers=admin_headers).json()
    admin_asset = _create_available_asset(
        client, manager_headers, "Admin Studio Display", "SN-REPL-ADMIN-01"
    )
    _assign_asset(client, manager_headers, admin_asset["id"], admin_me["id"])
    admin_req = client.post(
        "/api/v1/replacement-requests",
        headers=admin_headers,
        json={
            "asset_id": admin_asset["id"],
            "reason": "Backlight failure",
            "old_asset_action": "RETIRE",
            "temporary": False,
        },
    )
    assert admin_req.status_code == 200

    # Employee sees ONLY their own request
    emp_list = client.get("/api/v1/replacement-requests", headers=employee_headers)
    assert emp_list.status_code == 200
    emp_items = emp_list.json()
    assert all(r["requested_by"] == employee_id for r in emp_items)
    assert any(r["id"] == created["id"] for r in emp_items)
    assert not any(r["id"] == admin_req.json()["id"] for r in emp_items)

    # Manager sees ALL requests across all users
    mgr_list = client.get("/api/v1/replacement-requests", headers=manager_headers)
    assert mgr_list.status_code == 200
    mgr_ids = {r["id"] for r in mgr_list.json()}
    assert created["id"] in mgr_ids
    assert admin_req.json()["id"] in mgr_ids


def test_hold_replacement_request_visible_fr16(
    client: TestClient,
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """When no stock, manager marks ON_HOLD; employee and manager both see it."""
    employee_id = _get_employee_id(client, employee_headers)
    held_asset = _create_available_asset(
        client, manager_headers, "Dell XPS 15 Hold Test", "SN-REPL-HOLD-01"
    )
    _assign_asset(client, manager_headers, held_asset["id"], employee_id)

    req = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": held_asset["id"],
            "reason": "Keyboard keys sticking — need same-category spare",
            "old_asset_action": "REPAIR",
            "temporary": True,
        },
    ).json()
    assert req["status"] == "PENDING"

    # Employee cannot hold -> 403
    emp_hold = client.patch(
        f"/api/v1/replacement-requests/{req['id']}/hold",
        headers=employee_headers,
        json={"comment": "Self hold attempt"},
    )
    assert emp_hold.status_code == 403

    hold_resp = client.patch(
        f"/api/v1/replacement-requests/{req['id']}/hold",
        headers=manager_headers,
        json={"comment": "Awaiting AVAILABLE Laptops stock"},
    )
    assert hold_resp.status_code == 200, hold_resp.text
    held = hold_resp.json()
    assert held["status"] == "ON_HOLD"
    assert held["decision_comment"] == "Awaiting AVAILABLE Laptops stock"
    assert held["decided_at"] is None

    emp_list = client.get(
        "/api/v1/replacement-requests", headers=employee_headers
    )
    assert emp_list.status_code == 200
    emp_row = next(r for r in emp_list.json() if r["id"] == req["id"])
    assert emp_row["status"] == "ON_HOLD"

    mgr_filtered = client.get(
        "/api/v1/replacement-requests",
        headers=manager_headers,
        params={"status": "ON_HOLD"},
    )
    assert mgr_filtered.status_code == 200
    assert any(r["id"] == req["id"] for r in mgr_filtered.json())

    # Still rejectable from ON_HOLD
    rej = client.patch(
        f"/api/v1/replacement-requests/{req['id']}/reject",
        headers=manager_headers,
        json={"comment": "Stock delayed; closing for now"},
    )
    assert rej.status_code == 200
    assert rej.json()["status"] == "REJECTED"


def test_reject_replacement_request_fr16(
    client: TestClient,
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    employee_id = _get_employee_id(client, employee_headers)
    held_asset = _create_available_asset(
        client, manager_headers, "Dell XPS 15 Reject Test", "SN-REPL-REJ-01"
    )
    _assign_asset(client, manager_headers, held_asset["id"], employee_id)

    req = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": held_asset["id"],
            "reason": "Minor cosmetic scratch on lid",
            "old_asset_action": "RETIRE",
            "temporary": False,
        },
    ).json()

    # Employee cannot reject -> 403
    emp_rej = client.patch(
        f"/api/v1/replacement-requests/{req['id']}/reject",
        headers=employee_headers,
        json={"comment": "Self reject attempt"},
    )
    assert emp_rej.status_code == 403

    # Blank comment -> 400
    blank_rej = client.patch(
        f"/api/v1/replacement-requests/{req['id']}/reject",
        headers=manager_headers,
        json={"comment": "   "},
    )
    assert blank_rej.status_code == 400

    # Valid rejection by Manager -> 200
    rej_resp = client.patch(
        f"/api/v1/replacement-requests/{req['id']}/reject",
        headers=manager_headers,
        json={"comment": "Cosmetic wear does not warrant hardware replacement."},
    )
    assert rej_resp.status_code == 200, rej_resp.text
    rejected = rej_resp.json()
    assert rejected["status"] == "REJECTED"
    assert (
        rejected["decision_comment"]
        == "Cosmetic wear does not warrant hardware replacement."
    )
    assert rejected["decided_at"] is not None

    # Original asset remains ASSIGNED to the employee
    asset_after = client.get(
        f"/api/v1/assets/{held_asset['id']}", headers=manager_headers
    ).json()
    assert asset_after["status"] == "ASSIGNED"

    # Rejecting an already-decided request -> 409 Conflict
    second_rej = client.patch(
        f"/api/v1/replacement-requests/{req['id']}/reject",
        headers=manager_headers,
        json={"comment": "Rejecting again"},
    )
    assert second_rej.status_code == 409


def test_approve_atomic_rollback_and_retire_transition_fr17(
    client: TestClient,
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """
    Validates FR-17:
    1. If the selected replacement asset is NOT AVAILABLE (or does not exist),
       the entire transaction rolls back — the old asset is NOT returned, NOT moved to
       IN_MAINTENANCE/RETIRED, and no orphan maintenance record is created.
    2. When approved with a valid AVAILABLE replacement asset and old_asset_action=RETIRE,
       the old asset is returned (return_reason=REPLACEMENT) and transitioned to RETIRED,
       while the replacement asset becomes ASSIGNED to the employee in a single transaction.
    """
    employee_id = _get_employee_id(client, employee_headers)

    old_asset = _create_available_asset(
        client, manager_headers, "Old Damaged Laptop", "SN-FR17-OLD-01"
    )
    unavailable_asset = _create_available_asset(
        client, manager_headers, "Already Retired Laptop", "SN-FR17-UNAVAIL-01"
    )
    replacement_asset = _create_available_asset(
        client, manager_headers, "New Replacement Laptop", "SN-FR17-NEW-01"
    )

    # Retire unavailable_asset so it is NOT AVAILABLE
    retire_resp = client.patch(
        f"/api/v1/assets/{unavailable_asset['id']}/retire", headers=manager_headers
    )
    assert retire_resp.status_code == 200

    # Assign old_asset to employee
    _assign_asset(client, manager_headers, old_asset["id"], employee_id)

    # Employee creates a REPAIR replacement request first to test atomic rollback of maintenance creation too
    repair_req = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": old_asset["id"],
            "reason": "Motherboard issue requiring repair",
            "old_asset_action": "REPAIR",
            "temporary": False,
        },
    ).json()

    assert repair_req.get("asset_category_id") == old_asset["category_id"]

    # Attempt to approve using the RETIRED (non-AVAILABLE) asset -> 409 Conflict
    failed_approve = client.patch(
        f"/api/v1/replacement-requests/{repair_req['id']}/approve",
        headers=manager_headers,
        json={"replacement_asset_id": unavailable_asset["id"]},
    )
    assert failed_approve.status_code == 409

    # Attempt to approve using a non-existent replacement_asset_id -> 404 Not Found
    not_found_approve = client.patch(
        f"/api/v1/replacement-requests/{repair_req['id']}/approve",
        headers=manager_headers,
        json={"replacement_asset_id": 999999},
    )
    assert not_found_approve.status_code == 404

    # Wrong category AVAILABLE asset (Monitor vs Laptop) -> 409; request stays PENDING
    wrong_category = _create_available_asset(
        client,
        manager_headers,
        "Spare Monitor",
        "SN-FR17-WRONG-CAT-01",
        category_id=2,
    )
    wrong_cat_approve = client.patch(
        f"/api/v1/replacement-requests/{repair_req['id']}/approve",
        headers=manager_headers,
        json={"replacement_asset_id": wrong_category["id"]},
    )
    assert wrong_cat_approve.status_code == 409
    still_pending = client.get(
        "/api/v1/replacement-requests",
        headers=manager_headers,
        params={"status": "PENDING"},
    )
    assert still_pending.status_code == 200
    assert any(r["id"] == repair_req["id"] for r in still_pending.json())

    # VERIFY ATOMIC ROLLBACK:
    # 1. old_asset must STILL be ASSIGNED (not IN_MAINTENANCE)
    old_asset_check = client.get(
        f"/api/v1/assets/{old_asset['id']}", headers=manager_headers
    ).json()
    assert old_asset_check["status"] == "ASSIGNED"

    # 2. Employee still holds old_asset with an open assignment (returned_on is None)
    my_assets = client.get("/api/v1/me/assets", headers=employee_headers).json()
    held_ids = [a["id"] for a in my_assets]
    assert old_asset["id"] in held_ids

    # 3. No orphan maintenance record was committed for old_asset
    maint_list = client.get(
        f"/api/v1/maintenance?asset_id={old_asset['id']}", headers=manager_headers
    ).json()
    assert len(maint_list) == 0

    # 4. Replacement request is still PENDING
    req_list = client.get(
        "/api/v1/replacement-requests?status=PENDING", headers=manager_headers
    ).json()
    assert any(r["id"] == repair_req["id"] for r in req_list)

    # Now test Permanent Replacement with RETIRE action:
    # Reject the first request so we can open a RETIRE request on old_asset
    client.patch(
        f"/api/v1/replacement-requests/{repair_req['id']}/reject",
        headers=manager_headers,
        json={"comment": "Switching to full retirement instead of repair"},
    )

    retire_req = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": old_asset["id"],
            "reason": "Water damage beyond economical repair",
            "old_asset_action": "RETIRE",
            "temporary": False,
        },
    ).json()

    approve_resp = client.patch(
        f"/api/v1/replacement-requests/{retire_req['id']}/approve",
        headers=manager_headers,
        json={
            "replacement_asset_id": replacement_asset["id"],
            "comment": "Approved permanent replacement; retiring water-damaged unit.",
        },
    )
    assert approve_resp.status_code == 200, approve_resp.text
    approved = approve_resp.json()
    assert approved["status"] == "APPROVED"
    assert approved["replacement_asset_id"] == replacement_asset["id"]
    assert approved["replacement_asset_tag"] == replacement_asset["tag"]

    # Verify old_asset is now RETIRED and its assignment was closed with return_reason=REPLACEMENT
    old_after = client.get(
        f"/api/v1/assets/{old_asset['id']}", headers=manager_headers
    ).json()
    assert old_after["status"] == "RETIRED"

    old_history = client.get(
        f"/api/v1/assets/{old_asset['id']}/history", headers=manager_headers
    ).json()
    assert old_history["assignments"][0]["returned_on"] is not None
    assert old_history["assignments"][0]["return_reason"] == "REPLACEMENT"

    # Verify replacement_asset is now ASSIGNED to the employee
    new_after = client.get(
        f"/api/v1/assets/{replacement_asset['id']}", headers=manager_headers
    ).json()
    assert new_after["status"] == "ASSIGNED"

    my_assets_after = client.get("/api/v1/me/assets", headers=employee_headers).json()
    held_after_ids = [a["id"] for a in my_assets_after]
    assert replacement_asset["id"] in held_after_ids
    assert old_asset["id"] not in held_after_ids


def test_temporary_replacement_auto_swap_on_maintenance_close_fr18(
    client: TestClient,
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """
    Validates FR-17 (REPAIR) & FR-18 (Temporary Replacement Auto-Swap):
    1. Employee raises a temporary replacement request (old_asset_action=REPAIR, temporary=True).
    2. Manager approves with an AVAILABLE temporary replacement asset:
       - Original asset assignment closed (return_reason=REPLACEMENT).
       - Original asset moves to IN_MAINTENANCE with a linked maintenance_records row
         (replacement_request_id = request.id).
       - Temporary replacement asset moves to ASSIGNED for the employee.
    3. Manager closes the linked maintenance record (PATCH /api/v1/maintenance/{id}/close):
       - Temporary replacement asset is automatically returned (return_reason=REPLACEMENT)
         and transitions back to AVAILABLE.
       - Repaired original asset becomes AVAILABLE (manual reassignment by admin/manager).
       - Replacement request status is automatically marked COMPLETED.
    """
    employee_id = _get_employee_id(client, employee_headers)

    original_asset = _create_available_asset(
        client, manager_headers, "Primary Engineer MacBook Pro", "SN-FR18-ORIG-01"
    )
    temp_loaner_asset = _create_available_asset(
        client, manager_headers, "Loaner MacBook Air", "SN-FR18-LOAN-01"
    )

    _assign_asset(client, manager_headers, original_asset["id"], employee_id)

    # 1. Employee raises temporary replacement request (REPAIR + temporary=True)
    create_resp = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": original_asset["id"],
            "reason": "USB-C ports need board-level repair; need loaner during service",
            "old_asset_action": "REPAIR",
            "temporary": True,
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    req = create_resp.json()
    assert req["temporary"] is True
    assert req["old_asset_action"] == "REPAIR"
    assert req["status"] == "PENDING"

    # 2. Manager approves the temporary replacement with temp_loaner_asset
    approve_resp = client.patch(
        f"/api/v1/replacement-requests/{req['id']}/approve",
        headers=manager_headers,
        json={
            "replacement_asset_id": temp_loaner_asset["id"],
            "comment": "Issuing loaner MacBook Air while primary unit is in repair.",
        },
    )
    assert approve_resp.status_code == 200, approve_resp.text
    approved = approve_resp.json()
    assert approved["status"] == "APPROVED"
    assert approved["replacement_asset_id"] == temp_loaner_asset["id"]

    # Check state immediately after approval:
    # Original asset is IN_MAINTENANCE
    orig_mid = client.get(
        f"/api/v1/assets/{original_asset['id']}", headers=manager_headers
    ).json()
    assert orig_mid["status"] == "IN_MAINTENANCE"

    # Loaner asset is ASSIGNED to employee
    loaner_mid = client.get(
        f"/api/v1/assets/{temp_loaner_asset['id']}", headers=manager_headers
    ).json()
    assert loaner_mid["status"] == "ASSIGNED"

    # A linked maintenance record was automatically created with replacement_request_id == req["id"]
    maint_records = client.get(
        f"/api/v1/maintenance?asset_id={original_asset['id']}&open_only=true",
        headers=manager_headers,
    ).json()
    assert len(maint_records) == 1
    maint_record = maint_records[0]
    assert maint_record["replacement_request_id"] == req["id"]
    assert maint_record["closed_on"] is None
    assert maint_record.get("requested_by_name") is not None
    assert maint_record.get("employee_name") is not None
    assert maint_record.get("reason") is not None
    assert maint_record.get("temporary") is True

    # 3. Manager closes the maintenance record (PATCH /api/v1/maintenance/{id}/close)
    close_resp = client.patch(
        f"/api/v1/maintenance/{maint_record['id']}/close",
        headers=manager_headers,
        json={
            "cost": 225.00,
            "description": "Replaced USB-C I/O board and passed diagnostics",
            "resolution": "USB-C board replaced; diagnostics passed",
        },
    )
    assert close_resp.status_code == 200, close_resp.text
    closed_maint = close_resp.json()
    assert closed_maint["closed_on"] is not None
    assert float(closed_maint["cost"]) == 225.00

    # Verify FR-18 close behavior (loaner returned; original AVAILABLE for manual assign):
    # a) Loaner asset is now AVAILABLE and its assignment is closed with REPLACEMENT
    loaner_final = client.get(
        f"/api/v1/assets/{temp_loaner_asset['id']}", headers=manager_headers
    ).json()
    assert loaner_final["status"] == "AVAILABLE"

    loaner_history = client.get(
        f"/api/v1/assets/{temp_loaner_asset['id']}/history", headers=manager_headers
    ).json()
    assert loaner_history["assignments"][0]["returned_on"] is not None
    assert loaner_history["assignments"][0]["return_reason"] == "REPLACEMENT"

    # b) Repaired original asset is AVAILABLE — not auto-assigned (manual assign required)
    orig_final = client.get(
        f"/api/v1/assets/{original_asset['id']}", headers=manager_headers
    ).json()
    assert orig_final["status"] == "AVAILABLE"

    my_assets_final = client.get("/api/v1/me/assets", headers=employee_headers).json()
    held_final_ids = [a["id"] for a in my_assets_final]
    assert original_asset["id"] not in held_final_ids
    assert temp_loaner_asset["id"] not in held_final_ids

    # c) Replacement request status is now COMPLETED
    reqs_final = client.get(
        "/api/v1/replacement-requests", headers=employee_headers
    ).json()
    updated_req = next(r for r in reqs_final if r["id"] == req["id"])
    assert updated_req["status"] == "COMPLETED"


def test_permanent_repair_replacement_becomes_available_on_maintenance_close_fr17(
    client: TestClient,
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    """
    Validates FR-17 when old_asset_action=REPAIR and temporary=False:
    - Approving moves old asset to IN_MAINTENANCE (linked maintenance record) and assigns new asset.
    - Closing the maintenance record makes the repaired old asset AVAILABLE in inventory while
      the employee retains the permanent replacement asset.
    """
    employee_id = _get_employee_id(client, employee_headers)

    old_asset = _create_available_asset(
        client, manager_headers, "Monitor With Dead Pixels", "SN-FR17-PERM-OLD"
    )
    perm_replacement = _create_available_asset(
        client, manager_headers, "New 4K Monitor", "SN-FR17-PERM-NEW"
    )
    _assign_asset(client, manager_headers, old_asset["id"], employee_id)

    req = client.post(
        "/api/v1/replacement-requests",
        headers=employee_headers,
        json={
            "asset_id": old_asset["id"],
            "reason": "Panel replacement needed; issuing permanent replacement monitor",
            "old_asset_action": "REPAIR",
            "temporary": False,
        },
    ).json()

    approve_resp = client.patch(
        f"/api/v1/replacement-requests/{req['id']}/approve",
        headers=manager_headers,
        json={"replacement_asset_id": perm_replacement["id"]},
    )
    assert approve_resp.status_code == 200

    maint_records = client.get(
        f"/api/v1/maintenance?asset_id={old_asset['id']}&open_only=true",
        headers=manager_headers,
    ).json()
    assert len(maint_records) == 1
    assert maint_records[0]["replacement_request_id"] == req["id"]

    # Close maintenance on non-temporary replacement
    close_resp = client.patch(
        f"/api/v1/maintenance/{maint_records[0]['id']}/close",
        headers=manager_headers,
        json={
            "cost": 95.00,
            "description": "Panel repaired for general pool",
            "resolution": "Panel repaired and returned to inventory pool",
        },
    )
    assert close_resp.status_code == 200

    # Old asset becomes AVAILABLE for inventory reuse, employee keeps perm_replacement
    old_after = client.get(
        f"/api/v1/assets/{old_asset['id']}", headers=manager_headers
    ).json()
    perm_after = client.get(
        f"/api/v1/assets/{perm_replacement['id']}", headers=manager_headers
    ).json()
    assert old_after["status"] == "AVAILABLE"
    assert perm_after["status"] == "ASSIGNED"

