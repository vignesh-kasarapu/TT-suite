# db

Compose-only local bootstrap (`docker-entrypoint-initdb.d`). Creates the `app_owner` /
`app_rw` roles and the `app_template` database (D-076). No business logic — local dev
bootstrap only. Not used by the Azure deployment (that's `infra/deploy.ps1`, step 6).
