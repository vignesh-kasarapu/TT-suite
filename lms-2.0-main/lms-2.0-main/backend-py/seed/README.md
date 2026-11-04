# LMS seed data

LMS seed data lives here as JSON, not in Python. That way, pushing the code can never bring demo data along with it. `app/core/seed_data.py` is the only code that reads this folder. Set `LMS_SEED_DIR` to use a different folder.

| File | Tracked | Deployed | What it is |
|---|---|---|---|
| `reference.json` | yes | **yes, required** | Environment-neutral data LMS can't work without: <ul><li>roles</li><li>management levels</li><li>the first leave year</li><li>`config_defaults`</li><li>the notification templates</li></ul> **No leave type at all** — not the company's, and not LOP or COMP_OFF. |
| `company-policy.json` | **no, gitignored** | **never** | One company's leave policy: its leave types, entitlements, shared pools and the system types it wants. Applied only by `python -m scripts.seed_company_policy --confirm`, never at boot. |
| `company-policy.example.json` | yes | yes (harmless) | The shape of `company-policy.json`, with example figures. |
| `demo.json` | **no, gitignored** | **never** | The local demo organisation, used by `scripts.seed_employees` and `scripts.seed_demo`. |
| `demo.example.json` | yes | yes (harmless) | The shape of `demo.json`, with placeholder rows. |
| `holidays.example.json` | yes | yes (harmless) | The shape of a published holiday calendar. |
| `*.local.json` | **no, gitignored** | **never** | Any other local-only file. |

## Leave types are never seeded

A fresh database comes up with an **empty** Leave types screen, and an administrator creates
what the company actually uses. Nothing in the application, in a migration, in a deployment
script or at boot creates a leave type — the only two ways one appears are
**Administration → Leave types & policy** and:

```bash
cp seed/company-policy.example.json seed/company-policy.json   # then edit the numbers
python -m scripts.seed_company_policy                          # dry run: prints what it would do
python -m scripts.seed_company_policy --confirm                # applies it
```

Two codes are reserved by the application: `LOP`, which the automatic loss-of-pay conversion
posts to, and `COMP_OFF`, which the compensatory-off workflow credits. Neither is created for
you; without them those two features simply do nothing and say so.

## Reference data (`reference.json`)

- **When it's applied:** automatically on a fresh `lms` schema (`app/core/bootstrap_db.py` → `scripts.seed`), or by hand with `python -m scripts.seed`.
- **It never overwrites anything.** Every row is find-or-create, and `config_defaults` are written only when the key isn't set yet. After that, the database is the source of truth: HR changes settings in the app.
- **If the file is missing, the boot fails** with the path it expected, instead of half-seeding the database.

**To change a default for new databases,** edit this file. An existing database keeps the values it already has.

## Demo data (`demo.json`, local only)

Run from `backend-py`:

```bash
cp seed/demo.example.json seed/demo.json      # then fill it in; a full demo needs EMP001-EMP010 and reason keys 01-47
python -m scripts.seed                        # reference data
python -m scripts.seed_employees              # demo people
python -m scripts.seed_demo                   # demo org: holidays, requests, delegations...
```

**Both demo scripts refuse to run before touching anything** in two cases:
- under `APP_PROFILE=prod`
- when `seed/demo.json` is missing, which is always the case on a fresh clone, in the Docker image and in the `dist-suite` package

`demo.json` and `company-policy.json` are ignored by git, by both `.dockerignore` files, and by
`deploy/build.mjs` (which packages `reference.json` and the `*.example.json` templates and
nothing else), so a local copy can't reach a deploy.

## A real holiday calendar

`holidays.example.json` shows the shape of an organisation's published calendar:
- exact dates
- optional or not
- region code (`null` = every region)

HR enters the real calendar in **Administration → Holidays**. Nothing here loads holidays into a live database.
