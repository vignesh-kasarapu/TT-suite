# TT Suite integration contract

This is the fixed interface between the **portal** (sign-in, dashboard, global admin, gateway) and the three apps: **Kanban**, **LMS** (Leave) and **EMS** (Expense). Every app integration builds against this document.

## 1. Runtime layout (one Azure App Service, one Postgres database)

| Process | Port (localhost) | Public prefix (through the portal gateway) | DB schema |
|---|---|---|---|
| portal (gateway) | `$PORT` (local 8000) | `/`, `/api/*` | `suite` |
| kanban | 8002 | `/kanban/`, `/kanban/api/v1/*` | `public` (unchanged) |
| lms | 8003 | `/lms/`, `/lms/api/*` | `lms` |
| expense (EMS) | 8004 | `/expense/`, `/expense/api/*` | `expense` |

Gateway behaviour:
- `/<app>/api/...` → `http://127.0.0.1:<port>/api/...`. The prefix is stripped. The gateway forwards headers and cookies and adds `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Prefix: /<app>`.
- `/<app>/...` (anything else) → the app's built SPA (`index.html` fallback). The gateway serves these static files.
- `/internal/*` on an app port is **never** proxied, so it can only be reached on localhost.

Each app's uvicorn listens on `127.0.0.1` with `--proxy-headers --forwarded-allow-ips 127.0.0.1`, so per-IP rate limits see the real client IP.

Local Postgres is `deploy/docker-compose.yml` on port **5433**:
- databases `ttsuite` (run) and `ttsuite_test` (tests)
- roles `app_owner/dev` (migrations; has CREATEDB) and `app_rw/dev` (runtime)
- the `suite` schema already exists in both databases (do not drop it)

## 2. Shared library `packages/suite_core`
Install it into a venv with `pip install -e <TT-suite>/packages/suite_core`.

- `suite_core.constants`:
  - `APP_ROLES`: kanban `member|lead|admin`; lms `employee|manager|admin`; expense `member|approver|finance|admin`
  - `session_cookie_name(profile)`: `__Host-tt_session` in prod, `tt_session` otherwise
  - `INTERNAL_HEADER = "x-internal-token"`
- `suite_core.identity`:
  - `resolve(db, cookie, app)` / `aresolve(...)` returns a `SuiteIdentity` (`user_id, email, name, entra_oid, is_global_admin, session_id, session_expires_at, app_role`) or `None`.
  - `mirror_access(db, email=, name=, app=, role=|None, source="app"|"global", actor=, entra_oid=)` / `amirror_access(...)`. Call it **inside the same transaction** as your local change.
  - `revoke_sessions(db, user_id)`, `preferences(db, user_id)`.
- `suite_core.provision`: `ProvisionRequest`, `ProvisionResult`, `AuthorizeRequest`, `AuthorizeResult`, `internal_token_ok(presented, expected)`.
- `suite_core.migrate`:
  - `migrate(owner_url, runtime_role)` creates the `suite` schema.
  - `grant_schema(owner_url, schema, runtime_role)` grants the runtime role access to an app's own schema after its Alembic run.
- `suite_core.integrations.{entra_oidc, graph, smtp_mail}`: Kanban's clients, unchanged apart from the settings type.

## 3. Per-app requirements (all three apps)

### 3.1 Auth swap
Every protected request goes through these steps:
1. Read cookie `session_cookie_name(APP_PROFILE)`.
2. Call `identity.resolve(db, cookie, "<app>")`.
   - `None` → **401** (the frontend then goes to `/login?returnTo=<current path with prefix>`).
   - `app_role is None` → **403** with code `NO_APP_ACCESS` (the frontend then goes to `/?denied=<app>`).
3. Find the local user by `suite_user_id`, falling back to email.
   - If it is missing, self-heal by provisioning it from `app_role`.
   - If it is "invited", activate it.
   - If it is inactive → 403 `NO_APP_ACCESS`.
