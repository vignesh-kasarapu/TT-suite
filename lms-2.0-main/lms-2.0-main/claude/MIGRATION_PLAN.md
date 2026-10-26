# LMS-V2 → Python/FastAPI + React Native Migration Plan

## Context

The current stack is Node.js/Express/Sequelize (`backend/`) + React/Vite (`frontend/`), documented in the root `README.md`. This plan covers rewriting the backend in **Python (FastAPI + SQLAlchemy + Alembic + MySQL)** so the exact same API also serves a new **React Native + Expo + TypeScript** mobile app, while the existing React web frontend keeps running against it largely unchanged.

**Confirmed scope decisions:**
- **Fresh start** — the current `lms_2_0` database is local dev/seed data (`seed.js`/`seedDemo.js`), not production data to preserve. The Python backend gets its own auto-created database, migrated straight from newly-authored SQLAlchemy models — no reverse-engineering of the live schema required.
- The Node backend (`backend/`) **keeps running untouched** throughout the migration. Nothing is deleted or disabled until an explicit cutover decision later.
- This is a large, multi-phase effort (~120 endpoints, 26 business-logic services, 36 tables, 5 scheduled jobs). It is being built phase by phase, not as one big-bang change.

## Coding standards (apply to every new Python and TypeScript file)

1. **Strict layered MVC, one direction of dependency:**
   `Router (controller) → Service (business logic) → DAO (data access) → SQLAlchemy model → DB`
   - **Routers are thin**: parse/validate the request into a DTO, call exactly one service function, return its result. **No business logic in a router.** No direct DB session use, no direct model imports beyond type hints.
   - **Services contain all business logic** (the BR-XX/LMS-XXX rules) and orchestration across multiple DAOs. Services never import `fastapi` (`Request`/`Response`/`HTTPException` are not used inside services — they raise plain domain exceptions that a router-level exception handler translates to HTTP).
   - **DAOs are the only place that touches a SQLAlchemy `Session`.** A DAO method does one query/mutation and returns ORM objects or primitives — no rule branching beyond simple filters.
   - **Data flows top-to-bottom on the way in** (Router → Service → DAO → DB) **and bottom-to-top on the way out** (DB rows → DAO → Service maps to DTO → Router returns DTO). No layer calls back up, and no layer is skipped in either direction.
2. **DTOs are separate from ORM models.** Every request/response shape is a Pydantic schema in `schemas/`, never the SQLAlchemy model itself serialized directly. Services accept and return DTOs (or plain dataclasses internally), not raw ORM instances, across a layer boundary wherever practical.
3. **Max ~250 lines per file.** Any service/DAO/router that would exceed this is split into a package of cohesive submodules (see `leave_request/` example in §3). Prefer splitting by *use-case* (submission, decision, cancellation, drafts) over splitting arbitrarily by line count.
4. **Mobile app (TypeScript)** follows the equivalent split: `screens/` (thin, UI only) → `hooks/`/`services/` (API calls + local logic) → `api/` (typed HTTP client functions, one module per backend router) — same 250-line guidance.

## 1. Repo layout

```
LMS-V2/
  backend/        # Node — untouched, keeps running on :4000
  backend-py/      # NEW — Python/FastAPI
  frontend/        # React web — untouched until cutover
  mobile/           # NEW — Expo/React Native/TypeScript
  docker-compose.yml   # +1 new service: backend-py on :8000, own DB schema
```

### `backend-py/` internal structure

```
backend-py/
  alembic/{env.py, versions/}
  alembic.ini
  app/
    main.py                # FastAPI() app, middleware, router includes, /api/health
    core/
      config.py              # pydantic-settings — mirrors backend/src/config/env.js
      db.py                  # engine, SessionLocal, get_db() dependency
      bootstrap_db.py         # CREATE DATABASE IF NOT EXISTS + alembic upgrade head
      security.py             # session JWT issue/verify
      entra.py                 # JWKS client, Entra code-exchange, id-token verification
      deps.py                   # get_current_user / require_role dependencies
      exceptions.py             # domain exceptions -> {success:false,error:{code,message}}
      responses.py               # ok()/created()/fail() envelope helpers (mirror apiResponse.js)
    models/                # SQLAlchemy ORM — one file per table family, 36 tables total
    schemas/                # Pydantic DTOs, mirrors models/ grouping
    dao/                     # Data Access Objects, one per aggregate
    services/                 # business logic, mirrors backend/src/services/*.js 1:1 in scope
      leave_request/            # example of a >250-line file split by use-case
        __init__.py
        preview.py
        submission.py
        decision.py
        cancellation.py
        drafts.py
    routers/                  # thin, mirrors backend/src/routes/*.routes.js 1:1
    jobs/                     # APScheduler jobs, mirrors backend/src/jobs/*.job.js
  requirements.txt
  Dockerfile
  entrypoint.sh              # runs bootstrap_db then execs uvicorn
  .env.example
  tests/
```

