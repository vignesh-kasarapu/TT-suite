# Expense Management System

Built from *Expense Management System – FRD v3*. The stack is React (TypeScript), FastAPI, PostgreSQL, and the Tektalis UI theme.

## Part of the TT Suite

EMS runs as one of the TT Suite apps behind the portal gateway (see `TT-suite/docs/SUITE-CONTRACT.md`):

- **Sign-in is through the TT Suite portal** (Microsoft / Entra). EMS has no login page and no passwords. Each request
  carries the portal's session cookie (`tt_session` in dev, `__Host-tt_session` in prod); EMS resolves it with
  `suite_core.identity.resolve(db, cookie, "expense")`. No cookie or an expired session = 401 (the SPA goes to
  `/login?returnTo=...`); no Expense access or a deactivated EMS user = 403 `{"code": "NO_APP_ACCESS"}` (the SPA goes to `/?denied=expense`).
- The EMS user is found by `users.suite_user_id`, then by email. Someone the portal gave Expense access to but who has no EMS
  user yet is created on their first visit, with an employee code made from their email (`jane.doe@x.com` → `JANE-DOE`,
  then `JANE-DOE-2`...). The Admin can change it later.
- **Roles stay in EMS** (`users.roles`). Each change made in **Admin → Users** (add, edit, CSV import, deactivate) is mirrored
  into `app.app_access` in the same transaction with the person's effective role: ADMIN → `admin`, FINANCE → `finance`,
  APPROVER → `approver`, no role → `member`, deactivated → no access.
- **Portal → EMS** (localhost only, header `x-internal-token: $INTERNAL_TOKEN`):
  `POST /internal/provision` (create, change role or revoke; revoke = deactivate as a leaver) and `POST /internal/authorize`.
  Suite roles map to EMS roles: `member` → none, `approver` → Manager, `finance` → Finance Reviewer, `admin` → Admin.
  Roles that rank below the new one are kept (an Admin keeps Finance Reviewer). A change that would break the Manager rule
  (for example, making a Manager into Finance or Admin) is refused with 409 `ROLE_CONFLICT`. The EMS Admin must change that person's roles in EMS.
- **Theme** is the person's TT Suite preference (Linen / Harbour / Graphite plus System / Light / Dark), read from the portal's
  `GET /api/me` and saved with `PUT /api/me/preferences` from **Profile → Appearance**. The top bar has an app switcher.
- **Database**: one shared Postgres. EMS tables live in schema `expense` (via `search_path`); the suite tables are in schema `suite`.
- **URLs**: SPA at `/expense/` (Vite `base`), API at `/expense/api/*` (the gateway strips `/expense` and forwards to `127.0.0.1:8004/api/*`).

## Run it locally

You need Python 3.12 or newer, Node 20 or newer, and the suite's Postgres (`TT-suite/deploy/docker-compose.yml`, port 5433).

```bash
# 1. Backend (http://127.0.0.1:8004, API docs at /docs)
cd backend
python -m venv .venv-suite
.venv-suite\Scripts\pip install -r requirements-dev.txt -e ..\..\packages\suite_core   # Windows (use .venv-suite/bin/pip on macOS/Linux)
copy .env.example .env                                   # then edit the values (see Environment)
.venv-suite\Scripts\python -m app migrate                # Alembic into schema "expense" + grants to the runtime role
.venv-suite\Scripts\python seed.py                       # demo users, mirrored into app.app_access
.venv-suite\Scripts\python -m app                        # migrate, then serve on 127.0.0.1:$PORT

# 2. Frontend (http://localhost:5173/expense/)
cd frontend
npm install
npm run dev     # proxies /expense/api -> localhost:8004 and /api (portal) -> localhost:8000
```

Normally you sign in through the portal. For local demos and tests without Microsoft, a **dev-only** helper signs you in
as a seeded EMS user and sets the suite cookie. It is refused when `APP_PROFILE=prod`:

```bash
curl -i -X POST http://127.0.0.1:8004/api/auth/dev/sign-in -H "X-Requested-With: XHR" -H "Content-Type: application/json" -d '{"email": "admin@example.com"}'
```

Every non-GET `/api` request must send `X-Requested-With: XHR` (otherwise 403 `CSRF_HEADER_MISSING`).

