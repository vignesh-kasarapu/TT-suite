import base64
import logging
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.assets.models import Asset
from app.common.enums import AssetStatus
from app.common.excel import build_xlsx_bytes
from tests.test_schema_and_seed import assert_error_contract


def test_create_assets_sequential_tags_and_roles(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    # First asset created by ADMIN -> TEK-LPT-MP15-0001
    resp1 = client.post(
        "/api/v1/assets",
        headers=admin_headers,
        json={
            "name": "MacBook Pro 16 M4",
            "serial_no": "SN-MBP-1001",
            "service_tag": "SVC-MBP-1001",
            "asset_tag": "ATG-MBP-1001",
            "category_id": 1,
            "purchase_date": "2026-01-15",
            "cost": 2499.99,
            "location": "HQ - Floor 3",
        },
    )
    assert resp1.status_code == 200
    asset1 = resp1.json()
    assert asset1["tag"] == "TEK-LPT-MP15-0001"
    assert asset1["name"] == "MacBook Pro 16 M4"
    assert asset1["serial_no"] == "SN-MBP-1001"
    assert asset1["category_id"] == 1
    assert asset1["category_name"] == "Laptop"
    assert asset1["cost"] == 2499.99
    assert asset1["status"] == "AVAILABLE"
    assert asset1["version"] == 1

    # Second asset created by ASSET_MANAGER -> TEK-MON-DU2F-0002
    resp2 = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "Dell UltraSharp 27 4K",
            "serial_no": "SN-DELL-2002",
            "service_tag": "SVC-DELL-2002",
            "asset_tag": "ATG-DELL-2002",
            "category": "Monitor",
            "purchase_date": "2026-02-01",
            "cost": 649.50,
            "location": "HQ - Floor 2",
        },
    )
    assert resp2.status_code == 200
    asset2 = resp2.json()
    assert asset2["tag"] == "TEK-MON-DU2F-0002"
    assert asset2["category_name"] == "Monitor"
    assert asset2["status"] == "AVAILABLE"


def test_create_asset_duplicate_serial_no_returns_409(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    first = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "ThinkPad X1 Carbon",
            "serial_no": "SN-UNIQUE-001",
            "service_tag": "SVC-UNIQUE-001",
            "asset_tag": "ATG-UNIQUE-001",
            "category_id": 1,
            "purchase_date": "2026-01-20",
            "cost": 1850.00,
            "location": "NYC Office",
        },
    )
    assert first.status_code == 200

    duplicate = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "Another Laptop",
            "serial_no": "  sn-unique-001 ",
            "service_tag": "SVC-  sn-unique-001 ",
            "asset_tag": "ATG-  sn-unique-001 ",
            "category_id": 1,
            "purchase_date": "2026-02-20",
            "cost": 1900.00,
            "location": "Austin Office",
        },
    )
    assert duplicate.status_code == 409
    assert_error_contract(duplicate.json(), 409)
    assert "serial_no" in duplicate.json()["message"]


def test_create_asset_validation_and_missing_category_errors(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    # Negative cost and blank name -> 400
    bad_resp = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "   ",
            "serial_no": "SN-9000",
            "service_tag": "SVC-9000",
            "asset_tag": "ATG-9000",
            "category_id": 1,
            "purchase_date": "2026-01-10",
            "cost": -100,
            "location": "HQ",
        },
    )
    assert bad_resp.status_code == 400
    assert_error_contract(bad_resp.json(), 400)

    # Non-existent category_id -> 404
    not_found_cat = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "iPhone 16 Pro",
            "serial_no": "SN-IPH-9001",
            "service_tag": "SVC-IPH-9001",
            "asset_tag": "ATG-IPH-9001",
            "category_id": 9999,
            "purchase_date": "2026-01-10",
            "cost": 1199.00,
            "location": "HQ",
        },
    )
    assert not_found_cat.status_code == 404
    assert_error_contract(not_found_cat.json(), 404)


