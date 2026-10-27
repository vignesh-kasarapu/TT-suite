# TT Suite — change log

This is the running record of every change made to bring the three Tektalis apps, **Kanban**, **LMS** (Leave) and **EMS** (Expense), under:
- one Microsoft sign-in
- one dashboard
- one global admin
- **one Azure App Service (~$18/month, B1) and one Postgres database**

It is updated after each work package. The interface between the parts is fixed in [docs/SUITE-CONTRACT.md](docs/SUITE-CONTRACT.md).

---

## Overview

| What | Before | After |
|---|---|---|
| Sign-in | Each app separately: Kanban Entra, LMS Entra, EMS password | **One Microsoft (Entra) sign-in in the portal**, using Kanban's app registration. One cookie `__Host-tt_session` shared by all apps |
| Landing | Each app's own home | **Dashboard with 3 cards: LMS, EMS, Kanban**. Clicking a card checks your role for that app and redirects into it. A card you have no access to is greyed out and offers "Request access" |
| Users and roles | Three separate user tables | **Global admin** invites by work email and grants e.g. `lms-admin`, `kanban-lead` (with teams), `expense-member`. App admins still manage their app, and every change on either side is mirrored into `app.app_access` |
| Invite mail | Kanban only | Portal sends one suite invite through **Kanban's mail stack** (Graph `sendMail` or SMTP) |
| Theme | Kanban/LMS linen; EMS forced "plain" | **One preference** (linen / harbour / graphite + system/light/dark) on the dashboard **Profile** page, applied in every app |
| Hosting | Kanban on its own App Service; LMS docker + MySQL; EMS local | **Kanban's existing App Service runs all four processes** (portal gateway + 3 apps) |
| Database | Kanban Postgres, LMS MySQL, EMS Postgres | **Kanban's existing Postgres database**, with one schema per app: `kanban`, `lms`, `expense`, and `app` (global) |

## Architecture

```
 Azure App Service (B1, Python 3.13 code deploy)   startup: python deploy/run.py
   portal :$PORT  ← the only public port; gateway + sign-in + dashboard + global admin
     /                 portal SPA          /api/*            portal API
     /kanban/*         Kanban SPA          /kanban/api/*  →  127.0.0.1:8002 (Kanban)
     /lms/*            LMS SPA             /lms/api/*     →  127.0.0.1:8003 (LMS)
     /expense/*        EMS SPA             /expense/api/* →  127.0.0.1:8004 (EMS)
 Azure Postgres Flexible (existing Kanban database)
     kanban = Kanban | app = global identity | lms | expense
```

### Sync rule
Only the owning app writes `app.app_access`, and it always does so in the same transaction as its own user or role change. The portal changes access by calling the app's `POST /internal/provision`, a localhost-only route protected by a shared token. The details are in the contract.

---

## Work package log

### WP0 — Repository, change log, contract (done)
- Added `CHANGES.md` (this file) and `docs/SUITE-CONTRACT.md`.
- Created a git repo at `TT-suite/` for the new parts (`packages/`, `portal/`, `deploy/`, `docs/`). The three app folders keep their own git repos and are git-ignored here.

### WP1 — Shared library `packages/suite_core` (done)

**New files:**

| File | Purpose |
|---|---|
| `suite_core/sql/0001_suite.up.sql` | `suite` schema: `users`, `app_access`, `session`, `user_preference`, `audit_log`, `mail_outbox`, plus grants to the runtime role |
| `suite_core/constants.py` | Apps, per-app roles, cookie name, internal header |
| `suite_core/cookies.py` | Session token, SHA-256 hash, `Set-Cookie` builders (same scheme as Kanban) |
| `suite_core/identity.py` | `resolve` / `aresolve` (cookie → person + app role); `mirror_access` / `amirror_access` (app → global, audited); `revoke_sessions`; `preferences` |
| `suite_core/provision.py` | Portal → app internal contract models; constant-time token check |
| `suite_core/migrate.py` | Forward-only SQL migrator for `suite`; `grant_schema` for the app schemas |
| `suite_core/integrations/{entra_oidc,graph,smtp_mail}.py` | Moved from Kanban, typed against a small settings Protocol |
| `suite_core/ulid.py` | Kanban's ULID generator |

**Local Postgres:** `deploy/docker-compose.yml` on port **5433**.
- Databases: `ttsuite` and `ttsuite_test`.
- Roles: `app_owner` (migrations) and `app_rw` (runtime), the same split as Azure.

