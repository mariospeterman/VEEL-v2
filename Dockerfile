# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22.16.0
ARG PNPM_VERSION=10.0.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ARG RELEASE_SOURCE_SHA=unknown
ARG RELEASE_VERSION=0.0.0-unreleased
LABEL org.opencontainers.image.source="https://github.com/mariospeterman/VEEL-v2" \
      org.opencontainers.image.revision="${RELEASE_SOURCE_SHA}" \
      org.opencontainers.image.version="${RELEASE_VERSION}"
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS dependencies
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/test-factories/package.json packages/test-factories/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=2560
# pnpm 10 injects the API package before source is copied into this stage.
# Refresh that exact snapshot for worker type resolution and deployment.
RUN cp -R apps/api/src apps/worker/node_modules/@veel/api/src
RUN pnpm -r --workspace-concurrency=1 --if-present build
RUN cp -R apps/api/dist apps/worker/node_modules/@veel/api/dist
RUN pnpm --filter @veel/api deploy --prod /release/api
RUN pnpm --filter @veel/worker deploy --prod /release/worker
RUN node scripts/finalize-deploy-package.mjs /release/api
RUN node scripts/finalize-deploy-package.mjs /release/worker

FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/runtime-config.js').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

FROM node:${NODE_VERSION}-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /release/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

FROM node:${NODE_VERSION}-bookworm-slim AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /release/worker ./
USER node
CMD ["node", "dist/index.js"]
