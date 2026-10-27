# TT Suite integration contract

This is the fixed interface between the **portal** (sign-in, dashboard, global admin, gateway) and the four apps: **Kanban**, **LMS** (Leave), **EMS** (Expense) and **AMS** (Asset Management). Every app integration builds against this document.

## 1. Runtime layout (one Azure App Service, one Postgres database)

| Process | Port (localhost) | Public prefix (through the portal gateway) | DB schema |
|---|---|---|---|
| portal (gateway) | `$PORT` (local 8000) | `/`, `/api/*` | `app` (global) |
| kanban | 8002 | `/kanban/`, `/kanban/api/v1/*` | `kanban` (moved from `public` on first boot) |
| lms | 8003 | `/lms/`, `/lms/api/*` | `lms` |
| expense (EMS) | 8004 | `/expense/`, `/expense/api/*` | `expense` |
| ams (Asset Management) | 8005 | `/ams/`, `/ams/api/v1/*` | `ams` |

Gateway behaviour:
- `/<app>/api/...` → `http://127.0.0.1:<port>/api/...`. The prefix is stripped. The gateway forwards headers and cookies and adds `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Prefix: /<app>`.
- `/<app>/...` (anything else) → the app's built SPA (`index.html` fallback). The gateway serves these static files.
- `/internal/*` on an app port is **never** proxied, so it can only be reached on localhost.

Each app's uvicorn listens on `127.0.0.1` with `--proxy-headers --forwarded-allow-ips 127.0.0.1`, so per-IP rate limits see the real client IP.

Local Postgres is `deploy/docker-compose.yml` on port **5433**:
- databases `ttsuite` (run) and `ttsuite_test` (tests)
- roles `app_owner/dev` (migrations; has CREATEDB) and `app_rw/dev` (runtime)
- the global `app` schema (called `suite` before 2026-10-25; renamed automatically) exists in both databases (do not drop it)
- every app sets `search_path` to its own schema on each connection (`options=-csearch_path=<schema>`) and writes the global tables in full (`app.users`)

## 2. Shared library `packages/suite_core`
Install it into a venv with `pip install -e <TT-suite>/packages/suite_core`.

- `suite_core.constants`:
  - `APP_ROLES`: kanban `member|lead|admin`; lms `employee|manager|admin`; expense `member|approver|finance|admin`; ams `employee|manager|admin` (AMS `EMPLOYEE|ASSET_MANAGER|ADMIN`)
  - `session_cookie_name(profile)`: `__Host-tt_session` in prod, `tt_session` otherwise
  - `INTERNAL_HEADER = "x-internal-token"`
- `suite_core.identity`:
  - `resolve(db, cookie, app)` / `aresolve(...)` returns a `SuiteIdentity` (`user_id, email, name, entra_oid, is_global_admin, session_id, session_expires_at, app_role`) or `None`.
  - `mirror_access(db, email=, name=, app=, role=|None, source="app"|"global", actor=, entra_oid=)` / `amirror_access(...)`. Call it **inside the same transaction** as your local change.
  - `revoke_sessions(db, user_id)`, `preferences(db, user_id)`.
- `suite_core.provision`: `ProvisionRequest`, `ProvisionResult`, `AuthorizeRequest`, `AuthorizeResult`, `internal_token_ok(presented, expected)`.
- `suite_core.migrate`:
  - `migrate(owner_url, runtime_role)` creates the global `app` schema (renaming an old `suite` schema once).
  - `grant_schema(owner_url, schema, runtime_role)` grants the runtime role access to an app's own schema after its Alembic run.
- `suite_core.integrations.{entra_oidc, graph, smtp_mail}`: Kanban's clients, unchanged apart from the settings type.

## 3. Per-app requirements (every app)

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
  - It reads `app.app_access`; no row → `allowed=false, code=NO_APP_ACCESS`.
  - It makes sure the local user exists and is active (self-heal), then returns the effective role.
- Kanban only: `GET /internal/teams` → `[{"id","name"}]` (active teams).

### 3.3 Roles and accounts are central (since WP13)
Only a **global admin**, in the portal, creates accounts (invite, CSV import) and assigns or removes roles. An app's own user management does **not** create users, change roles, (de)activate people or change their email or name. Its admins may still edit the app's own data about a person (LMS department, grade, manager; EMS employee code; Kanban team membership; ...).

