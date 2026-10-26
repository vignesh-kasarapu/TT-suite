# SKILLS.md — recurring task playbooks for the Python migration

Concrete step-by-step recipes for the tasks that will repeat constantly across
`MIGRATION_PLAN.md`'s phases. Read `AGENTS.md` first for the standing rules
(layering, 250-line cap, DTO/DAO separation) — this file is "how", that one is
"what/why".

## Recipe 1 — Port one Node service function to Python

1. Open the matching `backend/src/services/*.js` file. Read the whole
   function, not just its signature — note every `BR-XX`/`LMS-XXX` comment.
2. Find (or create) the matching DAO method(s) in `backend-py/app/dao/` for
   whatever queries the function makes. A DAO method does ONE query/mutation;
   if the Node function does three different lookups, that's three DAO calls
   from the service, not one DAO method doing all three.
3. Write the service function in `backend-py/app/services/<area>.py` (or the
   matching submodule if the area is already a package, e.g.
   `services/leave_request/submission.py`). It should:
   - Accept plain values or a DTO, never a FastAPI `Request`.
   - Call DAO methods for all data access — no raw `session.query(...)` in a service.
   - Raise `AppError` subclasses (`app/core/exceptions.py`) for business-rule
     failures, with the same error `code` string the Node version used (the
     frontend's error handling matches on `error.code`, not just the message).
   - Keep the `BR-XX`/`LMS-XXX` reference in a comment/docstring.
4. Write a unit test in `backend-py/tests/` asserting the same inputs produce
   the same outputs as the documented Node behavior (use the exact numbers
   from the Node service's own comments/examples where available).
5. Run `pytest` for that test file specifically before moving to the next function.

## Recipe 2 — Add a new FastAPI endpoint

1. Define/confirm the request and response DTOs in `app/schemas/<area>.py`
   (Pydantic `BaseModel`s — request DTOs validate input, response DTOs shape
   output; don't reuse one class for both unless they're genuinely identical).
2. Add the thin route function in `app/routers/<area>.py`:
   ```python
   @router.post("/leave-requests")
   def submit(payload: SubmitLeaveRequestIn, user=Depends(get_current_user), db=Depends(get_db)):
       result = leave_request_service.submit(db, user.employee_id, payload)
       return ok(result)
   ```
   That's the whole router function — no `try/except`, no business logic. Errors
   propagate as `AppError` and are handled globally (see `app/core/exceptions.py`).
3. Wire auth: `Depends(get_current_user)` for any authenticated route,
   `Depends(require_role("HR_ADMIN"))` (or similar) for role-gated ones —
   check `backend/src/routes/*.routes.js` for the exact role list on the
   matching endpoint, don't guess.
4. Register the router in `app/main.py` if it's a new router file.
5. Verify with `curl`/`httpx` against a running `uvicorn` instance — check
   status code AND the `{success, data}` / `{success:false, error}` envelope
   shape matches what `frontend/src/api/*.js` expects for that call.

## Recipe 3 — Add a schema/migration change

1. Edit the SQLAlchemy model in `app/models/`.
2. `alembic revision --autogenerate -m "<description>"` — **read the generated
   file before running upgrade**; autogenerate sometimes gets column-type
   nuances wrong (it did during Phase 0 scaffolding — always sanity-check the
   diff, don't blindly trust it).
3. `alembic upgrade head` against your local dev DB.
4. `alembic check` — must report no new operations detected.
5. Confirm the app still boots (`uvicorn app.main:app`) and `/api/health` is green.

## Recipe 4 — Verify a phase is actually done (not just "files exist")

- `alembic check` reports clean.
- `pytest` passes for everything written so far.
- The app boots via both `uvicorn app.main:app --reload` (local) AND
  `docker compose up --build backend-py` (containerized) — these can diverge
  (env var names, file paths) and both need to work.
- For anything with a Node equivalent already live on `:4000`, do a side-by-side
  call comparison (same input, compare `data` payloads) before considering the
  port faithful.

## When to reach for a specific Claude Code capability

- **Explore agent** — before porting an unfamiliar service, to inventory every
  function in it plus its cross-service dependencies (this is how the original
  `MIGRATION_PLAN.md` research was done — see its commit history/session for
  the pattern).
- **Plan mode** — before starting a new phase from `MIGRATION_PLAN.md`, or any
  decision not already settled there (e.g. exact mobile navigation structure).
- **Background agents in parallel** — good for porting several small,
  independent services at once (e.g. all of Phase 5's admin CRUD services);
  bad for anything in the ordered critical path (auth, then core leave
  lifecycle, then jobs) since those have real sequencing dependencies.
- **`/code-review` skill** — run it on a phase's diff before considering that
  phase's PR-equivalent finished, same as you would on any other change in
  this repo.