**Verified:** `pytest packages/suite_core/tests` → **2 passed**. This covers creating a person and access through mirror, invited people not resolving, resolve with role, revoke, audit rows, session revoke, and unknown role refused.

### WP2 — Portal backend `portal/backend` (done)
The portal is a FastAPI app with async SQLAlchemy and psycopg 3. It uses Kanban's pins and runs with `python -m app`, which migrates `suite` and then serves on `PORT`.

| Area | Files | What |
|---|---|---|
| Config | `app/core/config.py` | Reuses Kanban's setting names (`ENTRA_*`, `MAIL_*`, `APP_SECRET`, `PUBLIC_BASE_URL`, `APP_PROFILE`, `AUTH_PROVIDER`). New: `INTERNAL_TOKEN`, `SEED_GLOBAL_ADMIN_EMAIL`, `KANBAN_URL`/`LMS_URL`/`EXPENSE_URL`, `STATIC_DIR`, `DB_POOL_SIZE`. `prod` refuses dev sign-in, the stub mailer, and a missing `INTERNAL_TOKEN` or `APP_SECRET`. |
| Sign-in | `app/services/auth_service.py`, `app/controllers/auth_controller.py`, `app/core/crypto.py` | Entra auth code + PKCE, Kanban's flow with the in-flight cookie sealed with AES-GCM. Only invited or active people get in; the first sign-in activates them, pins the Entra oid and pulls name and photo from Graph. `GET /api/auth/config`, `/api/auth/oidc/start`, `/api/auth/oidc/callback`, `POST /api/auth/logout`, plus dev-only `/api/auth/dev/users` and `/api/auth/dev/sign-in`. |
| Dashboard / me | `app/services/me_service.py`, `app/controllers/me_controller.py` | `GET /api/me` (access per app, theme), `PUT /api/me/preferences`, `GET /api/me/photo`, `POST /api/me/request-access` (emails every global admin). **`GET /api/launch/{app}`** checks the role in the app (`/internal/authorize`, which also self-heals the app's local user), audits, then redirects to `/<app>/`. With no access it goes to `/?denied=<app>`; if the app is down, to `/?unavailable=<app>`. |
| Global admin | `app/services/admin_service.py`, `app/controllers/admin_controller.py`, `app/services/apps_client.py` | `GET/POST /api/admin/users` (invite by work email with roles per app; a Kanban *lead* needs teams), `PUT /api/admin/users/{id}/access`, `PATCH /api/admin/users/{id}` (name, global admin, deactivate/reactivate), `POST …/resend-invite`, `GET /api/admin/kanban-teams`, `GET /api/admin/directory` (Graph search), `GET /api/admin/audit`. Every access change goes through the owning app's `/internal/provision`. One app refusing does not block the others, and the refusal is shown per app. Guards: cannot deactivate yourself, and the last global admin stays. |
| Mail | `app/services/mail_service.py` | Uses **Kanban's mail stack** (Graph `sendMail` or SMTP, same sender) through the `app.mail_outbox` table. The worker sends every 15 s and retries 5 times with backoff. Kinds: `suite_invited`, `suite_access_changed`, `request_access`. `stub` mode only records mail (`GET /api/dev/mail`). |
| Gateway | `app/gateway.py` | One public port. Proxies `/<app>/api/*` to `127.0.0.1:<port>/api/*` (strips the prefix, streams, forwards cookies, adds `X-Forwarded-*`) and serves each SPA with an `index.html` fallback. Hashed assets are cached for a year. `/internal/*` cannot be reached from outside. |
| Health | `app/controllers/system_controller.py` | `GET /api/health` reports the database and all 4 services. It returns 503 only when the database is down. |
| Security | `app/main.py` | CSRF header `X-Requested-With: XHR` on non-GET `/api/*` (as Kanban), `nosniff`, `DENY` framing, CSP on the portal and Kanban shells. |
| Seed | `app/main.py` | At boot `SEED_GLOBAL_ADMIN_EMAIL` becomes global admin and is given **admin in all three apps**, retrying until the apps answer. |

**Verified:** `cd portal/backend && .venv/Scripts/python -m pytest -q tests` → **14 passed**. The three apps are faked with the real contract (mirror into `app.app_access`). The tests cover:
- admission
- seed
- invite with LMS admin, Kanban lead with a team, and Expense member, sending one email
- lead without a team refused
- one app refusing while the others apply
- card launch: redirect, denied, anonymous, app down
- access change and deactivate
- guards and CSRF
- preferences
- request access
- gateway static, proxy and internal-path blocking
- health

### WP3 — Portal frontend `portal/frontend` (done)
React 19 + Vite + TS with Kanban's `tokens.css`, `global.css`, `theme-switch.ts` and logo, so it has the same look.
- **Sign-in** (`pages/SignIn.tsx`): "Sign in with Microsoft", plain-language errors (not invited, expired) and the dev picker.
- **Dashboard** (`pages/Dashboard.tsx`): **3 cards: LMS, EMS, Kanban**, each showing your role badge. A card you have access to goes to `/api/launch/<app>`, which authorizes and redirects. A card you can't open is greyed out and opens **Request access**.
- **Profile** (`pages/Profile.tsx`): your access per app and the **theme** (Linen, Harbour, Graphite × System, Light, Dark), saved once and applied in every app.
- **Users & access** (`pages/AdminUsers.tsx`, global admin only): table on desktop and cards on mobile with LMS/EMS/Kanban role columns.
  - Invite dialog with Entra directory search, a role per app, the Kanban team picker for *lead*, and the global admin flag.
  - Also: edit access, resend invite, deactivate and reactivate.
- **Audit log** (`pages/AdminAudit.tsx`): every change, marked as made by the global admin or by an app admin.

**Verified:** `npm run build` (tsc + vite) is clean. Screenshots were checked at 1280 px and 390 px (dashboard, invite dialog, profile).

### WP4 — Kanban integration `Kanban-internal-main/` (done; app repo, uncommitted)
Kanban's live data stays where it is (`public`). The only database change is additive.

- **Migration `0021_suite_user`:** `app_user.suite_user_id text UNIQUE` (has a down script).
- **Sign-in:**
  - The actor comes from the suite cookie, matched by `suite_user_id` and then by email.
  - An *invited* user is activated on first visit, and a missing local user is self-healed.
  - Inactive, or no Kanban role → 403 `NO_APP_ACCESS`.
  - Kanban's OIDC routes, `oidc_service.py` and its own sign-out are removed, and the `session` table is no longer written. `/auth/config` returns `suite`.
  - The dev/test sign-in now issues a suite session (never in prod).
- **Shared code:** `app/integrations/{entra_oidc,graph,smtp_mail}.py` now re-export `suite_core`, so Kanban's mail still goes through the same code.
- **Internal routes:**
  - `/internal/provision`: member, lead or admin. *Lead* joins the chosen teams and sets `is_lead`; other roles clear lead; `null` makes the user inactive. A global invite sends no Kanban mail.
  - `/internal/authorize`.
  - `/internal/teams`.
- **Mirror** (app admin → global): invite, role and status change, team add, remove, lead toggle and delete, seed. The effective role is admin > lead on any team > member.
- **Boot backfill:** existing Kanban users are mirrored into the suite on first start, so nobody loses Kanban access at cutover. `deploy/sql/kanban-backfill.sql` does the same by hand.
- **Frontend:**
  - `/kanban/` base, `/kanban/api/v1` client.
  - 401 goes to the suite sign-in; no access goes to `/?denied=kanban`.
  - App switcher in the top bar; sign-out goes through the portal.
  - The theme toggle and the Preferences preset and mode write the suite preference.
- **Env:** new `INTERNAL_TOKEN`, `DB_POOL_SIZE` (default 5; was a fixed 10) and `BIND_HOST` (default `127.0.0.1`). `AUTH_PROVIDER` now defaults to `suite`. `ENTRA_*` are only needed for Graph (directory and mail).
- **Verified:**
  - backend `pytest` → **108 passed**, including 10 new suite tests
  - `ruff`, `mypy` (144 files) and the OpenAPI contract check are clean
  - frontend `typecheck`, `lint` and `build` pass
  - vitest → 19 passed
- **Not done:** Kanban's Playwright e2e specs still assume stand-alone Kanban on :8080. They need pointing at the gateway (`/kanban/`, suite cookie). The suite-level browser run below covers the main flows instead.

### WP5 — EMS (Expense) integration `ems/` (done; app repo, uncommitted)
- **Database:** pg8000 → psycopg 3. All tables are in schema **`expense`** (`search_path`, Alembic `version_table_schema`). `python -m app` migrates, grants the runtime role, then serves on `127.0.0.1:8004`.
- **Migration** `7c3d9e1a2b4f_tt_suite_sign_in`: adds `users.suite_user_id` (unique) and makes `password_hash` nullable.
- **Sign-in:**
  - Passwords, JWTs and the login page are removed; `current_user` reads the suite cookie.
  - No access returns 403 `NO_APP_ACCESS`.
  - "Sign out everywhere" revokes suite sessions.
  - There is a dev-only `/api/auth/dev/sign-in`.
  - The CSRF header is required on writes.
- **`/internal/provision`, `/internal/authorize`:**
  - Roles map member→[], approver→[APPROVER], finance→[FINANCE], admin→[ADMIN].
  - `role_conflict` is enforced: a Manager can't be given Finance or Admin from the portal; the EMS admin has to change that person's roles in EMS first.
  - New people get an employee code made from their email (e.g. `JANE-DOE`).
  - Revoking runs the leaver flow.
- **Mirror** (app admin → global): `save_user`, CSV import, leaver and seed.
- **Frontend:**
  - Served under `/expense/` and uses cookies; the localStorage token is gone.
  - 401 goes to the suite sign-in; no access goes to `/?denied=expense`.
  - App switcher in the top bar.
  - The theme follows the suite preference; EMS no longer forces "plain".
  - Admin user form has no password.
- **Env:** new `APP_PROFILE`, `DATABASE_OWNER_URL`, `INTERNAL_TOKEN`, `HOST`, `PORT`. Removed `JWT_SECRET`, `JWT_EXPIRE_MINUTES`.
- **Verified:** `cd ems/backend && .venv-suite/Scripts/python -m pytest -q` → **47 passed** (34 existing + 13 new suite tests). `npm run build` and `npm run lint:tokens` pass (0 contrast failures).
- **Notes:**
  - `UPLOAD_DIR` is set by `deploy/run.py` to `/home/data/expense/uploads` on Azure.
  - The old `ems/docker-compose.yml` is no longer used.
  - The unused columns (`preset`, `theme_mode`, `token_version`) are kept and were not dropped.

### WP6 — LMS (Leave) moved MySQL → PostgreSQL and integrated `lms-2.0-main/lms-2.0-main/` (done; app repo, uncommitted)
Only `backend-py/` and `frontend/` changed. The legacy Node `backend/` and the `mobile/` app are untouched.

- **Database:**
  - pymysql → psycopg 3. Tables are in schema **`lms`** (`search_path`, `lms.alembic_version`).
  - The two MySQL migrations were replaced by one reviewed Postgres baseline, `0001_initial_postgres_schema` (`alembic check` clean).
  - MySQL's case-insensitive behaviour is kept with `lower(email)` / `lower(employee_code)` unique indexes and case-insensitive lookups.
  - Date comparisons are fixed for Postgres. There is a partial unique index for one active self-approval grant.
  - `python -m app` locks, creates the schema, upgrades, grants the runtime role, seeds reference data on a fresh schema, then serves on `127.0.0.1:8003`.
- **Sign-in:**
  - The web path uses the suite cookie. LMS's own OIDC routes and JWT cookie are removed.
  - The **mobile bearer flow is kept unchanged**.
  - CSRF header required; dev-only `/api/auth/dev/sign-in`.
- **`/internal/provision`, `/internal/authorize`:**
  - Roles map employee→EMPLOYEE, manager→EMPLOYEE+MANAGER, admin→EMPLOYEE+HR_ADMIN (an existing MANAGER grant is kept).
  - `null` deactivates the employee, and a later role reactivates them.
  - The **last HR admin is protected** (400 `LAST_HR_ADMIN`).
  - New people go through normal onboarding, so they get pro-rata entitlements. The LMS invite email is skipped when the global admin invites, because the portal sends the one suite invite.
- **Defaults for someone invited from the portal:**
  - employee code `SU-xxxxxxxx`, name from Microsoft or the email
  - joined today, designation "Employee"
  - department "Unassigned" (created if missing)
  - grade, region, management level and manager empty for HR to fill in
- **Mirror** (app admin → global): role assign and revoke, onboarding including bulk import, deactivate and reactivate, work-email change, seeds. There is a new HR-admin `POST /api/employees/{id}/reactivate`.
- **Frontend:**
  - Served under `/lms/`. Sign-in, sign-out, `/api/me` and the theme come from the portal.
  - App switcher in the top bar and sidebar.
  - 401 goes to the suite sign-in; no access goes to `/?denied=lms`.
- **Env:** new `APP_PROFILE`, `DATABASE_URL`, `DATABASE_OWNER_URL`, `DB_POOL_SIZE`, `INTERNAL_TOKEN`, `HOST`, `PORT`, `PUBLIC_BASE_URL`, `STORAGE_DIR` (`/home/data/lms` on Azure, set by `run.py`), `SCHEDULER_ENABLED`. The web path no longer uses `ENTRA_CLIENT_*`, `ENTRA_REDIRECT_URI` or `SESSION_COOKIE_NAME`.
- **Verified:** `cd backend-py && .venv-suite/Scripts/python -m pytest -q` → **65 passed** (23 new suite tests), twice in a row. The demo seed loaded on Postgres. Every GET endpoint, called as HR admin, manager and employee, returned no server errors. `npm run build` passes.
- **Known gaps:**
  - Write endpoints not covered by tests may still hit a Postgres type mismatch. Smoke-test leave apply, approve and cancel after deploy.
  - In onboarding the employee row can commit before its mirror. Self-heal on launch covers this.
  - The old root `docker-compose.yml` and `frontend/nginx.conf` still describe MySQL and are not used by the suite.

### WP7 — One App Service deploy `deploy/` (done; Azure steps in `deploy/README.md`)
- **`deploy/run.py`:** the startup command. It runs the 4 processes (portal on `$PORT`, Kanban 8002, LMS 8003, Expense 8004), each in its own folder so the three `app` packages never clash.
  - Restarts a crashed process with backoff and stops all of them on SIGTERM.
  - Prefixes every log line with the process name.
  - Sets each app's port, `PUBLIC_BASE_URL` (`…/<app>`), pool size and persistent data directories (`/home/data/<app>` on App Service).
- **`deploy/build.mjs`** (`npm run suite:package`): builds the 4 SPAs and assembles `dist-suite/` (`apps/*`, `static/*`, `packages/suite_core`, `deploy/run.py`). It writes **one merged `requirements.txt`**, keeping the first pin and printing any differences.
- **`deploy/docker-compose.yml`:** local Postgres on 5433 with the owner/runtime role split.
- **`deploy/sql/kanban-backfill.sql`:** the one-time, idempotent Kanban cutover (people, links, Kanban roles into the suite).
- **`deploy/README.md`:** the Azure guide for the **existing** B1 web app and **existing** Kanban database. It covers the startup command, health path, new and changed App Settings, the Entra redirect URI, the cutover, checks and rollback.
- **Cost:** no new Azure resources.
- **Changes after the first full run:**
  - `run.py` migrates `suite` **before** starting any app, because Kanban's boot backfill writes to it.
  - It loads one shared local `TT-suite/.env` (template `deploy/.env.example`) so stale per-app `.env` files can't point an app at the wrong database.
  - It sets LMS `STORAGE_DIR`.
  - On Windows it stops whole process trees (venv launchers).

### WP8 — Kanban cutover (ready; runs on deploy day)
Follow `deploy/README.md` steps 0 and 7: back up, deploy, then run `deploy/sql/kanban-backfill.sql`. Kanban also backfills itself at boot.

### WP9 — One schema per app (2026-10-25, done)
Every table now sits in a schema named after its owner: `kanban`, `lms`, `expense`, and `app` for the global tables. Table names are unchanged.
- **Global `suite` → `app`:** `suite_core.migrate` renames an existing `suite` schema once (data, indexes and grants come along), then runs as before. All SQL and docs use `app.users`, `app.app_access`, … Code names (`suite_core`, `suite_user_id`, the cookie) are unchanged.
- **Kanban `public` → `kanban`:** `app.db.migrate.ensure_schema` runs before Kanban's migrations. When `kanban` does not exist yet and `public` holds Kanban's tables, it moves every table (with indexes, constraints, triggers and owned sequences), the standalone sequence `card_number_seq` and the function `append_only_violation` in one transaction. Extension objects stay in `public`.
- **Kanban connections** (runtime, migrations, tests) set `search_path=kanban,public` through `sqlalchemy_url()` / `with_search_path()`, so its SQL stays unqualified.
- **Cutover SQL:** `deploy/sql/kanban-backfill.sql` now reads `kanban.*`. New `deploy/sql/kanban-schema-rollback.sql` moves Kanban back to `public` for the old build.
- **Performance:** none. A schema is only a label; the search path is set once per pooled connection.
- **Verified:** suite_core **3** (new: rename of an old `suite` schema), portal **18**, Kanban **109** (new: a pre-suite database with everything in `public` moves into `kanban`, rows, sequence position and grants kept), LMS **67**, EMS **47** → **244 passed**. The local `ttsuite` database was upgraded in place by a normal boot (backup taken first): same row counts before and after (11 Kanban users, 12 people, 31 access rows); sign-in, launching all three apps and API calls into each worked.


### WP10 — One repository (2026-10-26, done)
The three apps' code now lives in the `TT-suite` repository itself (it had been committed as broken pointers to the apps' own repositories, which GitHub cannot resolve).
- The apps' own `.git` folders were moved out to `Desktop/TT-suite-app-git-backup/` (history kept, including EMS's local-only commit); the old Kanban and LMS repositories on GitHub are history only.
- CI checks out one repository: the `checkout-apps` action, `EMS_REPO` and `APPS_REPO_TOKEN` are gone.
- Not committed: `.playwright-mcp/` browser snapshots (now ignored).


