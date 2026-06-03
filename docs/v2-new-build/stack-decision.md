# Veel V2 Stack Decision

Status: proposed v2 architecture
Scope: platform stack
Last updated: 2026-06-03
Source of truth: proposal

## Recommended Stack

```text
Web:        Next.js PWA, TypeScript, Tailwind v4, TanStack Query, Zustand
API:        Fastify TypeScript
DB/Auth:    Supabase Postgres + Supabase Auth
Realtime:   Supabase Realtime, selectively
Workers:    TypeScript worker runtime with pg-boss launch default; BullMQ/Redis only when measured scale requires it
Contracts:  OpenAPI generated from schemas
Payments:   Solana JS + Solana Pay
Wallets:    Embedded wallet provider + Solana wallet adapter
Media:      Bunny Stream VOD, Livepeer live/replay
PM:         pnpm workspaces
Runtime:    Node.js LTS first; Bun evaluated later
Deploy:     Docker first; serverless/edge only for proven slices
```

Wallet onboarding uses a provider-first embedded wallet integration for mainstream email/social/passkey users and the Solana wallet adapter for Phantom/Solflare/external wallets. The embedded wallet provider must be noncustodial/user-controlled; it must not create a Veel-controlled custodial balance.

## Official Documentation Checked

- Fastify validation and serialization: `https://fastify.dev/docs/v5.7.x/Reference/Validation-and-Serialization/`
- NestJS Fastify adapter/performance: `https://docs.nestjs.com/techniques/performance`
- Hono runtimes and Cloudflare Workers guide: `https://hono.dev/docs/`, `https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/`
- Supabase architecture, RLS, Realtime authorization: `https://supabase.com/docs/architecture`, `https://supabase.com/docs/guides/database/postgres/row-level-security`, `https://supabase.com/docs/guides/realtime/authorization`
- Solana Pay specification and transaction requests: `https://docs.solanapay.com/`, `https://solana.com/tr/docs/tools/solana-pay/specification/version1-1`
- Embedded wallet providers to evaluate: `https://docs.privy.io/`, `https://www.dynamic.xyz/docs/wallets/mpc/overview`, `https://docs.turnkey.com/embedded-wallets`
- Onramp providers to evaluate: `https://docs.cdp.coinbase.com/onramp/docs/welcome`, MoonPay/Helio docs if selected
- Bunny Stream TUS: `https://docs.bunny.net/stream/tus-resumable-uploads`
- Livepeer stream creation/playback policy: `https://docs.livepeer.org/v1/api-reference/stream/create`
- Next.js App Router and env docs: `https://nextjs.org/docs/app`, `https://nextjs.org/docs/pages/guides/environment-variables`
- Bun package manager/workspaces/Node compatibility: `https://bun.com/docs`, `https://bun.sh/docs/install/workspaces`, `https://bun.sh/docs/runtime/nodejs-compat`
- pnpm workspaces: `https://pnpm.io/workspaces`

## Fastify vs NestJS

| Requirement | Fastify | NestJS with Fastify adapter | Recommendation |
| --- | --- | --- | --- |
| Provider SDK ergonomics | Direct TypeScript modules | Good, but behind Nest patterns | Fastify |
| Schema-first OpenAPI | Native fit with JSON Schema/Zod adapters | Possible with decorators | Fastify |
| Team discipline | Requires local conventions | Built-in module/controller/service structure | Tie |
| Boilerplate | Low | Higher | Fastify |
| Enterprise guardrails | Must be documented/enforced | Stronger by default | NestJS |
| Performance/overhead | Excellent | Good, adds abstraction | Fastify |
| Learning curve | Lower if team knows Node | Higher | Fastify |

Decision: **Fastify**, with enforced project conventions.

If a future team grows large and needs stronger framework-level DI, NestJS can be reconsidered. Do not start with NestJS only because it feels enterprise; enterprise quality must come from boundaries, contracts, tests, and operations.

## Fastify Required Conventions

```text
apps/api/src/
  app.ts
  server.ts
  plugins/
    auth.ts
    database.ts
    logger.ts
    openapi.ts
    rate-limit.ts
  modules/
    auth/
    users/
    content/
    media/
    payments/
    referrals/
    live/
    messages/
    safety/
    admin/
  workers/
  shared/
    schemas/
    policies/
    errors/
    audit/
    idempotency/
```

Every module must have:

- `routes.ts`
- `schemas.ts`
- `service.ts`
- `repository.ts`
- `policy.ts`
- `events.ts` if needed
- tests

Controllers/routes remain thin:

```text
authenticate -> validate -> authorize -> service/action -> resource/response
```

## Supabase Decision

Use Supabase for:

- Postgres
- Auth
- JWT/session issuance
- RLS enforcement for client-visible realtime rows
- Realtime Broadcast/Presence/Postgres Changes where safe

Do not use Supabase to bypass backend policy.

Service-role key is backend-only. Frontend only uses anon/public key and user JWT under RLS.

## Serverless Decision

Do not make the entire backend serverless by default.

Use Dockerized Fastify first because Veel needs:

- long-running worker jobs
- provider webhook retries
- payment reconciliation
- media processing orchestration
- audit consistency
- simple staging/prod parity

Use edge/serverless later only for isolated stateless endpoints. A full serverless conversion is not a launch requirement.

## Bun vs pnpm Decision

Decision: **keep pnpm as the package manager/workspace tool for v2 launch; use Node.js LTS as the production runtime; evaluate Bun later.**

Why not switch to Bun now:

- pnpm is already the current workspace tool and is widely supported by monorepo tooling, CI, package managers, lockfile review, and Node-focused provider SDK docs.
- The v2 rebuild already changes backend framework, auth, realtime, and database. Changing package manager and runtime at the same time increases migration risk.
- Bun is promising and officially supports workspaces and broad Node compatibility, but payment/media/provider SDK stability matters more than install speed during the rebuild.
- Enterprise launch value comes from contracts, tests, provider boundaries, observability, and deployment discipline, not from package manager novelty.

Where Bun can help:

- optional local script runner benchmarking
- isolated worker/microservice proof-of-concept
- CI install benchmark after v2 dependency graph is stable
- test runner evaluation only after Jest/Vitest/Playwright compatibility is proven

Do not use Bun as the production runtime for money/access/media until:

- Solana, Supabase, Bunny, Livepeer, OpenTelemetry, worker queue, and test tooling compatibility is proven in staging
- Docker images are stable
- memory/latency behavior is observed under load
- rollback to Node is documented

Recommended v2 default:

```text
package manager: pnpm
runtime:         Node.js LTS
dev optional:    Bun experiments only in isolated scripts/services
```

## Frontend Decision

Keep Next.js PWA. Rebuild or heavily refactor:

- app shell
- Home media cards
- media viewer
- live room
- create flow
- messages
- profile

Preserve:

- TypeScript
- TanStack Query
- Zustand/local UI state
- Tailwind tokens
- Playwright
- API contract generation

## Final Recommendation

Build v2 in a clean `veel-v2` repo:

```text
apps/api
apps/web
apps/worker
packages/contracts
```

Keep the current repository available as a reference until parity is proven. Do not bulk-copy current `apps/api` or `apps/web` implementation code into v2.
