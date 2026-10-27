# Asset Management System (AMS) – Functional & Technical Specification

## 1. Purpose and Scope
The Asset Management System (AMS) lets a company (<100 employees) record its physical and IT assets (laptops, monitors, phones, furniture), assign them to employees, and track them until disposal. Version 1 replaces the existing spreadsheet.
- **In scope:** Asset register, assignment, return and reassignment, replacement requests, maintenance log, search and basic reports, login with roles, full React TypeScript web UI, and single-command Docker Compose orchestration.
- **Out of scope (v1):** Purchasing and invoices, depreciation, barcode scanners, mobile app, email notifications.

## 2. Users and Roles
Three roles enforced via FastAPI Security Dependencies (`Depends`) and reflected in React UI route guards:
| Role | Can Do |
| :--- | :--- |
| `ADMIN` | Everything, plus manage users and categories |
| `ASSET_MANAGER` | Add and edit assets, assign and return, log maintenance, approve/reject replacements, run reports |
| `EMPLOYEE` | View own assigned assets, raise a replacement request, submit asset requests |
| `ASSET_MANAGER` | Same asset-request approve/reject capabilities as Admin |

## 3. Functional Requirements (FR-1 to FR-19)
| ID | Module | Requirement |
| :--- | :--- | :--- |
| **FR-1** | Auth | Users log in with email and password; passwords stored hashed (BCrypt); JWT returned on login. |
| **FR-2** | Auth | Admin creates, edits, and deactivates users (`PUT /api/v1/users/{id}`) and assigns a role. |
| **FR-3** | Assets | Create an asset with name, category, serial number, service tag, asset tag, purchase date, cost, location. |
| **FR-4** | Assets | Serial number, service tag, and asset tag must be unique; each new asset gets an auto-generated immutable Asset ID such as `TEK-LPT-MP15-0001`. |
| **FR-5** | Assets | Edit, view, and retire an asset; retired assets are never hard-deleted. |
| **FR-6** | Assets | List assets with pagination (`page`, `size`, `sort`), search by name or tag, and filter by category and status. |
| **FR-7** | Assignment | Assign an `AVAILABLE` asset to an employee with an assignment date. |
| **FR-8** | Assignment | Return an asset; status goes to `AVAILABLE`, `IN_MAINTENANCE`, or `RETIRED`, and the return date is stored. |
| **FR-9** | Assignment | Show full assignment history of an asset and current assets of an employee. |
| **FR-10** | Maintenance | Log a maintenance record (date, description, cost) against an asset. |
| **FR-11** | Maintenance | Asset is `IN_MAINTENANCE` until the record is closed. |
| **FR-12** | Reports | Counts by status and category; list of assets assigned to a given employee; full asset-register export as **CSV** and **PDF** (all register fields, optional status/category/search filters) from Asset Register and Reports. |
| **FR-13** | Reassignment | An asset that has been returned becomes `AVAILABLE` and can be reassigned to any other employee; history keeps every assignment. |
| **FR-14** | Reassignment | When an employee leaves, the Asset Manager sees all assets they hold and returns each one; a user who still holds assets cannot be deactivated (`409 Conflict`). |
| **FR-15** | Replacement | An Employee raises a replacement request for an asset they hold, with a reason, what happens to the old asset (`REPAIR` or `RETIRE`), and whether the replacement is temporary. |
| **FR-16** | Replacement | The Asset Manager approves or rejects the request; on approval they pick an `AVAILABLE` replacement asset **in the same category** as the held asset; if none exist they mark it `ON_HOLD` (visible to the employee and managers until stock arrives). On rejection they provide a comment. Approve/reject remain available from `PENDING` or `ON_HOLD`. |
| **FR-17** | Replacement | On approval, the old asset is returned and the replacement is assigned in one atomic transaction; the old asset goes to `IN_MAINTENANCE` (opening a linked maintenance record if `REPAIR`) or `RETIRED`, and a repaired asset becomes `AVAILABLE` when its maintenance record is closed. |
| **FR-18** | Replacement | For a temporary replacement, closing the repair automatically returns the temporary loaner to `AVAILABLE`, returns the repaired original asset to `AVAILABLE` for **manual** reassignment, and marks the replacement request `COMPLETED`. |
| **FR-19** | Asset Requests & Register | Employee has two My Assets actions: **New Asset Request** (category + reason) and **New Asset Register** (create + self-assign). On approve, backend checks AVAILABLE stock for the request category: if stock exists, Admin picks an asset and approve **assigns** it immediately; if none, UI shows **No Asset Available currently** plus optional **Should be filled by an Employee** (`requires_employee_register`, cleared after register). |