To change a role, an app admin uses **Request role change** in the app's user management. The app calls `suite_core.inbox.request_role_change(db, app=, email=, role=|None, requested_by=<the admin's suite user id>, note=, lead_team_ids=)` (async: `arequest_role_change`) and commits. It replaces any open request for that person and app, and every global admin gets an inbox message. The global admin approves or declines in the portal **Inbox**; approving applies the role through the app's `/internal/provision`, exactly like a change in Users & access. If the app refuses (e.g. EMS role conflict, LMS last HR admin, AMS assets still held), the request stays open and the reason is shown. `pending_requests(db, app)` lists open requests for the app's UI.

The person's **name** is edited only in the portal profile. On each request, an app copies the suite name onto its local user when they differ.

### 3.4 Mirror hooks (provision → global)
Where the app applies a change (through `/internal/provision`, or its own seeds and boot backfill), call `mirror_access(..., source="app", actor=<suite user id of the acting admin if known>)` with the person's **effective suite role**:
- kanban: `admin` if `app_user.role='admin'`; otherwise `lead` if `is_lead` on any team; otherwise `member`. Inactive → `None`.
- lms: HR_ADMIN → `admin`; else MANAGER → `manager`; else `employee`. Deactivated → `None`.
- expense: ADMIN → `admin`; FINANCE → `finance`; APPROVER → `approver`; no roles → `member`. `is_active=false` → `None`.

Add a nullable unique `suite_user_id text` column to the local user table and set it whenever it is known.

### 3.5 Frontend
- Vite `base: '/<app>/'`, router basename `/<app>`, and API base `/<app>/api...`.
- On 401: `window.location.assign('/login?returnTo=' + encodeURIComponent(location.pathname + location.search))`.
- On 403 with `NO_APP_ACCESS`: `window.location.assign('/?denied=<app>')`.
- Sign out: `location.assign('/signout')`. The portal page offers **this device** or **all devices** (several devices per person are allowed).
- Profile and preferences: link to the portal `/profile` (full page load); no profile, name or theme editing in the app.
- Bars: the top bar is 64px tall; a left sidebar (where the app has one) is 256px wide.
- The Tektalis logo links to the suite dashboard `/` (full page load, `data-testid="brand-home"`), not to the app's own home.
- The right end of every top bar has the same four controls, in this order (app-specific buttons go to their left):
  1. **Light/dark toggle**: a 36px button with `data-testid="theme-toggle"`. It applies the other mode at once, then saves it with `PUT /api/me/preferences {preset, mode}` (`X-Requested-With: XHR`), so every app follows.
  2. **Inbox**: `<a href="/inbox">`, `data-testid="inbox-link"`, aria-label `Inbox` or `Inbox, N unread`, with an accent badge (99+). The count is `unreadCount` from `GET /api/me`, read again when the tab becomes visible.
  3. **Avatar + name**: links to `/profile`.
  4. **Sign out**: goes to `/signout`.
- App switcher in the top bar: links to **Dashboard** `/`, `/kanban/`, `/lms/`, `/expense/` and `/ams/`, showing only the apps where `access[app]` is non-null. Data comes from portal `GET /api/me`.
- Theme: on load, call `GET /api/me` and apply `preferences.preset` (`linen|harbour|graphite`) and `preferences.mode` (`system|light|dark`) through the app's theme switcher, as `html[data-preset]` and `data-theme`. The theme is chosen only in the portal profile.

## 4. Portal API (used by app frontends)
All JSON is camelCase.
- `GET /api/me` → 200 `{id, email, name, isGlobalAdmin, photoUrl, access: {kanban, lms, expense, ams: role|null}, preferences: {preset, mode}, unreadCount}`, or 401.
- `PUT /api/me/preferences` `{preset, mode}` → 200 with the same preferences.
- `POST /api/auth/logout` `{everywhere?: bool}` → 200 `{signedOut: n}` and clears the cookie (`everywhere` ends every device's session).
- `GET /api/me/sessions` → the person's devices `{items: [{createdAt, lastSeenAt, expiresAt, userAgent, current}]}`.
- `GET /api/me/inbox`, `POST /api/me/inbox/read {ids?}`: the suite inbox. `PUT /api/me/profile {name}`: the display name.
- Sessions slide: each request moves the end to 24 h from now (`SESSION_IDLE_HOURS`), never beyond 30 days from sign-in (`SESSION_MAX_DAYS`); `suite_core.identity.resolve` does it for every app.
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