Sync SQLAlchemy (not async) — this is moderate-concurrency, rule-dense CRUD, not high-throughput I/O; Starlette threadpools plain `def` routes, and multiple Uvicorn workers scale it further without the extra failure surface of async drivers/session lifecycles.

## 2. Auth architecture

One token function, two delivery transports — not two flows:

- `issue_session_token(employee_id)` — identical semantics to today's `jwt.sign({employeeId}, ...)`, expiring at midnight in the configured timezone (`Asia/Kolkata` default), preserved exactly (LMS-002).
- **Web**: `GET /api/auth/login` → CSRF `state` cookie → 302 to Entra `/authorize` → `GET /api/auth/callback` exchanges code, verifies id-token via JWKS, resolves the Employee (`entra_oid` first, exact-match `work_email` fallback, auto-binds oid), mints the session token, sets it as an **httpOnly/sameSite=lax cookie**, redirects to `CLIENT_BASE_URL`. Near-zero change needed in `frontend/src/api/client.js` (`withCredentials:true` keeps working).
- **Mobile**: a **second Entra App Registration** (public client, no secret, custom redirect scheme e.g. `lms://auth`) + `expo-auth-session`/`expo-web-browser` doing PKCE against the same `/authorize`+`/token` endpoints. The app POSTs `{code, code_verifier}` to a new `POST /api/auth/mobile/token`; the backend does the exchange server-side (reusing the same resolve/issue functions) and returns the **same** session token **in the JSON body** instead of a cookie. Mobile stores it in `expo-secure-store`, sends `Authorization: Bearer <token>`.
- `get_current_user` checks `Authorization: Bearer` first, falls back to the cookie — one dependency serves both clients; no endpoint needs a web/mobile variant.
- **LMS-008 preserved identically in both paths**: roles are never read from the token — every request re-reads `Employee` + `EmployeeRole→Role` fresh from the DB, in the one shared dependency.
- **Dev bypass**: `POST /api/auth/dev-login` (JSON, for mobile/local use) alongside the existing browser-redirect dev-login — same server-side guard (hard-refused when `ENVIRONMENT=production`).
- Note for later: EAS dev-client build is needed for mobile auth testing — Expo Go cannot host a custom URL scheme reliably.

## 3. Database & migrations