### WP11 — Asset Management (AMS) joins the suite (2026-10-27, done)
The Asset Manager (`asset-manager/`, from `aniketh2207/asset-manager`; its `.git` kept in `Desktop/TT-suite-app-git-backup/`) is the fourth app: dashboard card, roles assigned by the global admin, one sign-in.
- **Suite:** app `ams`, title "Asset Management" (AMS), prefix **`/ams/`** (not `/assets/`: every built SPA serves its own files under `<prefix>/assets/`), port **8005**. Roles **employee / manager / admin** = AMS `EMPLOYEE / ASSET_MANAGER / ADMIN`. `suite_core` migration `0002_asset_manager` allows `ams` in `app.app_access`.
- **AMS backend:** tables in schema `ams` (`search_path`, Alembic version table there); `python -m app` migrates, grants the runtime role, seeds categories, links existing active users to the suite, serves on 127.0.0.1:8005. Sign-in reads the suite cookie (`app/common/security.py`; `require_roles` unchanged, so no router changed). No login, passwords or JWT any more (migration `0011_tt_suite_sign_in`: `suite_user_id`, optional `password_hash`). `/internal/provision` + `/internal/authorize`; every AMS admin change to a user (create, edit, import, deactivate, profile name) is mirrored in the same transaction. The AMS rule "nobody holding assets is deactivated" also refuses a revoke from the portal (409, shown per app). CSRF header on writes; errors carry an optional `code` (e.g. `NO_APP_ACCESS`).
- **Demo accounts:** the stand-alone AMS created `admin@`, `manager@`, `employee@tektalis.com` with published passwords. Fresh databases no longer get them; `0011` deactivates them in an existing AMS database, and the boot link skips inactive users, so they never reach the suite.
- **AMS frontend:** served under `/ams/`; cookie instead of a stored token; no login page (the suite sign-in, back afterwards); profile without password change, email read-only; users without password fields; app switcher listing the apps the person can open. It keeps its own Tailwind look and does **not** follow the suite theme.
- **Portal:** fourth dashboard card (4 columns on wide screens, 2 below 1200 px, 1 on phones); AMS column and role picker in Users & access, the invite dialog and CSV import (column `ams`); gateway, health and launch for `ams`. Kanban, LMS and EMS switchers list AMS.
- **Pre-existing AMS problems found (not caused by the integration):** the original `npm run build` failed its TypeScript check (two typing errors in `AssetsPage.tsx` and its test; fixed). The backend test `test_employee_one_time_fill_held_asset_details` also fails in the original (an empty fill answers 409 instead of 400); marked `xfail(strict)` so CI flags it once fixed.
- **Not done:** moving data from an existing stand-alone AMS deployment into the suite database (a one-time export/import, like the Kanban cutover). The boot link then brings its active users into the suite.


