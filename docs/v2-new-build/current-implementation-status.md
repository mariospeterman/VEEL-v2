# Current Implementation Status

Status: accepted
Scope: implementation status, known gaps, and next hardening priorities
Last updated: 2026-06-12
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
- Fastify API bootstrap with route registration, dependency construction, shared app-level Postgres client construction, close-hook lifecycle, env validation, raw-body support for signed webhooks, global rate limit, OpenAPI plugin, and Supabase boundary plugin.
- Shared backend helpers now cover the app-level Postgres client, explicit transaction boundary, common Idempotency-Key parsing/validation, stable idempotency request hashing, route-specific mutation rate-limit presets, and the first admin mutation route-policy guard for migrated route utilities.
- Root Supabase CLI project is initialized with committed `supabase/config.toml`, repo-local Supabase CLI `2.106.0`, and `supabase/migrations` linked to the canonical `packages/database/migrations` SQL files. Supabase MCP is authenticated against the active `Veel v2` project and migration history is normalized to committed versions `0001` through `0056`. Root direct migration tooling uses the session-pooler wrapper successfully; `pnpm supabase:migrations` aligns local/remote history, `pnpm supabase:history:check` reports no missing/extra history rows, and `pnpm supabase:push:dry` reports `Remote database is up to date`.
- Supabase/Auth session verification boundary, web SSR cookie refresh/confirmation route, real `/enter` magic-link session UX, profile-completion mutation UI, external wallet challenge handoff UI, configured-session redirects, backend app-access redirects for protected app-shell pages, and backend session/profile readiness projections.
- Age provider waterfall boundary, `/age` provider-session start UI, and normalized webhook/test paths, with unavailable providers failing closed when not configured.
- External wallet challenge/link/revoke/status flow with backend signature verification and replay/expiry checks; `/enter` and `/wallet` can now coordinate injected-wallet challenge signing while keeping wallet truth server-side; onramp provider boundary fails closed unless configured.
- Home feed, content read model, media access projection, `/create` backend draft/upload-session handoff with persisted media asset id, TUS upload progress/pause/resume, creator-triggered provider status sync, Bunny/Livepeer provider status boundaries, and provider webhook normalization tests.
- Provider media readiness only updates playback/readiness projection; moderation approval and public access remain separate backend/admin-owned truth.
- Native SOL devnet payment intent, Solana Pay transaction request URL, submitted-signature capture, backend settlement verification, shared transaction boundary for payment submission settlement, content unlock entitlement grant after confirmed settlement, and browser support, content-unlock, live-pass, Event Access Pass, and paid-message handoffs to backend-created intents/transaction requests.
- Payment intents now store and expose instant-digital-access withdrawal-waiver/terms evidence defaults so refund review can protect creators/platform against ordinary change-of-mind refunds where legally valid while preserving mandatory-rights exceptions.
- Confirmed payment settlement now writes durable receipt, receipt line, compliance-ledger, in-app confirmation delivery, pending email-provider delivery, notification, and audit evidence in the same backend transaction used for entitlement/product settlement.
- Activity payment projections and `/app/activity` now expose backend-derived receipt/confirmation/withdrawal-review state and a real refund/access-issue review request form for exceptions. This is review-state only: no automatic refund, custody, balance, payout queue, or access revocation is executed from the user surface.
- Support/tip, referral attribution/commission projection, activity/payment/wallet transaction projections, and creator dashboard/onboarding projections that avoid balance/withdrawal language.
- Live rooms/pass/chat projections, DB-first Livepeer room reservation before provider creation, Event Access Pass projections, Mutuals projections, messages/paid-message projections, notifications/push/service-worker boundaries, organization/KYB/admin support policy surfaces, and admin provider/payment/compliance projections.
- Auto-renewing subscription architecture is modeled through backend-owned delegated authorization, renewal worker tick, collection/grace/revocation states, and fail-closed provider boundaries; `/subscriptions` now exposes backend intent creation, setup-reference display, authorization evidence submission, and cancellation controls without making the browser a subscription/access source of truth.
- Frontend smoke coverage covers desktop/mobile app shell, onboarding, age, content, create, discover, messages, activity, wallet, creator dashboard, subscriptions, Studio/org, settings, admin, live, Event Access, Mutuals, and assistant projections. Authenticated happy-path smoke now covers `enter -> profile -> wallet -> age -> home -> create -> unlock` against a local mock API, including bearer-token propagation and idempotency headers for money/access mutations.
- Real authenticated API integration coverage now exercises the wallet -> age -> profile readiness -> content create -> content unlock -> confirmed settlement -> entitlement-backed unlock -> idempotent refund/dispute request -> paid Event Access Pass -> confirmed settlement -> access-pass activity -> paid message -> confirmed settlement -> visible message -> live pass -> confirmed settlement -> signed playback/chat -> subscription authorization -> worker collection -> provider replay path against a configured Postgres/Supabase test database through Fastify routes, worker repositories, and Postgres repositories. The test uses real external-wallet Ed25519 signatures, a signed Sumsub-style age webhook, backend-created profile/content/payment-intent/refund/Event Access/message/live-pass/subscription mutations, a confirmed settlement verifier boundary, entitlement/access-pass/message/live room/subscription read-projection assertions, worker collection/replay outcome assertions, deterministic cleanup, and an explicit remote-DB guard. Run it with `VEEL_ALLOW_REMOTE_API_INTEGRATION_TESTS=1 pnpm test:integration:api` when the root `.env` points at the intended non-production test database.