def test_list_assets_pagination_search_and_filters(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
) -> None:
    sample_assets = [
        {
            "name": "ThinkPad X1 Gen 12",
            "serial_no": "SN-TP-01",
            "service_tag": "SVC-TP-01",
            "asset_tag": "ATG-TP-01",
            "category_id": 1,
            "purchase_date": "2026-01-10",
            "cost": 1799.00,
            "location": "Berlin",
        },
        {
            "name": "LG Ergo Monitor 32",
            "serial_no": "SN-LG-02",
            "service_tag": "SVC-LG-02",
            "asset_tag": "ATG-LG-02",
            "category_id": 2,
            "purchase_date": "2026-01-12",
            "cost": 599.00,
            "location": "Berlin",
        },
        {
            "name": "Herman Miller Aeron Chair",
            "serial_no": "SN-HM-03",
            "service_tag": "SVC-HM-03",
            "asset_tag": "ATG-HM-03",
            "category_id": 4,
            "purchase_date": "2026-01-14",
            "cost": 1350.00,
            "location": "London",
        },
    ]
    created_ids = []
    for item in sample_assets:
        r = client.post("/api/v1/assets", headers=manager_headers, json=item)
        assert r.status_code == 200
        created_ids.append(r.json()["id"])

    # Retire the 3rd asset to test status filtering
    retire_r = client.patch(f"/api/v1/assets/{created_ids[2]}/retire", headers=manager_headers)
    assert retire_r.status_code == 200

    # Paginated list (page 1, size 2) sorted by id,asc
    page_resp = client.get(
        "/api/v1/assets?page=1&size=2&sort=id,asc",
        headers=manager_headers,
    )
    assert page_resp.status_code == 200
    page_data = page_resp.json()
    assert page_data["total"] == 3
    assert len(page_data["items"]) == 2
    assert page_data["pages"] == 2
    assert page_data["items"][0]["tag"] == "TEK-LPT-TX19-0001"

    # Search by tag
    tag_search = client.get("/api/v1/assets?search=TEK-MON-LE2D-0002", headers=manager_headers)
    assert tag_search.status_code == 200
    assert tag_search.json()["total"] == 1
    assert tag_search.json()["items"][0]["name"] == "LG Ergo Monitor 32"

    # Search by name
    name_search = client.get("/api/v1/assets?search=thinkpad", headers=manager_headers)
    assert name_search.status_code == 200
    assert name_search.json()["total"] == 1
    assert name_search.json()["items"][0]["tag"] == "TEK-LPT-TX19-0001"

    # Search by assigned employee name
    emp_users = client.get(
        "/api/v1/users?search=employee@tektalis.com", headers=admin_headers
    )
    assert emp_users.status_code == 200
    employee = emp_users.json()["items"][0]
    assign_target = client.post(
        f"/api/v1/assets/{created_ids[0]}/assign",
        headers=manager_headers,
        json={"user_id": employee["id"], "assigned_on": "2026-03-01"},
    )
    assert assign_target.status_code == 200, assign_target.text
    emp_search = client.get(
        f"/api/v1/assets?search={employee['name'].split()[0]}",
        headers=manager_headers,
    )
    assert emp_search.status_code == 200
    assert emp_search.json()["total"] >= 1
    assert any(
        item["id"] == created_ids[0] and item.get("assigned_to_name") == employee["name"]
        for item in emp_search.json()["items"]
    )

    # Filter by category name and category ID
    cat_name_filter = client.get("/api/v1/assets?category=Monitor", headers=manager_headers)
    assert cat_name_filter.status_code == 200
    assert cat_name_filter.json()["total"] == 1
    assert cat_name_filter.json()["items"][0]["serial_no"] == "SN-LG-02"

    cat_id_filter = client.get("/api/v1/assets?category=1", headers=manager_headers)
    assert cat_id_filter.status_code == 200
    assert cat_id_filter.json()["total"] == 1
    assert cat_id_filter.json()["items"][0]["serial_no"] == "SN-TP-01"

    # Filter by status
    retired_filter = client.get("/api/v1/assets?status=RETIRED", headers=manager_headers)
    assert retired_filter.status_code == 200
    assert retired_filter.json()["total"] == 1
    assert retired_filter.json()["items"][0]["tag"] == "TEK-FRN-HM4C-0003"


