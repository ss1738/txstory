# TxStory: read-only transaction explainer.
# Build:  docker build -t txstory .
# Run:    docker run --rm -p 8787:8787 txstory
# Nothing here publishes or deploys; see DEPLOYMENT.md.
# The build context is an allowlist (.dockerignore): no study data, tests or .env files.

FROM node:22.19.0-alpine3.22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM node:22.19.0-alpine3.22 AS runtime
ENV NODE_ENV=production \
    TXSTORY_HOST=0.0.0.0 \
    TXSTORY_PORT=8787 \
    TXSTORY_STATIC_DIR=/app/dist/client \
    TXSTORY_FIXTURES_DIR=/app/fixtures/synthetic,/app/fixtures/devnet \
    TXSTORY_LOG_REQUESTS=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY fixtures/synthetic ./fixtures/synthetic
COPY fixtures/devnet ./fixtures/devnet
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
USER node
EXPOSE 8787
# SIGTERM → drain: health turns 503, in-flight requests get TXSTORY_SHUTDOWN_GRACE_MS (default 8 s).
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/node/server/index.js"]
