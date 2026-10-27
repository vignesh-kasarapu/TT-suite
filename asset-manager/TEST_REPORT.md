# Asset Management System (AMS) — Live Test & HITL Review Report

## Sprints Completed (All 5 Sprints Verified):
- **Sprint 1:** Foundation, Authentication & User Management (`FR-1`, `FR-2`)
- **Sprint 2:** Categories & Asset Register (`FR-3`, `FR-4`, `FR-5`, `FR-6`)
- **Sprint 3:** Assignments, Returns, Maintenance Log, History & Offboarding (`FR-7`, `FR-8`, `FR-9`, `FR-10`, `FR-11`, `FR-13`, `FR-14`)
- **Sprint 4:** Replacement Engine (`FR-15`, `FR-16`, `FR-17`, `FR-18`)
- **Sprint 5:** Executive Reporting, Streaming CSV Export & 10,000-Asset Performance Benchmark (`FR-12`)

---

## 1. Quick Start & Environment URLs

### Start Full Stack via Docker Compose
```bash
docker-compose up --build
```

| Service | URL | Description |
| :--- | :--- | :--- |
| **Frontend UI (Tektalis White Theme)** | `http://localhost:5173` | React 18 + Vite + TypeScript + Tailwind CSS |
| **Backend API Base URL** | `http://localhost:8000/api/v1` | FastAPI + SQLAlchemy 2.0 + PostgreSQL 17 |
| **Swagger UI (Interactive Docs)** | `http://localhost:8000/docs` | OpenAPI 3.1 specification & Try-It-Out |
| **Health Check** | `http://localhost:8000/health` | Service status check |
| **PostgreSQL 17 Database** | `localhost:5432` | `ams_db` (`ams_user` / `ams_password`) |

---

## 2. Default Seeded Accounts & Categories

Executed automatically via Alembic migration (`0001_initial_schema`) and startup verification (`app.common.seed`):

### Seeded Users
| Role | Email | Password | Capabilities Across Sprints 1–5 |
| :--- | :--- | :--- | :--- |
| `ADMIN` | `admin@tektalis.com` | `Admin@123` | Full access to `/users`, `/categories`, `/assets`, `/asset-requests`, `/maintenance`, `/offboarding`, `/replacements`, `/reports`, `/me/assets`, `/profile` |
| `ASSET_MANAGER` | `manager@tektalis.com` | `Manager@123` | Access to `/categories` (`GET`), `/assets`, `/asset-requests` (approve/reject), assign/return/history, `/maintenance`, `/replacements`, `/reports`, `/users/{id}/assets`, `/users/directory`, `/me/assets`, `/profile` |
| `EMPLOYEE` | `employee@tektalis.com` | `Employee@123` | Access to `/me/assets`, `/asset-requests` (own create/list), `/replacement-requests` (own requests), `/categories` (`GET`), `/dashboard`, `/profile`; `403` on management & report endpoints |

### Seeded Categories
1. `Laptop` (`id: 1`)
2. `Monitor` (`id: 2`)
3. `Phone` (`id: 3`)
4. `Furniture` (`id: 4`)

---

## 3. Running Automated Test Suites

