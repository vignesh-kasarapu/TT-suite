# Kanban database: keeping production data across versions

This page explains where Kanban's data lives, what the production database holds today, exactly
what the current version changes, and how existing data is carried over when something is
removed. For the step-by-step upgrade (backup, deploy, checks, rollback) see
[`production-upgrade.md`](production-upgrade.md).

- **Production version:** `github.com/tektalis/Kanban-internal` (`main`, commit `27c56be`); its
  database is at migration `0013_inbox` and has **20 tables**.
- **Current version:** this repository, migrations up to `0020_testing_to_uat`: **25 tables**
  (plus `alembic_version`, the migration tool's own one-row table).

The comparison and the table listings below were generated from the two real schemas (each
version's migrations applied to an empty database), not written by hand.

## 1. Summary

| Question                            | Answer                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables deleted                      | **None**                                                                                                                                                |
| Columns deleted, renamed or retyped | **None**                                                                                                                                                |
| Tables added                        | **5**: `time_week_note`, `time_day_off`, `time_mail_run`, `mail_template`, `login_issue` (+ `alembic_version`)                                          |
| Columns added to existing tables    | **None**                                                                                                                                                |
| Columns changed                     | **1**: `card.priority` may now be empty                                                                                                                 |
| Rules changed                       | **2**: card state `testing` renamed `uat` (`0014` folded the old UAT into Testing, `0020` renames it); 5 new notification kinds allowed                 |
| Indexes added                       | **2**: `time_entry_user_date_idx` on `time_entry (user_id, date)` for the time reports, and `login_issue_created_idx` on the new table (no data change) |
| Existing rows changed               | Only cards in **UAT** or **Testing**: they end in **UAT**, with history rows recording each move                                                        |

## 2. Where the data lives and why it survives an upgrade

| Part                                                                                            | Holds data?        | On an upgrade                    |
| ----------------------------------------------------------------------------------------------- | ------------------ | -------------------------------- |
| The app (Docker image / Azure Web App)                                                          | **No**             | Replaced on every deploy         |
| PostgreSQL (Azure Database for PostgreSQL; on a PC the Docker volume `kanban-trial_app_pgdata`) | **Yes, all of it** | Kept; changed only by migrations |
| Backups (Azure automatic backups, `pg_dump` files)                                              | Copies             | Taken before every upgrade       |

The database is only ever changed by **migrations**: numbered SQL files in
`Solution/backend-py/alembic/sql` (`0001_init.up.sql` to `0020_testing_to_uat.up.sql`), each with a
`.down.sql` that undoes it.

- When the app starts it applies the migrations the database has not had yet, in **one
  transaction**: if any step fails, nothing is applied and the data stays exactly as it was.
- What has run is recorded in **`schema_migration`** (the previous version's record, kept in step)
  and **`alembic_version`** (the current version's).
- The same changes can be run by hand: `Solution/db/sql/upgrade-from-0013.sql` for the existing
  production database, `Solution/db/sql/create-database.sql` for an empty one.
- Migrations `0001` to `0013` are **byte-for-byte identical** in both versions, so the current
  version recognises the production database as its own and only adds `0014` to `0020`.

## 3. What the current version changes

### Tables added (new and empty; existing data is not touched)

| Table             | Added by              | For                                                                                                                                      |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `time_week_note`  | `0015_time_log`       | A person's note for a week (for example why they are short of hours).                                                                    |
| `time_day_off`    | `0015_time_log`       | Leave and holiday days, which lower that week's target hours.                                                                            |
| `time_mail_run`   | `0015_time_log`       | Which weekly email job (Friday reminder, Monday review) already ran for which week, so none is sent twice.                               |
| `mail_template`   | `0018_mail_templates` | Email wording edited by admins (one row per email kind; no row = the built-in wording).                                                  |
| `login_issue`     | `0019_login_issues`   | Messages from people who cannot sign in (\"Message an admin\"), shown under Administration > Login issues; an admin marks each resolved. |
| `alembic_version` | the migration tool    | The current migration (one row)                                                                                                          |

Their columns are listed in section 5.

### Column changed

| Column          | Before                | Now                                             | Existing rows                                                              |
| --------------- | --------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `card.priority` | required, default `3` | optional, no default (`0017_priority_optional`) | **Unchanged**: every card keeps its priority. Only new cards may have none |

### Rules (check constraints) changed

| Rule                                            | Before                                                                          | Now                                                                                                                      | Existing rows                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `card.state` (`card_state_check`)               | backlog, in_prep, ready, in_development, testing, **uat**, delivered, cancelled | backlog, in_prep, ready, in_development, **uat**, delivered, cancelled (`0014` drops uat, `0020` renames testing to uat) | Cards in `uat` / `testing` end in `uat` (section 4) |
| `notification.kind` (`notification_kind_check`) | assigned, blocked, comment, closed, invited                                     | the same **plus** time_reminder, time_shortfall, time_shortfall_lead, time_team_report, contact_admin (`0015`, `0016`)   | Unchanged (the list only grows)                     |

One index is added, `time_entry_user_date_idx` on `time_entry (user_id, date)` (`0015`), to make
the time reports fast; it changes no data. Everything else (all other tables, columns, keys,
indexes and rules) is identical.

## 4. How previous data is kept when something is removed

### In this upgrade: the UAT state

UAT is the only thing removed, and its data is **moved, not deleted**. In one transaction,
`0014_remove_uat`:

1. writes a history row in **`card_event`** for every card in UAT (`field = 'state'`,
   `old_value = "uat"`, `new_value = "testing"`, attributed to the card's owner). This is the
   permanent record that the card was in UAT, and it shows in the card's History tab;
2. moves those cards to `state = 'testing'` and increases their `version`;
3. only then narrows the allowed states.

Nothing else about those cards changes: comments, time entries, links, attachments and earlier
history all stay. To list them after the upgrade:

```sql
SELECT c.number, c.title, e.created_at AS moved_at
  FROM card_event e JOIN card c ON c.id = e.card_id
 WHERE e.field = 'state' AND e.old_value = '"uat"' AND e.new_value = '"testing"';
```

### Going back (down migrations)

| Migration                | Its `.down.sql`                                                         | Data effect                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `0019_login_issues`      | drops `login_issue`                                                     | Stored login-issue messages are lost (the emails already sent to admins are not affected)                                         |
| `0020_testing_to_uat`    | renames `uat` back to `testing`                                         | Cards move back to Testing, each with a history row                                                                               |
| `0018_mail_templates`    | drops `mail_template`                                                   | Admin-edited email wording is lost; emails use the built-in wording                                                               |
| `0017_priority_optional` | priority required again, default 3                                      | Cards **without** a priority get `3`                                                                                              |
| `0016_contact_admin`     | removes the `contact_admin` kind                                        | Outbox rows of that kind are deleted first                                                                                        |
| `0015_time_log`          | drops the three time tables and the index, removes the time email kinds | Week notes, days off and mail-run records are lost; queued time emails are deleted; **time entries stay** (`time_entry` is older) |
| `0014_remove_uat`        | allows `uat` again                                                      | Cards stay in Testing; their history rows say where they came from                                                                |

Because a down migration can drop data entered after the upgrade, the safe way back is the
**backup taken just before the upgrade** (see `production-upgrade.md`, section 4).

### The rule for every future removal

When a later version must remove a column, table or allowed value, the data is kept, never just
dropped:

1. **Move or record the data first, in the same migration.** Copy the column into its
   replacement, or into an archive table (for example `card_priority_archive (card_id, priority,
archived_at)`), or record the old value as a `card_event` / `org_event` history row, as `0014`
   does.
2. **Remove in two releases ("expand, then contract").** The first release stops using the old
   field but keeps it; the next release drops it, once production shows the data was moved.
3. **Write the `.down.sql`** so the step can be reversed (it copies the data back from the
   archive), and keep `test_migrations.py` passing.
4. **Never edit a migration production has already run**; every change is a new numbered file.
5. **Back up before deploying** (`pg_dump -Fc`), and rehearse on a restored copy whenever existing
   rows change.

## 5. Table reference

Types: `id (26 chars)` is a ULID text key; `timestamp` is `timestamp with time zone`; `→ table`
is a foreign key to that table.

### Production tables (`0013_inbox`, 20 tables): all kept

Every table below is identical in the current version, except `card.priority` (now optional) and
the two rules in section 3.

#### `app_user`

People: name, work email, role (member/admin), status (invited/active/inactive), profile photo.

| Column                 | Type          | Required | Default / key      |
| ---------------------- | ------------- | -------- | ------------------ |
| `id`                   | id (26 chars) | yes      | primary key        |
| `email`                | text          | yes      |                    |
| `name`                 | text          | yes      |                    |
| `role`                 | text          | yes      | default `'member'` |
| `status`               | text          | yes      | default `'active'` |
| `external_id`          | text          | no       |                    |
| `created_at`           | timestamp     | yes      | default `now()`    |
| `updated_at`           | timestamp     | yes      | default `now()`    |
| `name_override`        | boolean       | yes      | default `false`    |
| `photo`                | bytea         | no       |                    |
| `photo_type`           | text          | no       |                    |
| `photo_source`         | text          | no       |                    |
| `photo_updated_at`     | timestamp     | no       |                    |
| `inbox_seen_at`        | timestamp     | no       |                    |
| `invited_at`           | timestamp     | no       |                    |
| `invited_by`           | id (26 chars) | no       | → app_user         |
| `inbox_cleared_before` | timestamp     | no       |                    |

#### `attachment`

Links to files (SharePoint, documents) attached to a card or a project.

| Column       | Type          | Required | Default / key |
| ------------ | ------------- | -------- | ------------- |
| `id`         | id (26 chars) | yes      | primary key   |
| `card_id`    | id (26 chars) | no       | → card        |
| `project_id` | id (26 chars) | no       | → project     |
| `title`      | text          | yes      |               |
| `url`        | text          | yes      |               |
| `kind`       | text          | no       |               |
| `note`       | text          | yes      | default `''`  |
| `added_by`   | id (26 chars) | yes      | → app_user    |
| `added_at`   | timestamp     | yes      |               |

#### `card`

The cards: title, description, private/org plane, state, owner, assignee, priority, tags, ETA, effort, team, project.

| Column         | Type          | Required | Default / key                       |
| -------------- | ------------- | -------- | ----------------------------------- |
| `id`           | id (26 chars) | yes      | primary key                         |
| `number`       | integer       | yes      | default `nextval('card_number_seq'` |
| `title`        | text          | yes      |                                     |
| `description`  | text          | yes      | default `''`                        |
| `plane`        | text          | yes      |                                     |
| `state`        | text          | yes      | default `'backlog'`                 |
| `owner_id`     | id (26 chars) | yes      | → app_user                          |
| `assignee_id`  | id (26 chars) | no       | → app_user                          |
| `priority`     | smallint      | yes      | default `3`                         |
| `tags`         | ARRAY         | yes      | default `'{}'`                      |
| `eta`          | date          | no       |                                     |
| `effort_hours` | numeric       | no       |                                     |
| `closed_at`    | timestamp     | no       |                                     |
| `version`      | integer       | yes      | default `1`                         |
| `created_at`   | timestamp     | yes      | default `now()`                     |
| `updated_at`   | timestamp     | yes      | default `now()`                     |
| `team_id`      | id (26 chars) | no       | → team                              |
| `project_id`   | id (26 chars) | no       | → project (delete cascades)         |

#### `card_comment`

Comments on cards, with replies (`parent_id`).

| Column                | Type          | Required | Default / key  |
| --------------------- | ------------- | -------- | -------------- |
| `id`                  | id (26 chars) | yes      | primary key    |
| `card_id`             | id (26 chars) | yes      | → card         |
| `author_id`           | id (26 chars) | yes      | → app_user     |
| `body`                | text          | yes      |                |
| `created_at`          | timestamp     | yes      |                |
| `edited_at`           | timestamp     | no       |                |
| `copied_from_card_id` | id (26 chars) | no       | → card         |
| `parent_id`           | id (26 chars) | no       | → card_comment |

#### `card_event`

Every change to a card, one row per changed field (old and new value): the card history. Rows are never updated or deleted.

| Column                | Type          | Required | Default / key |
| --------------------- | ------------- | -------- | ------------- |
| `id`                  | id (26 chars) | yes      | primary key   |
| `card_id`             | id (26 chars) | yes      | → card        |
| `group_id`            | id (26 chars) | yes      |               |
| `field`               | text          | yes      |               |
| `old_value`           | jsonb         | no       |               |
| `new_value`           | jsonb         | no       |               |
| `actor_id`            | id (26 chars) | yes      | → app_user    |
| `created_at`          | timestamp     | yes      |               |
| `copied_from_card_id` | id (26 chars) | no       | → card        |

#### `card_link`

Links between cards (blocks / depends on / relates to).

| Column         | Type          | Required | Default / key |
| -------------- | ------------- | -------- | ------------- |
| `id`           | id (26 chars) | yes      | primary key   |
| `from_card_id` | id (26 chars) | yes      | → card        |
| `to_card_id`   | id (26 chars) | yes      | → card        |
| `type`         | text          | yes      |               |
| `created_by`   | id (26 chars) | yes      | → app_user    |
| `created_at`   | timestamp     | yes      |               |

#### `comment_vote`

Up/down votes on comments.

| Column       | Type          | Required | Default / key                                 |
| ------------ | ------------- | -------- | --------------------------------------------- |
| `comment_id` | id (26 chars) | yes      | primary key; → card_comment (delete cascades) |
| `user_id`    | id (26 chars) | yes      | primary key; → app_user                       |
| `value`      | smallint      | yes      |                                               |
| `created_at` | timestamp     | yes      |                                               |

#### `inbox_read`

Which inbox items each person has read.

| Column     | Type          | Required | Default / key                               |
| ---------- | ------------- | -------- | ------------------------------------------- |
| `user_id`  | id (26 chars) | yes      | primary key; → app_user (delete cascades)   |
| `event_id` | id (26 chars) | yes      | primary key; → card_event (delete cascades) |
| `read_at`  | timestamp     | yes      | default `now()`                             |

#### `mail_stub_message`

Development mailbox: emails kept instead of sent when `MAIL_PROVIDER=stub`.

| Column       | Type          | Required | Default / key |
| ------------ | ------------- | -------- | ------------- |
| `id`         | id (26 chars) | yes      | primary key   |
| `to_email`   | text          | yes      |               |
| `subject`    | text          | yes      |               |
| `body`       | text          | yes      |               |
| `created_at` | timestamp     | yes      |               |

#### `notification`

The outbox: emails and Teams messages waiting to be sent, with attempts and the last error.

| Column       | Type          | Required | Default / key |
| ------------ | ------------- | -------- | ------------- |
| `id`         | id (26 chars) | yes      | primary key   |
| `channel`    | text          | yes      |               |
| `target_id`  | id (26 chars) | yes      |               |
| `kind`       | text          | yes      |               |
| `payload`    | jsonb         | yes      |               |
| `created_at` | timestamp     | yes      |               |
| `sent_at`    | timestamp     | no       |               |
| `attempts`   | smallint      | yes      | default `0`   |
| `last_error` | text          | no       |               |

#### `org_event`

History of teams, programs, projects, tags and users (who changed what).

| Column        | Type          | Required | Default / key |
| ------------- | ------------- | -------- | ------------- |
| `id`          | id (26 chars) | yes      | primary key   |
| `entity_type` | text          | yes      |               |
| `entity_id`   | id (26 chars) | yes      |               |
| `group_id`    | id (26 chars) | yes      |               |
| `field`       | text          | yes      |               |
| `old_value`   | jsonb         | no       |               |
| `new_value`   | jsonb         | no       |               |
| `actor_id`    | id (26 chars) | yes      | → app_user    |
| `created_at`  | timestamp     | yes      |               |

#### `program`

Programs, which group projects.

| Column        | Type          | Required | Default / key   |
| ------------- | ------------- | -------- | --------------- |
| `id`          | id (26 chars) | yes      | primary key     |
| `name`        | text          | yes      |                 |
| `description` | text          | yes      | default `''`    |
| `target_date` | date          | no       |                 |
| `created_at`  | timestamp     | yes      | default `now()` |
| `updated_at`  | timestamp     | yes      | default `now()` |

#### `project`

Projects: team, program, target date, open/closed.

| Column        | Type          | Required | Default / key   |
| ------------- | ------------- | -------- | --------------- |
| `id`          | id (26 chars) | yes      | primary key     |
| `name`        | text          | yes      |                 |
| `description` | text          | yes      | default `''`    |
| `team_id`     | id (26 chars) | yes      | → team          |
| `program_id`  | id (26 chars) | no       | → program       |
| `target_date` | date          | no       |                 |
| `created_at`  | timestamp     | yes      | default `now()` |
| `updated_at`  | timestamp     | yes      | default `now()` |
| `accepting`   | boolean       | yes      | default `true`  |
| `closed_at`   | timestamp     | no       |                 |
| `closed_by`   | id (26 chars) | no       | → app_user      |

#### `schema_migration`

Bookkeeping: which database migrations have run (written by the previous version, kept in step by the current one).

| Column       | Type      | Required | Default / key   |
| ------------ | --------- | -------- | --------------- |
| `id`         | text      | yes      | primary key     |
| `applied_at` | timestamp | yes      | default `now()` |

#### `session`

Sign-in sessions (hashed tokens, expiry).

| Column       | Type          | Required | Default / key |
| ------------ | ------------- | -------- | ------------- |
| `id`         | character(64) | yes      | primary key   |
| `user_id`    | id (26 chars) | yes      | → app_user    |
| `created_at` | timestamp     | yes      |               |
| `expires_at` | timestamp     | yes      |               |
| `revoked_at` | timestamp     | no       |               |

#### `tag`

The tag vocabulary.

| Column       | Type          | Required | Default / key   |
| ------------ | ------------- | -------- | --------------- |
| `id`         | id (26 chars) | yes      | primary key     |
| `name`       | text          | yes      |                 |
| `created_at` | timestamp     | yes      | default `now()` |

#### `team`

Teams (and an encrypted Microsoft Teams webhook).

| Column                  | Type          | Required | Default / key   |
| ----------------------- | ------------- | -------- | --------------- |
| `id`                    | id (26 chars) | yes      | primary key     |
| `name`                  | text          | yes      |                 |
| `description`           | text          | yes      | default `''`    |
| `created_at`            | timestamp     | yes      | default `now()` |
| `updated_at`            | timestamp     | yes      | default `now()` |
| `teams_webhook_url_enc` | bytea         | no       |                 |

#### `team_member`

Who is in which team, and who leads it.

| Column     | Type          | Required | Default / key           |
| ---------- | ------------- | -------- | ----------------------- |
| `team_id`  | id (26 chars) | yes      | primary key; → team     |
| `user_id`  | id (26 chars) | yes      | primary key; → app_user |
| `added_at` | timestamp     | yes      |                         |
| `added_by` | id (26 chars) | yes      | → app_user              |
| `is_lead`  | boolean       | yes      | default `false`         |

#### `time_entry`

Hours logged: person, card, date, hours, note.

| Column       | Type          | Required | Default / key |
| ------------ | ------------- | -------- | ------------- |
| `id`         | id (26 chars) | yes      | primary key   |
| `card_id`    | id (26 chars) | yes      | → card        |
| `user_id`    | id (26 chars) | yes      | → app_user    |
| `date`       | date          | yes      |               |
| `hours`      | numeric       | yes      |               |
| `note`       | text          | yes      | default `''`  |
| `created_at` | timestamp     | yes      |               |
| `updated_at` | timestamp     | yes      |               |

#### `user_preference`

Each person's settings: email notifications, default team/project, theme.

| Column               | Type          | Required | Default / key           |
| -------------------- | ------------- | -------- | ----------------------- |
| `user_id`            | id (26 chars) | yes      | primary key; → app_user |
| `theme`              | text          | yes      | default `'system'`      |
| `accent`             | text          | yes      | default `'linen'`       |
| `updated_at`         | timestamp     | yes      | default `now()`         |
| `notify_email`       | boolean       | yes      | default `false`         |
| `primary_team_id`    | id (26 chars) | no       | → team                  |
| `primary_project_id` | id (26 chars) | no       | → project               |
| `org_order`          | text          | yes      | default `'team_first'`  |
| `inbox_window_days`  | integer       | yes      | default `30`            |

### Tables added by the current version

#### `time_week_note`

A person's note for a week (for example why they are short of hours).

| Column       | Type          | Required | Default / key           |
| ------------ | ------------- | -------- | ----------------------- |
| `user_id`    | id (26 chars) | yes      | primary key; → app_user |
| `week_start` | date          | yes      | primary key             |
| `note`       | text          | yes      |                         |
| `updated_at` | timestamp     | yes      |                         |

#### `time_day_off`

Leave and holiday days, which lower that week's target hours.

| Column       | Type          | Required | Default / key           |
| ------------ | ------------- | -------- | ----------------------- |
| `user_id`    | id (26 chars) | yes      | primary key; → app_user |
| `date`       | date          | yes      | primary key             |
| `kind`       | text          | yes      |                         |
| `created_at` | timestamp     | yes      |                         |

#### `time_mail_run`

Which weekly email job (Friday reminder, Monday review) already ran for which week, so none is sent twice.

| Column       | Type      | Required | Default / key |
| ------------ | --------- | -------- | ------------- |
| `job`        | text      | yes      | primary key   |
| `week_start` | date      | yes      | primary key   |
| `ran_at`     | timestamp | yes      |               |

#### `mail_template`

Email wording edited by admins (one row per email kind; no row = the built-in wording).

| Column       | Type          | Required | Default / key |
| ------------ | ------------- | -------- | ------------- |
| `kind`       | text          | yes      | primary key   |
| `subject`    | text          | yes      |               |
| `body`       | text          | yes      |               |
| `updated_at` | timestamp     | yes      |               |
| `updated_by` | id (26 chars) | yes      | → app_user    |

#### `login_issue`

Messages from people who cannot sign in ("Message an admin"), shown under Administration > Login issues; an admin marks each resolved.

| Column        | Type          | Required | Default / key                   |
| ------------- | ------------- | -------- | ------------------------------- |
| `id`          | id (26 chars) | yes      | primary key                     |
| `name`        | text          | yes      |                                 |
| `email`       | text          | yes      |                                 |
| `message`     | text          | yes      |                                 |
| `created_at`  | timestamp     | yes      |                                 |
| `resolved_at` | timestamp     | no       | set together with `resolved_by` |
| `resolved_by` | id (26 chars) | no       | → app_user                      |
