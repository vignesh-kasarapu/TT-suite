#!/bin/sh
# Azure App Service (Linux, Python) startup command: `sh startup.sh`
# App Service activates the Oryx-built virtualenv before running this script.
set -e

echo "Running Alembic migrations..."
python -m alembic upgrade head

echo "Verifying seed data..."
python -m app.common.seed

echo "Starting FastAPI server on port ${PORT:-8000}..."
exec gunicorn app.main:app \
  --worker-class uvicorn.workers.UvicornWorker \
  --workers "${WEB_CONCURRENCY:-2}" \
  --bind "0.0.0.0:${PORT:-8000}" \
  --timeout 120 \
  --forwarded-allow-ips="*" \
  --access-logfile - \
  --error-logfile -
