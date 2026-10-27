# Tektalis Asset Management System (AMS)

An enterprise-grade **Asset Management System (AMS)** built with **FastAPI**, **SQLAlchemy 2.0**, **PostgreSQL 17**, **Alembic**, and **React 18 + Vite + TypeScript + Tailwind CSS** (Tektalis White Theme).

Designed to replace manual spreadsheets for organizations tracking physical and IT hardware (`Laptop`, `Monitor`, `Phone`, `Furniture`) across the complete asset lifecycle: procurement registration, employee assignment, maintenance and repair locking, atomic replacement & loaner auto-swaps, offboarding guardrails, and executive CSV reporting.

---

## 1. Single-Command Quick Start

Everything runs via a single Docker Compose command from the repository root (`3` containers: `db`, `backend`, `frontend`):

```bash
docker-compose up --build
```

### Service Endpoints
| Service | URL | Description |
| :--- | :--- | :--- |
| **React Web Application** | [http://localhost:5173](http://localhost:5173) | Tektalis White Theme UI (`React 18 + TypeScript + Tailwind CSS`) |
| **FastAPI REST API** | [http://localhost:8000/api/v1](http://localhost:8000/api/v1) | Base REST API endpoint |
| **Swagger / OpenAPI UI** | [http://localhost:8000/docs](http://localhost:8000/docs) | Interactive API documentation & Postman testing reference |
| **Health Check** | [http://localhost:8000/health](http://localhost:8000/health) | Container liveness probe (`{"status": "healthy"}`) |
| **PostgreSQL 17** | `localhost:5432` | Database `ams_db` (`ams_user` / `ams_password`) |

---

## 2. Default Seeded Login Credentials

On container startup, Alembic runs `alembic upgrade head` and seeds three default role accounts and four default asset categories (`Laptop`, `Monitor`, `Phone`, `Furniture`). You can also use the one-click role autofill buttons on the `/login` screen.

| Role | Email | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **`ADMIN`** | `admin@tektalis.com` | `Admin@123` | Full system access, plus User Management (`/users`) and Category creation (`POST /categories`) |
| **`ASSET_MANAGER`** | `manager@tektalis.com` | `Manager@123` | Asset Register CRUD, Assign/Return, Maintenance Log, Approve/Reject Replacements, Offboarding, Executive Reports & CSV Export |
| **`EMPLOYEE`** | `employee@tektalis.com` | `Employee@123` | View own assigned assets (`/my-assets`), raise & track replacement requests (`/replacements`), update own profile & password (`/profile`) |

---

## 3. Architecture & Domain Modules

### Backend (`backend/app/`)
Organized strictly by domain module, with each module encapsulating `models.py`, `schemas.py`, `repository.py`, `service.py`, and `router.py`:

- `common/`: Database session & `@transactional` decorator (`database.py`), JWT & BCrypt security dependencies (`security.py`), standardized JSON exception handlers (`exceptions.py`), structured stdout audit logging (`audit.py`), and idempotent startup seed (`seed.py`).
- `auth/`: current session (`GET /auth/me`) from the TT Suite portal's session cookie. Sign-in, sign-out and profile editing (the name) belong to the portal; the suite name is synced on every request.
- `users/`: user listing (`GET /users`, `GET /users/directory`) and role-change requests to the global admin (`POST /users/{id}/role-request`, `GET /users/role-requests`). Accounts, roles, emails and deactivation are the global admin's (portal → `POST /internal/provision`, see `suite/`), which keeps the `FR-14` guardrail: nobody holding assets is deactivated (`409`).
- `categories/`: Asset categories (`GET, POST /categories`) with live total & available inventory counts.
- `assets/`: Asset register (`GET, POST /assets`, `GET, PUT /assets/{id}`, `PATCH /assets/{id}/retire`) with PostgreSQL sequence-backed `AST-0001` auto-tags, immutable `tag` and `serial_no`, and optimistic locking (`version`).
- `assignments/`: Single-open-assignment enforcement via partial unique index (`WHERE returned_on IS NULL`), asset checkout (`POST /assets/{id}/assign`), return transitions (`POST /assets/{id}/return`), full lifecycle history (`GET /assets/{id}/history`), and employee asset views (`GET /me/assets`, `GET /users/{id}/assets`).
- `maintenance/`: Maintenance logging (`POST /assets/{id}/maintenance`, `GET /maintenance`) and repair completion (`PATCH /maintenance/{id}/close`) including `FR-18` automatic temporary replacement swap-back.
- `replacements/`: Employee replacement requests (`POST, GET /replacement-requests`) and atomic manager approval/rejection (`PATCH /replacement-requests/{id}/approve`, `PATCH /replacement-requests/{id}/reject`).
- `reports/`: Executive summary metrics (`GET /reports/summary`) and streaming CSV export (`GET /reports/assets.csv`).

### Standardized Error Contract
Every `400`, `401`, `403`, `404`, and `409` response returns a consistent JSON structure:
```json
{
  "status": 409,
  "message": "Detailed human-readable explanation of the error",
  "timestamp": "2026-10-19T17:30:00.000000+00:00"
}
```

---

## 4. Postman / Swagger Testing Guide

1. **Open Swagger UI**: Navigate to [http://localhost:8000/docs](http://localhost:8000/docs).
2. **Authenticate (`FR-1`)**:
   - Execute `POST /api/v1/auth/login` with `{"email": "admin@tektalis.com", "password": "Admin@123"}`.
   - Copy the `access_token` from the response and click **Authorize** in Swagger (or set `Authorization: Bearer <token>` in Postman).
3. **Register & Manage Assets (`FR-3` to `FR-6`)**:
   - Create hardware via `POST /api/v1/assets` — note the auto-generated `AST-0001` tag.
   - Search and filter via `GET /api/v1/assets?search=AST-0001&status=AVAILABLE&page=1&size=20`.
4. **Assign, Return & Offboard (`FR-7` to `FR-11`, `FR-13`, `FR-14`)**:
   - Assign an `AVAILABLE` asset to `user_id: 3` via `POST /api/v1/assets/{id}/assign`.
   - Attempt to deactivate user `3` via `PUT /api/v1/users/3` with `{"active": false}` to verify the `409 Conflict` offboarding guard.
   - Return the asset via `POST /api/v1/assets/{id}/return` with `{"next_status": "AVAILABLE", "return_reason": "EMPLOYEE_LEFT"}`.
5. **Replacement Engine & Auto-Swap (`FR-15` to `FR-18`)**:
   - Log in as `employee@tektalis.com` and submit `POST /api/v1/replacement-requests` with `{"asset_id": 1, "reason": "Screen flickering", "old_asset_action": "REPAIR", "temporary": true}`.
   - Log in as `manager@tektalis.com` and approve via `PATCH /api/v1/replacement-requests/1/approve` with `{"replacement_asset_id": 2}`.
   - Close the linked maintenance record via `PATCH /api/v1/maintenance/1/close` and verify the temporary loaner returns to `AVAILABLE`, the repaired original becomes `AVAILABLE` for manual assignment, and the replacement request becomes `COMPLETED`.
6. **Reports & Streaming CSV (`FR-12`)**:
   - Call `GET /api/v1/reports/summary` for status and category breakdowns.
   - Call `GET /api/v1/reports/assets.csv` to stream the CSV export.

Full `curl` examples and expected payloads for every sprint are documented in [`TEST_REPORT.md`](./TEST_REPORT.md).

---

## 5. Running Automated Tests & 10,000-Asset Benchmark

### Backend Test Suite (`49 passed`, including 10,000-Asset `< 1s` Benchmark)
```bash
docker exec ams-backend pytest -v
```

### Frontend Component & Workflow Test Suite (`22 passed` across 6 suites)
```bash
cd frontend
npx vitest run
```

---

## 6. Deploying to Azure App Service (Code Deployment)

Production runs as a single **Azure App Service (Linux, Python 3.12)** web app: FastAPI serves the API and the pre-built React SPA from the same origin, backed by **Azure Database for PostgreSQL Flexible Server 17**.

| File | Purpose |
| :--- | :--- |
| `infra/main.bicep` | App Service plan + web app, PostgreSQL Flexible Server + `ams_db`, Log Analytics, Application Insights |
| `deploy.ps1` | Provisions infrastructure, builds the frontend, packages `backend/` + `frontend/dist` (as `static/`), zip-deploys |
| `backend/startup.sh` | App Service startup command: `alembic upgrade head` → seed → `gunicorn` (Uvicorn workers) on `$PORT` |

### Prerequisites
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az login`, then `az account set -s <subscription>`)
- Node.js 20+ (to build the frontend locally)

### Deploy
```powershell
# First deployment: infrastructure + code (PostgreSQL provisioning takes ~10 minutes)
./deploy.ps1 -ResourceGroup rg-ams-prod -Location centralindia

# Subsequent code-only releases
./deploy.ps1 -ResourceGroup rg-ams-prod -SkipInfra

# Build the deployable zip only (.azure/build/app.zip), no Azure calls
./deploy.ps1 -ResourceGroup unused -PackageOnly
```

The script generates a PostgreSQL admin password and JWT signing key on first run and stores them in `.azure/<resource-group>.secrets.json` (git-ignored). Keep that file safe — later runs reuse it.

### App settings configured on the web app
| Setting | Value |
| :--- | :--- |
| `DATABASE_URL` | `postgresql+psycopg://…@<server>.postgres.database.azure.com:5432/ams_db?sslmode=require` |
| `JWT_SECRET_KEY` / `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | generated key / `60` (override with `-JwtExpireMinutes`) |
| `STATIC_DIR` | `static` — enables SPA serving (unset locally, where Vite serves the UI) |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` — Oryx installs `requirements.txt` during zip deploy |

### Operations
- Logs: `az webapp log tail -g <rg> -n <web-app-name>` (also streamed to Log Analytics)
- Health check: `https://<web-app>.azurewebsites.net/health`

> **Security:** the default seeded accounts (`admin@tektalis.com` / `Admin@123`, etc.) are created on first start. Sign in and change their passwords immediately. PostgreSQL accepts connections from Azure services only (firewall rule `0.0.0.0`); for stricter isolation, move to VNet integration with a private endpoint.

---

## 7. Running on Another Machine with Docker (No Source Code)

Ship a pre-built image instead of the code. The production image (root `Dockerfile`) contains the API and the compiled React UI.

**On the build machine:**
```powershell
./deploy/package.ps1            # optional: -Tag 1.0.1
```
Creates `deploy/bundle/` with `ams-app.tar` (~80 MB), `docker-compose.yml` and `.env.example`.

**On the target machine (Docker Desktop):** copy those three files into a folder, then:
```powershell
docker load -i ams-app.tar
copy .env.example .env          # set POSTGRES_PASSWORD and JWT_SECRET_KEY
docker compose up -d
```
Open http://localhost:8080. Data persists in the `postgres_data` Docker volume.

To upgrade, rebuild the bundle, then on the target run `docker load -i ams-app.tar` and `docker compose up -d`. Migrations run automatically on start.
Alternatively, push the image to a registry (Docker Hub, ACR, GHCR), set `AMS_IMAGE` in `.env` and use `docker compose pull` instead of the tar.
