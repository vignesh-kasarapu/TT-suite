# Leave Management System 2.0

> **TT Suite.** LMS now runs as the `lms` app of the TT Suite: the Python backend
> (`backend-py/`) on the suite's shared PostgreSQL (schema `lms`), sign-in through the
> suite portal, the React SPA (`frontend/`) built with base `/lms/` and served by the
> portal gateway, its API at `/lms/api`. See `backend-py/README.md` ("TT Suite
> integration") and `docs/SUITE-CONTRACT.md` in the suite checkout. The Node `backend/`,
> its MySQL `docker-compose.yml` services and the sign-in steps below describe the
> pre-suite setup; the mobile app (`mobile/`) keeps its own bearer-token sign-in.

Built from `LMS_2_0.pdf` (FRD v2.0) and the 37-table ER design
(`LMS_2_0_ER_Tables_37_SelfApproval.docx`). Strict MVC. No hardcoded business
rules — every `[CONFIG]` value in the FRD lives in `organization_configs` and is
read through `services/config.service.js`.

## Quick start

### 1. Run the project

Prerequisites: Node.js 20+, a MySQL 8 instance (local, or let Docker run one
for you — see [Docker](#docker), below).

```bash
# Backend
cd backend
cp .env.example .env   # fill in DB credentials at minimum
npm install

# Frontend
cd ../frontend
npm install
```

Then pick one of:

- **Single command (recommended for local dev)** — from the repo root:
  ```bash
  npm run install:all   # one-time; installs backend/ and frontend/ deps together
  npm run dev             # runs backend (nodemon :4000) + frontend (vite :5173) together
  ```
- **Two terminals**: `npm run dev` in `backend/`, and `npm run dev` in `frontend/` (http://localhost:5173, proxies `/api` to :4000).
- **Docker** — see [Docker](#docker) below; runs MySQL + backend + frontend together with no local Node/MySQL install needed.

### 2. New organization — first admin login, then add employees

Every request that reaches the API is checked against a real `employees` row
(`requireAuth` in `middleware/auth.middleware.js`) — there's no self-registration
form, so on a brand-new, empty database **nobody** can sign in yet, including
HR. Bootstrap it once, then everything else goes through the UI:

```bash
cd backend
npm run seed   # master data only: roles, leave types, current leave year, org configs, notification templates

# Creates (or, if re-run, just confirms) the first HR/Admin employee record.
BOOTSTRAP_ADMIN_EMAIL="you@yourorg.com" \
BOOTSTRAP_ADMIN_CODE="EMP001" \
BOOTSTRAP_ADMIN_NAME="Your Name" \
npm run bootstrap:admin
```

Then sign in as that person:
- **Real deployment**: configure `ENTRA_*` in `backend/.env` and sign in through
  Microsoft SSO at `/login` with the work email you just bootstrapped.
- **Local/no-Entra testing**: set `DEV_AUTH_BYPASS_ENABLED=true` and
  `DEV_AUTH_BYPASS_EMPLOYEE_CODE` to the employee code you bootstrapped
  (`EMP001` above), restart the backend, and open the app — it signs you in as
  that employee automatically, no Entra needed.

Once signed in as HR/Admin, add the rest of the organization from
**Administration → Employees** in the UI (each new hire is created via the same
`onboardEmployee` flow the API exposes — no more direct-DB steps needed after
this one bootstrap). Each newly-added employee gets an `EMPLOYEE_ONBOARDING_INVITE`
notification + email (see [enabling onboarding email](#4-enabling-the-employee-onboarding-email)) and
then signs in themselves the same way, via Entra SSO with their own work email.

### 3. Running with seed data

`npm run seed` (above) only creates configuration master data — no employees.
For a populated demo/test org instead (useful for trying out the app or QA,
**not** meant for a real organization), run:

```bash
cd backend
npm run seed:demo
```

This creates a small demo org (an HR/Admin, three managers, and several
employees across a full leave lifecycle — pending/approved/rejected requests,
delegations, etc.) and prints sign-in codes for `DEV_AUTH_BYPASS_EMPLOYEE_CODE`
(`EMP001` HR/Admin through `EMP010` Employee) at the end of its output. It's
idempotent and self-verifying — safe to re-run, and it prints `[PASS]`/`[FAIL]`
against its own checklist of business rules as it goes.

### 4. Enabling the employee onboarding email

Onboarding an employee (via the UI, or the bootstrap step above) always tries
to send the `EMPLOYEE_ONBOARDING_INVITE` notification — the in-app copy always
appears regardless, but the emailed copy only actually goes out once real SMTP
credentials are set. In `backend/.env`:

```bash
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=you@yourorg.com
MAIL_PASSWORD=your_app_password   # Gmail: an App Password, not your account password
```

(Any basic-auth SMTP provider works, not just Gmail — `backend/src/utils/mailer.js`
is the only file that talks to it.) With no credentials, or invalid ones, sending
just fails quietly per employee: the in-app notification still appears, the
onboarding action itself still succeeds, and the failure is recorded on that
`Notification` row (`status: 'FAILED'`, with `error_message`) rather than
surfacing as an error to HR — nothing else in the app depends on this
succeeding (LMS-070).

### 5. Deploying to a server

The [Docker](#docker) setup below is the deployment unit — the same three
containers (mysql, backend, frontend) run in production, just with real
secrets and a domain in front of them instead of `localhost`.

1. Provision a server (or VM) with Docker + the Compose plugin installed, and
   clone the repo onto it.
2. `cp .env.example .env` at the repo root and fill in **real** values:
   `SESSION_JWT_SECRET` (long random string), `DB_PASSWORD`/`MYSQL_ROOT_PASSWORD`,
   real `ENTRA_*` credentials, real `MAIL_*` credentials, `DEV_AUTH_BYPASS_ENABLED=false`,
   and `APP_BASE_URL`/`CLIENT_BASE_URL`/`ENTRA_REDIRECT_URI` set to your real domain
   (e.g. `https://leave.yourorg.com`) instead of `localhost`.
3. `docker compose up -d --build` — brings up MySQL (schema created via
   `sequelize.sync()` on first boot, since there are no migration files yet;
   see the `NODE_ENV` note in the Docker section), then the backend, then the
   frontend.
4. Put a reverse proxy in front of the `frontend` container's port 80 to
   terminate TLS on 443 for your domain (e.g. Caddy, nginx, or your cloud
   provider's load balancer) — the app itself only needs to listen on 80/443
   externally; MySQL and the backend's raw port don't need to be exposed to
   the internet at all.
5. Run the [bootstrap step](#2-new-organization--first-admin-login-then-add-employees)
   once against this environment to create the first HR/Admin, same as local.
6. Back up the `mysql_data` Docker volume on whatever schedule your org
   requires — it's the only place data actually lives.

## Module hierarchy (build & read order)

```
0. models/          Sequelize ORM — all 37 tables, the ground truth
1. services/         Business rules (BR-01…BR-46). Routes/controllers never
                    contain logic — only services do.
2. controllers/       Parse request → call service → shape response. Thin.
3. routes/          Pure wiring: router.method(path, controller.fn). Nothing else.
4. middleware/        Auth (Entra/session), role authorisation, error shaping.
5. jobs/           Scheduler: accrual, SLA escalation, LOP conversion — all
                    idempotent (NFR-16), keyed via scheduled_job_runs.
6. frontend/api/       Every backend call, isolated from components.
7. frontend/components/  Glass design system (GlassCard, StatusBadge, buttons) +
                    role-derived layout (Sidebar, BottomNav, Topbar).
8. frontend/pages/     Screens, built on top of 6 and 7.
```

## Database

**MySQL** (via `mysql2` + Sequelize). No dialect-specific SQL leaks into models —
searches use `Op.like` (not Postgres's `Op.iLike`; MySQL's default collation is
already case-insensitive), and the one place that needed a partial/filtered
unique index (`self_approval_permissions`: at most one *active* grant per
employee) is enforced in `services/selfApproval.service.js` instead, since
MySQL has no filtered-index equivalent — always create a grant through that
service, never `SelfApprovalPermission.create` directly.

## What's implemented (R1 core)

- **All 37 ER tables** as Sequelize models (`backend/src/models`), R1 tables fully
  wired with associations; R2/R3 tables modelled but their behaviour is
  deliberately unimplemented, per the FRD's own sequencing rule (§9.4) — the
  ER doc explicitly says "do not enable behaviour in R1 code paths."
- **Auth**: Entra ID OIDC verification, app-session JWT (midnight expiry),
  dev-auth bypass gated + refused in production (LMS-001–009).
- **Core leave lifecycle end to end**: apply → live deduction preview (BR-03–06)
  → overlap/backdating validation → routing (Manager/Delegate, HR second-stage,
  **or the R1 self-approval addendum** with its no-higher-authority check) →
  approve/reject → append-only ledger (BR-07–12) → advance leave → 7-day
  withdrawal window → LOP conversion job → cancellation → withdrawal.
- **SLA reminders & escalation** (BR-33–37), terminating at HR/Admin, never
  auto-approving/rejecting.
- **Config service**: single source for every `[CONFIG]` value — nothing is a
  code constant.
- **Audit service**: append-only, called from every mutating service action.
- **Notification service**: DB-stored templates, in-app + email (Exchange
  OAuth2), failure never blocks the business transaction (LMS-070).
- **Glass frontend shell**: aurora/glass design system, role-derived nav
  (mobile bottom bar + desktop sidebar), Dashboard, Apply (with the live
  breakdown panel LMS-036 calls out as the highest-value screen), My Requests,
  Approvals queue, My Team.

- **Delegation** (LMS-041/042): peer-only eligible-delegate computation with
  supervisor fallback, on-behalf nomination, revoke, both backend and screen.
- **Administration** (7.3.13–7.3.16 slice): employee onboarding with
  circular-hierarchy refusal, leave type + policy + accrual creation (LOP stays
  structurally uneditable), holiday calendar with the affected-approved-requests
  warning, and the organisation configuration screen — every `[CONFIG]` value
  editable with its current value, hint, and audit trail.
- **Reports & Audit** (7.3.18/7.3.19): leave-taken (scoped to hierarchy for
  Managers, org-wide for HR/Admin per BR-39/40), LOP report, audit log viewer.
- **Request detail** (7.3.5): approval timeline, watchers, attachment slot —
  fixes the dangling link from My Requests.
- **Team/peer calendar** (7.3.7/7.3.8): BR-41 respected end to end — the
  backend never sends leave type for the peer view, so there's nothing for the
  client to accidentally leak.
- **Attachments** (LMS-035, NFR-10): upload/download endpoints, stored outside
  the web root, access-checked per request (owner, current approver, or
  HR/Admin only — Watchers excluded at the query layer per NFR-13). Not yet
  wired into the Apply screen's UI.

- **Self-approval administration** (table 37 addendum): HR/Admin grant/revoke
  screen, with the "one active grant per employee" rule enforced in the
  service layer (see Database note above).
- **Attachment upload** wired into the Apply screen (LMS-035): real file picker
  with format/size stated up front, uploaded right after submit, never blocks
  the leave request itself if the upload fails.
- **Watchers, fully wired** (LMS-060/063): Request Detail now shows real
  watcher names (not IDs) and lets a Manager/HR-Admin add one from a
  role-checked candidate list — no free search, matching the delegate picker's
  pattern.
- **Standing watchers** (LMS-061/062): a shared control on My Team (Manager,
  scoped to their own hierarchy — enforced server-side, not just hidden in the
  UI) and Employee Admin (HR/Admin, any employee).
- **R2: employee deactivation & final settlement** (LMS-016/017): records a
  last working day, snapshots the balance per leave type at that date (no
  payment calculation), and the employee is genuinely refused sign-in
  afterward — verified live, not just coded.
- **R2: manager reassignment** (LMS-018): changes the reporting line without
  silently moving pending approvals — a request stays with whoever it's
  actually pending with unless the caller explicitly opts to transfer it, per
  the FRD's own detail note on this requirement.
- **R2: working patterns** (LMS-015/BR-06): per-individual weekend override
  with effective dates, overlap-refused at assignment time. `businessDay.service.js`
  now checks each day against the employee's active pattern before falling
  back to the org default — live-verified that the identical calendar window
  deducts differently for two employees, exactly the edge case the FRD's
  §4.12 calls out.
- **R2: bulk employee import** (LMS-019): CSV upload, per-row validation,
  all-or-nothing commit — a bad row anywhere in the file rolls back rows that
  were individually valid. Supports intra-file manager references regardless
  of row order.
- **R2: notification template editing** (LMS-071): HR/Admin edits any
  template's subject/body through the admin UI; token substitution preserved.
- **R2: manager daily digest** (LMS-072): opting in doesn't just flip a flag —
  `notification.service.js` marks the per-request email `SUPPRESSED` instead
  of sending it (the in-app notification is never suppressed, per LMS-068),
  and a new digest job compiles a manager's suppressed emails into one daily
  summary.

**R2 is now functionally complete** except the WCAG 2.1 AA manual
screen-reader pass (§7.5), which is a manual QA activity, not something to
code.

- **R3: blackout periods** (LMS-085): wired directly into the actual
  submission path, not just an admin screen — a hard block, not a warning.
  Live-verified: created a freeze window, confirmed a submission inside it
  was refused with a clear message naming the period.
- **R3: team capacity limits** (LMS-086): caps concurrent leave-takers under
  a manager. Live-verified with two overlapping requests under a limit of 1
  — the second was correctly refused once the first was pending.
- **R3: leave encashment** (LMS-084): HR-initiated, posts a ledger debit.
  Tested the insufficient-balance guard live (asked to encash far more than
  the balance — refused with the actual figure stated).
- **R3: compensatory off** (LMS-083): credits a new `COMP_OFF` leave type
  against approved out-of-hours work. Verified the ledger entry posts with
  the correct type and a traceable source reference to the work date.
- **R3: calendar feed** (LMS-082): token-authenticated (not session-cookie —
  Outlook polls unattended) ICS feed. Building this surfaced a real RFC 5545
  bug, fixed and verified: all-day `DTEND` is exclusive, so an inclusive
  Oct 5–6 leave needs `DTEND=Oct 7` or the last day renders as a working day
  in Outlook. Revocation was also verified to actually block the old token,
  not just flip an unused flag.

**All five R3 pieces have both backend and a working admin/employee UI now**:
Administration gained "Blackout & capacity" and "Encashment & comp-off" tabs;
every employee gets a "Subscribe in Outlook" card on their Dashboard.

## Verified against a real MySQL instance (not just static checks)

Every claim below was exercised through the actual HTTP API against a live
MySQL 8 database, driving a real three-person org (HR/Admin → Manager →
Employee) — not inferred from reading the code:

- All 37 models sync cleanly on MySQL; seed script runs end to end.
- Submit → route → approve: ledger deduction (BR-09) written **only** on
  approval, confirmed by inspecting `leave_ledger` directly.
- Self-approval addendum: granted, then a request from that employee went
  straight to `APPROVED` with an approval row stamped `stage: SELF`.
- Self-approval *prohibition*: a Manager was blocked from approving their own
  submitted request.
- Withdraw and the full cancellation lifecycle, including the restoration
  credit landing back in the ledger.
- SLA escalation and the advance-leave → 7-day-window → LOP conversion jobs,
  run directly (not just read).
- Watcher add/list, including the employee-name join.
- Standing-watcher authorization boundary: a Manager was correctly refused
  when trying to set one outside their own hierarchy.
- Employee deactivation: final settlement snapshot correct, and the
  deactivated employee's next API call was genuinely refused (not just a
  flag that's never checked).
- Manager reassignment: pending requests correctly stayed with whoever
  they were actually pending with, both with and without the explicit
  transfer flag.
- Working patterns: same request window (Mon–Fri) deducted 4 days for an
  employee with a Friday-Saturday pattern and 5 days for one on the org
  default — confirmed by inspecting the API response directly, not inferred.
  Overlap refusal on assignment also confirmed live.
- Bulk import: valid intra-file manager references committed correctly; a
  file with one bad row was rejected as a whole (the valid row was confirmed
  NOT present in the database afterward); duplicate codes within one file
  caught before any database write.
- Manager digest: enabled it, submitted a request that routed to that
  manager, confirmed the email notification was written as `SUPPRESSED`
  while the in-app one still fired immediately (LMS-068), then ran the
  digest job directly — it correctly attempted to send and only failed on
  the actual SMTP connection (no real mail server in this sandbox), leaving
  the notification `SUPPRESSED` for retry rather than falsely marking it sent.
- Blackout periods: a submission inside an active freeze window was
  correctly refused, naming the period and dates in the error.
- Team capacity: a second employee's overlapping request was refused once
  a teammate's request already filled the manager's capacity limit.
- Encashment: insufficient-balance guard fired correctly with the real
  balance figure quoted back.
- Comp-off: ledger credit posted under the correct type with a traceable
  source reference.
- Calendar feed: ICS output verified correct (including the DTEND fix
  above), and a revoked token was confirmed to actually stop working.

**Three real bugs were found this way and fixed, not hypothetical ones:**
1. `organization_configs.updated_by` was `NOT NULL`, but the seed script has
   no actor yet — seeding crashed. Made it nullable (null = system default).
2. The self-approval-block and missing-adjustment-reason errors surfaced as
   bare `500 INTERNAL_ERROR` instead of a proper `4xx` with a real message —
   violates the FRD's own "no bare error codes" rule. Fixed both.
3. **LOP conversion job's idempotency tracking was itself broken**: its
   `scheduled_job_runs` period key was date-only, so a legitimate same-day
   rerun crashed on the unique constraint before it ever reached the
   per-request check that actually makes it idempotent. Separately, the SLA
   reminder had a dead `_reminderSent` flag that never persisted, so a
   pending request would get re-notified on every 15-minute cron tick. Both
   fixed and re-verified with repeated runs against MySQL.

## Gaps found and fixed after cross-checking against the Roles &
Responsibilities and Workflows planning docs

Two later planning documents (`LMS_2_0-Roles_Responsibilities.docx`,
`LMS_2_0_Workflows.docx`) refined three things beyond the original FRD/ER
docs. All three are now built and live-verified:

- **Watcher removal** (Roles §2.9: "Add/remove Watcher") — a Manager can
  remove a watcher from any request in their own reporting line (any depth);
  HR/Admin can remove from any request org-wide. Live-verified both the
  happy path and the authorization boundary (a Manager was correctly blocked
  from removing a watcher on a request outside their hierarchy).
- **Peer calendar scope narrowed** (Workflows §10.3: peers must share the
  same reporting Manager **and** the same management level, not just the
  same manager) — `getPeerCalendar` now filters on both. Live-verified: two
  employees under the same manager but different levels no longer see each
  other's peer calendar entries.
- **HR/Admin org-wide delegation visibility** (Roles §2.6: "R Org (optional
  visibility)") — a new `GET /api/delegations` (HR/Admin only) lists every
  delegation in the org, alongside the existing self-scoped `/mine` for
  Managers. Live-verified the role boundary: a Manager was correctly
  refused when trying to hit the org-wide endpoint.

### Open question — not yet resolved, needs a decision

The same two documents describe self-approval more strictly than what's
built: "No actor may Approve or Reject a request where they are the
requester — route to next level above" (Roles §4; Workflows §7.1), with no
mention of any grant or exception. What's built is the ER doc's table 37
addendum — a controlled grant (`self_approval_permissions`) that lets a
specific, HR-designated employee with no higher authority approve their own
request directly (`stage: SELF`), rather than escalating.

These two designs are incompatible as written. The addendum is still in the
code (models, service, admin UI) — nothing has been removed pending a
decision on which behavior is correct. See `approvalRouting.service.js`'s
`isEligibleForSelfApproval` for exactly where this would need to change if
the addendum is to be removed or narrowed.

## Gaps found on a third pass — this time against the Workflows doc's actual
diagrams (not just the FRD prose), fixed and live-verified

Reading every one of the Workflows document's 15 subsystem diagrams against
the running code (not just the FRD text) surfaced one more security gap and
several missing notification/scheduler behaviors the diagrams call out
explicitly:

- **🔴 Security: `GET /leave-requests/:id` had no authorization at all.** Any
  authenticated employee could read any request's full reason and
  attachments by knowing/guessing the ID — violates BR-42/NFR-13. Fixed with
  a proper scoped-detail function: full access for the owner, HR/Admin, the
  current approver, or anyone who has approved it in the chain; a **masked**
  projection for a Watcher (dates/status/type only, Sick rendered as
  "Unavailable", masking applied at the query layer per the Workflows doc's
  explicit instruction — never left for the client to hide); an outright 403
  for anyone else. Live-verified all three paths, including that the masked
  response has no `reason` key present at all, not just hidden client-side.
- **Watcher notifications were never sent** on submit/approve/reject/cancel
  (§6.5 of the notification matrix) — watchers were added as records but
  nothing ever notified them. Fixed and live-verified for submit and
  approve.
- **Standing watchers never actually applied to new requests** (LMS-062) —
  the CRUD existed but nothing consulted it at submission time. Fixed:
  `applyStandingWatchers` runs on every submit and draft-promotion. Live-
  verified: a standing watcher was auto-added to a new request and notified.
- **Sick-leave alerting was entirely unbuilt** (BR-43/44/45) — no
  notification to the supervisor or HR/Admin when sick leave crosses the
  threshold, and no contiguous-Sick-day aggregation for it. Fixed and
  live-verified with a 4-day sick request correctly alerting both toggled
  recipients.
- **Manager's-supervisor notification on long-leave was missing** (BR-26) —
  fixed and live-verified: an 11-day request approved by the Manager
  correctly moved to `PENDING_HR` and notified the Manager's own supervisor.
- **Year-end carry-forward/lapse never ran** (LMS-056/BR-27) — the ledger
  entry types existed but nothing ever posted them. Built
  `carryForward.job.js` plus a manual-trigger admin endpoint. Live-verified
  with real numbers: an employee with a 97-day balance and a 10-day cap
  correctly got a 10-day carry-forward credit into the new year and an
  87-day lapse debit in the old one; a negative-balance employee and a
  deactivated employee were both correctly skipped.
- **Draft save/edit/discard/submit was entirely unbuilt** (LMS-040) — full
  lifecycle now live-verified: saved a draft (no validation applied, per
  spec), edited it, promoted it to `PENDING_MANAGER` (all the same gates as
  a fresh submission ran at that point, not before), and separately verified
  discard actually deletes the row. Frontend wired: a working "Save as
  draft" button on Apply, and Submit/Discard actions on draft rows in My
  Requests.
- **A real leftover bug from the Postgres→MySQL migration**: `DB_PORT`
  still defaulted to `5432` in `config/env.js`, so any environment without
  an explicit `.env` value silently tried the wrong port. Fixed to `3306`.
- **A repeat of the LOP job's idempotency bug, this time in the new
  carry-forward job**: its `scheduled_job_runs` period key was keyed only on
  the closing year, so a legitimate rerun crashed on the unique-constraint
  before ever reaching the per-employee idempotency check that actually
  works. Fixed the same way as the LOP job — timestamped period key for the
  audit trail, real idempotency stays in the per-entry `source_reference`
  check — and added an explicit early-exit when the year is already closed.
  Verified with three consecutive reruns: zero collisions, zero duplicate
  ledger rows.

## Critical + R1 gaps found on a second FRD pass, fixed and live-verified

A closer re-check against the original FRD (not the two newer docs) surfaced
one gap serious enough to block real usage, plus five R1 items that were
supposed to be complete but weren't:

- **🔴 No way to assign the Manager or HR/Admin role.** `EmployeeRole` rows
  only existed because `seed.js` hardcoded two of them for test users —
  there was no endpoint or screen for HR/Admin to promote anyone. Every
  employee created through onboarding or bulk import was permanently stuck
  with no approval authority even if people reported to them. Fixed:
  `roleAssignment.service.js` (`assignRole`/`revokeRole`, idempotent,
  enforces "at least one HR/Admin must always exist" per the FRD's own role
  rule, LMS-009 audit on every change), a `RoleAssignment` control per
  employee row in Employee Admin. Live-verified: assigned MANAGER to a
  previously-role-less employee, confirmed the audit entry, and confirmed
  revoking the org's last HR/Admin is refused.
- **Notification centre (§7.3.10)** — didn't exist; the bell icon was
  decorative. Built `notificationCentre.service.js` (list/unread-count/mark-
  read/mark-all-read) and a real dropdown (`NotificationBell.jsx`) that
  deep-links to the related request. Live-verified read-state actually
  changes the unread count.
- **Employee-facing holiday calendar (§7.3.9/LMS-077)** — only the HR/Admin
  management screen existed; "all users" wasn't literal. Added a read-only
  `/api/holidays` endpoint and a `HolidayCalendar` page/nav item available
  to everyone.
- **Team calendar vs. peer calendar were conflated (§7.3.7 vs §7.3.8)** —
  these are two different screens in the FRD (Manager sees full hierarchy
  + leave type; Employee sees peers only, type hidden per BR-41/NFR-14), but
  one screen was doing the peer version for every role. Added
  `getTeamCalendar` (full hierarchy, includes type) and branched the
  frontend by role. Live-verified the Manager view actually returns
  `LeaveType`, unlike the peer endpoint.
- **Balance adjustment screen (§7.3.17)** — the API existed but nothing
  called it. Built the actual screen: employee/type picker, current balance,
  a projected-balance preview before confirmation, and the full ledger
  inline, per the FRD's spec. Building this surfaced a real bug — the
  underlying ledger endpoints threw a raw SQL error when `leaveYearId`
  wasn't supplied (Sequelize treats an explicit `undefined` in a `where`
  clause as a query error, not "no filter"). Fixed by defaulting to the
  current leave year when unspecified, verified live with a full ledger
  read (opening credit → deduction → restoration → manual adjustment, all
  four entry types, correct running balance).
- **Attachments never displayed** — the upload endpoint worked, but Request
  Detail hardcoded "No attachments uploaded" and the backend's detail query
  didn't even fetch them. Fixed both layers; attachments now list with a
  working download link.

## What's scaffolded but not yet wired

1. Full WCAG 2.1 AA conformance pass (R2 §7.5) — manual screen-reader QA, not
   a coding task; the R1 accessibility core (keyboard operability, focus
   indicators, contrast) is already in the design system.
2. Report export (LMS-081) — the last unbuilt R3 item. Reports currently
   render in-app; no CSV/spreadsheet export button yet.
3. Employee-facing views of their own encashment history and comp-off
   credits (backend endpoints `/r3/leave-encashment/mine` and
   `/r3/comp-off/mine` exist; no screen reads them yet — HR/Admin can see
   what they've posted, but an employee can't yet see their own history in
   one place outside the ledger).

At this point every FRD-numbered requirement (R1 through R3) has a working
backend path; what remains is UI polish and the one QA-only item above.

## Running it

```bash
# Backend
cd backend
cp .env.example .env   # fill in Entra + MySQL + SMTP values
npm install
npm run seed            # roles, leave types, management levels, org configs, templates
npm run dev

# Frontend
cd frontend
npm install
npm run dev              # http://localhost:5173, proxies /api to :4000
```

Nothing here is hardcoded around one deployment: change any `[CONFIG]` value
through `/api/config`, not by editing code.

### Single command (both servers together)

From the repo root:

```bash
npm run install:all   # installs backend/ and frontend/ deps
npm run dev            # runs backend (nodemon) + frontend (vite) concurrently
```

Requires `backend/.env` to already exist (see above) — this just orchestrates
the same two dev servers, it doesn't change how either one runs.

### Docker

Fully containerized: MySQL, backend (Node/Express), and frontend (static
build served by nginx, which proxies `/api` to the backend container).

```bash
cp .env.example .env   # root .env — feeds both the mysql container and the backend
docker compose up --build
```

- Frontend: http://localhost
- Backend: http://localhost:4000 (also reachable at `/api` through the frontend's nginx)
- MySQL: internal to the compose network only by default (avoids clashing
  with a MySQL already running on the host's 3306); data persisted in the
  `mysql_data` volume regardless. See `docker-compose.yml` to publish
  `3307:3306` if you need host access.
- Uploaded attachments persist in the `storage_data` volume

`NODE_ENV` defaults to `development` in the root `.env.example` because this
repo creates its schema via `sequelize.sync()` on boot and has no migration
files yet — switching to `production` disables that sync and the schema will
never be created until real migrations exist.