| Email | Role in the demo |
|---|---|
| eshan@example.com, esha@example.com | Employees; report to Maya |
| maya@example.com | Manager: approves Eshan and Esha; can self-approve and request advances |
| tara@example.com / arun@example.com / hema@example.com | Managers (no team in the demo) |
| vikram@example.com | Manager of everyone else; Level 2 approver |
| fiona@example.com | Finance Reviewer |
| farhan@example.com / feroz@example.com | Finance Backup Reviewer / second reviewer |
| admin@example.com | Administrator (never approves; can self-approve and request advances) |

### Environment (backend)

| Variable | Default | Notes |
|---|---|---|
| `APP_PROFILE` | `dev` | `dev`, `test` or `prod`. Sets the cookie name; `prod` turns off the dev sign-in |
| `DATABASE_URL` | `postgresql+psycopg://app_rw:dev@localhost:5433/ttsuite` | Runtime role. Any `postgres://`, `postgresql://` or `+pg8000` URL is normalised to `postgresql+psycopg://` |
| `DATABASE_OWNER_URL` | = `DATABASE_URL` | Owner role used for migrations; the runtime role is then granted DML on schema `expense` |
| `INTERNAL_TOKEN` | empty (refuses everything) | Shared secret for `/internal/*` |
| `HOST` / `PORT` | `127.0.0.1` / `8004` | Used by `python -m app` (uvicorn with proxy headers trusted from 127.0.0.1) |
| `UPLOAD_DIR` | `uploads` | Receipt files (relative to the working directory) |
| `CORS_ORIGINS` | `http://localhost:5173` | Only needed if the SPA is served from another origin |
| `SCHEDULER_INTERVAL_MINUTES` | `60` | Reminder and escalation loop |

Frontend: `VITE_API_URL` (default `/expense/api`).

### Tests

```bash
cd backend && .venv-suite\Scripts\python -m pytest -q   # creates database ems_test on localhost:5433 (schemas suite + expense)
cd frontend && npm run build && npm run lint:tokens       # typecheck + build; no raw colours + WCAG contrast gate
```

`TEST_DATABASE_OWNER_URL` / `TEST_DATABASE_URL` override the test database (defaults: `app_owner:dev` / `app_rw:dev` on `localhost:5433/ems_test`).

## Structure (MVC)

```
backend/app/
  models/        M  SQLAlchemy tables (user, config, claim, activity) and enums
  schemas/       V  Pydantic request and response shapes; presenters.py builds the claim view
  controllers/   C  FastAPI routers: HTTP only, no business rules
  services/         Business rules: routing, approvals, delegation, policy, duplicates, finance, reports
  core/             Config, DB session (schema expense), TT Suite cookie auth dependencies, boot migrations
backend/alembic/    Migrations into schema expense (the first one also makes audit_log append-only with a trigger)
backend/app/__main__.py  Boot entry: python -m app (migrate, then serve)

frontend/src/
  models/        M  types.ts, api.ts (one function per endpoint), http.ts, format.ts
  controllers/   C  Hooks that hold state and actions: useAuth, useClaimForm, useInbox, useClaimActions...
  views/         V  components/ (Shell, ResponsiveList, ui) and pages/ (one per screen)
  styles/           tokens.css (from the theme package, unchanged) + app.css (tokens only)
  theme/            Preset and colour-mode switching
```

## Placeholders to replace

Search the code for `PLACEHOLDER` to find each one.

| What | Where | Notes |
|---|---|---|
| Database URLs | `backend/.env` → `DATABASE_URL`, `DATABASE_OWNER_URL` (defaults in `app/core/config.py`) | Set by `deploy/run.py` in the suite. |
| Internal token | `backend/.env` → `INTERNAL_TOKEN` | The same secret as the portal. |
| Allowed frontend origins | `backend/.env` → `CORS_ORIGINS` | Comma-separated list. |
| Company GSTIN per state | `app/services/settings_service.py` → `company_gstins` | Can also be changed later in **Admin → Settings → Company GSTINs**. The seeded values are fake. |
| Users, roles, managers | `backend/seed.py` → `USERS` | Or manage them in **Admin → Users**. |
| Level 2 approver and amount | `backend/seed.py` → `LEVEL2` | Level 1 is always the reporting manager. Level 2 can also be set in **Admin → Settings → Approvals**. |
| Policy limits | `backend/seed.py` (sample limits) | Can also be set in **Admin → Policy limits**. |
| Projects, departments | `backend/seed.py` → `LISTS` | Can also be set in **Admin → Settings → Lists**. |
| Dev proxy targets | `frontend/vite.config.ts` | EMS API (8004) and portal (8000) used by `npm run dev`. |
| API base URL | `frontend/.env` → `VITE_API_URL` (see `.env.example`) | Leave empty for `/expense/api`. |