4. Build the app's existing actor / current-user object, so the existing role checks stay unchanged.

The app's own login and session issuance (OIDC, JWT, passwords, dev login) is removed from the web path. Sign-in only happens in the portal.

### 3.2 Internal routes
Mounted on the app root, not under `/api`. Each one requires header `x-internal-token == INTERNAL_TOKEN`, is CSRF-exempt and is never rate-limited.
- `POST /internal/provision`: body `ProvisionRequest` → `ProvisionResult`. On refusal it returns 4xx with `{"code","detail"}`.
  - It upserts the local user through the app's own service rules, maps the suite role to local roles, and calls `mirror_access(source=req.source, actor=req.actor_id)` in the same transaction.
  - `role=null` → deactivate the local user and mirror `None`.
  - When `source="global"`, the app does **not** send its own invite or onboarding email (the portal sends one suite invite).
- `POST /internal/authorize`: body `AuthorizeRequest` → `AuthorizeResult{allowed, role, code}`.
  - It reads `suite.app_access`; no row → `allowed=false, code=NO_APP_ACCESS`.
  - It makes sure the local user exists and is active (self-heal), then returns the effective role.
- Kanban only: `GET /internal/teams` → `[{"id","name"}]` (active teams).

### 3.3 Mirror hooks (app admin → global)
Wherever the app's own admin creates a user, changes roles or deactivates someone, call `mirror_access(..., source="app", actor=<suite user id of the acting admin if known>)` with the person's **effective suite role**:
- kanban: `admin` if `app_user.role='admin'`; otherwise `lead` if `is_lead` on any team; otherwise `member`. Inactive → `None`.
- lms: HR_ADMIN → `admin`; else MANAGER → `manager`; else `employee`. Deactivated → `None`.
- expense: ADMIN → `admin`; FINANCE → `finance`; APPROVER → `approver`; no roles → `member`. `is_active=false` → `None`.

Add a nullable unique `suite_user_id text` column to the local user table and set it whenever it is known.

### 3.4 Frontend
- Vite `base: '/<app>/'`, router basename `/<app>`, and API base `/<app>/api...`.
- On 401: `window.location.assign('/login?returnTo=' + encodeURIComponent(location.pathname + location.search))`.
- On 403 with `NO_APP_ACCESS`: `window.location.assign('/?denied=<app>')`.
- Sign out: `POST /api/auth/logout` with header `X-Requested-With: XHR`, then `location.assign('/login')`.
- App switcher in the top bar: links to **Dashboard** `/`, `/kanban/`, `/lms/` and `/expense/`, showing only the apps where `access[app]` is non-null. Data comes from portal `GET /api/me`.
- Theme: on load, call `GET /api/me` and apply `preferences.preset` (`linen|harbour|graphite`) and `preferences.mode` (`system|light|dark`) through the app's theme switcher, as `html[data-preset]` and `data-theme`. Any app theme picker writes `PUT /api/me/preferences {preset, mode}` (header `X-Requested-With: XHR`).

## 4. Portal API (used by app frontends)
All JSON is camelCase.
- `GET /api/me` → 200 `{id, email, name, isGlobalAdmin, photoUrl, access: {kanban: role|null, lms: role|null, expense: role|null}, preferences: {preset, mode}}`, or 401.
- `PUT /api/me/preferences` `{preset, mode}` → 200 with the same preferences.
- `POST /api/auth/logout` → 204 and clears the cookie.
- `GET /api/launch/{app}` → 302 to `/<app>/`, or to `/?denied=<app>`.
- `GET /login?returnTo=/kanban/...`: the portal sign-in page.

## 5. Env vars

### Shared (all processes)
- `APP_PROFILE` (`dev|test|prod`)
- `DATABASE_URL` (runtime role) and `DATABASE_OWNER_URL` (migrations)
- `INTERNAL_TOKEN`

### Per app (set by `deploy/run.py`)
- `PORT`
- `PUBLIC_BASE_URL=https://<site>/<app>` (used for links in emails)
