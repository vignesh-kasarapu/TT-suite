# TT Suite

One Microsoft sign-in, one dashboard and one global admin for the three Tektalis apps: **Kanban**, **LMS** (Leave) and **EMS** (Expense). Everything runs on one Azure App Service (B1) and one Postgres database.

```
 one web app                               one database
 python deploy/run.py                      schema public  -> Kanban (unchanged)
   portal  :8000  public  /, /api           schema suite   -> people, access, sessions
   kanban  :8002  /kanban                   schema lms     -> Leave
   lms     :8003  /lms                      schema expense -> Expense
   expense :8004  /expense
```

The **portal** is the only public process. It handles sign-in, the dashboard, global user and access management, and works as a gateway that proxies `/<app>/api/*` to each app on localhost and serves each app's SPA.

## Repository layout

| Path | What |
|---|---|
| [packages/suite_core/](packages/suite_core/) | Shared Python library: `suite` schema and migrator, session cookie, identity resolve, access mirror, Entra/Graph/SMTP clients |
| [portal/backend/](portal/backend/) | Portal API and gateway (FastAPI, async SQLAlchemy, psycopg 3) |
| [portal/frontend/](portal/frontend/) | Portal SPA (React 19, Vite, TypeScript): sign-in, dashboard, profile, users & access, audit log |
| [deploy/](deploy/) | Process launcher (`run.py`), package builder (`build.mjs`), local Postgres (`docker-compose.yml`), Kanban cutover SQL |
| [docs/SUITE-CONTRACT.md](docs/SUITE-CONTRACT.md) | The fixed interface between the portal and the apps |
| [CHANGES.md](CHANGES.md) | Change log for every work package, verification results and open items |

The three apps are separate git repositories and are git-ignored here. Check them out next to the suite code:

```
TT-suite/
  Kanban-internal-main/          # Kanban repo
  lms-2.0-main/lms-2.0-main/     # LMS repo
  ems/                           # EMS repo
```

## Local development

Requirements: Python 3.13, Node 22+, Docker.

1. **Start Postgres** (port 5433, databases `ttsuite` and `ttsuite_test`, roles `app_owner` and `app_rw`):
   ```
   npm run suite:db
   ```
2. **Create the local env file:** copy [deploy/.env.example](deploy/.env.example) to `TT-suite/.env`. It uses dev sign-in and the stub mailer. `run.py` loads this one file for all four processes.
3. **Create the Python environments.** `run.py` looks for `.venv-suite` or `.venv` in each app's backend folder (or set `<APP>_PYTHON`).
   ```
   cd portal/backend
   python -m venv .venv
   .venv/Scripts/pip install -r requirements.txt -e ../../packages/suite_core
   ```
   Do the same in each app's backend folder with its own `requirements.txt`.
4. **Build the SPAs:**
   ```
   npm run suite:package
   ```
5. **Run everything:**
   ```
   npm run suite:run
   ```
   Open http://localhost:8000. Each process migrates its own schema on start. Health is at `/api/health`.

For frontend work on the portal alone, `cd portal/frontend && npm install && npm run dev`.

## Tests

```
npm run test:core      # suite_core
npm run test:portal    # portal backend
```

Each app's tests run from its own backend folder. See the verification table in [CHANGES.md](CHANGES.md#verification-all-run-locally-against-the-one-postgres-database).

## Deploy

`npm run suite:package` builds all four SPAs and assembles `dist-suite/` with one merged `requirements.txt`. Deploy that folder to the existing App Service with startup command `python deploy/run.py`.

The full Azure guide (app settings, Entra redirect URI, Kanban cutover, checks and rollback) is in [deploy/README.md](deploy/README.md).

## Key rules

- **Sign-in happens only in the portal.** Apps read the shared `__Host-tt_session` cookie (`tt_session` outside prod) through `suite_core.identity`.
- **Only the owning app writes `suite.app_access`**, in the same transaction as its own user or role change. The portal changes access by calling the app's localhost-only `POST /internal/provision`, protected by `INTERNAL_TOKEN`.
- **Run one instance only.** The schedulers run in-process and would run twice on two instances.
