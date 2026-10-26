# Kanban V1.0

Internal, self-hosted kanban for Tektalis: a private board for each person, team boards with
programs and projects, card links, time logging with weekly emails, and Microsoft sign-in.

Stack: Python 3.13 + FastAPI, PostgreSQL 17, React 19 + Vite. The app runs in Docker.

---

## Quick start

On a PC that already has the tools (step 1 below), from the project folder in PowerShell:

```powershell
npm ci                                              # 1. JavaScript packages
cd Solution\backend-py; python -m venv .venv; .venv\Scripts\pip install -r requirements-dev.txt; cd ..\..   # 2. Python packages (for npm run seed)
npm run trial:up                                    # 3. start Kanban + database in Docker
npm run seed                                        # 4. load people, teams, cards and time
start http://localhost:8080                         # 5. open it and pick a name
```

The steps below explain each one.

---

## Run the project, step by step (Windows)

Use **PowerShell** (the VS Code terminal on Windows). Run every command from the **project
folder** (where `package.json` is) unless a step says otherwise.

### Step 1 - Install the tools (once per PC)

| Tool                                                              | Check it           | Needed           |
| ----------------------------------------------------------------- | ------------------ | ---------------- |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | `docker --version` | any recent       |
| [Node.js 24 LTS](https://nodejs.org/)                             | `node -v`          | `v24.x`          |
| npm (comes with Node)                                             | `npm -v`           | `11.16` or newer |
| [Python 3.13](https://www.python.org/downloads/)                  | `python --version` | `3.13.x`         |
| [Git](https://git-scm.com/)                                       | `git --version`    | any recent       |

If `npm -v` is lower than 11.16, run `npm install -g npm@11`.

### Step 2 - Get the code

```powershell
git clone https://github.com/vignesh-kasarapu/Kanban.git
cd Kanban
```

### Step 3 - Install the packages

```powershell
npm ci
cd Solution\backend-py
python -m venv .venv
.venv\Scripts\pip install -r requirements-dev.txt
cd ..\..
```

`npm ci` installs the JavaScript packages; **do not skip it** (without it you get
`Need to install the following packages: tsx` or `Cannot find package 'pg'`). The Python
environment (`.venv`) is used by `npm run seed` to create cards and time through the app's own
rules. The app itself runs inside Docker and does not need it.

### Step 4 - Start Docker Desktop

Open Docker Desktop and wait until it says **Engine running**. Ports **8080** and **5432** must be
free: close any other app or database using them.

### Step 5 - Start Kanban

```powershell
npm run trial:up
```

The first run builds the app image (a few minutes). It ends with both containers **Healthy**:

```
 ✔ Container kanban-trial-db-1   Healthy
 ✔ Container kanban-trial-app-1  Healthy
```

Check it: http://localhost:8080/api/v1/health answers `{"status":"ok","db":"ok",...}`.

### Step 6 - Load the seed data

```powershell
npm run seed
```

This loads [`Solution/seed-data.json`](Solution/seed-data.json): people, teams, team leads and
tags, then **3 cards per person** in different states and **one logged week** (last week, Mon-Fri,
8 h a day on their open cards). It prints:

```
seeded 10 users, 2 teams, 4 tags
seeded 30 cards (0 were there), time for 10 people
```

Edit the file and run `npm run seed` again to change the data. It only **adds** what is missing
and never deletes: a card whose title exists is skipped, nobody gets a second week of time. The
format:

```json
{
  "users": [{ "name": "Vignesh K", "email": "vignesh.k@tektalis.com", "role": "admin" }],
  "teams": [{ "name": "Payments", "leads": ["lead@..."], "members": ["lead@...", "member@..."] }],
  "tags": ["backend", "bug"],
  "cards": [
    {
      "title": "Integrate UPI collect API",
      "team": "Payments",
      "assignee": "member@...",
      "state": "in_development",
      "priority": 1
    }
  ],
  "time": { "week": "last", "hoursPerDay": 8, "note": "Seeded week" }
}
```

`role` is `"admin"` or left out (member). `state` is one of `backlog`, `in_prep`, `ready`,
`in_development`, `uat`, `delivered`. `priority` is 1-4, or left out for none.

### Step 7 - Open Kanban and sign in

Open **http://localhost:8080**, pick a name and click **Sign in**. This is the **dev sign-in**
(no password), for trying the app on your own PC.

---

## Optional: Microsoft sign-in and real emails

All settings go in **`Solution\.env`** (git-ignored: secrets never leave your PC). Create it once:

```powershell
copy Solution\.env.example Solution\.env
```

After any change to `Solution\.env`, run `npm run trial:up` again.

### Sign in with Microsoft

In `Solution\.env`:

```
AUTH_DEV_MODE=false
ENTRA_TENANT_ID=<Directory (tenant) ID>
ENTRA_CLIENT_ID=<Application (client) ID>
ENTRA_CLIENT_SECRET=<client secret value>
ENTRA_REDIRECT_URI=http://localhost:8080/api/v1/auth/oidc/callback
```

The values come from the Kanban app registration in the Entra admin center
([`entra-setup.md`](Solution/docs/entra-setup.md)); that redirect URI must be listed on it. The
sign-in page then shows **Sign in with Microsoft**. Only people in `seed-data.json` (with their
real work email) or invited by an admin can get in. `AUTH_DEV_MODE=true` brings the name picker
back.

### Send real emails

Out of the box, emails (invitation, card assigned, weekly time reminders and team reports) are
kept in the app's dev mailbox at http://localhost:8080/api/v1/dev/mail and **not sent**. Pick one:

**Microsoft 365 (recommended)** - sends from a Tektalis mailbox. Needs the Entra values above and,
on the app registration, Microsoft Graph **Mail.Send** as an **Application** permission with admin
consent (a _Delegated_ one does not work).

```
MAIL_PROVIDER=graph
MAIL_SENDER=<a real mailbox, e.g. kanban@tektalis.com>
```

**SMTP** - any mail server (port 587 with STARTTLS or 465 with TLS). Gmail needs an **app
password** (Google account > Security > App passwords), sends from the signed-in account, and
allows about 500 emails a day.

```
MAIL_PROVIDER=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=<account>@gmail.com
MAIL_PASSWORD=<16-character app password>
SMTP_FROM_ADDRESS=<account>@gmail.com
```

Watch the sending: `docker logs -f kanban-trial-app-1 2>&1 | Select-String notify`. Each email
logs `notify_sent`, or `notify_failed` with the reason (e.g. `graph sendMail 403` = the
permission is missing).

Admins change what each email says under **Administration > Email templates**.

---

## What is in the app

| Area             | What people can do                                                                                                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| My board         | **Private** cards, and **Org (my teams)**: every card of my teams (admins: all), my own first; remembers the last choice                                                                                                                                                                        |
| Team boards      | A team's cards by state (Backlog, In Prep, Ready, In-Progress, **UAT**, Delivered); Delivered shows as many as the fullest column (**Show closed** shows all)                                                                                                                                   |
| Board tabs       | **Board**, **Backlog** (a table with sorting, pages and bulk actions; overdue cards flagged) and **Calendar** (cards by ETA); filters in one popover                                                                                                                                            |
| Cards            | Title, description, priority (or none), ETA, effort, tags, project, assignee, comments with **@mentions**, links, files, time, history. A new card is held by its creator unless someone else is chosen. The card face shows the assignee's photo or initials; a card nobody holds shows nobody |
| Who moves / logs | Only the **assignee**, that team's **lead** or an **admin** changes a card's state or logs time on it; others see it read-only                                                                                                                                                                  |
| Inbox            | Card news grouped Today / Last 7 days / Earlier, with a **Mentions** tab                                                                                                                                                                                                                        |
| Teams            | Search, All / My teams, sort; create a team or add members (where allowed); open a team's board                                                                                                                                                                                                 |
| My time          | Log hours, mark leave/holiday, write a week note; week or month view                                                                                                                                                                                                                            |
| Team time        | Leads (their teams) and admins: hours vs target, charts, members and work tables, **Export** (CSV)                                                                                                                                                                                              |
| Reports          | By month, with graphs, a summary table and **Export**                                                                                                                                                                                                                                           |
| Emails           | Card assigned, Friday reminder, Monday shortfall, Monday team report to leads **with the week's CSV attached**                                                                                                                                                                                  |
| Administration   | Teams, leads, programs, projects, tags, users and invitations, **Email templates**, **Login issues**                                                                                                                                                                                            |
| Sign-in page     | Dev name picker or Microsoft sign-in; "Can't sign in? Message an admin" - emailed to every admin and listed under **Administration > Login issues**, where an admin marks it resolved                                                                                                           |
| Sign-out         | Asks for confirmation first                                                                                                                                                                                                                                                                     |

---

## Everyday commands

| Task                                | Command                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stop (data is kept)                 | `npm run trial:down`                                                                                  |
| Start again                         | `npm run trial:up`                                                                                    |
| After `git pull` (new code)         | `npm ci`, then `npm run trial:up` (rebuilds the image; database changes apply on start)               |
| Load or update the seed data        | edit `Solution\seed-data.json`, then `npm run seed`                                                   |
| See the app's log                   | `docker logs -f kanban-trial-app-1`                                                                   |
| Back up the database                | `npm run trial:backup > kanban.dump`                                                                  |
| Start over with an empty database   | `npm run trial:down`, `docker volume rm kanban-trial_app_pgdata`, `npm run trial:up`, `npm run seed`  |
| Let colleagues on the office LAN in | `$env:TRIAL_HOST='<your PC IP>'; npm run trial:up` - see [`lan-trial.md`](Solution/docs/lan-trial.md) |
| Reload the page after an update     | **Ctrl + F5** in the browser (the old page stays loaded otherwise)                                    |

## If something goes wrong

| You see                                                                              | Fix                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Need to install the following packages: tsx` / `Cannot find package 'pg'`           | Run `npm ci` (step 3)                                                                                                               |
| `No Python environment at ...\.venv` during `npm run seed`                           | Create it (step 3, the `python -m venv` lines)                                                                                      |
| `failed to connect to the docker API`                                                | Docker Desktop is not running (step 4)                                                                                              |
| `port is already allocated` / `Bind for 0.0.0.0:8080 failed`                         | Something else uses 8080 or 5432: stop it, then `npm run trial:up`                                                                  |
| `container kanban-trial-app-1 is unhealthy`                                          | `docker logs kanban-trial-app-1 --tail 60` says why; an old database is the usual cause - start over with an empty database (above) |
| `refuses dev-only configuration` or `AUTH_PROVIDER=entra needs ENTRA_...` in the log | `Solution\.env` is incomplete: fill in all four `ENTRA_*` values, or set `AUTH_DEV_MODE=true`                                       |
| Microsoft shows `AADSTS50011`                                                        | Add `http://localhost:8080/api/v1/auth/oidc/callback` as a redirect URI on the app registration                                     |
| `notify_failed` ... `graph sendMail 403`                                             | Mail.Send is missing or Delegated: add it as an **Application** permission and grant admin consent                                  |
| `notify_failed` ... `smtp 535` / `smtp 550 5.4.5`                                    | Wrong SMTP password / the mail account's daily limit is used up                                                                     |
| A change does not show in the browser                                                | **Ctrl + F5**                                                                                                                       |

---

## For developers: run without Docker (hot reload)

After steps 1-3, in one terminal:

```powershell
npm run db:up                                   # PostgreSQL only, in Docker
cd Solution\backend-py
$env:APP_PROFILE='dev'; $env:AUTH_DEV_MODE='true'
.venv\Scripts\python -m app                     # API on http://localhost:8080 (leave it running)
```

`python -m app` applies the database changes, then starts uvicorn. Settings can also go in
`Solution\backend-py\.env` (copy its `.env.example`). In a second terminal, from the project
folder:

```powershell
npm run seed                                    # or: npm run db:seed:dev (the automated tests' users)
npm run dev -w Solution/frontend                # web app on http://localhost:5173 (hot reload)
```

Open http://localhost:5173. Stop the database with `npm run db:down`. The Docker way and this way
both use ports 8080 and 5432: run one at a time.

**Tests:** `npm run ci:local` runs everything (lint, types, unit, backend, Docker image, browser
tests at desktop/tablet/mobile; about 25-30 minutes; needs ports 8080 and 5432 free, so stop
`trial:up` first). `npm run ci:local -- --quick` runs the fast part only (about 2 minutes).
Details in [`Solution/README.md`](Solution/README.md).

## Database SQL scripts

Two ready-to-run files in [`Solution/db/sql`](Solution/db/sql) for preparing a database by hand
(psql, pgAdmin or the Azure portal's query editor), connected as the **owner** role:

| File                    | Use it for                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-database.sql`   | A **new, empty** database: creates the whole current schema                                                                                                                 |
| `upgrade-from-0013.sql` | A database of the **previous version** (github.com/tektalis/Kanban-internal): upgrades it and **keeps all data** (cards in Testing or UAT end in UAT). **Back it up first** |

```powershell
psql "<owner connection string>" -f Solution\db\sql\upgrade-from-0013.sql
```

Each runs in one transaction (an error changes nothing), refuses the wrong kind of database and
records what it applied, so the app then starts without changing anything. Table rights go to
the runtime role `app_rw`; for another one (e.g. `kanban_app`) run `npm run db:sql -- kanban_app`
to regenerate both files. Both roles must exist first. Simply starting the new app on an old
database does the same upgrade by itself.

**What the upgrade changes in the database** (production is at migration `0013`, this version at
`0020`):

| Change         | Details                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New tables (5) | `time_week_note`, `time_day_off`, `time_mail_run` (time log), `mail_template` (email wording), `login_issue` (messages from people who cannot sign in)                                   |
| Changed        | `card.priority` may be empty (existing cards keep theirs). Card states: **Testing is now called UAT** - cards in Testing or UAT all end in UAT, each move recorded in the card's history |
| Deleted        | **Nothing**: no table or column is dropped                                                                                                                                               |

Before upgrading production, read:

- [`Solution/docs/database-schema.md`](Solution/docs/database-schema.md): every table and column,
  what this version adds, changes and removes (no tables or columns are deleted), and how existing
  data is kept.
- [`Solution/docs/production-upgrade.md`](Solution/docs/production-upgrade.md): backup, upgrade,
  checks and rollback, step by step.

## Deploy to Azure

[`Solution/docs/azure-code-deploy.md`](Solution/docs/azure-code-deploy.md): one-time Azure setup
(web app, database roles, app settings, Entra redirect URI), then **Deploy to Web App...** from
the VS Code Azure App Service extension. `npm run azure:package` builds the upload folder
`dist-azure/`.

## npm commands

| Command                            | Does                                                                  |
| ---------------------------------- | --------------------------------------------------------------------- |
| `npm run trial:up`                 | Build and start Kanban + PostgreSQL in Docker (http://localhost:8080) |
| `npm run trial:down`               | Stop them (data kept)                                                 |
| `npm run seed`                     | Load `Solution/seed-data.json`                                        |
| `npm run trial:backup`             | Database backup to standard output                                    |
| `npm run db:up` / `db:down`        | PostgreSQL only (for the developer setup)                             |
| `npm run dev -w Solution/frontend` | Web app with hot reload (http://localhost:5173)                       |
| `npm run ci:local`                 | The full test chain                                                   |
| `npm run db:sql`                   | Regenerate the SQL scripts in `Solution/db/sql`                       |
| `npm run azure:package`            | Build `dist-azure/` for the Azure upload                              |
| `npm run contract:sync`            | Export the API contract after a backend change, then `contract:types` |

## Project layout

| Path                                                  | What it is                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `Solution/backend-py`                                 | FastAPI backend: all rules, permissions and database migrations            |
| `Solution/frontend`                                   | React web app: screens only, calls the API                                 |
| `Solution/tests`                                      | Frontend unit tests, Playwright browser tests, seed scripts                |
| `Solution/seed-data.json`                             | The seed data loaded by `npm run seed`                                     |
| `Solution/db/sql`                                     | Hand-run SQL: create a database, or upgrade the previous version's         |
| `Solution/api/openapi.json`                           | The API contract (generated by FastAPI; the frontend's types come from it) |
| `Solution/docs`                                       | Azure deploy, Microsoft sign-in and LAN trial guides                       |
| `Solution/docker-compose*.yml`, `Solution/Dockerfile` | Docker setup (app image + PostgreSQL)                                      |
| `Solution/.env.example`                               | Settings template for `Solution/.env` (sign-in, email)                     |
| `scripts/`                                            | Test chain, browser-test runner, Azure package                             |