### WP12 — Docker, try-out and production (2026-10-27, done)
`docker compose up --build` runs the whole suite (`Dockerfile`: Node 24 builds the five frontends with `deploy/build.mjs`, Python 3.13 runs `deploy/run.py`; non-root, health check, data on volumes).
- **One switch, `DEV_MODE`:** `true` (default) = developer sign-in, stub mail, `deploy/seed.json` people. `false` = production: `APP_PROFILE=prod`, Sign in with Microsoft, real mail, no seed people, `ENTRA_REDIRECT_URI` derived from `PUBLIC_BASE_URL`. Implemented in `deploy/run.py` (`apply_dev_mode`), so it applies only where `DEV_MODE` is set; Azure and local runs are unchanged.
- **Start-up check (production):** refuses to start, listing every problem: missing Entra/secrets/admin, no real mail provider, non-https address, malformed `APP_SECRET`, demo `INTERNAL_TOKEN`, placeholder `SESSION_JWT_SECRET`, weak built-in database passwords.
- **Settings:** `deploy/docker.defaults.env` (in git, try-out) overridden by `.env.docker` (git-ignored; template `deploy/docker.env.example`). The built-in database's roles get their passwords from there (`deploy/docker/db-init/01-roles.sh`). The app port is bound to 127.0.0.1; optional HTTPS front end (`--profile https`, Caddy, automatic certificates).
- **Portal:** an unreachable or wrong Entra tenant now sends the person back to sign-in with a plain message (`OIDC_UNAVAILABLE`) and logs the cause, instead of a 500.
- **Verified in containers:** try-out mode (dev sign-in, seeded people, roles created); production with nothing set (refused, full list); production fully configured with placeholder Entra values (all five services healthy, developer sign-in 404, API docs hidden, redirect to login.microsoftonline.com with PKCE and the derived callback, `Secure` cookie). A real Microsoft sign-in needs the real app registration.


