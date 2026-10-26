# Multi-stage build; build context = repo root (`docker build -f Solution/Dockerfile .`).
# Node builds the frontend only; the runtime is the FastAPI backend on Python (D-109, M5).
# Base images pinned by digest: node:24-bookworm-slim (stage 05), python:3.13-slim-bookworm (M5).
FROM node@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS frontend
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY Solution/frontend/package.json Solution/frontend/package.json
COPY Solution/tests/package.json Solution/tests/package.json
RUN npm ci -w Solution/frontend
COPY tsconfig.base.json ./
COPY Solution/frontend Solution/frontend
RUN npm run build -w Solution/frontend

FROM python@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641 AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 BIND_HOST=0.0.0.0
WORKDIR /app/Solution/backend-py
COPY Solution/backend-py/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY Solution/backend-py/alembic.ini ./
COPY Solution/backend-py/alembic ./alembic
COPY Solution/backend-py/app ./app
COPY --from=frontend /app/Solution/frontend/dist /app/Solution/frontend/dist
RUN useradd --system --uid 10001 app
USER app
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/v1/health').status == 200 else 1)"
CMD ["python", "-m", "app"]
