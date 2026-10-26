# Upgrading production without losing data

**From:** the production version, `github.com/tektalis/Kanban-internal` (`main`, commit `27c56be`):
Node backend, database at migration `0013_inbox`.
**To:** the current version (this repository): Python FastAPI backend, migrations up to `0020`.

## 1. Why the data is safe

| Fact                                                     | What it means                                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The data lives in **PostgreSQL**, not in the app         | Deploying a new app image or package never touches the data. Only the database migrations change it                  |
| Migrations `0001`-`0013` are **byte-for-byte identical** | The new version recognises the production schema as its own                                                          |
| The new version only **adds** migrations `0014`-`0020`   | No table or column is dropped; see the table below                                                                   |
| The upgrade is **one transaction**                       | If anything fails, the database stays exactly as it was                                                              |
| It was **rehearsed**                                     | On a copy of the production schema with data: everything kept, and the upgraded schema is identical to a new install |

What the new migrations do to existing data (every table and column, before and after, is in
[`database-schema.md`](database-schema.md)):

| Migration                | Change                                                     | Existing data                                               |
| ------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `0014_remove_uat`        | The UAT state is removed                                   | Cards in **UAT move to Testing**, each with a history entry |
| `0015_time_log`          | New tables: week notes, days off, weekly-mail runs         | Untouched (new, empty tables)                               |
| `0016_contact_admin`     | A new email kind is allowed                                | Untouched                                                   |
| `0017_priority_optional` | A card's priority may be empty (new cards default to none) | Untouched: every existing card keeps its priority           |
| `0018_mail_templates`    | New table for admin-edited email wording                   | Untouched (new, empty table)                                |
| `0019_login_issues`      | New table for messages from people who cannot sign in      | Untouched (new, empty table)                                |
| `0020_testing_to_uat`    | The Testing state is renamed UAT (D-146)                   | Cards in **Testing move to UAT**, each with a history entry |

## 2. Before the upgrade (a few days ahead)

1. **Agree a window** (about 30 minutes, out of hours) and tell users. Kanban is unavailable while
   the new version starts.
2. **Confirm automatic backups** on the PostgreSQL Flexible Server: Azure portal > the server >
   Backup and restore. Retention should be at least 7 days (the original setup used 35).
3. **Check where production is now.** Connected as the owner role:

   ```sql
   SELECT max(id) FROM schema_migration;               -- must be 0013_inbox
   SELECT to_regclass('alembic_version');              -- must be NULL (not upgraded yet)
   SELECT count(*) FROM card WHERE state IN ('uat', 'testing'); -- these all end in UAT (0014, 0020)
   ```

4. **Rehearse on a copy of production** (strongly recommended):
   - Restore last night's backup to a **new** server (Backup and restore > Restore), or
     `pg_restore` a `pg_dump` into a scratch database.
   - Point a test copy of the new app at it, or run `Solution/db/sql/upgrade-from-0013.sql` on
     it. Then compare the counts (step 4 of the upgrade, below) and click through the app.
   - Delete the copy afterwards.
5. **Prepare the new settings** (Web App > Environment variables). The existing values stay. New or
   changed:

   | Setting                                                    | Value                                                                                          |
   | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
   | `SESSION_HOURS`                                            | `24` if sessions should last a day (production has `12` set explicitly, which still wins)      |
   | `MAIL_PROVIDER` / `MAIL_SENDER`                            | `graph` and a real mailbox; the app needs Graph **Mail.Send** as an **Application** permission |
   | `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` | Only if `MAIL_PROVIDER=smtp`                                                                   |
   | `RL_CONTACT_IP`                                            | Optional; default `5/hour` (the "Message an admin" form)                                       |
   | `DATABASE_URL`, `DATABASE_OWNER_URL`                       | **Unchanged**: the same roles as today (new tables are granted to the `DATABASE_URL` user)     |

## 3. The upgrade

1. **Back up right before** (the restore point for the rollback):

   ```powershell
   pg_dump -Fc -d "<owner connection string>" -f kanban-before-upgrade.dump
   ```

   Keep the file outside the repository (it is git-ignored anyway) and note the time. Azure's
   point-in-time restore to "just before" also works.

2. **Snapshot the counts**, to compare afterwards:

   ```sql
   SELECT 'users', count(*) FROM app_user UNION ALL
   SELECT 'teams', count(*) FROM team UNION ALL
   SELECT 'members', count(*) FROM team_member UNION ALL
   SELECT 'projects', count(*) FROM project UNION ALL
   SELECT 'programs', count(*) FROM program UNION ALL
   SELECT 'cards', count(*) FROM card UNION ALL
   SELECT 'cards in uat', count(*) FROM card WHERE state = 'uat' UNION ALL
   SELECT 'comments', count(*) FROM card_comment UNION ALL
   SELECT 'links', count(*) FROM card_link UNION ALL
   SELECT 'time hours', coalesce(sum(hours), 0) FROM time_entry UNION ALL
   SELECT 'card events', count(*) FROM card_event;
   ```

3. **Deploy the new version** to the **same** web app, pointing at the **same** database. Pick one
   way:

   - **Automatic (simplest):** deploy (`Solution/docs/azure-code-deploy.md`). At start the app
     applies `0014`-`0020` by itself, then serves.
   - **By hand first:** run `Solution/db/sql/upgrade-from-0013.sql` as the owner role (regenerate it
     for the production role names with `npm run db:sql -- <runtime role>`), then deploy. The app
     then finds nothing to do.

4. **Check** (within 15 minutes):
   - `https://<app>/api/v1/health` answers `{"status":"ok","db":"ok",...}`.
   - Log stream: `"msg":"migrated"` lists `0014_remove_uat` to `0020_testing_to_uat` (or nothing,
     if run by hand first).
   - Run the count query again: every number is the same, except **cards in uat = 0**, and
     **card events** grows by exactly the number of UAT cards.
   - Sign in, open a team board, a few old cards (history, comments, time), My time and Team time.

## 4. If something goes wrong (rollback)

| Situation                                   | Do this                                                                                                                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The migration fails at start                | Nothing changed (one transaction). Read the log, fix, start again. Production data is as before                                                                                                                                                      |
| The new app has a serious problem, same day | Redeploy the previous image tag **and restore the backup from step 3.1**. Anything entered after the upgrade is lost, so decide quickly                                                                                                              |
| Must go back but keep newer data            | `python -m app.db.cli down 7` with the new image (or `.down.sql` files 0020 to 0014): renames UAT back to Testing, drops the new tables (week notes, days off, email templates, login issues), sets empty priorities back to 3; cards end in Testing |

Do **not** start the previous (Node) app on the upgraded database without one of these: its board
still offers UAT, which the upgraded database refuses, and it does not expect empty priorities.

## 5. Every future upgrade

The same safety holds for every release, as long as these rules are kept:

1. **Never edit or delete a migration that production has run.** Changes always come as a new,
   numbered migration (`00NN_name` in `Solution/backend-py/alembic`), additive where possible.
2. **Every migration has a down file**, and `test_migrations.py` must pass (it applies all
   migrations, reverts them and checks the schema both ways).
3. **Back up before every deploy** (`pg_dump -Fc` and note the time). Keep at least the last
   three upgrade backups.
4. **Rehearse anything that changes existing rows** (like `0014`) on a restored copy first.
5. **Regenerate the SQL scripts** (`npm run db:sql`) so `Solution/db/sql` always matches.
6. **Never run `docker compose ... down -v`** on a server that holds real data: `-v` deletes the
   database volume. Plain `down` keeps it.
