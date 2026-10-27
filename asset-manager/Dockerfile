# Production image: React SPA built with Vite, served by FastAPI (gunicorn) from the same origin.
# Build:  docker build -t ams-app:latest .
# Run:    see deploy/docker-compose.yml (local development still uses the root docker-compose.yml).

# ---- Stage 1: build frontend ----
FROM node:20-alpine AS frontend-build

WORKDIR /frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend runtime ----
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    STATIC_DIR=/app/static \
    PORT=8000

COPY backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-build /frontend/dist /app/static

RUN sed -i 's/\r$//' /app/startup.sh && \
    useradd --create-home --uid 10001 appuser && chown -R appuser /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["sh", "/app/startup.sh"]