## Agreed decisions

- **Phase 1 scope.** Web only. Sign-in is Microsoft through the TT Suite portal (originally email and password). Users and roles are managed by the Admin (and by the TT Suite global admin through `/internal/provision`). No OCR: employees type the details and attach the receipt. GSTIN is checked for format only (no live check). Payroll is a batch plus manual Paid/Failed. There is no Tally sync, no travel requests and no corporate cards. Rupees only. Notifications are in-app only. Exports are Excel only.
- **Roles.** Employee (no role), Manager, Finance Reviewer, Admin. A Manager cannot also be a Finance Reviewer or an Admin. A reporting manager must hold the Manager role. Admins never approve. There are no grades.
- **Approval routing.** Employee → reporting manager (Level 1) → Level 2 approver if the amount is above the Level 2 amount → Finance review. Routing is per line, and Level 2 checks the amount Level 1 approved. **Reject works per line**; Send Back returns the whole claim, which restarts at Level 1. If the same person is the Level 1 and Level 2 approver, they act once, at Level 2. Rules are fixed when the claim is submitted.
- **Self-approval.** Managers and Admins only, and only under the cap. A Block or Flag violation, or any duplicate match, cancels it. Finance always checks the claim.
- **Delegation.** A full handover for a date range. The delegate must hold the same role. The original approver cannot act until the delegation ends or is cancelled. A delegate's own claim goes to the delegate's manager. Delegation does not chain.
- **No drafts.** Submitting saves and submits in one step; if the claim fails a check, nothing is saved and the form keeps what was typed.
- **Confirmations.** Actions that change a claim, money or access (submit, approve, mark paid, verify bank details, delegate, deactivate a user, delete a category...) ask "Are you sure?" first.
- **Cash advances.** Managers and Admins only. One open advance at a time, under a maximum amount. Routed like a claim. Paid in payroll. Later claims are deducted automatically. Overdue advances can be recovered through payroll.

## Screens

The UI follows the "Expense Management Wireframes" layout. A top bar holds search, the TT Suite app switcher, the bell and your name and role. The left sidebar has a **New claim** button and plain text links for your role:

- **Everyone:** Dashboard (the page you see after signing in), My claims, plus Profile and Sign out right under the last link. Sign out asks for confirmation first.
- **Managers:** Approvals, plus Second approval if you approve a Level 2 range, and Delegation.
- **Finance:** Finance review, Categories & policy, Payroll, Advances, Bank changes.
- **Admin:** All claims, Reports, Audit log, Settings. Settings has tabs for Users, Approvals, Categories, Policy limits and General.

The theme is the person's TT Suite preference: Linen (the default), Harbour or Graphite, each in System, Light or Dark. It can be changed in Profile → Appearance or on the portal. The old wireframe **Plain** preset is still in `tokens.css` but is no longer used.

## Added from the wireframes

- **Claims:** a project and business purpose on each claim, with dropdown lists the Admin manages; categories grouped in the picker; receipts can be required only above an amount; a "submit within N days" limit; Withdraw (the claim comes back as Withdrawn to edit and resubmit); comments on a claim; a Progress tracker; Download PDF (uses the browser's print dialog).
- **Lists and search:** the claims list has search, stage tabs with counts, item counts and pages of 20; Admin also gets department and period filters plus "Waiting on" and "Days in stage" columns.
- **Approvals:** a History tab, a "Goes to next" column, "Within policy" shown when a claim has no flags, and bulk Return.
- **Profile:** replaces Preferences. Shows phone, designation and manager; bank details that Finance must verify; which notifications you get; Sign out of all devices (ends every TT Suite session).
- **New pages:** Categories & policy (read-only, for everyone) and Bank changes (Finance).
- **Admin:** import users from CSV; phone and designation on users; per-day and per-financial-year limits; a fallback approver; settings for lists and required fields; a "Last change" line on the settings pages.

## Not built in phase 1

Mileage claims (out of scope in the FRD, though the wireframes show it); email notifications (in-app only, so "Email me" became "Notify me"); a payout schedule twice a month, choice of payment method, and company logo or financial-year settings; Google sign-in; per-person limits (e.g. ₹2,000 per person); detection of split claims, edited receipts and leave or holiday expenses (FR-8.5); GSTR-2B matching (FR-7.6); category visibility by grade, department or location (FR-5.6); city and trip limits and daily allowances (FR-5.7, 5.11); the daily HR sync (FR-4.1); PDF export.

