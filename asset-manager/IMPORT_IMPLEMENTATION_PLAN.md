# Tektalis AMS — Users & Assets Bulk Import Implementation Document

## 1. Executive Summary & Chosen Architecture
We will implement **Option 1: Smart CSV Bulk Import with Auto-Defaults, Category Auto-Creation, Optional Auto-Assignment, and Partial-Success Row Reporting** for both **Users** and **Assets**.

### Why This Design Best Fits Our Schema
- **Zero Extra Dependencies:** Uses Python's standard `csv` and `io` modules on the backend and native FileReader / Blob downloads on the React TypeScript frontend, strictly adhering to `.cursorrules`.
- **Automatic Hex Asset Tag Generation:** Imported assets automatically generate their `TEK-<CAT>-<ITEM>-<HEX4>` tag via `AssetRepository.generate_next_tag()` using the PostgreSQL `asset_tag_seq` sequence—eliminating manual tag formatting errors.
- **Per-Row Savepoint Isolation (Partial Success):** Each CSV row is processed inside a SQLAlchemy nested transaction (`db.begin_nested()`). Valid rows commit cleanly while duplicate or malformed rows are skipped and returned in a structured row-by-row error report.
- **Auto-Create Missing Categories:** If an asset row references a category name not yet in `categories` (e.g., `Docking Station` or `Server`), the importer automatically creates the category and links the asset.
- **Single-Step Onboarding (`assigned_to_email`):** Asset rows can optionally include an employee's email to immediately create the `AssetAssignment` record (`status = ASSIGNED`) and emit a structured audit log entry.

---

## 2. CSV Template Specifications

### 2.1 Users Import Template (`tektalis_users_import_template.csv`)
Available on the **User Management (`/users`)** page (`ADMIN` role required).

| Column Header | Required? | Type / Format | Default (if blank) | Schema & Validation Rules |
| :--- | :--- | :--- | :--- | :--- |
| `name` | **Yes** | String (`1..255` chars) | — | Trimmed; cannot be blank |
| `email` | **Yes** | Email (`VARCHAR(255)`) | — | Normalized to lowercase; must be valid email & unique in `users.email` |
| `role` | No | `ADMIN` \| `ASSET_MANAGER` \| `EMPLOYEE` | `EMPLOYEE` | Case-insensitive enum match |
| `password` | No | String (`6..128` chars) | `Welcome@123` | Plaintext in CSV; hashed with BCrypt (`hash_password`) before insert |
| `active` | No | Boolean (`true`/`false`, `1`/`0`, `yes`/`no`) | `true` | Maps to `users.active` |

#### Sample `tektalis_users_import_template.csv`
```csv
name,email,role,password,active
Aarav Mehta,aarav.mehta@tektalis.com,EMPLOYEE,Welcome@123,true
Neha Kapoor,neha.kapoor@tektalis.com,ASSET_MANAGER,Manager@123,true
Rohan Verma,rohan.verma@tektalis.com,EMPLOYEE,,true
```

---

### 2.2 Assets Import Template (`tektalis_assets_import_template.csv`)
Available on the **Asset Register (`/assets`)** page (`ADMIN` and `ASSET_MANAGER` roles).

| Column Header | Required? | Type / Format | Default (if blank) | Schema & Validation Rules |
| :--- | :--- | :--- | :--- | :--- |
| `name` | **Yes** | String (`1..255` chars) | — | Hardware model/name; used to compute `<ITEM>` hex code in `TEK-<CAT>-<ITEM>-<HEX4>` |
| `serial_no` | **Yes** | String (`1..255` chars) | — | Unique case-insensitively in `assets.serial_no` |
| `category` | **Yes** | String (`1..100` chars) | — | Matched case-insensitively against `categories.name`; **auto-created** if missing |
| `purchase_date` | **Yes** | Date (`YYYY-MM-DD`) | — | Also accepts `DD/MM/YYYY` or `MM/DD/YYYY` and normalizes to ISO `YYYY-MM-DD` |
| `cost` | **Yes** | Decimal (`>= 0.00`) | — | Strips optional currency symbols (`₹`, `$`, `,`) and validates `>= 0.00` |
| `location` | **Yes** | String (`1..255` chars) | — | Office/building/floor location |
| `assigned_to_email` | No | Email (`VARCHAR(255)`) | Blank (`AVAILABLE`) | If provided, must match an existing **active** user (`users.active == True`). Transitions asset to `ASSIGNED` and creates an open `AssetAssignment` record |

#### Sample `tektalis_assets_import_template.csv`
```csv
name,serial_no,category,purchase_date,cost,location,assigned_to_email
MacBook Pro 16 M4,SN-MBP-9001,Laptop,2026-03-15,195000.00,Hyderabad - Floor 14,aarav.mehta@tektalis.com
Dell UltraSharp 27 4K,SN-MON-9002,Monitor,2026-03-18,48500.00,Hyderabad - Floor 14,
CalDigit TS4 Dock,SN-DCK-9003,Docking Station,2026-03-20,32000.00,Bengaluru - Floor 5,neha.kapoor@tektalis.com
```

---

## 3. Backend API Specification