### Backend (`pytest` + `httpx` `TestClient`)
```bash
docker exec ams-backend pytest -v
```
- **Result:** `49 passed` (100% pass rate)
- **Status Codes Covered:** `200 OK`, `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `409 Conflict`

| Test File | Test Case | Status Code / Invariant Verified |
| :--- | :--- | :--- |
| `tests/test_schema_and_seed.py` | `test_all_six_tables_created` | Verifies `ams_users`, `ams_categories`, `ams_assets`, `ams_assignments`, `ams_maintenance_records`, `ams_replacement_requests`, `ams_asset_requests` |
| `tests/test_schema_and_seed.py` | `test_default_seed_users_and_categories` | Verifies 3 default users (`ADMIN`, `ASSET_MANAGER`, `EMPLOYEE`) and 4 default categories |
| `tests/test_schema_and_seed.py` | `test_partial_unique_index_on_open_assignments` | Verifies `uq_assignments_open_asset` partial unique index (`WHERE returned_on IS NULL`) |
| `tests/test_schema_and_seed.py` | `test_alembic_migration_upgrade_and_downgrade` | Verifies `alembic upgrade head` and `alembic downgrade base` |
| `tests/test_auth.py` | `test_login_success_admin` | `200 OK` — JWT issued with BCrypt password verification (`FR-1`) |
| `tests/test_auth.py` | `test_login_case_insensitive_email` | `200 OK` — Normalizes email whitespace and casing |
| `tests/test_auth.py` | `test_login_wrong_password_returns_401` | `401 Unauthorized` — Standardized error payload |
| `tests/test_auth.py` | `test_login_unknown_email_returns_401` | `401 Unauthorized` — Standardized error payload |
| `tests/test_auth.py` | `test_login_validation_error_returns_400` | `400 Bad Request` — Invalid email / blank password |
| `tests/test_auth.py` | `test_get_me_authenticated_and_unauthenticated` | `200 OK` with valid JWT; `401 Unauthorized` without/invalid token |
| `tests/test_auth.py` | `test_expired_jwt_returns_401` | `401 Unauthorized` — Expired JWT rejected |
| `tests/test_auth.py` | `test_deactivated_user_blocked_immediately_on_login_and_existing_token` | `401 Unauthorized` — Deactivated user's active JWT is blocked immediately (`user.active == True`) |
| `tests/test_auth.py` | `test_role_protection_blocks_non_admin_from_user_endpoints` | `403 Forbidden` — `ASSET_MANAGER` & `EMPLOYEE` blocked from `/api/v1/users` |
| `tests/test_auth.py` | `test_update_profile_and_change_password` | `200 OK` on `PUT /auth/me` and `POST /auth/change-password`; `400` on wrong current password |
| `tests/test_users.py` | `test_list_users_pagination_search_and_filters` | `200 OK` — Paginated list (`page`, `size`, `sort`, `search`, `role`) (`FR-2`) |
| `tests/test_users.py` | `test_create_user_success_and_login` | `200 OK` — Creates user with hashed password & verifies login (`FR-2`) |
| `tests/test_users.py` | `test_create_user_duplicate_email_returns_409` | `409 Conflict` — Duplicate email rejected |
| `tests/test_users.py` | `test_create_user_validation_errors_return_400` | `400 Bad Request` — Blank name / short password rejected |
| `tests/test_users.py` | `test_update_user_success_role_and_status` | `200 OK` — Updates user name, role, and active status (`FR-2`) |
| `tests/test_users.py` | `test_update_user_not_found_returns_404` | `404 Not Found` — Non-existent user ID |
| `tests/test_users.py` | `test_update_user_duplicate_email_returns_409` | `409 Conflict` — Email collision on update |
| `tests/test_users.py` | `test_deactivate_user_holding_open_asset_returns_409` | `409 Conflict` — Prevents deactivating a user holding an open asset assignment (`returned_on IS NULL`) |
| `tests/test_categories.py` | `test_list_categories_allowed_for_all_authenticated_roles` | `200 OK` — Returns 4 seeded categories with inventory counts (`FR-3`) |
| `tests/test_categories.py` | `test_list_categories_unauthenticated_returns_401` | `401 Unauthorized` — Unauthenticated access rejected |
| `tests/test_categories.py` | `test_create_category_success_admin` | `200 OK` — `ADMIN` creates new category |
| `tests/test_categories.py` | `test_create_category_duplicate_returns_409` | `409 Conflict` — Duplicate category name (case-insensitive) rejected |
| `tests/test_categories.py` | `test_create_category_blank_name_returns_400` | `400 Bad Request` — Blank category name rejected |
| `tests/test_categories.py` | `test_create_category_forbidden_for_non_admin` | `403 Forbidden` — `ASSET_MANAGER` & `EMPLOYEE` blocked from `POST /api/v1/categories` |
| `tests/test_categories.py` | `test_admin_updates_and_deletes_empty_category` | Admin rename + delete empty category; manager update `403` |
| `tests/test_categories.py` | `test_delete_category_with_assets_returns_409` | Cannot delete category that still has assets |
| `src/test/CategoriesPage.test.tsx` | Admin CRUD / Manager view-only | Categories tab for Admin + Asset Manager |
| `tests/test_assets.py` | `test_create_assets_sequential_tags_and_roles` | `200 OK` — `ADMIN` and `ASSET_MANAGER` create assets; auto-generates `AST-0001`, `AST-0002` (`FR-3`, `FR-4`) |
| `tests/test_assets.py` | `test_create_asset_duplicate_serial_no_returns_409` | `409 Conflict` — Duplicate `serial_no` rejected (`FR-4`) |
| `tests/test_assets.py` | `test_create_asset_validation_and_missing_category_errors` | `400 Bad Request` on negative cost/blank name; `404 Not Found` on invalid `category_id` |
| `tests/test_assets.py` | `test_list_assets_pagination_search_and_filters` | `200 OK` — Pagination, search by `name` or `tag`, filter by `category` and `status` (`FR-6`) |
| `tests/test_assets.py` | `test_get_and_update_asset_success_and_immutability_guards` | `200 OK` on view/edit; `404` on missing; `409 Conflict` when attempting to edit Asset ID (`tag`); `serial_no`/`service_tag`/`asset_tag` editable (`FR-5`) |
| `tests/test_assets.py` | `test_retire_asset_audit_logging_and_retired_assigned_guards` | `200 OK` on retire with structured audit log; `409 Conflict` when editing/retiring `RETIRED` or `ASSIGNED` assets (`FR-5`) |
| `tests/test_assets.py` | `test_employee_forbidden_from_asset_management_endpoints` | `403 Forbidden` — `EMPLOYEE` blocked from `/api/v1/assets` endpoints |
| `tests/test_assignments_and_maintenance.py` | `test_assign_asset_single_active_enforcement_and_audit_log` | `200 OK` on assign + structured audit log (`action=assign`); `409 Conflict` on double-assign or inactive user; `404` on missing user (`FR-7`, `FR-13`) |
| `tests/test_assignments_and_maintenance.py` | `test_return_transitions_available_maintenance_retired_and_reassignment` | `200 OK` on return to `AVAILABLE`, `IN_MAINTENANCE`, and `RETIRED` with structured audit logs (`action=return`, `action=retire`), reassignment history (`FR-8`, `FR-9`, `FR-13`) |
| `tests/test_assignments_and_maintenance.py` | `test_maintenance_locking_and_close_workflow` | `200 OK` on open/close maintenance; `409 Conflict` when assigning or retiring an `IN_MAINTENANCE` asset or double-opening/closing (`FR-10`, `FR-11`) |
| `tests/test_assignments_and_maintenance.py` | `test_me_assets_user_assets_and_fr14_offboarding_deactivation_guardrail` | `200 OK` on `/me/assets` & `/users/{id}/assets`; `409 Conflict` when deactivating user holding open assignments; `200 OK` once all assets are returned (`FR-9`, `FR-14`) |
| `tests/test_assignments_and_maintenance.py` | `test_employee_rbac_for_sprint3_endpoints` | `200 OK` on `/me/assets`; `403 Forbidden` for `EMPLOYEE` on all management endpoints |
| `tests/test_assignments_and_maintenance.py` | `test_employee_one_time_fill_held_asset_details` | `200 OK` on first `PATCH /me/assets/{id}/details`; `409` when not held / already set; remaining blank field fillable once |
| `tests/test_replacements.py` | `test_create_and_list_replacement_requests_fr15` | `200 OK` on create & role-filtered list (`EMPLOYEE` sees own, `ASSET_MANAGER`/`ADMIN` see all); `400`, `401`, `404`, `409` on unheld/duplicate pending (`FR-15`, `FR-16`) |
| `tests/test_replacements.py` | `test_hold_replacement_request_visible_fr16` | `200 OK` marks `ON_HOLD`; employee + manager list show it; reject from `ON_HOLD` works; `403` for `EMPLOYEE` (`FR-16`) |
| `tests/test_replacements.py` | `test_reject_replacement_request_fr16` | `200 OK` on reject with comment; `400` on blank comment; `403` for `EMPLOYEE`; `409` on re-rejecting decided request (`FR-16`) |
| `tests/test_replacements.py` | `test_approve_atomic_rollback_and_retire_transition_fr17` | Rollback on non-`AVAILABLE`/`404`; wrong-category replacement → `409` (stays `PENDING`); atomic RETIRE + assign (`FR-16`, `FR-17`) |
| `tests/test_replacements.py` | `test_temporary_replacement_auto_swap_on_maintenance_close_fr18` | Verifies `REPAIR` approval creates linked `maintenance_records` row (`replacement_request_id`), and closing maintenance auto-returns temporary loaner to `AVAILABLE`, leaves repaired original as `AVAILABLE` for manual assign, and marks request `COMPLETED` (`FR-17`, `FR-18`) |
| `tests/test_replacements.py` | `test_permanent_repair_replacement_becomes_available_on_maintenance_close_fr17` | Verifies non-temporary `REPAIR` replacement returns repaired original asset to `AVAILABLE` upon maintenance close while employee retains permanent replacement (`FR-17`) |
| `tests/test_asset_requests.py` | `test_employee_creates_and_lists_own_asset_request` | Employee `POST /asset-requests` with category + reason → `PENDING` (`FR-19`) |
| `tests/test_asset_requests.py` | `test_employee_other_catalogue_request_requires_what_and_why` | Other path requires `other_category_name` + `reason` |
| `tests/test_asset_requests.py` | `test_available_assets_empty_then_approve_without_assign` | Empty stock check; approve without assign when no AVAILABLE (`FR-19`) |
| `tests/test_asset_requests.py` | `test_approve_assigns_available_asset_when_stock_exists` | Stock check + approve with `asset_id` assigns immediately; missing `asset_id` → `409` |
| `tests/test_asset_requests.py` | `test_approve_with_employee_register_flag_clears_after_register` | Approve with `requires_employee_register=true`; flag clears after `POST /me/assets` |
| `tests/test_asset_requests.py` | `test_employee_registers_asset_creates_and_self_assigns` | `POST /me/assets` create+assign; `409` duplicate; `403` manager (`FR-19`) |
| `tests/test_asset_requests.py` | `test_admin_approves_other_request_creates_category` | Admin approve Other auto-creates category |
| `tests/test_asset_requests.py` | `test_admin_rejects_asset_request` | Reject requires comment; status `REJECTED` |
| `tests/test_asset_requests.py` | `test_employee_cannot_approve_and_manager_cannot_create_request` | `403` employee approve; `403` manager create request |
| `tests/test_reports_and_benchmark.py` | `test_reports_summary_counts_by_status_and_category` | `200 OK` — Verifies `/api/v1/reports/summary` counts by status (`AVAILABLE`, `ASSIGNED`, `IN_MAINTENANCE`, `RETIRED`), category breakdown, and `total_value` (`FR-12`) |
| `tests/test_reports_and_benchmark.py` | `test_reports_rbac_blocks_unauthenticated_and_employee` | `401 Unauthorized` & `403 Forbidden` for `EMPLOYEE` on `/reports/summary`, `/reports/assets.csv`, and `/reports/assets.pdf` (`FR-12`) |
| `tests/test_reports_and_benchmark.py` | `test_reports_assets_csv_streaming_export_and_filters` | `200 OK` — Streams `text/csv` (`assets_report.csv`) with full asset & assignee details and optional status/category/search filters (`FR-12`) |
| `tests/test_reports_and_benchmark.py` | `test_reports_assets_pdf_export_includes_full_details` | `200 OK` — Returns `application/pdf` (`assets_report.pdf`) with full register details; filterable (`FR-12`) |
| `tests/test_reports_and_benchmark.py` | `test_benchmark_10000_assets_list_and_search_under_1_second` | Seeds 10,000 assets and verifies paginated list, tag search, combined filter search, and summary aggregation each execute in `< 1.0s` |

### Frontend (`Vitest` + `@testing-library/react`)
```bash
cd frontend
npx vitest run
```
- **Result:** `23 passed` across 6 test suites (100% pass rate)

| Test Suite | Test Case | Behavior Verified |
| :--- | :--- | :--- |
| `src/test/LoginPage.test.tsx` | `renders Tektalis login form and validates empty inputs` | Client-side validation for required email, email format, and password |
| `src/test/LoginPage.test.tsx` | `navigates to /dashboard on successful login` | Manual email/password entry, JWT storage in `localStorage`, redirect to `/dashboard` |
| `src/test/LoginPage.test.tsx` | `displays standardized API error message when credentials are invalid` | Renders error banner on `401` login failure |
| `src/test/UsersPage.test.tsx` | `lists users and allows ADMIN to create a new user via modal` | Renders user table, validates Create User modal, submits `POST /api/v1/users` |
| `src/test/UsersPage.test.tsx` | `allows ADMIN to edit an existing user role and name via Edit modal` | Opens Edit User modal, updates fields, submits `PUT /api/v1/users/{id}` |
| `src/test/UsersPage.test.tsx` | `handles 409 Conflict error when deactivating a user holding active assets` | Displays `409 Conflict` alert banner when user holds open asset assignments |
| `src/test/UsersPage.test.tsx` | `blocks non-ADMIN role from accessing ProtectedRoute for /users` | Renders `403 — Access Restricted` guard for `EMPLOYEE` role |
| `src/test/AssetsPage.test.tsx` | `renders asset table with tags, status badges, search, and filters` | Displays `AST-0001`, status badges, search input, and status/category dropdown filters (`FR-6`) |
| `src/test/AssetsPage.test.tsx` | `validates and creates a new asset via Create Asset modal` | Validates form inputs, calls `POST /api/v1/assets`, shows toast success (`FR-3`, `FR-4`) |
| `src/test/AssetsPage.test.tsx` | `opens Edit Asset modal with immutable Asset ID and updates editable fields` | Verifies Asset ID disabled; serial/service/asset tags editable; submits `PUT /api/v1/assets/{id}` (`FR-5`) |
| `src/test/AssetsPage.test.tsx` | `displays 409 Conflict toast error when retiring an ASSIGNED asset fails` | Opens Retire Asset modal, confirms retire, shows `409 Conflict` toast error (`FR-5`) |
| `src/test/Sprint3Workflows.test.tsx` | `assigns an AVAILABLE asset and returns an ASSIGNED asset via modals (FR-7, FR-8)` | Opens Assign & Return modals, submits `POST /assets/{id}/assign` and `POST /assets/{id}/return` |
| `src/test/Sprint3Workflows.test.tsx` | `opens standalone maintenance on an AVAILABLE asset from Assets page (FR-10, FR-11)` | Maintenance button on AVAILABLE row → `POST /assets/{id}/maintenance` → `IN_MAINTENANCE` |
| `src/test/Sprint3Workflows.test.tsx` | `opens Asset Detail & History Drawer showing assignment and maintenance logs (FR-9, FR-13)` | Opens History drawer, renders assignment & maintenance tables, closes maintenance |
| `src/test/Sprint3Workflows.test.tsx` | `renders Employee My Assets view calling GET /api/v1/me/assets (FR-9)` | Renders employee's active held assets at `/my-assets` |
| `src/test/Sprint3Workflows.test.tsx` | `allows employee one-time fill of blank asset details and shows email note for edits` | Fill Details modal, mailto note to admin/manager, locked View Details after save |
| `src/test/Sprint3Workflows.test.tsx` | `renders Maintenance Log page and closes an open maintenance record (FR-10, FR-11)` | Lists maintenance records and submits `PATCH /maintenance/{id}/close` |
| `src/test/Sprint3Workflows.test.tsx` | `renders Offboarding page, returns held assets, and surfaces 409 Conflict on premature deactivation (FR-14)` | Displays held assets for offboarding check and surfaces `409 Conflict` on premature user deactivation |
| `src/test/Sprint4Replacements.test.tsx` | `allows an employee to open the Request Replacement modal on MyAssetsPage and submit a temporary REPAIR request (FR-15)` | Opens Request Replacement modal on `/my-assets`, validates required reason, submits `POST /replacement-requests` |
| `src/test/Sprint4Replacements.test.tsx` | `allows an Asset Manager to approve a replacement request with an AVAILABLE asset selector (FR-16, FR-17)` | Approve modal loads same-category `AVAILABLE` assets only |
| `src/test/Sprint4Replacements.test.tsx` | `keeps replacement on hold when no AVAILABLE assets in the request category` | Empty category stock → Keep On Hold calls `PATCH /replacement-requests/{id}/hold` → `ON_HOLD` toast |
| `src/test/Sprint4Replacements.test.tsx` | `requires a rejection comment when an Asset Manager rejects a replacement request (FR-16)` | Validates non-empty rejection comment and submits `PATCH /replacement-requests/{id}/reject` |
| `src/test/Sprint4Replacements.test.tsx` | `displays pending request notification dots on sidebar tabs and top header for ADMIN` | Verifies Tektalis logo and pending notification dots on sidebar tabs (`nav-dot-replacements`, `nav-dot-maintenance`, `nav-dot-dashboard`) and top header (`header-pending-indicator`) |
| `src/test/Sprint5Reports.test.tsx` | `renders Executive Summary KPI cards (Total, Available, Assigned, In Maintenance, Retired) and Category Breakdown table` | Renders all 5 KPI cards, total valuation, and category status distribution table (`FR-12`) |
| `src/test/Sprint5Reports.test.tsx` | `triggers CSV and PDF export downloads for the asset register (FR-12)` | Calls `/reports/assets.csv` and `/reports/assets.pdf` and triggers browser downloads |
| `src/test/AssetsPage.test.tsx` | `exports the asset register as CSV and PDF from the Export menu (FR-12)` | Asset Register Export menu downloads CSV and PDF using current filters |
| `src/test/Sprint5Reports.test.tsx` | `fetches and displays assets assigned to a selected employee (FR-12)` | Selects employee from dropdown and renders held assets via `GET /api/v1/users/{id}/assets` (`FR-12`) |
| `src/test/AssetRequests.test.tsx` | `shows Register and Request buttons; Register submits full asset details` | `POST /me/assets` register + self-assign (`FR-19`) |
| `src/test/AssetRequests.test.tsx` | `lets an employee open New Asset Request with category and reason only` | Request modal category/reason; `POST /asset-requests` (`FR-19`) |
| `src/test/AssetRequests.test.tsx` | `shows No Asset Available and employee fill when stock is empty` | Empty stock → No Asset Available + employee fill |
| `src/test/AssetRequests.test.tsx` | `lets Admin approve and assign when AVAILABLE stock exists` | Dropdown + Approve & Assign with `asset_id` |
| `src/test/AssetRequests.test.tsx` | `shows a reminder banner when an approved request requires employee register` | My Assets reminder when flag is true |
| `src/test/AssetRequests.test.tsx` | `requires a rejection comment for Asset Manager reject` | Reject validation + `PATCH /asset-requests/{id}/reject` |

---

## 4. HITL Review — Sprint 1 (`FR-1`, `FR-2`) `curl` & Postman Examples

### 4.1 Authenticate & Obtain JWT (`POST /api/v1/auth/login`) — `200 OK`
```bash
curl -X POST "http://localhost:8000/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@tektalis.com",
    "password": "Admin@123"
  }'
