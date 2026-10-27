from fastapi.testclient import TestClient

from tests.test_schema_and_seed import assert_error_contract


def _create_request_payload(**overrides: object) -> dict:
    payload: dict = {
        "category_id": 1,
        "is_other": False,
        "reason": "Need a laptop for development work",
    }
    payload.update(overrides)
    return payload


def test_employee_creates_and_lists_own_asset_request(
    client: TestClient,
    employee_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    create_resp = client.post(
        "/api/v1/asset-requests",
        headers=employee_headers,
        json=_create_request_payload(),
    )
    assert create_resp.status_code == 200, create_resp.text
    created = create_resp.json()
    assert created["status"] == "PENDING"
    assert created["name"] == "Laptop"
    assert created["category_id"] == 1
    assert created["is_other"] is False
    assert created["reason"] == "Need a laptop for development work"
    assert created["serial_no"] is None
    assert created["requester_email"] == "employee@tektalis.com"

    mine = client.get("/api/v1/asset-requests", headers=employee_headers)
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    assert mine.json()[0]["id"] == created["id"]

    all_reqs = client.get("/api/v1/asset-requests", headers=manager_headers)
    assert all_reqs.status_code == 200
    assert any(r["id"] == created["id"] for r in all_reqs.json())


def test_employee_other_catalogue_request_requires_what_and_why(
    client: TestClient,
    employee_headers: dict[str, str],
) -> None:
    missing = client.post(
        "/api/v1/asset-requests",
        headers=employee_headers,
        json=_create_request_payload(
            is_other=True,
            category_id=None,
            other_category_name=None,
            reason="",
        ),
    )
    assert missing.status_code in (400, 422)

    ok = client.post(
        "/api/v1/asset-requests",
        headers=employee_headers,
        json=_create_request_payload(
            is_other=True,
            category_id=None,
            other_category_name="Drone Kit",
            reason="Field survey kit not in catalogue",
        ),
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["is_other"] is True
    assert body["other_category_name"] == "Drone Kit"
    assert "Field survey" in body["reason"]
    assert body["category_id"] is None


def test_available_assets_empty_then_approve_without_assign(
    client: TestClient,
    employee_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    created = client.post(
        "/api/v1/asset-requests",
        headers=employee_headers,
        json=_create_request_payload(reason="Need Dell Latitude for QA"),
    ).json()

    stock = client.get(
        f"/api/v1/asset-requests/{created['id']}/available-assets",
        headers=manager_headers,
    )
    assert stock.status_code == 200, stock.text
    assert stock.json()["has_available"] is False
    assert stock.json()["items"] == []
    assert stock.json()["category_id"] == 1

    before_assets = client.get("/api/v1/me/assets", headers=employee_headers)
    assert before_assets.status_code == 200
    before_ids = {a["id"] for a in before_assets.json()}

    approve = client.patch(
        f"/api/v1/asset-requests/{created['id']}/approve",
        headers=manager_headers,
        json={"comment": "No stock — employee will register later"},
    )
    assert approve.status_code == 200, approve.text
    approved = approve.json()
    assert approved["status"] == "APPROVED"
    assert approved["created_asset_id"] is None
    assert approved["created_asset_tag"] is None
    assert approved["requires_employee_register"] is False
    assert approved["decider_email"] == "manager@tektalis.com"
    assert approved["category_id"] == 1

    after_assets = client.get("/api/v1/me/assets", headers=employee_headers)
    assert after_assets.status_code == 200
    after_ids = {a["id"] for a in after_assets.json()}
    assert after_ids == before_ids

    again = client.patch(
        f"/api/v1/asset-requests/{created['id']}/approve",
        headers=manager_headers,
        json={},
    )
    assert again.status_code == 409
    assert_error_contract(again.json(), 409)


def test_approve_assigns_available_asset_when_stock_exists(
    client: TestClient,
    employee_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    created = client.post(
        "/api/v1/asset-requests",
        headers=employee_headers,
        json=_create_request_payload(reason="Need a spare laptop from stock"),
    ).json()

    asset = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "Stock Latitude 5540",
            "serial_no": "SN-STOCK-APPROVE-001",
            "category_id": 1,
            "purchase_date": "2026-01-10",
            "cost": 1100.00,
            "location": "Store Room",
        },
    )
    assert asset.status_code == 200, asset.text
    asset_id = asset.json()["id"]
    asset_tag = asset.json()["tag"]

    stock = client.get(
        f"/api/v1/asset-requests/{created['id']}/available-assets",
        headers=manager_headers,
    )
    assert stock.status_code == 200
    assert stock.json()["has_available"] is True
    assert any(i["id"] == asset_id for i in stock.json()["items"])

    missing = client.patch(
        f"/api/v1/asset-requests/{created['id']}/approve",
        headers=manager_headers,
        json={"requires_employee_register": True},
    )
    assert missing.status_code == 409
    assert_error_contract(missing.json(), 409)

    approve = client.patch(
        f"/api/v1/asset-requests/{created['id']}/approve",
        headers=manager_headers,
        json={"asset_id": asset_id, "comment": "Assigned from stock"},
    )
    assert approve.status_code == 200, approve.text
    approved = approve.json()
    assert approved["status"] == "APPROVED"
    assert approved["created_asset_id"] == asset_id
    assert approved["created_asset_tag"] == asset_tag
    assert approved["requires_employee_register"] is False

    me = client.get("/api/v1/me/assets", headers=employee_headers)
    assert me.status_code == 200
    assert any(a["id"] == asset_id and a["status"] == "ASSIGNED" for a in me.json())


def test_approve_with_employee_register_flag_clears_after_register(
    client: TestClient,
    employee_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    created = client.post(
        "/api/v1/asset-requests",
        headers=employee_headers,
        json=_create_request_payload(reason="Need monitor for WFH desk"),
    ).json()

    approve = client.patch(
        f"/api/v1/asset-requests/{created['id']}/approve",
        headers=manager_headers,
        json={"requires_employee_register": True, "comment": "Please register SN"},
    )
    assert approve.status_code == 200, approve.text
    assert approve.json()["status"] == "APPROVED"
    assert approve.json()["requires_employee_register"] is True

    listed = client.get(
        "/api/v1/asset-requests",
        headers=employee_headers,
        params={"status": "APPROVED"},
    )
    assert listed.status_code == 200
    match = next(r for r in listed.json() if r["id"] == created["id"])
    assert match["requires_employee_register"] is True

    register = client.post(
        "/api/v1/me/assets",
        headers=employee_headers,
        json={
            "name": "Dell UltraSharp 27",
            "serial_no": "SN-EMP-FILL-FLAG-001",
            "category_id": 1,
            "purchase_date": "2026-04-01",
            "cost": 450.00,
            "location": "Home Office",
        },
    )
    assert register.status_code == 200, register.text

    after = client.get(
        "/api/v1/asset-requests",
        headers=employee_headers,
        params={"status": "APPROVED"},
    )
    assert after.status_code == 200
    cleared = next(r for r in after.json() if r["id"] == created["id"])
    assert cleared["requires_employee_register"] is False


def test_employee_registers_asset_creates_and_self_assigns(
    client: TestClient,
    employee_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    register = client.post(
        "/api/v1/me/assets",
        headers=employee_headers,
        json={
            "name": "Dell Latitude 5550",
            "serial_no": "SN-EMP-REG-001",
            "service_tag": "SVC-EMP-REG-001",
            "asset_tag": "ATG-EMP-REG-001",
            "category_id": 1,
            "purchase_date": "2026-03-01",
            "cost": 1299.50,
            "location": "HQ - Floor 2",
        },
    )
    assert register.status_code == 200, register.text
    body = register.json()
    assert body["name"] == "Dell Latitude 5550"
    assert body["serial_no"] == "SN-EMP-REG-001"
    assert body["status"] == "ASSIGNED"
    assert body["awaiting_employee_details"] is False
    assert body["user_email"] == "employee@tektalis.com"

    me_assets = client.get("/api/v1/me/assets", headers=employee_headers)
    assert me_assets.status_code == 200
    assert any(a["id"] == body["id"] for a in me_assets.json())

    registry = client.get(
        "/api/v1/assets",
        headers=manager_headers,
        params={"search": "SN-EMP-REG-001"},
    )
    assert registry.status_code == 200
    items = registry.json()["items"]
    assert any(a["id"] == body["id"] and a["status"] == "ASSIGNED" for a in items)

    dup = client.post(
        "/api/v1/me/assets",
        headers=employee_headers,
        json={
            "name": "Duplicate Serial",
            "serial_no": "SN-EMP-REG-001",
            "category_id": 1,
            "purchase_date": "2026-03-01",
            "cost": 100,
            "location": "HQ",
        },
    )
    assert dup.status_code == 409
    assert_error_contract(dup.json(), 409)

    mgr_reg = client.post(
        "/api/v1/me/assets",
        headers=manager_headers,
        json={
            "name": "Manager Should Fail",
            "serial_no": "SN-MGR-REG-001",
            "category_id": 1,
            "purchase_date": "2026-03-01",
            "cost": 100,
            "location": "HQ",
        },
    )
    assert mgr_reg.status_code == 403
    assert_error_contract(mgr_reg.json(), 403)


def test_admin_approves_other_request_creates_category(
    client: TestClient,
    employee_headers: dict[str, str],
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    created = client.post(
        "/api/v1/asset-requests",
        headers=employee_headers,
        json=_create_request_payload(
            is_other=True,
            category_id=None,
            other_category_name="Survey Drone",
            reason="Needed for site inspection",
        ),
    ).json()

    approve = client.patch(
        f"/api/v1/asset-requests/{created['id']}/approve",
        headers=admin_headers,
        json={},
    )
    assert approve.status_code == 200, approve.text
    assert approve.json()["status"] == "APPROVED"
    assert approve.json()["category_id"] is not None
    assert approve.json()["created_asset_id"] is None

    cats = client.get("/api/v1/categories", headers=manager_headers)
    assert cats.status_code == 200
    names = {c["name"] for c in cats.json()}
    assert "Survey Drone" in names


def test_admin_rejects_asset_request(
    client: TestClient,
    employee_headers: dict[str, str],
    admin_headers: dict[str, str],
) -> None:
    created = client.post(
        "/api/v1/asset-requests",
        headers=employee_headers,
        json=_create_request_payload(reason="Need spare monitor"),
    ).json()

    missing_comment = client.patch(
        f"/api/v1/asset-requests/{created['id']}/reject",
        headers=admin_headers,
        json={},
    )
    assert missing_comment.status_code in (400, 422)

    reject = client.patch(
        f"/api/v1/asset-requests/{created['id']}/reject",
        headers=admin_headers,
        json={"comment": "Not in budget this quarter"},
    )
    assert reject.status_code == 200, reject.text
    assert reject.json()["status"] == "REJECTED"
    assert "budget" in reject.json()["decision_comment"]


def test_employee_cannot_approve_and_manager_cannot_create_request(
    client: TestClient,
    employee_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    created = client.post(
        "/api/v1/asset-requests",
        headers=employee_headers,
        json=_create_request_payload(reason="Need phone"),
    ).json()

    emp_approve = client.patch(
        f"/api/v1/asset-requests/{created['id']}/approve",
        headers=employee_headers,
        json={},
    )
    assert emp_approve.status_code == 403
    assert_error_contract(emp_approve.json(), 403)

    mgr_create = client.post(
        "/api/v1/asset-requests",
        headers=manager_headers,
        json=_create_request_payload(reason="Manager should not create"),
    )
    assert mgr_create.status_code == 403
    assert_error_contract(mgr_create.json(), 403)
