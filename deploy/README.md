# Deploy the whole TT Suite to one Azure App Service

This guide puts the complete Tektalis Suite on Azure, step by step.

The suite has six parts:
- **Portal:** sign-in, dashboard, global admin
- **Kanban**
- **LMS** (Leave)
- **EMS** (Expense)
- **AMS** (Assets)
- **Resume Evaluator**

They all run in **one web app**: `deploy/run.py` starts the six processes, and the portal is the only one users reach. They all use **one PostgreSQL database**.

```
 one App Service web app                    one Azure Database for PostgreSQL
 python deploy/run.py                       schema app     -> people, access, sessions, employee codes
   portal  :8000  public  /, /api            schema kanban  -> Kanban
   kanban  :8002  /kanban                    schema lms     -> Leave
   lms     :8003  /lms                       schema expense -> Expense
   expense :8004  /expense                   schema ams     -> Assets
   ams     :8005  /ams                       schema resume  -> Resume Evaluator
   resume  :8006  /resume
 attachments -> SharePoint (optional)       Microsoft sign-in + mail -> one Entra app registration
```

**Contents**
1. [Choose how to deploy](#1-choose-how-to-deploy)
2. [What you need](#2-what-you-need)
3. [Create the Azure resources](#3-create-the-azure-resources)
4. [The database: do I need to run SQL scripts?](#4-the-database-do-i-need-to-run-sql-scripts)
5. [Microsoft Entra (sign-in, mail, SharePoint)](#5-microsoft-entra-sign-in-mail-sharepoint)
6. [Build and push the image](#6-build-and-push-the-image)
7. [Configure the web app](#7-configure-the-web-app)
8. [All settings (reference)](#8-all-settings-reference)
9. [First start and checks](#9-first-start-and-checks)
10. [Every new release](#10-every-new-release)
11. [Rollback](#11-rollback)
12. [Troubleshooting](#12-troubleshooting)
13. [Alternative: code deploy (no container)](#13-alternative-code-deploy-no-container)
14. [Moving an existing Kanban database into the suite](#14-moving-an-existing-kanban-database-into-the-suite)

---

## 1. Choose how to deploy

| | **A. Container (recommended)** | **B. Code deploy** (section 13) |
|---|---|---|
| What is deployed | The suite's Docker image (`Dockerfile`), from Azure Container Registry | The `dist-suite/` folder; Azure installs the Python packages |
| Resume Evaluator | Fully works: OCR (Tesseract), CPU-only torch and the AI models are built into the image | Runs without OCR for scanned resumes. The AI libraries make the install slow and large. |
| Same as local Docker | Yes, exactly the image you run with `docker compose` | No |
| Extra Azure resource | One Container Registry (Basic, about $5 a month) | None |

Both ways are described in full: **A** in sections 3–12, **B** in section 13. Pick **A** if you can, since everything works there, including OCR. If you can't use a container, **B** works too, with the limits listed in section 13.

**Plan size.** Six processes plus the Resume Evaluator's AI models need about **3–4 GB of memory**.

| App Service plan | Use it? |
|---|---|
| **P1v3** (8 GB) | **Recommended** |
| **B3** (7 GB) | The cheapest that works |
| B1 / B2 (1.75 / 3.5 GB) | Too small with the Resume Evaluator. B2 can work without it: set `SUITE_SKIP=resume`. |

Use **one instance** only. Do not scale out: the mail, scheduler and mailbox jobs run inside the processes.

---

## 2. What you need

**Tools on your machine:**
- **Azure CLI** (`az`), signed in with `az login`, with rights to create resources in the subscription.
- **Docker Desktop.** You only need it to build the image locally; `az acr build` (step 6) builds in Azure instead.
- **`psql`** for the one-time database script. You don't need to install it: Docker can run it (step 4).

**In Microsoft 365 / Entra (section 5):**
- An **Entra admin** who can register an app and grant admin consent.
- A **mailbox** that invitations come from, for example `noreply@tektalis.com`.
- **Optional:** a **SharePoint site** for attachments.

**Decisions to make first:**
- the region (for example `centralindia`)
- the web app name: this gives `https://<web-app-name>.azurewebsites.net`, or use your own domain later
- the email of the **first global admin**

**Three random secrets.** Make each one new and keep them in a password manager:
```powershell
# PowerShell: one base64 secret of 32 random bytes (APP_SECRET must be exactly this format)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
```
```bash
# or, with Docker
docker run --rm alpine sh -c "head -c 32 /dev/urandom | base64"
```
Generate three: `APP_SECRET`, `INTERNAL_TOKEN` and `SESSION_JWT_SECRET`. Also choose two strong **database passwords**, for `app_owner` and `app_rw`.

---

## 3. Create the Azure resources

The commands use these placeholders; replace them once: `rg-ttsuite` (resource group), `<server>` (PostgreSQL server name), `<acr>` (registry name, lower-case letters and digits) and `<app>` (web app name). You can do the same in the Azure portal.

```bash
# Resource group
az group create -n rg-ttsuite -l centralindia

# PostgreSQL Flexible Server (16 or 17) + the database "ttsuite"
#   --public-access 0.0.0.0 allows connections from Azure services (the web app). Add your own IP
#   later only while you run the setup script.
az postgres flexible-server create -g rg-ttsuite -n <server> -l centralindia \
  --version 16 --tier Burstable --sku-name Standard_B2s --storage-size 32 \
  --admin-user ttadmin --admin-password '<admin password>' --public-access 0.0.0.0
az postgres flexible-server db create -g rg-ttsuite -s <server> -d ttsuite

# Container registry
az acr create -g rg-ttsuite -n <acr> --sku Basic

# App Service plan (Linux) + the web app (the image is set in step 7)
az appservice plan create -g rg-ttsuite -n plan-ttsuite --is-linux --sku P1v3
az webapp create -g rg-ttsuite -p plan-ttsuite -n <app> \
  --deployment-container-image-name mcr.microsoft.com/appsvc/staticsite:latest
```

**Database size.** Six processes each keep a pool of up to 5 connections, so about 30 in total. Standard_B2s allows enough. On the smallest Burstable size (B1ms), set `DB_POOL_SIZE=3` in step 8.

---

## 4. The database: do I need to run SQL scripts?

| Your database | What to run |
|---|---|
| **New and empty** (this guide) | **Yes, once:** `deploy/sql/azure-full-schema.sql`. It creates the two roles, the six schemas, every table and grant, and the migration-version rows. |
| **The existing Kanban database** | **No setup script.** Follow section 14 instead (one backfill script after the first start). |
| **Every later release** | **No.** Each app migrates its own schema when it starts (`run.py`). |

**Why the setup script is needed on a new database.** The apps could create their own tables, but nothing else creates the **roles**. `app_owner` runs migrations and owns the tables; `app_rw` is what the apps use day to day. The script creates both and the whole schema in one go. The suite then starts without changing anything.

**Running it.** Temporarily allow your own IP on the server (Azure portal → the server → *Networking* → *Add current client IP*), then run (PowerShell; the line breaks are backticks):

```powershell
docker run --rm -v "${PWD}:/w" postgres:17 psql `
  "host=<server>.postgres.database.azure.com port=5432 dbname=ttsuite user=ttadmin sslmode=require" `
  -v ON_ERROR_STOP=1 -v owner_password='<app_owner password>' -v app_password='<app_rw password>' `
  -f /w/deploy/sql/azure-full-schema.sql
```

Run this from the `TT-suite` folder, and enter the server admin password when asked. At the end it prints six schemas with their table counts: ams 8, app 9, expense 13, kanban 26, lms 40, resume 27. Then remove your IP from the firewall again.

- **Safe to retry:** the script refuses to run a second time on the same database, so a mistaken re-run changes nothing.
- **No data:** reference data (leave types, expense categories, …) and the first global admin are added by the apps on the first start.

**The two connection strings for step 8.** URL-encode any special characters in the passwords:
```
DATABASE_OWNER_URL=postgresql://app_owner:<owner password>@<server>.postgres.database.azure.com:5432/ttsuite?sslmode=require
DATABASE_URL=postgresql://app_rw:<app password>@<server>.postgres.database.azure.com:5432/ttsuite?sslmode=require
```

**Backups.** Azure keeps point-in-time backups (7 days by default; raise it under *Backup and restore*).

---

## 5. Microsoft Entra (sign-in, mail, SharePoint)

**One app registration** does sign-in, sends the invitation mails and, optionally, stores attachments in SharePoint.

Entra admin center → **App registrations** → *New registration*:
- **Name:** `Tektalis Suite`. **Supported account types:** this organisation only.
- **Redirect URI:** type *Web*, `https://<app>.azurewebsites.net/api/auth/oidc/callback`. If you later add your own domain, add `https://<your domain>/api/auth/oidc/callback` too.

**Certificates & secrets** → *New client secret*. Copy its **Value**: that is `ENTRA_CLIENT_SECRET`. From *Overview*, copy the **Directory (tenant) ID** (`ENTRA_TENANT_ID`) and the **Application (client) ID** (`ENTRA_CLIENT_ID`).

**API permissions** → *Add a permission* → **Microsoft Graph**, then **Grant admin consent**:

| Permission | Type | Why |
|---|---|---|
| `openid`, `profile`, `email`, `User.Read` | Delegated | Sign in with Microsoft |
| `User.Read.All` | Application | Name and photo sync; the people search in *Invite user* |
| `Mail.Send` | Application | Invitation and notification emails (`MAIL_PROVIDER=graph`) |
| `Sites.ReadWrite.All` | Application | **Only for SharePoint attachments.** Leave Expense receipts, leave attachments and resumes |

**`Mail.Send` reach.** With this permission the app can send as any mailbox in the tenant. To limit it to the one sender mailbox, ask your Exchange admin for an *application access policy*.

**SharePoint (optional).**
1. Create or choose a site, for example `https://tektalis.sharepoint.com/sites/TTSuite`.
2. Set `SHAREPOINT_SITE=tektalis.sharepoint.com:/sites/TTSuite`.
3. Set `SHAREPOINT_LIBRARY=Documents`. That is the default library, which the browser shows as "Shared Documents".

The folders `Leave/`, `Expense/` and `Resume Evaluator/` with one folder per person (`<EmployeeCode - Name>`) are created on the first upload. Without these two settings, files are kept on the web app's disk (`/home/data`).

---

## 6. Build and push the image

From the `TT-suite` folder. The image contains no secrets: `.dockerignore` keeps every `.env` out.

**Option 1, build in Azure.** You don't need Docker locally:
```bash
az acr build -r <acr> -t tt-suite:1.0.0 .
```

**Option 2, build locally and push:**
```bash
az acr login -n <acr>
docker build -t <acr>.azurecr.io/tt-suite:1.0.0 .
docker push <acr>.azurecr.io/tt-suite:1.0.0
```

**Build time.** The first build takes 20–40 minutes: it builds the six web apps and installs the AI libraries. Later builds reuse the cached layers.

**Versions.** Give every release a new tag (`1.0.1`, `1.1.0`, …), so you can roll back to the previous one.

---

## 7. Configure the web app

**1. Let the web app pull from the registry** (managed identity, no passwords):
```bash
az webapp identity assign -g rg-ttsuite -n <app>
az role assignment create --role AcrPull \
  --assignee $(az webapp identity show -g rg-ttsuite -n <app> --query principalId -o tsv) \
  --scope $(az acr show -n <acr> --query id -o tsv)
az webapp config set -g rg-ttsuite -n <app> --generic-configurations '{"acrUseManagedIdentityCreds": true}'
```

**2. Point it at the image:**
```bash
az webapp config container set -g rg-ttsuite -n <app> \
  --container-image-name <acr>.azurecr.io/tt-suite:1.0.0 \
  --container-registry-url https://<acr>.azurecr.io
```

**3. General settings.** Set these in the portal (web app → *Configuration*) or with the commands:

| Setting | Value | Why |
|---|---|---|
| Always On | **On** | Mail, schedulers and mailbox polling run inside the processes |
| Health check path | `/api/health` | Answers 200 while the database is up; shows every app's state |
| HTTPS only | **On** | The sign-in cookie is Secure |
| Startup command | *(empty)* | The image starts `python deploy/run.py` itself |
| Instances | **1** | See section 1 |
```bash
az webapp config set -g rg-ttsuite -n <app> --always-on true \
  --generic-configurations '{"healthCheckPath": "/api/health"}'
az webapp update -g rg-ttsuite -n <app> --https-only true
```

**4. Logs.** Container output goes to the *Log stream*:
```bash
az webapp log config -g rg-ttsuite -n <app> --docker-container-logging filesystem
```

**5. App settings.** Add every setting from section 8 (web app → *Settings → Environment variables*, or `az webapp config appsettings set -g rg-ttsuite -n <app> --settings NAME=value NAME2=value2 …`). **Save** restarts the app.

---

## 8. All settings (reference)

Set these as **App settings** on the web app. App settings are the only source in Azure: there is no `.env` file there.

**Required.** With `DEV_MODE=false` the suite checks all of these at start, and refuses to start with a list of what is missing.

| Name | Value |
|---|---|
| `DEV_MODE` | `false` (production: Microsoft sign-in, real mail, strict checks) |
| `PUBLIC_BASE_URL` | `https://<app>.azurewebsites.net` (or your domain; **https**, no trailing slash) |
| `DATABASE_URL` | the **app_rw** connection string from step 4 (`…?sslmode=require`) |
| `DATABASE_OWNER_URL` | the **app_owner** connection string from step 4 |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | from step 5 |
| `SEED_GLOBAL_ADMIN_EMAIL` | the first global admin's work email. They get admin in every app on the first start. |
| `APP_SECRET` | random, base64 of 32 bytes (section 2) |
| `INTERNAL_TOKEN` | random (section 2). It protects the portal → app calls. |
| `SESSION_JWT_SECRET` | random (section 2) |
| `MAIL_PROVIDER` | `graph` (uses the app registration) or `smtp` |
| `MAIL_SENDER` | the mailbox invitations come from (`graph`), e.g. `noreply@tektalis.com` |

**Required for the container on App Service.** `/home` survives restarts and new images; the image's own `/data` folder does not.

| Name | Value |
|---|---|
| `WEBSITES_PORT` | `8000` |
| `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `true` (mounts the persistent `/home`) |
| `STORAGE_DIR` | `/home/data/lms` (LMS files) |
| `UPLOAD_DIR` | `/home/data/expense/uploads` (EMS receipts) |
| `RESUME_UPLOAD_DIR` | `/home/data/resume/uploads` (resumes) |

Daily log files go to `/home/data/logs/<app>/` automatically.

**Recommended:**

| Name | Value |
|---|---|
| `ORG_TZ`, `DEFAULT_TIMEZONE`, `TZ` | `Asia/Kolkata` (organisation time zone; the log files' dates) |
| `MAIL_FROM_NAME` | `Tektalis Suite` |
| `SHAREPOINT_SITE`, `SHAREPOINT_LIBRARY` | attachments in SharePoint (step 5); leave both unset to keep files on `/home` |
| `LOG_RETENTION_DAYS` | `30` (how long daily log files are kept) |

**Optional:**

| Name | Value |
|---|---|
| `ENTRA_REDIRECT_URI` | Only if it differs from `PUBLIC_BASE_URL` + `/api/auth/oidc/callback` |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `SMTP_FROM_ADDRESS` | Only with `MAIL_PROVIDER=smtp` |
| `DB_POOL_SIZE` | Connections per process (default 5); `3` on a small database |
| `SUITE_SKIP` | e.g. `resume` to run without the Resume Evaluator |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | Resume Evaluator AI scoring (OpenAI-compatible) |
| `SMTP_SERVER`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` | Resume Evaluator's own candidate emails |
| `IMAP_HOST`, `IMAP_USERNAME`, `IMAP_PASSWORD` | Resume Evaluator's mailbox intake (it can also be configured in its Settings page) |
| `GITHUB_TOKEN` | Resume Evaluator GitHub enrichment (higher rate limit) |
| `PREWARM_EMBEDDING` | `false` loads the Resume Evaluator's embedding model on first use instead of at start, saving memory until it is needed |

**Never set in Azure.** `run.py` sets these per app:
- each app's port
- each app's own `PUBLIC_BASE_URL` (`…/kanban`, `…/lms`, …)
- `SUITE_ENV_ONLY`
- the Resume Evaluator's `SECRET_KEY` and `PAN_ENCRYPTION_KEY`, derived from `APP_SECRET`

**Do not change `APP_SECRET` later.** The Resume Evaluator's stored mailbox passwords and PANs are encrypted with a key derived from it.

---

## 9. First start and checks

**Watch the start-up** in the *Log stream* (portal → web app → *Monitoring → Log stream*, or `az webapp log tail -g rg-ttsuite -n <app>`). You should see:
- `[suite] DEV_MODE=false: production, Sign in with Microsoft at https://…`
- `[suite] app schema migrated []`. The `[]` means nothing was needed: the setup script already did it.
- `[suite] starting portal …`, then `kanban`, `lms`, `expense`, `ams` and `resume`
- each process listening. The Resume Evaluator takes about 20–40 seconds while it loads its models.

**Checks:**
1. **Health:** `https://<app>.azurewebsites.net/api/health` shows `"status":"ok"` and all six services `"ok"`.
2. **First sign-in:** open the site and **Sign in with Microsoft** as `SEED_GLOBAL_ADMIN_EMAIL`. You see every app's card marked **Admin**, including the Resume Evaluator.
3. **Invite:** in **Users & access**, invite one person with their employee code and a role. They get the invitation email.
4. **Open each app:** check the top bar shows your name and employee code.
5. **Attachments:** with SharePoint on, upload an attachment in Leave. It appears in the SharePoint library under `Leave/<code - name>/`.

---

## 10. Every new release

1. Build and push a **new tag** (step 6), e.g. `tt-suite:1.0.1`.
2. Point the web app at it:
   ```bash
   az webapp config container set -g rg-ttsuite -n <app> --container-image-name <acr>.azurecr.io/tt-suite:1.0.1
   ```
3. The app restarts by itself. Each app migrates its own schema on start; **no SQL scripts are needed**.
4. Check `/api/health` and the Log stream as in section 9.

**Back up first** (optional): before a release with database changes (the release notes in `CHANGES.md` say so), take an on-demand backup: PostgreSQL server → *Backup and restore* → *Backup now*.

---

## 11. Rollback

- **Code:** point the web app back at the previous tag (step 10, command 2).
- **Database:**
  - **Usually nothing to do.** The suite's migrations only add things, so the previous image runs on the newer database.
  - **If you must restore:** use PostgreSQL *Backup and restore* → *Restore* to a new server, then update `DATABASE_URL` and `DATABASE_OWNER_URL`.

---

## 12. Troubleshooting

| What you see | Cause and fix |
|---|---|
| Log: `DEV_MODE=false (production) refuses to start:` and a list | The listed settings are missing or still demo values. Add them in section 8, then **Save**. |
| Log: `could not migrate the app schema; check DATABASE_OWNER_URL` | Wrong owner URL or password, or the firewall blocks the web app. Check *Allow public access from Azure services* on the PostgreSQL server, and `?sslmode=require`. |
| Health shows one app as `"ReadTimeout"` or `"ConnectError"` | That app is still starting (the Resume Evaluator takes longest) or crashed. Search the Log stream, or `/home/data/logs/<app>/`, for its lines. `run.py` restarts a crashed app by itself. |
| Sign-in: `AADSTS50011` (redirect URI mismatch) | The redirect URI in Entra must be exactly `PUBLIC_BASE_URL` + `/api/auth/oidc/callback`. |
| Sign-in works, then "not invited" | Only invited people can sign in. The first global admin is `SEED_GLOBAL_ADMIN_EMAIL`; everyone else is invited in **Users & access**. |
| No invitation emails | `MAIL_PROVIDER=graph` needs `Mail.Send` (application) with admin consent, and `MAIL_SENDER` must be a real mailbox. |
| Upload error "SharePoint refused: grant the app Sites.ReadWrite.All…" | Add the permission and **grant admin consent** (step 5). |
| Upload error "SharePoint site … was not found" | Check the `SHAREPOINT_SITE` format: `host:/sites/name`, with no `https://`. |
| The container keeps restarting, with out-of-memory messages | The plan is too small (section 1). Move to P1v3 or B3, or set `SUITE_SKIP=resume`. |
| Files disappear after a restart | `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true` and the `/home/data/...` folder settings are missing (section 8). |
| Too many database connections | Lower `DB_POOL_SIZE` (e.g. `3`) or use a larger database size. |

**Each app's log file:** web app → *Development Tools → Advanced Tools (Kudu)* → *Bash* → `ls /home/data/logs/`. Each request line has a `request_id=`; search the app's file for it to see the full error.

---

## 13. Alternative: code deploy (no container)

Use this way when you don't want a container registry or Docker, for example to keep an existing code-deploy web app. Azure installs the Python packages itself.

**Limits compared with the container:**
- **Scanned resumes:** Tesseract can't be installed on Azure's built-in Python, so the Resume Evaluator can't read scanned (image-only) resumes. Normal PDF and Word resumes work.
- **AI libraries:** they install on the first deploy, which takes much longer (about 15–30 minutes).
- **Plan size:** these need **B3 or P1v3**. On a smaller plan, set `SUITE_SKIP=resume` to run the other five apps.

### 13.1 Resources

Create the **resource group**, **PostgreSQL server and database** and **App Service plan** exactly as in step 3. **Skip the container registry**, and create the web app with Python instead of an image:
```bash
az webapp create -g rg-ttsuite -p plan-ttsuite -n <app> --runtime "PYTHON:3.13"
```

### 13.2 Database and Entra
- **Database:** the same as step 4. Run `deploy/sql/azure-full-schema.sql` once on the new database. If you are taking over the Kanban database, follow section 14 instead.
- **Entra:** the same as step 5.

### 13.3 Web app settings (general)

| Setting | Value |
|---|---|
| Stack | **Python 3.13** |
| Startup command | `python deploy/run.py` |
| Always On | **On** |
| Health check path | `/api/health` |
| HTTPS only | **On** |
| Instances | **1** |
```bash
az webapp config set -g rg-ttsuite -n <app> --startup-file "python deploy/run.py" --always-on true   --generic-configurations '{"healthCheckPath": "/api/health"}'
az webapp update -g rg-ttsuite -n <app> --https-only true
```

### 13.4 App settings

Use **all the "Required", "Recommended" and "Optional" rows of section 8**, **except** the container-only table. Do **not** set `WEBSITES_ENABLE_APP_SERVICE_STORAGE`, `STORAGE_DIR`, `UPLOAD_DIR` or `RESUME_UPLOAD_DIR`: `run.py` puts files and logs in `/home/data/...` by itself on App Service.

Add these three:

| Name | Value |
|---|---|
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` (Azure installs `requirements.txt` on deploy) |
| `PORT` | `8000` |
| `WEBSITES_PORT` | `8000` |

### 13.5 Build the package (on your machine)

At the `TT-suite` root (Node.js 24 and npm needed):
```
npm run suite:package
```
This builds the six web apps and assembles **`dist-suite/`**:
- the six backends (`apps/…`)
- the built pages (`static/…`)
- `deploy/run.py`
- one merged `requirements.txt`

The build lists any package versions that differ between the backends; the portal's and Kanban's versions are kept.

### 13.6 Deploy

Use any one of:
- **VS Code:** Azure extension → App Service → right-click the web app → **Deploy to Web App…** → choose the **`dist-suite`** folder.
- **Azure CLI:** zip the **contents** of `dist-suite` and deploy the zip:
  ```powershell
  Compress-Archive -Path dist-suite\* -DestinationPath suite.zip -Force
  az webapp deploy -g rg-ttsuite -n <app> --src-path suite.zip --type zip
  ```

Watch the deployment log (*Deployment Center → Logs*, or VS Code *Output → Azure App Service*). Azure (Oryx) installs `requirements.txt`.

### 13.7 First start, checks and releases
- **First start and checks:** the same as section 9.
- **Every release:**
  1. `npm run suite:package`
  2. deploy `dist-suite` again (13.6)
  3. check `/api/health`
- **No SQL scripts:** each app migrates its own schema on start.
- **Rollback:** redeploy the previous `dist-suite` (keep a copy of each release's zip). For the database, see section 11.

## 14. Moving an existing Kanban database into the suite

Use this instead of the setup script when the suite should take over **the database Kanban already uses** (keeping its boards and people). A summary:

1. **Back up** the database (*Backup now*, or `pg_dump "$DATABASE_OWNER_URL" -Fc -f kanban-before-suite.dump`), and keep the old Kanban build for rollback.
2. **Database URLs:** use Kanban's existing roles. Set `DATABASE_OWNER_URL` as `kanban_owner` and `DATABASE_URL` as `kanban_app`.
3. **No setup script.** On the first start the suite creates the `app`, `lms`, `expense`, `ams` and `resume` schemas. Kanban **moves its tables from `public` into a new `kanban` schema**: one transaction, no data copied, grants kept.
4. **Right after the first start**, link the existing Kanban people into the suite (it is safe to run twice):
   ```
   psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 -f deploy/sql/kanban-backfill.sql
   ```
5. **Redirect URI:** in the Kanban app registration, add the redirect URI `…/api/auth/oidc/callback`. Remove the old `/api/v1/auth/oidc/callback` once everything works.
6. **Rollback:**
   1. Redeploy the old Kanban build.
   2. Move Kanban back to `public`: `psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 -f deploy/sql/kanban-schema-rollback.sql`.
   3. Run the old build's migration downgrade.