```

### 4.2 List Users (`GET /api/v1/users`) — `200 OK` (`ADMIN` Only)
```bash
curl -X GET "http://localhost:8000/api/v1/users?page=1&size=20&sort=id,asc" \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>"
```

### 4.3 Create User (`POST /api/v1/users`) — `200 OK` (`ADMIN` Only)
```bash
curl -X POST "http://localhost:8000/api/v1/users" \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Priya Nair",
    "email": "priya.nair@tektalis.com",
    "password": "SecurePass!9",
    "role": "ASSET_MANAGER",
    "active": true
  }'
```

### 4.4 Edit / Change Role / Deactivate User (`PUT /api/v1/users/{id}`) — `200 OK` (`ADMIN` Only)
```bash
curl -X PUT "http://localhost:8000/api/v1/users/3" \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jordan Lee",
    "role": "ASSET_MANAGER",
    "active": false
  }'
```

---

## 5. HITL Review — Sprint 2 (`FR-3`, `FR-4`, `FR-5`, `FR-6`) `curl` & Postman Examples

### 5.1 List Categories (`GET /api/v1/categories`) — `200 OK` (All Authenticated Roles)
```bash
curl -X GET "http://localhost:8000/api/v1/categories" \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### 5.2 Create Category (`POST /api/v1/categories`) — `200 OK` (`ADMIN` Only)
```bash
curl -X POST "http://localhost:8000/api/v1/categories" \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Docking Station"
  }'
```

