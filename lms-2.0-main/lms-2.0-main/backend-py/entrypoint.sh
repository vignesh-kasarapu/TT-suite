#!/bin/sh
# Bootstraps schema `lms` (create schema, `alembic upgrade head`, grants, seed of a
# fresh schema) BEFORE Uvicorn starts — not inside a FastAPI startup event, since
# several workers would race on the migration. `python -m app` does both steps; see
# app/__main__.py and app/core/bootstrap_db.py. HOST/PORT come from the environment.
set -e
exec python -m app
