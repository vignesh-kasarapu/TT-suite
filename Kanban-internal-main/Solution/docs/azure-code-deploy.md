# Deploy to Azure App Service from VS Code (code deploy, D-128)

For an **existing Linux web app** and an **existing PostgreSQL Flexible Server**, deployed with
the VS Code **Azure App Service** extension. The extension uploads `dist-azure/` (built by
`npm run azure:package`); App Service installs the Python packages itself and starts the app.
The container route (`Solution/infra/deploy.ps1`) still works and is unchanged.

Do the one-time steps 1-4 once per web app, then step 5 for every release.

## 1. The web app: runtime and startup (once)

Azure portal → the web app:

| Where                                                 | Set to                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| Overview → _Operating System_                         | **Linux** (a Windows web app cannot run this)               |
| Settings → Configuration → General settings → _Stack_ | **Python 3.13**                                             |
| … → _Startup Command_                                 | `cd Solution/backend-py && python -m app`                   |
| … → _Always On_                                       | On (the weekly reminder mails are scheduled inside the app) |
| Monitoring → Health check → _Path_                    | `/api/v1/health`                                            |

`python -m app` applies the database migrations, makes `SEED_ADMIN_EMAIL` an admin, then
serves the API and the web pages on `PORT`.

## 2. The database: two roles and one database (once)

Connect to the server as its admin (portal → the server → _Connect_, or `psql`) and run, with
your own passwords:

```sql
CREATE ROLE kanban_owner LOGIN PASSWORD '<owner password>';   -- runs the migrations
CREATE ROLE kanban_app   LOGIN PASSWORD '<app password>';     -- what the app runs as
GRANT kanban_owner TO CURRENT_USER;                           -- lets the admin hand the database over
CREATE DATABASE kanban OWNER kanban_owner;
GRANT CONNECT ON DATABASE kanban TO kanban_app;
\c kanban
GRANT USAGE ON SCHEMA public TO kanban_app;                   -- table grants come from the migrations
```

To prepare the schema by hand instead of at the app's first start, run `Solution/db/sql/create-database.sql`
(new database) or `upgrade-from-0013.sql` (a database of the previous version, data kept) as the owner
role; generate them for your role names with `npm run db:sql -- kanban_app`.

The migrations grant table rights to whichever user `DATABASE_URL` connects as (D-106), so
other role names work too. No PostgreSQL extensions are needed.

Server → Networking: allow the web app in, either _Allow public access from any Azure service_
or a rule for the web app's outbound IP addresses (web app → Networking → _Outbound
addresses_).

## 3. Microsoft sign-in (once)

Entra admin center → App registrations → the Kanban app → Authentication → _Web_ → add the
redirect URI:

`https://<web-app-name>.azurewebsites.net/api/v1/auth/oidc/callback`

(keep the `http://localhost:8080/...` one for local development). For the mails to send, the
same app needs Microsoft Graph **Mail.Send** (Application) with admin consent; until then the
app works and the mails wait in the outbox, retried and marked failed.

## 4. App settings (once; change any time)

Web app → Settings → Environment variables → App settings. **Secrets are typed here only,
never in a file in the repository.**

| Name                                                                                                                                                         | Value                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `APP_PROFILE`                                                                                                                                                | `prod`                                                                                                                                           |
| `PUBLIC_BASE_URL`                                                                                                                                            | `https://<web-app-name>.azurewebsites.net`                                                                                                       |
| `PORT`                                                                                                                                                       | `8000`                                                                                                                                           |
| `WEBSITES_PORT`                                                                                                                                              | `8000`                                                                                                                                           |
| `SCM_DO_BUILD_DURING_DEPLOYMENT`                                                                                                                             | `true` (installs `requirements.txt` on deploy)                                                                                                   |
| `AUTH_PROVIDER`                                                                                                                                              | `entra`                                                                                                                                          |
| `AUTH_DEV_MODE`                                                                                                                                              | `false`                                                                                                                                          |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`                                                                                                                         | from the app registration                                                                                                                        |
| `ENTRA_CLIENT_SECRET`                                                                                                                                        | from the app registration (secret)                                                                                                               |
| `ENTRA_REDIRECT_URI`                                                                                                                                         | the URI from step 3                                                                                                                              |
| `DATABASE_URL`                                                                                                                                               | `postgres://kanban_app:<app password>@<server>.postgres.database.azure.com:5432/kanban?sslmode=require`                                          |
| `DATABASE_OWNER_URL`                                                                                                                                         | `postgres://kanban_owner:<owner password>@<server>.postgres.database.azure.com:5432/kanban?sslmode=require`                                      |
| `APP_SECRET`                                                                                                                                                 | 32 random bytes, base64 - e.g. PowerShell `[Convert]::ToBase64String((1..32 \| % { Get-Random -Max 256 }))` - **new for Azure, not the dev one** |
| `SEED_ADMIN_EMAIL`                                                                                                                                           | `vignesh.k@tektalis.com` (the first admin, who invites everyone else)                                                                            |
| `MAIL_PROVIDER`                                                                                                                                              | `graph` (`prod` refuses `stub`)                                                                                                                  |
| `MAIL_SENDER`                                                                                                                                                | the sending mailbox, e.g. `kanban@tektalis.com`                                                                                                  |
| _or, for SMTP (D-132):_ `MAIL_PROVIDER` = `smtp`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` (secret), `SMTP_FROM_ADDRESS`, `MAIL_FROM_NAME` | any SMTP server, e.g. `smtp.gmail.com` / `587` with an app password - no Graph permission needed                                                 |
| `ORG_TZ`                                                                                                                                                     | `Asia/Kolkata`                                                                                                                                   |

A password with `@`, `:` or `/` in it must be URL-encoded inside the two `postgres://` URLs.
`prod` refuses dev-only settings and says which one (`AUTH_DEV_MODE=true`, `APP_FAKE_NOW`,
`AUTH_PROVIDER=dev`, `MAIL_PROVIDER=stub`).

## 5. Deploy (every release)

1. Make sure `npm run ci:local` was green for the commit you deploy.
2. VS Code → Azure icon → _App Service_ → right-click the web app → **Deploy to Web App…**
   (the first time, accept saving it as the default web app for this workspace).
3. The workspace settings (`.vscode/settings.json`) make the extension first run the task
   **azure: package** (`npm run azure:package`: builds the SPA, gathers the backend into
   `dist-azure/`) and then upload `dist-azure/` with _build during deployment_ on.
4. Watch _Output → Azure App Service_; the build installs the packages (a few minutes the first
   time).

## 6. Check

1. `https://<web-app-name>.azurewebsites.net/api/v1/health` → `{"status":"ok","db":"ok",...}`.
2. The log stream (web app → Log stream) shows `"msg":"migrated"` with `0016_contact_admin` last.
3. Open the site, **Sign in with Microsoft** as the `SEED_ADMIN_EMAIL` person → the board.
4. Admin → Users → invite someone; Admin → Teams → create a team.

If the site shows _Application Error_: Log stream. The usual causes are a missing app setting
(the log names it), the startup command, the database firewall, or a URL-encoding slip in a
password.
