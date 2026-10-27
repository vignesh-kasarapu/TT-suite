# TT Suite

One Microsoft sign-in, one dashboard and one global admin for the four Tektalis apps: **Kanban**, **LMS** (Leave), **EMS** (Expense) and **AMS** (Asset Management). Everything runs as four processes on one server and uses one PostgreSQL database.

```
 one server (or one Azure App Service)     one PostgreSQL database
 python deploy/run.py                      schema kanban  -> Kanban
   portal  :8000  public  /, /api           schema app     -> people, access, sessions (global)
   kanban  :8002  /kanban                   schema lms     -> Leave
   lms     :8003  /lms                      schema expense -> Expense
   expense :8004  /expense                  schema ams     -> Asset Management
   ams     :8005  /ams
```

The **portal** is the only process users reach. It handles sign-in, the dashboard and the global admin screens. It also works as a gateway: it forwards `/<app>/api/*` to each app on localhost and serves each app's web pages.

**Contents**
1. [What you need](#1-what-you-need)
2. [Get the code](#2-get-the-code)
3. [Run on your laptop](#3-run-on-your-laptop)
4. [Deploy on an organisation server](#4-deploy-on-an-organisation-server)
5. [Deploy to Azure](#5-deploy-to-azure)
6. [Day-to-day development](#6-day-to-day-development)
7. [Continuous integration](#7-continuous-integration)
8. [Repository layout and rules](#8-repository-layout-and-rules)

---

## 1. What you need

| Tool | Version | Needed for |
|---|---|---|
| Git | any recent | getting the code |
| Python | **3.13** | running the backends |
| Node.js | **24** (Kanban requires it) | building the web pages (only on the machine that builds) |
| Docker Desktop | any recent | the local database (developer setup), or the whole suite (Docker option) |
| PostgreSQL | 16 or 17 | the database on a server (Docker is fine locally) |

On Windows, run the commands below in **PowerShell** from the `TT-suite` folder unless a step says otherwise.

---

## 2. Get the code

Everything is in **one git repository**: the portal, the shared library, the deploy scripts and the four apps.

```powershell
git clone https://github.com/vignesh-kasarapu/TT-suite.git
cd TT-suite
```

The apps live in fixed folders; the build and the launcher look for these names:

```
TT-suite/
  Kanban-internal-main/          Kanban
  lms-2.0-main/lms-2.0-main/     LMS
  ems/                           EMS
  portal/  packages/  deploy/  docs/
```

**To get the latest changes later:** `git pull`.

The apps' earlier separate repositories (`vignesh-kasarapu/Kanban`, `vignesh-kasarapu/lms-2.0`) are kept on GitHub as history only. All work now happens here.

---

## 3. Run on your laptop

There are two ways. **Docker** runs the complete suite with one command and needs nothing but Docker Desktop: use it to try, demo or test the suite. The **developer setup** runs the code directly, so a change is live after a quick restart: use it to work on the code.

### Option A: everything in Docker (one command)

Only **Docker Desktop** is needed (running). From the `TT-suite` folder:

```powershell
docker compose up --build
```

The first build takes several minutes (it builds all five web apps and installs every backend); later starts take seconds. When the log shows the processes listening, open **http://localhost:8000** and pick a person on the sign-in page.

- **What runs:** two containers, `db` (PostgreSQL 17) and `app` (portal, Kanban, LMS, EMS and Asset Management). The [Dockerfile](Dockerfile) builds the same package Azure runs.
- **Out of the box it is try-out mode:** developer sign-in (pick a person, no Microsoft account) and the stub mailer (emails are recorded, never sent). The people in [deploy/seed.json](deploy/seed.json) are there on the first start.
- **Data is kept** between restarts in Docker volumes (database and uploaded files).
- **Stop:** Ctrl+C, or `docker compose down` from another terminal. `docker compose down -v` also deletes the data and starts fresh next time.
- **After `git pull`:** `docker compose up --build` again, so the image includes the new code.
- **Port 8000 already used** (e.g. by `npm run suite:run`)? Use another: `$env:SUITE_HTTP_PORT=8090; docker compose up --build`, then open http://localhost:8090.

#### Production mode: Sign in with Microsoft

All settings live in **`.env.docker`** in the `TT-suite` folder. It is git-ignored, so secrets never reach the repository. Without it, the defaults in [deploy/docker.defaults.env](deploy/docker.defaults.env) give try-out mode.

1. Copy the template: `copy deploy\docker.env.example .env.docker`
2. Set **`DEV_MODE=false`** and fill in the rest. Every line is explained in the [template](deploy/docker.env.example):
   - your address (`PUBLIC_BASE_URL`)
   - the Entra app registration
   - the first global admin
   - three random secrets
   - the mailbox for invitations
   - strong database passwords
3. In Entra (App registrations → the app → Authentication → Web), add the redirect URI `<PUBLIC_BASE_URL>/api/auth/oidc/callback`.
4. Start: `docker compose up -d --build`

What changes with `DEV_MODE=false`:

| | Try-out (`DEV_MODE=true`) | Production (`DEV_MODE=false`) |
|---|---|---|
| Sign-in | pick a person | **Sign in with Microsoft** (Entra); the developer sign-in no longer exists |
| Email | recorded only | sent (Microsoft Graph or SMTP) |
| People | demo people from `seed.json` | only `SEED_GLOBAL_ADMIN_EMAIL`, then whoever the global admin invites |
| Cookie and checks | dev | `Secure` sign-in cookie; API docs hidden; every app in its production profile |

**Production refuses to start half-configured.** If a setting is missing, empty or still a demo value, the container stops and lists exactly which ones (`docker compose logs app`), for example `ENTRA_CLIENT_ID is not set` or `DB_APP_PASSWORD is empty or the demo value`. Fix `.env.docker` and start again.

**HTTPS.** The sign-in cookie needs HTTPS (only `http://localhost` is allowed without it). The app container listens only on this machine (`127.0.0.1:8000`), so there are two ways to serve it:
- **Built-in:** set `SUITE_DOMAIN` (a name pointing at this server) and start with `docker compose --profile https up -d --build`. Caddy fetches and renews the certificate itself; ports 80 and 443 must be open.
- **Your own proxy:** use nginx or IIS, as in section 4, Step 8, forwarding to `127.0.0.1:8000`.

**Your own PostgreSQL** (e.g. Azure): set `DATABASE_URL` and `DATABASE_OWNER_URL` in `.env.docker`, then start only the suite with `docker compose up -d --build --no-deps app`.

The database passwords are applied **once**, when the `db` volume is first created. Choose them before the first production start.

### Option B: developer setup

Do steps 1–5 once. After that, step 6 is all you need each day.

**Step 1: Start the database.** This starts PostgreSQL in Docker on port **5433**, with databases `ttsuite` and `ttsuite_test` and the roles `app_owner` (migrations) and `app_rw` (runtime).

```powershell
npm run suite:db
```

**Step 2: Create your settings file.** Copy the template to `TT-suite/.env`. It uses the developer sign-in (no Microsoft account needed) and the stub mailer (emails are recorded, never sent).

```powershell
copy deploy\.env.example .env
```

`deploy/run.py` loads this one file for all five processes. Never commit it.

**Step 3: Build the web pages.** This installs each frontend's packages the first time, builds all five, and creates `dist-suite/` with one merged `requirements.txt`.

```powershell
npm run suite:package
```

**Step 4: Create one Python environment for all five backends.**

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r dist-suite/requirements.txt
```

**Step 5: Choose who exists on a fresh database.** `SEED_FILE=deploy/seed.json` in `.env` adds the people in [deploy/seed.json](deploy/seed.json), with their role in each app, when the portal starts.
- It only fills in what's missing: no invite emails are sent, and roles changed later are never overwritten.
- Edit the file to change who a new laptop starts with. It is never deployed.

**Step 6: Run everything.** With the virtual environment active:

```powershell
npm run suite:run
```

Open **http://localhost:8000** and pick a person on the sign-in page.
- Each process creates or updates its own database schema when it starts.
- `http://localhost:8000/api/health` should show all five services as `ok`.
- Stop with **Ctrl+C**.

---

## 4. Deploy on an organisation server

These steps are for a **Linux server** (Ubuntu 22.04/24.04) inside the organisation network. Windows Server notes are at the end of this section.

The server runs exactly what Azure runs: the `dist-suite` folder, started with `python deploy/run.py`, behind an HTTPS reverse proxy.

### Ports: what to configure

Only one port needs setting up. The other four are internal and fixed.

| Port | What | Configure? |
|---|---|---|
| **8000** | Portal, the only entry point for users | Yes, set by `PORT` (Step 4). nginx forwards to it (Step 8). |
| 8002 | Kanban | No. Fixed in `deploy/run.py` and listens on `127.0.0.1` only. |
| 8003 | LMS | No, same as Kanban. |
| 8004 | EMS | No, same as Kanban. |
| 8005 | AMS (Asset Management) | No, same as Kanban. |

Users never reach 8002–8005: the portal forwards `/kanban/*`, `/lms/*`, `/expense/*` and `/ams/*` to them inside the machine.

```
 browser ──443 (HTTPS)──> nginx ──> 127.0.0.1:8000 portal ──> 127.0.0.1:8002 kanban
                                                           ──> 127.0.0.1:8003 lms
                                                           ──> 127.0.0.1:8004 expense
                                                           ──> 127.0.0.1:8005 ams
```

**Firewall:** open only **80** and **443**, and close **8000** (Step 8). The portal listens on all network interfaces (`0.0.0.0:8000`); without that rule, people could bypass nginx and HTTPS. 8002–8004 can't be reached from outside anyway.

**Database:** if PostgreSQL runs on a different server, allow **5432** on that server from the suite server's IP only.

**Check the ports are free before installing:**

```bash
sudo ss -ltnp | grep -E ':800[0-4]'      # Linux: no output means free
```

```powershell
netstat -ano | findstr ":800"           # Windows Server
```

- **8000 taken:** pick another port, e.g. `PORT=8080` in the settings file, and change nginx to `proxy_pass http://127.0.0.1:8080`. Nothing else changes.
- **8002–8005 taken:** these are fixed in `deploy/run.py` (`APP_PORTS`), so the suite won't start. Free them, or change `APP_PORTS` in `run.py` together with `KANBAN_URL`, `LMS_URL` and `EXPENSE_URL` in the settings file.

### Step 1: Prepare the server (once)

```bash
sudo apt update
sudo apt install -y python3.13 python3.13-venv postgresql nginx
sudo useradd --system --home /opt/ttsuite --shell /usr/sbin/nologin ttsuite
sudo mkdir -p /opt/ttsuite/app /var/lib/ttsuite/lms /var/lib/ttsuite/expense/uploads /etc/ttsuite
sudo chown -R ttsuite:ttsuite /opt/ttsuite /var/lib/ttsuite
```

If `python3.13` is not in your Ubuntu version's packages, install it from the `deadsnakes` PPA. Node.js is **not** needed on the server.

You also need:
- a DNS name for the suite, e.g. `suite.tektalis.local`
- a TLS certificate for that name (from the organisation's CA or Let's Encrypt)

The sign-in cookie only works over HTTPS.

### Step 2: Create the database (once)

You can skip installing PostgreSQL if the organisation already has a server. Run this as the PostgreSQL superuser (`sudo -u postgres psql`), with your own strong passwords:

```sql
CREATE ROLE ttsuite_owner LOGIN PASSWORD 'change-me-owner';
CREATE ROLE ttsuite_app   LOGIN PASSWORD 'change-me-app';
CREATE DATABASE ttsuite OWNER ttsuite_owner;
\c ttsuite
ALTER SCHEMA public OWNER TO ttsuite_owner;
GRANT CONNECT ON DATABASE ttsuite TO ttsuite_app;
```

- `ttsuite_owner` creates the schemas and runs migrations.
- `ttsuite_app` is what the apps use at runtime. The owner grants it access on every start.

### Step 3: Register the sign-in address in Microsoft Entra (once)

Entra admin center → App registrations → **the Kanban app** → Authentication → *Web* → add this redirect URI:

```
https://suite.tektalis.local/api/auth/oidc/callback
```

The app registration needs these permissions (Kanban's registration already has them):
- delegated `openid profile email User.Read`
- application `User.Read.All`
- application `Mail.Send`

### Step 4: Write the settings file (once)

Generate the two secrets on the server:

```bash
openssl rand -base64 32   # use for APP_SECRET
openssl rand -base64 32   # use for INTERNAL_TOKEN
```

Create `/etc/ttsuite/ttsuite.env`, owned by root and readable by `ttsuite` only (`chmod 640`):

```ini
APP_PROFILE=prod
PORT=8000
PUBLIC_BASE_URL=https://suite.tektalis.local
DATABASE_URL=postgresql://ttsuite_app:change-me-app@localhost:5432/ttsuite
DATABASE_OWNER_URL=postgresql://ttsuite_owner:change-me-owner@localhost:5432/ttsuite

AUTH_PROVIDER=entra
ENTRA_TENANT_ID=<tenant id>
ENTRA_CLIENT_ID=<client id>
ENTRA_CLIENT_SECRET=<client secret>
ENTRA_REDIRECT_URI=https://suite.tektalis.local/api/auth/oidc/callback
APP_SECRET=<first openssl value>
INTERNAL_TOKEN=<second openssl value>
SEED_GLOBAL_ADMIN_EMAIL=vignesh.k@tektalis.com

# graph (Microsoft 365 mailbox) or smtp
MAIL_PROVIDER=graph
MAIL_SENDER=<mailbox the invites come from>
MAIL_FROM_NAME=Tektalis Suite

ORG_TZ=Asia/Kolkata
DEFAULT_TIMEZONE=Asia/Kolkata

# Files that must survive a redeploy (LMS documents, EMS receipts)
STORAGE_DIR=/var/lib/ttsuite/lms
UPLOAD_DIR=/var/lib/ttsuite/expense/uploads
```

- `APP_PROFILE=prod` refuses to start if anything is unsafe: the developer sign-in, the stub mailer, or a missing `APP_SECRET` or `INTERNAL_TOKEN`. The log names the setting that is wrong.
- For SMTP instead of Graph, set `MAIL_PROVIDER=smtp` with `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` and `SMTP_FROM_ADDRESS`.
- The full list of settings is in [deploy/README.md §4](deploy/README.md#4-app-settings-once-change-any-time).
- Do **not** set `SEED_FILE` on a server.

### Step 5: Build the package (on a developer laptop)

After [getting the code](#2-get-the-code) and pulling the latest changes:

```powershell
npm run suite:package
```

Then copy the `dist-suite` folder to the server, e.g. with `scp -r dist-suite user@server:/tmp/`.

### Step 6: Install the package on the server

```bash
sudo rsync -a --delete /tmp/dist-suite/ /opt/ttsuite/app/
sudo -u ttsuite python3.13 -m venv /opt/ttsuite/venv
cd /opt/ttsuite/app && sudo -u ttsuite /opt/ttsuite/venv/bin/pip install -r requirements.txt
```

### Step 7: Run it as a service (once)

Create `/etc/systemd/system/ttsuite.service`:

```ini
[Unit]
Description=TT Suite (portal, Kanban, LMS, EMS)
After=network-online.target postgresql.service

[Service]
User=ttsuite
WorkingDirectory=/opt/ttsuite/app
EnvironmentFile=/etc/ttsuite/ttsuite.env
ExecStart=/opt/ttsuite/venv/bin/python deploy/run.py
Restart=always
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ttsuite
sudo journalctl -u ttsuite -f      # every log line starts with [portal], [kanban], [lms] or [expense]
```

`run.py` restarts any process that stops, and stops all five when systemd stops the service.

### Step 8: Put HTTPS in front (once)

Create `/etc/nginx/sites-available/ttsuite`:

```nginx
server {
    listen 80;
    server_name suite.tektalis.local;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name suite.tektalis.local;
    ssl_certificate     /etc/ssl/certs/suite.crt;
    ssl_certificate_key /etc/ssl/private/suite.key;
    client_max_body_size 25m;   # receipts and documents

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ttsuite /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow 80,443/tcp && sudo ufw deny 8000/tcp   # only nginx reaches the portal
```

### Step 9: Check

1. `https://suite.tektalis.local/api/health` shows `"status":"ok"` and all five services `"ok"`.
2. Sign in with Microsoft as the `SEED_GLOBAL_ADMIN_EMAIL` person. You see four cards (LMS, EMS, Kanban, Asset Management), each marked **Admin**.
3. Users & access → **Invite user** or **Import CSV**. Each invited person receives one email.

### Every release

1. On a laptop: `git pull`, run the tests, then run `npm run suite:package`.
2. Copy `dist-suite` to the server and repeat **Step 6**.
3. Restart: `sudo systemctl restart ttsuite`.

Uploaded files are kept, because they live in `/var/lib/ttsuite`, not in the app folder.

**Backups:** schedule a nightly `pg_dump -Fc` of the `ttsuite` database and a copy of `/var/lib/ttsuite`.

### Moving existing Kanban data

If the server should take over an existing Kanban database:
1. Restore that database as `ttsuite` instead of creating an empty one in Step 2.
2. Start the suite. Kanban moves its tables from `public` into the `kanban` schema on its first start, in one transaction.
3. Then run `deploy/sql/kanban-backfill.sql` with the owner connection.

See [deploy/README.md §7](deploy/README.md#7-kanban-cutover-once-right-after-the-first-suite-deploy).

### With Docker instead (shorter)

If the server has Docker, Steps 1, 2, 6, 7 and 8 above are replaced by the production mode of section 3, Option A:
1. Clone the repository on the server.
2. Create `.env.docker` with `DEV_MODE=false`, your settings and `SUITE_DOMAIN`.
3. Run `docker compose --profile https up -d --build`.

You still need Step 3 (the Entra redirect URI) and a DNS name pointing at the server. Releases are `git pull` followed by the same command. Back up the `tt-suite-docker_db-data` and `tt-suite-docker_app-data` volumes.

### Windows Server instead of Linux

The same package works on Windows Server:
- Install Python 3.13 and PostgreSQL for Windows.
- Use `py -3.13 -m venv` and `C:\ttsuite\venv\Scripts\python.exe deploy\run.py`.
- Run it as a service with **NSSM**, putting the settings in the service's environment.
- Use **IIS** with URL Rewrite and ARR (or nginx for Windows) as the HTTPS reverse proxy to `http://127.0.0.1:8000`.
- Set `STORAGE_DIR` and `UPLOAD_DIR` to a folder outside the app folder, e.g. `D:\ttsuite-data\...`.

---

## 5. Deploy to Azure

The suite runs on **the App Service Kanban already uses** (Linux, Python 3.13, B1 plan) and **Kanban's existing PostgreSQL Flexible Server database**. No new paid resources are needed.

The full guide is [deploy/README.md](deploy/README.md). In short:

**Once:**
1. **Back up** the database and keep the current Kanban `dist-azure` folder for rollback (deploy/README §0).
2. **Web app → Configuration:** set the startup command to `python deploy/run.py`, turn **Always On** on, set the health check path to `/api/health`, and keep **1 instance** (§1).
3. **Database:** nothing to create. The existing owner and runtime roles are reused, and the schemas are created on first start (§2).
4. **Entra:** add `https://<web-app-name>.azurewebsites.net/api/auth/oidc/callback` as a redirect URI (§3).
5. **App settings:** set `APP_PROFILE=prod` and change `ENTRA_REDIRECT_URI`. Add `INTERNAL_TOKEN` and `SEED_GLOBAL_ADMIN_EMAIL`. Delete `SEED_ADMIN_EMAIL` and `AUTH_DEV_MODE` (§4).

**Every release:**
1. `git pull` and run the tests.
2. Run `npm run suite:package`.
3. VS Code → Azure → App Service → right-click the web app → **Deploy to Web App…** → choose the **`dist-suite`** folder.
4. Watch the *Log stream* until all five processes report that they are listening, then open `/api/health`.

**Once, after the first deploy:** run `deploy/sql/kanban-backfill.sql` so existing Kanban users keep their access (§7).

On Azure, `run.py` stores LMS and EMS files under `/home/data`, which App Service keeps across deploys.

**Ports on Azure:** nothing to open. Keep the App Settings `PORT=8000` and `WEBSITES_PORT=8000`. Azure takes HTTPS on 443 and forwards it to port 8000 inside the app. Ports 8002–8004 stay internal, as on any server.

---

## 6. Day-to-day development

| You changed | Do this |
|---|---|
| Python code or a migration | Stop `npm run suite:run` (Ctrl+C) and start it again. Migrations apply on start. |
| A web page (any of the five frontends) | `npm run suite:package`, then refresh the browser. |
| Both | `npm run suite:package`, then restart `npm run suite:run`. |
| Restarted the laptop or Docker | `npm run suite:db` first. |
| Pulled new changes | `npm run suite:package` and `pip install -r dist-suite/requirements.txt`, then restart. |

For portal UI work with live reload, run `cd portal/frontend; npm install; npm run dev` while `suite:run` keeps the backend going.

**Tests** run against the local database (`npm run suite:db` first):

```powershell
npm run test:core      # suite_core
npm run test:portal    # portal backend
```

Each app's tests run from its own backend folder. See the verification table in [CHANGES.md](CHANGES.md#verification-all-run-locally-against-the-one-postgres-database).

---

## 7. Continuous integration

GitHub Actions runs on every push to `main`/`master`, on every pull request, and on demand (*Actions → ci → Run workflow*). The pipeline is split by job:

| File | What it does |
|---|---|
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Entry point: triggers, and calls the three workflows below |
| [.github/workflows/backend-tests.yml](.github/workflows/backend-tests.yml) | One job per backend (suite_core, portal, Kanban, LMS, EMS) running its tests against a PostgreSQL 17 service on port 5433 |
| [.github/workflows/build-package.yml](.github/workflows/build-package.yml) | Builds the five frontends and `dist-suite/`, kept as the artifact `dist-suite-<commit>` for 14 days |
| [.github/workflows/e2e-tests.yml](.github/workflows/e2e-tests.yml) | Starts that package for real and runs the browser tests in `e2e/` against it; on failure keeps the report and the suite's log |
| [.github/actions/setup-db](.github/actions/setup-db/action.yml) | Creates the roles (same file as local Docker, `deploy/db-init/01-roles.sql`) and the test databases |
| [.github/actions/setup-backend](.github/actions/setup-backend/action.yml) | Python 3.13, one backend's requirements and `suite_core` |

**No setup needed:** the repository holds every part, so CI only checks out this repository. There are no secrets or variables to configure.

The old `Kanban-internal-main/.github/workflows/` files are from when Kanban was its own repository. GitHub only runs workflows from the top-level `.github/`, so they no longer run.

### Run the whole pipeline on your machine

```powershell
npm run ci:local
```

It runs the same stages as GitHub and prints a summary (also saved in `.ci-local/summary.md`, with each stage's log next to it):

| Stage | What |
|---|---|
| database | starts the local PostgreSQL (Docker) |
| backends | the five backends' tests, each with its own Python environment |
| build | the five frontends and `dist-suite/` |
| e2e | the full suite started on its own database, tested in a browser |

- **Stop `npm run suite:run` first:** the e2e stage needs ports 8000–8005.
- The e2e run never touches your data or mailbox. It recreates a separate database (`ttsuite_e2e`), uses the stub mailer and dev sign-in, and ignores your `.env`.
- Skip stages with `--skip-db`, `--skip-backends`, `--skip-build` or `--skip-e2e`, e.g. `npm run ci:local -- --skip-build`.
- Run only the browser tests with `npm run test:e2e` (add `-- --grep invite` to pick tests, or `-- --headed` to watch). Open the last report with `npm run e2e:report`.

**The browser tests** (`e2e/tests/`, Playwright, one flow per file):

| File | Checks |
|---|---|
| `sign-in.spec.ts` | An anonymous visit to an app goes to the suite sign-in and back; people never invited are refused |
| `dashboard.spec.ts` | The global admin sees four cards as Admin, and each card opens its app (desktop and phone) |
| `asset-manager.spec.ts` | A role given in the portal is the person's role in AMS; removing it sends them back to the dashboard |
| `invite.spec.ts` | Inviting in the UI gives the right role in each app, one invitation email and an audit entry |
| `csv-import.spec.ts` | Problem rows are flagged; the rest are invited once each with their roles |
| `access.spec.ts` | Removing access denies that app only; deactivating signs the person out of every app |
| `theme.spec.ts` | One theme choice shows in LMS, EMS and Kanban (AMS keeps its own look) |

**To deploy a CI build** instead of building on your laptop: open the run, download `dist-suite-<commit>`, unzip it, and deploy that folder as in section 4 or 5.

## 8. Repository layout and rules

| Path | What |
|---|---|
| [packages/suite_core/](packages/suite_core/) | Shared Python library: global `app` schema and migrator, session cookie, identity, access mirror, Entra/Graph/SMTP clients |
| [portal/backend/](portal/backend/) | Portal API and gateway (FastAPI, async SQLAlchemy, psycopg 3) |
| [portal/frontend/](portal/frontend/) | Portal web app (React 19, Vite, TypeScript): sign-in, dashboard, profile, users & access, CSV import, audit log |
| [.github/](.github/) | CI pipeline (section 7) |
| [e2e/](e2e/) | Browser tests of the whole suite and their runner (section 7) |
| [deploy/](deploy/) | Launcher (`run.py`), package builder (`build.mjs`), local database (`docker-compose.yml`), seed people (`seed.json`), Kanban cutover SQL, Azure guide |
| [docs/SUITE-CONTRACT.md](docs/SUITE-CONTRACT.md) | The fixed interface between the portal and the apps |
| [CHANGES.md](CHANGES.md) | Change log, verification results and open items |

**Where the tables are.** The one database has one schema (a named folder of tables) per app:

| Schema | Tables of |
|---|---|
| `app` | the suite itself: people, access per app, sessions, preferences, audit log, mail queue |
| `kanban` | Kanban |
| `lms` | LMS (Leave) |
| `expense` | EMS (Expense) |
| `ams` | AMS (Asset Management) |

A table's full name is `schema.table`, e.g. `app.users`, `lms.users`, `kanban.card`. Each app's connection sets `search_path` to its own schema, so its SQL uses short names; the global tables are always written in full (`app.users`). Older databases are upgraded on start: `suite` is renamed `app`, and Kanban's tables move from `public` to `kanban`.

**Accounts, roles and sessions:**
- **Only a global admin creates accounts and assigns roles**, in the portal (Users & access, Import CSV). The apps' own user screens can no longer invite people, change roles, deactivate people or change emails. App admins still edit their app's own details about a person (e.g. LMS department or manager, EMS employee code, Kanban team membership).
- **App admins request role changes.** In their app's user management, "Request role change" sends the person, the role and a note to the global admins' **Inbox**. Approving applies it in the app at once; declining tells the requester. "Request access" on a locked dashboard card works the same way.
- **One inbox** on the dashboard holds the suite's messages: requests, decisions, invitations, access changes, and "signed out everywhere".
- **Profile and theme** are edited only on the dashboard's Profile page. Every app takes the name and theme from there.
- **Sessions:** you stay signed in while you use any app. After **24 hours without activity** you sign in again, and every **30 days** at the latest. You can be signed in on several devices. **Sign out** (in any app) asks: *this device* or *all devices*.
- **Every app uses the same bar sizes:** top bar 64px, sidebar 256px.

**Rules that keep the suite consistent:**
- **Sign-in happens only in the portal.** Apps read the shared session cookie (`__Host-tt_session`, or `tt_session` outside production) through `suite_core.identity`.
- **One person, one record.** A person exists once in `app.users`. Each app keeps its own profile row for them, linked by `suite_user_id`.
- **Only the owning app writes `app.app_access`**, in the same transaction as its own user or role change. The portal changes access by calling the app's localhost-only `POST /internal/provision`, protected by `INTERNAL_TOKEN`.
- **Run one instance only.** The schedulers run inside the processes and would run twice on two instances.
- **Never commit `.env`** or database backups; `.gitignore` already excludes them.