### 5.3 Create Asset (`POST /api/v1/assets`) — `200 OK` (`ASSET_MANAGER`, `ADMIN`) (`FR-3`, `FR-4`)
```bash
curl -X POST "http://localhost:8000/api/v1/assets" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MacBook Pro 16 M4",
    "serial_no": "SN-MBP-1001",
    "service_tag": "SVC-MBP-1001",
    "asset_tag": "ATG-MBP-1001",
    "category_id": 1,
    "purchase_date": "2026-01-15",
    "cost": 2499.99,
    "location": "HQ - Floor 3"
  }'
```

### 5.4 List, Search & Filter Assets (`GET /api/v1/assets`) — `200 OK` (`FR-6`)
```bash
curl -X GET "http://localhost:8000/api/v1/assets?page=1&size=20&sort=tag,asc&search=TEK-LPT&category=1&status=AVAILABLE" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>"
```

### 5.5 View Single Asset (`GET /api/v1/assets/{id}`) — `200 OK` (`FR-5`)
```bash
curl -X GET "http://localhost:8000/api/v1/assets/1" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>"
```

### 5.6 Edit Asset (`PUT /api/v1/assets/{id}`) — `200 OK` (`FR-5`)
```bash
curl -X PUT "http://localhost:8000/api/v1/assets/1" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MacBook Pro 16 M4 Max",
    "serial_no": "SN-MBP-1001",
    "service_tag": "SVC-MBP-UPDATED",
    "asset_tag": "ATG-MBP-UPDATED",
    "category_id": 1,
    "purchase_date": "2026-01-15",
    "cost": 2699.99,
    "location": "HQ - Executive Suite"
  }'
```

