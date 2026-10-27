# The whole TT Suite in one image: portal (sign-in, dashboard, global admin, gateway) + Kanban,
# LMS, EMS and Asset Management, as five processes started by deploy/run.py. It is the same
# dist-suite package that Azure runs (deploy/build.mjs), so a container behaves like production.
#
#   docker compose up --build          the suite and its PostgreSQL (docker-compose.yml)
#   docker build -t tt-suite .         this image only (point DATABASE_URL at your own database)

# ---- Stage 1: build the five frontends and assemble dist-suite/ --------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /src

# Package manifests first, so `npm ci` is cached until a lockfile changes.
COPY portal/frontend/package.json portal/frontend/package-lock.json portal/frontend/
COPY Kanban-internal-main/package.json Kanban-internal-main/package-lock.json Kanban-internal-main/.npmrc Kanban-internal-main/
COPY Kanban-internal-main/Solution/frontend/package.json Kanban-internal-main/Solution/frontend/
COPY Kanban-internal-main/Solution/tests/package.json Kanban-internal-main/Solution/tests/
COPY lms-2.0-main/lms-2.0-main/frontend/package.json lms-2.0-main/lms-2.0-main/frontend/package-lock.json lms-2.0-main/lms-2.0-main/frontend/
COPY ems/frontend/package.json ems/frontend/package-lock.json ems/frontend/
COPY asset-manager/frontend/package.json asset-manager/frontend/package-lock.json asset-manager/frontend/
RUN for dir in portal/frontend Kanban-internal-main lms-2.0-main/lms-2.0-main/frontend ems/frontend asset-manager/frontend; do \
      (cd "$dir" && npm ci --no-audit --no-fund) || exit 1; \
    done

COPY . .
RUN node deploy/build.mjs --skip-install

# ---- Stage 2: the runtime ----------------------------------------------------------------------
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# Requirements first (cached until they change); suite_core is installed from the package.
COPY --from=build /src/dist-suite/requirements.txt ./
COPY --from=build /src/dist-suite/packages ./packages
RUN pip install -r requirements.txt

COPY --from=build /src/dist-suite/ ./
# The seed people (SEED_FILE=deploy/seed.json) for a fresh database; not used unless set.
COPY deploy/seed.json deploy/seed.json

# Uploaded files (LMS documents, EMS receipts) live on a volume, never in the image.
RUN useradd --system --create-home --uid 10001 suite \
 && mkdir -p /data/lms /data/expense/uploads \
 && chown -R suite:suite /data /app
USER suite
ENV PORT=8000 \
    SUITE_ENV_FILE=none \
    STORAGE_DIR=/data/lms \
    UPLOAD_DIR=/data/expense/uploads
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

# run.py migrates every schema, starts the five processes, restarts any that stop and stops them
# all on SIGTERM (docker stop).
CMD ["python", "deploy/run.py"]
