# Current Implementation Status

Status: accepted
Scope: implementation status, known gaps, and next hardening priorities
Last updated: 2026-06-07
Source of truth: yes

Owns:
- honest current-state tracking for the v2 implementation
- fail-closed versus implemented boundaries
- near-term hardening priorities before broad feature expansion

Defers to:
- `build-plan.md`, OpenAPI, migrations, ADRs, and provider docs for exact behavior

Does not own:
- new product requirements, provider payload shapes, or schema details

Launch scope:
- implementation status through the current autonomous build sequence

Non-goals:
- claiming production readiness before provider credentials, staging smoke, deployment, and security gates are complete

## Controlling Rules

- Backend owns business truth; frontend owns route state, UX, cache, and safe pending indicators only.
- Money can buy content, Event Access, memberships, live access, subscriptions, and platform software features.
- Money must never buy people, visibility, matches, recommendations, ranking, moderation priority, message priority, or preferential social treatment.
- Blockchain is payment truth. Entitlements are access truth. Compliance ledger is reporting truth. Accounting export/integration is bookkeeping truth.
- Veel remains noncustodial: no internal credits, balances, escrow, withdrawals, payout queues, or server-held user private keys.

## Implemented And Real

- Monorepo, pnpm workspace, CI/security workflow, docs checks, lint/typecheck/test/smoke scripts, GStack gates, and gitleaks local gate.
- Fastify API bootstrap with route registration, dependency construction, close-hook lifecycle, env validation, raw-body support for signed webhooks, global rate limit, OpenAPI plugin, and Supabase boundary plugin.
- Supabase/Auth session verification boundary and backend session/profile readiness projections.
- Age provider waterfall boundary and normalized webhook/test paths, with unavailable providers failing closed when not configured.
- External wallet challenge/link/revoke/status flow with backend signature verification and replay/expiry checks; onramp provider boundary fails closed unless configured.
- Home feed, content read model, media access projection, Bunny/Livepeer provider status boundaries, and provider webhook normalization tests.
- Native SOL devnet payment intent, Solana Pay transaction request URL, submitted-signature capture, backend settlement verification, and content unlock entitlement grant after confirmed settlement.
- Support/tip, referral attribution/commission projection, activity/payment/wallet transaction projections, and creator dashboard/onboarding projections that avoid balance/withdrawal language.
- Live rooms/pass/chat projections, Event Access Pass projections, Mutuals projections, messages/paid-message projections, notifications/push/service-worker boundaries, organization/KYB/admin support policy surfaces, and admin provider/payment/compliance projections.
- Auto-renewing subscription architecture is modeled through backend-owned delegated authorization, renewal worker tick, collection/grace/revocation states, and fail-closed provider boundaries.
- Frontend smoke coverage covers desktop/mobile app shell, onboarding, age, content, create, discover, messages, activity, wallet, creator dashboard, subscriptions, Studio/org, settings, admin, live, Event Access, Mutuals, and assistant projections.

## Fail-Closed Or Not Production-Ready

- Real provider credentials, webhook endpoints, staging accounts, sandbox smoke tests, and production keys are intentionally placeholders until manually configured.
- `/enter` and onboarding screens still need full real Supabase signup/login/onboarding UX, route guards, and browser session persistence polish.
- Age/KYC/KYB provider launch paths need one launch-approved provider fully wired with current official docs, live webhook verification, retention policy, and admin review flow.
- Embedded wallet provider remains a boundary until a launch-approved noncustodial provider is configured and tested.
- Payment settlement is native SOL devnet first; SPL/USDC, product-specific split settlement, exact subscription delegation program verification, and provider replay tooling still need launch-scope completion.
- Subscription renewals are architected as auto-renewing backend/worker collections, but production collection requires real provider/program configuration, authority verification, and staging evidence.
- Media creation needs full browser upload, resumability, provider-ready plus moderation-pending separation, publish action, entitlement-aware playback, and abuse quota enforcement.
- Admin dashboard is substantial but still needs final role matrix coverage, reason-required mutation audit expansion, and removal of any remaining compatibility aliases after migrations and clients are updated.
- Deployment remains not production-ready while production workflow, infra skeleton, migration runner, rollback plan, health checks, observability, alerts, and provider staging smoke are incomplete.

## P0 Before Broad Expansion

1. Centralize the shared Postgres pool and transaction helper so repository construction does not create one pool per repository in production paths.
2. Add shared idempotency, audit, route-policy/RBAC, route-specific rate limit, and test factory helpers, then migrate money/access/admin/safety mutations onto them slice by slice.
3. Remove any unsafe media auto-approval path: provider playable/ready state must not equal moderation approval or publish eligibility.
4. Replace demo-shaped `/enter` with real Supabase auth/session/onboarding and route guards.
5. Wire one launch-approved age/KYC provider path end to end and keep all unconfigured providers fail-closed.
6. Harden product-specific Solana Pay checkout/access paths for content, support, live pass, Event Access, paid message, platform plan, and creator membership.
7. Replace placeholder deployment with staged deploy/migration/rollback/health-check/observability skeleton and docs.

## Required Status Discipline

- Every slice summary must state controlling docs, provider docs checked, gaps closed, tests run, and security/compliance boundaries.
- Docs must say what is implemented, what remains fail-closed, required env vars, migrations/contracts/routes changed, admin visibility, tests, and production gates.
- Production UI buttons must perform a real action, navigate to a real route, or be hidden/disabled behind a documented feature flag.
- Do not mark Veel production-ready until code, migrations, tests, provider staging, deployment, observability, and security/compliance gates support that claim.
