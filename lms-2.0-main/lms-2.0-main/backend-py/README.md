# LMS 2.0 API — Python backend (FastAPI + SQLAlchemy + Alembic)

Rewrite of `../backend` (Node/Express/Sequelize) targeting the same API contract,
so it can serve the existing React web app and a new React Native/Expo mobile
app unchanged. See `../MIGRATION_PLAN.md` for the full plan and phase list.

**Status: Phases 0-5 complete; Phase 6 in progress (casing shim built, cutover flip not yet done).** All 39 tables
exist as SQLAlchemy models with an applied Alembic migration. Auth is live:
`GET /api/auth/config`, `GET /api/auth/login` + `GET /api/auth/callback` (web,
cookie-based), `POST /api/auth/mobile/token` (PKCE exchange, bearer-token
response), `GET`/`POST /api/auth/dev-login` (dev bypass, browser + JSON),
`POST /api/auth/signout`. `get_current_user`/`require_role` accept either a
`lms_session` cookie or an `Authorization: Bearer` header — one token scheme,
two transports, so every endpoint added from Phase 2 onward serves both web
and mobile unmodified. Verified with a real running server (dev-bypass login,
Bearer + cookie auth, invalid-token rejection, role re-read after a live role
grant) and `pytest` (`tests/test_auth.py`, 8/8 passing). The real Entra
authorization-code exchange/JWKS verification is implemented but not yet
exercised against a live tenant — needs real `ENTRA_*` credentials in `.env`
to test end-to-end.

**Phase 2 (reference data + Employee + admin CRUD) complete — the following is
built and verified:**
- `python -m scripts.seed` — roles, management levels, the current leave year,
  config defaults and notification templates. **It creates no leave type**: those
  are company policy, so an administrator creates them in the application, or a
  deployment applies a prepared file with
  `python -m scripts.seed_company_policy --confirm` (see `seed/README.md`).
- Config: `GET/PATCH /api/config` (HR_ADMIN).
- Employees: `GET/PATCH /api/employees/me`, avatar upload/fetch,
  `GET/POST /api/employees`, `PATCH /api/employees/{id}` and `/manager`,
  `GET /api/employees/watchable`, role list/assign/revoke (with the
  "last HR_ADMIN" guard). Verified live (onboarding, manager assignment,
  circular-hierarchy rejection, the self-service allow-list boundary,
  avatar upload/reject) and with `pytest` (`tests/test_employees.py`, all passing).