### WP13 — Central roles, inbox, sliding sessions, one look (2026-10-27, done)
- **Accounts and roles only in the portal.** Kanban, LMS, EMS and AMS no longer invite/create people, change roles, (de)activate or change emails/names. Each app's user management has **Request role change** (`suite_core.inbox.request_role_change`), which goes to the global admins' **Inbox**; approve applies it through `/internal/provision` (a refusal keeps it open with the reason), decline tells the requester. Dashboard "Request access" creates the same kind of request.
- **Kept per app:**
  - Kanban: teams and ordinary members.
  - LMS: designation, department, grade, level, region, manager, all leave admin, plus "My HR details".
  - EMS: employee code, department, designation, phone, location, manager, plus "Bank & notifications".
  - AMS: the asset workflows.
- **Removed endpoints:**
  - Kanban: `POST /users`, `GET /users/directory`, `PATCH /users/{id}`, `POST /users/{id}/invite`, `PATCH /teams/{id}/members/{userId}`, `PATCH /me/profile`.
  - LMS: `POST /api/employees`, `/bulk-import`, `POST|DELETE /{id}/roles`, `/{id}/deactivate|reactivate`; name and email are no longer editable.
  - EMS: `POST /api/admin/users`, `/import`, `/api/auth/me/sign-out-everywhere`; user edits are details-only.
  - AMS: `POST|PUT /api/v1/users`, `/users/import*`, `PUT /auth/me`.