### 3.1 Endpoints
1. **`POST /api/v1/users/import`**
   - **RBAC:** `ADMIN` only (`Depends(require_roles(UserRole.ADMIN))`)
   - **Request Body (`BulkCsvImportRequest`):**
     ```json
     {
       "csv_content": "name,email,role,password,active\nAarav Mehta,aarav.mehta@tektalis.com,EMPLOYEE,Welcome@123,true"
     }
     ```
   - **Response (`200 OK` — `UserBulkImportResponse`):**
     ```json
     {
       "total_rows": 3,
       "imported_count": 2,
       "skipped_count": 1,
       "imported_items": [
         {
           "id": 12,
           "name": "Aarav Mehta",
           "email": "aarav.mehta@tektalis.com",
           "role": "EMPLOYEE",
           "active": true,
           "active_assets_count": 0,
           "created_at": "2026-10-21T08:00:00Z"
         }
       ],
       "errors": [
         {
           "row": 3,
           "identifier": "admin@asset.com",
           "message": "User with email 'admin@asset.com' already exists"
         }
       ]
     }
     ```

2. **`POST /api/v1/assets/import`**
   - **RBAC:** `ASSET_MANAGER` or `ADMIN` (`Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN))`)
   - **Request Body (`BulkCsvImportRequest`):**
     ```json
     {
       "csv_content": "name,serial_no,category,purchase_date,cost,location,assigned_to_email\nMacBook Pro 16 M4,SN-MBP-9001,Laptop,2026-03-15,195000.00,Hyderabad - Floor 14,"
     }
     ```
   - **Response (`200 OK` — `AssetBulkImportResponse`):**
     ```json
     {
       "total_rows": 3,
       "imported_count": 3,
       "skipped_count": 0,
       "created_categories": ["Docking Station"],
       "imported_items": [
         {
           "id": 45,
           "tag": "TEK-LPT-MP15-002A",
           "name": "MacBook Pro 16 M4",
           "serial_no": "SN-MBP-9001",
           "category_id": 1,
           "category_name": "Laptop",
           "purchase_date": "2026-03-15",
           "cost": 195000.0,
           "location": "Hyderabad - Floor 14",
           "status": "ASSIGNED",
           "version": 1,
           "created_at": "2026-10-21T08:00:00Z"
         }
       ],
       "errors": []
     }
     ```

### 3.2 Error Handling & Transaction Rules
- **`400 Bad Request`:** Raised if `csv_content` is empty, has no header row, or is missing required column headers (`name, email` for Users; `name, serial_no, category, purchase_date, cost, location` for Assets).
- **Row-Level Savepoints (`db.begin_nested()`):**
  - Row numbers follow 1-indexed spreadsheet numbering (Header = Row 1, first data row = Row 2).
  - If a row fails validation (e.g., duplicate `email`, duplicate `serial_no`, negative `cost`, invalid `purchase_date`, or `assigned_to_email` pointing to a non-existent/inactive user), only that row's savepoint rolls back and an entry is appended to `errors`.
- **Audit Logging:**
  - Every imported asset that is auto-assigned via `assigned_to_email` logs a structured `ASSIGN` audit event with `actor_user_id`, `asset_id`, `target_user_id`, and `timestamp`.

---

## 4. Frontend UI / UX Design (Tektalis White & Blue Theme)

1. **User Management Page (`frontend/src/pages/UsersPage.tsx`):**
   - Add an **"Import Users"** button (`Upload` icon) next to the **"Create User"** button in the page header.
   - Opens the **Import Users Modal** featuring:
     - **"Download Sample CSV Template"** button (`tektalis_users_import_template.csv`).
     - `.csv` file upload selector + editable CSV content preview box.
     - Live badge showing detected data row count.
     - Post-import result banner displaying `Imported: X`, `Skipped: Y`, and a row-by-row error table if any rows were skipped.

2. **Asset Register Page (`frontend/src/pages/AssetsPage.tsx`):**
   - Add an **"Import Assets"** button (`Upload` icon) in the top action bar next to **"New Category"** and **"Add Asset"**.
   - Opens the **Import Assets Modal** featuring:
     - **"Download Sample CSV Template"** button (`tektalis_assets_import_template.csv`).
     - Callout explaining automatic `TEK-<CAT>-<ITEM>-<HEX4>` tag generation, automatic creation of new categories, and optional `assigned_to_email` assignment.
     - `.csv` file upload selector + editable CSV content preview box.
     - Post-import result summary showing `Imported: X`, `Skipped: Y`, newly created categories badges, and any row-level errors.

---

## 5. Verification & Test Plan
1. **Backend (`pytest`):**
   - `tests/test_users.py`: Bulk user import success, default role/password/active handling, duplicate email skip with row error report, missing header `400`, RBAC `401`/`403`.
   - `tests/test_assets.py`: Bulk asset import success with auto-generated `TEK-...` tags, auto-creation of new categories, auto-assignment via `assigned_to_email`, partial success when duplicate `serial_no` or inactive assignee is encountered, missing header `400`, RBAC `401`/`403`.
2. **Frontend (`Vitest`):**
   - Component tests verifying the Import Users modal and Import Assets modal (template download trigger, CSV upload/paste, and summary/error rendering).
3. **Documentation:**
   - Update `TEST_REPORT.md` with full Swagger/Postman payloads and test coverage details.
