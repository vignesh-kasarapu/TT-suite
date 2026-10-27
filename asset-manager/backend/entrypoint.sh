#!/bin/sh
set -e

echo "Running Alembic migrations..."
alembic upgrade head

echo "Verifying seed data..."
python -m app.common.seed

echo "Starting FastAPI server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
