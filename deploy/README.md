# Deploy the TT Suite to the existing Azure App Service (code deploy, B1)

These steps put the Tektalis Suite on Azure: the **portal** (sign-in, dashboard, global admin), **Kanban**, **LMS** (Leave), **EMS** (Expense) and **AMS** (Asset Management).
- Everything runs on **the web app Kanban already uses**. It is a Linux App Service on the Basic B1 plan, about $18 a month.
- Everything uses **Kanban's existing PostgreSQL Flexible Server database**.
- You need **no new paid resources**: no container registry, no extra plan, no slots, no Key Vault and no second database.

```
 one web app (B1)                         one database (existing "kanban" db)
 python deploy/run.py                      schema kanban  -> Kanban (moved from public)
   portal  :8000  public  /, /api           schema app     -> people, access, sessions
   kanban  :8002  /kanban                   schema lms     -> Leave
   lms     :8003  /lms                      schema expense -> Expense
   expense :8004  /expense                  schema ams     -> Asset Management
   ams     :8005  /ams
```

Do steps 1–5 **once**. Do step 6 for every release. Step 7 is the one-time Kanban cutover.

## 0. Before you start (cutover day)

1. **Back up the database.** Azure portal → the server → *Backup and restore* → *Backup now*. You can also run `pg_dump "$DATABASE_OWNER_URL" -Fc -f kanban-before-suite.dump`.
2. **Keep the current `Kanban-internal-main/dist-azure` folder.** Redeploying it is your rollback; the suite's database changes are all additive.

## 1. The web app: runtime and startup (once)

Azure portal → the existing web app:

