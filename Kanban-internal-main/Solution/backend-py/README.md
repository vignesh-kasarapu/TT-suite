# Kanban backend (Python / FastAPI)

The Kanban V1.0 API on Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2.0 (async, psycopg 3) and
Alembic (D-109). Since cut-over (slice M5) it is the only backend: all 89 operations, the
notification worker and the built SPA, in the image from `../Dockerfile`.

## Layers

```
HTTP -> middleware (correlation id + security headers, rate limit, CSRF, body cap)
     -> controller   app/controllers/   routes, roles, schemas, status codes - nothing else
     -> service      app/services/      every rule, access check and transaction (commit)
     -> repository   app/repositories/  every SQL statement; visibility predicates take the actor
     -> model        app/models/        SQLAlchemy mirror of the schema (never autogenerates)
schemas  app/schemas/      Pydantic request/response models (camelCase on the wire)
errors   app/exceptions/   AppException family -> RFC 9457 problem+json, one shape for all errors
```

`tests/unit/test_architecture.py` fails the build if a layer imports what it must not, or a route
has no `x-roles`.

## Run

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt     # Windows; .venv/bin/pip elsewhere
docker compose -f ../docker-compose.yml up -d db       # PostgreSQL 17 with the two roles
cp .env.example .env                                   # adjust; never commit secrets
.venv/Scripts/python -m app                            # migrate -> seed -> serve on PORT
```

Demo data (dev and trial only; adds 7 people, 3 teams with leads, a program, 3 projects, tags
and 19 cards with comments, links and logged time; stops if it already ran; refused in prod):

```bash
.venv/Scripts/python -m scripts.seed_demo
```

API docs (dev/test only): `http://localhost:8080/api/docs`, OpenAPI at `/api/openapi.json`. The
committed contract `Solution/api/openapi.json` is exported from the code with
`python -m scripts.export_openapi` (`--check` in CI; `npm run contract:sync` from the repo root).

## Migrations

`alembic/sql/NNNN_<slug>.{up,down}.sql` are the schema's source of truth; each Alembic revision
of the same id runs one file verbatim. The SQL grants to the placeholder `app_rw`, swapped for
the user in `DATABASE_URL` (D-106). A database migrated by the previous runner is stamped from
its `schema_migration` table on first boot. Never use `alembic revision --autogenerate`: write
the next `NNNN_*.up.sql`/`.down.sql` pair and a revision that calls `run_sql_file`.

```bash
.venv/Scripts/python -m app.db.cli up        # reads DATABASE_OWNER_URL / DATABASE_URL (.env)
.venv/Scripts/python -m app.db.cli down 1
```

## Checks

```bash
.venv/Scripts/ruff check . && .venv/Scripts/ruff format --check .
.venv/Scripts/mypy app tests scripts         # strict
.venv/Scripts/python -m pytest               # unit + integration + migrations (needs the Compose db)
```

From the repo root the same run as `npm run py:lint` and `npm run py:test` (both in `ci:local`).
