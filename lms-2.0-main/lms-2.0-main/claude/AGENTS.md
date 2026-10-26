# AGENTS.md — instructions for any AI coding agent working in this repo

This file follows the [agents.md](https://agents.md) convention (tool-agnostic
instructions any AI coding agent should read first). `CLAUDE.md` at the repo
root points here for Claude Code specifically.

## What this repo is, right now

Three things coexist during an in-progress migration — **do not confuse them**:

| Directory | Stack | Status |
|---|---|---|
| `backend/` | Node/Express/Sequelize | **Live, untouched.** Keeps running until an explicit cutover decision. See its own `README.md`. |
| `frontend/` | React (JS) + Vite | **Live, untouched.** Talks to `backend/` today. |
| `backend-py/` | Python/FastAPI/SQLAlchemy/Alembic | **New, in progress.** Rewrite of `backend/`, phase by phase. See `MIGRATION_PLAN.md`. |
| `mobile/` | React Native/Expo/TypeScript | **Scaffolded, Tier 1 (first pass) built.** See `mobile/README.md`. Talks to `backend-py/` via bearer token. |

**Read `MIGRATION_PLAN.md` before touching `backend-py/`.** It has the full
phase list, the confirmed scope decisions (fresh-start DB, no legacy data to
preserve), and the auth architecture (one session-token function, cookie
delivery for web, bearer-token delivery for mobile).

Never delete or modify `backend/`'s behavior as a side effect of `backend-py/`
work. Never point `backend-py/` at the same MySQL schema `backend/` uses — it
has its own database name (`lms_2_0_py` by default) specifically so the two
ORMs never race on DDL during development.

## Coding standards for every new `backend-py/` file (non-negotiable)

Strict layered MVC, one direction of dependency:

```
router (controller) -> service (business logic) -> DAO (data access) -> SQLAlchemy model -> DB
```

- **Routers (`app/routers/`) are thin.** Parse the request into a DTO, call exactly
  one service function, return its result. No business logic, no direct DB
  session use, no direct model imports beyond type hints.
- **Services (`app/services/`) hold all business logic** — the BR-XX/LMS-XXX rules
  ported from the Node app. A service never imports `fastapi` (no `Request`/
  `Response`/`HTTPException`); it raises a plain `AppError` subclass from
  `app/core/exceptions.py`, which a registered exception handler turns into HTTP.
- **DAOs (`app/dao/`) are the only place that touches a SQLAlchemy `Session`.**
  One query/mutation per method, returning ORM objects or primitives — no rule
  branching beyond simple filters.
- **Data flows top-to-bottom on the way in, bottom-to-top on the way out.**
  Router -> Service -> DAO -> DB, then DB rows -> DAO -> Service (maps to a DTO)
  -> Router (returns the DTO). No layer calls back up. No layer is skipped in
  either direction, ever — a router must never import a DAO directly, and a
  service must never construct a `Response`.
- **DTOs are separate from ORM models.** Every request/response shape is a
  Pydantic schema in `app/schemas/`, never a serialized ORM instance directly.
- **Max ~250 lines per file.** When a service/DAO/router would exceed this,
  split it into a package of cohesive submodules by *use-case*
  (e.g. `app/services/leave_request/{preview,submission,decision,cancellation,drafts}.py`),
  not by an arbitrary line cutoff.
- Every mutating service action gets an audit-log write, matching the Node
  app's `audit.service.js` pattern — see the inventory in `MIGRATION_PLAN.md`
  for which BR-XX rule requires it.

## Working with an existing Node file (the actual porting task)

Most `backend-py/` work is: open the matching `backend/src/**/*.js` file, port
its exact behavior (including business-rule comments — keep the `BR-XX`/
`LMS-XXX`/`NFR-XX` references in the Python docstring/comment, they're not
decorative, they're the spec), and write a test that would catch a behavioral
drift. Do not "improve" or redesign business logic while porting it — faithful
port first; propose changes separately if something looks wrong.

## Testing & verification expectations

- After any `backend-py/` change: `alembic check` (schema drift), `pytest`
  (unit tests), and hit `/api/health`.
- After a schema change: `alembic revision --autogenerate`, review the
  generated file before committing, `alembic upgrade head`.
- Don't claim an endpoint works without actually calling it (curl/httpx/pytest)
  against a running app — a clean `import` is not a passing test.

## Docs map

- `README.md` — the current Node/React app (unchanged during migration).
- `MIGRATION_PLAN.md` — the migration plan, phases, and architecture decisions.
- `backend-py/README.md` — Python backend setup/run instructions.
- `SKILLS.md` — recurring task playbooks (porting a service, adding an
  endpoint, adding a migration) — check here before starting a new phase.
- `mobile/README.md` — Expo app instructions (added when mobile scaffolding starts).
