# Veel V2 Route Map

Status: accepted
Scope: API routes, frontend routes, permissions, tests
Last updated: 2026-06-03
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
- Every route that changes money, access, tickets, dating, messages, age, wallet, moderation, or admin state requires auth, authorization, idempotency where relevant, rate limits, and audit records.

## Frontend Routes

| Route | Phase | Auth | Age | Wallet | Owner | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | MVP | no | no | no | web/landing | Public landing, attribution capture, teaser-safe marketing. |
| `/enter` | MVP | partial | no | no | onboarding | Identity choice, embedded/native wallet path, age handoff. |
| `/age` | MVP | yes | pending | yes | onboarding | Third-party age verification session/status. |
| `/app/home` | MVP | yes | yes | yes | home | Recommended/Following/NSFW/SFW feed. |
| `/app/bits` | MVP | yes | yes | yes | media | Reels-style Bit feed. |
| `/app/discover` | MVP | yes | yes | yes | discover | Search, hashtags, creators, events; not a redirect alias. |
| `/app/create` | MVP | yes | yes | yes | create | Upload/capture, labels, event attach, monetisation, publish. |
| `/app/messages` | Phase 2 | yes | yes | yes | messages | Inbox, paid messages, match/event contexts. |
| `/app/profile` | MVP | yes | yes | yes | profile | Own profile, wallet/activity/settings links. |
| `/app/profile/:handle` | MVP | yes | yes | yes | profile | Public creator/user profile. |
| `/app/media/:id` | MVP | yes | yes | yes | media | Viewport-locked media viewer. |
| `/app/stream/:id` | Phase 2 | yes | yes | yes | live | Live room/replay viewer, pass/chat state. |
| `/app/activity` | Phase 2 | yes | yes | yes | activity | Purchases, unlocks, tips, tickets, wallet, referrals. |
| `/app/wallet` | MVP | yes | yes | yes | wallet | Wallet address, top-up, external link, receipts. |
| `/app/settings` | MVP | yes | yes | yes | settings | Profile, security, sessions, feed, privacy, notifications. |
| `/app/tickets` | Phase 3 | yes | yes | yes | events | My Tickets and QR/receipt list. |
| `/app/tickets/:id` | Phase 3 | yes | yes | yes | events | Ticket QR/details/check-in status. |
| `/app/events/:id` | Phase 3 | yes | yes | yes | events | Event detail/ticket sheet. |
| `/app/dating/activate` | Phase 4 | yes | yes | yes | dating | Consent, safety, active-match limits. |
| `/app/dating/feed` | Phase 4 | yes | yes | yes | dating | Explicit Dating Mode feed only. |
| `/app/dating/matches` | Phase 4 | yes | yes | yes | dating | Match list and stale/archived state. |
| `/admin` | MVP internal | admin | yes | yes | admin | Ops dashboard, role-gated. |
| `/admin/*` | phased | admin | yes | yes | admin | Users, content, reports, payments, events, dating, providers. |

## API Route Groups

All routes use `/v1`.

