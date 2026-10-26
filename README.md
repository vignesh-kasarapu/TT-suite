# TT Suite

One Microsoft sign-in, one dashboard and one global admin for the three Tektalis apps: **Kanban**, **LMS** (Leave) and **EMS** (Expense). Everything runs as four processes on one server and uses one PostgreSQL database.

```
 one server (or one Azure App Service)     one PostgreSQL database
 python deploy/run.py                      schema kanban  -> Kanban
   portal  :8000  public  /, /api           schema app     -> people, access, sessions (global)
   kanban  :8002  /kanban                   schema lms     -> Leave
   lms     :8003  /lms                      schema expense -> Expense
   expense :8004  /expense
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
| Docker Desktop | any recent | the local database on your laptop |
| PostgreSQL | 16 or 17 | the database on a server (Docker is fine locally) |

On Windows, run the commands below in **PowerShell** from the `TT-suite` folder unless a step says otherwise.

---

## 2. Get the code

The suite is **four git repositories**. The suite repository holds the portal and the deploy scripts. The three apps are cloned **inside** it, into fixed folder names; those folders are git-ignored by the suite repository.

```powershell
git clone https://github.com/vignesh-kasarapu/TT-suite.git
cd TT-suite

git clone https://github.com/vignesh-kasarapu/Kanban.git Kanban-internal-main
git clone -b srikaran-py-port https://github.com/vignesh-kasarapu/lms-2.0.git lms-2.0-main/lms-2.0-main
git clone <EMS repository URL> ems
```

The folder names must match exactly; the build and the launcher look for them:

```
TT-suite/
  Kanban-internal-main/          Kanban
  lms-2.0-main/lms-2.0-main/     LMS
  ems/                           EMS
  portal/  packages/  deploy/  docs/
```

**To get the latest changes later**, pull all four:

```powershell
git pull
git -C Kanban-internal-main pull
git -C lms-2.0-main/lms-2.0-main pull
git -C ems pull
```

---

## 3. Run on your laptop

Do steps 1–5 once. After that, step 6 is all you need each day.

**Step 1: Start the database.** This starts PostgreSQL in Docker on port **5433**, with databases `ttsuite` and `ttsuite_test` and the roles `app_owner` (migrations) and `app_rw` (runtime).

```powershell
npm run suite:db
```

**Step 2: Create your settings file.** Copy the template to `TT-suite/.env`. It uses the developer sign-in (no Microsoft account needed) and the stub mailer (emails are recorded, never sent).

```powershell
copy deploy\.env.example .env
```

`deploy/run.py` loads this one file for all four processes. Never commit it.

**Step 3: Build the web pages.** This installs each frontend's packages the first time, builds all four, and creates `dist-suite/` with one merged `requirements.txt`.

```powershell
npm run suite:package
```

**Step 4: Create one Python environment for all four backends.**

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
- `http://localhost:8000/api/health` should show all four services as `ok`.
- Stop with **Ctrl+C**.

---

## 4. Deploy on an organisation server

These steps are for a **Linux server** (Ubuntu 22.04/24.04) inside the organisation network. Windows Server notes are at the end of this section.

The server runs exactly what Azure runs: the `dist-suite` folder, started with `python deploy/run.py`, behind an HTTPS reverse proxy.

### Ports: what to configure

Only one port needs setting up. The other three are internal and fixed.

| Port | What | Configure? |
|---|---|---|
| **8000** | Portal, the only entry point for users | Yes, set by `PORT` (Step 4). nginx forwards to it (Step 8). |
| 8002 | Kanban | No. Fixed in `deploy/run.py` and listens on `127.0.0.1` only. |
| 8003 | LMS | No, same as Kanban. |
| 8004 | EMS | No, same as Kanban. |

Users never reach 8002–8004: the portal forwards `/kanban/*`, `/lms/*` and `/expense/*` to them inside the machine.

```
 browser ──443 (HTTPS)──> nginx ──> 127.0.0.1:8000 portal ──> 127.0.0.1:8002 kanban
                                                           ──> 127.0.0.1:8003 lms
                                                           ──> 127.0.0.1:8004 expense
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
- **8002, 8003 or 8004 taken:** these are fixed in `deploy/run.py` (`APP_PORTS`), so the suite won't start. Free them, or change `APP_PORTS` in `run.py` together with `KANBAN_URL`, `LMS_URL` and `EXPENSE_URL` in the settings file.

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

`run.py` restarts any process that stops, and stops all four when systemd stops the service.

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

1. `https://suite.tektalis.local/api/health` shows `"status":"ok"` and all four services `"ok"`.
2. Sign in with Microsoft as the `SEED_GLOBAL_ADMIN_EMAIL` person. You see three cards (LMS, EMS, Kanban), each marked **Admin**.
3. Users & access → **Invite user** or **Import CSV**. Each invited person receives one email.

### Every release

1. On a laptop: pull all four repositories, run the tests, then run `npm run suite:package`.
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
1. Pull all four repositories and run the tests.
2. Run `npm run suite:package`.
3. VS Code → Azure → App Service → right-click the web app → **Deploy to Web App…** → choose the **`dist-suite`** folder.
4. Watch the *Log stream* until all four processes report that they are listening, then open `/api/health`.

**Once, after the first deploy:** run `deploy/sql/kanban-backfill.sql` so existing Kanban users keep their access (§7).