- All 36 tables translated 1:1 from the current Sequelize models (full column-by-column inventory already extracted this session — table names, FKs, uniques, the one composite index on `scheduled_job_runs(job_type, period_key)`, the two VIRTUAL fields on `Employee`/`users` (`full_name`, `status`) become Python `@hybrid_property`, and `LeaveRequest.lock_version` becomes SQLAlchemy's `__mapper_args__ = {"version_id_col": lock_version}` for optimistic concurrency).
- **Auto DB creation**: `core/bootstrap_db.py` opens a raw DBAPI connection with no database selected, runs `CREATE DATABASE IF NOT EXISTS <name> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, then calls `alembic.command.upgrade(cfg, "head")` programmatically (not a subprocess). `entrypoint.sh` runs this before `exec uvicorn`, so a fresh clone + `docker compose up` needs zero manual DB steps.
- First Alembic revision is hand-authored (`op.create_table` for all 36 tables in FK-safe order) since there's no prior migration history. Every schema change after that is `alembic revision --autogenerate`, reviewed, committed.
- During development, `backend-py` targets its **own database name** (e.g. `lms_2_0_py`) on the same MySQL server/container — never the live schema Node's `sequelize.sync()` is still managing — to avoid the two ORMs racing on DDL.

## 4. Build phases

0. **Scaffolding** — repo skeleton, settings, all 36 models (no logic yet), hand-authored initial migration, DB bootstrap, `/api/health`, `backend-py` added to `docker-compose.yml` on port 8000. *Deliverable: `docker compose up` produces a fully migrated, empty database with zero manual steps.*
1. **Auth** — do this first, everything else depends on it. Web cookie flow + mobile PKCE token endpoint + dev-bypass + `get_current_user`/`require_role`. Verify against the real Entra tenant.
2. **Foundational reference data + Employee** — Department/Region/Grade/ManagementLevel/Project/ProjectAssignment/Role/EmployeeRole, LeaveType/LeavePolicy/LeaveAccrualConfig/LeaveYear/Holiday/OrganizationConfig/NotificationTemplate/WorkingPattern(+Assignment), Employee CRUD + manager-hierarchy self-FK.
3. **Core leave lifecycle (highest logic risk)** — `business_day` (deduction calc), `balance` (ledger `SUM`, never stored), `approval_routing` (hierarchy walk, contiguous-span aggregation, self-approval), `leave_request` (submit/preview/decide/withdraw/cancel/drafts), plus LeaveLedger/Approval/Attachment/Delegation/Watcher/StandingWatcher. Faithful port of the exact algorithms already extracted from source; write unit tests asserting Python output matches Node output for the same inputs.
4. **Scheduled jobs** — APScheduler replacing node-cron (SLA sweep, LOP conversion, daily digest, monthly accrual, year-end carry-forward), reusing `ScheduledJobRun`'s idempotency key exactly.
5. **Remaining surface** — admin CRUD, bulk-import, reports, attachments, r3 features (blackout periods, team capacity, encashment, comp-off, calendar feed), notifications, holidays view.
6. **Cutover** — reverse-proxy upstream flip in the frontend's nginx config (`/api` → `backend-py:8000` instead of `backend:4000`), not per-endpoint flags or split traffic (the append-only ledger + optimistic locking assume one writer). Verify fully against a 100%-Python staging environment first, keep Node warm for rollback.

## 5. Mobile app (React Native + Expo + TypeScript) v1 scope

Mobile = employee self-service + manager approvals-on-the-go. HR/Admin back-office stays web-only (bulk import, org-config editors, template editors don't work well on a phone).

**Tier 1 (must-ship):** Login (Entra PKCE) · Dashboard (balances, pending badge, upcoming holidays) · Apply for Leave · My Requests (list + detail + cancel) · My Balance/ledger · Approvals Inbox (role-gated) · Notifications.

**Tier 2:** Team calendar (read-only) · Holidays list · Delegation self-service · Profile (only the fields the model itself marks self-editable).

**Explicitly out of v1:** all HR/Admin master-data screens, LeavePolicy/Accrual/LeaveYear config, OrganizationConfig editor, NotificationTemplate editor, bulk-import, Reports/analytics, BlackoutPeriod/TeamCapacityLimit admin, CompOff/Encashment admin, CalendarFeedSubscription management, WorkingPattern admin, ManagerReassignmentLog, EmployeeFinalSettlement, SelfApprovalPermission admin, AuditLog viewer.

## Verification per phase

- Every phase: `docker compose up` (or local `uvicorn`) boots clean, `/api/health` green.
- Phase 3 in particular: unit tests comparing Python business-logic output against known Node behavior for the same fixture inputs (half-day rounding, SLA escalation targets, contiguous-day aggregation, carry-forward math).
- Phase 6: side-by-side response diff between Node and Python for a sample of real flows (dashboard, apply, approve, reports) before flipping the proxy.

## Docs produced alongside this effort

- This file (`MIGRATION_PLAN.md`) — the plan.
- `AGENTS.md` — tool-agnostic instructions for any AI coding agent working in this repo (coding standards, layering rules, what's live vs. in-progress).
- `CLAUDE.md` — Claude Code's entry point, imports `AGENTS.md` and adds session-habit notes for this repo.
- `SKILLS.md` — step-by-step recipes for the recurring tasks (porting a service, adding an endpoint, adding a migration, verifying a phase).
- `backend-py/README.md` — Python backend setup/run instructions (added in Phase 0).
- `mobile/README.md` — Expo app setup/run instructions (added when mobile scaffolding starts).
- Existing `README.md` (Node/React) stays as-is until cutover, then gets updated to point at the new stack.