| Group | Routes | Phase | Notes |
| --- | --- | --- | --- |
| Session | `GET /v1/session`, `GET /v1/me` | MVP | Frontend-safe app access, wallet, age, badges, prefs. |
| Age | `POST /v1/age/sessions`, `GET /v1/age/status`, `POST /v1/webhooks/age/:provider` | MVP | Provider sessions/webhooks; minimal stored result. |
| Wallets | `GET /v1/wallets`, `POST /v1/wallets/link-challenges`, `POST /v1/wallets/link`, `PATCH /v1/wallets/:id/primary`, `POST /v1/wallets/onramp-sessions` | MVP | Embedded/native wallet path; onramp is not payment proof. |
| Profiles | `GET /v1/profiles/:handle`, `PATCH /v1/profiles/me`, `POST /v1/follows/:userId` | MVP | Creator/user profile capability model. |
| Content | `GET /v1/content/feed`, `GET /v1/content/{contentId}`, `POST /v1/content`, `PATCH /v1/content/{contentId}`, `POST /v1/media/uploads`, `POST /v1/media/assets/:id/sync` | MVP | Bunny-backed upload/create/status; media-safe resources. |
| Discover | `GET /v1/discover/search`, `GET /v1/discover/hashtags`, `GET /v1/discover/hashtags/{slug}`, `GET /v1/discover/creators`, `GET /v1/discover/events`, `GET /v1/discover/live` | MVP | Search/discovery read models for content, creators, hashtags, events, and live. |
| Feed Controls | `PATCH /v1/feed/preferences`, `POST /v1/feed/reset`, `POST /v1/feed/hide-creator`, `POST /v1/feed/hide-topic` | MVP | Backend-owned recommendation preferences and safety controls. |
| Engagement | `POST /v1/engagement/:contentId/like`, `POST /v1/engagement/:contentId/save`, `POST /v1/engagement/:contentId/comments`, `GET /v1/engagement/:contentId/comments`, `POST /v1/shares` | MVP/Phase 2 | Backend-owned engagement records. |
| Reports/Blocks | `POST /v1/reports`, `POST /v1/blocks/:userId` | MVP | Safety actions audited. |
| Payments | `POST /v1/payments/intents`, `GET /v1/payments/intents/:id`, `GET /v1/payments/intents/:id/transaction-request`, `POST /v1/payments/intents/:id/submissions`, `POST /v1/content/:id/unlock-intents`, `POST /v1/webhooks/solana-indexer` | MVP | Noncustodial payment intent, content unlock intent, entitlement grant, and evidence. |
| Referrals | `POST /v1/referrals/tokens`, `GET /v1/referrals/activity` | Phase 2 | External links only create commission eligibility. |
| Live | `POST /v1/live/rooms`, `GET /v1/live/rooms/:id`, `GET /v1/live/rooms/:id/host-connection`, `POST /v1/live/rooms/:id/pass-intents` | Phase 2 | Livepeer JWT for pass-gated playback. |
| Messages | `GET /v1/messages/conversations`, `POST /v1/messages/conversations/:id/messages` | Phase 2 | Paid message delivery after backend settlement. |
| Subscriptions | `GET /v1/subscriptions/plans`, `POST /v1/subscriptions/intents`, `PATCH /v1/subscriptions/:id/cancel` | Phase 2 | Platform and creator subscriptions share state machine. |
| Events | `POST /v1/events`, `PATCH /v1/events/:id`, `GET /v1/events/:id`, `POST /v1/events/:id/tickets/intents`, `POST /v1/events/:id/tickets/requests`, `POST /v1/tickets/:id/check-in` | Phase 3 | Ticket price creator-owned, backend-validated. |
| Dating | `POST /v1/dating/activate`, `PATCH /v1/dating/preferences`, `POST /v1/dating/swipes`, `GET /v1/dating/matches`, `PATCH /v1/dating/matches/:id/archive` | Phase 4 | Explicit opt-in, safety, active-match cap. |
| Activity | `GET /v1/activity`, `GET /v1/activity/payments`, `GET /v1/activity/tickets`, `GET /v1/activity/referrals` | Phase 2 | Trust/accountability surface. |
| Admin | `GET /v1/admin/ops/summary`, `GET /v1/admin/audit`, `GET /v1/admin/users`, `GET /v1/admin/users/{userId}`, `GET /v1/admin/content`, `PATCH /v1/admin/content/{contentId}/moderation`, `GET /v1/admin/reports`, `PATCH /v1/admin/reports/{reportId}`, `GET /v1/admin/payments/intents`, `GET /v1/admin/provider-events`, `POST /v1/admin/provider-events/{providerEventId}/replay`, `GET /v1/admin/support/cases`, `PATCH /v1/admin/support/cases/{supportCaseId}`, `GET /v1/admin/data-requests`, `PATCH /v1/admin/data-requests/{dataRequestId}`, `GET /v1/admin/events`, `GET /v1/admin/tickets`, `GET /v1/admin/dating/safety`, `GET /v1/admin/feature-flags`, `PATCH /v1/admin/feature-flags/{featureFlagKey}` | MVP/phased | Role-gated, audited, no provider secrets; every admin mutation writes admin action/audit. |
| AI/MCP | `POST /v1/ai/sessions`, `POST /v1/ai/sessions/:id/tool-calls` | Phase 5 | Permission-scoped, confirmation-gated tools. |
| Provider Webhooks | `POST /v1/webhooks/media/:provider`, `POST /v1/webhooks/age/:provider`, `POST /v1/webhooks/solana-indexer` | phased | Signature-verified, idempotent, audited provider callbacks. |

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
- Every mutation that changes money, access, tickets, wallet, age, dating, messages, moderation, admin, or provider state has idempotency coverage.
- Generated frontend client uses OpenAPI only.
