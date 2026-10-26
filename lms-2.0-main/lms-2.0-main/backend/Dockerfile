# Build context is the repo root (see docker-compose.yml) so this stage can
# recreate the same backend/src/../../../storage/attachments layout the app
# already assumes on disk in local dev — no application code changes needed.
FROM node:20-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev

COPY backend/src ./backend/src

RUN mkdir -p /app/storage/attachments

WORKDIR /app/backend
ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/api/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