### 5.7 Retire Asset (`PATCH /api/v1/assets/{id}/retire`) — `200 OK` (`FR-5`)
```bash
curl -X PATCH "http://localhost:8000/api/v1/assets/1/retire" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>"
```

---

## 6. HITL Review — Sprint 3 (`FR-7` to `FR-11`, `FR-13`, `FR-14`) `curl` & Postman Examples

### 6.1 Assign Asset to Employee (`POST /api/v1/assets/{id}/assign`) — `200 OK` (`FR-7`, `FR-13`)
```bash
curl -X POST "http://localhost:8000/api/v1/assets/1/assign" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 3,
    "assigned_on": "2026-03-01"
  }'
```

### 6.2 Return Asset (`POST /api/v1/assets/{id}/return`) — `200 OK` (`FR-8`, `FR-13`, `FR-14`)
Supports transitioning `next_status` to `AVAILABLE`, `IN_MAINTENANCE`, or `RETIRED`:
```bash
curl -X POST "http://localhost:8000/api/v1/assets/1/return" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "next_status": "AVAILABLE",
    "return_reason": "OTHER",
    "returned_on": "2026-03-10"
  }'
```

### 6.3 View Asset Assignment & Maintenance History (`GET /api/v1/assets/{id}/history`) — `200 OK` (`FR-9`, `FR-13`)
```bash
curl -X GET "http://localhost:8000/api/v1/assets/1/history" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>"
```

