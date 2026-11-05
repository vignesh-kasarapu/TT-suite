# Runbook: merge the old Kanban into the TT Suite database (Azure)

Moves the old standalone Kanban data (124 cards, dump of 27 Oct) into the TT Suite production
database. The Kanban work already in the TT Suite is kept. It takes about 15 minutes, including about 5 minutes of
downtime for the TT Suite App Service.

All three files are **plain SQL**. Open each one in your query tool (pgAdmin, Azure Data Studio,
DBeaver…) and press **Run**. `psql -f <file>` works too.

## Files
| File | What it is |
|---|---|
| `kanban_old-load.sql` | The old Kanban data, which it loads as a separate schema `kanban_old`. **Contains personal data: handle as confidential.** |
| `kanban-merge-dry-run.sql` | The merge, then `ROLLBACK`: shows the report and **saves nothing**. |
| `kanban-merge.sql` | The merge, then `COMMIT`. It runs in one transaction and refuses to run twice. |

## Before you start
- Connect the query tool to the **TT Suite database** with the **owner login** (the user in the App Service setting `DATABASE_OWNER_URL`), using SSL.
- Use the same query tool tab for all steps.
- The **report is printed in the Messages tab** (as `NOTICE` lines), not in the results grid.

## Steps
**1. Back up the TT Suite database.** Azure portal → PostgreSQL server → *Backups* → **Backup now**.

**2. Run `kanban_old-load.sql`.**
Expected: it completes without errors. It only creates the schema `kanban_old`; nothing in the TT Suite changes yet.

**3. Stop the TT Suite App Service** (Azure portal → App Service → **Stop**).

**4. Run `kanban-merge-dry-run.sql`.** Copy the **Messages** tab and send it to the TT Suite team. Expected:
```
people      : old 19, matched existing …, added …
cards       : old 124, matched existing 0, added 124
card events : old 702, matched existing 0, added 702
comments    : old 22, matched existing 0, added 22
…
DRY RUN: nothing will be saved
```
In every row, `matched existing + added` must equal `old`.

**5. Run `kanban-merge.sql`**, once the dry run has been approved. You'll see the same report. Send the Messages tab output to the TT Suite team.

**6. Start the TT Suite App Service.**

**7. Clean up,** after the TT Suite team confirms the boards look right:
```sql
DROP SCHEMA kanban_old CASCADE;
```
Then securely delete your copies of `kanban_old-load.sql`.

## If something goes wrong
- **An error in steps 2, 4 or 5:** nothing is saved, because each file runs in one transaction. Start the App Service again and send the error text.
- **Problems found after step 5:** restore the backup from step 1.
- **Running step 5 twice is safe:** the second run stops with `The old Kanban was already merged` and changes nothing.
