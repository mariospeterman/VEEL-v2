# AGENTS.md

## Mission

Build Veel v2 as a clean, provider-first, production-grade 18+ creator PWA/dApp for media, live/VOD, premium unlocks, messages, events, dating/matches, creator monetisation, and admin operations.

This is a greenfield build. The previous prototype is reference only for validated lessons.

## Source Of Truth

- New-build plan: `docs/v2-new-build/INDEX.md`
- Build steps: `docs/v2-new-build/build-plan.md`
- App architecture: `docs/v2-new-build/app-architecture.md`
- Stack decision: `docs/v2-new-build/stack-decision.md`
- API contracts: `packages/contracts`
- DB shape: `packages/database` migrations
- Provider behavior: official provider docs and provider adapters

Do not invent provider APIs, routes, DB columns, env vars, events, SDK calls, permissions, or payload shapes.

## Hard Rules

- No bulk-copying prototype app code.
- No duplicate routes, app shells, media viewers, payment systems, provider adapters, realtime systems, or CSS systems.
- No frontend business truth for payments, access, referrals, commissions, tickets, subscriptions, age/KYC, moderation, or admin state.
- No provider secrets, private keys, stream keys, signed media URLs, webhook secrets, raw PII, or service-role keys in browser bundles.
- No custom media infrastructure when Bunny/Livepeer do the provider job.
- No custom key custody. Embedded wallet provider must be noncustodial/user-controlled.
- No wallet approval treated as payment proof. Backend settlement verification is required.
- No raw provider payloads in frontend resources.
- No stale rebuild, migration-in-place, or prototype-porting plans.

## Architecture Defaults

- Web: Next.js PWA, TypeScript, Tailwind v4, TanStack Query, Zustand.
- API: Fastify TypeScript.
- Worker: TypeScript worker process.
- DB/Auth/Realtime: Supabase Postgres/Auth/Realtime.
- Contracts: OpenAPI/schema-first.
- Payments: Solana Pay, native SOL devnet first, SPL/USDC capable.
- Wallets: embedded noncustodial wallet provider plus external Solana wallets.
- Media: Bunny Stream for VOD, Livepeer for live/replay.
- Package manager: pnpm.
- Runtime: Node.js LTS for launch.

## Build Order

Follow `docs/v2-new-build/build-plan.md`.

Every production slice must include:

- product behavior doc
- API contract
- database migration
- backend tests
- frontend smoke/E2E
- provider boundary tests
- admin/ops visibility when relevant
- docs update

## Prototype Reference Rule

The previous prototype may be used to inspect:

- validated behavior
- tests and fixtures
- provider lessons
- screenshots and UX findings
- launch blockers

Port lessons and tests, not code shape.

## Security Baseline

- Follow OWASP API Top 10.
- Validate all input.
- Authorize object and function access server-side.
- Rate-limit auth, wallet, payment, age, upload, message, dating, ticketing, moderation, and admin flows.
- Audit money, provider callbacks, access changes, age/KYC, safety, admin, and AI tool calls.
- Redact logs.
- Keep service-role and provider keys server-only.

## PR / Change Checklist

- Contracts updated
- Migrations added and reversible where practical
- Authz/policy checked
- Idempotency checked
- Audit logging checked
- Provider docs verified
- Tests added
- No secrets committed
- No duplicate systems introduced
