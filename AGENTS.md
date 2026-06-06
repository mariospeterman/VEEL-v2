# AGENTS.md

## Mission

Build Veel v2 as a clean, provider-first, production-grade 18+ creator PWA/dApp for media, live/VOD, premium unlocks, messages, Event Access, Mutuals, creator monetisation, and admin/compliance operations.

This is a standalone build. The historical context is context only for validated lessons.

## Source Of Truth

- New-build plan: `docs/v2-new-build/INDEX.md`
- Build steps: `docs/v2-new-build/build-plan.md`
- App architecture: `docs/v2-new-build/app-architecture.md`
- Stack decision: `docs/v2-new-build/stack-decision.md`
- API contracts: `packages/contracts`
- DB shape: `packages/database` migrations
- Provider behavior: official provider docs and provider adapters

Do not invent provider APIs, routes, DB columns, env vars, events, SDK calls, permissions, or payload shapes.
Before implementing or changing provider code, re-check the latest official provider docs and update the relevant ADR/doc when behavior, payloads, limits, or security settings differ from this scaffold.

## Hard Rules

- No bulk-copying historical context code.
- No duplicate routes, app shells, media viewers, payment systems, provider adapters, realtime systems, or CSS systems.
- No frontend business truth for payments, access, referrals, commissions, Event Access Passes, memberships, age/KYC, tax/compliance, moderation, or admin state.
- No custody. No Veel-held creator balances. No internal credits. No withdrawals. No escrow. No platform-controlled payout queue.
- No money-based people ranking, feed ranking, recommendation boost, Mutuals boost, or message priority.
- Money can buy access to content, events, memberships, and live streams. Money can never buy access to people, visibility, matches, recommendations, or preferential social treatment.
- No provider secrets, private keys, stream keys, signed media URLs, webhook secrets, raw PII, or service-role keys in browser bundles.
- No custom media infrastructure when Bunny/Livepeer do the provider job.
- No custom key custody. Embedded wallet provider must be noncustodial/user-controlled.
- No wallet approval treated as payment proof. Backend settlement verification is required.
- No raw provider payloads in frontend resources.
- No stale copy, in-place upgrade, or reference-code import plans.
- No provider-dependent production path can ship while its ADR state is only `candidate`; it must be `staging-approved` or `launch-approved` for the exact use case.

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

## Historical Context Rule

Historical repositories and notes are context only. If a useful lesson appears there, capture it in the v2 docs, OpenAPI contract, schema blueprint, migration test, provider fixture, or E2E test before implementing. Never copy historical code shape, CSS, provider adapters, routes, or business logic.

## Security Baseline

- Follow OWASP API Top 10.
- Validate all input.
- Authorize object and function access server-side.
- Rate-limit auth, wallet, payment, age, upload, message, Mutuals, Event Access, moderation, tax/compliance, and admin flows.
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
- `pnpm docs:check` run before and after docs, route, contract, schema, ADR, or provider-decision changes