## Fail-Closed Or Not Production-Ready

- Real provider credentials, webhook endpoints, staging accounts, sandbox smoke tests, and production keys are intentionally placeholders until manually configured.
- `/enter` now starts real Supabase magic-link session flows, exposes the backend `PATCH /v1/profiles/me` profile-completion mutation, coordinates external Solana wallet challenge signing through backend-owned wallet endpoints, and protected web pages redirect to `/enter?next=<path>` when Supabase SSR is configured and no validated claims are present. Protected app-shell pages now also redirect incomplete backend `appAccessState` to `/enter`, `/wallet`, or `/age`; remediation surfaces remain reachable.
- Age/KYC/KYB provider launch paths need one launch-approved provider fully wired with current official docs, configured credentials, live webhook verification, retention policy, and admin review flow.
- Embedded wallet provider remains a boundary until a launch-approved noncustodial provider is configured and tested.
- Payment settlement is native SOL devnet first; SPL/USDC, product-specific split settlement beyond the current content-unlock handoff, launch-approved email-provider delivery for withdrawal-waiver confirmations, exact subscription delegation program verification, and provider replay tooling still need launch-scope completion.
- Subscription renewals are architected as auto-renewing backend/worker collections, but production collection requires real provider/program configuration, authority verification, and staging evidence.
- Media creation has backend draft, admin-tunable draft/upload abuse policy enforcement with safe defaults, metadata/preview update, Event Access draft linking, persisted upload-session handoff, TUS browser upload/resume wiring, provider-status sync UI, entitlement-aware content playback rendering, explicit publish submission, and a separate `publish_state`.
- Admin dashboard is substantial; organization KYB/member, support policy/case, moderation/report, refund/dispute, data-request, and feature-flag mutations now share the admin mutation route-policy/idempotency/rate-limit guard, but final role matrix coverage and removal of any remaining compatibility aliases after migrations and clients are updated still remain.
- Deployment has an executable skeleton with health/readiness probes, build/migration workflow gates, rollback runbook, deploy preflight, and observability runbook. It remains not production-ready until real hosting targets, artifact digest pinning, database backup confirmation, provider staging smoke, alert routing, environment-scoped deploy variables, and the final Supabase remote migration-history linking strategy are configured.

## P0 Before Broad Expansion

1. Continue migrating money/access/admin/safety mutations onto the shared Postgres transaction helper slice by slice; payment submission settlement is already on the shared boundary.
2. Continue migrating route modules onto shared idempotency helpers, route-policy/RBAC, route-specific rate-limit presets, and test factory helpers. The first admin mutation routes are migrated; money/access/safety routes still need slice-by-slice adoption and durable generic idempotency conflict behavior where route-specific stores are insufficient.
3. Extend real authenticated API/test-DB integration coverage beyond the wallet -> age -> create -> content unlock/refund request/payment activity receipt/Event Access/paid message/live pass/subscription/provider replay path to durable webhook replay and browser-authenticated money/access smoke flows. Supabase remote migration history is linked through `0059`; apply/link new migrations after each slice, rerun dry push/advisors, and keep public-table RLS at 100%.
4. Wire one launch-approved age/KYC provider path end to end and keep all unconfigured providers fail-closed.
5. Harden product-specific Solana Pay checkout/access paths beyond the content-unlock handoff: support, live pass, Event Access, paid message, platform plan, and creator membership.
6. Continue deployment hardening beyond the skeleton: artifact digest pinning, provider staging smoke, backup/snapshot verification, alert routing, and real hosting/OIDC integration.

## Required Status Discipline

- Every slice summary must state controlling docs, provider docs checked, gaps closed, tests run, and security/compliance boundaries.
- Docs must say what is implemented, what remains fail-closed, required env vars, migrations/contracts/routes changed, admin visibility, tests, and production gates.
- Production UI buttons must perform a real action, navigate to a real route, or be hidden/disabled behind a documented feature flag.
- Do not mark Veel production-ready until code, migrations, tests, provider staging, deployment, observability, and security/compliance gates support that claim.
