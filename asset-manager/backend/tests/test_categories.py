from fastapi.testclient import TestClient

from tests.test_schema_and_seed import assert_error_contract


def test_list_categories_allowed_for_all_authenticated_roles(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    for headers in (admin_headers, manager_headers, employee_headers):
        resp = client.get("/api/v1/categories", headers=headers)
        assert resp.status_code == 200
        categories = resp.json()
        assert len(categories) == 4
        names = [c["name"] for c in categories]
        assert names == ["Laptop", "Monitor", "Phone", "Furniture"]


def test_list_categories_unauthenticated_returns_401(client: TestClient) -> None:
    resp = client.get("/api/v1/categories")
    assert resp.status_code == 401
    assert_error_contract(resp.json(), 401)


def test_create_category_success_admin(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    resp = client.post(
        "/api/v1/categories",
        headers=admin_headers,
        json={"name": "Docking Station"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Docking Station"
    assert isinstance(data["id"], int)
    assert "created_at" in data


def test_create_category_duplicate_returns_409(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    resp = client.post(
        "/api/v1/categories",
        headers=admin_headers,
        json={"name": "  laptop "},
    )
    assert resp.status_code == 409
    assert_error_contract(resp.json(), 409)
    assert "already exists" in resp.json()["message"]


def test_create_category_blank_name_returns_400(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    resp = client.post(
        "/api/v1/categories",
        headers=admin_headers,
        json={"name": "   "},
    )
    assert resp.status_code == 400
    assert_error_contract(resp.json(), 400)


def test_create_category_forbidden_for_non_admin(
    client: TestClient,
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    for headers in (manager_headers, employee_headers):
        resp = client.post(
            "/api/v1/categories",
            headers=headers,
            json={"name": "Headset"},
        )
        assert resp.status_code == 403
        assert_error_contract(resp.json(), 403)


def test_admin_updates_and_deletes_empty_category(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    created = client.post(
        "/api/v1/categories",
        headers=admin_headers,
        json={"name": "Temporary Gear"},
    )
    assert created.status_code == 200, created.text
    cat_id = created.json()["id"]

    renamed = client.patch(
        f"/api/v1/categories/{cat_id}",
        headers=admin_headers,
        json={"name": "Field Kit"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Field Kit"

    mgr_denied = client.patch(
        f"/api/v1/categories/{cat_id}",
        headers=manager_headers,
        json={"name": "Nope"},
    )
    assert mgr_denied.status_code == 403
    assert_error_contract(mgr_denied.json(), 403)

    deleted = client.delete(
        f"/api/v1/categories/{cat_id}",
        headers=admin_headers,
    )
    assert deleted.status_code == 204

    listed = client.get("/api/v1/categories", headers=admin_headers)
    assert listed.status_code == 200
    assert all(c["id"] != cat_id for c in listed.json())


def test_delete_category_with_assets_returns_409(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    asset = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "Stock Phone",
            "serial_no": "SN-CAT-DEL-001",
            "category_id": 3,
            "purchase_date": "2026-01-01",
            "cost": 500,
            "location": "HQ",
        },
    )
    assert asset.status_code == 200, asset.text

    delete = client.delete("/api/v1/categories/3", headers=admin_headers)
    assert delete.status_code == 409
    assert_error_contract(delete.json(), 409)