- **Inbox** (`app.message`, migration `0003`): requests, decisions, invitations, access changes, signed-out-everywhere. Top-bar Inbox with unread count.
- **Sessions:** 24 h idle, 30 days at most (`SESSION_IDLE_HOURS`, `SESSION_MAX_DAYS`), slid by `identity.resolve` at most every 5 min in its own transaction; several devices per person (device list with browser/OS). **Sign out** everywhere goes to the portal `/signout`: this device or all devices.
- **Profile and theme** only in the portal (`PUT /api/me/profile` for the name; apps copy the suite name on each request). AMS now follows the suite theme (Tailwind colours mapped to the tokens). Top bars 64 px, sidebars 256 px in every app.
- **Verified:**
  - Backends: suite_core 7, portal 25, LMS 76, EMS 49, AMS 64 (+1 known xfail).
  - Frontends: all five build; AMS 37 unit tests; Kanban typecheck, lint and contract are clean.
  - E2E: **22 passed**, including the role request approved in the Inbox, sign-out on two devices, and the theme in all four apps.
- **Not re-run:** Kanban backend pytest on the final code (stopped on request; 112 passed before its last, frontend-only round). Kanban's own Playwright specs (`Solution/tests/e2e`) still expect the old Kanban sign-out, theme and lead toggles and need rewriting.
- **Open decision:** LMS people added from the portal get today as their joining date (their opening pro-rata leave is posted from it) and HR cannot change it afterwards.