On Azure, `run.py` stores LMS and EMS files under `/home/data`, which App Service keeps across deploys.

**Ports on Azure:** nothing to open. Keep the App Settings `PORT=8000` and `WEBSITES_PORT=8000`. Azure takes HTTPS on 443 and forwards it to port 8000 inside the app. Ports 8002–8004 stay internal, as on any server.

---

## 6. Day-to-day development

| You changed | Do this |
|---|---|
| Python code or a migration | Stop `npm run suite:run` (Ctrl+C) and start it again. Migrations apply on start. |
| A web page (any of the four frontends) | `npm run suite:package`, then refresh the browser. |
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
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Entry point: triggers, and calls the two workflows below |
| [.github/workflows/backend-tests.yml](.github/workflows/backend-tests.yml) | One job per backend (suite_core, portal, Kanban, LMS, EMS) running its tests against a PostgreSQL 17 service on port 5433 |
| [.github/workflows/build-package.yml](.github/workflows/build-package.yml) | Builds the four frontends and `dist-suite/`, kept as the artifact `dist-suite-<commit>` for 14 days |
| [.github/workflows/e2e-tests.yml](.github/workflows/e2e-tests.yml) | Starts that package for real and runs the browser tests in `e2e/` against it; on failure keeps the report and the suite's log |
| [.github/actions/checkout-apps](.github/actions/checkout-apps/action.yml) | Clones Kanban, LMS and EMS into their folders |
| [.github/actions/setup-db](.github/actions/setup-db/action.yml) | Creates the roles (same file as local Docker, `deploy/db-init/01-roles.sql`) and the test databases |
| [.github/actions/setup-backend](.github/actions/setup-backend/action.yml) | Python 3.13, one backend's requirements and `suite_core` |

**One-time setup** in the `TT-suite` GitHub repository, under *Settings → Secrets and variables → Actions*:

| Kind | Name | Value |
|---|---|---|
| Variable | `EMS_REPO` | **Required.** `owner/name` of the EMS repository |
| Secret | `APPS_REPO_TOKEN` | Needed if the app repositories are private: a fine-grained personal access token with *Contents: read* on the Kanban, LMS and EMS repositories |
| Variable (optional) | `KANBAN_REPO`, `KANBAN_REF` | Default `vignesh-kasarapu/Kanban`, `main` |
| Variable (optional) | `LMS_REPO`, `LMS_REF` | Default `vignesh-kasarapu/lms-2.0`, `srikaran-py-port` |
| Variable (optional) | `EMS_REF` | Default: the EMS repository's default branch |

CI tests the app repositories' **pushed** code on those branches, so push app changes before (or together with) the suite change that needs them.

### Run the whole pipeline on your machine

```powershell
npm run ci:local
```

It runs the same stages as GitHub and prints a summary (also saved in `.ci-local/summary.md`, with each stage's log next to it):

| Stage | What |
|---|---|
| database | starts the local PostgreSQL (Docker) |
| backends | the five backends' tests, each with its own Python environment |
| build | the four frontends and `dist-suite/` |
| e2e | the full suite started on its own database, tested in a browser |

- **Stop `npm run suite:run` first:** the e2e stage needs ports 8000–8004.
- The e2e run never touches your data or mailbox. It recreates a separate database (`ttsuite_e2e`), uses the stub mailer and dev sign-in, and ignores your `.env`.
- Skip stages with `--skip-db`, `--skip-backends`, `--skip-build` or `--skip-e2e`, e.g. `npm run ci:local -- --skip-build`.
- Run only the browser tests with `npm run test:e2e` (add `-- --grep invite` to pick tests, or `-- --headed` to watch). Open the last report with `npm run e2e:report`.

**The browser tests** (`e2e/tests/`, Playwright, one flow per file):

| File | Checks |
|---|---|
| `sign-in.spec.ts` | An anonymous visit to an app goes to the suite sign-in and back; people never invited are refused |
| `dashboard.spec.ts` | The global admin sees three cards as Admin, and each card opens its app (desktop and phone) |
| `invite.spec.ts` | Inviting in the UI gives the right role in each app, one invitation email and an audit entry |
| `csv-import.spec.ts` | Problem rows are flagged; the rest are invited once each with their roles |
| `access.spec.ts` | Removing access denies that app only; deactivating signs the person out of every app |
| `theme.spec.ts` | One theme choice shows in LMS, EMS and Kanban |

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

A table's full name is `schema.table`, e.g. `app.users`, `lms.users`, `kanban.card`. Each app's connection sets `search_path` to its own schema, so its SQL uses short names; the global tables are always written in full (`app.users`). Older databases are upgraded on start: `suite` is renamed `app`, and Kanban's tables move from `public` to `kanban`.

**Rules that keep the suite consistent:**
- **Sign-in happens only in the portal.** Apps read the shared session cookie (`__Host-tt_session`, or `tt_session` outside production) through `suite_core.identity`.
- **One person, one record.** A person exists once in `app.users`. Each app keeps its own profile row for them, linked by `suite_user_id`.
- **Only the owning app writes `app.app_access`**, in the same transaction as its own user or role change. The portal changes access by calling the app's localhost-only `POST /internal/provision`, protected by `INTERNAL_TOKEN`.
- **Run one instance only.** The schedulers run inside the processes and would run twice on two instances.
- **Never commit `.env`** or database backups; `.gitignore` already excludes them.
