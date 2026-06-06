# Veel V2 Route Map

Status: accepted
Scope: API routes, frontend routes, permissions, tests
Last updated: 2026-06-05
Source of truth: yes

Owns:
- frontend route names and API route families

Defers to:
- OpenAPI for operation schemas and response bodies

Does not own:
- database tables, provider internals, screen styling

Launch scope:
- launch and phased route coverage

Non-goals:
- uncontracted route examples

This document freezes the v2 route family before implementation. It must match `packages/contracts/openapi.yaml`.

## API Version Decision

Use `/v1` for the first public greenfield API.

Rules:

- No `/v2` routes in docs, code, tests, or generated clients.
- No legacy `/api/v1` internal examples except external provider URLs that truly include `/api/v1`.
- OpenAPI in `packages/contracts/openapi.yaml` is the API source of truth.
- Route examples in docs must match OpenAPI.
- Every route that changes money, access, Event Access Passes, Mutuals, messages, age, wallet, tax/compliance, moderation, or admin state requires auth, authorization, idempotency where relevant, rate limits, and audit records.

## Frontend Routes

| Route | Phase | Auth | Age | Wallet | Owner | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | MVP | no | no | no | web/landing | Public landing, attribution capture, teaser-safe marketing. |
| `/enter` | MVP | partial | no | no | onboarding | Identity choice, embedded/native wallet path, age handoff. |
| `/age` | MVP | yes | pending | yes | onboarding | Third-party age verification session/status. |
| `/app/home` | MVP | yes | yes | yes | home | Recommended/Following/NSFW/SFW feed. |
| `/app/bits` | MVP | yes | yes | yes | media | Reels-style Bit feed. |
| `/app/discover` | MVP | yes | yes | yes | discover | Search, hashtags, creators, Event Access; not a redirect alias. |
| `/create` | MVP | yes | yes | yes | create | Upload/capture, labels, event attach, monetisation, publish. |
| `/app/messages` | Phase 2 | yes | yes | yes | messages | Inbox, paid messages, Mutual/Event Access contexts. |
| `/app/profile` | MVP | yes | yes | yes | profile | Own profile, wallet/activity/settings links. |
| `/app/profile/:handle` | MVP | yes | yes | yes | profile | Public creator/user profile. |
| `/app/media/:id` | MVP | yes | yes | yes | media | Viewport-locked media viewer. |
| `/live/:id` | Phase 2 | yes | yes | yes | live | Live room/replay viewer, pass/chat state. |
| `/app/stream/:id` | migration | yes | yes | yes | live | Compatibility alias until live routes replace stream routes. |
| `/app/activity` | Phase 2 | yes | yes | yes | activity | Purchases, unlocks, support, passes, wallet, referrals, receipts. |
| `/app/wallet` | MVP | yes | yes | yes | wallet | Wallet address, top-up, external link, receipts. |
| `/app/studio` | Phase 2 | yes | yes | yes | organizations | Studio and Enterprise organization dashboards for current members. |
| `/app/settings` | MVP | yes | yes | yes | settings | Profile, security, sessions, feed, privacy, notifications. |
| `/passes` | Phase 3 | yes | yes | yes | events | Canonical My Passes and QR/access receipt list. |
| `/passes/:id` | Phase 3 | yes | yes | yes | events | Pass QR/details/check-in status. |
| `/event-access/:id` | Phase 3 | yes | yes | yes | events | Canonical Event detail/Event Access sheet. |
| `/app/tickets`, `/tickets`, `/tickets/:id`, `/app/events/:id`, `/events/:id` | migration | yes | yes | yes | events | Compatibility aliases that redirect to canonical Event Access/Passes routes. |
| `/mutuals/activate` | Phase 4 | yes | yes | yes | mutuals | Consent, safety, active-Mutual limits. |
| `/mutuals/feed` | Phase 4 | yes | yes | yes | mutuals | Explicit Mutuals feed only. |
| `/mutuals` | Phase 4 | yes | yes | yes | mutuals | Canonical Mutual list and stale/archived state. |
| `/mutuals/mutuals`, `/app/dating/*`, `/dating`, `/dating/matches` | migration | yes | yes | yes | mutuals | Compatibility aliases that redirect to canonical Mutuals routes. |
| `/app/assistant` | Phase 5 | yes | yes | yes | ai | Permission-scoped AI/MCP tool gateway with confirmation states and audit visibility. |
| `/admin` | MVP internal | admin | yes | yes | admin | Ops dashboard, role-gated. |
| `/admin/*` | phased | admin | yes | yes | admin | Users, content, reports, payments, Event Access, Mutuals, providers, compliance. |
| `/admin/compliance/ledger` | Phase 2 | admin | yes | yes | compliance | Immutable compliance ledger search/export. |
| `/admin/compliance/dac7/reports` | Phase 2 | admin | yes | yes | compliance | DAC7 annual report preparation and exports. |
| `/admin/compliance/carf/reports` | Phase 2 | admin | yes | yes | compliance | DAC8/CARF readiness reports, feature-flagged off by default. |
| `/admin/compliance/vat/determinations` | Phase 2 | admin | yes | yes | compliance | VAT/MWST determinations and review queue. |
| `/admin/compliance/receipts` | Phase 2 | admin | yes | yes | compliance | Access/payment receipt search. |
| `/admin/compliance/invoices` | Phase 2 | admin | yes | yes | compliance | VAT invoice search and export. |
| `/admin/referrals/programs` | Phase 2 | admin | yes | yes | admin | Referral program governance. |
| `/admin/referrals/partner-campaigns` | Phase 2 | admin | yes | yes | admin | Partner campaign governance. |
| `/admin/tier-waivers` | Phase 2 | admin | yes | yes | admin | Partner/free tier waiver policy. |
| `/admin/organizations` | Phase 2 | admin | yes | yes | admin | Enterprise organization/KYB/RBAC administration. |