- Admin CRUD (all `/api/admin/...`, all HR_ADMIN-only, mirrors
  `backend/src/services/admin.service.js` + `workingPattern.service.js` +
  `notificationAdmin.service.js`):
  - Department/Region/Grade (create + list) and ManagementLevel (list-only,
    matching Node — no create/update route exists there either), Project
    (create + list) and ProjectAssignment (create; LMS-013 — no overlap check,
    assignments may overlap freely, unlike WorkingPatternAssignment).
  - LeaveType create (3-row create: type + policy + accrual config, no
    transaction — a faithful port of Node's own gap, not hardened) and policy
    update, with the LMS-025 system-type lock (`SYSTEM_TYPE_LOCKED` on any
    attempt to edit the LOP type's policy).
  - Holiday add (LMS-028/7.3.15 — warns which `APPROVED` requests overlap the
    new holiday date, org-wide, unscoped by region, exactly like Node) and
    remove.
  - WorkingPattern create/deactivate/reactivate (deactivate refuses while any
    assignment references the pattern — `WORKING_PATTERN_IN_USE`) and
    WorkingPatternAssignment create/list/update, enforcing LMS-015's
    no-overlap rule (`WORKING_PATTERN_OVERLAP`) and `get_weekend_override_for_date`
    (consumed by Phase 3's `business_day_service`).
  - NotificationTemplate create (with a `DUPLICATE_TEMPLATE_KEY` pre-check,
    matching Node)/update/enable-disable/delete, with the `PROTECTED_TEMPLATE_KEYS`
    hard-delete guard (`TEMPLATE_IN_USE`) ported verbatim from
    `notificationAdmin.service.js`.
  - Verified live via curl for every rule above (including the holiday-overlap
    warning against a real `APPROVED` request, the working-pattern overlap
    rejection, and the protected-template-key guard) and with `pytest`
    (`tests/test_admin.py`, all passing, re-run 3x clean).
  - Along the way, fixed a real bug in `app/core/responses.py`'s `ok()`: it
    used Starlette's default `json.dumps`-based rendering, which can't
    serialize `date`/`datetime`/`Decimal` — any endpoint returning a date
    (Holiday, WorkingPatternAssignment, etc.) 500'd on render. Now runs
    payloads through `fastapi.encoders.jsonable_encoder` first.

**Not yet built**: the demo-org seed script (`seedDemo.js`'s Python
equivalent), and the self-approval-permissions + carry-forward-trigger routes
(also mounted under Node's `admin.routes.js`, but out of this pass's scope —
carry-forward belongs with Phase 4's jobs, self-approval admin CRUD with
Phase 5). Dashboard/my-team/team-calendar/peer-calendar are deliberately
deferred to Phase 4+ — they're read surfaces on top of `balance_service`,
which now exists (see below), but weren't part of this pass's scope.

**Phase 3 (core leave lifecycle) complete** — the biggest, most
business-rule-dense part of the migration:
- `business_day_service` — BR-03/04/05/06 deduction-breakdown engine (holiday
  region-scoping, working-pattern override integration, the exact
  holiday-before-weekend exclusion-precedence edge case, BR-34 half-day rule).
- `balance_service` — BR-07 (balance is a live ledger SUM, never stored),
  BR-10 (effective balance nets out days committed to open requests), BR-09/
  BR-31 (deduction/restoration ledger writes).
- `approval_routing_service` — completed with `get_first_stage_approver`
  (BR-22, Manager-or-Delegate), `get_contiguous_aggregate_days` (BR-24's
  "zero deducted working days apart" contiguity rule), `requires_long_leave_second_stage`
  (BR-23), `is_eligible_for_self_approval` (table 37 addendum),
  `assert_not_self_approval`.
- `leave_request` service package (`app/services/leave_request/` — split by
  use-case: `validation`/`gates`/`routing`/`preview`/`submission`/`decision`/
  `cancellation`/`drafts`/`detail`, each under 250 lines): the full 10-state
  lifecycle — preview, submit, decide (Manager/HR stage routing, BR-25's
  outright-HR-rejection, BR-26 skip-level long-leave notice), withdraw,
  request/decide cancellation (BR-31 partial restoration), save/update/
  discard/submit draft, and NFR-13/BR-42's FULL/WATCHER_MASKED/DENIED detail
  scoping.
- Supporting services built alongside: `notification_service` (template
  lookup, token substitution, LMS-072 digest suppression for exactly 2
  template keys, best-effort email via a new `app/core/mailer.py`),
  `watcher_service` (standing watchers, submit/approve/reject/cancel
  notifications, manual add/remove with hierarchy scoping), `blackout_period_service`
  and `team_capacity_service` (LMS-085/086 submission gates only — full admin
  CRUD for both deferred to Phase 5).
- Verified live end to end against a real running server with two real
  employees and bearer-token auth (not dev-bypass, so Manager-vs-Employee
  authorization was actually exercised): submit -> approvals-queue -> approve
  (confirmed a real `-N` ledger row appears) -> request cancellation ->
  decide-cancellation-approve (confirmed the ledger balance is restored to
  zero), the reject -> `REJECTED_PENDING_WITHDRAWAL` -> withdraw path, the
  overlap-rejection gate, the full draft save/update/submit path, and all
  three detail-scoping branches (FULL for the owner, WATCHER_MASKED for a
  watcher with the reason/leave-type-name masking, DENIED for a stranger).
  Also covered by `pytest` (`tests/test_leave_requests.py`, 5 tests) — full
  suite is 24/24 passing.
- Found and fixed one real bug in `app/core/responses.py`'s `ok()` during
  Phase 2 (Starlette's default JSON rendering can't serialize `date`/
  `datetime`) — see below; still holds for Phase 3's date-heavy payloads.
- **Known limitation**: `scripts/seed.py` now also seeds the 26 notification
  templates from `backend/src/utils/seed.js` (previously only reference data),
  required for the lifecycle to notify anyone at all. Email sending is real
  (Gmail SMTP, synchronous, best-effort — failures are caught and logged, never
  raised) — this makes the lifecycle test suite slow (~3-4 min) and Gmail's
  daily send limit can start rejecting mail mid-run; the notification/audit
  rows are unaffected either way since the send happens after the DB commit.
  A test-mode mail stub is a reasonable fast-follow but wasn't required for
  correctness.

**Not yet built in Phase 3's scope**: attachment upload/serving for leave
requests (`attachment_refs` is accepted by `submit_request` but not wired to
storage — matches Node's own gap, flagged not silently dropped).

**Phase 4 (scheduled jobs) complete** — mirrors `backend/src/jobs/`:
- `escalation_service.run_sla_sweep` (BR-33/34/35/36 — reminder band +
  one-level escalation, terminating at the active HR_ADMIN queue, never at
  self-approval) and `run_lop_conversion_sweep` (BR-18/19/20 — converts
  expired `REJECTED_PENDING_WITHDRAWAL` to `LOP_APPLIED`, idempotent per
  request via `LopRecord`, not via `ScheduledJobRun`). Faithfully preserves
  Node's asymmetry: SLA sweep writes no `ScheduledJobRun` row at all
  (idempotency is state-based — `sla_started_at` resets on every escalation,
  reminders dedup against `Notification` rows created since that reset).
- `accrual_service.post_opening_pro_rata` (BR-13/14/15, rounded up, now
  actually wired into `onboard_employee` — previously deferred) and
  `run_periodic_accrual` (LMS-055, keyed on `(period_key, leave_type,
  employee)` via the ledger's `source_reference`, retry-safe via
  `ScheduledJobRun`'s found-or-created RUNNING/SUCCESS/FAILED states).
- `carry_forward_service.run_year_end_carry_forward` (LMS-056/BR-27 — caps
  the carried amount, lapses the excess, marks the closing year closed
  (BR-01/28) and the next year current). Reachable both from the daily
  cron's conditional poller and from `POST /api/admin/carry-forward/trigger`
  (the only job Node itself exposes as an admin-triggerable endpoint).
- `digest_service.run_daily_digest` (LMS-072/68/70 — bundles `SUPPRESSED`
  email rows per opted-in recipient into one summary email; a send failure
  leaves rows `SUPPRESSED` for the next day's run rather than marking them
  `FAILED`, matching Node exactly).
- `app/jobs/scheduler.py` — APScheduler `BackgroundScheduler`, wired into
  `app/main.py`'s lifespan (starts on boot, shuts down cleanly). Same 5
  schedules as Node's `node-cron` wiring (SLA sweep every 15 min, LOP sweep
  daily 01:00, digest daily 08:00, accrual monthly on the 1st at 02:00,
  year-end rollover check daily 02:30), each wrapped in an in-memory
  overlap guard (skip a tick if the previous run is still in flight) —
  **one deliberate deviation from Node**: every job is pinned to
  `settings.default_timezone` (`Asia/Kolkata`) instead of node-cron's
  unpinned host-local time, since that's a latent bug in a codebase
  otherwise careful about `Asia/Kolkata` wall-clock time elsewhere (session
  expiry, leave-year boundaries) — operational config, not a business-rule
  change.
- Verified live: booted the app and confirmed the scheduler starts/stops
  cleanly via the lifespan hook; then called each job function directly
  against the running dev DB — SLA sweep on a manufactured overdue request
  (confirmed escalation to the active HR_ADMIN queue when the manager has no
  manager of their own), LOP conversion sweep on a manufactured expired
  `REJECTED_PENDING_WITHDRAWAL` request (confirmed the state/leave-type swap
  and `LopRecord` write, and that a second sweep is a no-op), periodic
  accrual run twice with the same period key (confirmed the ledger balance
  doesn't move the second time). Also covered by `pytest`
  (`tests/test_jobs.py`) — these mock out the actual email send (`notify()`'s
  own contract is already covered elsewhere; hitting live Gmail per test is
  slow and gets rate-limited under repeated runs) and use fully isolated,
  fabricated leave-year pairs for the carry-forward test specifically
  *because* that job unconditionally flips `is_current`/`is_closed` on
  whatever leave-year pair it's given — running it against the shared dev
  DB's real current year would break every other test that depends on
  `leave_year_dao.find_current()`.
- **Known limitation**: `carry_forward_service`/`escalation_service` loop
  over every active employee and call `notification_service.notify()` per
  qualifying one, which does a real (synchronous) SMTP send — fine at
  interactive/admin-trigger volume, but running these ad hoc against a dev
  database with many accumulated test employees is slow and will trip
  Gmail's daily send-limit. Not a correctness issue (every failure is caught
  and logged, matching the "never block the business action" contract), just
  a testing-ergonomics note for whoever runs this next.

## TT Suite integration (PostgreSQL, portal sign-in)

The LMS now runs as one app of the TT Suite (`docs/SUITE-CONTRACT.md` in the suite
checkout): one shared **PostgreSQL** database (LMS tables in schema **`lms`**), the
portal owns sign-in, and the portal gateway serves the SPA at `/lms/` and proxies
`/lms/api/*` to this process on `127.0.0.1:8003` (prefix stripped). The MySQL-era
sections further down this file are history.

- **Database**: `psycopg` 3; engine `search_path=lms`, pool 5. `DATABASE_URL` is the
  runtime role, `DATABASE_OWNER_URL` the migration owner. One Alembic baseline
  (`alembic/versions/0001_initial_postgres_schema.py`, version table `lms.alembic_version`).
  `python -m app.core.bootstrap_db` = create schema `lms` + `alembic upgrade head` +
  `suite_core.migrate.grant_schema(owner, "lms", runtime role)` + seed reference data
  into a fresh schema (only when `roles` is empty). It never creates the database.
- **Boot**: `python -m app` bootstraps, then serves uvicorn on `HOST:PORT`
  (default `127.0.0.1:8003`) with proxy headers trusted from 127.0.0.1, one worker
  (APScheduler runs in-process; `SCHEDULER_ENABLED=false` turns it off).
  `LMS_SKIP_BOOTSTRAP=1` skips the bootstrap step.
- **Web auth**: the portal's cookie (`tt_session`, `__Host-tt_session` in prod) ->
  `suite_core.identity.resolve(db, cookie, "lms")`. No session -> 401; no LMS access ->
  403 `NO_APP_ACCESS`; the employee is matched by `users.suite_user_id`, then
  lower-cased email, and self-healed (created) from the suite role when missing; a
  deactivated employee -> 403 `NO_APP_ACCESS`. Roles still come from `user_roles`,
  re-read on every request. Cookie-authenticated non-GET requests need an
  `X-Requested-With` header. The web OIDC routes, the LMS session cookie and the
  implicit dev bypass are gone.
- **Mobile** is unchanged: `POST /api/auth/mobile/token` (Entra PKCE) and the
  `Authorization: Bearer` header; `POST /api/auth/dev-login` (bearer) when
  `DEV_AUTH_BYPASS_ENABLED=true` outside prod.
- **Dev/test sign-in** (refused when `APP_PROFILE=prod`):
  `POST /api/auth/dev/sign-in {"employeeCode": "EMP001"}` (or `{"email": ...}`) makes
  that employee's suite person active, mirrors their LMS access and sets the suite
  session cookie — what the tests use, and handy for local demos without the portal.
- **Internal routes** (localhost only, header `x-internal-token: $INTERNAL_TOKEN`):
  `POST /internal/provision` and `POST /internal/authorize` — see
  `app/services/suite_provision_service.py` for the role map and the defaults a person
  provisioned from just email + name gets.
- **Access mirror**: every role grant/revoke, onboarding (incl. CSV import),
  deactivation/reactivation and work-email change mirrors the employee's effective
  suite role (HR_ADMIN -> admin, MANAGER -> manager, else employee; deactivated ->
  none) into `app.app_access` (`app/services/suite_access_service.py`). The seed
  scripts backfill it.
- **Storage**: avatars/attachments under `STORAGE_DIR` (default `backend-py/storage`;
  `/home/data/lms` on Azure).

## Quick start (local, against the suite's Postgres)

```bash
cd backend-py
py -3.13 -m venv .venv-suite
.venv-suite/Scripts/pip install -r requirements.txt -e ../../../packages/suite_core
cp .env.example .env       # suite Postgres on localhost:5433 (deploy/docker-compose.yml)
.venv-suite/Scripts/python -m app   # bootstrap + serve on 127.0.0.1:8003 (seeds reference data on a fresh schema)
```

**Seed data** lives in `seed/` as JSON, not in Python. See [seed/README.md](seed/README.md).
- **`seed/reference.json`** (tracked, required): applied automatically on a fresh schema, or by hand with `python -m scripts.seed` (`npm run seed` at the LMS root).
- **Optional local demo org** (EMP001 = HR admin), from the gitignored `seed/demo.json`:

```bash
cp seed/demo.example.json seed/demo.json   # then fill it in
.venv-suite/Scripts/python -m scripts.seed_employees
.venv-suite/Scripts/python -m scripts.seed_demo   # or `npm run seed:demo` at the LMS root
```

Both demo scripts refuse to run under `APP_PROFILE=prod`, or when `seed/demo.json` is missing (always the case on a fresh clone and in a deploy).

The `suite` schema must exist first (the portal's migrator creates it). Visit
`http://127.0.0.1:8003/api/health`; the SPA dev server is `npm run dev` in `../frontend`
(http://localhost:5173/lms/).

## Tests

```bash
.venv-suite/Scripts/python -m pytest -q
```

`tests/conftest.py` creates database `lms_test` on `localhost:5433` (as `app_owner`),
migrates the `suite` schema there, rebuilds schema `lms` from scratch every session and
runs the app as `app_rw`. Override with `LMS_TEST_OWNER_URL` / `LMS_TEST_DATABASE_URL`.

## Docker (legacy)

The root `docker-compose.yml` `backend-py` service still describes the old MySQL setup
and is not used by the suite (deploy is `TT-suite/deploy`). Building
`backend-py/Dockerfile` additionally needs `TT-suite/packages/suite_core` installed.

## Schema changes

Models are the source of truth. After editing anything in `app/models/`:

```bash
# DATABASE_OWNER_URL must point at a migrated database; tables land in schema `lms`
alembic revision --autogenerate -m "describe the change"
# review the generated file in alembic/versions/ before committing
alembic upgrade head
```

`alembic check` (no output = clean) confirms models and the live DB agree.

## Layering rules (see root `MIGRATION_PLAN.md` "Coding standards" for the full text)

`routers/` (thin, HTTP only) → `services/` (business logic) → `dao/` (the only
layer touching a SQLAlchemy `Session`) → `models/`. DTOs live in `schemas/` and
are what routers/services actually pass around — never a raw ORM instance
across a layer boundary. Max ~250 lines per file; split by use-case, not by
line count, when a file would grow past that (see `services/leave_request/`,
or `app/dao/leave_request_dao.py` vs. `leave_request_query_dao.py` — the
latter split when the read-heavy dashboard/report/job-sweep queries pushed
the original file past 250 lines).

## Phase 5 (remaining admin/reports/attachments/r3/notifications surface) — complete

Everything below is new since Phase 4; each area was verified live against a
running server (curl + a running dev DB), not just compiled:

- **Dashboard/My Team/Team Calendar/Peer Calendar** (`services/employee/dashboard.py`,
  `team.py`) — `GET /api/employees/{dashboard,my-team,team-calendar,peer-calendar}`.
  BR-39 (Manager sees every report at any depth), BR-41/NFR-14 (peer calendar
  — same manager AND same management level — never sends leave type, unlike
  team-calendar which does).
- **Reports** (`reports_service.py`) — `GET /api/reports/{leave-taken,lop,balances,audit-log}`.
  BR-39/40 manager-scoping with the "an employeeId/managerId filter can only
  narrow, never widen" intersection rule — covered by a dedicated
  `tests/test_reports.py` since this is the highest data-leak risk in the
  whole admin surface.
- **Attachments** (`attachment_service.py`, `core/attachment_storage.py`) —
  `POST /api/attachments/{request_id}`, `GET /api/attachments/{id}/download`.
  LMS-035 (only where the leave type permits attachments), NFR-13/BR-42
  (owner/current-approver/HR_ADMIN only — Watchers excluded).
- **Ledger** (`ledger_service.py`) — `GET /api/ledger/{my,employee/{id}}`,
  `GET /api/ledger` (paginated, HR-wide), `POST /api/ledger/adjust` (thin
  wrapper around Phase 3's `balance_service.write_manual_adjustment`).
- **Delegation** (`delegation_service.py`) — full CRUD: eligibility
  (LMS-041 peer-manager-or-supervisor-fallback, with a narrower
  no-fallback variant for the HR picker), nominate/nominate-on-behalf
  (LMS-042), revoke, `DELEGATION_OVERLAP` guard (one active delegation per
  nominator, no tie-break).
- **Notification Centre + digest preference** (`notification_centre_service.py`) —
  `GET/POST /api/notifications/...`, `GET/PATCH /api/employees/me/digest-preference`.
- **Self-approval-permissions CRUD** (`self_approval_service.py`) — the
  "at most one active grant per employee" service-layer guard (MySQL has no
  partial unique index).
- **BlackoutPeriod + TeamCapacityLimit full CRUD** (`blackout_period_service.py`,
  `team_capacity_service.py`) — extends the Phase 3 assert-only gates with
  create/update/enable-disable/delete. TeamCapacityLimit's "disabled" state
  is `effective_to = today`, not an `is_active` column.
- **Standing watchers CRUD** (`watcher_service.py`) — LMS-061,
  `DUPLICATE_STANDING_WATCHER` overlap guard on the (watched, watcher) pair.
- **Employee lifecycle** (`services/employee/lifecycle.py`) — `deactivate`
  (LMS-016/017: final-settlement snapshot, stuck-request escalation to the
  employee's own manager or the active HR_ADMIN queue, role revocation
  through the existing last-HR_ADMIN guard, delegation revocation) and
  `reassign_manager` (LMS-018: pending requests stay put unless explicitly
  transferred).
- **Bulk import** (`bulk_import_service.py`) — `POST /api/employees/bulk-import`
  (CSV, in-memory only). LMS-019's all-or-nothing validation pass. **Known
  limitation vs. Node**: several DAOs this depends on commit eagerly rather
  than only flushing, so unlike Node's single wrapping transaction, a
  circular-hierarchy failure discovered during the second (manager-wiring)
  pass will not undo employee rows already committed earlier in the same
  batch — flagged in the module docstring, not silently pretended away.
- **R3 extras**: leave encashment (`encashment_service.py`, LMS-084),
  compensatory off (`comp_off_service.py`, LMS-083, `DUPLICATE_COMP_OFF`
  guard), calendar feed (`calendar_feed_service.py`, LMS-082 — SHA-256
  hashed tokens, only the hash stored; the ICS-serving endpoint at
  `GET /api/calendar-feed/{token}.ics` is deliberately mounted with **no**
  auth dependency, token-authenticated instead, so Outlook can poll it
  unattended), optional holidays (`optional_holiday_service.py` — the
  ceil(published/2) quota default with an HR override, `OPTIONAL_HOLIDAY_QUOTA_EXCEEDED`
  guard, idempotent select/deselect, plus the HR usage-overview endpoint
  that was flagged as out-of-scope back in Phase 2's `holidays.py`).
- Also closed two gaps flagged in earlier phases: `post_opening_pro_rata`
  (BR-13-15) is now actually wired into `onboard_employee` (was deferred
  pending `balance_service`), and `holidays.py`'s admin
  `GET /optional-usage` endpoint now exists.
- Found and fixed one real bug during this pass: `app/dao/leave_type_dao.py`'s
  `list_balance_affecting_policies` returns `LeavePolicy` rows, not
  `LeaveType` rows — the first draft of `employee/lifecycle.py`'s settlement
  snapshot tried to read `.type_code` off those rows (which don't have it)
  and would have thrown at every deactivation. Added a proper
  `list_balance_affecting` DAO function instead of misusing the wrong one.
- **Not built** (out of this pass's judged scope, flagged for a later pass):
  the `self-approval-permissions`/blackout/capacity CRUD screens' admin-UI
  wiring on the frontend side (backend-only migration so far — the existing
  React app still talks to `backend/`, not `backend-py/`, until Phase 6's
  cutover); `carry_forward`'s admin-triggered self-approval CRUD is done but
  the frontend has no screen for it yet either.

## Phase 6 (cutover) — casing shim built and verified; proxy flip not yet done

Booting the untouched Node backend side by side for a parity check surfaced a
real blocker: Node's own wire format is **not** uniformly snake_case. GET
responses that are raw Sequelize model dumps come back snake_case (matching
DB columns) — which is what every schema in this backend already produces —
but a handful of endpoints hand-build a plain object in the controller (or,
in one case found by directly reading the service code rather than trusting
a grep-based audit, inside the *service* layer) and those come back camelCase
instead. The existing React frontend was written against each endpoint's
actual casing, not one convention throughout.

- `app/core/casing.py` + `app/core/casing_middleware.py` — a raw ASGI
  middleware (deliberately not `BaseHTTPMiddleware`, whose `call_next`
  closure ignores a reconstructed `Request`'s body — a real bug caught by
  actually testing this with curl, not just reading the code) that rewrites
  incoming camelCase query-string keys and JSON body keys to snake_case
  before routing/validation ever sees them. Idempotent on already-snake_case
  input (verified: the entire existing pytest suite, which sends snake_case
  bodies directly, needed zero changes). Never touches multipart/form-data
  (avatar/attachment/bulk-import uploads stay binary-safe).
  `app/schemas/base.py`'s `CamelOut` mixin (Pydantic's `alias_generator=to_camel`)
  handles the handful of **outbound** exceptions where Node itself is
  camelCase: `GET /api/auth/config`, `POST /api/auth/signout`,
  `GET/PATCH /api/employees/me/digest-preference`,
  `GET /api/holidays/optional-summary(/:employeeId)` (also fixed a real shape
  difference here, not just casing — Node flattens each eligible holiday's
  fields alongside `isSelected` rather than nesting them under a `holiday`
  key, per `app/schemas/optional_holiday.py`), and
  `GET /api/admin/holidays/optional-usage`.
- Verified live: camelCase query params on `GET /api/leave-requests/preview`
  (`leaveTypeId`/`startDate`/`endDate`/`isHalfDay`), a camelCase onboarding
  POST body (`fullName`/`workEmail`/`departmentName`, matching exactly what
  `frontend/src/components/admin/EditEmployeeModal.jsx` sends) creating a
  real employee correctly, and all 5 camelCase-output endpoints returning
  the exact field names Node does.
- **Known gap, stated plainly**: the audit that found the outbound exceptions
  above was controller-level-only (grepped `ok(res, …)` call sites); it has a
  blind spot for camelCase objects hand-built inside a *service* function and
  passed straight through an otherwise-innocuous-looking controller call —
  exactly the pattern that caused the `optional-usage` endpoint to be missed
  on the first pass (caught by directly reading that service's source, not by
  the audit). There may be others not yet found. Do not treat the 5 endpoints
  above as a guaranteed-complete list without a broader service-layer sweep.
- **Not done**: the actual `frontend/nginx.conf` upstream flip
  (`backend:4000` → `backend-py:8000`). `MIGRATION_PLAN.md` §6 calls for a
  side-by-side response diff across real flows before flipping, which is a
  substantially larger verification effort than the targeted casing fixes
  above — this is a genuinely hard-to-reverse, shared-traffic change, so it's
  deliberately left for an explicit go-ahead rather than done as a natural
  continuation of the casing work.