### 6.4 View Employee's Own Assigned Assets (`GET /api/v1/me/assets`) — `200 OK` (`FR-9`)
```bash
curl -X GET "http://localhost:8000/api/v1/me/assets" \
  -H "Authorization: Bearer <EMPLOYEE_JWT_TOKEN>"
```

### 6.4.1 Employee One-Time Fill of Blank Tags (`PATCH /api/v1/me/assets/{id}/details`) — `200 OK` / `409 Conflict`
Employee may set blank `service_tag` / `asset_tag` once on a currently held asset. Already-set fields cannot be edited or cleared by the employee (email Admin / Asset Manager instead).
```bash
curl -X PATCH "http://localhost:8000/api/v1/me/assets/1/details" \
  -H "Authorization: Bearer <EMPLOYEE_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "service_tag": "SVC-EMP-001",
    "asset_tag": "ATG-EMP-001"
  }'
```

### 6.5 View Specific Employee's Active Held Assets (`GET /api/v1/users/{id}/assets`) — `200 OK` (`FR-9`, `FR-12`, `FR-14`)
```bash
curl -X GET "http://localhost:8000/api/v1/users/3/assets" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>"
```

### 6.6 Log Maintenance Record & Lock Asset (`POST /api/v1/assets/{id}/maintenance`) — `200 OK` (`FR-10`, `FR-11`)
```bash
curl -X POST "http://localhost:8000/api/v1/assets/1/maintenance" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Battery swelling replacement",
    "opened_on": "2026-03-12",
    "cost": 149.50
  }'
```

### 6.7 Close Maintenance Record & Return Asset to AVAILABLE (`PATCH /api/v1/maintenance/{id}/close`) — `200 OK` (`FR-11`)
```bash
curl -X PATCH "http://localhost:8000/api/v1/maintenance/1/close" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "closed_on": "2026-03-15",
    "cost": 149.50,
    "resolution": "Battery replaced and unit passed diagnostics"
  }'
```

