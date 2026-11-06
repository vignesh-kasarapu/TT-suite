# LMS deployment handover: no seeded leave types, and the approved balance reset

Written for whoever deploys TT Suite to Azure. It covers two changes that alter what a
deployment does to the database, and the exact order to carry them out.

## What changed, in one paragraph

A deployment no longer creates any leave type. A fresh database comes up with an empty
**Leave types & policy** screen, and an authorised administrator creates the company's leave
types there. Separately, HR has decided that the leave balances carried over from the old
entitlement system are discontinued: a script takes every active balance to zero, keeps all
history, and an administrator then grants each person their approved opening balance. The
script never runs by itself — not at startup, not during deployment.

## Before you start

1. **Take a backup of the production database and verify that it restores.** The reset
   script will not write anything without `--backup-verified`, and the backup is the primary
   recovery path if HR changes their mind after the fact.
2. **Set `APP_PROFILE=prod`** in the App Service configuration. Several guards key off it,
   including the reset script's production check (which treats an unset profile as
   production, so you are safe either way — but set it).
3. Decide, with HR, who the administrator is. They will create the leave types and post the
   opening balances.

## Step 1 — deploy the build

Nothing special. On first start the application:

- runs its migrations (a database restored from `deploy/sql/azure-full-schema.sql` is
  stamped at `0005_advance_lop`, so it will apply `0006`, `0007` and `0008` on boot);
- seeds roles, management levels, the first leave year, configuration defaults and
  notification templates;
- **creates no leave type** — not the company's, and not Loss of Pay or Compensatory Off.

You can confirm it with:

```sql
SELECT count(*) FROM lms.leave_types;   -- expect 0 on a fresh database
```

## Step 2 — the administrator creates the leave types

In **Administration → Leave types & policy**. Two codes are reserved by the application and
worth creating deliberately if the company wants those features:

| Code | What it is for | If it does not exist |
|---|---|---|
| `LOP` | The automatic loss-of-pay conversion posts unwithdrawn rejected advance leave to it. | The nightly sweep does nothing and records why. No error. |
| `COMP_OFF` | The compensatory-off workflow credits it. | The Comp-off screen says an administrator has to set it up; a claim is refused with the same message. |

Sick and Casual sharing one entitlement is set up in **Administration → Shared
entitlements**: create the pool with its days, tick both types, and the two draw on the same
balance while staying separately selectable.

If you prefer to load a prepared policy instead of typing it in, copy
`backend-py/seed/company-policy.example.json` to `seed/company-policy.json` on the machine
running the application, edit the numbers, and run:

```bash
python -m scripts.seed_company_policy                 # dry run: prints what it would do
python -m scripts.seed_company_policy --confirm       # applies it
```

That file is gitignored and is never packaged, and the script is a dry run until `--confirm`.
It is the only bulk path that grants entitlement to people who are already employed, which is
why it is a deliberate command rather than part of a deployment.

## Step 3a — a fresh start on balances (what HR asked for)

Nothing of the old leave arithmetic is kept: the monthly accruals, the opening pro-rata
credits and the revision adjustments all go, and everybody is granted exactly what today's
policy says. Two steps, in this order, after the backup.

**Clear the balance history** — in pgAdmin or psql, as the owner:

```
deploy/sql/lms-reset-balances.sql        # edit line 1 to 'yes' to arm it
```

It empties the ledger, leave requests and their approvals and attachments, LOP records,
comp-off claims, encashments, restrictions, final settlements, watchers and notifications.
It does **not** touch leave types, policies, pools, holidays, employees, roles, leave years,
settings or templates.

**Grant today's policy** — from the application directory (`apps/lms`):

```bash
python -m scripts.grant_entitlements                       # dry run: who gets what
python -m scripts.grant_entitlements --confirm --allow-production     --reason "Fresh initialisation"
```

Each person is granted only the types they may actually use: one HR has excluded for them is
skipped, and so is one their profile makes them ineligible for — a man is never granted
Maternity. Running it again grants nothing twice; it only tops up somebody who has since
become eligible, or a leave type created later.

## Step 3b — the balance reset that keeps history (the alternative)

Run from the application directory (`apps/lms` in the deployed package):

```bash
# 1. The report. Writes nothing. Send the CSV to HR.
python -m scripts.reset_balances --csv reset-report.csv

# 2. After HR approves the report:
python -m scripts.reset_balances --confirm --backup-verified --allow-production \
    --reason "HR decision: existing leave balances discontinued" \
    --close-past-years
```

What it does:

- takes every active balance in the **current** leave year to zero — company leave types,
  shared pools and compensatory off;
- posts one compensating `BALANCE_RESET_ADJUSTMENT` per employee and leave type. Nothing is
  deleted: the old grants, accrual rows, adjustments, comp-off claims, leave requests and the
  audit log all stay exactly where they are;
- writes an audit entry per employee with the previous balance, the reason and the
  administrator;
- is idempotent — running it twice posts nothing the second time;
- `--close-past-years` marks leave years that have already ended as closed, so the old
  period stays readable as history and nothing can post into it.

If HR changes their mind:

```bash
python -m scripts.reset_balances --rollback --confirm --backup-verified --allow-production
```

That posts the exact inverse of every reset entry and restores the balances. Restoring the
database backup remains the other option.

## Step 4 — opening balances

In **Administration → Opening balances**: pick one employee, a department or everyone, pick
the leave type or shared pool, enter the approved figure, give a reason, and **Preview the
change** before applying it. The preview shows what each person holds today and what the
adjustment would be; nothing is written until it is applied, and each change is an audited
ledger entry.

From that point on:

- **existing employees** hold exactly what the administrator granted them;
- **new employees** receive the full configured entitlement automatically when they are
  onboarded — no proration by joining date, no monthly accrual, no waiting for a job;
- **creating, editing or restoring a leave type credits nobody.** It changes what new joiners
  are granted and what HR posts from; people who are already employed move only through the
  opening-balance workflow.

## Checks after the reset

```sql
-- every active employee at zero for the current leave year
SELECT u.employee_code, COALESCE(SUM(l.quantity), 0) AS balance
FROM lms.users u
LEFT JOIN lms.leave_ledger l ON l.employee_id = u.user_id
 AND l.leave_year_id = (SELECT leave_year_id FROM lms.leave_years WHERE is_current)
WHERE u.is_active
GROUP BY u.employee_code
ORDER BY 2 DESC;

-- history is intact: the old entries are still there
SELECT entry_type, count(*) FROM lms.leave_ledger GROUP BY 1 ORDER BY 2 DESC;
```

In the application, confirm that: a dashboard shows zero available and still lists the leave
types; My Requests and the reports still show past leave; an opening balance posted for one
person appears on their dashboard immediately; and a newly onboarded person receives the full
entitlement.

## What is deliberately not automated

- No leave type is created by a migration, a deployment script or application startup.
- The reset is never triggered by a deployment or by the scheduler.
- No demo employee, sample balance or company-specific policy file is packaged: the build
  carries `seed/reference.json` and the `*.example.json` templates and nothing else.
