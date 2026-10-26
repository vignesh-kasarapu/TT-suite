# tests

Test code only — no business logic.

- `unit/` — Vitest, offline (calendar/DWD engine, state machine, `t()`, CSV/iCal writers — land as those modules do).
- Backend tests (unit, integration, security, migrations) are pytest, in `Solution/backend-py/tests/` (D-109).
- `api/` — Spectral lint config + Ajv 2020 response-assertion helpers for contract conformance.
- `e2e/` — Playwright specs at desktop/tablet/mobile viewports + engine smoke (`@smoke`).

## Fixture data (B02+)

`npm run db:seed:dev` (`Solution/tests/fixtures/seed-dev.ts`) seeds the deterministic fixture
people listed in that file into `DATABASE_URL` (default
`app_rw@localhost:5432/app`); idempotent — it resets passwords (`Fixture-Pass-2026!`), lockouts and
must-change flags. Sub-commands: `npm run db:seed:dev -- reset E3` (one person's credential),
`npm run db:seed:dev -- failed-outbox` (an operational-error fixture for the Operations panel).
`scripts/e2e.mjs` runs the seed after `compose up`; E2E specs call the sub-commands between
viewport runs that change fixture state (`Solution/tests/e2e/specs/_fixtures/users.ts`).