> Unified **Maintenance Log** (Admin / Asset Manager): pending replacement approvals and open/closed maintenance appear on `/maintenance`. `resolution` is required on close and shown only after the record is closed. Employees still use `/replacements`.

---

## 7. HITL Review — Sprint 4 (`FR-15` to `FR-18`) `curl` & Postman Examples

### 7.1 Raise a Replacement Request for a Held Asset (`POST /api/v1/replacement-requests`) — `200 OK` (`FR-15`)
```bash
curl -X POST "http://localhost:8000/api/v1/replacement-requests" \
  -H "Authorization: Bearer <EMPLOYEE_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "asset_id": 1,
    "reason": "USB-C ports failing intermittently; need loaner during repair",
    "old_asset_action": "REPAIR",
    "temporary": true
  }'
```

### 7.2 List Replacement Requests (`GET /api/v1/replacement-requests`) — `200 OK` (`FR-15`, `FR-16`)
```bash
curl -X GET "http://localhost:8000/api/v1/replacement-requests?status=PENDING" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>"
```

### 7.3 Approve Replacement Request — Atomic Swap (`PATCH /api/v1/replacement-requests/{id}/approve`) — `200 OK` (`FR-16`, `FR-17`)
```bash
curl -X PATCH "http://localhost:8000/api/v1/replacement-requests/1/approve" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "replacement_asset_id": 2,
    "comment": "Approved loaner MacBook Air while primary laptop is serviced"
  }'
```

### 7.4 Close Linked Maintenance Record — Temporary Replacement Auto-Swap (`PATCH /api/v1/maintenance/{id}/close`) — `200 OK` (`FR-18`)
```bash
curl -X PATCH "http://localhost:8000/api/v1/maintenance/1/close" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "cost": 225.00,
    "description": "Replaced USB-C I/O board and verified charging",
    "resolution": "USB-C board replaced; charging verified"
  }'
```

### 7.5 Reject Replacement Request (`PATCH /api/v1/replacement-requests/{id}/reject`) — `200 OK` (`FR-16`)
```bash
curl -X PATCH "http://localhost:8000/api/v1/replacement-requests/2/reject" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "comment": "Cosmetic wear does not require hardware replacement."
  }'
```

### 7.6 Mark Replacement Request On Hold (`PATCH /api/v1/replacement-requests/{id}/hold`) — `200 OK` (`FR-16`)
Use when no same-category `AVAILABLE` stock. Status becomes `ON_HOLD` (visible to the employee and managers). Approve/reject remain available later.

```bash
curl -X PATCH "http://localhost:8000/api/v1/replacement-requests/2/hold" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "comment": "Awaiting AVAILABLE Laptops stock"
  }'
```

**Expected Response (`200 OK`):** `"status": "ON_HOLD"`, optional `decision_comment`, `decided_at` remains `null`.

---

## 8. HITL Review — Sprint 5 (`FR-12`) Executive Reports & Streaming CSV Export

### 8.1 Get Executive Reports Summary (`GET /api/v1/reports/summary`) — `200 OK` (`ASSET_MANAGER`, `ADMIN`)
```bash
curl -X GET "http://localhost:8000/api/v1/reports/summary" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>"
```

**Expected Response (`200 OK`):**
```json
{
  "total_assets": 4,
  "total_value": 3300.0,
  "by_status": {
    "AVAILABLE": 1,
    "ASSIGNED": 1,
    "IN_MAINTENANCE": 1,
    "RETIRED": 1
  },
  "status_breakdown": [
    { "status": "AVAILABLE", "count": 1 },
    { "status": "ASSIGNED", "count": 1 },
    { "status": "IN_MAINTENANCE", "count": 1 },
    { "status": "RETIRED", "count": 1 }
  ],
  "by_category": {
    "Laptop": 1,
    "Monitor": 1,
    "Phone": 1,
    "Furniture": 1
  },
  "category_breakdown": [
    {
      "category_id": 1,
      "category_name": "Laptop",
      "total": 1,
      "available": 1,
      "assigned": 0,
      "in_maintenance": 0,
      "retired": 0,
      "total_value": 1500.0
    }
  ]
}
```

### 8.2 Download Streaming Asset Register CSV (`GET /api/v1/reports/assets.csv`) — `200 OK` (`ASSET_MANAGER`, `ADMIN`)
```bash
curl -X GET "http://localhost:8000/api/v1/reports/assets.csv" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -o assets_report.csv
```

**Sample CSV Output (full register columns):**
```csv
id,tag,name,serial_no,service_tag,asset_tag,category_id,category,status,location,purchase_date,cost,assigned_to_name,assigned_to_email,awaiting_employee_details,version,created_at
1,AST-0001,ThinkPad X1 Carbon,SN-REP-001,SVC-001,ATG-001,1,Laptop,AVAILABLE,HQ Vault,2026-01-10,1500.00,,,false,1,2026-10-19T17:36:38Z
2,AST-0002,Dell UltraSharp 27,SN-REP-002,SVC-002,ATG-002,2,Monitor,ASSIGNED,Floor 2,2026-01-15,500.00,Employee User,employee@tektalis.com,false,2,2026-10-19T17:36:38Z
```

