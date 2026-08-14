# WeVid V2 Stack Decision

Status: accepted
Scope: platform stack
Last updated: 2026-08-14
Source of truth: yes

Owns:
- stack decision decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

## Recommended Stack

```text
Web:        Next.js PWA, TypeScript, Tailwind v4, TanStack Query, Zustand
API:        Fastify TypeScript
DB/Auth:    Supabase Postgres/RLS + optional Supabase Auth recovery linking
Realtime:   Supabase Realtime, selectively
Workers:    TypeScript worker runtime with pg-boss launch default; BullMQ/Redis only when measured scale requires it
Contracts:  OpenAPI generated from schemas
Payments:   Solana JS + Solana Pay; Solana Subscriptions/Allowances after staging approval
Wallets:    Privy embedded Solana wallet + intentional Solana Wallet Standard adapters
Media:      Bunny Stream VOD, Livepeer live/replay
PM:         pnpm workspaces
Runtime:    Node.js LTS first; Bun evaluated later
Deploy:     Docker first; serverless/edge only for proven slices
```

Wallet onboarding uses Privy for mainstream email/social/passkey users and the existing Solana Wallet Standard/wallet-adapter boundary for intentional external wallets. Both paths sign the same WeVid backend challenge and converge on one application-session authority. The embedded wallet mode must be noncustodial/user-controlled and must not create a WeVid-controlled balance. Turnkey is an unbundled fallback only.

## Official Documentation Checked

- Fastify validation and serialization: `https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/`
- NestJS Fastify adapter/performance: `https://docs.nestjs.com/techniques/performance`
- Hono runtimes and Cloudflare Workers guide: `https://hono.dev/docs/`, `https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/`
- Supabase architecture, RLS, Realtime authorization: `https://supabase.com/docs/architecture`, `https://supabase.com/docs/guides/database/postgres/row-level-security`, `https://supabase.com/docs/guides/realtime/authorization`
- Solana Pay specification and transaction requests: `https://docs.solanapay.com/`, `https://solana.com/docs/tools/solana-pay/quickstart/transaction-requests`
- Solana Subscriptions and Allowances: `https://solana.com/docs/payments/subscriptions/overview`, `https://solana.com/docs/payments/subscriptions/fixed-delegation`, `https://solana.com/docs/payments/subscriptions/recurring-delegation`, `https://solana.com/docs/payments/subscriptions/subscription-plan`
- Embedded wallet providers to evaluate: `https://docs.privy.io/`, `https://www.dynamic.xyz/docs/wallets/mpc/overview`, `https://docs.turnkey.com/embedded-wallets`
- Wallet funding/onramp paths to evaluate only for funding user-controlled wallets: `https://docs.cdp.coinbase.com/onramp/docs/welcome`
- Bunny Stream TUS: `https://docs.bunny.net/stream/tus-resumable-uploads`
- Livepeer stream creation/playback policy: `Livepeer stream create API reference at docs.livepeer.org`
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
- optional recovery/account-link identity for users who benefit from it, primarily external-wallet-only users
- RLS enforcement for client-visible realtime rows
- Realtime Broadcast/Presence/Postgres Changes where safe

Do not use Supabase to bypass backend policy.

The backend-issued WeVid application session is canonical after either wallet path. Supabase recovery must link to the existing WeVid user through a short-lived, audited backend intent, reject collisions, and never create a second profile or embedded wallet. Service-role/secret keys are backend-only. Frontend only uses publishable keys and scoped user sessions under RLS.

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

## Node 22 / pnpm 10 Decision

Decision: **pin CI and the launch build to Node.js 22.16.0 and pnpm 10.0.0.**

Why Node 22 instead of the newest current runtime:

- Node.js production guidance favors Active LTS or Maintenance LTS lines for production systems.
- Provider SDK compatibility matters more than runtime novelty for payments, wallets, media, realtime, workers, and observability.
- Node 22 gives a stable LTS baseline while still supporting modern TypeScript, Web Crypto, fetch, and current framework tooling.
- Newer Node majors can be evaluated after provider SDKs, Docker images, OpenTelemetry, Playwright, and CI are proven green.

Why pnpm 10:

- pnpm 10 gives a current stable workspace tool with deterministic lockfiles and strong monorepo support.
- It avoids changing package-manager strategy while the backend, auth, realtime, and provider architecture are also changing.
- Upgrading pnpm later is a small controlled ADR/checklist, unlike changing runtime and provider SDK assumptions mid-build.

Use the committed `.node-version` and `.nvmrc` files, then run `corepack enable` and `corepack prepare pnpm@10.0.0 --activate` in local/CI setup so agents do not accidentally use host-global pnpm versions.

## Bun vs pnpm Decision

Decision: **keep pnpm as the package manager/workspace tool for v2 launch; use Node.js LTS as the production runtime; evaluate Bun later.**

Why not switch to Bun now:

- pnpm is already the current workspace tool and is widely supported by monorepo tooling, CI, package managers, lockfile review, and Node-focused provider SDK docs.
- The v2 build already changes backend framework, auth, realtime, and database. Changing package manager and runtime at the same time increases migration risk.
- Bun is promising and officially supports workspaces and broad Node compatibility, but payment/media/provider SDK stability matters more than install speed during the build.
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

Keep Next.js PWA. Build clean v2 implementations for:

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

Build v2 in this clean repo shape:

```text
apps/api
apps/web
apps/worker
packages/contracts
```

Historical implementations are context only for lessons already captured in v2 docs, contracts, schema, and tests. Do not bulk-copy external `apps/api` or `apps/web` implementation code into v2.