### WP14 — Same top-bar controls everywhere (2026-10-27)
- **Controls:** every top bar (dashboard, Kanban, LMS, EMS, AMS) ends with light/dark toggle → Inbox with unread badge → avatar + name → sign out (contract 3.5). The toggle saves the suite preference, so switching in one app switches all of them.
- **Inbox:** the dashboard's Inbox moved from the main nav to beside the name.
- **Logo:** the Tektalis logo in every app goes to the main dashboard.
- **Kanban:** its own in-app notifications button now uses a bell icon, so it isn't confused with the suite Inbox.
- **LMS:** "My HR details" moved from the avatar menu to the sidebar.
- **E2E:** `e2e/tests/top-bar.spec.ts` covers the controls, the cross-app toggle and the logo.

---

## Verification (all run locally against the one Postgres database)

### Shared environment
Azure installs only `dist-suite/requirements.txt`, so every suite was also run in **one venv built from that merged file**: FastAPI 0.142, SQLAlchemy 2.1, Pydantic 2.13. That includes LMS, which had older pins.

| Suite | Command | Result |
|---|---|---|
| suite_core | `pytest packages/suite_core/tests` | 2 passed |
| Portal | `cd portal/backend && pytest tests` | 14 passed |
| Kanban | `cd Kanban-internal-main/Solution/backend-py && pytest` (env in WP4 report) | 108 passed |
| LMS | `cd lms-2.0-main/lms-2.0-main/backend-py && pytest` | 65 passed |
| EMS | `cd ems/backend && pytest` | 47 passed |
| **Total** | | **236 passed, 0 failed** |