### 8.2b Download Asset Register PDF (`GET /api/v1/reports/assets.pdf`) — `200 OK` (`ASSET_MANAGER`, `ADMIN`)
Full-detail PDF (one block per asset). Same optional filters as CSV: `status`, `category_id`, `search`.
```bash
curl -X GET "http://localhost:8000/api/v1/reports/assets.pdf" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -o assets_report.pdf
```

---

## 8.3 Employee Asset Requests (`FR-19`)

### Create Asset Request (`POST /api/v1/asset-requests`) — `200 OK` (`EMPLOYEE`)
Category + reason only (hardware details filled later on My Assets after approve).
```bash
curl -X POST "http://localhost:8000/api/v1/asset-requests" \
  -H "Authorization: Bearer <EMPLOYEE_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "category_id": 1,
    "is_other": false,
    "reason": "Need a laptop for development work"
  }'
```

### Available Assets for Request (`GET /api/v1/asset-requests/{id}/available-assets`) — `200 OK`
Backend stock check for the request category (`has_available` + `items`).
```bash
curl -X GET "http://localhost:8000/api/v1/asset-requests/1/available-assets" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>"
```

### Approve Asset Request (`PATCH /api/v1/asset-requests/{id}/approve`) — `200 OK` (`ADMIN` / `ASSET_MANAGER`)
When stock exists, pass `asset_id` to assign immediately (`409` if stock exists and `asset_id` omitted). When no stock, optional `requires_employee_register`.
```bash
curl -X PATCH "http://localhost:8000/api/v1/asset-requests/1/approve" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"asset_id": 12, "comment": "Assigned from stock"}'
```
```bash
curl -X PATCH "http://localhost:8000/api/v1/asset-requests/1/approve" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"comment": "No stock", "requires_employee_register": true}'
```

### Employee Asset Register (`POST /api/v1/me/assets`) — `200 OK` (`EMPLOYEE`)
Creates the asset and assigns it immediately to the employee (shows on My Assets). Also clears the oldest `requires_employee_register` flag on that employee's approved requests.
```bash
curl -X POST "http://localhost:8000/api/v1/me/assets" \
  -H "Authorization: Bearer <EMPLOYEE_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dell Latitude 5550",
    "serial_no": "SN-EMP-REG-001",
    "category_id": 1,
    "purchase_date": "2026-03-01",
    "cost": 1299.50,
    "location": "HQ - Floor 2"
  }'
```

### Reject Asset Request (`PATCH /api/v1/asset-requests/{id}/reject`) — `200 OK`
```bash
curl -X PATCH "http://localhost:8000/api/v1/asset-requests/1/reject" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"comment": "Not in budget this quarter"}'
```

---

## 9. Bulk Excel (.xlsx) Import — Users (`POST /api/v1/users/import`) & Assets (`POST /api/v1/assets/import`)

### 9.1 Download Excel (.xlsx) Templates
- **Users Excel Template (`ADMIN` only):** `GET /api/v1/users/import/template` $\rightarrow$ downloads `tektalis_users_import_template.xlsx` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
- **Assets Excel Template (`ASSET_MANAGER`, `ADMIN`):** `GET /api/v1/assets/import/template` $\rightarrow$ downloads `tektalis_assets_import_template.xlsx` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)

### 9.2 Bulk Import Users (`POST /api/v1/users/import`) — `200 OK` (`ADMIN` only)
Imports users from an uploaded Microsoft Excel `.xlsx` workbook (`excel_base64`) or pasted Excel cells (`csv_content`) with per-row savepoints (`db.begin_nested()`). Valid rows commit while duplicate/invalid rows roll back individually and are returned in `errors`.
- **Required Columns:** `name,email`
- **Optional Columns (with Defaults):** `role` (`EMPLOYEE`), `password` (`Welcome@123`), `active` (`true`)

```bash
curl -X POST "http://localhost:8000/api/v1/users/import" \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "excel_base64": "<BASE64_ENCODED_XLSX_WORKBOOK>"
  }'
```

### 9.3 Bulk Import Assets (`POST /api/v1/assets/import`) — `200 OK` (`ASSET_MANAGER`, `ADMIN`)
Imports assets from an uploaded Microsoft Excel `.xlsx` workbook (`excel_base64`) or pasted Excel cells (`csv_content`) with automatic `TEK-<CAT>-<ITEM>-<HEX4>` tag generation, automatic creation of missing categories, Excel serial date support, optional single-step assignment via `assigned_to_email`, and per-row savepoint isolation.
- **Required Columns:** `name,serial_no,category,purchase_date,cost,location`
- **Optional Columns:** `assigned_to_email` (if provided and matches an active user, creates an open `AssetAssignment` and sets `status = ASSIGNED`)

```bash
curl -X POST "http://localhost:8000/api/v1/assets/import" \
  -H "Authorization: Bearer <MANAGER_OR_ADMIN_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "excel_base64": "<BASE64_ENCODED_XLSX_WORKBOOK>"
  }'
```