## API Route Groups

All routes use `/v1`.

| Group | Routes | Phase | Notes |
| --- | --- | --- | --- |
| Session | `GET /v1/session`, `GET /v1/me` | MVP | Frontend-safe app access, wallet, age, badges, prefs. |
| Age | `POST /v1/age/sessions`, `GET /v1/age/status`, `POST /v1/webhooks/age/:provider` | MVP | Provider sessions/webhooks; minimal stored result. |
| Wallets | `GET /v1/wallets`, `POST /v1/wallets/link-challenges`, `POST /v1/wallets/link`, `PATCH /v1/wallets/:id/primary`, `POST /v1/wallets/onramp-sessions` | MVP | Embedded/native wallet path, primary wallet selection, and user-owned wallet funding session. Onramp is not payment proof. |
| Profiles | `GET /v1/profiles/:handle`, `GET /v1/profiles/me/creator-dashboard`, `GET /v1/profiles/me/creator-onboarding`, `PATCH /v1/profiles/me`, `POST /v1/follows/:userId` | MVP | Creator/user profile plus backend-derived creator monetisation dashboard and Become Creator readiness checklist. |
| Content | `GET /v1/content/feed`, `GET /v1/content/{contentId}`, `POST /v1/content`, `PATCH /v1/content/{contentId}`, `POST /v1/media/uploads`, `POST /v1/media/assets/:id/sync` | MVP | Bunny-backed upload/create/status; media-safe resources. |
| Discover | `GET /v1/discover/search`, `GET /v1/discover/hashtags`, `GET /v1/discover/hashtags/{slug}`, `GET /v1/discover/creators`, `GET /v1/discover/events`, `GET /v1/discover/live` | MVP | Search/discovery read models for content, creators, hashtags, events, and live. |
| Feed Controls | `GET /v1/feed/preferences`, `PATCH /v1/feed/preferences`, `POST /v1/feed/reset`, `POST /v1/feed/hide-creator`, `POST /v1/feed/hide-topic` | MVP | Backend-owned recommendation preferences and safety controls. |
| Engagement | `POST /v1/engagement/:contentId/like`, `POST /v1/engagement/:contentId/save`, `POST /v1/engagement/:contentId/comments`, `GET /v1/engagement/:contentId/comments`, `POST /v1/shares` | MVP/Phase 2 | Backend-owned engagement records. |
| Reports/Blocks | `POST /v1/reports`, `POST /v1/blocks/:userId` | MVP | Safety actions audited. |
| Notifications | `GET /v1/notifications`, `PATCH /v1/notifications/:id/read`, `GET /v1/notifications/preferences`, `PATCH /v1/notifications/preferences`, `GET /v1/notifications/push-config`, `POST /v1/notifications/devices`, `DELETE /v1/notifications/devices/:id` | Phase 2 | Backend-derived notification projections and browser push enrollment. Notifications never create payment/access truth. |
| Payments | `POST /v1/payments/intents`, `GET /v1/payments/intents/:id`, `GET /v1/payments/intents/:id/transaction-request`, `POST /v1/payments/intents/:id/submissions`, `POST /v1/content/:id/unlock-intents`, `POST /v1/webhooks/solana-indexer` | MVP | Noncustodial payment intent, content unlock intent, entitlement grant, and scoped Solana evidence. |
| Refunds/Disputes | `GET /v1/refunds/requests`, `POST /v1/refunds/requests` | Phase 2 | User-visible refund, dispute, and access-issue request workflow. Requests create review/audit state only; they never execute refunds, custody funds, create balances, or become payment truth. |
| Referrals | `POST /v1/referrals/tokens`, `GET /v1/referrals/activity` | Phase 2 | External links only create commission eligibility from Veel platform commission, never creator share or tax. |
| Live | `POST /v1/live/rooms`, `GET /v1/live/rooms/:id`, `GET /v1/live/rooms/:id/host-connection`, `POST /v1/live/rooms/:id/sync`, `POST /v1/live/rooms/:id/pass-intents`, `GET /v1/live/rooms/:id/messages`, `POST /v1/live/rooms/:id/messages` | Phase 2 | Livepeer room/status, backend-settled live passes, pass-gated playback/chat, replay projection. |
| Messages | `GET /v1/messages/conversations`, `GET /v1/messages/conversations/:id/messages`, `POST /v1/messages/conversations/:id/messages`, `POST /v1/messages/conversations/:id/paid-message-intents` | Phase 2 | Normal messages, server-priced paid-message drafts, delivery only after backend settlement. |
| Memberships | `GET /v1/subscriptions/plans`, `GET /v1/subscriptions`, `POST /v1/subscriptions/intents`, `POST /v1/subscriptions/authorizations/:id/submissions`, `PATCH /v1/subscriptions/:id/cancel` | Phase 2 | Compatibility route family for platform plans and Creator Memberships using delegated Solana authorization, backend verification, recurring collection, and cancel/revoke state. Target copy says Memberships. |
| Event Access | `POST /v1/events`, `PATCH /v1/events/:id`, `GET /v1/events/:id`, `POST /v1/events/:id/tickets/intents`, `POST /v1/events/:id/tickets/requests`, `POST /v1/tickets/:id/check-in` | Phase 3 | Compatibility route family for Event Access Passes. Pass price creator-owned, backend-validated. |
| Mutuals | `POST /v1/dating/activate`, `PATCH /v1/dating/preferences`, `GET /v1/dating/feed`, `POST /v1/dating/swipes`, `GET /v1/dating/matches`, `PATCH /v1/dating/matches/:id/archive` | Phase 4 | Compatibility route family for Mutuals. Explicit opt-in, safety, active-Mutual cap. |
| Activity | `GET /v1/activity`, `GET /v1/activity/payments`, `GET /v1/activity/wallet-transactions`, `GET /v1/activity/tickets`, `GET /v1/activity/referrals` | Phase 2 | Trust/accountability surface with backend-observed wallet transactions, receipts, passes, not wallet UI proof. |
| Organizations | `GET /v1/organizations` | Phase 2 | Studio/Enterprise member dashboard and backend-derived RBAC permission projection; software governance only, no custody, balances, withdrawals, or social preference. |
| Admin | `GET /v1/admin/ops/summary`, `GET /v1/admin/notifications/health`, `GET /v1/admin/audit`, `GET /v1/admin/users`, `GET /v1/admin/users/{userId}`, `GET /v1/admin/content`, `PATCH /v1/admin/content/{contentId}/moderation`, `GET /v1/admin/reports`, `PATCH /v1/admin/reports/{reportId}`, `GET /v1/admin/payments/intents`, `GET /v1/admin/unlocks`, `GET /v1/admin/provider-events`, `POST /v1/admin/provider-events/{providerEventId}/replay`, `GET /v1/admin/support/cases`, `PATCH /v1/admin/support/cases/{supportCaseId}`, `GET /v1/admin/support/policies`, `PATCH /v1/admin/support/policies/{supportPolicyId}`, `GET /v1/admin/refunds/disputes`, `PATCH /v1/admin/refunds/disputes/{refundDisputeId}`, `GET /v1/admin/data-requests`, `PATCH /v1/admin/data-requests/{dataRequestId}`, `GET /v1/admin/events`, `GET /v1/admin/tickets`, `GET /v1/admin/dating/safety`, `GET /v1/admin/compliance/ledger`, `GET /v1/admin/compliance/dac7/reports`, `GET /v1/admin/compliance/carf/reports`, `GET /v1/admin/compliance/vat/determinations`, `GET /v1/admin/compliance/receipts`, `GET /v1/admin/compliance/invoices`, `GET /v1/admin/referrals/programs`, `GET /v1/admin/referrals/partner-campaigns`, `GET /v1/admin/tier-waivers`, `GET /v1/admin/organizations`, `PATCH /v1/admin/organizations/{organizationId}/kyb`, `GET /v1/admin/organizations/{organizationId}/members`, `PATCH /v1/admin/organizations/{organizationId}/members/{membershipId}`, `GET /v1/admin/feature-flags`, `PATCH /v1/admin/feature-flags/{featureFlagKey}` | MVP/phased | Role-gated, audited, no provider secrets; every admin mutation writes admin action/audit. |
| AI/MCP | `GET /v1/ai/capabilities`, `POST /v1/ai/sessions`, `POST /v1/ai/sessions/:id/tool-calls` | Phase 5 | Permission-scoped, confirmation-gated tools. |
| Provider Webhooks | `POST /v1/webhooks/media/:provider`, `POST /v1/webhooks/age/:provider`, `POST /v1/webhooks/solana-indexer` | phased | Helius Solana evidence uses configured `authHeader`/`Authorization` verification; callbacks are idempotent, audited, and never expose raw provider payloads to frontend resources. |

## Required Response States

Every screen route and API route must define:

- auth requirement
- age requirement
- wallet requirement
- loading state
- empty state
- error/retry state
- rate-limit behavior
- audit behavior where applicable
- admin visibility where applicable
- tests

## Acceptance

- No `/v2` API route examples remain.
- OpenAPI and this route map agree before implementation.
- Every OpenAPI operation has an `operationId`.
- Every mutation that changes money, access, Event Access Passes, wallet, age, Mutuals, messages, tax/compliance, moderation, admin, or provider state has idempotency coverage.
- Generated frontend client uses OpenAPI only.
