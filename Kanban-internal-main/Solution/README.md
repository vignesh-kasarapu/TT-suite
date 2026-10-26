# Solution — Kanban V1.0 (Python 3.13 + FastAPI + PostgreSQL 17 + React 19 / Vite)

React 19 SPA (`frontend/`) + FastAPI backend (`backend-py/`, D-109), one Postgres 17 database, one
Docker Compose stack for local dev. Ships with: server-side sessions, dev sign-in (user picker)
with Entra OIDC, roles member/admin, per-user theme preferences, the Tektalis house theme,
Alembic migrations over hand-written SQL, security headers/CSRF/rate limits, and the full test
harness (pytest unit + integration per-module DB, frontend unit, Playwright at three viewports,
axe). The API contract is FastAPI's generated OpenAPI (`Solution/api/openapi.json`).
Backend layers and commands: `backend-py/README.md`; this file is the "get it running" doc.

Sign in locally at http://localhost:8080/sign-in and pick a fixture user (`npm run db:seed:dev`
seeds Asha Admin, Meera Member, Mohan Member).

## Quick start (Windows, < 5 minutes)

**Prerequisites:** Windows 11, [Docker Desktop](https://www.docker.com/products/docker-desktop/) (WSL 2 backend, free tier), Node.js 24 LTS, Python 3.13, Git for Windows.

```powershell
# 1. Check npm (ships with Node 24; the repo needs npm 11.16+ — no corepack step)
npm --version

# 2. Install dependencies (npm workspaces: frontend + tests, from package-lock.json; the
#    backend's Python environment in Solution/backend-py/.venv, which the npm scripts use)
npm ci
cd Solution/backend-py; python -m venv .venv; .venv\Scripts\pip install -r requirements-dev.txt; cd ../..

# 3. Start Postgres only (the app runs on the host with hot reload)
npm run db:up

# 4. Run the app
$env:APP_PROFILE='dev'; $env:AUTH_DEV_MODE='true'; node scripts/py.mjs -m app   # http://localhost:8080
npm run dev -w Solution/frontend    # http://localhost:5173, proxies /api to :8080

# 5. Playwright browsers (one-time; ~600 MB into %LOCALAPPDATA%\ms-playwright)
npm run playwright:install

# 6. Full local CI gate — contract:check → lint → format → typecheck → py:lint → test:unit →
#    db:up → py:test → build → image:build → e2e:reset → test:e2e → scan → report
npm run ci:local -- --stage S1     # writes Outputs/TestEvidence/S1/summary.md + logs
```

Stop everything: `npm run db:down`.

## Tests

| Command                                                                                     | What it runs                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:unit`                                                                         | Vitest `unit` project (offline): frontend unit tests in `Solution/tests/unit/**`                                                                                                                                                                                                                                   |
| `npm run py:lint`                                                                           | ruff, ruff format, mypy --strict over `Solution/backend-py`                                                                                                                                                                                                                                                        |
| `npm run py:test`                                                                           | pytest: backend unit, architecture, integration and migrations against the Compose `db`; each module clones `app_template` into its own database                                                                                                                                                                   |
| `npm run test:e2e`                                                                          | `scripts/e2e.mjs`: `docker compose up app db` (built image), Playwright at desktop 1280×800 / tablet 768×1024 / mobile 390×844 on Chromium, then the `@smoke` subset on WebKit + Firefox, then `compose down`                                                                                                      |
| `npm run e2e:walkthrough`                                                                   | On request, not in `ci:local`: on an **empty** dev database whose boot admin is `anita.rao@example.test` (backend + `npm run dev`), builds a small company through the UI - admin, two teams with a lead and three members each - and uses every feature as each person. Leaves that data behind to look around in |
| `npx playwright test -c Solution/tests/e2e/playwright.config.ts --project=desktop-chromium` | One project against a running server (`E2E_BASE_URL`, default `http://localhost:8080`)                                                                                                                                                                                                                             |

**Smoke engines.** On macOS (the build machine since 2026-09-26, D-107) `npm run test:e2e` runs
the WebKit `@smoke` projects natively, in the same Playwright run as the Chromium viewports, and
Firefox in the container below (Playwright's Firefox build does not start on macOS 27); install
the host engines once with `npx playwright install chromium webkit`.
On Windows, 11 _Smart App Control_ blocks the unsigned Firefox/WebKit binaries Playwright
downloads (`browserType.launch: ... Application Control policy has blocked this file`), so there
the default runs them inside the official Playwright Linux image
(`Solution/tests/e2e/Dockerfile.smoke`, image `app/e2e-smoke:local`). Override with
`E2E_SMOKE=native` (the GitHub runner), `docker`, `hybrid` or `skip`.

E2E artefacts (local only): `Solution/tests/e2e/test-results/` (screenshots per viewport,
`axe/*.json`, `results.json`), `test-results-smoke/` (container run only), `playwright-report/`.
`npm run ci:local` copies screenshots + axe reports into `Outputs/TestEvidence/<stage>/`.

## Migrations

`backend-py/alembic/sql/NNNN_<slug>.up.sql` / `.down.sql`, one Alembic revision each. The app
applies pending migrations at boot with `DATABASE_OWNER_URL` under an advisory lock and then
closes that connection. Manually: `npm run db:migrate` / `npm run db:migrate:down -- [n]` (reads
`Solution/backend-py/.env`/environment).

## OneDrive

This working tree lives inside OneDrive by decision. Three manual, one-time steps on a
new machine:

1. npm's package cache is `%LOCALAPPDATA%\npm-cache`, already outside OneDrive sync —
   nothing to do there.
2. In OneDrive Settings → Sync and backup → Advanced, exclude (or mark "Always keep on
   this device" / add to sync exclusions) these folders once they exist:
   `Solution/**/node_modules`, `Solution/**/dist`, `Solution/**/.vite`,
   `Solution/**/test-results`, `Solution/**/playwright-report`. **This is a manual
   OneDrive-client setting — nothing in this repo can change it for you.**
3. Docker data (`app_pgdata`) is a named volume in the WSL 2 VHD, not in this folder —
   nothing to do there. Playwright's browser cache installs to
   `%LOCALAPPDATA%\ms-playwright`, also outside OneDrive.

If installs are slow or lock up, pause OneDrive sync for the folder during `npm ci`.

## Contract

The contract is what FastAPI generates from the controllers and Pydantic schemas (D-109).
`Solution/api/openapi.json` is a committed export of it, and the frontend's types
(`frontend/src/api/schema.d.ts`) are generated from that file. After an API change:

```powershell
npm run contract:sync    # re-export openapi.json from the code
npm run contract:types   # regenerate the frontend types
npm run contract:check   # CI step — fails if openapi.json is out of date
```

## Repository layout

| Folder        | What's there                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `frontend/`   | React SPA — no business logic                                                                             |
| `backend-py/` | FastAPI backend + notification worker — all business logic; migrations in `alembic/`                      |
| `db/init/`    | Compose-only role/template bootstrap                                                                      |
| `infra/`      | Deploy script; dormant `.github/workflows/` live at the repo root                                         |
| `tests/`      | frontend unit / e2e / fixture seeds (workspace package `tests`); backend tests are in `backend-py/tests/` |