## 4. Data Model (PostgreSQL 17 + Alembic)
Every table has an `id` (`BIGSERIAL` primary key) and `created_at` (`TIMESTAMPTZ DEFAULT now()`). Schema is managed strictly via Alembic migrations.

All physical table names use the `ams_` prefix (e.g. `ams_users`). Sequence: `ams_asset_tag_seq`.

1. **`ams_users`**: `id`, `name`, `email` (unique), `password_hash`, `role` (`ADMIN`, `ASSET_MANAGER`, `EMPLOYEE`), `active` (boolean, default true), `created_at`.
2. **`ams_categories`**: `id`, `name` (unique: seeded with `Laptop`, `Monitor`, `Phone`, `Furniture`), `created_at`.
3. **`ams_assets`**: `id`, `tag` (unique auto-generated Asset ID, e.g. `TEK-LPT-MP15-0001`), `name`, `serial_no` (unique), `service_tag` (unique), `asset_tag` (unique), `category_id` (FK), `purchase_date`, `cost` (numeric), `location`, `status` (`AVAILABLE`, `ASSIGNED`, `IN_MAINTENANCE`, `RETIRED`), `awaiting_employee_details` (bool; set on asset-request approve until one-time employee fill), `version` (int, optimistic locking), `created_at`.
4. **`ams_assignments`**: `id`, `asset_id` (FK), `user_id` (FK), `assigned_on`, `returned_on` (nullable while in use), `return_reason` (`REPLACEMENT`, `EMPLOYEE_LEFT`, `OTHER`, nullable), `created_at`.
   - *Constraint:* Partial Unique Index on `(asset_id) WHERE returned_on IS NULL` to enforce at most one open assignment at a time.
5. **`ams_maintenance_records`**: `id`, `asset_id` (FK), `replacement_request_id` (nullable FK to `ams_replacement_requests.id`), `opened_on`, `closed_on` (nullable while open), `description`, `resolution` (nullable until closed), `cost` (numeric, nullable), `created_at`. Admin/Asset Manager **Maintenance Log** UI also surfaces pending replacement requests (Pending Approval) alongside open/closed maintenance rows.
6. **`ams_replacement_requests`**: `id`, `asset_id` (FK to old asset), `requested_by` (FK to `ams_users.id`), `reason`, `old_asset_action` (`REPAIR`, `RETIRE`), `temporary` (boolean), `replacement_asset_id` (nullable FK to `ams_assets.id` until approval), `status` (`PENDING`, `APPROVED`, `REJECTED`, `COMPLETED`), `decided_by` (nullable FK), `decision_comment` (nullable text), `decided_at` (nullable timestamptz), `created_at`.
7. **`ams_asset_requests`**: `id`, `requested_by` (FK), `name` (display from category), `category_id` (nullable FK), `is_other`, `other_category_name`, `reason` (required what/why), optional legacy hardware fields nullable, `status` (`PENDING`, `APPROVED`, `REJECTED`), `requires_employee_register` (bool; set on approve; cleared when employee registers via `POST /me/assets`), `created_asset_id` (nullable FK), `decided_by`, `decision_comment`, `decided_at`, `created_at`. Immutable after create (no employee edit/delete).

## 5. REST API Summary
Base path: `/api/v1`. All endpoints except `/auth/login` require a valid Bearer JWT. List endpoints accept `page` (default 1), `size` (default 20), and `sort`.