### End to end in a browser
All four processes ran under `python deploy/run.py`, through the gateway on :8000, with dev sign-in and the stub mailer. **23 of 23 checks passed:**
1. An anonymous visit to `/kanban/` goes to the suite sign-in and comes back to `/kanban/` afterwards.
2. The global admin's dashboard shows **3 cards (LMS, EMS, Kanban), all Admin**. Each card authorizes and opens its app.
3. Invite from the UI: **LMS admin + EMS member + Kanban lead (team chosen)** gives the matching access matrix and **exactly one invite email**.
4. The invited person sees badges Admin, Member and Lead. Kanban shows them as lead of the team, LMS has `HR_ADMIN`, and EMS has a plain member.
5. **App admin → global:** the Kanban admin promotes the person inside Kanban, and the portal matrix shows Kanban *admin*.
6. **Global → app:** the global admin sets Expense to *finance*, and EMS shows `FINANCE`.
7. **Theme:** Harbour + Dark set once in Profile is applied in `/lms/`, `/expense/` and `/kanban/`.
8. **Revoke LMS:** the card is denied and a direct `/lms/` visit lands on the dashboard's denied banner.
9. **Deactivate:** the same cookie gets 401 from the portal and all three apps.
10. **Audit:** it shows changes from both the global and the app side.

`/api/health` showed `ok` for portal, Kanban, LMS and Expense. Each process migrated its own schema: Kanban 0001–0021 in `public`, LMS baseline in `lms`, EMS in `expense`, and `suite`.

---

## Open items / risks
- **Nothing is deployed yet.** Follow `deploy/README.md`. Before go-live, check real Entra sign-in and a real Graph invite email (dev sign-in and stub mail were used locally).
- **B1 memory:** 4 Python processes plus schedulers should fit (~500–700 MB of 1.75 GB). Watch *Memory working set* for the first day. Mitigations: lower `DB_POOL_SIZE`, or move to B2.
- **Single instance only:** the in-process schedulers (Kanban mails, EMS reminders, LMS jobs) would run twice on two instances.
- **LMS on Postgres:** write paths not covered by tests should get a smoke test after deploy (apply, approve and cancel leave; holidays; reports).
- **Kanban Playwright e2e** needs re-pointing at the gateway.
- **LMS mobile app** keeps its own bearer sign-in and is not part of the suite SSO.
- **EMS role conflict:** someone who is an EMS *Manager (approver)* can't be made Finance or Admin from the portal. The EMS admin changes that in EMS first, by design.
- **Local only:** Kanban's own `Solution/backend-py/.env` still has `SEED_ADMIN_EMAIL`, which creates an extra local Kanban admin. Per-app `.env` files are not deployed.
- **Commits:** none yet. The suite repo (`TT-suite/`) is initialised with nothing committed. The three app repos have uncommitted changes.
