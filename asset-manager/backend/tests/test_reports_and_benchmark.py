import csv
from datetime import date
from decimal import Decimal
import io
import time
from fastapi.testclient import TestClient
from sqlalchemy import insert
from sqlalchemy.orm import Session

from app.assets.models import Asset
from app.categories.models import Category
from app.common.enums import AssetStatus
from app.users.models import User


def _seed_sample_lifecycle_assets(
    client: TestClient,
    manager_headers: dict[str, str],
    db_session: Session,
) -> dict[str, int]:
    """Create 4 assets across statuses (AVAILABLE, ASSIGNED, IN_MAINTENANCE, RETIRED)."""
    employee = db_session.query(User).filter(User.email == "employee@tektalis.com").one()
    laptop_cat = db_session.query(Category).filter(Category.name == "Laptop").one()
    monitor_cat = db_session.query(Category).filter(Category.name == "Monitor").one()
    phone_cat = db_session.query(Category).filter(Category.name == "Phone").one()
    furniture_cat = db_session.query(Category).filter(Category.name == "Furniture").one()

    # 1. AVAILABLE Laptop ($1500)
    r1 = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "ThinkPad X1 Carbon",
            "serial_no": "SN-REP-001",
            "service_tag": "SVC-REP-001",
            "asset_tag": "ATG-REP-001",
            "category_id": laptop_cat.id,
            "purchase_date": "2026-01-10",
            "cost": 1500.00,
            "location": "HQ Vault",
        },
    )
    assert r1.status_code in (200, 201)
    a1_id = r1.json()["id"]

    # 2. ASSIGNED Monitor ($500)
    r2 = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "Dell UltraSharp 27",
            "serial_no": "SN-REP-002",
            "service_tag": "SVC-REP-002",
            "asset_tag": "ATG-REP-002",
            "category_id": monitor_cat.id,
            "purchase_date": "2026-01-15",
            "cost": 500.00,
            "location": "Floor 2",
        },
    )
    assert r2.status_code in (200, 201)
    a2_id = r2.json()["id"]
    assign_res = client.post(
        f"/api/v1/assets/{a2_id}/assign",
        headers=manager_headers,
        json={"user_id": employee.id, "assigned_on": "2026-02-01"},
    )
    assert assign_res.status_code == 200

    # 3. IN_MAINTENANCE Phone ($900)
    r3 = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "iPhone 16 Pro",
            "serial_no": "SN-REP-003",
            "service_tag": "SVC-REP-003",
            "asset_tag": "ATG-REP-003",
            "category_id": phone_cat.id,
            "purchase_date": "2026-01-20",
            "cost": 900.00,
            "location": "Repair Lab",
        },
    )
    assert r3.status_code in (200, 201)
    a3_id = r3.json()["id"]
    maint_res = client.post(
        f"/api/v1/assets/{a3_id}/maintenance",
        headers=manager_headers,
        json={"description": "Battery calibration", "opened_on": "2026-02-05", "cost": 79.00},
    )
    assert maint_res.status_code in (200, 201)

    # 4. RETIRED Furniture ($400)
    r4 = client.post(
        "/api/v1/assets",
        headers=manager_headers,
        json={
            "name": "Herman Miller Aeron",
            "serial_no": "SN-REP-004",
            "service_tag": "SVC-REP-004",
            "asset_tag": "ATG-REP-004",
            "category_id": furniture_cat.id,
            "purchase_date": "2025-06-01",
            "cost": 400.00,
            "location": "Warehouse B",
        },
    )
    assert r4.status_code in (200, 201)
    a4_id = r4.json()["id"]
    retire_res = client.patch(f"/api/v1/assets/{a4_id}/retire", headers=manager_headers)
    assert retire_res.status_code == 200

    return {"a1": a1_id, "a2": a2_id, "a3": a3_id, "a4": a4_id}


