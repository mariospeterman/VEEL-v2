# Veel Deploy Skeleton

Status: staging skeleton, not production-active until environment secrets and provider staging smoke are configured.

## Services

- `web`: Next.js PWA, CDN/Node runtime.
- `api`: Fastify API, backend truth for authz, money, access, admin, safety, providers, and compliance state.
- `worker`: TypeScript worker for retries, subscription collection ticks, notification delivery, and provider-event replay.
- `database`: Supabase Postgres/Auth/Realtime. Migrations run through the database workflow or Supabase CLI/MCP, never from browser code.

## Required Runtime Settings

Public web settings:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Server-only settings:

- `API_URL`
- `WEB_URL`
- `DATABASE_URL`
- `API_RATE_LIMIT_STORE_DRIVER=redis`
- `API_RATE_LIMIT_REDIS_URL` from the deployment secret store; the production entrypoint has no generic external-store injection path
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` during legacy compatibility
- `PAYMENT_PLATFORM_TREASURY_WALLET`
- provider keys and webhook secrets listed in `.env.example`

Deploy gate settings:

- `DEPLOY_ENABLED=true` only after a real staging or production target exists.
- `API_HEALTH_URL=https://.../healthz`
- `API_READY_URL=https://.../readyz`

## Pipeline Shape

1. Build packages with `pnpm -r --if-present build`.
2. Run `pnpm database:check` before migrations or release promotion.
3. Run provider-mock smoke in CI and provider-staging smoke before production promotion.
4. Run `pnpm deploy:check`.
5. Deploy immutable artifacts using the hosting platform's OIDC integration.
6. Verify `/healthz` and `/readyz`.
7. Keep rollback instructions attached to every release.

## Guardrails

- Do not put provider secrets, service-role keys, signed media URLs, stream keys, raw PII, or webhook payload dumps in workflow logs.
- Do not activate production deploys without artifact digest pinning, backup/snapshot confirmation, readiness checks, smoke tests, and rollback instructions.
- Do not run payment settlement, entitlement grants, admin mutations, or compliance reporting in frontend or edge-only code.