| Where | Set to |
|---|---|
| Settings → Configuration → General settings → *Stack* | **Python 3.13** (unchanged) |
| … → *Startup Command* | `python deploy/run.py` (was `cd Solution/backend-py && python -m app`) |
| … → *Always On* | **On** (mail, the EMS scheduler and Kanban's weekly mails run inside the processes) |
| Monitoring → Health check → *Path* | `/api/health` (was `/api/v1/health`) |
| Scale out | **1 instance** (the schedulers run in-process; B1 is 1 instance anyway) |

`deploy/run.py` starts the five processes, restarts any that stop, and stops them all when App Service stops the site. Each process migrates its own schema when it starts.

## 2. The database (once)

The roles and database Kanban already has are reused (`kanban_owner` runs migrations, `kanban_app` is the runtime role). Nothing needs creating:
- The owner role creates the `app`, `lms` and `expense` schemas on first start.
- Kanban **moves its existing tables from `public` into a new `kanban` schema** on its first start: one transaction, all or nothing, no data copied (only the schema label changes), grants kept. The log shows it before Kanban's migrations.
- It grants `kanban_app` the rights it needs.
- No extensions are required.

**Connection budget:** 4 processes × a pool of 5 = about 20 connections. That fits the Burstable tier's limit.

## 3. Microsoft sign-in (once)

Entra admin center → App registrations → **the Kanban app** → Authentication → *Web* → add the redirect URI:

`https://<web-app-name>.azurewebsites.net/api/auth/oidc/callback`

The permissions Kanban already has are reused:
- delegated `openid profile email User.Read`
- application `User.Read.All` (directory search in *Invite user*)
- application `Mail.Send` (invite emails)

After the cutover, remove the old `/api/v1/auth/oidc/callback` URI.

## 4. App settings (once; change any time)

Web app → Settings → Environment variables. Settings that already exist for Kanban keep their values unless this table says otherwise.

| Name | Value |
|---|---|
| `APP_PROFILE` | `prod` |
| `PUBLIC_BASE_URL` | `https://<web-app-name>.azurewebsites.net` (no trailing slash) |
| `PORT`, `WEBSITES_PORT` | `8000` (unchanged; the portal now listens here) |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |
| `AUTH_PROVIDER` | `entra` |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | unchanged (Kanban's app registration) |
| `ENTRA_REDIRECT_URI` | **change to** `https://<web-app-name>.azurewebsites.net/api/auth/oidc/callback` |
| `DATABASE_URL`, `DATABASE_OWNER_URL` | unchanged (the existing `kanban` database) |
| `APP_SECRET` | unchanged |
| `INTERNAL_TOKEN` | **new**: 32+ random characters, e.g. PowerShell `[Convert]::ToBase64String((1..32 \| % { Get-Random -Max 256 }))`. It protects the portal → app calls. |
| `SEED_GLOBAL_ADMIN_EMAIL` | **new**: `vignesh.k@tektalis.com`. This person becomes global admin with admin in all four apps. |
| `SEED_ADMIN_EMAIL` | delete it (the suite seeds admins now) |
| `AUTH_DEV_MODE` | delete it, or set `false` |
| `MAIL_PROVIDER`, `MAIL_SENDER` (or the SMTP settings) | unchanged. Suite invites go out through the same Kanban mailbox. |
| `MAIL_FROM_NAME` | optional, e.g. `Tektalis Suite` (used for SMTP) |
| `ORG_TZ` | unchanged (Kanban) |
| `DEFAULT_TIMEZONE` | **new** (LMS): `Asia/Kolkata` |

These are set by `run.py` and need no App Setting:
- each app's own port
- `PUBLIC_BASE_URL` per app (`…/kanban`, `…/lms`, `…/expense`)
- EMS uploads at `/home/data/expense/uploads`
- LMS storage at `/home/data/lms`

App Service keeps `/home` across deploys.

`APP_PROFILE=prod` refuses to start if a dev-only setting is present or `INTERNAL_TOKEN` is missing. The log stream says which setting is wrong.

## 5. Package scripts (once per machine)

At the `TT-suite/` root:

```
npm run suite:package     # builds the 4 SPAs and assembles dist-suite/
```

The build prints any requirement pins that differ between the backends. Review them; the first one listed (portal or Kanban) is kept.

## 6. Deploy (every release)

1. Run the tests (see `CHANGES.md` → Verification) and `npm run suite:package`.
2. VS Code → Azure → App Service → right-click the web app → **Deploy to Web App…** → choose the **`dist-suite`** folder.
3. Watch *Output → Azure App Service*. Oryx installs `requirements.txt`, which takes a few minutes the first time.
4. Open the *Log stream*. You should see `[portal] … migrated suite`, `[kanban] … migrated`, `[lms] …` and `[expense] …`, each followed by its process listening.

## 7. Kanban cutover (once, right after the first suite deploy)

Run this with the **owner** connection:

```
psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 -f deploy/sql/kanban-backfill.sql
```

It adds every existing Kanban user to the suite, links them, and gives them their Kanban role (admin, lead or member) in `app.app_access`. Nothing else in Kanban's tables changes (they are in the `kanban` schema by then).
- Its last query prints two numbers, which should be equal.
- The script is idempotent, so running it again is safe.

Everyone signs in once more, because the old Kanban sessions are not reused. The global admin then grants LMS, Expense and Asset Management access from **Users & access**.

## 8. Check

1. `https://<web-app-name>.azurewebsites.net/api/health` shows `"status":"ok"` with `portal`, `kanban`, `lms`, `expense` and `ams` all `"ok"`.
2. Open the site and **Sign in with Microsoft** as the `SEED_GLOBAL_ADMIN_EMAIL` person. You land on the dashboard and see 4 cards (LMS, EMS, Kanban, Asset Management), each marked **Admin**.
3. Click each card. The portal checks your role in that app and opens it under `/lms/`, `/expense/`, `/kanban/` or `/ams/`.
4. Go to Users & access → **Invite user** and pick roles. The person receives one invitation email.
5. Watch App Service → Metrics → *Memory working set*. Expect roughly 500–700 MB on B1's 1.75 GB.

If the site shows *Application Error*, open the Log stream. Each line is prefixed with the process name, and the usual causes are a missing setting, the startup command, or the database firewall.

## Rollback

1. Set the startup command back to `cd Solution/backend-py && python -m app` and the health check back to `/api/v1/health`.
2. Restore `ENTRA_REDIRECT_URI` and `SEED_ADMIN_EMAIL`.
3. Redeploy the kept Kanban `dist-azure` folder.

The old Kanban build expects its tables in `public` and its migrations to end before the suite migration (`app_user.suite_user_id`). Before redeploying it, do one of these:
- **Restore the backup from step 0.** Simplest; it discards anything changed since.
- **Undo the two Kanban changes**, with the suite stopped:
  1. Downgrade the suite migration with the new build's CLI, from `apps/kanban` with the owner URL: `python -m app.db.cli down 1`.
  2. Move Kanban back to `public`: `psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 -f deploy/sql/kanban-schema-rollback.sql`.

The `app`, `lms` and `expense` schemas can stay; the old build never looks at them.