def test_reports_summary_counts_by_status_and_category(
    client: TestClient,
    manager_headers: dict[str, str],
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    _seed_sample_lifecycle_assets(client, manager_headers, db_session)

    res = client.get("/api/v1/reports/summary", headers=manager_headers)
    assert res.status_code == 200
    body = res.json()

    assert body["total_assets"] == 4
    assert body["total_value"] == 3300.0
    assert body["by_status"] == {
        "AVAILABLE": 1,
        "ASSIGNED": 1,
        "IN_MAINTENANCE": 1,
        "RETIRED": 1,
    }
    assert body["by_category"] == {
        "Laptop": 1,
        "Monitor": 1,
        "Phone": 1,
        "Furniture": 1,
    }
    assert len(body["category_breakdown"]) == 4

    # Verify ADMIN also has access
    admin_res = client.get("/api/v1/reports/summary", headers=admin_headers)
    assert admin_res.status_code == 200


def test_reports_rbac_blocks_unauthenticated_and_employee(
    client: TestClient,
    employee_headers: dict[str, str],
) -> None:
    unauth_summary = client.get("/api/v1/reports/summary")
    assert unauth_summary.status_code == 401
    assert unauth_summary.json()["status"] == 401

    emp_summary = client.get("/api/v1/reports/summary", headers=employee_headers)
    assert emp_summary.status_code == 403
    assert emp_summary.json()["status"] == 403

    unauth_csv = client.get("/api/v1/reports/assets.csv")
    assert unauth_csv.status_code == 401

    emp_csv = client.get("/api/v1/reports/assets.csv", headers=employee_headers)
    assert emp_csv.status_code == 403

    unauth_pdf = client.get("/api/v1/reports/assets.pdf")
    assert unauth_pdf.status_code == 401

    emp_pdf = client.get("/api/v1/reports/assets.pdf", headers=employee_headers)
    assert emp_pdf.status_code == 403


def test_reports_assets_csv_streaming_export_and_filters(
    client: TestClient,
    manager_headers: dict[str, str],
    db_session: Session,
) -> None:
    _seed_sample_lifecycle_assets(client, manager_headers, db_session)

    res = client.get("/api/v1/reports/assets.csv", headers=manager_headers)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert 'filename="assets_report.csv"' in res.headers.get("content-disposition", "")

    reader = csv.DictReader(io.StringIO(res.text))
    rows = list(reader)
    assert len(rows) == 4
    assert reader.fieldnames == [
        "id",
        "tag",
        "name",
        "serial_no",
        "service_tag",
        "asset_tag",
        "category_id",
        "category",
        "status",
        "location",
        "purchase_date",
        "cost",
        "assigned_to_name",
        "assigned_to_email",
        "awaiting_employee_details",
        "version",
        "created_at",
    ]

    assigned_row = next(r for r in rows if r["status"] == "ASSIGNED")
    assert assigned_row["name"] == "Dell UltraSharp 27"
    assert assigned_row["assigned_to_email"] == "employee@tektalis.com"

    # Filtered CSV export by status
    filtered_res = client.get(
        "/api/v1/reports/assets.csv?status=IN_MAINTENANCE",
        headers=manager_headers,
    )
    assert filtered_res.status_code == 200
    filtered_rows = list(csv.DictReader(io.StringIO(filtered_res.text)))
    assert len(filtered_rows) == 1
    assert filtered_rows[0]["name"] == "iPhone 16 Pro"


def test_reports_assets_pdf_export_includes_full_details(
    client: TestClient,
    manager_headers: dict[str, str],
    db_session: Session,
) -> None:
    _seed_sample_lifecycle_assets(client, manager_headers, db_session)

    res = client.get("/api/v1/reports/assets.pdf", headers=manager_headers)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/pdf")
    assert 'filename="assets_report.pdf"' in res.headers.get("content-disposition", "")
    assert res.content[:4] == b"%PDF"
    assert len(res.content) > 200

    filtered = client.get(
        "/api/v1/reports/assets.pdf?status=RETIRED",
        headers=manager_headers,
    )
    assert filtered.status_code == 200
    assert filtered.content[:4] == b"%PDF"


def test_benchmark_10000_assets_list_and_search_under_1_second(
    client: TestClient,
    manager_headers: dict[str, str],
    db_session: Session,
) -> None:
    """Verify NFR performance requirement: listing and searching 10,000 assets executes in < 1 second."""
    categories = db_session.query(Category).order_by(Category.id.asc()).all()
    cat_ids = [c.id for c in categories]
    statuses = [
        AssetStatus.AVAILABLE,
        AssetStatus.ASSIGNED,
        AssetStatus.IN_MAINTENANCE,
        AssetStatus.RETIRED,
    ]

    purchase_dt = date(2026, 1, 15)
    cost_val = Decimal("1250.00")

    bulk_rows = [
        {
            "tag": f"AST-{i:04d}",
            "name": f"Enterprise Workstation {i}",
            "serial_no": f"SN-BENCH-{i:05d}",
            "service_tag": f"SVC-BENCH-{i:05d}",
            "asset_tag": f"ATG-BENCH-{i:05d}",
            "category_id": cat_ids[i % len(cat_ids)],
            "purchase_date": purchase_dt,
            "cost": cost_val,
            "location": f"Floor {(i % 5) + 1}",
            "status": statuses[i % len(statuses)],
            "version": 1,
        }
        for i in range(1, 10001)
    ]
    db_session.execute(insert(Asset), bulk_rows)
    db_session.commit()

    # 1. Paginated listing across 10,000 assets
    t0 = time.perf_counter()
    list_res = client.get(
        "/api/v1/assets?page=1&size=20&sort=id,asc",
        headers=manager_headers,
    )
    list_elapsed = time.perf_counter() - t0
    assert list_res.status_code == 200
    list_body = list_res.json()
    assert list_body["total"] == 10000
    assert len(list_body["items"]) == 20
    assert list_elapsed < 1.0, f"Paginated list took {list_elapsed:.3f}s (expected < 1.0s)"

    # 2. Search by tag across 10,000 assets
    t1 = time.perf_counter()
    tag_search_res = client.get(
        "/api/v1/assets?search=AST-9999&page=1&size=20",
        headers=manager_headers,
    )
    tag_search_elapsed = time.perf_counter() - t1
    assert tag_search_res.status_code == 200
    tag_search_body = tag_search_res.json()
    assert tag_search_body["total"] == 1
    assert tag_search_body["items"][0]["tag"] == "AST-9999"
    assert tag_search_elapsed < 1.0, f"Tag search took {tag_search_elapsed:.3f}s (expected < 1.0s)"

    # 3. Combined search by name + category + status filter across 10,000 assets
    t2 = time.perf_counter()
    filtered_search_res = client.get(
        f"/api/v1/assets?search=Workstation%205432&category_id={cat_ids[5432 % len(cat_ids)]}&status={statuses[5432 % len(statuses)].value}",
        headers=manager_headers,
    )
    filtered_search_elapsed = time.perf_counter() - t2
    assert filtered_search_res.status_code == 200
    assert filtered_search_res.json()["total"] == 1
    assert (
        filtered_search_elapsed < 1.0
    ), f"Combined filtered search took {filtered_search_elapsed:.3f}s (expected < 1.0s)"

    # 4. Executive Summary aggregation across 10,000 assets
    t3 = time.perf_counter()
    summary_res = client.get("/api/v1/reports/summary", headers=manager_headers)
    summary_elapsed = time.perf_counter() - t3
    assert summary_res.status_code == 200
    assert summary_res.json()["total_assets"] == 10000
    assert summary_elapsed < 1.0, f"Reports summary took {summary_elapsed:.3f}s (expected < 1.0s)"