| Method | Path | Purpose | Role |
| :--- | :--- | :--- | :--- |
| `POST` | `/auth/login` | Log in, get JWT | Public |
| `GET, POST` | `/users` | List, create users | `ADMIN` |
| `PUT` | `/users/{id}` | Edit user, change role, or deactivate (`active: false`) | `ADMIN` |
| `GET, POST` | `/categories` | List categories (all roles); create category (`ADMIN`) | Authenticated / `ADMIN` |
| `PATCH, DELETE` | `/categories/{id}` | Rename category; delete only when empty (`ADMIN`) | `ADMIN` |
| `GET` | `/assets?search=&category=&status=` | Paginated search & filter assets | `ASSET_MANAGER`, `ADMIN` |
| `POST` | `/assets` | Create asset (auto-generates `AST-XXXX`) | `ASSET_MANAGER`, `ADMIN` |
| `GET, PUT` | `/assets/{id}` | View, edit asset (Asset ID / `tag` immutable; all other fields editable) | `ASSET_MANAGER`, `ADMIN` |
| `PATCH` | `/assets/{id}/retire` | Retire an `AVAILABLE` asset | `ASSET_MANAGER`, `ADMIN` |
| `POST` | `/assets/{id}/assign` | Assign `AVAILABLE` asset to a user | `ASSET_MANAGER`, `ADMIN` |
| `POST` | `/assets/{id}/return` | Return asset (body sets next status: `AVAILABLE`, `IN_MAINTENANCE`, or `RETIRED`) | `ASSET_MANAGER`, `ADMIN` |
| `GET` | `/assets/{id}/history` | Assignment & maintenance history | `ASSET_MANAGER`, `ADMIN` |
| `POST` | `/assets/{id}/maintenance` | Open maintenance record | `ASSET_MANAGER`, `ADMIN` |
| `PATCH` | `/maintenance/{id}/close` | Close maintenance record (triggers FR-18 swap if linked to temp replacement) | `ASSET_MANAGER`, `ADMIN` |
| `GET` | `/me/assets` | Current logged-in user's assigned assets | `EMPLOYEE` and above |
| `POST` | `/me/assets` | Employee registers a held asset (create + self-assign) | `EMPLOYEE` |
| `PATCH` | `/me/assets/{id}/details` | Employee one-time fill of blank tags on a held asset | `EMPLOYEE` |
| `GET` | `/reports/summary` | Counts by status and category | `ASSET_MANAGER`, `ADMIN` |
| `GET` | `/reports/assets.csv` | Streaming CSV export of full asset register | `ASSET_MANAGER`, `ADMIN` |
| `GET` | `/reports/assets.pdf` | PDF export of full asset register details | `ASSET_MANAGER`, `ADMIN` |
| `POST` | `/replacement-requests` | Raise a replacement request | `EMPLOYEE` and above |
| `GET` | `/replacement-requests` | List requests (own for `EMPLOYEE`, all for `ASSET_MANAGER`/`ADMIN`) | `EMPLOYEE` and above |
| `PATCH` | `/replacement-requests/{id}/approve` | Approve request; body has `replacementAssetId` | `ASSET_MANAGER`, `ADMIN` |
| `PATCH` | `/replacement-requests/{id}/reject` | Reject request with a `comment` in body | `ASSET_MANAGER`, `ADMIN` |
| `POST` | `/asset-requests` | Employee submits asset request (catalogue or Other) | `EMPLOYEE` |
| `GET` | `/asset-requests` | List requests (own for `EMPLOYEE`, all for managers) | `EMPLOYEE` and above |
| `GET` | `/asset-requests/{id}/available-assets` | AVAILABLE inventory for the request category (approve stock check) | `ASSET_MANAGER`, `ADMIN` |
| `PATCH` | `/asset-requests/{id}/approve` | Approve; `asset_id` assigns stock, or `requires_employee_register` when no stock | `ASSET_MANAGER`, `ADMIN` |
| `PATCH` | `/asset-requests/{id}/reject` | Reject with required `comment` | `ASSET_MANAGER`, `ADMIN` |
| `GET` | `/users/{id}/assets` | Active assets held by a specific user | `ASSET_MANAGER`, `ADMIN` |

**Error Format:** HTTP `400` (bad input/validation), `401` (unauthenticated), `403` (forbidden role), `404` (not found), `409` (business rule violation). All return JSON: `{"status": 409, "message": "...", "timestamp": "..."}`.

## 6. Core Business Rules & Invariants
1. **Four Statuses:** `AVAILABLE`, `ASSIGNED`, `IN_MAINTENANCE`, `RETIRED`.
2. **Single Assignment:** An asset has at most one open assignment at a time. Only an `AVAILABLE` asset can be assigned.
3. **Return Prerequisite:** An `ASSIGNED` asset must be returned before it can be assigned to someone else, sent to standalone maintenance, or retired.
4. **Retirement Finality:** A `RETIRED` asset cannot be assigned or edited (`409 Conflict`), but stays in history and reports.
5. **Immutability:** Asset ID (`tag`) cannot change after creation (`409` if modified). `serial_no`, `service_tag`, and `asset_tag` are editable with uniqueness enforced.
6. **Data Isolation:** An `EMPLOYEE` sees only their own assignments and replacement requests.
7. **Deactivation Guard:** A user who currently holds any open asset assignment cannot be deactivated (`409 Conflict`).
8. **Performance:** List and search respond in under 1 second for 10,000 assets (enforced via PostgreSQL indexes on `tag`, `name`, `status`, `category_id`).