def test_get_and_update_asset_success_and_immutability_guards(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    create_resp = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "iPhone 16",
            "serial_no": "SN-IPH16-001",
            "service_tag": "SVC-IPH16-001",
            "asset_tag": "ATG-IPH16-001",
            "category_id": 3,
            "purchase_date": "2026-02-01",
            "cost": 999.00,
            "location": "Floor 1",
        },
    )
    assert create_resp.status_code == 200
    asset_id = create_resp.json()["id"]

    # GET by id
    get_resp = client.get(f"/api/v1/assets/{asset_id}", headers=manager_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["tag"] == "TEK-PHN-I13A-0001"

    # GET non-existent -> 404
    missing_resp = client.get("/api/v1/assets/99999", headers=manager_headers)
    assert missing_resp.status_code == 404
    assert_error_contract(missing_resp.json(), 404)

    # Valid PUT update -> 200 and increments version
    update_resp = client.put(
        f"/api/v1/assets/{asset_id}",
        headers=manager_headers,
        json={
            "name": "iPhone 16 Pro Max",
            "cost": 1199.00,
            "location": "Executive Suite",
        },
    )
    assert update_resp.status_code == 200
    updated = update_resp.json()
    assert updated["name"] == "iPhone 16 Pro Max"
    assert updated["cost"] == 1199.00
    assert updated["location"] == "Executive Suite"
    assert updated["version"] == 2

    # Attempt to edit immutable Asset ID (tag) -> 409 Conflict
    tag_edit_resp = client.put(
        f"/api/v1/assets/{asset_id}",
        headers=manager_headers,
        json={"tag": "AST-9999"},
    )
    assert tag_edit_resp.status_code == 409
    assert_error_contract(tag_edit_resp.json(), 409)
    assert "Asset ID" in tag_edit_resp.json()["message"]

    # serial_no, service_tag, and asset_tag are editable
    editable_resp = client.put(
        f"/api/v1/assets/{asset_id}",
        headers=manager_headers,
        json={
            "serial_no": "SN-TAMPERED-999",
            "service_tag": "SVC-EDITED-001",
            "asset_tag": "ATG-EDITED-001",
        },
    )
    assert editable_resp.status_code == 200
    edited = editable_resp.json()
    assert edited["serial_no"] == "SN-TAMPERED-999"
    assert edited["service_tag"] == "SVC-EDITED-001"
    assert edited["asset_tag"] == "ATG-EDITED-001"
    assert edited["tag"] == "TEK-PHN-I13A-0001"
    assert edited["version"] == 3


def test_retire_asset_audit_logging_and_retired_assigned_guards(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    create_resp = client.post(
        "/api/v1/assets",
        headers=admin_headers,
        json={
            "name": "Mac Studio M3 Ultra",
            "serial_no": "SN-MACSTUDIO-01",
            "service_tag": "SVC-MACSTUDIO-01",
            "asset_tag": "ATG-MACSTUDIO-01",
            "category_id": 1,
            "purchase_date": "2026-01-05",
            "cost": 3999.00,
            "location": "Media Lab",
        },
    )
    assert create_resp.status_code == 200
    asset_id = create_resp.json()["id"]

    # Retire the AVAILABLE asset and verify structured audit log
    with caplog.at_level(logging.INFO, logger="ams.audit"):
        retire_resp = client.patch(
            f"/api/v1/assets/{asset_id}/retire",
            headers=admin_headers,
        )
    assert retire_resp.status_code == 200
    retired_data = retire_resp.json()
    assert retired_data["status"] == "RETIRED"
    assert retired_data["version"] == 2

    # Check audit log contains action=retire, actor_user_id/user_id, asset_id, timestamp
    audit_messages = [rec.getMessage() for rec in caplog.records if rec.name == "ams.audit"]
    assert len(audit_messages) >= 1
    assert "action=retire" in audit_messages[-1]
    assert f"asset_id={asset_id}" in audit_messages[-1]
    assert "user_id=" in audit_messages[-1]
    assert "timestamp=" in audit_messages[-1]

    # Retiring an already RETIRED asset -> 409 Conflict
    retire_again = client.patch(
        f"/api/v1/assets/{asset_id}/retire",
        headers=admin_headers,
    )
    assert retire_again.status_code == 409
    assert_error_contract(retire_again.json(), 409)

    # Editing a RETIRED asset -> 409 Conflict
    edit_retired = client.put(
        f"/api/v1/assets/{asset_id}",
        headers=admin_headers,
        json={"name": "Cannot Edit Retired"},
    )
    assert edit_retired.status_code == 409
    assert_error_contract(edit_retired.json(), 409)
    assert "RETIRED" in edit_retired.json()["message"]

    # Create a second asset and set status to ASSIGNED in DB to verify ASSIGNED guards
    create_assigned = client.post(
        "/api/v1/assets",
        headers=admin_headers,
        json={
            "name": "Assigned Laptop",
            "serial_no": "SN-ASSIGNED-02",
            "service_tag": "SVC-ASSIGNED-02",
            "asset_tag": "ATG-ASSIGNED-02",
            "category_id": 1,
            "purchase_date": "2026-01-06",
            "cost": 1500.00,
            "location": "Floor 2",
        },
    )
    assert create_assigned.status_code == 200
    assigned_id = create_assigned.json()["id"]

    db_asset = db_session.scalar(select(Asset).where(Asset.id == assigned_id))
    assert db_asset is not None
    db_asset.status = AssetStatus.ASSIGNED
    db_session.commit()

    # Editing an ASSIGNED asset -> 409 Conflict
    edit_assigned = client.put(
        f"/api/v1/assets/{assigned_id}",
        headers=admin_headers,
        json={"location": "New Location"},
    )
    assert edit_assigned.status_code == 409
    assert_error_contract(edit_assigned.json(), 409)
    assert "ASSIGNED" in edit_assigned.json()["message"]

    # Retiring an ASSIGNED asset -> 409 Conflict
    retire_assigned = client.patch(
        f"/api/v1/assets/{assigned_id}/retire",
        headers=admin_headers,
    )
    assert retire_assigned.status_code == 409
    assert_error_contract(retire_assigned.json(), 409)
    assert "ASSIGNED" in retire_assigned.json()["message"]


def test_employee_forbidden_from_asset_management_endpoints(
    client: TestClient,
    employee_headers: dict[str, str],
) -> None:
    assert client.get("/api/v1/assets", headers=employee_headers).status_code == 403
    assert (
        client.post(
            "/api/v1/assets",
            headers=employee_headers,
            json={
                "name": "Unauthorized Asset",
                "serial_no": "SN-UNAUTH",
                "service_tag": "SVC-UNAUTH",
                "asset_tag": "ATG-UNAUTH",
                "category_id": 1,
                "purchase_date": "2026-01-01",
                "cost": 100.0,
                "location": "HQ",
            },
        ).status_code
        == 403
    )
    assert client.get("/api/v1/assets/1", headers=employee_headers).status_code == 403
    assert (
        client.put(
            "/api/v1/assets/1",
            headers=employee_headers,
            json={"name": "Nope"},
        ).status_code
        == 403
    )
    assert client.patch("/api/v1/assets/1/retire", headers=employee_headers).status_code == 403


def test_alphanumeric_hex_tag_sequence_rollover_to_000a_and_000f(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    """Verify that the 10th to 15th assets generate hexadecimal sequence suffixes 000A..000F."""
    created_tags: list[str] = []
    for idx in range(1, 16):
        resp = client.post(
            "/api/v1/assets",
            headers=admin_headers,
            json={
                "name": "MacBook Pro 16 M4",
                "serial_no": f"SN-HEX-{idx:04d}",
                "service_tag": f"SVC-HEX-{idx:04d}",
                "asset_tag": f"ATG-HEX-{idx:04d}",
                "category_id": 1,
                "purchase_date": "2026-01-15",
                "cost": 2499.99,
                "location": "HQ - Floor 3",
            },
        )
        assert resp.status_code == 200
        created_tags.append(resp.json()["tag"])

    assert created_tags[0] == "TEK-LPT-MP15-0001"
    assert created_tags[9] == "TEK-LPT-MP15-000A"
    assert created_tags[14] == "TEK-LPT-MP15-000F"


def test_bulk_import_assets_excel_and_csv_auto_category_auto_assign_and_partial_success(
    client: TestClient,
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    # 1. Verify Excel (.xlsx) template download endpoint
    tpl_resp = client.get("/api/v1/assets/import/template", headers=manager_headers)
    assert tpl_resp.status_code == 200
    assert (
        tpl_resp.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "tektalis_assets_import_template.xlsx" in tpl_resp.headers["content-disposition"]
    assert tpl_resp.content[:2] == b"PK"

    # 2. Build an Excel (.xlsx) workbook with 4 rows (including Excel serial date 46096 -> 2026-03-15)
    xlsx_bytes = build_xlsx_bytes(
        headers=[
            "name",
            "serial_no",
            "service_tag",
            "asset_tag",
            "category",
            "purchase_date",
            "cost",
            "location",
            "assigned_to_email",
        ],
        rows=[
            [
                "MacBook Pro 16 M4",
                "SN-BULK-001",
                "SVC-BULK-001",
                "ATG-BULK-001",
                "Laptop",
                "46096",
                "195000.00",
                "Hyderabad - Floor 14",
                "employee@tektalis.com",
            ],
            [
                "CalDigit TS4 Dock",
                "SN-BULK-002",
                "SVC-BULK-002",
                "ATG-BULK-002",
                "Docking Station",
                "2026-03-20",
                "32000.00",
                "Bengaluru - Floor 5",
                "",
            ],
            [
                "Duplicate Serial Laptop",
                "SN-BULK-001",
                "SVC-BULK-DUP",
                "ATG-BULK-DUP",
                "Laptop",
                "2026-03-21",
                "150000.00",
                "Hyderabad - Floor 14",
                "",
            ],
            [
                "Unassignable Monitor",
                "SN-BULK-003",
                "SVC-BULK-003",
                "ATG-BULK-003",
                "Monitor",
                "2026-03-22",
                "45000.00",
                "Pune Office",
                "ghost@tektalis.com",
            ],
        ],
        sheet_name="AssetsImport",
    )
    b64_xlsx = base64.b64encode(xlsx_bytes).decode("ascii")

    resp = client.post(
        "/api/v1/assets/import",
        headers=manager_headers,
        json={"excel_base64": b64_xlsx},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_rows"] == 4
    assert data["imported_count"] == 2
    assert data["skipped_count"] == 2
    assert data["created_categories"] == ["Docking Station"]

    imported = data["imported_items"]
    assert len(imported) == 2
    assert imported[0]["serial_no"] == "SN-BULK-001"
    assert imported[0]["tag"].startswith("TEK-LPT-")
    assert imported[0]["status"] == "ASSIGNED"
    assert imported[0]["purchase_date"] == "2026-03-15"

    assert imported[1]["serial_no"] == "SN-BULK-002"
    assert imported[1]["category_name"] == "Docking Station"
    assert imported[1]["status"] == "AVAILABLE"
    assert imported[1]["tag"].startswith("TEK-")

    # Verify errors for rows 4 and 5
    assert len(data["errors"]) == 2
    assert data["errors"][0]["row"] == 4
    assert "already exists" in data["errors"][0]["message"]
    assert data["errors"][1]["row"] == 5
    assert "not found" in data["errors"][1]["message"]

    # Verify employee@tektalis.com actually holds SN-BULK-001
    my_assets_resp = client.get("/api/v1/me/assets", headers=employee_headers)
    assert my_assets_resp.status_code == 200
    held_serials = [a["serial_no"] for a in my_assets_resp.json()]
    assert "SN-BULK-001" in held_serials

    # Missing required headers -> 400 Bad Request
    bad_header_resp = client.post(
        "/api/v1/assets/import",
        headers=manager_headers,
        json={"csv_content": "name,serial_no\nTest Asset,SN-ONLY\n"},
    )
    assert bad_header_resp.status_code == 400
    assert_error_contract(bad_header_resp.json(), 400)

    # RBAC: EMPLOYEE forbidden (403) and unauthenticated (401)
    assert (
        client.post(
            "/api/v1/assets/import",
            headers=employee_headers,
            json={"excel_base64": b64_xlsx},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/assets/import",
            json={"excel_base64": b64_xlsx},
        ).status_code
        == 401
    )


